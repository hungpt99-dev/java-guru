# Deployment

The site is a fully static build: HTML, CSS, a little JS, self-hosted fonts, local
images and a Pagefind index. There is no database, no server runtime and no
secrets baked into the image.

Two layers are involved, and this project only owns the second one:

1. **Host reverse proxy** — already running on the VPS (Caddy, Nginx, Traefik…).
   It owns `:80` / `:443`, certificates and DNS.
2. **java-guru container** — Caddy serving `dist/` on `:8080`, published to
   `127.0.0.1:8080` by default.

Nothing in this repository changes firewall rules, SSH configuration, DNS, or the
configuration of any service already running on the host.

---

## 1. Requirements

| Requirement              | Notes                            |
| ------------------------ | -------------------------------- |
| Docker Engine ≥ 24       | `docker --version`               |
| Docker Compose v2 plugin | `docker compose version`         |
| ~1.5 GB free disk        | Build cache + image (~180 MB)    |
| Node 20.19+              | Only if you build outside Docker |

## 2. Build and run

```bash
git clone https://github.com/hungpt99-dev/java-guru.git
cd java-guru

cp .env.example .env
# edit .env: SITE_URL must be the public origin users will visit

docker compose up -d --build
docker compose ps                 # wait for "healthy"
curl -I http://127.0.0.1:8080/    # 200
```

`SITE_URL` is a **build** argument: it is baked into canonical URLs, the sitemap,
RSS links and JSON-LD. Changing the domain requires a rebuild
(`docker compose up -d --build`), not a restart.

### Environment variables

| Variable    | Default                 | Scope   | Purpose                                                         |
| ----------- | ----------------------- | ------- | --------------------------------------------------------------- |
| `SITE_URL`  | `https://java-guru.dev` | build   | Public origin for canonical URLs, sitemap, RSS, structured data |
| `BIND_ADDR` | `127.0.0.1`             | runtime | Host interface the container publishes on                       |
| `PORT`      | `8080`                  | runtime | Host port mapped to the container's `:8080`                     |

There are no runtime secrets. Do not add `.env` to git (it is ignored).

## 3. HTTPS

### Option A — host Caddy (recommended)

If the host already runs Caddy, add one block and reload:

```caddyfile
java-guru.dev {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8080
}
```

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy obtains and renews the certificate automatically once DNS points at the VPS.

### Option B — host Nginx + certbot

```nginx
server {
    listen 80;
    server_name java-guru.dev;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name java-guru.dev;

    ssl_certificate     /etc/letsencrypt/live/java-guru.dev/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/java-guru.dev/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo certbot --nginx -d java-guru.dev
```

### Option C — container as the public edge

Only when nothing else on the host binds `:80` / `:443`:

1. In `deploy/Caddyfile`, remove `auto_https off` and replace `:8080 {` with
   `java-guru.dev {`.
2. Set `BIND_ADDR=0.0.0.0` and map `80:8080` / `443:8443` in compose.
3. Caddy will provision certificates itself (requires ports 80 and 443 open).

Do not open ports that your existing firewall deliberately keeps closed; the
host reverse proxy is the safer default.

## 4. Updating

```bash
git pull
docker compose up -d --build
docker compose ps
```

Assets are content-hashed, so browsers pick up new CSS/JS immediately while old
hashed files stay cacheable. HTML is served with `must-revalidate`.

### Rollback

```bash
docker tag java-guru:latest java-guru:rollback   # before deploying a change
docker compose up -d --build                     # deploy
# if something is wrong:
docker tag java-guru:rollback java-guru:latest && docker compose up -d
```

## 5. Health check

The image ships a `HEALTHCHECK` hitting `/healthz` (returns `ok`), and compose
declares the same probe. A failing container is restarted by
`restart: unless-stopped` policy only if it exits; a hung-but-listening process
is visible via `docker compose ps` as `unhealthy`.

## 6. Post-deploy verification

```bash
curl -sI https://java-guru.dev/                 # 200, cache headers
curl -s  https://java-guru.dev/robots.txt       # Sitemap: .../sitemap-index.xml
curl -s  https://java-guru.dev/rss.xml | head   # valid RSS
curl -s  https://java-guru.dev/sitemap-index.xml | head
curl -s https://java-guru.dev/posts/ | grep -c 'post-row'   # listing rendered
```

Search only works in a production build: `pnpm build` runs Pagefind and writes
`dist/pagefind/`. In `pnpm dev` the search UI shows a hint instead of results.

## 7. Troubleshooting

| Symptom                                     | Cause / fix                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `permission denied` writing `/config`       | Root filesystem is read-only; compose provides `tmpfs` mounts. Keep them.                                           |
| 404 on `/posts/foo` but `/posts/foo/` works | The proxy is stripping the trailing slash; use `reverse_proxy` (Option A/B) rather than hand-written rewrite rules. |
| Old content after deploy                    | Browser/CDN cache on HTML — HTML is `max-age=0, must-revalidate`; purge the CDN if one sits in front.               |
| Search returns nothing                      | `dist/pagefind/` missing: the image build must run `pnpm build`, not `astro build` alone.                           |
| Container restarts every few seconds        | Usually a Caddyfile syntax error: `docker compose logs web`.                                                        |

## 8. Resource use

The runtime image is Caddy + static files: ~40 MB RAM at idle, no CPU between
requests, no persistent volumes.
