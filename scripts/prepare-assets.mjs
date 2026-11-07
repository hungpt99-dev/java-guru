#!/usr/bin/env node
/**
 * Build the site's own raster assets: avatar, favicons, default OG image and
 * the web manifest. Run with `pnpm assets`. Safe to re-run (idempotent).
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUB = join(ROOT, "public");
const FAV = join(PUB, "favicon");
const IMG = join(PUB, "images");

const AVATAR_SOURCE = "https://images.viblo.asia/3cda0532-772d-4648-a7aa-f46669f4e811.jpg";

const MARK = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#1A1B26"/>
  <rect x="0.75" y="0.75" width="62.5" height="62.5" rx="13.4" fill="none" stroke="#2F3549" stroke-width="1.5"/>
  <g stroke-linecap="round" stroke-width="5">
    <path d="M18 24h28" stroke="#7AA2F7"/>
    <path d="M18 33h19" stroke="#7DCFFF"/>
    <path d="M18 42h11" stroke="#BB9AF7"/>
  </g>
</svg>`;

const OG = (title, subtitle, footer) => `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="sig" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#7AA2F7"/><stop offset="52%" stop-color="#7DCFFF"/><stop offset="100%" stop-color="#BB9AF7"/>
    </linearGradient>
    <radialGradient id="glow" cx="18%" cy="12%" r="72%">
      <stop offset="0%" stop-color="#7AA2F7" stop-opacity="0.20"/><stop offset="100%" stop-color="#1A1B26" stop-opacity="0"/>
    </radialGradient>
    <pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse">
      <circle cx="1.6" cy="1.6" r="1.6" fill="#3B4261" opacity="0.55"/>
    </pattern>
  </defs>
  <rect width="1200" height="630" fill="#1A1B26"/>
  <rect width="1200" height="630" fill="url(#dots)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <rect x="0" y="0" width="1200" height="5" fill="url(#sig)"/>
  <g font-family="DejaVu Sans, sans-serif">
    <text x="84" y="132" font-size="22" letter-spacing="6" fill="#7A81A6">~/JAVA GURU</text>
    <text x="84" y="300" font-size="92" font-weight="bold" fill="#C0CAF5">${title}</text>
    <text x="84" y="372" font-size="34" fill="#9AA5CE">${subtitle}</text>
    <text x="84" y="560" font-size="22" letter-spacing="2" fill="#6C7396">${footer}</text>
  </g>
  <g stroke-linecap="round" stroke-width="7">
    <path d="M84 470h120" stroke="#7AA2F7"/><path d="M216 470h80" stroke="#7DCFFF"/><path d="M308 470h40" stroke="#BB9AF7"/>
  </g>
</svg>`;

async function main() {
  await mkdir(FAV, { recursive: true });
  await mkdir(IMG, { recursive: true });

  // --- avatar -------------------------------------------------------------
  const res = await fetch(AVATAR_SOURCE, { headers: { "user-agent": "java-guru/build" } });
  if (!res.ok) throw new Error(`avatar download failed: ${res.status}`);
  const raw = Buffer.from(await res.arrayBuffer());
  await sharp(raw)
    .resize(480, 480, { fit: "cover", position: "attention" })
    .jpeg({ quality: 88, progressive: true, mozjpeg: true })
    .toFile(join(IMG, "avatar.jpg"));
  console.log("avatar.jpg");

  // --- favicons -----------------------------------------------------------
  await writeFile(join(PUB, "favicon.svg"), MARK.trim());
  const markBuf = Buffer.from(MARK);
  await sharp(markBuf, { density: 384 }).resize(16, 16).png().toFile(join(FAV, "favicon-16.png"));
  await sharp(markBuf, { density: 384 }).resize(32, 32).png().toFile(join(FAV, "favicon-32.png"));
  await sharp(markBuf, { density: 384 })
    .resize(180, 180)
    .png()
    .toFile(join(FAV, "apple-touch-icon.png"));
  await sharp(markBuf, { density: 384 }).resize(192, 192).png().toFile(join(FAV, "icon-192.png"));
  await sharp(markBuf, { density: 384 }).resize(512, 512).png().toFile(join(FAV, "icon-512.png"));
  console.log("favicon set");

  // --- default Open Graph image -------------------------------------------
  const og = Buffer.from(
    OG(
      "java guru",
      "Backend · distributed systems · Java &amp; JVM · security · AI",
      "Hưng Phạm — personal engineering journal"
    )
  );
  await sharp(og).png({ compressionLevel: 9 }).toFile(join(IMG, "og-default.png"));
  console.log("og-default.png");

  // --- manifest -----------------------------------------------------------
  const manifest = {
    name: "Java Guru — engineering journal",
    short_name: "Java Guru",
    description:
      "Notes on backend engineering, distributed systems, Java and the JVM, security and AI.",
    start_url: "/",
    display: "standalone",
    background_color: "#1A1B26",
    theme_color: "#1A1B26",
    icons: [
      { src: "/favicon/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/favicon/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
  await writeFile(join(PUB, "site.webmanifest"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log("site.webmanifest");

  const avatarSize = (await readFile(join(IMG, "avatar.jpg"))).length;
  console.log(`done — avatar ${(avatarSize / 1024).toFixed(1)} KB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
