import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.PORT || 8080);
const WEB_USER = process.env.WEB_USER || "admin";
const WEB_PASSWORD = process.env.WEB_PASSWORD || "";
const NOVNC_ROOT = "/usr/share/novnc";
const WS_HOST = "127.0.0.1";
const WS_PORT = 6081;

if (WEB_PASSWORD.length < 12) {
  console.error("WEB_PASSWORD must be set to at least 12 characters. Refusing to start an unprotected remote desktop.");
  process.exit(1);
}

function safeEqual(a, b) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

function authorized(req) {
  const value = req.headers.authorization || "";
  if (!value.startsWith("Basic ")) return false;
  let decoded;
  try { decoded = Buffer.from(value.slice(6), "base64").toString("utf8"); }
  catch { return false; }
  const colon = decoded.indexOf(":");
  if (colon < 0) return false;
  return safeEqual(decoded.slice(0, colon), WEB_USER) &&
    safeEqual(decoded.slice(colon + 1), WEB_PASSWORD);
}

function headers(res) {
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("cross-origin-resource-policy", "same-origin");
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
}

function unauthorized(res) {
  headers(res);
  res.writeHead(401, {
    "www-authenticate": 'Basic realm="Steam Game Idler", charset="UTF-8"',
    "content-type": "text/plain; charset=utf-8",
  });
  res.end("Authentication required");
}

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  return ({
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  })[ext] || "application/octet-stream";
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/health") {
    headers(res);
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, service: "steam-game-idler-remote-ui" }));
    return;
  }
  if (!authorized(req)) return unauthorized(res);
  if (req.method !== "GET" && req.method !== "HEAD") {
    headers(res);
    res.writeHead(405, { allow: "GET, HEAD" });
    res.end();
    return;
  }
  if (url.pathname === "/") {
    headers(res);
    res.writeHead(302, { location: "/vnc.html?autoconnect=true&resize=scale&path=websockify" });
    res.end();
    return;
  }

  let decoded;
  try { decoded = decodeURIComponent(url.pathname); }
  catch {
    headers(res);
    res.writeHead(400);
    res.end("Bad request");
    return;
  }
  const relative = decoded.replace(/^\/+/, "");
  const file = path.resolve(NOVNC_ROOT, relative);
  if (file !== NOVNC_ROOT && !file.startsWith(NOVNC_ROOT + path.sep)) {
    headers(res);
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) {
      headers(res);
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    headers(res);
    res.setHeader("content-type", contentType(file));
    res.setHeader("content-length", stat.size);
    if (req.method === "HEAD") {
      res.writeHead(200);
      res.end();
      return;
    }
    res.writeHead(200);
    fs.createReadStream(file).pipe(res);
  });
});

server.on("upgrade", (req, socket, head) => {
  if (!authorized(req)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm=\"Steam Game Idler\"\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname !== "/websockify") {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  const upstream = net.connect(WS_PORT, WS_HOST);
  upstream.once("connect", () => {
    const lines = ["GET " + req.url + " HTTP/" + req.httpVersion];
    for (const [name, value] of Object.entries(req.headers)) {
      if (name.toLowerCase() === "authorization") continue;
      if (Array.isArray(value)) {
        for (const item of value) lines.push(name + ": " + item);
      } else if (value !== undefined) lines.push(name + ": " + value);
    }
    upstream.write(lines.join("\r\n") + "\r\n\r\n");
    if (head.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  upstream.on("error", () => {
    if (!socket.destroyed) {
      socket.write("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
      socket.destroy();
    }
  });
  socket.on("error", () => upstream.destroy());
  socket.on("close", () => upstream.destroy());
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Authenticated noVNC gateway listening on port " + PORT);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
