import type { APIContext } from "astro";
import { SITE } from "@/config";

export function GET(context: APIContext) {
  const site = (context.site ?? SITE.url).toString().replace(/\/$/, "");
  const body = [
    "User-agent: *",
    "Allow: /",
    "",
    "# Generated sitemap (index + per-page files)",
    `Sitemap: ${site}/sitemap-index.xml`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
