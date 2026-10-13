const $ = id => document.getElementById(id);
let games = [];
let selected = new Set();
let status = {};

async function api(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
function message(id, text, kind = "") {
  $(id).textContent = text || "";
  $(id).className = "message" + (kind ? " " + kind : "");
}
function setEnabled(id, value) { $(id).disabled = !value; }
function renderGames() {
  const query = $("search").value.trim().toLowerCase();
  const visible = games.filter(game => game.name.toLowerCase().includes(query) || String(game.appId).includes(query));
  const root = $("games");
  root.replaceChildren();
  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = games.length ? "No games match this search." : "No games loaded yet.";
    root.append(empty);
    return;
  }
  for (const game of visible) {
    const label = document.createElement("label");
    label.className = "game";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selected.has(game.appId);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        if (selected.size >= 32) { checkbox.checked = false; message("gamesMessage", "Select no more than 32 games."); return; }
        selected.add(game.appId);
      } else selected.delete(game.appId);
      renderGames();
    });
    const details = document.createElement("span");
    const name = document.createElement("span");
    name.className = "game-name";
    name.textContent = game.name;
    const meta = document.createElement("span");
    meta.className = "game-meta";
    meta.textContent = `App ID ${game.appId}${status.idleIds?.includes(game.appId) ? " · currently idling" : ""}`;
    details.append(name, document.createElement("br"), meta);
    label.append(checkbox, details);
    root.append(label);
  }
}
function updateStatus(data) {
  status = data;
  $("statusText").textContent = data.result || data.daemon || "Unknown";
  $("dot").className = "dot " + (data.loggedOn ? "good" : data.daemon === "running" ? "" : "bad");
  $("account").textContent = data.username || "Not signed in";
  $("steamId").textContent = data.steamId || "—";
  $("gamesCount").textContent = String(data.gamesCount ?? games.length);
  $("idleCount").textContent = String((data.idleIds || []).length);
  setEnabled("logout", Boolean(data.loggedOn));
  setEnabled("loadGames", Boolean(data.loggedOn));
  setEnabled("search", Boolean(data.loggedOn && games.length));
  setEnabled("selectVisible", Boolean(data.loggedOn && games.length));
  setEnabled("clearSelection", Boolean(data.loggedOn && games.length));
  setEnabled("start", Boolean(data.loggedOn && selected.size));
  setEnabled("stop", Boolean(data.loggedOn && (data.idleIds || []).length));
  $("guardPanel").classList.toggle("hidden", !data.guard || data.guard.type === "confirmation");
  if (data.guard?.type === "confirmation") {
    message("loginMessage", "Approve the sign-in in your Steam mobile app. Keep this page open.");
  } else if (data.guard) {
    $("guardHint").textContent = data.guard.type === "email" ? `Check your email${data.guard.detail ? " (" + data.guard.detail + ")" : ""}.` : "Enter the code from your Steam mobile authenticator.";
  }
  renderGames();
}
async function refreshStatus() {
  try { updateStatus(await api("/api/status")); }
  catch (error) { message("connectionMessage", error.message, "error"); }
}
$("loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  message("loginMessage", "Connecting to Steam…");
  $("password").disabled = true;
  try {
    const result = await api("/api/login", { username: $("username").value, password: $("password").value });
    $("password").value = "";
    message("loginMessage", result.result || "Sign-in request submitted.", "success");
    await refreshStatus();
  } catch (error) { message("loginMessage", error.message, "error"); }
  finally { $("password").disabled = false; }
});
$("guardButton").addEventListener("click", async () => {
  message("loginMessage", "Submitting Steam Guard code…");
  try {
    await api("/api/guard", { code: $("guardCode").value });
    $("guardCode").value = "";
    message("loginMessage", "Code submitted. Waiting for Steam…", "success");
    await refreshStatus();
  } catch (error) { message("loginMessage", error.message, "error"); }
});
$("loadGames").addEventListener("click", async () => {
  message("gamesMessage", "Loading your owned games…");
  $("loadGames").disabled = true;
  try {
    const data = await api("/api/games", {});
    games = data.games;
    selected = new Set((data.idleIds || []).map(Number));
    message("gamesMessage", `Loaded ${games.length} games.`, "success");
    await refreshStatus();
  } catch (error) { message("gamesMessage", error.message, "error"); }
  finally { $("loadGames").disabled = !status.loggedOn; renderGames(); }
});
$("start").addEventListener("click", async () => {
  message("gamesMessage", "Updating idle sessions…");
  try {
    const result = await api("/api/idle", { appIds: [...selected] });
    status.idleIds = result.idleIds;
    message("gamesMessage", `Now idling ${result.idleIds.length} selected games.`, "success");
    await refreshStatus();
  } catch (error) { message("gamesMessage", error.message, "error"); }
});
$("stop").addEventListener("click", async () => {
  message("gamesMessage", "Stopping idling…");
  try {
    await api("/api/stop", {});
    status.idleIds = [];
    message("gamesMessage", "Idling stopped.", "success");
    await refreshStatus();
  } catch (error) { message("gamesMessage", error.message, "error"); }
});
$("logout").addEventListener("click", async () => {
  if (!confirm("Sign out and stop idling?")) return;
  try {
    await api("/api/logout", {});
    games = []; selected = new Set();
    message("connectionMessage", "Signed out.", "success");
    await refreshStatus();
  } catch (error) { message("connectionMessage", error.message, "error"); }
});
$("refresh").addEventListener("click", refreshStatus);
$("search").addEventListener("input", renderGames);
$("selectVisible").addEventListener("click", () => {
  const query = $("search").value.trim().toLowerCase();
  for (const game of games.filter(g => g.name.toLowerCase().includes(query) || String(g.appId).includes(query))) {
    if (selected.size >= 32) break;
    selected.add(game.appId);
  }
  renderGames();
});
$("clearSelection").addEventListener("click", () => { selected.clear(); renderGames(); });
refreshStatus();
setInterval(refreshStatus, 5000);
