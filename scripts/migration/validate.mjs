#!/usr/bin/env node
/**
 * Step 3 — prove the migration did not alter the author's writing.
 *
 * For every article the migrated Markdown body is compared against the source
 * payload after undoing the one permitted transformation (local image path ->
 * original URL). Any difference in title, body, tags, date or source link is a
 * failure. Writes migration-report/REPORT.md + validation.json.
 */
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SOURCE = join(HERE, "source");
const CONTENT = join(ROOT, "src", "content", "blog");
const REPORT = join(ROOT, "migration-report");

const stripBom = (s) => s.replace(/^\uFEFF/, "");
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

function splitFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n+/);
  if (!m) return { fm: "", body: text };
  return { fm: m[1], body: text.slice(m[0].length) };
}

/** Minimal YAML field reader for the flat scalar/array fields we emit. */
function field(fm, name) {
  const re = new RegExp(`^${name}:\\s*(.+)$`, "m");
  const m = fm.match(re);
  if (!m) return null;
  let v = m[1].trim();
  if (v === "null") return null;
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return [...inner.matchAll(/"(?:[^"\\]|\\.)*"/g)].map((x) => JSON.parse(x[0]));
  }
  if (v.startsWith('"')) return JSON.parse(v);
  return v;
}

const IMG_LINE = /!\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g;

async function main() {
  const files = (await readdir(CONTENT)).filter((f) => f.endsWith(".md"));
  const imageLog = JSON.parse(await readFile(join(REPORT, "images.json"), "utf8"));
  const back = new Map(imageLog.map((i) => [i.local, i.source]));

  const rows = [];
  const problems = [];

  for (const file of files) {
    const slug = file.replace(/\.md$/, "");
    const md = stripBom(await readFile(join(CONTENT, file), "utf8"));
    const { fm, body } = splitFrontmatter(md);
    const sourceUrl = field(fm, "sourceUrl");
    const sourceId = sourceUrl?.match(/\/p\/[^/]*?-([A-Za-z0-9]+)$/)?.[1];
    const srcFile = join(SOURCE, `${sourceId}.json`);

    let src;
    try {
      src = JSON.parse(stripBom(await readFile(srcFile, "utf8"))).post.data;
    } catch {
      problems.push({ slug, problem: `source payload missing (${srcFile})` });
      continue;
    }

    // Undo the only permitted edit: local image path -> original remote URL.
    let restored = body;
    const localRefs = [...body.matchAll(IMG_LINE)].map((m) => m[2]);
    for (const local of localRefs) {
      const remote = back.get(local);
      if (!remote) {
        problems.push({ slug, problem: `local image not in manifest: ${local}` });
        continue;
      }
      restored = restored.split(local).join(remote);
    }

    const origBody = (src.contents ?? "").trim();
    const migratedBody = body.trim();
    const bodyIdentical = restored.trim() === origBody;

    const checks = {
      title: field(fm, "title") === src.title,
      body: bodyIdentical,
      tags:
        JSON.stringify(field(fm, "tags") ?? []) ===
        JSON.stringify((src.tags?.data ?? []).map((t) => t.name)),
      sourceUrl: sourceUrl === (src.canonical_url ?? `https://viblo.asia/p/${src.slug}`),
      published:
        Math.abs(
          new Date(field(fm, "pubDatetime") ?? 0).getTime() - new Date(src.published_at).getTime()
        ) < 1000,
      hasCategory: Boolean(field(fm, "category")),
      hasDescription: Boolean(field(fm, "description")),
      noHotlink: !/(images\.|)viblo\.asia\/[^\s)"']*\.(png|jpe?g|webp|gif)/i.test(migratedBody),
    };

    // Missing image files?
    let imagesMissing = 0;
    for (const local of localRefs) {
      try {
        const st = await stat(join(ROOT, "public", local));
        if (st.size < 64) imagesMissing++;
      } catch {
        imagesMissing++;
      }
    }
    const cover = field(fm, "coverImage");
    if (cover) {
      try {
        const st = await stat(
          cover.startsWith("../") ? join(CONTENT, cover) : join(ROOT, "public", cover)
        );
        if (st.size < 64) imagesMissing++;
      } catch {
        imagesMissing++;
      }
    }

    const charDelta = migratedBody.length - origBody.length;
    const ok = Object.values(checks).every(Boolean) && imagesMissing === 0;
    if (!ok) {
      problems.push({
        slug,
        problem: "integrity check failed",
        failed: Object.entries(checks)
          .filter(([, v]) => !v)
          .map(([k]) => k),
        imagesMissing,
      });
    }

    rows.push({
      slug,
      title: src.title,
      published: (field(fm, "pubDatetime") ?? "").slice(0, 10),
      category: field(fm, "category") ?? "",
      tagsList: field(fm, "tags") ?? [],
      sourceUrl,
      chars: origBody.length,
      charDelta,
      bodySha: sha(origBody),
      identical: bodyIdentical,
      checks,
      images: localRefs.length + (cover ? 1 : 0),
      imagesMissing,
      ok,
    });
  }

  rows.sort((a, b) => a.slug.localeCompare(b.slug));
  const totals = {
    migrated: rows.length,
    identical: rows.filter((r) => r.identical).length,
    images: rows.reduce((n, r) => n + r.images, 0),
    imagesMissing: rows.reduce((n, r) => n + r.imagesMissing, 0),
    failed: rows.filter((r) => !r.ok).length,
    totalChars: rows.reduce((n, r) => n + r.chars, 0),
  };

  const manifest = JSON.parse(await readFile(join(REPORT, "manifest.json"), "utf8"));
  const validation = {
    source: "https://viblo.asia/u/lowkey_dev",
    validatedAt: new Date().toISOString(),
    ...totals,
    problems,
    articles: rows,
  };
  await writeFile(join(REPORT, "validation.json"), JSON.stringify(validation, null, 2));

  const list = JSON.parse(await readFile(join(SOURCE, "_list.json"), "utf8"));
  const discovered = new Set(list.map((p) => p.slug));
  const migratedIds = new Set(
    rows.map((r) => r.sourceUrl?.match(/-([A-Za-z0-9]+)$/)?.[1]).filter(Boolean)
  );
  const notMigrated = [...discovered].filter((id) => !migratedIds.has(id));

  const md = [];
  md.push("# Migration report — Viblo → java-guru");
  md.push("");
  md.push(`- Source profile: <https://viblo.asia/u/lowkey_dev> (Hưng Phạm, @lowkey_dev)`);
  md.push(`- Generated: ${new Date().toISOString()}`);
  md.push(`- Target: \`src/content/blog/*.md\` + \`public/images/articles/*\``);
  md.push("");
  md.push("## Summary");
  md.push("");
  md.push("| Metric | Value |");
  md.push("| --- | --- |");
  md.push(`| Articles discovered | ${list.length} |`);
  md.push(`| Articles migrated | ${totals.migrated} |`);
  md.push(`| Articles failed | ${totals.failed} |`);
  md.push(`| Body text identical to source | ${totals.identical}/${totals.migrated} |`);
  md.push(`| Images stored locally | ${totals.images} |`);
  md.push(`| Missing images | ${totals.imagesMissing} |`);
  md.push(`| Incomplete articles | ${manifest.incomplete_articles} |`);
  md.push(`| Duplicates | ${manifest.duplicates} |`);
  md.push(`| Characters of original prose | ${totals.totalChars.toLocaleString("en-US")} |`);
  md.push("");
  md.push(
    totals.identical === totals.migrated && totals.imagesMissing === 0 && !problems.length
      ? "**Validation status: PASS** — every migrated body is byte-identical to the retrieved original once local image paths are mapped back to their source URLs."
      : "**Validation status: FAIL** — see `validation.json`."
  );
  md.push("");
  md.push("## Articles");
  md.push("");
  md.push("| # | Title | Published | Category | Tags | Chars | Images | Body identical |");
  md.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  rows.forEach((r, i) => {
    md.push(
      `| ${i + 1} | [${r.title.replace(/\|/g, "\\|")}](${r.sourceUrl}) | ${r.published} | ${r.category} | ${(r.tagsList ?? []).join(", ") || "—"} | ${r.chars} | ${r.images} | ${r.identical ? "yes" : "NO"} |`
    );
  });
  md.push("");
  md.push("## Discovered source URLs");
  md.push("");
  for (const p of list) md.push(`- ${p.url}`);
  md.push("");
  md.push("## Not migrated");
  md.push("");
  if (notMigrated.length === 0)
    md.push("None — every article published on the profile is present in the repository.");
  else for (const id of notMigrated) md.push(`- ${id}`);
  md.push("");
  md.push("## Duplicates");
  md.push("");
  md.push(
    manifest.duplicates === 0
      ? "None detected (unique titles and slugs)."
      : `${manifest.duplicates} detected.`
  );
  md.push("");
  md.push("## How this was produced");
  md.push("");
  md.push("```bash");
  md.push(
    "node scripts/migration/fetch.mjs     # public Viblo JSON API -> scripts/migration/source/"
  );
  md.push("node scripts/migration/migrate.mjs   # snapshot -> src/content/blog/*.md + images");
  md.push("node scripts/migration/validate.mjs  # integrity proof -> migration-report/");
  md.push("```");
  md.push("");
  md.push(
    "- Discovery used the profile's own paginated JSON feed (`/api/users/lowkey_dev/posts?limit=100`), so no page was skipped by pagination."
  );
  md.push(
    "- Article bodies came from `/api/posts/<slug>`, the same payload the public article page renders — no HTML scraping and no anti-bot bypassing."
  );
  md.push(
    "- The API payloads are committed under `scripts/migration/source/` as the audit trail; `validation.json` holds per-article checks and content hashes."
  );
  md.push("");
  md.push("## Notes on fidelity");
  md.push("");
  md.push(
    "- Bodies are stored as returned by Viblo's public JSON API; no rewriting, summarising, translating, reflowing or grammatical edits were performed."
  );
  md.push(
    "- The single transformation is image URL rewriting: every inline image and cover was downloaded to `public/images/articles/<slug>/` and the reference updated to the local path."
  );
  md.push(
    "- `modDatetime` is set to `null` on purpose: Viblo re-saved every post in Nov 2026 (platform-wide `updated_at` bump with `edited_at: null`), which is not an author edit. The raw values are kept as `sourceUpdatedAt`."
  );
  md.push(
    "- `description` is a verbatim excerpt of the article's first paragraph, used only for cards and meta tags — the body itself is untouched."
  );
  md.push(
    "- `category` is assigned from the article's dominant topic (Viblo has no category field for personal posts); original tags are kept unchanged."
  );
  md.push("");

  await writeFile(join(REPORT, "REPORT.md"), md.join("\n"));

  console.log(`validated ${rows.length} articles`);
  console.log(JSON.stringify(totals, null, 2));
  if (problems.length) {
    console.error("PROBLEMS:", JSON.stringify(problems, null, 2));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
