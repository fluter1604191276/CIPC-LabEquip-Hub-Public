import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { hashPassword, INITIAL_PASSWORD } from "./database.mjs";

const equipmentStatuses = new Set(["available", "maintenance", "disabled", "retired"]);
const editableEquipmentFields = new Set(["name", "code", "metric", "laboratoryId", "owner", "status"]);
const creatableUserRoles = new Set(["admin", "member"]);
const maintenanceTypes = new Set(["repair", "maintenance"]);
const maintenanceStatuses = new Set(["open", "in_progress", "completed"]);
const procurementStatuses = new Set(["pending", "accepted", "rejected"]);
const auditEntityTypes = new Set(["equipment", "reservation", "room_reservation", "maintenance_record", "procurement_record", "user", "meeting_room", "system"]);
const statusLabels = {
  available: "可用",
  maintenance: "维修中",
  disabled: "已停用",
  retired: "已报废"
};
const sessionLifetimeMs = 12 * 60 * 60 * 1000;
const deriveKey = promisify(scrypt);
const invalidAccountPassword = hashPassword("invalid-account-password", "fixed-invalid-account-salt");

export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function requiredText(value, field, maxLength = 200) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new AppError(400, "VALIDATION_ERROR", `${field}不能为空`);
  if (normalized.length > maxLength) throw new AppError(400, "VALIDATION_ERROR", `${field}不能超过 ${maxLength} 个字符`);
  return normalized;
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

async function verifyPassword(password, row) {
  if (typeof password !== "string") return false;
  const candidate = await deriveKey(password, row.password_salt, 64);
  const stored = Buffer.from(row.password_hash, "hex");
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

function validCalendarDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function requiredDate(value, field) {
  const date = requiredText(value, field, 10);
  if (!validCalendarDate(date)) {
    throw new AppError(400, "INVALID_RECORD_DATE", `${field}不是有效的日历日期`);
  }
  return date;
}

function requiredNonNegativeAmount(value, field) {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new AppError(400, "VALIDATION_ERROR", `${field}需要是大于或等于 0 的数字`);
  }
  return amount;
}

function requiredEnum(value, field, values) {
  const normalized = requiredText(value, field, 40);
  if (!values.has(normalized)) throw new AppError(400, "VALIDATION_ERROR", `${field}无效`);
  return normalized;
}

function optionalDate(value, field) {
  if (value === undefined || value === null || value === "") return "";
  return requiredDate(value, field);
}

function shanghaiDateBoundary(date, nextDay = false) {
  const boundary = new Date(`${date}T00:00:00+08:00`);
  if (nextDay) boundary.setUTCDate(boundary.getUTCDate() + 1);
  return boundary.toISOString();
}

function likePattern(value) {
  return `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

function paginationOptions({ page = 1, pageSize = 20, paginated = false } = {}) {
  if (!paginated) return { page: 1, pageSize: -1, offset: 0 };
  const normalizedPage = Number(page);
  const normalizedPageSize = Number(pageSize);
  if (!Number.isSafeInteger(normalizedPage) || normalizedPage < 1) {
    throw new AppError(400, "VALIDATION_ERROR", "页码需要是正整数");
  }
  if (!Number.isSafeInteger(normalizedPageSize) || normalizedPageSize < 1 || normalizedPageSize > 100) {
    throw new AppError(400, "VALIDATION_ERROR", "每页数量需要在 1 到 100 之间");
  }
  return { page: normalizedPage, pageSize: normalizedPageSize, offset: (normalizedPage - 1) * normalizedPageSize };
}

function paginatedResult(items, total, { page, pageSize }) {
  return {
    items,
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
  };
}

function listResult(items, total, options, filters) {
  return filters.paginated ? paginatedResult(items, total, options) : items;
}

function todayInShanghai() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function validateNewPassword(password) {
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    throw new AppError(400, "WEAK_PASSWORD", "新密码长度需要为 8-128 个字符");
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new AppError(400, "WEAK_PASSWORD", "新密码需要同时包含字母和数字");
  }
  if (password === "123456") throw new AppError(400, "WEAK_PASSWORD", "新密码不能继续使用初始密码");
}

function normalizeUsername(value) {
  const username = requiredText(value, "用户名", 40).toLowerCase();
  if (!/^[a-z][a-z0-9]{1,39}$/.test(username)) {
    throw new AppError(400, "INVALID_USERNAME", "用户名需以小写字母开头，只能包含小写字母和数字，长度为 2-40 位");
  }
  return username;
}

function assertManagerCanAccessUser(actor, target) {
  if (!actor || !["developer", "admin"].includes(actor.role)) {
    throw new AppError(403, "FORBIDDEN", "当前账号没有管理成员的权限");
  }
  if (actor.role === "admin" && target.role === "developer") {
    throw new AppError(403, "DEVELOPER_ACCOUNT_PROTECTED", "系统管理员不能修改开发者账号");
  }
}

function mapLaboratory(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    alias: row.alias,
    label: `${row.name} - ${row.alias}`,
    active: Boolean(row.is_active)
  };
}

function mapUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    laboratoryId: row.laboratory_id || null,
    laboratoryName: row.laboratory_name || null,
    mustChangePassword: Boolean(row.must_change_password),
    active: Boolean(row.is_active),
    lastLoginAt: row.last_login_at || null,
    passwordChangedAt: row.password_changed_at || null
  };
}

function mapEquipment(row) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    metric: row.metric,
    lab: row.lab,
    location: row.location,
    owner: row.owner,
    status: row.status,
    label: statusLabels[row.status],
    icon: row.icon,
    thumb: row.thumb,
    updated: "刚刚",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function effectiveReservationStatus(row, now = Date.now()) {
  if (row.status === "cancelled") return "cancelled";
  const startAt = Date.parse(row.start_at);
  const endAt = Date.parse(row.end_at);
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) return row.status;
  if (endAt <= now) return "completed";
  if (startAt <= now) return "in_use";
  return "approved";
}

function mapReservation(row) {
  return {
    id: row.id,
    equipmentId: row.equipment_id,
    equipmentName: row.equipment_name,
    equipmentCode: row.equipment_code,
    date: row.reservation_date,
    start: row.start_time,
    end: row.end_time,
    startAt: row.start_at,
    endAt: row.end_at,
    people: row.people,
    purpose: row.purpose,
    requesterName: row.requester_name,
    requesterLab: row.requester_lab,
    requesterUserId: row.requester_user_id || null,
    status: effectiveReservationStatus(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapMeetingRoom(row) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    capacity: row.capacity,
    location: row.location,
    active: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapRoomReservation(row) {
  return {
    id: row.id,
    meetingRoomId: row.meeting_room_id,
    meetingRoomName: row.meeting_room_name,
    meetingRoomCode: row.meeting_room_code,
    date: row.reservation_date,
    start: row.start_time,
    end: row.end_time,
    startAt: row.start_at,
    endAt: row.end_at,
    people: row.people,
    purpose: row.purpose,
    requesterName: row.requester_name,
    requesterLab: row.requester_lab,
    requesterUserId: row.requester_user_id || null,
    status: effectiveReservationStatus(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapMaintenanceRecord(row) {
  return {
    id: row.id,
    equipmentId: row.equipment_id,
    equipmentName: row.equipment_name,
    equipmentCode: row.equipment_code,
    equipmentStatus: row.equipment_status,
    type: row.type,
    status: row.status,
    date: row.record_date,
    description: row.description,
    cost: row.cost,
    createdByUserId: row.created_by_user_id || null,
    createdByName: row.created_by_name || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapProcurementRecord(row) {
  return {
    id: row.id,
    equipmentId: row.equipment_id || null,
    equipmentName: row.equipment_name || null,
    equipmentCode: row.equipment_code || null,
    vendor: row.vendor,
    date: row.procurement_date,
    amount: row.amount,
    status: row.status,
    notes: row.notes,
    createdByUserId: row.created_by_user_id || null,
    createdByName: row.created_by_name || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function sanitizeAuditSummary(value) {
  if (Array.isArray(value)) return value.map(sanitizeAuditSummary);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/password|token|salt|hash/i.test(key))
    .map(([key, item]) => [key, sanitizeAuditSummary(item)]));
}

function mapAuditLog(row) {
  return {
    id: row.id,
    actorUserId: row.actor_user_id || null,
    actorDisplayName: row.actor_display_name,
    actorUsername: row.actor_username,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    summary: JSON.parse(row.summary_json),
    createdAt: row.created_at
  };
}

export function createService(database) {
  const userSelect = `
    SELECT u.*, l.name AS laboratory_name
    FROM users u
    LEFT JOIN laboratories l ON l.id = u.laboratory_id
  `;
  const reservationSelect = `
    SELECT r.*, e.name AS equipment_name, e.code AS equipment_code
    FROM reservations r
    JOIN equipment e ON e.id = r.equipment_id
  `;
  const roomReservationSelect = `
    SELECT r.*, m.name AS meeting_room_name, m.code AS meeting_room_code
    FROM room_reservations r
    JOIN meeting_rooms m ON m.id = r.meeting_room_id
  `;
  const maintenanceRecordSelect = `
    SELECT m.*, e.name AS equipment_name, e.code AS equipment_code, e.status AS equipment_status, u.display_name AS created_by_name
    FROM maintenance_records m
    JOIN equipment e ON e.id = m.equipment_id
    LEFT JOIN users u ON u.id = m.created_by_user_id
  `;
  const procurementRecordSelect = `
    SELECT p.*, e.name AS equipment_name, e.code AS equipment_code, u.display_name AS created_by_name
    FROM procurement_records p
    LEFT JOIN equipment e ON e.id = p.equipment_id
    LEFT JOIN users u ON u.id = p.created_by_user_id
  `;
  const writeAudit = ({ actor, entityType, entityId, action, summary = {} }) => {
    const safeSummary = sanitizeAuditSummary(summary);
    database.prepare(`
      INSERT INTO audit_logs (
        id, actor_user_id, actor_display_name, actor_username, entity_type, entity_id, action, summary_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), actor?.id || null, actor?.displayName || "", actor?.username || "",
      entityType, entityId, action, JSON.stringify(safeSummary), new Date().toISOString()
    );
  };
  const transaction = (operation) => {
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  };

  return {
    livenessCheck() {
      const checkedAt = new Date().toISOString();
      try {
        database.prepare("SELECT 1 AS ok").get();
        return { status: "ok", checkedAt };
      } catch {
        return { status: "degraded", error: "database_unavailable", checkedAt };
      }
    },

    recordSystemEvent(action, summary = {}) {
      const normalizedAction = requiredText(action, "系统事件", 100);
      return writeAudit({ actor: { id: null, displayName: "系统", username: "system" }, entityType: "system", entityId: randomUUID(), action: normalizedAction, summary });
    },

    async authenticate(username, password) {
      const normalized = requiredText(username, "用户名", 80).toLowerCase();
      const row = database.prepare(`${userSelect} WHERE u.username = ?`).get(normalized);
      const passwordMatches = await verifyPassword(password, row || {
        password_hash: invalidAccountPassword.hash,
        password_salt: invalidAccountPassword.salt
      });
      if (!row || !row.is_active || !passwordMatches) {
        throw new AppError(401, "INVALID_CREDENTIALS", "用户名或密码错误");
      }
      const now = new Date().toISOString();
      database.prepare("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?").run(now, now, row.id);
      return mapUser({ ...row, last_login_at: now });
    },

    createSession(userId) {
      const token = randomBytes(32).toString("base64url");
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + sessionLifetimeMs);
      database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(createdAt.toISOString());
      database.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
        .run(tokenHash(token), userId, expiresAt.toISOString(), createdAt.toISOString());
      return { token, expiresAt: expiresAt.toISOString() };
    },

    getSessionUser(token) {
      if (!token) throw new AppError(401, "AUTH_REQUIRED", "请先登录");
      const now = new Date().toISOString();
      const row = database.prepare(`${userSelect}
        JOIN sessions s ON s.user_id = u.id
        WHERE s.token_hash = ? AND s.expires_at > ?
      `).get(tokenHash(token), now);
      if (!row || !row.is_active) throw new AppError(401, "SESSION_EXPIRED", "登录状态已失效，请重新登录");
      return mapUser(row);
    },

    deleteSession(token) {
      if (token) database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
    },

    async changePassword(userId, currentPassword, newPassword, actor) {
      const row = database.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      if (!row || !row.is_active) throw new AppError(401, "AUTH_REQUIRED", "账号不可用");
      if (!(await verifyPassword(currentPassword, row))) throw new AppError(400, "CURRENT_PASSWORD_INVALID", "当前密码错误");
      validateNewPassword(newPassword);
      if (await verifyPassword(newPassword, row)) throw new AppError(400, "PASSWORD_UNCHANGED", "新密码不能与当前密码相同");
      const next = hashPassword(newPassword);
      const now = new Date().toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        database.prepare(`
          UPDATE users
          SET password_hash = ?, password_salt = ?, must_change_password = 0,
              password_changed_at = ?, updated_at = ?
          WHERE id = ?
        `).run(next.hash, next.salt, now, now, userId);
        database.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
        writeAudit({
          actor: actor || mapUser(database.prepare(`${userSelect} WHERE u.id = ?`).get(userId)),
          entityType: "user", entityId: userId, action: "user.password_change",
          summary: { userId }
        });
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      return mapUser(database.prepare(`${userSelect} WHERE u.id = ?`).get(userId));
    },

    listLaboratories() {
      return database.prepare("SELECT * FROM laboratories WHERE is_active = 1 ORDER BY sort_order, code").all().map(mapLaboratory);
    },

    listUsers() {
      return database.prepare(`${userSelect} ORDER BY CASE u.role WHEN 'developer' THEN 0 ELSE 1 END, u.display_name`).all().map(mapUser);
    },

    listAuditLogs(actor, filters = {}) {
      if (!actor?.id) throw new AppError(401, "AUTH_REQUIRED", "请先登录");
      const isManager = ["admin", "developer"].includes(actor.role);
      const { page, pageSize, offset } = paginationOptions(filters);
      const query = typeof filters.query === "string" ? filters.query.trim().slice(0, 200) : "";
      const actorId = typeof filters.actorId === "string" ? filters.actorId.trim() : "";
      const action = typeof filters.action === "string" ? filters.action.trim().slice(0, 100) : "";
      const entityType = typeof filters.entityType === "string" ? filters.entityType.trim() : "";
      if (entityType && !auditEntityTypes.has(entityType)) throw new AppError(400, "VALIDATION_ERROR", "审计对象类型无效");
      const dateFrom = optionalDate(filters.dateFrom, "开始日期");
      const dateTo = optionalDate(filters.dateTo, "结束日期");
      if (dateFrom && dateTo && dateFrom > dateTo) throw new AppError(400, "VALIDATION_ERROR", "开始日期不能晚于结束日期");
      const clauses = [];
      const values = [];
      if (!isManager) { clauses.push("actor_user_id = ?"); values.push(actor.id); }
      else if (actorId) { clauses.push("actor_user_id = ?"); values.push(actorId); }
      if (action) { clauses.push("action = ?"); values.push(action); }
      if (entityType) { clauses.push("entity_type = ?"); values.push(entityType); }
      if (dateFrom) { clauses.push("created_at >= ?"); values.push(shanghaiDateBoundary(dateFrom)); }
      if (dateTo) { clauses.push("created_at < ?"); values.push(shanghaiDateBoundary(dateTo, true)); }
      if (query) {
        clauses.push("(actor_display_name LIKE ? ESCAPE '\\' OR actor_username LIKE ? ESCAPE '\\' OR action LIKE ? ESCAPE '\\' OR entity_id LIKE ? ESCAPE '\\' OR summary_json LIKE ? ESCAPE '\\')");
        const pattern = likePattern(query);
        values.push(pattern, pattern, pattern, pattern, pattern);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const total = database.prepare(`SELECT COUNT(*) AS count FROM audit_logs ${where}`).get(...values).count;
      const rows = database.prepare(`SELECT * FROM audit_logs ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(...values, pageSize, offset);
      return listResult(rows.map(mapAuditLog), total, { page, pageSize }, filters);
    },

    createUser(input, actor) {
      const username = normalizeUsername(input.username);
      const displayName = requiredText(input.displayName, "姓名", 50);
      const role = requiredText(input.role, "角色", 20);
      if (!creatableUserRoles.has(role)) throw new AppError(400, "INVALID_ROLE", "成员角色无效");

      const laboratoryId = typeof input.laboratoryId === "string" && input.laboratoryId.trim() ? input.laboratoryId.trim() : null;
      if (laboratoryId) {
        const laboratory = database.prepare("SELECT id FROM laboratories WHERE id = ? AND is_active = 1").get(laboratoryId);
        if (!laboratory) throw new AppError(400, "LABORATORY_NOT_FOUND", "所选实验室不存在或未启用");
      }

      const id = randomUUID();
      const now = new Date().toISOString();
      const password = hashPassword(INITIAL_PASSWORD);
      try {
        return transaction(() => {
          database.prepare(`
          INSERT INTO users (
            id, username, display_name, role, laboratory_id, password_hash, password_salt,
            must_change_password, is_active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
          `).run(id, username, displayName, role, laboratoryId, password.hash, password.salt, now, now);
          writeAudit({ actor, entityType: "user", entityId: id, action: "user.create", summary: { username, displayName, role, laboratoryId } });
          return mapUser(database.prepare(`${userSelect} WHERE u.id = ?`).get(id));
        });
      } catch (error) {
        if (String(error.message).includes("UNIQUE constraint failed: users.username")) {
          throw new AppError(409, "USERNAME_EXISTS", "用户名已存在，请使用其他用户名");
        }
        throw error;
      }
    },

    updateUser(userId, input, actor) {
      const target = database.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      if (!target) throw new AppError(404, "USER_NOT_FOUND", "没有找到对应成员账号");
      assertManagerCanAccessUser(actor, target);

      const username = normalizeUsername(input.username);
      const displayName = requiredText(input.displayName, "姓名", 50);
      const role = requiredText(input.role, "角色", 20);
      if (target.role === "developer" && role !== "developer") {
        throw new AppError(400, "DEVELOPER_ROLE_IMMUTABLE", "开发者账号的角色不能修改");
      }
      if (target.role !== "developer" && !creatableUserRoles.has(role)) {
        throw new AppError(400, "INVALID_ROLE", "成员角色无效");
      }
      if (actor.id === target.id && role !== target.role) {
        throw new AppError(400, "SELF_ROLE_CHANGE_FORBIDDEN", "不能修改自己的权限等级");
      }

      const laboratoryId = typeof input.laboratoryId === "string" && input.laboratoryId.trim() ? input.laboratoryId.trim() : null;
      if (laboratoryId) {
        const laboratory = database.prepare("SELECT id FROM laboratories WHERE id = ? AND is_active = 1").get(laboratoryId);
        if (!laboratory) throw new AppError(400, "LABORATORY_NOT_FOUND", "所选实验室不存在或未启用");
      }

      const now = new Date().toISOString();
      try {
        return transaction(() => {
          database.prepare(`
          UPDATE users
          SET username = ?, display_name = ?, role = ?, laboratory_id = ?, updated_at = ?
          WHERE id = ?
          `).run(username, displayName, role, laboratoryId, now, target.id);
          writeAudit({
            actor, entityType: "user", entityId: target.id, action: "user.update",
            summary: {
              before: { username: target.username, displayName: target.display_name, role: target.role, laboratoryId: target.laboratory_id || null },
              after: { username, displayName, role, laboratoryId }
            }
          });
          return mapUser(database.prepare(`${userSelect} WHERE u.id = ?`).get(target.id));
        });
      } catch (error) {
        if (String(error.message).includes("UNIQUE constraint failed: users.username")) {
          throw new AppError(409, "USERNAME_EXISTS", "用户名已存在，请使用其他用户名");
        }
        throw error;
      }
    },

    resetUserPassword(userId, actor) {
      const target = database.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      if (!target) throw new AppError(404, "USER_NOT_FOUND", "没有找到对应成员账号");
      assertManagerCanAccessUser(actor, target);
      if (actor.id === target.id) {
        throw new AppError(400, "SELF_PASSWORD_RESET_FORBIDDEN", "不能重置自己的密码，请使用修改密码功能");
      }

      const temporaryPassword = `T${randomBytes(8).toString("base64url")}9`;
      const password = hashPassword(temporaryPassword);
      const now = new Date().toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        database.prepare(`
          UPDATE users
          SET password_hash = ?, password_salt = ?, must_change_password = 1,
              password_changed_at = NULL, updated_at = ?
          WHERE id = ?
        `).run(password.hash, password.salt, now, target.id);
        database.prepare("DELETE FROM sessions WHERE user_id = ?").run(target.id);
        writeAudit({ actor, entityType: "user", entityId: target.id, action: "user.password_reset", summary: { userId: target.id, username: target.username } });
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      return {
        user: mapUser(database.prepare(`${userSelect} WHERE u.id = ?`).get(target.id)),
        temporaryPassword
      };
    },

    listEquipment({ query = "", status = "" } = {}) {
      const clauses = [];
      const values = [];
      const normalizedQuery = typeof query === "string" ? query.trim().slice(0, 200) : "";
      if (normalizedQuery) {
        clauses.push("(name LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\' OR lab LIKE ? ESCAPE '\\' OR owner LIKE ? ESCAPE '\\' OR metric LIKE ? ESCAPE '\\')");
        const wildcard = likePattern(normalizedQuery);
        values.push(wildcard, wildcard, wildcard, wildcard, wildcard);
      }
      if (status) {
        if (!equipmentStatuses.has(status)) throw new AppError(400, "VALIDATION_ERROR", "设备状态无效");
        clauses.push("status = ?");
        values.push(status);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      return database.prepare(`SELECT * FROM equipment ${where} ORDER BY created_at, code`).all(...values).map(mapEquipment);
    },

    getEquipment(id) {
      const row = database.prepare("SELECT * FROM equipment WHERE id = ?").get(id);
      if (!row) throw new AppError(404, "EQUIPMENT_NOT_FOUND", "没有找到对应设备");
      return mapEquipment(row);
    },

    createEquipment(input, actor) {
      const now = new Date().toISOString();
      const status = input.status || "available";
      if (!equipmentStatuses.has(status)) throw new AppError(400, "VALIDATION_ERROR", "设备状态无效");
      const item = {
        id: randomUUID(),
        name: requiredText(input.name, "设备名称"),
        code: requiredText(input.code, "资产编号", 80).toUpperCase(),
        metric: requiredText(input.metric, "性能指标", 500),
        lab: requiredText(input.lab, "所在实验室"),
        location: requiredText(input.location || input.lab, "所在实验室", 200),
        owner: requiredText(input.owner, "设备保管人"),
        status,
        icon: typeof input.icon === "string" && input.icon ? input.icon.slice(0, 4) : "◇",
        thumb: typeof input.thumb === "string" && input.thumb ? input.thumb : "thumb-orange"
      };
      try {
        return transaction(() => {
          database.prepare(`
          INSERT INTO equipment (id, name, code, metric, lab, location, owner, status, icon, thumb, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(item.id, item.name, item.code, item.metric, item.lab, item.location, item.owner, item.status, item.icon, item.thumb, now, now);
          writeAudit({ actor, entityType: "equipment", entityId: item.id, action: "equipment.create", summary: { name: item.name, code: item.code, lab: item.lab, owner: item.owner, status: item.status } });
          return this.getEquipment(item.id);
        });
      } catch (error) {
        if (String(error.message).includes("UNIQUE constraint failed: equipment.code")) {
          throw new AppError(409, "EQUIPMENT_CODE_EXISTS", "资产编号已存在，请检查后重试");
        }
        throw error;
      }
    },

    updateEquipment(id, input = {}, actor) {
      const equipmentId = requiredText(id, "设备");
      const update = input && typeof input === "object" ? input : {};
      const fields = Object.keys(update).filter((field) => editableEquipmentFields.has(field));
      if (!fields.length) throw new AppError(400, "VALIDATION_ERROR", "至少需要提供一项可编辑的设备信息");

      const existing = database.prepare("SELECT * FROM equipment WHERE id = ?").get(equipmentId);
      if (!existing) throw new AppError(404, "EQUIPMENT_NOT_FOUND", "没有找到对应设备");

      const item = {
        name: fields.includes("name") ? requiredText(update.name, "设备名称") : existing.name,
        code: fields.includes("code") ? requiredText(update.code, "资产编号", 80).toUpperCase() : existing.code,
        metric: fields.includes("metric") ? requiredText(update.metric, "性能指标", 500) : existing.metric,
        lab: existing.lab,
        location: existing.location,
        owner: fields.includes("owner") ? requiredText(update.owner, "设备保管人") : existing.owner,
        status: fields.includes("status") ? requiredEnum(update.status, "设备状态", equipmentStatuses) : existing.status
      };
      if (fields.includes("laboratoryId")) {
        const laboratoryId = requiredText(update.laboratoryId, "所在实验室");
        const laboratory = database.prepare("SELECT name FROM laboratories WHERE id = ? AND is_active = 1").get(laboratoryId);
        if (!laboratory) throw new AppError(400, "LABORATORY_NOT_FOUND", "所选实验室不存在或未启用");
        item.lab = laboratory.name;
        item.location = laboratory.name;
      }

      if (item.status === "available") {
        const activeMaintenance = database.prepare(`
          SELECT COUNT(*) AS count FROM maintenance_records
          WHERE equipment_id = ? AND status IN ('open', 'in_progress')
        `).get(equipmentId).count;
        if (activeMaintenance) {
          throw new AppError(409, "EQUIPMENT_HAS_ACTIVE_MAINTENANCE", "设备仍有未完成的维修保养记录，请先完成相关记录");
        }
      }
      try {
        return transaction(() => {
          database.prepare(`
          UPDATE equipment
          SET name = ?, code = ?, metric = ?, lab = ?, location = ?, owner = ?, status = ?, updated_at = ?
          WHERE id = ?
          `).run(item.name, item.code, item.metric, item.lab, item.location, item.owner, item.status, new Date().toISOString(), equipmentId);
          writeAudit({
            actor, entityType: "equipment", entityId: equipmentId, action: "equipment.update",
            summary: {
              before: { name: existing.name, code: existing.code, metric: existing.metric, lab: existing.lab, owner: existing.owner, status: existing.status },
              after: { name: item.name, code: item.code, metric: item.metric, lab: item.lab, owner: item.owner, status: item.status }
            }
          });
          return this.getEquipment(equipmentId);
        });
      } catch (error) {
        if (String(error.message).includes("equipment_has_active_maintenance")) {
          throw new AppError(409, "EQUIPMENT_HAS_ACTIVE_MAINTENANCE", "设备仍有未完成的维修保养记录，请先完成相关记录");
        }
        if (String(error.message).includes("UNIQUE constraint failed: equipment.code")) {
          throw new AppError(409, "EQUIPMENT_CODE_EXISTS", "资产编号已存在，请检查后重试");
        }
        throw error;
      }
    },

    updateEquipmentStatus(id, input = {}, actor) {
      return this.updateEquipment(id, input, actor);
    },

    removeEquipment(id, { force = false, expectedHistory } = {}, actor) {
      const equipmentId = requiredText(id, "设备");
      const shouldForce = force === true;
      database.exec("BEGIN IMMEDIATE");
      try {
        const item = database.prepare("SELECT * FROM equipment WHERE id = ?").get(equipmentId);
        if (!item) throw new AppError(404, "EQUIPMENT_NOT_FOUND", "没有找到对应设备");

        const history = database.prepare(`
          SELECT
            (SELECT COUNT(*) FROM reservations WHERE equipment_id = ?) AS reservations,
            (SELECT COUNT(*) FROM maintenance_records WHERE equipment_id = ?) AS maintenance,
            (SELECT COUNT(*) FROM procurement_records WHERE equipment_id = ?) AS procurement
        `).get(equipmentId, equipmentId, equipmentId);
        if (history.reservations || history.maintenance || history.procurement) {
          if (!shouldForce) {
            throw new AppError(409, "EQUIPMENT_HAS_HISTORY", "该设备已有预约或业务记录，需保留设备档案", history);
          }
        }
        const historyMatches = expectedHistory
          && typeof expectedHistory === "object"
          && !Array.isArray(expectedHistory)
          && ["reservations", "maintenance", "procurement"].every((field) => (
            Object.hasOwn(expectedHistory, field) && expectedHistory[field] === history[field]
          ));
        if (shouldForce && !historyMatches) {
          throw new AppError(409, "EQUIPMENT_HISTORY_CHANGED", "设备关联记录已变化，请重新确认后再删除", history);
        }

        const deleted = {
          reservations: database.prepare("DELETE FROM reservations WHERE equipment_id = ?").run(equipmentId).changes,
          maintenance: database.prepare("DELETE FROM maintenance_records WHERE equipment_id = ?").run(equipmentId).changes,
          procurement: database.prepare("DELETE FROM procurement_records WHERE equipment_id = ?").run(equipmentId).changes
        };
        database.prepare("DELETE FROM equipment WHERE id = ?").run(equipmentId);
        writeAudit({
          actor, entityType: "equipment", entityId: equipmentId,
          action: shouldForce ? "equipment.force_delete" : "equipment.delete",
          summary: { equipment: { name: item.name, code: item.code, lab: item.lab, owner: item.owner }, deleted }
        });
        database.exec("COMMIT");
        if (shouldForce) return { id: equipmentId, removed: true, forced: true, deleted };
        return { id: equipmentId, removed: true };
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },

    listMaintenanceRecords(filters = {}) {
      const clauses = [];
      const values = [];
      const { page, pageSize, offset } = paginationOptions(filters);
      const { equipmentId = "", status = "", type = "", dateFrom = "", dateTo = "" } = filters;
      if (equipmentId) {
        clauses.push("m.equipment_id = ?");
        values.push(equipmentId);
      }
      if (status) { clauses.push("m.status = ?"); values.push(requiredEnum(status, "记录状态", maintenanceStatuses)); }
      if (type) { clauses.push("m.type = ?"); values.push(requiredEnum(type, "记录类型", maintenanceTypes)); }
      const start = optionalDate(dateFrom, "开始日期");
      const end = optionalDate(dateTo, "结束日期");
      if (start && end && start > end) throw new AppError(400, "VALIDATION_ERROR", "开始日期不能晚于结束日期");
      if (start) { clauses.push("m.record_date >= ?"); values.push(start); }
      if (end) { clauses.push("m.record_date <= ?"); values.push(end); }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const total = database.prepare(`SELECT COUNT(*) AS count FROM maintenance_records m ${where}`).get(...values).count;
      const items = database.prepare(`${maintenanceRecordSelect} ${where} ORDER BY m.record_date DESC, m.created_at DESC, m.id DESC LIMIT ? OFFSET ?`).all(...values, pageSize, offset).map(mapMaintenanceRecord);
      return listResult(items, total, { page, pageSize }, filters);
    },

    createMaintenanceRecord(input, actor = {}) {
      const equipmentId = requiredText(input.equipmentId, "设备");
      if (!database.prepare("SELECT id FROM equipment WHERE id = ?").get(equipmentId)) {
        throw new AppError(404, "EQUIPMENT_NOT_FOUND", "没有找到对应设备");
      }
      const now = new Date().toISOString();
      const id = randomUUID();
      const record = {
        type: requiredEnum(input.type, "记录类型", maintenanceTypes),
        status: requiredEnum(input.status, "记录状态", maintenanceStatuses),
        date: requiredDate(input.date, "记录日期"),
        description: requiredText(input.description, "维修保养说明", 2000),
        cost: requiredNonNegativeAmount(input.cost ?? 0, "维修保养费用")
      };
      return transaction(() => {
        database.prepare(`
          INSERT INTO maintenance_records (
            id, equipment_id, type, status, record_date, description, cost, created_by_user_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, equipmentId, record.type, record.status, record.date, record.description, record.cost, actor.id || null, now, now);
        writeAudit({ actor, entityType: "maintenance_record", entityId: id, action: "maintenance.create", summary: { equipmentId, ...record } });
        return mapMaintenanceRecord(database.prepare(`${maintenanceRecordSelect} WHERE m.id = ?`).get(id));
      });
    },

    updateMaintenanceRecordStatus(id, input = {}, actor) {
      const recordId = requiredText(id, "维修保养记录");
      const status = requiredEnum(input.status, "记录状态", maintenanceStatuses);
      return transaction(() => {
        const existing = database.prepare(`${maintenanceRecordSelect} WHERE m.id = ?`).get(recordId);
        if (!existing) throw new AppError(404, "MAINTENANCE_RECORD_NOT_FOUND", "没有找到对应维修保养记录");
        database.prepare("UPDATE maintenance_records SET status = ?, updated_at = ? WHERE id = ?")
          .run(status, new Date().toISOString(), recordId);
        writeAudit({ actor, entityType: "maintenance_record", entityId: recordId, action: "maintenance.status_update", summary: { equipmentId: existing.equipment_id, beforeStatus: existing.status, afterStatus: status } });
        return mapMaintenanceRecord(database.prepare(`${maintenanceRecordSelect} WHERE m.id = ?`).get(recordId));
      });
    },

    listProcurementRecords(filters = {}) {
      const clauses = [];
      const values = [];
      const { page, pageSize, offset } = paginationOptions(filters);
      const { equipmentId = "", status = "", dateFrom = "", dateTo = "" } = filters;
      if (equipmentId) {
        clauses.push("p.equipment_id = ?");
        values.push(equipmentId);
      }
      if (status) { clauses.push("p.status = ?"); values.push(requiredEnum(status, "采购状态", procurementStatuses)); }
      const start = optionalDate(dateFrom, "开始日期");
      const end = optionalDate(dateTo, "结束日期");
      if (start && end && start > end) throw new AppError(400, "VALIDATION_ERROR", "开始日期不能晚于结束日期");
      if (start) { clauses.push("p.procurement_date >= ?"); values.push(start); }
      if (end) { clauses.push("p.procurement_date <= ?"); values.push(end); }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const total = database.prepare(`SELECT COUNT(*) AS count FROM procurement_records p ${where}`).get(...values).count;
      const items = database.prepare(`${procurementRecordSelect} ${where} ORDER BY p.procurement_date DESC, p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`).all(...values, pageSize, offset).map(mapProcurementRecord);
      return listResult(items, total, { page, pageSize }, filters);
    },

    createProcurementRecord(input, actor = {}) {
      const equipmentId = requiredText(input.equipmentId, "设备");
      if (!database.prepare("SELECT id FROM equipment WHERE id = ?").get(equipmentId)) {
        throw new AppError(404, "EQUIPMENT_NOT_FOUND", "没有找到对应设备");
      }
      const now = new Date().toISOString();
      const id = randomUUID();
      const record = {
        vendor: requiredText(input.vendor, "供应商", 200),
        date: requiredDate(input.date, "采购日期"),
        amount: requiredNonNegativeAmount(input.amount, "采购金额"),
        status: requiredEnum(input.status, "采购状态", procurementStatuses),
        notes: typeof input.notes === "string" ? input.notes.trim().slice(0, 2000) : ""
      };
      return transaction(() => {
        database.prepare(`
          INSERT INTO procurement_records (
            id, equipment_id, vendor, procurement_date, amount, status, notes, created_by_user_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, equipmentId, record.vendor, record.date, record.amount, record.status, record.notes, actor.id || null, now, now);
        writeAudit({ actor, entityType: "procurement_record", entityId: id, action: "procurement.create", summary: { equipmentId, ...record } });
        return mapProcurementRecord(database.prepare(`${procurementRecordSelect} WHERE p.id = ?`).get(id));
      });
    },

    updateProcurementRecordStatus(id, input = {}, actor) {
      const recordId = requiredText(id, "采购记录");
      const status = requiredEnum(input.status, "验收状态", procurementStatuses);
      return transaction(() => {
        const existing = database.prepare(`${procurementRecordSelect} WHERE p.id = ?`).get(recordId);
        if (!existing) throw new AppError(404, "PROCUREMENT_RECORD_NOT_FOUND", "没有找到对应采购记录");
        database.prepare("UPDATE procurement_records SET status = ?, updated_at = ? WHERE id = ?")
          .run(status, new Date().toISOString(), recordId);
        writeAudit({ actor, entityType: "procurement_record", entityId: recordId, action: "procurement.status_update", summary: { equipmentId: existing.equipment_id || null, beforeStatus: existing.status, afterStatus: status } });
        return mapProcurementRecord(database.prepare(`${procurementRecordSelect} WHERE p.id = ?`).get(recordId));
      });
    },

    listReservations(filters = {}) {
      const clauses = [];
      const values = [];
      const { page, pageSize, offset } = paginationOptions(filters);
      const { date = "", equipmentId = "", status = "", dateFrom = "", dateTo = "" } = filters;
      if (date) {
        clauses.push("r.reservation_date = ?");
        values.push(date);
      }
      if (equipmentId) {
        clauses.push("r.equipment_id = ?");
        values.push(equipmentId);
      }
      if (status) {
        if (!["approved", "cancelled", "in_use", "completed"].includes(status)) throw new AppError(400, "VALIDATION_ERROR", "预约状态无效");
        clauses.push("r.status = ?"); values.push(status);
      }
      const start = optionalDate(dateFrom, "开始日期");
      const end = optionalDate(dateTo, "结束日期");
      if (start && end && start > end) throw new AppError(400, "VALIDATION_ERROR", "开始日期不能晚于结束日期");
      if (start) { clauses.push("r.reservation_date >= ?"); values.push(start); }
      if (end) { clauses.push("r.reservation_date <= ?"); values.push(end); }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const total = database.prepare(`SELECT COUNT(*) AS count FROM reservations r ${where}`).get(...values).count;
      const items = database.prepare(`${reservationSelect} ${where} ORDER BY r.start_at, r.id LIMIT ? OFFSET ?`).all(...values, pageSize, offset).map(mapReservation);
      return listResult(items, total, { page, pageSize }, filters);
    },

    listMyReservations(actor, { status = "" } = {}) {
      if (!actor?.id) throw new AppError(401, "AUTH_REQUIRED", "请先登录");
      const allowedStatuses = new Set(["approved", "in_use", "completed", "cancelled"]);
      if (status && !allowedStatuses.has(status)) throw new AppError(400, "VALIDATION_ERROR", "预约状态无效");
      const equipmentRows = database.prepare(`${reservationSelect} WHERE r.requester_user_id = ?`).all(actor.id).map(mapReservation)
        .map((item) => ({ ...item, resourceType: "equipment", resourceId: item.equipmentId, resourceName: item.equipmentName, resourceCode: item.equipmentCode }));
      const roomRows = database.prepare(`${roomReservationSelect} WHERE r.requester_user_id = ?`).all(actor.id).map(mapRoomReservation)
        .map((item) => ({ ...item, resourceType: "meeting_room", resourceId: item.meetingRoomId, resourceName: item.meetingRoomName, resourceCode: item.meetingRoomCode }));
      return [...equipmentRows, ...roomRows]
        .filter((item) => !status || item.status === status)
        .sort((left, right) => left.startAt.localeCompare(right.startAt));
    },

    createReservation(input, actor = {}) {
      const equipmentId = requiredText(input.equipmentId, "设备");
      const equipment = database.prepare("SELECT * FROM equipment WHERE id = ?").get(equipmentId);
      if (!equipment) throw new AppError(404, "EQUIPMENT_NOT_FOUND", "没有找到对应设备");
      if (["maintenance", "disabled", "retired"].includes(equipment.status)) {
        throw new AppError(409, "EQUIPMENT_UNAVAILABLE", "当前设备不可预约，请联系设备保管人");
      }

      const date = requiredText(input.date, "预约日期", 10);
      const start = requiredText(input.start, "开始时间", 5);
      const end = requiredText(input.end, "结束时间", 5);
      if (!validCalendarDate(date)) {
        throw new AppError(400, "INVALID_RESERVATION_DATE", "预约日期不是有效的日历日期");
      }
      if (date < todayInShanghai()) {
        throw new AppError(400, "PAST_RESERVATION_DATE", "不能预约过去的日期");
      }
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(end)) {
        throw new AppError(400, "VALIDATION_ERROR", "预约日期或时间格式无效");
      }
      const startAt = new Date(`${date}T${start}:00+08:00`);
      const endAt = new Date(`${date}T${end}:00+08:00`);
      if (Number.isNaN(startAt.valueOf()) || Number.isNaN(endAt.valueOf()) || startAt >= endAt) {
        throw new AppError(400, "INVALID_TIME_RANGE", "结束时间需要晚于开始时间");
      }
      const now = new Date();
      if (startAt <= now) {
        throw new AppError(400, "PAST_RESERVATION_TIME", "预约开始时间需要晚于当前时间");
      }

      const people = Number(input.people);
      if (!Number.isInteger(people) || people < 1 || people > 12) {
        throw new AppError(400, "VALIDATION_ERROR", "使用人数需要在 1 到 12 人之间");
      }

      const id = randomUUID();
      const nowIso = now.toISOString();
      const purpose = requiredText(input.purpose, "使用用途", 500);
      try {
        return transaction(() => {
          database.prepare(`
          INSERT INTO reservations (
            id, equipment_id, reservation_date, start_time, end_time, start_at, end_at,
            people, purpose, requester_name, requester_lab, requester_user_id, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)
        `).run(
          id,
          equipmentId,
          date,
          start,
          end,
          startAt.toISOString(),
          endAt.toISOString(),
          people,
          purpose,
          requiredText(actor.displayName || input.requesterName, "预约人"),
          requiredText(actor.laboratoryName || (actor.id ? "未分配实验室" : input.requesterLab) || "未分配实验室", "所属实验室"),
          actor.id || null,
          nowIso,
          nowIso
          );
          writeAudit({ actor, entityType: "reservation", entityId: id, action: "reservation.create", summary: { equipmentId, date, start, end, people, purpose } });
          return mapReservation(database.prepare(`${reservationSelect} WHERE r.id = ?`).get(id));
        });
      } catch (error) {
        if (String(error.message).includes("reservation_conflict")) {
          const conflict = database.prepare(`${reservationSelect}
            WHERE r.equipment_id = ?
              AND r.status IN ('approved', 'in_use')
              AND ? < r.end_at
              AND ? > r.start_at
            ORDER BY r.start_at LIMIT 1
          `).get(equipmentId, startAt.toISOString(), endAt.toISOString());
          throw new AppError(
            409,
            "RESERVATION_CONFLICT",
            conflict ? `该设备在 ${conflict.start_time}-${conflict.end_time} 已有预约` : "该设备在所选时段已有预约",
            conflict ? mapReservation(conflict) : undefined
          );
        }
        throw error;
      }
    },

    listMeetingRooms({ includeInactive = false } = {}) {
      return database.prepare(`SELECT * FROM meeting_rooms ${includeInactive ? "" : "WHERE is_active = 1"} ORDER BY name`).all().map(mapMeetingRoom);
    },

    createMeetingRoom(input, actor) {
      const room = {
        name: requiredText(input.name, "会议室名称", 100),
        code: requiredText(input.code, "会议室编号", 40).toUpperCase(),
        capacity: Number(input.capacity),
        location: typeof input.location === "string" ? input.location.trim().slice(0, 200) : ""
      };
      if (!Number.isInteger(room.capacity) || room.capacity < 1 || room.capacity > 500) throw new AppError(400, "VALIDATION_ERROR", "会议室容量需要在 1 到 500 人之间");
      const id = randomUUID();
      const now = new Date().toISOString();
      try {
        return transaction(() => {
          database.prepare("INSERT INTO meeting_rooms (id, name, code, capacity, location, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)").run(id, room.name, room.code, room.capacity, room.location, now, now);
          writeAudit({ actor, entityType: "meeting_room", entityId: id, action: "meeting_room.create", summary: room });
          return mapMeetingRoom(database.prepare("SELECT * FROM meeting_rooms WHERE id = ?").get(id));
        });
      } catch (error) {
        if (String(error.message).includes("UNIQUE")) throw new AppError(409, "MEETING_ROOM_EXISTS", "会议室名称或编号已存在");
        throw error;
      }
    },

    updateMeetingRoom(id, input, actor) {
      const roomId = requiredText(id, "会议室");
      try {
        return transaction(() => {
          const existing = database.prepare("SELECT * FROM meeting_rooms WHERE id = ?").get(roomId);
          if (!existing) throw new AppError(404, "MEETING_ROOM_NOT_FOUND", "没有找到对应会议室");
          if (input.active !== undefined && typeof input.active !== "boolean") throw new AppError(400, "VALIDATION_ERROR", "会议室开放状态需要是布尔值");
          const next = {
            name: input.name === undefined ? existing.name : requiredText(input.name, "会议室名称", 100),
            code: input.code === undefined ? existing.code : requiredText(input.code, "会议室编号", 40).toUpperCase(),
            capacity: input.capacity === undefined ? existing.capacity : Number(input.capacity),
            location: input.location === undefined ? existing.location : String(input.location).trim().slice(0, 200),
            active: input.active === undefined ? Boolean(existing.is_active) : input.active
          };
          if (!Number.isInteger(next.capacity) || next.capacity < 1 || next.capacity > 500) throw new AppError(400, "VALIDATION_ERROR", "会议室容量需要在 1 到 500 人之间");
          const capacityConflict = database.prepare("SELECT COUNT(*) AS count, MAX(people) AS maximum FROM room_reservations WHERE meeting_room_id = ? AND status IN ('approved', 'in_use') AND end_at > ? AND people > ?").get(roomId, new Date().toISOString(), next.capacity);
          if (capacityConflict.count) {
            throw new AppError(409, "MEETING_ROOM_CAPACITY_CONFLICT", "会议室容量低于尚未结束预约的使用人数", { conflictingReservations: capacityConflict.count, maximumReservedPeople: capacityConflict.maximum });
          }
          if (!next.active && existing.is_active) {
            const future = database.prepare("SELECT COUNT(*) AS count FROM room_reservations WHERE meeting_room_id = ? AND status IN ('approved', 'in_use') AND end_at > ?").get(roomId, new Date().toISOString()).count;
            if (future) throw new AppError(409, "MEETING_ROOM_HAS_FUTURE_RESERVATIONS", "会议室存在尚未结束的预约，暂时不能停用", { futureReservations: future });
          }
          const now = new Date().toISOString();
          database.prepare("UPDATE meeting_rooms SET name = ?, code = ?, capacity = ?, location = ?, is_active = ?, updated_at = ? WHERE id = ?").run(next.name, next.code, next.capacity, next.location, next.active ? 1 : 0, now, roomId);
          writeAudit({ actor, entityType: "meeting_room", entityId: roomId, action: "meeting_room.update", summary: { before: mapMeetingRoom(existing), after: next } });
          return mapMeetingRoom(database.prepare("SELECT * FROM meeting_rooms WHERE id = ?").get(roomId));
        });
      } catch (error) {
        if (String(error.message).includes("UNIQUE")) throw new AppError(409, "MEETING_ROOM_EXISTS", "会议室名称或编号已存在");
        if (String(error.message).includes("meeting_room_has_future_reservations")) {
          const future = database.prepare("SELECT COUNT(*) AS count FROM room_reservations WHERE meeting_room_id = ? AND status IN ('approved', 'in_use') AND end_at > ?").get(roomId, new Date().toISOString()).count;
          throw new AppError(409, "MEETING_ROOM_HAS_FUTURE_RESERVATIONS", "会议室存在尚未结束的预约，暂时不能停用", { futureReservations: future });
        }
        if (String(error.message).includes("meeting_room_capacity_conflict")) {
          const conflict = database.prepare("SELECT COUNT(*) AS count, MAX(people) AS maximum FROM room_reservations WHERE meeting_room_id = ? AND status IN ('approved', 'in_use') AND end_at > ? AND people > ?").get(roomId, new Date().toISOString(), Number(input.capacity));
          throw new AppError(409, "MEETING_ROOM_CAPACITY_CONFLICT", "会议室容量低于尚未结束预约的使用人数", { conflictingReservations: conflict.count, maximumReservedPeople: conflict.maximum });
        }
        throw error;
      }
    },

    listRoomReservations(filters = {}) {
      const clauses = [];
      const values = [];
      const { page, pageSize, offset } = paginationOptions(filters);
      const { date = "", meetingRoomId = "", status = "", dateFrom = "", dateTo = "" } = filters;
      if (date) {
        clauses.push("r.reservation_date = ?");
        values.push(date);
      }
      if (meetingRoomId) {
        clauses.push("r.meeting_room_id = ?");
        values.push(meetingRoomId);
      }
      if (status) {
        if (!["approved", "cancelled", "in_use", "completed"].includes(status)) throw new AppError(400, "VALIDATION_ERROR", "预约状态无效");
        clauses.push("r.status = ?"); values.push(status);
      }
      const start = optionalDate(dateFrom, "开始日期");
      const end = optionalDate(dateTo, "结束日期");
      if (start && end && start > end) throw new AppError(400, "VALIDATION_ERROR", "开始日期不能晚于结束日期");
      if (start) { clauses.push("r.reservation_date >= ?"); values.push(start); }
      if (end) { clauses.push("r.reservation_date <= ?"); values.push(end); }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const total = database.prepare(`SELECT COUNT(*) AS count FROM room_reservations r ${where}`).get(...values).count;
      const items = database.prepare(`${roomReservationSelect} ${where} ORDER BY r.start_at, r.id LIMIT ? OFFSET ?`).all(...values, pageSize, offset).map(mapRoomReservation);
      return listResult(items, total, { page, pageSize }, filters);
    },

    createRoomReservation(input, actor = {}) {
      const meetingRoomId = requiredText(input.meetingRoomId, "会议室");
      const date = requiredText(input.date, "预约日期", 10);
      const start = requiredText(input.start, "开始时间", 5);
      const end = requiredText(input.end, "结束时间", 5);
      if (!validCalendarDate(date)) throw new AppError(400, "INVALID_RESERVATION_DATE", "预约日期不是有效的日历日期");
      if (date < todayInShanghai()) throw new AppError(400, "PAST_RESERVATION_DATE", "不能预约过去的日期");
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(end)) {
        throw new AppError(400, "VALIDATION_ERROR", "预约日期或时间格式无效");
      }
      const startAt = new Date(`${date}T${start}:00+08:00`);
      const endAt = new Date(`${date}T${end}:00+08:00`);
      if (Number.isNaN(startAt.valueOf()) || Number.isNaN(endAt.valueOf()) || startAt >= endAt) {
        throw new AppError(400, "INVALID_TIME_RANGE", "结束时间需要晚于开始时间");
      }
      const now = new Date();
      if (startAt <= now) {
        throw new AppError(400, "PAST_RESERVATION_TIME", "预约开始时间需要晚于当前时间");
      }
      const people = Number(input.people);
      if (!Number.isInteger(people) || people < 1 || people > 500) {
        throw new AppError(400, "VALIDATION_ERROR", "使用人数不符合该会议室的预约要求");
      }

      const id = randomUUID();
      const nowIso = now.toISOString();
      const purpose = requiredText(input.purpose, "使用用途", 500);
      try {
        return transaction(() => {
          const meetingRoom = database.prepare("SELECT * FROM meeting_rooms WHERE id = ?").get(meetingRoomId);
          if (!meetingRoom) throw new AppError(404, "MEETING_ROOM_NOT_FOUND", "没有找到对应会议室");
          if (!meetingRoom.is_active) throw new AppError(409, "MEETING_ROOM_UNAVAILABLE", "当前会议室不可预约");
          if (people > meetingRoom.capacity) throw new AppError(400, "VALIDATION_ERROR", "使用人数不符合该会议室的预约要求");
          database.prepare(`
          INSERT INTO room_reservations (
            id, meeting_room_id, reservation_date, start_time, end_time, start_at, end_at,
            people, purpose, requester_name, requester_lab, requester_user_id, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)
        `).run(
          id, meetingRoomId, date, start, end, startAt.toISOString(), endAt.toISOString(), people,
          purpose,
          requiredText(actor.displayName || input.requesterName, "预约人"),
          requiredText(actor.laboratoryName || (actor.id ? "未分配实验室" : input.requesterLab) || "未分配实验室", "所属实验室"),
          actor.id || null, nowIso, nowIso
          );
          writeAudit({ actor, entityType: "room_reservation", entityId: id, action: "room_reservation.create", summary: { meetingRoomId, date, start, end, people, purpose } });
          return mapRoomReservation(database.prepare(`${roomReservationSelect} WHERE r.id = ?`).get(id));
        });
      } catch (error) {
        if (String(error.message).includes("meeting_room_unavailable")) throw new AppError(409, "MEETING_ROOM_UNAVAILABLE", "当前会议室不可预约");
        if (String(error.message).includes("meeting_room_capacity_exceeded")) throw new AppError(400, "VALIDATION_ERROR", "使用人数不符合该会议室的预约要求");
        if (String(error.message).includes("room_reservation_conflict")) {
          const conflict = database.prepare(`${roomReservationSelect}
            WHERE r.meeting_room_id = ? AND r.status IN ('approved', 'in_use')
              AND ? < r.end_at AND ? > r.start_at
            ORDER BY r.start_at LIMIT 1
          `).get(meetingRoomId, startAt.toISOString(), endAt.toISOString());
          throw new AppError(409, "ROOM_RESERVATION_CONFLICT", conflict ? `该会议室在 ${conflict.start_time}-${conflict.end_time} 已有预约` : "该会议室在所选时段已有预约", conflict ? mapRoomReservation(conflict) : undefined);
        }
        throw error;
      }
    },

    cancelRoomReservation(reservationId, actor) {
      const reservation = database.prepare(`${roomReservationSelect} WHERE r.id = ?`).get(reservationId);
      if (!reservation) throw new AppError(404, "ROOM_RESERVATION_NOT_FOUND", "没有找到对应会议室预约");
      const mappedReservation = mapRoomReservation(reservation);
      if (mappedReservation.status === "cancelled") return mappedReservation;
      if (mappedReservation.status === "in_use") {
        throw new AppError(409, "ROOM_RESERVATION_ALREADY_STARTED", "会议室预约已经开始，不能取消");
      }
      if (mappedReservation.status === "completed") {
        throw new AppError(409, "ROOM_RESERVATION_ALREADY_COMPLETED", "会议室预约已经结束，不能取消");
      }
      if (mappedReservation.status !== "approved") throw new AppError(409, "ROOM_RESERVATION_NOT_CANCELLABLE", "当前预约状态不能取消");
      if (actor?.role !== "developer" && reservation.requester_user_id !== actor?.id) {
        throw new AppError(403, "ROOM_RESERVATION_CANCEL_FORBIDDEN", "只能取消自己提交的预约");
      }
      const now = new Date();
      const nowIso = now.toISOString();
      return transaction(() => {
        const result = database.prepare("UPDATE room_reservations SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'approved' AND start_at > ?")
          .run(nowIso, reservationId, nowIso);
        const updated = database.prepare(`${roomReservationSelect} WHERE r.id = ?`).get(reservationId);
        if (!result.changes) {
          const effective = mapRoomReservation(updated);
          if (effective.status === "cancelled") return effective;
          if (effective.status === "in_use") throw new AppError(409, "ROOM_RESERVATION_ALREADY_STARTED", "会议室预约已经开始，不能取消");
          if (effective.status === "completed") throw new AppError(409, "ROOM_RESERVATION_ALREADY_COMPLETED", "会议室预约已经结束，不能取消");
          throw new AppError(409, "ROOM_RESERVATION_NOT_CANCELLABLE", "当前预约状态不能取消");
        }
        writeAudit({ actor, entityType: "room_reservation", entityId: reservationId, action: "room_reservation.cancel", summary: { meetingRoomId: reservation.meeting_room_id } });
        return mapRoomReservation(updated);
      });
    },

    cancelReservation(reservationId, actor) {
      const reservation = database.prepare(`${reservationSelect} WHERE r.id = ?`).get(reservationId);
      if (!reservation) throw new AppError(404, "RESERVATION_NOT_FOUND", "没有找到对应预约");
      const mappedReservation = mapReservation(reservation);
      if (mappedReservation.status === "cancelled") return mappedReservation;
      if (mappedReservation.status === "in_use") {
        throw new AppError(409, "RESERVATION_ALREADY_STARTED", "设备预约已经开始，不能取消");
      }
      if (mappedReservation.status === "completed") {
        throw new AppError(409, "RESERVATION_ALREADY_COMPLETED", "设备预约已经结束，不能取消");
      }
      if (mappedReservation.status !== "approved") {
        throw new AppError(409, "RESERVATION_NOT_CANCELLABLE", "当前预约状态不能取消");
      }
      if (actor?.role !== "developer" && reservation.requester_user_id !== actor?.id) {
        throw new AppError(403, "RESERVATION_CANCEL_FORBIDDEN", "只能取消自己提交的预约");
      }
      const now = new Date();
      const nowIso = now.toISOString();
      return transaction(() => {
        const result = database.prepare("UPDATE reservations SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'approved' AND start_at > ?")
          .run(nowIso, reservationId, nowIso);
        const updated = database.prepare(`${reservationSelect} WHERE r.id = ?`).get(reservationId);
        if (!result.changes) {
          const effective = mapReservation(updated);
          if (effective.status === "cancelled") return effective;
          if (effective.status === "in_use") throw new AppError(409, "RESERVATION_ALREADY_STARTED", "设备预约已经开始，不能取消");
          if (effective.status === "completed") throw new AppError(409, "RESERVATION_ALREADY_COMPLETED", "设备预约已经结束，不能取消");
          throw new AppError(409, "RESERVATION_NOT_CANCELLABLE", "当前预约状态不能取消");
        }
        writeAudit({ actor, entityType: "reservation", entityId: reservationId, action: "reservation.cancel", summary: { equipmentId: reservation.equipment_id } });
        return mapReservation(updated);
      });
    }
  };
}
