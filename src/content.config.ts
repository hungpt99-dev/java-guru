import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";
import { LOCALES } from "@/i18n/config";

/**
 * One collection, one entry per (article, locale) pair.
 *
 * Files live at src/content/posts/<slug>/{vi,en}.md. Both translations share the
 * same `translationKey` and `slug`, which is what makes the language switcher
 * land on the same article instead of the homepage.
 */
const posts = defineCollection({
  loader: glob({
    pattern: "**/{vi,en}.md",
    base: "./src/content/posts",
    // Default id generation uses the `slug` frontmatter field, which both
    // translations share — that would collapse each pair into one entry. The
    // file path (slug/locale) keeps every locale distinct.
    generateId: ({ entry }) => entry.replace(/\.md$/, ""),
  }),
  schema: ({ image }) => {
    const entry = z.object({
      title: z.string().min(1),
      description: z.string().min(1),
      slug: z.string().min(1),
      locale: z.enum(LOCALES),
      translationKey: z.string().min(1),
      pubDate: z.coerce.date(),
      category: z.string().min(1),
      tags: z.array(z.string()).default([]),
      featured: z.boolean().default(false),
      draft: z.boolean().default(false),
      readingTime: z.number().int().nonnegative().optional(),
      series: z.string().nullable().optional(),
      coverImage: image().optional().nullable(),
    });

    return entry.superRefine((value, ctx) => {
      // The folder name is the canonical slug; frontmatter must agree with it or
      // the language switcher cannot resolve the sibling translation.
      if (value.slug !== value.translationKey) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `slug "${value.slug}" must equal translationKey "${value.translationKey}"`,
          path: ["slug"],
        });
      }
    });
  },
});

export const collections = { posts };
