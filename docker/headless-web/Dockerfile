# syntax=docker/dockerfile:1.7
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:8.0-bookworm-slim AS steam-build
ARG TARGETARCH
WORKDIR /src
COPY libs/SteamUtility/ ./libs/SteamUtility/
RUN case "${TARGETARCH}" in \
      arm64) RID=linux-arm64 ;; \
      amd64) RID=linux-x64 ;; \
      *) echo "Unsupported target architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && dotnet publish ./libs/SteamUtility/SteamUtility.csproj \
      -c Release -r "$RID" --self-contained true \
      -p:PlatformTarget=AnyCPU -p:PublishSingleFile=false \
      -p:PublishTrimmed=false -p:DebugType=none \
      -o /out \
    && test -f /out/SteamUtility \
    && chmod +x /out/SteamUtility

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data STEAMUTILITY_PATH=/app/SteamUtility
WORKDIR /app
COPY --from=steam-build /out/ /app/
COPY docker/headless-web/server.mjs ./server.mjs
COPY docker/headless-web/public ./public
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "/app/server.mjs"]
