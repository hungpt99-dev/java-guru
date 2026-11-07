# Java Guru

A personal engineering journal — backend engineering, distributed systems, the
Java and JVM ecosystem, security and AI — built as a static Astro site.

**26 articles**, written in Vietnamese, migrated **verbatim** from
[@lowkey_dev on Viblo](https://viblo.asia/u/lowkey_dev). Every body is verified
byte-identical to the published original — see
[`migration-report/REPORT.md`](migration-report/REPORT.md).

---

## Stack

| Concern      | Choice                                                            |
| ------------ | ----------------------------------------------------------------- |
| Framework    | [Astro](https://astro.build) 5 (static output)                    |
| Language     | TypeScript (strict)                                               |
| Styling      | Tailwind CSS 4 + a hand-written prose layer                       |
| Content      | Astro Content Collections (Markdown)                              |
| Highlighting | [Shiki](https://shiki.style) — five themes, one payload           |
| Search       | [Pagefind](https://pagefind.app) (static index)                   |
| Icons        | [Lucide](https://lucide.dev) (`@lucide/astro`)                    |
| Fonts        | Self-hosted: Bricolage Grotesque, Inter, JetBrains Mono, Fraunces |
| Deployment   | Docker → Caddy (non-root, read-only rootfs)                       |

No database, no runtime server, no client framework. The JS on an article page is
a few kilobytes of progressive enhancement (copy buttons, TOC scrollspy, theme
picker, search dialog, reading progress).

## Quick start

```bash
pnpm install
pnpm dev            # http://localhost:4321
pnpm build          # static build + Pagefind index
pnpm preview        # serve the production build
```

Node 20.19+ and pnpm 10 are expected (`corepack enable` is enough).

### Scripts

| Script                      | What it does                                                   |
| --------------------------- | -------------------------------------------------------------- |
| `pnpm dev`                  | Dev server with HMR                                            |
| `pnpm build`                | `astro build` then `pagefind --site dist`                      |
| `pnpm preview`              | Preview the built site                                         |
| `pnpm check`                | `astro check` (types + Astro diagnostics)                      |
| `pnpm lint` / `pnpm format` | ESLint / Prettier                                              |
| `pnpm migrate`              | Re-fetch from Viblo, rebuild Markdown, re-validate             |
| `pnpm migrate:build`        | Rebuild Markdown from the stored snapshot + validate (offline) |
| `pnpm fonts`                | Re-download the self-hosted font subsets                       |
| `pnpm assets`               | Regenerate avatar, favicons and the default OG image           |

## Project structure

```text
java-guru/
├── deploy/
│   ├── Caddyfile                 # container web server config
│   └── nginx.conf                # alternative host config (example)
├── docs/deployment.md            # Docker, TLS, reverse proxy, rollback
├── migration-report/             # manifest.json, validation.json, images.json, REPORT.md
├── public/
│   ├── fonts/                    # self-hosted woff2 (latin + vietnamese)
│   ├── images/articles/<slug>/   # inline article figures
│   ├── favicon/, favicon.svg, site.webmanifest
├── scripts/
│   ├── fonts.mjs                 # font downloader
│   ├── prepare-assets.mjs        # avatar, favicons, OG image
│   └── migration/
│       ├── fetch.mjs             # Viblo public API → source/ snapshot
│       ├── migrate.mjs           # snapshot → src/content/blog/*.md + images
│       ├── validate.mjs          # integrity proof → migration-report/
│       └── source/               # verbatim API payloads (audit trail)
├── src/
│   ├── assets/articles/<slug>/   # cover images (optimised at build)
│   ├── components/{layout,blog,article,navigation,common}/
│   ├── content/blog/*.md         # one file per article
│   ├── data/projects.ts          # curated, real GitHub metadata
│   ├── layouts/                  # BaseLayout, PostLayout
│   ├── pages/                    # /, /posts, /posts/[slug], /categories, /tags,
│   │                             # /archives, /projects, /homelab, /about, /search
│   ├── styles/                   # global.css (design tokens), fonts.css
│   ├── utils/                    # posts, slugs/dates, rehype plugins
│   └── config.ts                 # site identity, navigation, theme list
├── astro.config.ts
├── Dockerfile / docker-compose.yml / .env.example
└── README.md
```

## Content

### Frontmatter

```yaml
---
title: "Hiểu Saga Pattern trong 5 phút"
description: "First paragraph of the article, verbatim — used for cards and meta."
pubDatetime: 2025-09-02T18:59:56+07:00
modDatetime: null
category: "Microservices"
tags: ["saga pattern", "System Design"]
lang: "vi"
featured: true
draft: false
readingTime: 9
coverImage: "../../assets/articles/<slug>/cover.png"
series: null
sourceUrl: "https://viblo.asia/p/…"
sourceReleasedAt: "2025-09-02T11:59:56.000000Z"
sourceUpdatedAt: "2026-11-07T05:34:01.000000Z"
sourceTags: ["saga pattern", "System Design"]
---
```

`category` is assigned from the article's dominant topic (Viblo has no category
field for personal posts). `tags` and `sourceTags` are the original tag names,
unchanged — including their original casing and any typos. `modDatetime` is
deliberately `null`: Viblo re-saved every post in Nov 2026 with `edited_at: null`,
which is not an author edit; the raw values live in `sourceUpdatedAt`.

### Adding or editing an article

1. Create `src/content/blog/<slug>.md` with the frontmatter above.
2. Put the cover in `src/assets/articles/<slug>/cover.png` (imported via the schema).
3. Put inline figures in `public/images/articles/<slug>/` and reference them with
   an absolute path (`/images/articles/<slug>/figure-1.png`).
4. Run `pnpm dev` — the collection schema validates on save.

Draft posts: `draft: true` (excluded from build, listings and RSS).

### Migration pipeline

The Viblo articles are reproducible, not hand-copied:

```bash
pnpm migrate         # fetch → build → validate (network)
pnpm migrate:build   # build → validate from scripts/migration/source (offline)
```

`validate.mjs` compares each migrated body against the stored API payload after
mapping local image paths back to their original URLs, and fails on any
difference in title, body, tags, date, source link or missing image. CI runs it on
every push.

## Design system

Five themes, all driven by CSS custom properties in `src/styles/global.css`:

| Theme                 | Mode  | Background | Primary   |
| --------------------- | ----- | ---------- | --------- |
| Tokyo Night (default) | dark  | `#1A1B26`  | `#7AA2F7` |
| Catppuccin Mocha      | dark  | `#1E1E2E`  | `#89B4FA` |
| Nord                  | dark  | `#2E3440`  | `#81A1C1` |
| Gruvbox               | dark  | `#282828`  | `#FABD2F` |
| Daylight              | light | `#FAF9F6`  | `#2B5FD9` |

- The theme is applied by an inline script **before first paint**, so there is no
  wrong-theme flash; the choice is stored in `localStorage` under `jg-theme`.
- Section accents come from nine topic hues expressed in OKLCH
  (`--cat-java`, `--cat-system`, …) whose lightness and chroma adapt per theme, so
  chips stay legible on every palette.
- Syntax highlighting is generated by `src/utils/rehype-code.ts`: Shiki renders
  every code block once for **all five themes** into `--shiki-<theme>` custom
  properties, and CSS maps the active theme to its own variable. One HTML
  payload, five correct palettes, no client-side highlighter.

### Adding a theme

1. Append an entry to `THEMES` in `src/config.ts`.
2. Add an `html[data-theme="<id>"]` block in `src/styles/global.css` with the same
   token contract (`--bg`, `--fg`, `--primary`, `--cat-l`, `--cat-c`, …).
3. Add the theme to the Shiki map in `src/utils/rehype-code.ts`.
4. Add swatches in `src/components/navigation/ThemePicker.astro` and the allowed
   list in the inline script of `src/layouts/BaseLayout.astro`.

## Search

Pagefind indexes **article bodies only** (`data-pagefind-body` on the prose
container), with `category`, `date` and `lang` metadata. Two entry points share
one index: the ⌘K / Ctrl-K dialog in the header and `/search?q=…`. Matches are
highlighted by Pagefind at build time, so no query leaves the browser.

## SEO

- Canonical URLs, Open Graph and Twitter cards, per-article OG image from the cover.
- `BlogPosting` JSON-LD (author, dates, `inLanguage`, `isBasedOn` → original URL)
  plus `WebSite` structured data.
- `sitemap-index.xml` via `@astrojs/sitemap`, `robots.txt`, RSS at `/rss.xml`.
- `<html lang>` follows the article's own language (`vi`), so the Vietnamese
  content is declared correctly inside an English-language UI.

## Deployment

```bash
cp .env.example .env      # set SITE_URL
docker compose up -d --build
```

Full instructions — TLS with a host Caddy/Nginx, health checks, rollback and
troubleshooting — are in [`docs/deployment.md`](docs/deployment.md).

## Content provenance & licence

- Article text, titles, tags and images belong to **Hưng Phạm**, originally
  published on [Viblo](https://viblo.asia/u/lowkey_dev); this repository is the
  author's own mirror. Bodies are unmodified; the single transformation is
  rewriting image URLs to locally downloaded copies.
- Code in this repository is MIT licensed (see `LICENSE`).

Built with Astro, Shiki, Pagefind, Tailwind CSS, Lucide and Caddy.
