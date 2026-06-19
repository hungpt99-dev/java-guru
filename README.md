# Java Guru

A multilingual technical blog about practical Java backend engineering.

Built with [AstroPaper i18n](https://github.com/yousef8/astro-paper-i18n) — a fork of [AstroPaper](https://github.com/satnaing/astro-paper) with multilingual support.

## Overview

Java Guru shares practical knowledge for Java backend developers, covering:

- **Java Core** — OOP, Collection, Stream, Exception, Generics, JVM
- **Spring Boot** — REST API, Security, Transaction, JPA, Backend Architecture
- **Database** — MySQL, PostgreSQL, Indexes, Query Optimization
- **System Design** — Cache, Queue, Retry, Idempotency, Distributed Systems
- **Performance** — JVM Tuning, GC, Slow Queries, Memory Leaks, Profiling
- **Clean Code** — Refactoring, Design Patterns, Testing, Maintainable Code
- **Career** — Roadmap, Interviews, Real-world Experience

## Tech Stack

- [Astro](https://astro.build/) — Static site generator
- [TypeScript](https://www.typescriptlang.org/) — Type safety
- [Tailwind CSS](https://tailwindcss.com/) — Utility-first styling
- [Markdown / MDX](https://docs.astro.build/en/guides/markdown-content/) — Content authoring
- [Pagefind](https://pagefind.app/) — Static search
- [Satori](https://github.com/vercel/satori) — Dynamic OG image generation

## Supported Languages

| Language   | Locale | Default Route | Example         |
| ---------- | ------ | ------------- | --------------- |
| Tiếng Việt | `vi`   | `/`           | `/posts/...`    |
| English    | `en`   | `/en/`        | `/en/posts/...` |

## Install

```bash
pnpm install
```

## Run Locally

```bash
pnpm dev
```

Visit `http://localhost:4321` for Vietnamese (default) and `http://localhost:4321/en/` for English.

## Create a Vietnamese Post

Create a `.md` file under `src/data/blog/vi/`:

```bash
src/data/blog/vi/java-core/my-post.md
```

Frontmatter example:

```md
---
title: "Tiêu đề bài viết"
description: "Mô tả ngắn gọn."
pubDatetime: 2026-06-19T10:00:00+07:00
featured: false
draft: false
tags:
  - java
  - java-core
---
```

## Create an English Post

Create a `.md` file under `src/data/blog/en/`:

```bash
src/data/blog/en/java-core/my-post.md
```

Frontmatter example:

```md
---
title: "Post Title"
description: "A short description."
pubDatetime: 2026-06-19T10:00:00+07:00
featured: false
draft: false
tags:
  - java
  - java-core
---
```

## Build

```bash
pnpm build
```

## Preview Production Build

```bash
pnpm preview
```

## Deploy to Cloudflare Pages

| Setting                | Value        |
| ---------------------- | ------------ |
| Framework preset       | Astro        |
| Build command          | `pnpm build` |
| Build output directory | `dist`       |
| Production branch      | `main`       |

## Folder Structure

```
java-guru/
├── public/                  # Static assets (favicon, images, fonts)
├── src/
│   ├── assets/              # Icons and images
│   ├── components/          # Astro components
│   ├── content.config.ts    # Content collection schema
│   ├── config.ts            # Site configuration
│   ├── constants.ts         # Social links and share links
│   ├── data/
│   │   ├── about/           # About pages (about-vi.md, about-en.md)
│   │   └── blog/
│   │       ├── vi/          # Vietnamese blog posts
│   │       │   ├── java-core/
│   │       │   ├── spring-boot/
│   │       │   ├── database/
│   │       │   ├── system-design/
│   │       │   ├── performance/
│   │       │   ├── clean-code/
│   │       │   └── career/
│   │       └── en/          # English blog posts
│   │           ├── java-core/
│   │           ├── spring-boot/
│   │           ├── database/
│   │           ├── system-design/
│   │           ├── performance/
│   │           ├── clean-code/
│   │           └── career/
│   ├── i18n/
│   │   ├── config.ts        # Locale configuration
│   │   ├── locales/
│   │   │   ├── vi.ts        # Vietnamese translations
│   │   │   └── en.ts        # English translations
│   │   ├── types.ts         # Translation type definitions
│   │   └── utils.ts         # i18n utility functions
│   ├── layouts/             # Page layouts
│   ├── pages/               # Route pages
│   ├── styles/              # Global styles
│   └── utils/               # Utility functions
├── astro.config.ts          # Astro configuration
├── package.json
├── tsconfig.json
└── tailwind.config.ts
```

## Author

**Phạm Thanh Hưng (Harry)**  
Software Engineer (Full-stack)  
GitHub: [hungpt99-dev](https://github.com/hungpt99-dev)  
Email: [thanhhungpham6@gmail.com](mailto:thanhhungpham6@gmail.com)
