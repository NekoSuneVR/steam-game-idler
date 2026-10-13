import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, "public");
const DATA_DIR = process.env.DATA_DIR || "/data";
const PORT = Number(process.env.PORT || 8080);
const WEB_USER = process.env.WEB_USER || "admin";
const WEB_PASSWORD = process.env.WEB_PASSWORD || "";
const BIN = process.env.STEAMUTILITY_PATH || "/app/SteamUtility";

if (WEB_PASSWORD.length < 12) {
  console.error("WEB_PASSWORD must be set to at least 12 characters. Refusing to start an unprotected dashboard.");
  process.exit(1);
}
fs.mkdirSync(DATA_DIR, { recursive: true });

const state = {
  daemon: "starting",
  loggedOn: false,
  result: "Starting SteamUtility",
  steamId: null,
  username: null,
  guard: null,
  idleIds: [],
  games: [],
  lastError: null,
  startedAt: new Date().toISOString(),
};
const pending = new Map();
let daemon;
let lineBuffer = "";

function audit(message) {
  const safe = `${new Date().toISOString()} ${message.replace(/[\r\n]/g, " ")}\n`;
  try {
    fs.appendFileSync(path.join(DATA_DIR, "events.log"), safe, { mode: 0o600 });
  } catch (error) {
    console.error("Could not write audit log:", error.message);
  }
  console.log(message);
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
  try { decoded = Buffer.from(value.slice(6), "base64").toString("utf8"); } catch { return false; }
  const colon = decoded.indexOf(":");
  if (colon < 0) return false;
  return safeEqual(decoded.slice(0, colon), WEB_USER) && safeEqual(decoded.slice(colon + 1), WEB_PASSWORD);
}
function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:",
    "cross-origin-resource-policy": "same-origin",
  });
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}
function fail(res, status, error) { send(res, status, { error }); }
function spawnDaemon() {
  daemon = spawn(BIN, ["agent"], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, HOME: "/data" } });
  state.daemon = "running";
  state.result = "Daemon started; sign in to Steam";
  daemon.stdout.setEncoding("utf8");
  daemon.stdout.on("data", chunk => {
    lineBuffer += chunk;
    let index;
    while ((index = lineBuffer.indexOf("\n")) >= 0) {
      const line = lineBuffer.slice(0, index).trim();
      lineBuffer = lineBuffer.slice(index + 1);
      if (!line) continue;
      try { handleMessage(JSON.parse(line)); }
      catch { audit("SteamUtility output: " + line.slice(0, 500)); }
    }
  });
  daemon.stderr.setEncoding("utf8");
  daemon.stderr.on("data", chunk => {
    for (const line of chunk.split("\n").filter(Boolean)) audit("SteamUtility: " + line.slice(0, 500));
  });
  daemon.on("error", error => {
    state.daemon = "error";
    state.lastError = "SteamUtility could not start: " + error.message;
    audit(state.lastError);
  });
  daemon.on("exit", (code, signal) => {
    state.daemon = "stopped";
    state.loggedOn = false;
    state.result = "SteamUtility stopped";
    state.lastError = code === 0 ? null : `SteamUtility exited (code=${code}, signal=${signal})`;
    for (const item of pending.values()) item.reject(new Error("SteamUtility stopped"));
    pending.clear();
    audit(state.lastError || state.result);
  });
}
function handleMessage(message) {
  if (message.event) {
    const data = message.payload || {};
    switch (message.event) {
      case "status_changed":
        state.loggedOn = Boolean(data.loggedOn);
        state.result = String(data.result || (state.loggedOn ? "Connected" : "Disconnected"));
        state.steamId = data.steamId || null;
        if (!state.loggedOn && data.result !== "Reconnecting") state.guard = null;
        break;
      case "idle_state":
        state.idleIds = Array.isArray(data.appIds) ? data.appIds.map(Number) : [];
        break;
      case "auth_required":
        state.loggedOn = false;
        state.result = "Authentication required";
        break;
      case "login_failed":
        state.loggedOn = false;
        state.lastError = String(data.error || "Login failed");
        state.result = "Login failed";
        state.guard = null;
        break;
      case "guard_code_incorrect":
        state.guard = { type: data.guardType || "device", detail: data.detail || null, incorrect: true };
        state.result = "Steam Guard code was rejected";
        break;
      case "refresh_token":
        state.username = data.username || state.username;
        state.loggedOn = true;
        state.guard = null;
        state.result = "Connected to Steam";
        // Deliberately do not persist or log refresh tokens. Re-authenticate after container restart.
        break;
      case "playing_session":
        break;
      default:
        break;
    }
    return;
  }
  if (message.id && pending.has(message.id)) {
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.ok) entry.resolve(message.result ?? {});
    else entry.reject(new Error(String(message.error || "SteamUtility request failed")));
  }
}
function rpc(cmd, fields = {}, timeoutMs = 90000) {
  if (!daemon || daemon.killed || !daemon.stdin.writable) return Promise.reject(new Error("SteamUtility is not running"));
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Steam request timed out"));
    }, timeoutMs);
    pending.set(id, {
      resolve: value => { clearTimeout(timer); resolve(value); },
      reject: error => { clearTimeout(timer); reject(error); },
    });
    daemon.stdin.write(JSON.stringify({ id, cmd, ...fields }) + "\n", error => {
      if (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  });
}
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 65536) { reject(new Error("Request body too large")); req.destroy(); }
    });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new Error("Invalid JSON body")); }
    });
    req.on("error", reject);
  });
}
function normalizedGames(result) {
  const games = Array.isArray(result?.games) ? result.games : [];
  return games.map(g => ({
    appId: Number(g.appId ?? g.AppId ?? g.appid ?? g.appid),
    name: String(g.name ?? g.Name ?? `App ${g.appId ?? g.AppId ?? g.appid}`),
    playtimeForeverMinutes: Number(g.playtimeForeverMinutes ?? g.PlaytimeForeverMinutes ?? 0),
  })).filter(g => Number.isInteger(g.appId) && g.appId > 0 && g.name);
}
const routes = async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, state.daemon === "running" ? 200 : 503, { ok: state.daemon === "running", daemon: state.daemon });
  }
  if (!authorized(req)) {
    res.writeHead(401, { "www-authenticate": 'Basic realm="Steam Game Idler", charset="UTF-8"', "cache-control": "no-store" });
    return res.end("Authentication required");
  }
  if (req.method === "GET" && url.pathname === "/") {
    const html = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
    return send(res, 200, html, "text/html; charset=utf-8");
  }
  if (req.method === "GET" && url.pathname === "/api/status") {
    return send(res, 200, {
      daemon: state.daemon, loggedOn: state.loggedOn, result: state.result,
      steamId: state.steamId, username: state.username, guard: state.guard,
      idleIds: state.idleIds, gamesCount: state.games.length, lastError: state.lastError,
      startedAt: state.startedAt,
    });
  }
  if (req.method === "POST" && url.pathname.startsWith("/api/")) {
    let body;
    try { body = await parseBody(req); } catch (error) { return fail(res, 400, error.message); }
    try {
      if (url.pathname === "/api/login") {
        const username = String(body.username || "").trim();
        const password = String(body.password || "");
        if (!username || !password || username.length > 128 || password.length > 1024) return fail(res, 400, "Enter a Steam username and password.");
        if (state.loggedOn) return fail(res, 409, "Already signed in. Sign out first.");
        state.username = username;
        state.guard = null;
        state.lastError = null;
        const result = await rpc("login", { user: username, passB64: Buffer.from(password, "utf8").toString("base64") });
        state.result = result.status === "need_guard_code" ? "Steam Guard code required" : result.status === "need_guard_confirmation" ? "Approve sign-in in the Steam mobile app" : "Signing in";
        if (result.status === "need_guard_code") state.guard = { type: result.guardType || "device", detail: result.detail || null };
        if (result.status === "need_guard_confirmation") state.guard = { type: "confirmation" };
        return send(res, 200, { ok: true, status: result.status || "pending", guard: state.guard, result: state.result });
      }
      if (url.pathname === "/api/guard") {
        if (state.guard?.type === "confirmation") return fail(res, 409, "Approve the sign-in in the Steam mobile app, then wait.");
        const code = String(body.code || "").trim();
        if (!code || code.length > 32) return fail(res, 400, "Enter the Steam Guard code.");
        await rpc("submit_guard_code", { code });
        state.guard = null;
        state.result = "Guard code submitted; waiting for Steam";
        return send(res, 200, { ok: true });
      }
      if (url.pathname === "/api/games") {
        if (!state.loggedOn) return fail(res, 409, "Sign in to Steam first.");
        const result = await rpc("get_owned_apps", { gamesOnly: true, language: "english" }, 120000);
        state.games = normalizedGames(result);
        return send(res, 200, { games: state.games, idleIds: state.idleIds });
      }
      if (url.pathname === "/api/idle") {
        if (!state.loggedOn) return fail(res, 409, "Sign in to Steam first.");
        if (!Array.isArray(body.appIds) || body.appIds.length > 32) return fail(res, 400, "Choose up to 32 games.");
        const allowed = new Set(state.games.map(g => g.appId));
        const appIds = [...new Set(body.appIds.map(Number))];
        if (appIds.some(id => !Number.isInteger(id) || id <= 0 || !allowed.has(id))) return fail(res, 400, "Reload your owned games list and choose games from it.");
        await rpc("idle_set", { appIds });
        state.idleIds = appIds;
        audit(`Idling selection updated (${appIds.length} games) for ${state.steamId || "signed-in account"}`);
        return send(res, 200, { ok: true, idleIds: appIds });
      }
      if (url.pathname === "/api/stop") {
        if (!state.loggedOn) return fail(res, 409, "Not signed in.");
        await rpc("idle_set", { appIds: [] });
        state.idleIds = [];
        audit(`Idling stopped for ${state.steamId || "signed-in account"}`);
        return send(res, 200, { ok: true });
      }
      if (url.pathname === "/api/logout") {
        try { await rpc("logout", {}, 10000); } catch {}
        state.loggedOn = false;
        state.guard = null;
        state.idleIds = [];
        state.games = [];
        state.result = "Signed out";
        state.steamId = null;
        state.username = null;
        return send(res, 200, { ok: true });
      }
      return fail(res, 404, "Not found");
    } catch (error) {
      state.lastError = String(error.message || error);
      audit("Request failed: " + state.lastError);
      return fail(res, 502, state.lastError);
    }
  }
  return fail(res, 404, "Not found");
};

const server = http.createServer((req, res) => {
  routes(req, res).catch(error => {
    console.error("Unhandled request error:", error);
    if (!res.headersSent) fail(res, 500, "Internal server error");
    else res.destroy();
  });
});
server.listen(PORT, "0.0.0.0", () => {
  audit(`Web dashboard listening on port ${PORT}; HTTP Basic Auth enabled`);
  spawnDaemon();
});
function shutdown() {
  server.close();
  if (daemon && !daemon.killed) {
    try { daemon.stdin.write(JSON.stringify({ id: randomUUID(), cmd: "logout" }) + "\n"); } catch {}
    daemon.kill("SIGTERM");
  }
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
