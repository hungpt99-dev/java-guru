#!/usr/bin/env node
/**
 * Bilingual content validation.
 *
 * For every article folder under src/content/posts this checks that:
 *   1. both vi.md and en.md exist and have complete metadata;
 *   2. translationKey/slug/category/tags/pubDate/cover agree across the pair;
 *   3. fenced code blocks are identical (count, language tag and exact body);
 *   4. every link target and image path is preserved;
 *   5. heading count, heading levels and table shape match;
 *   6. neither body is empty or truncated (length ratio sanity check).
 *
 * Exit code 1 on any failure, so CI and `pnpm validate` fail loudly.
 *
 * Run with --report <path> to also write a JSON summary.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = join(ROOT, "src/content/posts");

/* ------------------------------------------------------------------ helpers */

function splitFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return { fm: "", body: text };
  return { fm: match[1], body: text.slice(match[0].length) };
}

function yamlValue(fm, key) {
  const match = fm.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  if (!match) return null;
  const raw = match[1].trim();
  if (raw === "null") return null;
  if (raw.startsWith("[")) {
    const inner = raw.slice(1, -1).trim();
    return inner ? [...inner.matchAll(/"(?:[^"\\]|\\.)*"/g)].map((m) => JSON.parse(m[0])) : [];
  }
  if (raw.startsWith('"')) return JSON.parse(raw);
  return raw;
}

/** Fenced blocks: language tag + exact body, order preserved. */
function codeBlocks(markdown) {
  const blocks = [];
  const re = /^```([^\n]*)\n([\s\S]*?)^```[ \t]*$/gm;
  let match;
  while ((match = re.exec(markdown))) {
    blocks.push({ lang: match[1].trim(), code: match[2] });
  }
  return blocks;
}

const withoutCode = (markdown) => markdown.replace(/^```[^\n]*\n[\s\S]*?^```[ \t]*$/gm, "");

const linkTargets = (markdown) =>
  [...withoutCode(markdown).matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)]
    .map((m) => m[1])
    .sort();

const imagePaths = (markdown) =>
  [...withoutCode(markdown).matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]).sort();

const headings = (markdown) =>
  [...withoutCode(markdown).matchAll(/^(#{1,6})\s+(.+)$/gm)].map((m) => m[1].length);

/** Table shape: number of rows and columns per table, in document order. */
function tableShapes(markdown) {
  const shapes = [];
  let current = null;
  for (const line of withoutCode(markdown).split("\n")) {
    const isRow = /^\s*\|.*\|\s*$/.test(line);
    if (isRow) {
      const columns = line
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|").length;
      if (!current) {
        current = { rows: 1, columns };
        shapes.push(current);
      } else {
        current.rows += 1;
      }
    } else if (current) {
      current = null;
    }
  }
  return shapes;
}

const wordCount = (markdown) => (withoutCode(markdown).match(/\S+/g) ?? []).length;

/* -------------------------------------------------------------------- checks */

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const folders = (await readdir(CONTENT, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const report = [];
const failures = [];

for (const slug of folders) {
  const dir = join(CONTENT, slug);
  const problems = [];

  let vi;
  let en;
  try {
    vi = await readFile(join(dir, "vi.md"), "utf8");
    en = await readFile(join(dir, "en.md"), "utf8");
  } catch {
    failures.push({ slug, problems: ["missing vi.md or en.md"] });
    report.push({ slug, ok: false, problems: ["missing locale file"] });
    continue;
  }

  const viParts = splitFrontmatter(vi);
  const enParts = splitFrontmatter(en);

  // --- metadata -----------------------------------------------------------
  for (const [name, parts] of [
    ["vi", viParts],
    ["en", enParts],
  ]) {
    for (const key of [
      "title",
      "description",
      "slug",
      "locale",
      "translationKey",
      "pubDate",
      "category",
    ]) {
      if (!yamlValue(parts.fm, key)) problems.push(`${name}: missing ${key}`);
    }
    if (!parts.body.trim()) problems.push(`${name}: empty body`);
  }

  for (const key of ["slug", "translationKey", "category", "pubDate", "coverImage"]) {
    if (yamlValue(viParts.fm, key) !== yamlValue(enParts.fm, key)) {
      problems.push(`metadata mismatch on ${key}`);
    }
  }
  if (!same(yamlValue(viParts.fm, "tags") ?? [], yamlValue(enParts.fm, "tags") ?? [])) {
    problems.push("tag list differs between locales");
  }
  if (yamlValue(viParts.fm, "locale") !== "vi") problems.push("vi.md locale is not 'vi'");
  if (yamlValue(enParts.fm, "locale") !== "en") problems.push("en.md locale is not 'en'");
  if (yamlValue(viParts.fm, "slug") !== slug) problems.push("slug does not match folder name");

  // --- code blocks --------------------------------------------------------
  const viCode = codeBlocks(viParts.body);
  const enCode = codeBlocks(enParts.body);
  if (viCode.length !== enCode.length) {
    problems.push(`code block count ${viCode.length} -> ${enCode.length}`);
  } else {
    viCode.forEach((block, index) => {
      if (block.lang !== enCode[index].lang) {
        problems.push(
          `code block #${index + 1}: language "${block.lang}" -> "${enCode[index].lang}"`
        );
      }
      if (block.code !== enCode[index].code) {
        problems.push(`code block #${index + 1}: body changed`);
      }
    });
  }

  // --- links, images, structure ------------------------------------------
  if (!same(linkTargets(viParts.body), linkTargets(enParts.body))) {
    const viLinks = linkTargets(viParts.body);
    const enLinks = linkTargets(enParts.body);
    const missing = viLinks.filter((l) => !enLinks.includes(l));
    problems.push(
      `link targets differ${missing.length ? ` (missing: ${missing.slice(0, 3).join(", ")})` : ""}`
    );
  }
  if (!same(imagePaths(viParts.body), imagePaths(enParts.body))) {
    problems.push("image references differ");
  }

  const viHeadings = headings(viParts.body);
  const enHeadings = headings(enParts.body);
  if (!same(viHeadings, enHeadings)) {
    problems.push(`heading structure ${viHeadings.join("/")} -> ${enHeadings.join("/")}`);
  }

  if (!same(tableShapes(viParts.body), tableShapes(enParts.body))) {
    problems.push("table shape differs");
  }

  // --- completeness -------------------------------------------------------
  const viWords = wordCount(viParts.body);
  const enWords = wordCount(enParts.body);
  const ratio = viWords ? enWords / viWords : 0;
  if (ratio < 0.6 || ratio > 1.6) {
    problems.push(`length ratio ${ratio.toFixed(2)} (vi ${viWords} → en ${enWords} words)`);
  }

  report.push({
    slug,
    ok: problems.length === 0,
    title: yamlValue(enParts.fm, "title"),
    viWords,
    enWords,
    ratio: Number(ratio.toFixed(2)),
    codeBlocks: viCode.length,
    headings: viHeadings.length,
    problems,
  });
  if (problems.length) failures.push({ slug, problems });
}

const totals = {
  articles: report.length,
  valid: report.filter((entry) => entry.ok).length,
  invalid: failures.length,
  codeBlocks: report.reduce((sum, entry) => sum + (entry.codeBlocks ?? 0), 0),
};

const reportPathIndex = process.argv.indexOf("--report");
if (reportPathIndex > -1 && process.argv[reportPathIndex + 1]) {
  await writeFile(
    process.argv[reportPathIndex + 1],
    JSON.stringify({ generatedAt: new Date().toISOString(), totals, articles: report }, null, 2)
  );
}

console.log(
  `Bilingual validation: ${totals.valid}/${totals.articles} articles valid, ${totals.codeBlocks} code blocks compared`
);
if (failures.length) {
  for (const failure of failures) {
    console.error(`\n✗ ${failure.slug}`);
    for (const problem of failure.problems) console.error(`   - ${problem}`);
  }
  process.exit(1);
}
console.log(
  "All articles pass: both locales present, code and links identical, structure preserved."
);
