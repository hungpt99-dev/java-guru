import { getCollection, type CollectionEntry } from "astro:content";
import { tagSlug, categorySlug } from "@/utils/slug";
import { CATEGORY_ACCENTS, CATEGORY_BLURBS } from "@/config";

export type Post = CollectionEntry<"blog">;

export type Term = {
  name: string;
  slug: string;
  count: number;
  accent?: string;
  blurb?: string;
};

/** All published articles, newest first. */
export async function getPosts(): Promise<Post[]> {
  const posts = await getCollection("blog", ({ data }) => !data.draft);
  return posts.sort((a, b) => b.data.pubDatetime.getTime() - a.data.pubDatetime.getTime());
}

export function postSlug(post: Post): string {
  return post.id.replace(/\.md$/, "");
}

export function postHref(post: Post): string {
  return `/posts/${postSlug(post)}`;
}

export function isFeatured(post: Post): boolean {
  return post.data.featured === true;
}

export function featuredPosts(posts: Post[], limit = 3): Post[] {
  const featured = posts.filter(isFeatured);
  return (featured.length ? featured : posts).slice(0, limit);
}

/** Categories actually present in the collection, with live counts. */
export function getCategories(posts: Post[]): Term[] {
  const map = new Map<string, number>();
  for (const post of posts) map.set(post.data.category, (map.get(post.data.category) ?? 0) + 1);
  return [...map.entries()]
    .map(([name, count]) => ({
      name,
      slug: categorySlug(name),
      count,
      accent: CATEGORY_ACCENTS[name] ?? "practices",
      blurb: CATEGORY_BLURBS[name],
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * Tags as published on the original articles. Names are kept verbatim; tags
 * that only differ by case or punctuation share one page under a single slug.
 */
export function getTags(posts: Post[]): Term[] {
  const map = new Map<string, { names: Map<string, number>; count: number }>();
  for (const post of posts) {
    for (const tag of post.data.tags) {
      const slug = tagSlug(tag);
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
      return { name, slug, count };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function postsByCategory(posts: Post[], slug: string): Post[] {
  return posts.filter((p) => categorySlug(p.data.category) === slug);
}

export function postsByTag(posts: Post[], slug: string): Post[] {
  return posts.filter((p) => p.data.tags.some((t) => tagSlug(t) === slug));
}

/** Tag cloud for one article: /tags/<slug> links. */
export function postTags(post: Post): Array<{ name: string; slug: string }> {
  return post.data.tags
    .map((name) => ({ name, slug: tagSlug(name) }))
    .filter((t) => t.slug.length > 0);
}

/**
 * Related reading: same category first, then shared tags, then recency.
 * Deterministic so the build never shuffles.
 */
export function relatedPosts(post: Post, posts: Post[], limit = 3): Post[] {
  const tags = new Set(post.data.tags.map(tagSlug));
  const scored = posts
    .filter((p) => p.id !== post.id)
    .map((p) => {
      let score = 0;
      if (p.data.category === post.data.category) score += 3;
      for (const tag of p.data.tags) if (tags.has(tagSlug(tag))) score += 2;
      if (p.data.series && p.data.series === post.data.series) score += 2;
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort(
      (a, b) => b.score - a.score || b.p.data.pubDatetime.getTime() - a.p.data.pubDatetime.getTime()
    );
  return scored.slice(0, limit).map((x) => x.p);
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
