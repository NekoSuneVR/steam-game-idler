# syntax=docker/dockerfile:1.7
# Full application build: the original Tauri UI and Rust command handlers are retained.
# The runtime exposes the virtual desktop through authenticated noVNC, rather than replacing
# the app with a feature-limited HTML dashboard.
FROM node:22-bookworm AS app-build
ARG TARGETARCH
ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /src

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl wget file build-essential pkg-config cmake \
      libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev \
      libwebkit2gtk-4.1-dev libxdo-dev libsecret-1-dev \
      dpkg-dev xz-utils \
    && curl -fsSL https://packages.microsoft.com/config/debian/12/packages-microsoft-prod.deb -o /tmp/msprod.deb \
    && dpkg -i /tmp/msprod.deb \
    && apt-get update && apt-get install -y --no-install-recommends dotnet-sdk-8.0 \
    && rm -rf /var/lib/apt/lists/* /tmp/msprod.deb

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal \
    && corepack enable
ENV PATH="/root/.cargo/bin:${PATH}"

COPY . .
RUN case "${TARGETARCH}" in \
      arm64) RID=linux-arm64 ;; \
      amd64) RID=linux-x64 ;; \
      *) echo "Unsupported target architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && dotnet publish ./libs/SteamUtility/SteamUtility.csproj \
      -c Release -r "$RID" --self-contained true \
      -p:PlatformTarget=AnyCPU -p:PublishSingleFile=false \
      -p:PublishTrimmed=false -p:DebugType=none \
      -o ./src-tauri/libs/ \
    && chmod +x ./src-tauri/libs/SteamUtility \
    && pnpm install --frozen-lockfile \
    && pnpm exec tauri build --bundles deb \
    && DEB="$(find src-tauri/target/release/bundle/deb -maxdepth 1 -name '*.deb' -print -quit)" \
    && test -n "$DEB" \
    && mkdir -p /out/rootfs \
    && dpkg-deb -x "$DEB" /out/rootfs \
    && APP_BIN="$(find /out/rootfs/usr/bin -maxdepth 1 -type f -executable -print -quit)" \
    && test -n "$APP_BIN" \
    && ln -s "$(basename "$APP_BIN")" /out/rootfs/usr/bin/sgi-docker \
    && test -n "$(find /out/rootfs/usr/lib -type f -name SteamUtility -print -quit)"

FROM node:22-bookworm-slim AS runtime
ENV DEBIAN_FRONTEND=noninteractive NODE_ENV=production PORT=8080 \
    DISPLAY=:99 HOME=/data/home XDG_CONFIG_HOME=/data/config \
    XDG_DATA_HOME=/data/share XDG_CACHE_HOME=/data/cache
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1 \
      librsvg2-2 libxdo3 libsecret-1-0 libssl3 libdbus-1-3 \
      libx11-6 libxext6 libxrender1 libxtst6 libxi6 libxrandr2 libxfixes3 \
      libxcursor1 libxcomposite1 libxdamage1 libxkbcommon0 libnss3 libasound2 \
      libgbm1 libdrm2 libegl1 libgl1 libglx0 libwayland-client0 \
      libwayland-cursor0 libwayland-egl1 libxshmfence1 libfontconfig1 fonts-liberation \
      xvfb x11vnc xcompmgr openbox novnc websockify dbus-x11 tini \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 --shell /usr/sbin/nologin app \
    && mkdir -p /data /run/steam-game-idler \
    && chown -R app:app /data /run/steam-game-idler

COPY --from=app-build /out/rootfs/ /
COPY docker/headless-web/remote-entrypoint.sh /usr/local/bin/remote-entrypoint.sh
COPY docker/headless-web/server.mjs /app/server.mjs
RUN chmod 0755 /usr/local/bin/remote-entrypoint.sh && mkdir -p /app && chown -R app:app /app \\
    && node --check /app/server.mjs \\
    && bash -n /usr/local/bin/remote-entrypoint.sh

USER app
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/remote-entrypoint.sh"]
