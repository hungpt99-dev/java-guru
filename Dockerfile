# syntax=docker/dockerfile:1

# ─── Build ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable

# Dependency layer first so source edits do not bust the install cache.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Public origin baked into canonical URLs, sitemap and RSS at build time.
ARG SITE_URL=https://java-guru.dev
ENV SITE_URL=${SITE_URL}

COPY . .

# `pnpm build` runs `astro build` and then Pagefind over the output.
RUN pnpm build

# ─── Runtime ──────────────────────────────────────────────────────────────────
# Caddy serves the static output with zstd/gzip, long-lived asset caching and a
# hardened header set. It runs as the unprivileged `caddy` user on port 8080.
FROM caddy:2.10-alpine AS runtime

COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv

# The official Caddy image ships without a non-root user, so create one and hand
# it only what a static file server needs.
RUN addgroup -S -g 10001 caddy \
 && adduser -S -D -H -u 10001 -G caddy caddy \
 && mkdir -p /config /data \
 && chown -R caddy:caddy /srv /config /data

USER caddy
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/healthz || exit 1

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
