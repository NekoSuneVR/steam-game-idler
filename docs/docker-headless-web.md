# Docker deployment with the original Steam Game Idler UI

This optional Docker deployment builds the **actual Steam Game Idler Tauri application**, including its existing frontend, Rust command handlers and SteamUtility daemon. It does not substitute a reduced HTML dashboard. The application runs in a private virtual Linux desktop, and noVNC streams that desktop to an authenticated browser so the original UI and its existing feature screens remain in place.

GitHub Actions builds and publishes a multi-platform image to GitHub Container Registry (GHCR) for the development branch:

`ghcr.io/nekosunevr/steam-game-idler-headless:dev`

## Feature compatibility

Because this runs the original app and backend, features that work in the app's Linux Steam-agent mode remain available, including playtime idling, trading-card farming, achievement management/unlocking, inventory management, automatic idling, favorites, settings, account management, and the existing theme/UI customizations.

Important platform differences:

- Sign in with the Steam-agent username/password or QR flow. The Steam desktop client is not installed in the container.
- Features that specifically require reading or launching a local Steam desktop installation, a local Steam process, system tray integration, native OS autostart, or the desktop updater cannot work as they do on a normal desktop installation.
- Steam may restrict particular achievement operations for some games, and the application's existing game-specific limitations still apply.
- The browser is viewing a streamed virtual desktop, not a rewritten responsive web frontend. Set `SCREEN_SIZE` to choose the virtual desktop size.

## Deploy

On your Raspberry Pi or Linux server with Docker Compose:

```sh
cp docker/headless-web/.env.example .env
```

Edit `.env` and set `WEB_PASSWORD` to a unique random password of at least 12 characters. Keep the file private.

For access only on the server, leave `BIND_ADDRESS=127.0.0.1`. To access it from another device on your trusted LAN, set `BIND_ADDRESS` to the server's LAN IP address. Then run:

```sh
docker compose -f docker-compose.headless.yml pull
docker compose -f docker-compose.headless.yml up -d
docker compose -f docker-compose.headless.yml logs -f
```

Open `http://<server-lan-address>:8080`. Your browser will prompt for the `WEB_USER` and `WEB_PASSWORD` from `.env`, then open the original Steam Game Idler interface.

The published image targets `linux/arm64` and `linux/amd64`. On first boot, the app initializes its normal configuration under the persistent `/data` volume.

## Security and persistence

- The gateway requires HTTP Basic Authentication for the UI assets and WebSocket connection.
- The VNC server and WebSocket bridge listen only on container loopback; only the authenticated gateway is published.
- The app runs as an unprivileged user. The container drops Linux capabilities, uses a read-only root filesystem, and has no Docker socket mount.
- `/data` persists application settings, caches and account data created by the original application. Treat this volume as sensitive and protect backups accordingly.
- Bind to loopback by default. Do not forward port 8080 to the public internet. Basic Authentication does not encrypt HTTP traffic; use a trusted LAN or terminate HTTPS with a trusted reverse proxy when traffic crosses an untrusted network.
- Use a dedicated Steam account for initial testing and enable Steam Guard. This is an experimental container deployment and is not a substitute for a tested desktop install.

## Operations

```sh
docker compose -f docker-compose.headless.yml logs -f
docker compose -f docker-compose.headless.yml restart
docker compose -f docker-compose.headless.yml down
```

The named volume `steam-game-idler-data` remains after `down`. Remove it only if you intend to delete the app's persistent settings and account data too.
