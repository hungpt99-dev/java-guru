import type { Locale } from "@/i18n/config";

/**
 * Projects are curated from the author's public GitHub metadata (name,
 * description, language, topics). Nothing here is invented: every entry exists
 * at the URL below. Descriptions are localised for display only.
 */
export type Project = {
  name: string;
  description: Record<Locale, string>;
  href: string;
  language?: string;
  topics?: string[];
  note?: Record<Locale, string>;
  featured?: boolean;
};

export const PROJECTS: Project[] = [
  {
    name: "java-guru",
    description: {
      en: "This site: a bilingual Astro journal with five colour themes, full-text search and per-theme syntax highlighting.",
      vi: "Chính trang này: một journal Astro song ngữ với năm giao diện màu, tìm kiếm toàn văn và syntax highlighting theo từng theme.",
    },
    href: "https://github.com/hungpt99-dev/java-guru",
    language: "Astro",
    topics: ["backend", "java", "jvm", "spring-boot", "learning"],
    note: { en: "you are reading it", vi: "bạn đang đọc nó" },
    featured: true,
  },
  {
    name: "project-template",
    description: {
      en: "Enterprise Java microservices platform template — cloud-native, event-driven, DDD + Clean/Hexagonal architecture with Spring Boot, Kafka, PostgreSQL, Redis, K8s/Helm and OpenTelemetry.",
      vi: "Template nền tảng microservices Java cho doanh nghiệp — cloud-native, event-driven, kiến trúc DDD + Clean/Hexagonal với Spring Boot, Kafka, PostgreSQL, Redis, K8s/Helm và OpenTelemetry.",
    },
    href: "https://github.com/hungpt99-dev/project-template",
    language: "Java",
    topics: ["microservices", "ddd", "kafka", "kubernetes", "opentelemetry"],
    featured: true,
  },
  {
    name: "ddd-lab",
    description: {
      en: "Production-style digital wallet / personal finance backend demonstrating DDD and Clean Architecture: Java 21, Spring Boot 3, JPA, Flyway, Testcontainers and ArchUnit.",
      vi: "Backend ví điện tử / tài chính cá nhân theo kiểu production, minh hoạ DDD và Clean Architecture: Java 21, Spring Boot 3, JPA, Flyway, Testcontainers và ArchUnit.",
    },
    href: "https://github.com/hungpt99-dev/ddd-lab",
    language: "Java",
    topics: ["ddd", "clean-architecture", "spring-boot", "testing"],
    featured: true,
  },
  {
    name: "Nexio",
    description: {
      en: "Popup AI assistant on a global hotkey (BYOK). Ask answers, Do acts with approval-first file and shell tools, memory stays in local SQLite.",
      vi: "Trợ lý AI bật bằng phím tắt toàn cục (BYOK). Ask để hỏi, Do để thao tác với file và shell theo cơ chế duyệt trước, bộ nhớ lưu trong SQLite cục bộ.",
    },
    href: "https://github.com/hungpt99-dev/Nexio",
    language: "TypeScript",
    topics: ["ai-agent", "desktop", "sqlite"],
    note: { en: "agent tooling", vi: "agent tooling" },
  },
  {
    name: "awesome-books",
    description: {
      en: "A curated collection of books worth sharing — organised by topic, with a note on why each one earned its place.",
      vi: "Danh sách sách đáng chia sẻ — sắp theo chủ đề, kèm ghi chú vì sao từng cuốn xứng đáng có mặt.",
    },
    href: "https://github.com/hungpt99-dev/awesome-books",
    topics: ["books", "learning", "system-design"],
    note: { en: "reading list", vi: "danh sách đọc" },
  },
];
