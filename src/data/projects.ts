/**
 * Projects are pulled from the author's public GitHub metadata (name,
 * description, language, topics) and curated by hand. Nothing here is invented:
 * every entry exists at the URL below.
 */
export type Project = {
  name: string;
  description: string;
  href: string;
  language?: string;
  topics?: string[];
  note?: string;
  featured?: boolean;
};

export const PROJECTS: Project[] = [
  {
    name: "java-guru",
    description:
      "This site: a static Astro journal with five colour themes, full-text search and article-level syntax theming. The articles are migrated verbatim from Viblo.",
    href: "https://github.com/hungpt99-dev/java-guru",
    language: "Astro",
    topics: ["backend", "java", "jvm", "spring-boot", "learning"],
    note: "you are reading it",
    featured: true,
  },
  {
    name: "project-template",
    description:
      "Enterprise Java microservices platform template — cloud-native, event-driven, DDD + Clean/Hexagonal architecture with Spring Boot, Kafka, PostgreSQL, Redis, K8s/Helm and OpenTelemetry.",
    href: "https://github.com/hungpt99-dev/project-template",
    language: "Java",
    topics: ["microservices", "ddd", "kafka", "kubernetes", "opentelemetry"],
    featured: true,
  },
  {
    name: "ddd-lab",
    description:
      "Production-style digital wallet / personal finance backend demonstrating DDD and Clean Architecture: Java 21, Spring Boot 3, JPA, Flyway, Testcontainers and ArchUnit.",
    href: "https://github.com/hungpt99-dev/ddd-lab",
    language: "Java",
    topics: ["ddd", "clean-architecture", "spring-boot", "testing"],
    featured: true,
  },
  {
    name: "Nexio",
    description:
      "Popup AI assistant on a global hotkey (BYOK). Ask answers, Do acts with approval-first file and shell tools, memory stays in local SQLite.",
    href: "https://github.com/hungpt99-dev/Nexio",
    language: "TypeScript",
    topics: ["ai-agent", "desktop", "sqlite"],
    note: "agent tooling",
  },
  {
    name: "awesome-books",
    description:
      "A curated collection of books worth sharing — organised by topic, with a note on why each one earned its place.",
    href: "https://github.com/hungpt99-dev/awesome-books",
    topics: ["books", "learning", "system-design"],
    note: "reading list",
  },
];
