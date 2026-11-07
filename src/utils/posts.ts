import { getCollection, type CollectionEntry } from "astro:content";
import type { Locale } from "@/i18n/config";
import { categoryByKey, categoryLabel, categoryAccent } from "@/data/categories";
import { localePath } from "@/utils/i18n";

export type Post = CollectionEntry<"posts">;

export type Term = {
  name: string;
  label: string;
  slug: string;
  count: number;
  accent?: string;
  blurb?: string;
};

/** Every published entry, both locales. */
export async function getAllEntries(): Promise<Post[]> {
  const entries = await getCollection("posts", ({ data }) => !data.draft);
  return entries.sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());
}

/** Published entries for one locale, newest first. */
export async function getPosts(locale: Locale): Promise<Post[]> {
  return (await getAllEntries()).filter((post) => post.data.locale === locale);
}

export function postSlug(post: Post): string {
  return post.data.slug;
}

export function postHref(post: Post): string {
  return localePath(post.data.locale, `/posts/${post.data.slug}/`);
}

/**
 * translationKey -> { en, vi }. Powers the language switcher and the bilingual
 * validator that proves both sides exist.
 */
export function buildTranslationIndex(entries: Post[]): Map<string, Partial<Record<Locale, Post>>> {
  const index = new Map<string, Partial<Record<Locale, Post>>>();
  for (const entry of entries) {
    const key = entry.data.translationKey;
    const bucket = index.get(key) ?? {};
    bucket[entry.data.locale] = entry;
    index.set(key, bucket);
  }
  return index;
}

export function translationsOf(
  post: Post,
  index: Map<string, Partial<Record<Locale, Post>>>
): Partial<Record<Locale, Post>> {
  return index.get(post.data.translationKey) ?? {};
}

/** Number of distinct articles, not of locale files. */
export async function articleCount(): Promise<number> {
  return buildTranslationIndex(await getAllEntries()).size;
}

export function isFeatured(post: Post): boolean {
  return post.data.featured === true;
}

export function featuredPosts(posts: Post[], limit = 3): Post[] {
  const featured = posts.filter(isFeatured);
  return (featured.length ? featured : posts).slice(0, limit);
}

/** Categories present in one locale, with localised labels and live counts. */
export function getCategories(posts: Post[], locale: Locale): Term[] {
  const counts = new Map<string, number>();
  for (const post of posts) {
    counts.set(post.data.category, (counts.get(post.data.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => {
      const def = categoryByKey(key);
      return {
        name: key,
        label: categoryLabel(key, locale),
        slug: def?.slug ?? key.toLowerCase().replace(/\s+/g, "-"),
        count,
        accent: categoryAccent(key),
        blurb: def?.blurb[locale] ?? "",
      };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function slugifyTag(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/@/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Tag labels are the author's own; tags that differ only by case or punctuation
 * share one page under a single slug.
 */
export function getTags(posts: Post[]): Term[] {
  const map = new Map<string, { names: Map<string, number>; count: number }>();
  for (const post of posts) {
    for (const tag of post.data.tags) {
      const slug = slugifyTag(tag);
      if (!slug) continue;
      const entry = map.get(slug) ?? { names: new Map(), count: 0 };
      entry.count += 1;
      entry.names.set(tag, (entry.names.get(tag) ?? 0) + 1);
      map.set(slug, entry);
    }
  }
  return [...map.entries()]
    .map(([slug, { names, count }]) => {
      const name = [...names.entries()].sort((a, b) => b[1] - a[1])[0][0];
      return { name, label: name, slug, count };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function postsByCategory(posts: Post[], slug: string): Post[] {
  return posts.filter((p) => (categoryByKey(p.data.category)?.slug ?? "") === slug);
}

export function postsByTag(posts: Post[], slug: string): Post[] {
  return posts.filter((p) => p.data.tags.some((tag) => slugifyTag(tag) === slug));
}

export function postTags(post: Post): Array<{ name: string; slug: string }> {
  return post.data.tags.map((name) => ({ name, slug: slugifyTag(name) })).filter((t) => t.slug);
}

/**
 * Related reading within the same locale: same category first, then shared tags,
 * then recency. Deterministic, so builds never shuffle.
 */
export function relatedPosts(post: Post, posts: Post[], limit = 3): Post[] {
  const tags = new Set(post.data.tags.map(slugifyTag));
  const scored = posts
    .filter((p) => p.id !== post.id)
    .map((p) => {
      let score = 0;
      if (p.data.category === post.data.category) score += 3;
      for (const tag of p.data.tags) if (tags.has(slugifyTag(tag))) score += 2;
      return { p, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.p.data.pubDate.getTime() - a.p.data.pubDate.getTime());
  return scored.slice(0, limit).map((entry) => entry.p);
}

export function adjacentPosts(post: Post, posts: Post[]) {
  const index = posts.findIndex((p) => p.id === post.id);
  return {
    newer: index > 0 ? posts[index - 1] : undefined,
    older: index >= 0 && index < posts.length - 1 ? posts[index + 1] : undefined,
  };
}

export function totalReadingMinutes(posts: Post[]): number {
  return posts.reduce((sum, p) => sum + (p.data.readingTime ?? 0), 0);
}
