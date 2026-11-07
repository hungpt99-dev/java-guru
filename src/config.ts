/**
 * Site identity. Reader-facing copy lives in src/i18n/ui.ts; this file holds the
 * things that do not change with language.
 */
export const SITE = {
  /**
   * Production origin. Override with the SITE_URL environment variable at build
   * time (docker build --build-arg SITE_URL=…, or the Cloudflare Pages env var).
   */
  url: (typeof process !== "undefined" && process.env?.SITE_URL) || "https://java-guru.dev",
  title: "Java Guru",
  author: {
    name: "Hưng Phạm",
    /** Given name, used in greetings ("Hi, I'm Hưng"). */
    givenName: "Hưng",
    alias: "Adrian",
    handle: "@lowkey_dev",
    location: { en: "Vietnam", vi: "Việt Nam" },
    avatar: "/images/avatar.jpg",
  },
  socials: [
    {
      label: "GitHub",
      href: "https://github.com/hungpt99-dev",
      note: { en: "code", vi: "mã nguồn" },
      local: false,
    },
    { label: "RSS", href: "/rss.xml", note: { en: "feed", vi: "feed" }, local: true },
  ],
  /** Route stems; the locale prefix is added at render time. */
  nav: [
    { key: "nav.journal" as const, path: "/posts/" },
    { key: "nav.topics" as const, path: "/categories/" },
    { key: "nav.projects" as const, path: "/projects/" },
    { key: "nav.homelab" as const, path: "/homelab/" },
    { key: "nav.about" as const, path: "/about/" },
  ],
  repo: "https://github.com/hungpt99-dev/java-guru",
  postsPerPage: 10,
  featuredOnHome: 3,
  /** Canonical theme; palette definitions live in src/styles/global.css. */
  defaultTheme: "tokyo-night",
} as const;

export const THEMES = [
  { id: "tokyo-night", label: "Tokyo Night", mode: "dark" },
  { id: "catppuccin-mocha", label: "Catppuccin Mocha", mode: "dark" },
  { id: "nord", label: "Nord", mode: "dark" },
  { id: "gruvbox", label: "Gruvbox", mode: "dark" },
  { id: "daylight", label: "Daylight", mode: "light" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];
