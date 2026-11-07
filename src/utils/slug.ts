/** Shared slug + date helpers used by routes, components and feeds. */

const CATEGORY_SLUGS: Record<string, string> = {
  "Java & JVM": "java-jvm",
  "System Design": "system-design",
  Microservices: "microservices",
  "Distributed Systems": "distributed-systems",
  "AI & AI Agents": "ai-agents",
  Security: "security",
  "DevOps & Infrastructure": "devops",
  "Engineering Practices": "engineering-practices",
  "Backend Engineering": "backend",
};

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/@/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const categorySlug = (name: string): string => CATEGORY_SLUGS[name] ?? slugify(name);

export const categoryFromSlug = (slug: string): string | undefined =>
  Object.entries(CATEGORY_SLUGS).find(([, s]) => s === slug)?.[0];

export const tagSlug = (tag: string): string => slugify(tag);

/** Dates are rendered in the author's timezone so a build server never shifts them. */
const dateFmt = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "Asia/Ho_Chi_Minh",
});

const longDateFmt = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "Asia/Ho_Chi_Minh",
});

export const formatDate = (date: Date): string => dateFmt.format(date);
export const formatLongDate = (date: Date): string => longDateFmt.format(date);

export const isoDate = (date: Date): string =>
  new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(date);

export const readingLabel = (minutes: number): string => `${Math.max(1, minutes)} min read`;
