# AGENTS.md — java-guru (Astro blog)

You are working in an Astro static blog about Java / backend engineering.

## Project layout
- Blog posts live at `src/data/blog/{locale}/{category}/{slug}.md`.
- Locales: `en` (English), `vi` (Vietnamese). **`vi` is the DEFAULT locale** and is
  served at the site root `/`; `en` is served under `/en/`. Keep both in sync.
- Interview series: `src/data/blog/{en,vi}/interview/*.md` (8 topics × 2 locales = 16 files).

## Post frontmatter schema (REQUIRED)
```md
---
title: "..."            # required
description: "..."     # required, 1 sentence summary
pubDatetime: 2026-08-10T10:00:00+07:00   # required, ISO 8601 with offset
tags: ["java", "interview"]              # required, array of strings
draft: false           # optional
featured: false        # optional
---
```
Do NOT change `pubDatetime` (posts are scheduled in the past on purpose so they publish).
Do NOT invent frontmatter keys outside this schema.

## Style guide (match the existing 40+ posts)
- Friendly, conversational, metaphor-rich voice ("the JVM is like a restaurant kitchen…").
- **Code-heavy**: real Java snippets, not just prose. Show the WRONG way then the RIGHT way.
- Senior-level depth: internals (JVM/GC/JMM), real tradeoffs, production gotchas,
  "what interviewers actually probe", concrete numbers/benchmarks where relevant.
- Target a reader who already codes Java daily and is prepping for a senior/lead interview.
  Avoid beginner 101 ("what is a class"). Go deep on *why* and *tradeoffs*.
- Both `en` and `vi` versions must cover the SAME depth and the SAME code examples
  (translate faithfully; do not simplify the Vietnamese version).

## Build / verify
- Format: `pnpm format` (Prettier). CI fails if format is off.
- Type/lint: `pnpm lint`, `pnpm type-check`.
- Build: `pnpm build` (Astro). Must succeed.
- Do NOT leave the working tree with formatting errors.

## Hard rules
- Keep `pubDatetime` unchanged.
- Keep frontmatter keys within the schema above.
- Preserve the bilingual EN+VI pairing for every topic.
- Do not weaken existing content; expand and deepen it.
