# OpenCode brief — expand the remaining 5 interview posts to ~50 Q&A

Background: parts #1 (java-core), #2 (oop), #3 (spring-boot) are already at 50 Q&A
(15 Junior / 17 Mid / 18 Senior) with code + numbers. The other 5 posts were left at
only 18 Q&A (6 / 6 / 6) with shallow answers. This brief expands those 5 to ~50 and
raises answer quality to senior grade. Titles are ALREADY correct — do not change them.

## Topics to expand (run ONE OpenCode session per topic, serialized)

| # | slug             | EN title                                                            |
|---|------------------|---------------------------------------------------------------------|
| 4 | database         | Java Interview Prep #4: Database & SQL — Junior to Senior           |
| 5 | kafka            | Java Interview Prep #5: Apache Kafka — Junior to Senior             |
| 6 | microservices    | Java Interview Prep #6: Microservices — Junior to Senior            |
| 7 | system-design    | Java Interview Prep #7: System Design — Junior to Senior           |
| 8 | senior-mindset   | Java Interview Prep #8: Senior Mindset & Behavioral — Junior to Senior |

## Per-topic OpenCode command (run on your Mac, from repo root)

```
opencode run --auto \
  -m opencode/deepseek-v4-flash-free --variant max \
  --dir . --title JG-<slug> \
  "Read references/opencode-expand-remaining.md for your full brief. \
Apply it to topic '<slug>' (series #<N>): edit \
src/data/blog/en/interview/<slug>-senior.md and \
src/data/blog/vi/interview/<slug>-senior.md. Do NOT commit, push, or open a PR."
```

Substitute `<slug>` (database / kafka / microservices / system-design / senior-mindset)
and `<N>` (4 / 5 / 6 / 7 / 8) per the table above. Run them one at a time; confirm the
file mtime changed + `git diff --stat` shows both en+vi edits before starting the next.

## Full brief (what OpenCode must do for each topic)

You are expanding two bilingual interview-prep blog posts in an Astro site (the
"Java Interview Prep" series). Repo: current working directory. Do NOT commit, push,
or open a PR.

FILES TO EDIT (both):
- src/data/blog/en/interview/<slug>-senior.md   (English)
- src/data/blog/vi/interview/<slug>-senior.md   (Vietnamese — DEFAULT locale, must match EN depth)

CONTEXT: Part of an 8-part series (this is part #<N>). Each file currently has 18 Q&A
(6 Junior / 6 Mid / 6 Senior) with shallow/short answers. Your job: EXPAND to ~50 Q&A
(15 Junior / 17 Mid / 18 Senior) and RAISE answer quality. Do NOT change the title,
pubDatetime, tags, or any frontmatter key.

QUALITY STANDARDS (every answer must be senior-grade, consistent depth across all ~50):
- Tight, correct model answer.
- Concrete NUMBER / benchmark where relevant (e.g. "B-tree height ~4 for 1B rows",
  "~10k max connections on a typical Postgres", "G1 pause target ~150 ms",
  "default 30 s connection timeout", "REPEATABLE READ is MySQL's default isolation",
  "Kafka default max message 1 MB", "replication factor 3", "partition count = max(throughput/MBps-per-partition, consumers)").
- Show WRONG -> RIGHT real code/config where the topic is code-related:
  database -> SQL + JDBC; kafka -> producer/consumer config + code;
  microservices -> Java/config snippets; system-design -> back-of-envelope + code;
  senior-mindset -> scenario answers (a short code/config snippet only if it helps).
- Name a real PRODUCTION failure mode / "what breaks in production" for every Mid + Senior question.
- No beginner-101 filler ("what is a class"). Target a daily-Java reader prepping for senior/lead.

VI: faithful, RICH translation of the improved EN. Same ~50 questions, same code,
same numbers. Do not simplify (vi is the default locale). After writing each VI file,
re-read it and fix any stray English fragments.

KEEP structure: intro (1-2 sentences on why the topic decides the interview),
`> Mindset:` one-liner, `## Junior — foundations`, `## Mid — tradeoffs & pitfalls`,
`## Senior — design & defense`, `#### Self-check` (checklist per level).

Do NOT weaken or remove existing correct technical content; only deepen + add.
When done, print "JG_DONE <slug>" and stop. Do not run git.

## After each session (on the Mac, by you)
- Verify `grep -cE '^\*\*Q[0-9]' src/data/blog/{en,vi}/interview/<slug>-senior.md` ~= 50
  and frontmatter `pubDatetime` is unchanged (`git diff` should NOT touch it).
- Commit per topic:
  `git add src/data/blog/{en,vi}/interview/<slug>-senior.md`
  `git commit -m "docs(interview): expand <slug> to ~50 Q&A (15/17/18) with code + numbers (en+vi)"`
- The build is the real gate: `pnpm format && pnpm build` must pass (exit 0).
