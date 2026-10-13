# Headless Docker web dashboard (ARM64)

This optional deployment runs the existing SteamKit2-backed `SteamUtility agent` in a container and exposes a small browser dashboard for Steam sign-in and playtime idling. It does not run the Tauri desktop app or require the Steam desktop client.

## Current scope

- Steam username/password sign-in with Steam Guard code support and mobile confirmation prompt.
- Load owned games and start/stop playtime idling for up to 32 selected app IDs.
- ARM64 and x86-64 Docker builds.
- HTTP Basic Authentication on every dashboard/API route.
- Named volume for operational audit logs. Steam passwords and refresh tokens are not written to disk or logs.
- Re-authentication is required after a container restart. Credentials and refresh tokens are intentionally not persisted.
- This is a focused headless idler, not a web port of every Steam Game Idler feature. Desktop-client/Steamworks-dependent features are omitted.

## Deploy

From the repository root on your Raspberry Pi (64-bit Raspberry Pi OS or another 64-bit Linux OS with Docker Compose):

```sh
cp docker/headless-web/.env.example .env
```

Edit `.env` and set `WEB_PASSWORD` to a unique, random password of at least 12 characters. Keep the file private.

For access only on the Pi itself, keep `BIND_ADDRESS=127.0.0.1`. To access it from another device on your LAN, set `BIND_ADDRESS` to the Pi's LAN address (for example, `192.168.1.50`). Then run:

```sh
docker compose -f docker-compose.headless.yml up -d --build
docker compose -f docker-compose.headless.yml logs -f
```

Open `http://<pi-lan-address>:8080` from a device on the same trusted network. The browser prompts for the dashboard username/password configured in `.env`.

The container binds to loopback by default on purpose. Do not set `BIND_ADDRESS=0.0.0.0` unless you understand your host firewall and LAN exposure. Do not forward port 8080 to the public internet. HTTP Basic Authentication does not encrypt traffic; use a trusted LAN or terminate HTTPS with a reverse proxy if your environment requires it.

## Data and operations

- The named volume `steam-game-idler-data` stores a small audit log at `/data/events.log`. It does not store Steam credentials or refresh tokens.
- `docker compose -f docker-compose.headless.yml logs -f` shows service logs.
- `docker compose -f docker-compose.headless.yml down` stops and removes the container; the named volume remains.
- To delete the persistent audit log volume too, run `docker volume rm <compose-project>_steam-game-idler-data` after stopping the service.
- The container runs as an unprivileged user, drops Linux capabilities, uses a read-only root filesystem, and has no Docker socket mount.

## Troubleshooting

- If sign-in needs an authenticator, enter the Steam Guard code on the dashboard. If Steam requests mobile approval, approve it in the Steam app and leave the dashboard open.
- If the dashboard cannot load games, check container logs and verify the account can access its owned games through Steam.
- If Docker build fails on an ARM device, check that the OS and Docker engine are 64-bit.
- This is a new headless integration path and should be validated with a test Steam account before relying on it for long-running sessions.
