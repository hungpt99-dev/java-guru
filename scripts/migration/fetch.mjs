#!/usr/bin/env node
/**
 * Step 1 — fetch the published source of every article from the public Viblo API.
 *
 * The API is the same JSON the public profile page consumes; no authentication,
 * no scraping of private data, no anti-bot circumvention. Every response is
 * stored verbatim under scripts/migration/source/ so that the Markdown build
 * (migrate.mjs) is reproducible and auditable without hitting the network again.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, "source");
const USERNAME = "lowkey_dev";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const BASE = "https://viblo.asia";

async function getJSON(url) {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function main() {
  await mkdir(SOURCE, { recursive: true });

  const list = [];
  for (let page = 1; ; page++) {
    const body = await getJSON(`${BASE}/api/users/${USERNAME}/posts?limit=100&page=${page}`);
    const items = body.data ?? [];
    list.push(...items);
    const p = body.meta?.pagination ?? {};
    console.log(`list page ${page}: ${items.length} posts (total ${p.total ?? "?"})`);
    if (items.length === 0 || page >= (p.total_pages ?? 1)) break;
  }

  await writeFile(join(SOURCE, "_list.json"), JSON.stringify(list, null, 1));

  let ok = 0;
  const failed = [];
  for (const item of list) {
    const url = `${BASE}/api/posts/${item.slug}`;
    try {
      const body = await getJSON(url);
      if (!body?.post?.data) throw new Error("missing post payload");
      await writeFile(join(SOURCE, `${item.slug}.json`), JSON.stringify(body, null, 1));
      ok++;
      console.log(`  ok ${item.slug} ${item.title.slice(0, 60)}`);
    } catch (err) {
      failed.push({ slug: item.slug, url, error: String(err) });
      console.error(`  FAIL ${item.slug}: ${err}`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  console.log(`\nfetched ${ok}/${list.length} articles`);
  if (failed.length) {
    await writeFile(join(SOURCE, "_fetch-failures.json"), JSON.stringify(failed, null, 2));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
