import { createServer, request as httpRequest } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)), "apps/web");
const port = Number(process.env.WEB_PORT || 3000);
const apiPort = Number(process.env.API_PORT || 4000);
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };

createServer(async (request, response) => {
  if (request.url.startsWith("/api/")) {
    const proxy = httpRequest({
      hostname: "127.0.0.1",
      port: apiPort,
      path: request.url,
      method: request.method,
      headers: request.headers
    }, (upstream) => {
      response.writeHead(upstream.statusCode || 502, upstream.headers);
      upstream.pipe(response);
    });
    proxy.on("error", () => {
      response.writeHead(502, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ error: { code: "API_UNAVAILABLE", message: "本地 API 尚未启动" } }));
    });
    request.pipe(proxy);
    return;
  }
  const pathname = request.url.split("?")[0];
  const requested = pathname === "/" ? "/index.html" : pathname;
  const file = normalize(join(root, requested));
  if (!file.startsWith(root)) { response.writeHead(403); response.end("Forbidden"); return; }
  try {
    const body = await readFile(file);
    response.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" }); response.end(body);
  } catch { response.writeHead(404); response.end("Not found"); }
}).listen(port, () => console.log(`CIPC LabEquip Hub web demo: http://localhost:${port}`));
