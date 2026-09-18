import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { createDatabase } from "./lib/database.mjs";
import { AppError, createService } from "./lib/service.mjs";
import { createUpdateManager } from "./lib/update.mjs";

const defaultDataFile = fileURLToPath(new URL("./data/development.sqlite", import.meta.url));
const defaultOrigins = "http://localhost:3000,http://127.0.0.1:3000";
const cookieName = "cipc_session";

export function resolveCookieSecure(env = process.env) {
  const configuredCookieSecure = env.COOKIE_SECURE?.trim();
  return configuredCookieSecure ? configuredCookieSecure === "true" : env.NODE_ENV === "production";
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  response.end(JSON.stringify(payload));
}

function sendText(response, status, payload, headers = {}) {
  response.writeHead(status, { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store", ...headers });
  response.end(payload);
}

function csvCell(value) {
  const raw = String(value ?? "");
  const safe = /^[\t\r ]*[=+@-]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

function auditCsv(rows) {
  return `\ufeff${[
    ["时间", "操作者", "用户名", "操作", "对象类型", "对象 ID", "摘要"],
    ...rows.map((row) => [row.createdAt, row.actorDisplayName, row.actorUsername, row.action, row.entityType, row.entityId, JSON.stringify(row.summary)])
  ].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}

export async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new AppError(413, "PAYLOAD_TOO_LARGE", "请求内容过大");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError(400, "INVALID_JSON", "请求内容不是有效的 JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppError(400, "INVALID_JSON", "请求内容需要是 JSON 对象");
  }
  return parsed;
}

function parseCookies(request) {
  const cookies = {};
  for (const entry of (request.headers.cookie || "").split(";").map((value) => value.trim()).filter(Boolean)) {
    const separator = entry.indexOf("=");
    const key = separator === -1 ? entry : entry.slice(0, separator);
    const encoded = separator === -1 ? "" : entry.slice(separator + 1);
    try {
      cookies[key] = decodeURIComponent(encoded);
    } catch {
      cookies[key] = "";
    }
  }
  return cookies;
}

function sessionCookie(token, { maxAge = 43_200, secure = false } = {}) {
  return `${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function listFilters(url, extra = {}) {
  return {
    paginated: url.searchParams.has("page") || url.searchParams.has("pageSize"),
    page: url.searchParams.get("page") || 1,
    pageSize: url.searchParams.get("pageSize") || 20,
    status: url.searchParams.get("status") || "",
    dateFrom: url.searchParams.get("dateFrom") || "",
    dateTo: url.searchParams.get("dateTo") || "",
    ...extra
  };
}

const loopbackAddresses = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function requestAddress(request, trustProxy = false) {
  const socketAddress = request.socket.remoteAddress || "unknown";
  if (!trustProxy || !loopbackAddresses.has(socketAddress)) return socketAddress;
  const forwarded = request.headers["cf-connecting-ip"] || request.headers["x-forwarded-for"] || request.headers["x-real-ip"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return String(value || "").split(",")[0].trim().slice(0, 100) || socketAddress;
}

export function createFailureLimiter({ maxFailures = 5, windowMs = 15 * 60 * 1000, maxKeys = 10_000, errorCode = "LOGIN_RATE_LIMITED", errorMessage = "登录失败次数过多，请稍后再试" } = {}) {
  if (!Number.isSafeInteger(maxKeys) || maxKeys < 1) throw new TypeError("maxKeys must be a positive integer");
  const attempts = new Map();

  function makeRoom(now) {
    if (attempts.size < maxKeys) return;
    for (const [key, attempt] of attempts) {
      if (attempt.expiresAt <= now) attempts.delete(key);
    }
    while (attempts.size >= maxKeys) attempts.delete(attempts.keys().next().value);
  }

  return {
    assertAllowed(key) {
      const current = attempts.get(key);
      if (!current) return;
      if (current.expiresAt <= Date.now()) {
        attempts.delete(key);
        return;
      }
      if (current.failures >= maxFailures) {
        throw new AppError(429, errorCode, errorMessage);
      }
    },
    recordFailure(key) {
      const now = Date.now();
      const current = attempts.get(key);
      if (!current || current.expiresAt <= now) {
        if (current) attempts.delete(key);
        makeRoom(now);
        attempts.set(key, { failures: 1, expiresAt: now + windowMs });
        return;
      }
      current.failures += 1;
    },
    clear(key) {
      attempts.delete(key);
    }
  };
}

export function createApp(service, {
  allowedOrigins = new Set(defaultOrigins.split(",")),
  secureCookie = false,
  trustProxy = false,
  loginLimiter = createFailureLimiter(),
  loginSourceLimiter = createFailureLimiter({ maxFailures: 25 }),
  passwordChangeLimiter = createFailureLimiter({ errorCode: "PASSWORD_CHANGE_RATE_LIMITED", errorMessage: "当前密码错误次数过多，请稍后再试" }),
  updateManager = null
} = {}) {
  function requireUser(request, { allowPasswordChange = false, roles } = {}) {
    const user = service.getSessionUser(parseCookies(request)[cookieName]);
    if (user.mustChangePassword && !allowPasswordChange) {
      throw new AppError(403, "PASSWORD_CHANGE_REQUIRED", "首次登录需要先修改初始密码");
    }
    if (roles && !roles.includes(user.role)) throw new AppError(403, "FORBIDDEN", "当前账号没有执行此操作的权限");
    return user;
  }

  return createServer(async (request, response) => {
    const origin = request.headers.origin;
    const corsHeaders = origin && allowedOrigins.has(origin)
      ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", Vary: "Origin" }
      : {};

    try {
      const url = new URL(request.url || "/", "http://localhost");
      if (request.method === "OPTIONS") {
        response.writeHead(204, {
          ...corsHeaders,
          "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        });
        response.end();
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/health") {
        const health = service.livenessCheck();
        sendJson(response, health.status === "ok" ? 200 : 503, health, corsHeaders);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/auth/login") {
        const input = await readJson(request);
        const remoteAddress = requestAddress(request, trustProxy);
        const loginKey = String(input.username || "").trim().toLowerCase();
        loginSourceLimiter.assertAllowed(remoteAddress);
        loginLimiter.assertAllowed(loginKey);
        try {
          const user = await service.authenticate(input.username, input.password);
          loginLimiter.clear(loginKey);
          const session = service.createSession(user.id);
          sendJson(response, 200, { data: user }, { ...corsHeaders, "Set-Cookie": sessionCookie(session.token, { secure: secureCookie }) });
        } catch (error) {
          if (error instanceof AppError && error.code === "INVALID_CREDENTIALS") {
            loginLimiter.recordFailure(loginKey);
            loginSourceLimiter.recordFailure(remoteAddress);
            service.recordSystemEvent("auth.login_failed", { username: loginKey, remoteAddress });
          }
          throw error;
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/auth/session") {
        sendJson(response, 200, { data: requireUser(request, { allowPasswordChange: true }) }, corsHeaders);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/update/status") {
        requireUser(request, { roles: ["developer"] });
        sendJson(response, 200, { data: updateManager ? updateManager.getStatus() : { state: "disabled", message: "升级服务未配置" } }, corsHeaders);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/update/check") {
        requireUser(request, { roles: ["developer"] });
        if (!updateManager) throw new AppError(503, "UPDATE_DISABLED", "升级服务未配置");
        sendJson(response, 200, { data: await updateManager.check() }, corsHeaders);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/update") {
        const actor = requireUser(request, { roles: ["developer"] });
        if (!updateManager) throw new AppError(503, "UPDATE_DISABLED", "升级服务未配置");
        const input = await readJson(request);
        const result = await updateManager.requestUpgrade(input.version, actor);
        service.recordSystemEvent("system.update_requested", { version: result.targetVersion, repository: updateManager.repository, requestId: result.requestId }, actor);
        sendJson(response, 202, { data: result }, corsHeaders);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/auth/change-password") {
        const user = requireUser(request, { allowPasswordChange: true });
        const changeKey = `${requestAddress(request, trustProxy)}:${user.id}`;
        passwordChangeLimiter.assertAllowed(changeKey);
        try {
          const input = await readJson(request);
          const changedUser = await service.changePassword(user.id, input.currentPassword, input.newPassword, user);
          passwordChangeLimiter.clear(changeKey);
          const session = service.createSession(user.id);
          sendJson(response, 200, { data: changedUser }, { ...corsHeaders, "Set-Cookie": sessionCookie(session.token, { secure: secureCookie }) });
        } catch (error) {
          if (error instanceof AppError && error.code === "CURRENT_PASSWORD_INVALID") passwordChangeLimiter.recordFailure(changeKey);
          throw error;
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/auth/logout") {
        const token = parseCookies(request)[cookieName];
        service.deleteSession(token);
        sendJson(response, 200, { data: { loggedOut: true } }, { ...corsHeaders, "Set-Cookie": sessionCookie("", { maxAge: 0, secure: secureCookie }) });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/laboratories") {
        const user = requireUser(request);
        const includeInactive = url.searchParams.get("includeInactive") === "true";
        if (includeInactive && !["developer", "admin"].includes(user.role)) throw new AppError(403, "FORBIDDEN", "当前账号没有查看停用实验室的权限");
        sendJson(response, 200, { data: service.listLaboratories({ includeInactive }) }, corsHeaders);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/laboratories") {
        const actor = requireUser(request, { roles: ["developer", "admin"] });
        sendJson(response, 201, { data: service.createLaboratory(await readJson(request), actor) }, corsHeaders);
        return;
      }

      const laboratoryMatch = url.pathname.match(/^\/api\/laboratories\/([^/]+)$/);
      if (request.method === "PATCH" && laboratoryMatch) {
        const actor = requireUser(request, { roles: ["developer", "admin"] });
        sendJson(response, 200, { data: service.updateLaboratory(decodeURIComponent(laboratoryMatch[1]), await readJson(request), actor) }, corsHeaders);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/meeting-rooms") {
        const user = requireUser(request);
        const includeInactive = url.searchParams.get("includeInactive") === "true";
        if (includeInactive && !["developer", "admin"].includes(user.role)) throw new AppError(403, "FORBIDDEN", "当前账号没有查看停用会议室的权限");
        sendJson(response, 200, { data: service.listMeetingRooms({ includeInactive }) }, corsHeaders);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/meeting-rooms") {
        const actor = requireUser(request, { roles: ["developer", "admin"] });
        sendJson(response, 201, { data: service.createMeetingRoom(await readJson(request), actor) }, corsHeaders);
        return;
      }

      const meetingRoomMatch = url.pathname.match(/^\/api\/meeting-rooms\/([^/]+)$/);
      if (request.method === "PATCH" && meetingRoomMatch) {
        const actor = requireUser(request, { roles: ["developer", "admin"] });
        sendJson(response, 200, { data: service.updateMeetingRoom(decodeURIComponent(meetingRoomMatch[1]), await readJson(request), actor) }, corsHeaders);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/my-reservations") {
        const user = requireUser(request);
        sendJson(response, 200, { data: service.listMyReservations(user, { status: url.searchParams.get("status") || "" }) }, corsHeaders);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/audit-logs") {
        const user = requireUser(request);
        sendJson(response, 200, { data: service.listAuditLogs(user, listFilters(url, {
          query: url.searchParams.get("q") || "", actorId: url.searchParams.get("actorId") || "",
          action: url.searchParams.get("action") || "", entityType: url.searchParams.get("entityType") || ""
        })) }, corsHeaders);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/audit-logs.csv") {
        const user = requireUser(request, { roles: ["developer", "admin"] });
        const rows = service.listAuditLogs(user, listFilters(url, {
          paginated: false, query: url.searchParams.get("q") || "", actorId: url.searchParams.get("actorId") || "",
          action: url.searchParams.get("action") || "", entityType: url.searchParams.get("entityType") || ""
        }));
        sendText(response, 200, auditCsv(rows), { ...corsHeaders, "Content-Disposition": `attachment; filename=operation-audit-${new Date().toISOString().slice(0, 10)}.csv` });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/room-reservations") {
        requireUser(request);
        sendJson(response, 200, { data: service.listRoomReservations(listFilters(url, { date: url.searchParams.get("date") || "", meetingRoomId: url.searchParams.get("meetingRoomId") || "" })) }, corsHeaders);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/room-reservations") {
        const user = requireUser(request);
        sendJson(response, 201, { data: service.createRoomReservation(await readJson(request), user) }, corsHeaders);
        return;
      }

      const cancellableRoomReservationMatch = url.pathname.match(/^\/api\/room-reservations\/([^/]+)\/cancel$/);
      if (request.method === "PATCH" && cancellableRoomReservationMatch) {
        const user = requireUser(request);
        sendJson(response, 200, { data: service.cancelRoomReservation(decodeURIComponent(cancellableRoomReservationMatch[1]), user) }, corsHeaders);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/users") {
        requireUser(request, { roles: ["developer", "admin"] });
        sendJson(response, 200, { data: service.listUsers() }, corsHeaders);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/users") {
        const actor = requireUser(request, { roles: ["developer", "admin"] });
        sendJson(response, 201, { data: service.createUser(await readJson(request), actor) }, corsHeaders);
        return;
      }

      const resetPasswordUserMatch = url.pathname.match(/^\/api\/users\/([^/]+)\/reset-password$/);
      if (request.method === "POST" && resetPasswordUserMatch) {
        const actor = requireUser(request, { roles: ["developer", "admin"] });
        sendJson(response, 200, { data: service.resetUserPassword(decodeURIComponent(resetPasswordUserMatch[1]), actor) }, corsHeaders);
        return;
      }

      const editableUserMatch = url.pathname.match(/^\/api\/users\/([^/]+)$/);
      if (request.method === "PATCH" && editableUserMatch) {
        const actor = requireUser(request, { roles: ["developer", "admin"] });
        sendJson(response, 200, { data: service.updateUser(decodeURIComponent(editableUserMatch[1]), await readJson(request), actor) }, corsHeaders);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/equipment") {
        requireUser(request);
        sendJson(response, 200, { data: service.listEquipment({ query: url.searchParams.get("q") || "", status: url.searchParams.get("status") || "" }) }, corsHeaders);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/equipment") {
        const actor = requireUser(request);
        sendJson(response, 201, { data: service.createEquipment(await readJson(request), actor) }, corsHeaders);
        return;
      }

      const equipmentMatch = url.pathname.match(/^\/api\/equipment\/([^/]+)$/);
      if (request.method === "PATCH" && equipmentMatch) {
        const actor = requireUser(request);
        sendJson(response, 200, { data: service.updateEquipment(decodeURIComponent(equipmentMatch[1]), await readJson(request), actor) }, corsHeaders);
        return;
      }

      if (request.method === "DELETE" && equipmentMatch) {
        const user = requireUser(request);
        const input = await readJson(request);
        const force = input.force === true || url.searchParams.get("force") === "true";
        if (force && !["admin", "developer"].includes(user.role)) {
          throw new AppError(403, "FORBIDDEN", "当前账号没有执行此操作的权限");
        }
        sendJson(response, 200, { data: service.removeEquipment(decodeURIComponent(equipmentMatch[1]), { force, expectedHistory: input.expectedHistory }, user) }, corsHeaders);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/maintenance-records") {
        requireUser(request);
        sendJson(response, 200, { data: service.listMaintenanceRecords(listFilters(url, { equipmentId: url.searchParams.get("equipmentId") || "", type: url.searchParams.get("type") || "" })) }, corsHeaders);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/maintenance-records") {
        const user = requireUser(request);
        sendJson(response, 201, { data: service.createMaintenanceRecord(await readJson(request), user) }, corsHeaders);
        return;
      }

      const maintenanceRecordMatch = url.pathname.match(/^\/api\/maintenance-records\/([^/]+)$/);
      if (request.method === "PATCH" && maintenanceRecordMatch) {
        const actor = requireUser(request);
        sendJson(response, 200, { data: service.updateMaintenanceRecordStatus(decodeURIComponent(maintenanceRecordMatch[1]), await readJson(request), actor) }, corsHeaders);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/procurement-records") {
        requireUser(request);
        sendJson(response, 200, { data: service.listProcurementRecords(listFilters(url, { equipmentId: url.searchParams.get("equipmentId") || "" })) }, corsHeaders);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/procurement-records") {
        const user = requireUser(request);
        sendJson(response, 201, { data: service.createProcurementRecord(await readJson(request), user) }, corsHeaders);
        return;
      }

      const procurementRecordMatch = url.pathname.match(/^\/api\/procurement-records\/([^/]+)$/);
      if (request.method === "PATCH" && procurementRecordMatch) {
        const actor = requireUser(request);
        sendJson(response, 200, { data: service.updateProcurementRecordStatus(decodeURIComponent(procurementRecordMatch[1]), await readJson(request), actor) }, corsHeaders);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/reservations") {
        requireUser(request);
        sendJson(response, 200, { data: service.listReservations(listFilters(url, { date: url.searchParams.get("date") || "", equipmentId: url.searchParams.get("equipmentId") || "" })) }, corsHeaders);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/reservations") {
        const user = requireUser(request);
        sendJson(response, 201, { data: service.createReservation(await readJson(request), user) }, corsHeaders);
        return;
      }

      const cancellableReservationMatch = url.pathname.match(/^\/api\/reservations\/([^/]+)\/cancel$/);
      if (request.method === "PATCH" && cancellableReservationMatch) {
        const user = requireUser(request);
        sendJson(response, 200, { data: service.cancelReservation(decodeURIComponent(cancellableReservationMatch[1]), user) }, corsHeaders);
        return;
      }

      sendJson(response, 404, { error: { code: "NOT_FOUND", message: "接口不存在" } }, corsHeaders);
    } catch (error) {
      const appError = error instanceof AppError ? error : new AppError(500, "INTERNAL_ERROR", "服务器处理请求时发生错误");
      if (!(error instanceof AppError)) console.error(error);
      if (!response.headersSent) sendJson(response, appError.status, { error: { code: appError.code, message: appError.message, details: appError.details } }, corsHeaders);
      else response.end();
    }
  });
}

function resolveAppVersion(fallback = "0.0.0") {
  try {
    const packageFile = resolve(process.cwd(), "package.json");
    return JSON.parse(readFileSync(packageFile, "utf8")).version || fallback;
  } catch {
    return fallback;
  }
}

export function startServer({
  dataFile = process.env.DATA_FILE ? resolve(process.env.DATA_FILE) : defaultDataFile,
  port = Number(process.env.API_PORT || 4000),
  seedUsers = process.env.SEED_DEMO_USERS === "true" || process.env.NODE_ENV !== "production"
} = {}) {
  const database = createDatabase(dataFile, { seedReferenceData: true, seedUsers });
  const service = createService(database);
  const updateManager = process.env.UPDATE_ENABLED === "true" ? createUpdateManager({
    repository: process.env.UPDATE_REPOSITORY,
    currentVersion: resolveAppVersion(process.env.APP_VERSION || "1.4.5"),
    requestFile: process.env.UPDATE_REQUEST_FILE || "/var/lib/cipc-labequip/data/upgrade/request.json",
    statusFile: process.env.UPDATE_STATUS_FILE || "/var/lib/cipc-labequip/data/upgrade/status.json"
  }) : null;
  const allowedOrigins = new Set((process.env.CORS_ORIGINS || defaultOrigins).split(",").map((item) => item.trim()).filter(Boolean));
  const server = createApp(service, {
    allowedOrigins,
    secureCookie: resolveCookieSecure(),
    trustProxy: process.env.TRUST_PROXY === "true",
    updateManager
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`Laboratory Resource Hub API: http://localhost:${port}`);
    console.log(`SQLite data: ${dataFile}`);
  });

  function shutdown() {
    server.close(() => {
      database.close();
      process.exit(0);
    });
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return { server, database, service };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer();
