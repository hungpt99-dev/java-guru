import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeCode from "./src/utils/rehype-code";
import rehypeProse from "./src/utils/rehype-prose";
import { SITE } from "./src/config";

// https://astro.build/config
export default defineConfig({
  site: SITE.url,
  // Every route is generated under /en/… and /vi/…; the bare root is a small
  // preference-aware redirect page.
  trailingSlash: "ignore",
  integrations: [
    sitemap({
      filter: (page) => !page.includes("/search"),
      // Emits <xhtml:link rel="alternate" hreflang> pairs for both locales.
      i18n: {
        defaultLocale: "en",
        locales: { en: "en-US", vi: "vi-VN" },
      },
      changefreq: "weekly",
      lastmod: new Date(),
    }),
  ],
  markdown: {
    // Shiki is driven by src/utils/rehype-code.ts so that every theme gets its
    // own token colours instead of Astro's built-in light/dark pair.
    syntaxHighlight: false,
    smartypants: false,
    remarkPlugins: [remarkMath],
    rehypePlugins: [[rehypeProse, SITE.url], rehypeCode, [rehypeKatex, { strict: false }]],
  },
  vite: {
    plugins: [tailwindcss()],
  },
  build: {
    inlineStylesheets: "auto",
  },
});
