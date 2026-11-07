#!/usr/bin/env node
/**
 * Publication hygiene check.
 *
 * Fails if the built site exposes content-import or source-platform metadata:
 * migration/import notices, "originally published on …" lines, archive links to
 * another platform, or the platform's URLs in HTML, feeds, sitemap or JSON.
 *
 * This is a brand requirement, not a technical one — the journal presents itself
 * as the author's own publication.
 */
import { readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { readFile } from "node:fs/promises";

const ROOT = process.argv[2] ?? "dist";

/**
 * Extra terms (e.g. the name of a platform content once lived on) can be supplied
 * without committing them: list them in `.disclosures` at the repo root or pass
 * DISCLOSURE_TERMS="foo,bar". The generic patterns below always run.
 */
async function extraTerms() {
  const terms = [];
  const fromEnv = process.env.DISCLOSURE_TERMS;
  if (fromEnv)
    terms.push(
      ...fromEnv
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    );
  try {
    const file = await readFile(join(process.cwd(), ".disclosures"), "utf8");
    terms.push(
      ...file
        .split(/[\n,]/)
        .map((t) => t.trim())
        .filter((t) => t && !t.startsWith("#"))
    );
  } catch {
    /* no local list configured */
  }
  return terms;
}

const FORBIDDEN = [
  { label: "migration phrased as a platform", pattern: /migrated from [A-Z]/ },
  { label: "migration notice", pattern: /\bmigrated (from|unchanged)\b/i },
  { label: "import notice", pattern: /\bimported from\b/i },
  { label: "original-publication notice", pattern: /\boriginally (published|posted) on\b/i },
  { label: "archive attribution", pattern: /\b(archive|source) (page|profile) on\b/i },
  {
    label: "migration metadata field",
    pattern: /\bsourceUrl\b|\bsourceReleasedAt\b|\bsourceUpdatedAt\b/,
  },
];

const SCAN = new Set([".html", ".xml", ".json", ".txt", ".js", ".webmanifest"]);

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      // The Pagefind index is binary-ish and generated from page content; scan
      // its JS/meta JSON but not the compressed fragments.
      if (entry.name === "pagefind") {
        for (const inner of await readdir(path, { withFileTypes: true })) {
          if (inner.isFile() && [".js", ".json"].includes(extname(inner.name))) {
            yield join(path, inner.name);
          }
        }
        continue;
      }
      yield* walk(path);
    } else if (SCAN.has(extname(entry.name))) {
      yield path;
    }
  }
}

const terms = await extraTerms();
for (const term of terms) {
  FORBIDDEN.push({
    label: `configured term: ${term}`,
    pattern: new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
  });
}

const hits = [];
let scanned = 0;

for await (const file of walk(ROOT)) {
  const text = await readFile(file, "utf8");
  scanned += 1;
  for (const rule of FORBIDDEN) {
    const match = text.match(rule.pattern);
    if (match) {
      const index = Math.max(0, (match.index ?? 0) - 60);
      hits.push({
        file: relative(ROOT, file),
        rule: rule.label,
        excerpt: text.slice(index, index + 140).replace(/\s+/g, " "),
      });
    }
  }
}

if (hits.length) {
  console.error(`✗ ${hits.length} publication-hygiene problem(s) in ${scanned} files:`);
  for (const hit of hits.slice(0, 20)) {
    console.error(`\n  ${hit.file} — ${hit.rule}`);
    console.error(`  …${hit.excerpt}…`);
  }
  process.exit(1);
}

console.log(`Publication hygiene: ${scanned} files scanned, no content-source disclosures found.`);
