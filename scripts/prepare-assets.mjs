#!/usr/bin/env node
/**
 * Build the site's own raster assets: avatar, favicons, default OG image and
 * the web manifest. Run with `pnpm assets`. Safe to re-run (idempotent).
 */
import { mkdir, writeFile, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUB = join(ROOT, "public");
const IMG = join(PUB, "images");
const V = "?v=2";

/* The header mark and every icon are generated from these two paths: a lime
   rounded square with a dark brace glyph. No font dependency. */
const BRACES = `
  <g fill="none" stroke="#1a2200" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M13 9.5c-2.2 0-2.7 1.9-2.7 4 0 1.6-.7 2.3-2.3 2.5 1.6.2 2.3.9 2.3 2.5 0 2.1.5 4 2.7 4"/>
    <path d="M19 9.5c2.2 0 2.7 1.9 2.7 4 0 1.6.7 2.3 2.3 2.5-1.6.2-2.3.9-2.3 2.5 0 2.1-.5 4-2.7 4"/>
  </g>`;

const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect width="32" height="32" rx="7" fill="#c8f542"/>
  ${BRACES}
</svg>`;

const OG = (title, subtitle, footer) => `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0e0e0e"/>
  <rect width="1200" height="5" fill="#c8f542"/>
  <g transform="translate(84 84)">
    <rect width="112" height="112" rx="24" fill="#c8f542"/>
    <g transform="translate(8 8) scale(3)">${BRACES}</g>
  </g>
  <g font-family="Geist, Inter, DejaVu Sans, sans-serif">
    <text x="84" y="284" font-size="22" letter-spacing="4" fill="#a3a3a3">JAVA GURU</text>
    <text x="84" y="380" font-size="76" font-weight="500" fill="#f4f4f0">${title}</text>
    <text x="84" y="438" font-size="30" fill="#a3a3a3">${subtitle}</text>
    <text x="84" y="560" font-size="20" fill="#a3a3a3">${footer}</text>
  </g>
</svg>`;

async function raster(size, artSize, background) {
  const art = await sharp(Buffer.from(MARK), { density: 384 })
    .resize(artSize, artSize)
    .png()
    .toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background },
  })
    .composite([
      { input: art, left: Math.floor((size - artSize) / 2), top: Math.floor((size - artSize) / 2) },
    ])
    .png()
    .toBuffer();
}

async function ico(sizes) {
  const images = [];
  for (const size of sizes) {
    images.push(
      await sharp(Buffer.from(MARK), { density: 384 }).resize(size, size).png().toBuffer()
    );
  }
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  const data = [];
  let offset = header.length + images.length * 16;
  for (let i = 0; i < images.length; i++) {
    const entry = Buffer.alloc(16);
    entry[0] = sizes[i];
    entry[1] = sizes[i];
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(images[i].length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += images[i].length;
    entries.push(entry);
    data.push(images[i]);
  }
  return Buffer.concat([header, ...entries, ...data]);
}

async function main() {
  await mkdir(IMG, { recursive: true });

  // --- avatar -------------------------------------------------------------
  const avatarPath = join(IMG, "avatar.jpg");
  try {
    const source = await readFile(avatarPath);
    await sharp(source)
      .resize(480, 480, { fit: "cover", position: "attention" })
      .jpeg({ quality: 88, progressive: true, mozjpeg: true })
      .toFile(join(IMG, "avatar.tmp.jpg"));
    await rename(join(IMG, "avatar.tmp.jpg"), avatarPath);
    console.log("avatar.jpg");
  } catch {
    console.warn("avatar.jpg missing — add public/images/avatar.jpg first");
  }

  // --- favicons -----------------------------------------------------------
  const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
  const DARK = { r: 14, g: 14, b: 14, alpha: 1 };
  await writeFile(join(PUB, "favicon.svg"), MARK.trim());
  await writeFile(join(PUB, "favicon.ico"), await ico([16, 32, 48]));
  await writeFile(join(PUB, "apple-touch-icon.png"), await raster(180, 160, DARK));
  await writeFile(join(PUB, "icon-192.png"), await raster(192, 192, TRANSPARENT));
  await writeFile(join(PUB, "icon-512.png"), await raster(512, 512, TRANSPARENT));
  await writeFile(join(PUB, "icon-512-maskable.png"), await raster(512, 288, DARK));
  console.log("favicon set");

  // --- default Open Graph image -------------------------------------------
  const og = Buffer.from(
    OG(
      "Java Guru",
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
    background_color: "#0e0e0e",
    theme_color: "#0e0e0e",
    icons: [
      { src: `/icon-192.png${V}`, sizes: "192x192", type: "image/png" },
      { src: `/icon-512.png${V}`, sizes: "512x512", type: "image/png" },
      {
        src: `/icon-512-maskable.png${V}`,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
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
