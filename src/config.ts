/**
 * Site-wide configuration. Everything the UI needs to know about the author
 * lives here so pages stay free of hardcoded copy.
 */
export const SITE = {
  /**
   * Production origin. Override with the SITE_URL environment variable at build
   * time (docker build --build-arg SITE_URL=...), otherwise this default is used.
   */
  url: (typeof process !== "undefined" && process.env?.SITE_URL) || "https://java-guru.dev",
  title: "Java Guru",
  tagline: "An engineering journal",
  description:
    "Notes from Hưng Phạm on backend engineering, distributed systems, the Java and JVM ecosystem, security and AI — written while building things that have to survive production.",
  locale: "en",
  author: {
    name: "Hưng Phạm",
    alias: "Adrian",
    handle: "@lowkey_dev",
    role: "Software engineer",
    location: "Vietnam",
    avatar: "/images/avatar.jpg",
    /** Used verbatim on the homepage and About page. */
    intro:
      "a software engineer passionate about backend engineering, system design, distributed systems, infrastructure, security, and emerging technologies.",
    bio: "This is my personal engineering journal, where I document things I learn, explore technical ideas, and share engineering experiences.",
  },
  socials: [
    { label: "GitHub", href: "https://github.com/hungpt99-dev", note: "code" },
    { label: "Viblo", href: "https://viblo.asia/u/lowkey_dev", note: "archive" },
    { label: "RSS", href: "/rss.xml", note: "feed" },
  ],
  nav: [
    { label: "Journal", href: "/posts" },
    { label: "Topics", href: "/categories" },
    { label: "Projects", href: "/projects" },
    { label: "Homelab", href: "/homelab" },
    { label: "About", href: "/about" },
  ],
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

/** Category → accent token. Hues are shared across themes, see global.css. */
export const CATEGORY_ACCENTS: Record<string, string> = {
  "Java & JVM": "java",
  "System Design": "system",
  Microservices: "micro",
  "Distributed Systems": "distributed",
  "AI & AI Agents": "ai",
  Security: "security",
  "DevOps & Infrastructure": "devops",
  "Engineering Practices": "practices",
  "Backend Engineering": "backend",
};

export const CATEGORY_BLURBS: Record<string, string> = {
  "Java & JVM":
    "Threads, memory, the class loader, GraalVM and the parts of the platform that decide how your service behaves at 3am.",
  "System Design":
    "Back-of-the-envelope reasoning about throughput, storage, queues and the trade-offs nobody writes in the design doc.",
  Microservices:
    "Service boundaries, sagas, consistency and the honest cost of distributing a system that used to be one process.",
  "Distributed Systems":
    "Retries, idempotency, ordering and failure modes that only appear when more than one machine is involved.",
  "AI & AI Agents":
    "Agent runtimes, spec-driven development, guardrails and what actually changes when an LLM sits in the request path.",
  Security:
    "Threat models, zero trust, supply chain and the security work that has to happen before the incident, not after.",
  "DevOps & Infrastructure":
    "Build pipelines, containers, observability and the self-hosted lab where I break things on purpose.",
  "Engineering Practices":
    "How teams write, review, document and decide — the human half of shipping software.",
  "Backend Engineering":
    "Runtime behaviour, configuration and the small decisions that quietly take a service down.",
};
