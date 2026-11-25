# syntax=docker/dockerfile:1
# Copyright (c) 2026. Licensed under AGPLv3.
#
# Self-hosted Open Keep: the web app, served by nginx on port 8080 as a non-root
# user. Setup and the OPENKEEP_* settings are in SELF_HOSTING.md.
#
#   docker build -t open-keep .
#   docker run -p 8080:8080 open-keep

# The build runs on the build machine's own platform: its output is plain files,
# the same for every CPU, so multi-platform images don't need emulation.
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS build
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

COPY . .
# The self-hosted flavor: no Supabase, WebDAV sync only (src/lib/build-flavor.ts).
ENV VITE_APP_FLAVOR=selfhost
# Not `pnpm build`: its prebuild step updates the iOS project's version, which
# isn't part of this build (ios/ isn't copied in).
RUN pnpm exec tsc -b && pnpm exec vite build

FROM nginxinc/nginx-unprivileged:stable-alpine
COPY docker/default.conf /etc/nginx/conf.d/default.conf
COPY --chmod=755 docker/40-open-keep-config.sh /docker-entrypoint.d/40-open-keep-config.sh
# Owned by the nginx user, so the start script can rewrite config.js.
COPY --from=build --chown=101:101 /app/dist /usr/share/nginx/html
EXPOSE 8080
