/**
 * rehype plugin: small, content-neutral DOM improvements for article bodies.
 *  - wraps wide tables in a focusable scroll container
 *  - lazy-loads inline images and gives them decoding hints
 *  - marks external links so they open safely in a new tab
 * Nothing here changes text, ordering or markup semantics.
 */
import { join } from "node:path";
import sharp from "sharp";
import type { Element, ElementContent, Root } from "hast";

/** Cached intrinsic sizes so inline figures get width/height (no layout shift). */
const sizeCache = new Map<string, { width: number; height: number } | null>();

async function intrinsicSize(src: string) {
  if (!src.startsWith("/images/")) return null;
  if (sizeCache.has(src)) return sizeCache.get(src) ?? null;
  try {
    const meta = await sharp(join(process.cwd(), "public", src)).metadata();
    const size = meta.width && meta.height ? { width: meta.width, height: meta.height } : null;
    sizeCache.set(src, size);
    return size;
  } catch {
    sizeCache.set(src, null);
    return null;
  }
}

const el = (
  tagName: string,
  properties: Element["properties"],
  children: ElementContent[]
): Element => ({ type: "element", tagName, properties, children });

const isAbsolute = (href: string) => /^https?:\/\//i.test(href);

export default function rehypeProse(site?: string) {
  const host = site ? new URL(site).host : "";
  return async (tree: Root) => {
    const walk = async (node: Root | Element) => {
      const kids = node.children ?? [];
      for (let i = 0; i < kids.length; i++) {
        const child = kids[i];
        if (child.type !== "element") continue;

        if (child.tagName === "table") {
          const wrapper = el(
            "div",
            {
              className: ["table-scroll"],
              tabindex: "0",
              role: "region",
              "aria-label": "Scrollable table",
            },
            [child]
          );
          node.children[i] = wrapper;
          continue;
        }

        if (child.tagName === "img") {
          const src = String(child.properties?.src ?? "");
          const size = await intrinsicSize(src);
          child.properties = {
            ...child.properties,
            loading: "lazy",
            decoding: "async",
            ...(size ? { width: size.width, height: size.height } : {}),
          };
        }

        if (child.tagName === "a") {
          const href = String(child.properties?.href ?? "");
          if (isAbsolute(href)) {
            let external = true;
            try {
              external = new URL(href).host !== host;
            } catch {
              external = true;
            }
            if (external) {
              child.properties = {
                ...child.properties,
                target: "_blank",
                rel: ["noopener", "noreferrer"],
              };
            }
          }
        }

        await walk(child);
      }
    };
    await walk(tree);
  };
}
