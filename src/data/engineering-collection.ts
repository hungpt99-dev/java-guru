import type { Locale } from "@/i18n/config";
import raw from "./engineering-blogs.json";

/**
 * Engineering Collection — curated external reading.
 *
 * Articles live in `engineering-blogs.json` so the collection can grow without
 * touching a component. Everything below is derived: counts, sorting, filters
 * and the per-locale copy. `assertArticles` runs at import time, so a malformed
 * entry fails the build instead of rendering an empty card.
 */

export const COMPANY_KEYS = [
  "Canva",
  "Netflix",
  "Uber",
  "Airbnb",
  "Atlassian",
  "Discord",
  "Cloudflare",
  "Shopify",
  "Meta",
  "Google",
  "Amazon",
  "Other",
] as const;

export type CompanyKey = (typeof COMPANY_KEYS)[number];

export const TOPIC_KEYS = [
  "System Design",
  "Distributed Systems",
  "Software Architecture",
  "Database & Storage",
  "Scalability",
  "Performance",
  "Infrastructure",
  "Reliability",
  "Security",
  "Backend Engineering",
] as const;

export type TopicKey = (typeof TOPIC_KEYS)[number];

/** Brand hues are only used for the small monogram tile, never for large fills. */
export const COMPANIES: Record<CompanyKey, { label: string; hue: number }> = {
  Canva: { label: "Canva", hue: 190 },
  Netflix: { label: "Netflix", hue: 25 },
  Uber: { label: "Uber", hue: 245 },
  Airbnb: { label: "Airbnb", hue: 350 },
  Atlassian: { label: "Atlassian", hue: 215 },
  Discord: { label: "Discord", hue: 265 },
  Cloudflare: { label: "Cloudflare", hue: 45 },
  Shopify: { label: "Shopify", hue: 145 },
  Meta: { label: "Meta", hue: 220 },
  Google: { label: "Google", hue: 105 },
  Amazon: { label: "Amazon", hue: 55 },
  Other: { label: "Other", hue: 200 },
};

export const TOPICS: Record<TopicKey, Record<Locale, string>> = {
  "System Design": { en: "System Design", vi: "Thiết kế hệ thống" },
  "Distributed Systems": { en: "Distributed Systems", vi: "Hệ thống phân tán" },
  "Software Architecture": { en: "Software Architecture", vi: "Kiến trúc phần mềm" },
  "Database & Storage": { en: "Database & Storage", vi: "Cơ sở dữ liệu & lưu trữ" },
  Scalability: { en: "Scalability", vi: "Khả năng mở rộng" },
  Performance: { en: "Performance", vi: "Hiệu năng" },
  Infrastructure: { en: "Infrastructure", vi: "Hạ tầng" },
  Reliability: { en: "Reliability", vi: "Độ tin cậy" },
  Security: { en: "Security", vi: "Bảo mật" },
  "Backend Engineering": { en: "Backend Engineering", vi: "Backend Engineering" },
};

/** Shelves in the collection. Only `blogs` has a route; the rest are planned. */
export const SHELVES = [
  {
    slug: "blogs",
    key: "blogs",
    available: true,
    label: { en: "Blogs", vi: "Blog" },
    blurb: {
      en: "Curated engineering writing from teams building systems at scale.",
      vi: "Bài viết kỹ thuật được chọn lọc từ các team đang xây hệ thống ở quy mô lớn.",
    },
  },
  {
    slug: "books",
    key: "books",
    available: false,
    label: { en: "Books", vi: "Sách" },
    blurb: {
      en: "Long-form references worth keeping within reach.",
      vi: "Những đầu sách dài đáng để trong tầm tay.",
    },
  },
  {
    slug: "videos",
    key: "videos",
    available: false,
    label: { en: "Videos", vi: "Video" },
    blurb: {
      en: "Conference talks and deep-dive walkthroughs.",
      vi: "Talk hội nghị và các buổi phân tích chuyên sâu.",
    },
  },
  {
    slug: "courses",
    key: "courses",
    available: false,
    label: { en: "Courses", vi: "Khoá học" },
    blurb: {
      en: "Structured material for going past the introduction.",
      vi: "Tài liệu có cấu trúc để đi xa hơn phần nhập môn.",
    },
  },
  {
    slug: "papers",
    key: "papers",
    available: false,
    label: { en: "Papers", vi: "Bài báo khoa học" },
    blurb: {
      en: "The primary sources behind the systems we use.",
      vi: "Nguồn gốc của những hệ thống chúng ta đang dùng.",
    },
  },
  {
    slug: "repositories",
    key: "repositories",
    available: false,
    label: { en: "Repositories", vi: "Repository" },
    blurb: {
      en: "Code that is worth reading, not only running.",
      vi: "Mã nguồn đáng đọc, không chỉ đáng chạy.",
    },
  },
] as const;

export type ShelfKey = (typeof SHELVES)[number]["key"];

export interface EngineeringArticle {
  id: string;
  title: string;
  company: CompanyKey;
  /** Display name for entries filed under "Other" (e.g. Figma). */
  companyName?: string;
  url: string;
  publishedAt: string;
  description: string;
  descriptionVi?: string;
  topics: TopicKey[];
  readingTime?: number;
  featured: boolean;
  editorNote: string;
  editorNoteVi?: string;
  takeaways?: string[];
  takeawaysVi?: string[];
}

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assertArticles(entries: unknown[]): EngineeringArticle[] {
  const seen = new Set<string>();

  return entries.map((entry, index) => {
    const article = entry as EngineeringArticle;
    const where = `engineering-blogs.json[${index}]${article?.id ? ` (${article.id})` : ""}`;
    const fail = (message: string): never => {
      throw new Error(`${where}: ${message}`);
    };

    if (!article || typeof article !== "object") fail("not an object");
    if (!ID_PATTERN.test(article.id ?? "")) fail("id must be kebab-case");
    if (seen.has(article.id)) fail("duplicate id");
    seen.add(article.id);

    if (!article.title?.trim()) fail("title is required");
    if (!(article.company in COMPANIES)) fail(`unknown company "${article.company}"`);
    if (article.companyName !== undefined && !article.companyName.trim())
      fail("companyName must not be empty");
    if (!/^https:\/\//.test(article.url ?? "")) fail("url must be https");
    if (!DATE_PATTERN.test(article.publishedAt ?? "")) fail("publishedAt must be YYYY-MM-DD");
    if (Number.isNaN(Date.parse(article.publishedAt))) fail("publishedAt is not a real date");
    if (!article.description?.trim()) fail("description is required");
    if (!article.editorNote?.trim()) fail("editorNote is required");
    if (!Array.isArray(article.topics) || article.topics.length === 0)
      fail("at least one topic is required");
    if (new Set(article.topics).size !== article.topics.length) fail("duplicate topic");
    for (const topic of article.topics) {
      if (!(topic in TOPICS)) fail(`unknown topic "${topic}"`);
    }
    if (
      article.readingTime !== undefined &&
      (!Number.isInteger(article.readingTime) || article.readingTime <= 0)
    ) {
      fail("readingTime must be a positive integer");
    }
    if ((article.takeaways?.length ?? 0) !== (article.takeawaysVi?.length ?? 0)) {
      fail("takeaways and takeawaysVi must have the same length");
    }

    return { ...article, featured: article.featured === true };
  });
}

export const ARTICLES: EngineeringArticle[] = assertArticles(raw as unknown[]);

const byDateDesc = (a: EngineeringArticle, b: EngineeringArticle) =>
  b.publishedAt.localeCompare(a.publishedAt);

/** Canonical order: newest first. */
export const SORTED_ARTICLES = [...ARTICLES].sort(byDateDesc);

export const FEATURED_ARTICLES = SORTED_ARTICLES.filter((article) => article.featured);

export const articleDate = (article: EngineeringArticle): Date =>
  new Date(`${article.publishedAt}T00:00:00Z`);

export const getArticle = (id: string): EngineeringArticle | undefined =>
  ARTICLES.find((article) => article.id === id);

export const companyLabel = (company: CompanyKey): string => COMPANIES[company].label;

/** What the card shows: the brand for named companies, or the entry's own name under "Other". */
export const articleCompanyName = (article: EngineeringArticle): string =>
  article.companyName?.trim() || COMPANIES[article.company].label;

export const topicLabel = (topic: TopicKey, locale: Locale): string =>
  TOPICS[topic]?.[locale] ?? topic;

/** Per-locale editorial copy, falling back to English when a translation is absent. */
export function articleCopy(article: EngineeringArticle, locale: Locale) {
  const vi = locale === "vi";
  return {
    description: (vi && article.descriptionVi) || article.description,
    editorNote: (vi && article.editorNoteVi) || article.editorNote,
    takeaways: (vi && article.takeawaysVi) || article.takeaways || [],
  };
}

export function collectionStats(articles: EngineeringArticle[] = ARTICLES) {
  return {
    articles: articles.length,
    companies: new Set(articles.map((article) => article.company)).size,
    topics: new Set(articles.flatMap((article) => article.topics)).size,
  };
}

/** Companies that actually have an article, ordered by the registry. */
export function companiesWithCounts(articles: EngineeringArticle[] = ARTICLES) {
  return COMPANY_KEYS.map((key) => ({
    key,
    label: COMPANIES[key].label,
    hue: COMPANIES[key].hue,
    count: articles.filter((article) => article.company === key).length,
  })).filter((company) => company.count > 0);
}

export function topicsWithCounts(articles: EngineeringArticle[] = ARTICLES) {
  return TOPIC_KEYS.map((key) => ({
    key,
    count: articles.filter((article) => article.topics.includes(key)).length,
  })).filter((topic) => topic.count > 0);
}

/** Same company or shared topic, newest first, excluding the article itself. */
export function relatedArticles(article: EngineeringArticle, limit = 3): EngineeringArticle[] {
  return SORTED_ARTICLES.filter((candidate) => candidate.id !== article.id)
    .map((candidate) => ({
      candidate,
      score:
        (candidate.company === article.company ? 2 : 0) +
        candidate.topics.filter((topic) => article.topics.includes(topic)).length,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || byDateDesc(a.candidate, b.candidate))
    .slice(0, limit)
    .map((entry) => entry.candidate);
}
