import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

/**
 * One collection, one language per entry. Articles keep the language they were
 * published in (`lang`), which drives <html lang>, the Open Graph locale and
 * the `inLanguage` field of the article's structured data.
 */
const blog = defineCollection({
  loader: glob({ pattern: "**/[^_]*.md", base: "./src/content/blog" }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      pubDatetime: z.coerce.date(),
      modDatetime: z.coerce.date().nullable().optional(),
      category: z.string(),
      tags: z.array(z.string()).default([]),
      lang: z.string().default("vi"),
      featured: z.boolean().default(false),
      draft: z.boolean().default(false),
      readingTime: z.number().int().nonnegative().optional(),
      coverImage: image().optional().nullable(),
      series: z.string().nullable().optional(),
      /** Original publication, kept for provenance and "read the original" links. */
      sourceUrl: z.string().url().optional(),
      sourceReleasedAt: z.string().optional(),
      sourceUpdatedAt: z.string().optional(),
      sourceTags: z.array(z.string()).default([]),
    }),
});

export const collections = { blog };
