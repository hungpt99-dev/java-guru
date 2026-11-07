#!/usr/bin/env node
/**
 * Step 2 — build the Astro content collection from the stored Viblo snapshot.
 *
 * Invariants (checked again by validate.mjs / the Integrity section of the report):
 *   1. `title` and the Markdown body are the original strings, byte for byte.
 *      The ONLY permitted edit is rewriting image URLs to local paths.
 *   2. Tags, publication date, source URL, reading time and series come from the API.
 *   3. Cover images and inline images are downloaded, never hotlinked.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SOURCE = join(HERE, "source");
const CONTENT = join(ROOT, "src", "content", "blog");
const IMAGES = join(ROOT, "public", "images", "articles");
/** Cover images live in src/assets so Astro can resize/convert them at build time. */
const COVERS = join(ROOT, "src", "assets", "articles");
const REPORT = join(ROOT, "migration-report");

const PROFILE = "https://viblo.asia/u/lowkey_dev";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

/**
 * Category assignment. Viblo has no category field for personal posts, so each
 * article is mapped to the primary topic it is actually about — derived from
 * reading the article, never assigned at random.
 */
const CATEGORIES = {
  AY4qQO0r4Pw: "DevOps & Infrastructure", // Homelab on Ubuntu VPS
  bNVQGpn0JvR: "AI & AI Agents", // Rulesync, centralised agent config
  XP4WEZpxL7G: "Security", // AI-native security posture
  "1j4lQ1WWJwl": "Microservices", // consistency vs performance in service boundaries
  y0VGwg30VPA: "AI & AI Agents", // Kiro / spec-driven development
  y0VGwgq0VPA: "AI & AI Agents", // Ralph loop
  pPLkNb5GJRZ: "AI & AI Agents", // setting up an agent
  oKLnqr5WJQO: "AI & AI Agents", // Laya decision making
  K9Vy82lALQR: "AI & AI Agents", // AI-native SDLC
  XRJ8Rd1ZVGq: "Engineering Practices", // team knowledge base
  K9Vy82aqLQR: "Security", // agent as an attack surface
  Nj4vgaOqJ6r: "Java & JVM", // threads and concurrency
  oKLnqZyWJQO: "Distributed Systems", // Kafka in production
  Nj4vggZdJ6r: "Security", // security responsibilities per role
  oKLnqqBgJQO: "System Design", // high-load architecture
  ym4000gA491: "Microservices", // Segment back to monolith
  bA468xvlLKv: "Java & JVM", // servlet containers
  oKLnqBoQJQO: "Java & JVM", // Project Loom
  gdJzvbgGJz5: "Java & JVM", // GraalVM
  Nj4vg2x0J6r: "Security", // zero trust
  XRJ8RlG8VGq: "Microservices", // saga in 5 minutes
  "37LdeNDgVov": "Microservices", // saga in practice
  yZjJYnKlLOE: "Distributed Systems", // retries and self-DDoS
  oK9VygxdJQR: "Backend Engineering", // graceful shutdown incident
  "0gdJzR1EJz5": "Engineering Practices", // AI and the engineer's role
  Yym40GNmV91: "Microservices", // why I dislike microservices
};

/** Articles pinned on the homepage, chosen by real engagement (views/clips). */
const FEATURED = new Set([
  "oKLnqZyWJQO", // Kafka: production lessons — 10.7k views, 39 clips
  "XRJ8RlG8VGq", // Saga in 5 minutes — 3.5k views
  "oKLnqqBgJQO", // High-load system design — 3k views, 33 clips
  "Yym40GNmV91", // I don't like microservices — 2.2k views, 6 clips
  "Nj4vgaOqJ6r", // Java threads — most recent Java core deep dive
]);

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Render a UTC ISO timestamp in the author's original timezone (+07:00). */
function toSaigonISO(iso) {
  const d = new Date(iso);
  const shifted = new Date(d.getTime() + VN_OFFSET_MS);
  return `${shifted.toISOString().slice(0, 19)}+07:00`;
}

/** YAML double-quoted scalar. JSON escaping is valid YAML 1.2 double-quoted style. */
const q = (s) => JSON.stringify(String(s));

function cleanSlug(s) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90)
    .replace(/-+$/, "");
}

/** An excerpt taken verbatim from the article's first paragraph (metadata only). */
function excerptOf(markdown) {
  const blocks = markdown.split(/\n{2,}/);
  for (const raw of blocks) {
    let b = raw.trim();
    if (!b || b.startsWith("#") || b.startsWith("!") || b.startsWith("|") || b.startsWith("```"))
      continue;
    if (/^[-*+]\s/.test(b) || /^\d+\.\s/.test(b)) continue;
    b = b
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_`~]/g, "")
      .replace(/^\s*>\s?/gm, "")
      .replace(/\s+/g, " ")
      .trim();
    if (b.length < 60) continue;
    if (b.length <= 200) return b;
    const cut = b.slice(0, 200);
    const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    if (stop > 100) return cut.slice(0, stop + 1);
    return cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:]$/, "") + "…";
  }
  return "";
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { "user-agent": UA, referer: "https://viblo.asia/" } });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  const type = res.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) throw new Error(`not an image (${type}) for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 64) throw new Error(`suspiciously small image (${buf.length}B) ${url}`);
  await writeFile(dest, buf);
  return buf.length;
}

const extOf = (url) =>
  (url.match(/\.(png|jpe?g|webp|gif|avif|svg)(?:\?|$)/i)?.[1] ?? "png").toLowerCase();

async function main() {
  const files = (await readdir(SOURCE)).filter((f) => /^[A-Za-z0-9]+\.json$/.test(f));
  const posts = [];
  for (const f of files) {
    const body = JSON.parse(await readFile(join(SOURCE, f), "utf8"));
    posts.push(body.post.data);
  }
  posts.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));

  await mkdir(CONTENT, { recursive: true });
  await mkdir(IMAGES, { recursive: true });
  await mkdir(COVERS, { recursive: true });
  await mkdir(REPORT, { recursive: true });

  const seenSlugs = new Map();
  const seenTitles = new Map();
  const usedSlugs = new Set();
  const entries = [];
  const imageLog = [];
  const failures = [];

  for (const p of posts) {
    const id = p.slug;
    const original = p.contents ?? "";
    let slug = cleanSlug(p.transliterated || p.title);
    if (usedSlugs.has(slug)) slug = `${slug}-${id.toLowerCase()}`;
    usedSlugs.add(slug);

    const dir = join(IMAGES, slug);
    const coverDir = join(COVERS, slug);
    await mkdir(dir, { recursive: true });
    await mkdir(coverDir, { recursive: true });

    // ---- images: cover + inline, downloaded with descriptive local names ----
    let body = original;
    const localMap = new Map();
    let missing = 0;

    if (p.thumbnail_url) {
      const ext = extOf(p.thumbnail_url);
      const name = `cover.${ext}`;
      try {
        const bytes = await download(p.thumbnail_url, join(coverDir, name));
        imageLog.push({
          article: slug,
          kind: "cover",
          source: p.thumbnail_url,
          local: `/images/articles/${slug}/${name}`,
          file: `src/assets/articles/${slug}/${name}`,
          importPath: `../../assets/articles/${slug}/${name}`,
          bytes,
        });
      } catch (e) {
        missing++;
        failures.push({ slug, kind: "cover", url: p.thumbnail_url, error: String(e) });
      }
    }

    const inlineRe = /!\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g;
    let idx = 0;
    const inlineUrls = [...body.matchAll(inlineRe)].map((m) => m[2]);
    const uniqueInline = [...new Set(inlineUrls)];
    for (const url of uniqueInline) {
      idx++;
      const ext = extOf(url);
      const name = `figure-${idx}.${ext}`;
      const localPath = `/images/articles/${slug}/${name}`;
      try {
        const bytes = await download(url, join(dir, name));
        localMap.set(url, localPath);
        imageLog.push({ article: slug, kind: "inline", source: url, local: localPath, bytes });
      } catch (e) {
        missing++;
        localMap.set(url, null);
        failures.push({ slug, kind: "inline", url, error: String(e) });
      }
    }
    for (const [remote, local] of localMap) {
      if (local) body = body.split(remote).join(local);
    }

    // ---- metadata ----
    const tags = (p.tags?.data ?? []).map((t) => t.name).filter(Boolean);
    const title = p.title;
    const pub = toSaigonISO(p.published_at);
    const series = p.series?.data?.title ?? null;
    const category = CATEGORIES[id] ?? "Engineering Practices";
    const description = excerptOf(original);
    const coverEntry = imageLog.find((i) => i.article === slug && i.kind === "cover");

    if (seenSlugs.has(slug))
      failures.push({ slug, kind: "duplicate-slug", of: seenSlugs.get(slug) });
    seenSlugs.set(slug, id);
    const titleKey = title.trim().toLowerCase();
    if (seenTitles.has(titleKey))
      failures.push({ slug, kind: "duplicate-title", of: seenTitles.get(titleKey) });
    seenTitles.set(titleKey, id);

    const fm = [
      "---",
      `title: ${q(title)}`,
      `description: ${q(description)}`,
      `pubDatetime: ${pub}`,
      `modDatetime: null`,
      `category: ${q(category)}`,
      `tags: [${tags.map(q).join(", ")}]`,
      `lang: ${q("vi")}`,
      `featured: ${FEATURED.has(id)}`,
      `draft: false`,
      `readingTime: ${p.reading_time ?? 0}`,
      `coverImage: ${coverEntry ? q(coverEntry.importPath) : "null"}`,
      `series: ${series ? q(series) : "null"}`,
      `sourceUrl: ${q(p.canonical_url ?? `https://viblo.asia/p/${id}`)}`,
      `sourceReleasedAt: ${q(p.published_at)}`,
      `sourceUpdatedAt: ${q(p.updated_at)}`,
      `sourceTags: [${tags.map(q).join(", ")}]`,
      "---",
    ].join("\n");

    await writeFile(join(CONTENT, `${slug}.md`), `${fm}\n\n${body.trim()}\n`, "utf8");

    entries.push({
      id,
      slug,
      file: `src/content/blog/${slug}.md`,
      title,
      category,
      tags,
      publishedAt: pub,
      sourceUrl: p.canonical_url ?? `https://viblo.asia/p/${id}`,
      readingMinutes: p.reading_time ?? 0,
      views: p.views_count,
      clips: p.clips_count,
      images: imageLog.filter((i) => i.article === slug).length,
      missingImages: missing,
      bodyChars: body.trim().length,
    });
  }

  const manifest = {
    source: PROFILE,
    generatedAt: new Date().toISOString(),
    articles_discovered: posts.length,
    articles_migrated: entries.length,
    articles_failed: failures.filter((f) => f.kind === "article").length,
    missing_images: failures.filter((f) => f.kind === "cover" || f.kind === "inline").length,
    incomplete_articles: entries.filter((e) => e.missingImages > 0 || e.bodyChars < 200).length,
    duplicates: failures.filter((f) => f.kind?.startsWith("duplicate")).length,
    images_downloaded: imageLog.length,
    articles: entries,
  };
  await writeFile(join(REPORT, "manifest.json"), JSON.stringify(manifest, null, 2));
  await writeFile(join(REPORT, "images.json"), JSON.stringify(imageLog, null, 2));
  await writeFile(join(REPORT, "failures.json"), JSON.stringify(failures, null, 2));

  console.log(
    `migrated ${entries.length}/${posts.length} articles, ${imageLog.length} images, ${failures.length} issues`
  );
  for (const e of entries)
    console.log(`  ${e.slug}  [${e.category}] ${e.tags.length} tags, ${e.images} img`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
