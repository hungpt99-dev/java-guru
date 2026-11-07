import type { Locale } from "@/i18n/config";

/**
 * Canonical category registry.
 *
 * The `key` is what frontmatter stores (stable across both locales); the label
 * and blurb are localised for display. Slugs stay language-independent so a
 * category has exactly one URL per locale.
 */
export type CategoryKey =
  | "Java & JVM"
  | "System Design"
  | "Microservices"
  | "Distributed Systems"
  | "AI & AI Agents"
  | "Security"
  | "DevOps & Infrastructure"
  | "Engineering Practices"
  | "Backend Engineering";

export type CategoryDef = {
  key: CategoryKey;
  slug: string;
  accent: string;
  label: Record<Locale, string>;
  blurb: Record<Locale, string>;
};

export const CATEGORIES: CategoryDef[] = [
  {
    key: "Java & JVM",
    slug: "java-jvm",
    accent: "java",
    label: { en: "Java & JVM", vi: "Java & JVM" },
    blurb: {
      en: "Threads, memory, the class loader, GraalVM and the parts of the platform that decide how your service behaves at 3am.",
      vi: "Thread, bộ nhớ, class loader, GraalVM và những phần của nền tảng quyết định service của bạn hành xử thế nào lúc 3 giờ sáng.",
    },
  },
  {
    key: "System Design",
    slug: "system-design",
    accent: "system",
    label: { en: "System Design", vi: "Thiết kế hệ thống" },
    blurb: {
      en: "Back-of-the-envelope reasoning about throughput, storage, queues and the trade-offs nobody writes in the design doc.",
      vi: "Tính toán nhanh về throughput, lưu trữ, queue và những đánh đổi không ai viết vào design doc.",
    },
  },
  {
    key: "Microservices",
    slug: "microservices",
    accent: "micro",
    label: { en: "Microservices", vi: "Microservices" },
    blurb: {
      en: "Service boundaries, sagas, consistency and the honest cost of distributing a system that used to be one process.",
      vi: "Ranh giới service, saga, tính nhất quán và cái giá thật của việc tách một hệ thống từng là một process.",
    },
  },
  {
    key: "Distributed Systems",
    slug: "distributed-systems",
    accent: "distributed",
    label: { en: "Distributed Systems", vi: "Hệ thống phân tán" },
    blurb: {
      en: "Retries, idempotency, ordering and failure modes that only appear when more than one machine is involved.",
      vi: "Retry, idempotency, thứ tự và những kiểu lỗi chỉ xuất hiện khi có nhiều hơn một máy tham gia.",
    },
  },
  {
    key: "AI & AI Agents",
    slug: "ai-agents",
    accent: "ai",
    label: { en: "AI & AI Agents", vi: "AI & AI Agent" },
    blurb: {
      en: "Agent runtimes, spec-driven development, guardrails and what actually changes when an LLM sits in the request path.",
      vi: "Agent runtime, spec-driven development, guardrail và điều thực sự thay đổi khi một LLM nằm trong đường đi của request.",
    },
  },
  {
    key: "Security",
    slug: "security",
    accent: "security",
    label: { en: "Security", vi: "Bảo mật" },
    blurb: {
      en: "Threat models, zero trust, supply chain and the security work that has to happen before the incident, not after.",
      vi: "Threat model, zero trust, supply chain và phần bảo mật phải làm trước sự cố, không phải sau.",
    },
  },
  {
    key: "DevOps & Infrastructure",
    slug: "devops",
    accent: "devops",
    label: { en: "DevOps & Infrastructure", vi: "DevOps & Hạ tầng" },
    blurb: {
      en: "Build pipelines, containers, observability and the self-hosted lab where I break things on purpose.",
      vi: "Pipeline build, container, observability và cái lab self-host nơi mình cố tình làm hỏng mọi thứ.",
    },
  },
  {
    key: "Engineering Practices",
    slug: "engineering-practices",
    accent: "practices",
    label: { en: "Engineering Practices", vi: "Thực hành kỹ thuật" },
    blurb: {
      en: "How teams write, review, document and decide — the human half of shipping software.",
      vi: "Cách team viết, review, ghi tài liệu và ra quyết định — nửa con người của việc ship phần mềm.",
    },
  },
  {
    key: "Backend Engineering",
    slug: "backend",
    accent: "backend",
    label: { en: "Backend Engineering", vi: "Backend Engineering" },
    blurb: {
      en: "Runtime behaviour, configuration and the small decisions that quietly take a service down.",
      vi: "Hành vi runtime, cấu hình và những quyết định nhỏ âm thầm làm sập một service.",
    },
  },
];

const byKey = new Map(CATEGORIES.map((c) => [c.key, c]));
const bySlug = new Map(CATEGORIES.map((c) => [c.slug, c]));

export const categoryByKey = (key: string): CategoryDef | undefined =>
  byKey.get(key as CategoryKey);
export const categoryBySlug = (slug: string): CategoryDef | undefined => bySlug.get(slug);

/** Unknown categories degrade gracefully instead of breaking a build. */
export const categoryLabel = (key: string, locale: Locale): string =>
  categoryByKey(key)?.label[locale] ?? key;

export const categoryAccent = (key: string): string => categoryByKey(key)?.accent ?? "practices";
