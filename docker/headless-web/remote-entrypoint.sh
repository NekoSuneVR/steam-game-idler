#!/bin/sh
set -eu

: "${WEB_USER:=admin}"
: "${WEB_PASSWORD:=}"
: "${SCREEN_SIZE:=1600x1000x24}"
export DISPLAY=:99
export HOME=/data/home
export XDG_CONFIG_HOME=/data/config
export XDG_DATA_HOME=/data/share
export XDG_CACHE_HOME=/data/cache

mkdir -p "$HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME"
chmod 0700 "$HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME"

Xvfb "$DISPLAY" -screen 0 "$SCREEN_SIZE" -ac +extension GLX +render -noreset &
XVFB_PID=$!
sleep 1

openbox-session &
WM_PID=$!
xcompmgr -n &
COMPOSITOR_PID=$!

# A private virtual X desktop runs the original application. Its own Rust/Tauri command
# handlers continue to power card farming, achievement tools, inventory, idling and settings.
dbus-run-session -- /usr/bin/steam-game-idler &
APP_PID=$!

x11vnc -display "$DISPLAY" -forever -shared -localhost -nopw -rfbport 5900 -xkb &
VNC_PID=$!
websockify 127.0.0.1:6081 127.0.0.1:5900 &
WEBSOCKIFY_PID=$!
node /app/server.mjs &
WEB_PID=$!

cleanup() {
  kill "$WEB_PID" "$WEBSOCKIFY_PID" "$VNC_PID" "$APP_PID" "$COMPOSITOR_PID" "$WM_PID" "$XVFB_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# If the app or any required display/web process dies, restart the container rather than
# leaving a healthy-looking but unusable dashboard.
wait -n "$APP_PID" "$WEB_PID" "$XVFB_PID" "$VNC_PID" "$WEBSOCKIFY_PID"
exit 1
