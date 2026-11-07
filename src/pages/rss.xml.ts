import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { getPosts } from "@/utils/posts";
import { SITE } from "@/config";

export async function GET(context: APIContext) {
  const posts = await getPosts();

  return rss({
    title: `${SITE.title} — ${SITE.tagline}`,
    description: SITE.description,
    site: context.site ?? SITE.url,
    xmlns: { atom: "http://www.w3.org/2005/Atom" },
    customData: [
      `<language>vi</language>`,
      `<managingEditor>${SITE.author.handle} (${SITE.author.name})</managingEditor>`,
      `<atom:link href="${new URL("/rss.xml", context.site ?? SITE.url).href}" rel="self" type="application/rss+xml" />`,
    ].join(""),
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.pubDatetime,
      description: post.data.description,
      link: `/posts/${post.id}/`,
      categories: [post.data.category, ...post.data.tags],
      author: SITE.author.name,
    })),
  });
}
