import rss from "@astrojs/rss";
import type { APIContext, GetStaticPaths } from "astro";
import { getPosts } from "@/utils/posts";
import { SITE } from "@/config";
import { LOCALES, LOCALE_META, type Locale } from "@/i18n/config";
import { useTranslations } from "@/i18n/ui";

export const getStaticPaths = (() =>
  LOCALES.map((locale) => ({ params: { locale } }))) satisfies GetStaticPaths;

export async function GET(context: APIContext) {
  const locale = (context.params.locale ?? "en") as Locale;
  const posts = await getPosts(locale);
  const t = useTranslations(locale);
  const origin = (context.site ?? new URL(SITE.url)).toString().replace(/\/$/, "");

  return rss({
    title: `${SITE.title} — ${t("site.tagline")}`,
    description: t("site.description"),
    site: context.site ?? SITE.url,
    xmlns: { atom: "http://www.w3.org/2005/Atom" },
    customData: [
      `<language>${LOCALE_META[locale].htmlLang}</language>`,
      `<managingEditor>${SITE.author.handle} (${SITE.author.name})</managingEditor>`,
      `<atom:link href="${origin}/${locale}/rss.xml" rel="self" type="application/rss+xml" />`,
    ].join(""),
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.pubDate,
      description: post.data.description,
      link: `/${locale}/posts/${post.data.slug}/`,
      categories: [post.data.category, ...post.data.tags],
      author: SITE.author.name,
    })),
  });
}
