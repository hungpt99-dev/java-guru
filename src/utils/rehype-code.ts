/**
 * rehype plugin: highlight fenced code with Shiki and wrap each block in a
 * figure carrying the language label and copy button.
 *
 * One custom TextMate theme carries DevShelf's exact highlight palette; the
 * tokens are emitted as `--shiki-*` custom properties (`defaultColor: false`)
 * and global.css maps them onto the active palette.
 */
import { createHighlighter, type Highlighter, type ThemeRegistration } from "shiki";
import type { Element, ElementContent, Root, Text } from "hast";

const DEVSHELF_THEME = {
  name: "devshelf",
  type: "dark",
  colors: {
    "editor.background": "#171717",
    "editor.foreground": "#f4f4f0",
  },
  tokenColors: [
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: "#8a8a82", fontStyle: "italic" },
    },
    {
      scope: ["keyword", "keyword.control", "storage", "entity.name.tag"],
      settings: { foreground: "#c8f542", fontStyle: "bold" },
    },
    {
      scope: ["string", "string.quoted", "constant.character"],
      settings: { foreground: "#a7d68a" },
    },
    {
      scope: ["constant.numeric", "constant.language", "constant.other"],
      settings: { foreground: "#d8b47a" },
    },
    {
      scope: [
        "entity.name",
        "entity.name.function",
        "entity.name.type",
        "support.type",
        "support.class",
      ],
      settings: { foreground: "#9ec9e8" },
    },
  ],
} as const;

const ALIASES: Record<string, string> = {
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  yml: "yaml",
  docker: "dockerfile",
  ps1: "powershell",
  js: "javascript",
  ts: "typescript",
  properties: "ini",
  env: "ini",
  plaintext: "text",
  plain: "text",
};

let highlighterPromise: Promise<Highlighter> | undefined;

function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter({
    themes: [DEVSHELF_THEME as unknown as ThemeRegistration],
    langs: [],
  });
  return highlighterPromise;
}

const el = (
  tagName: string,
  properties: Element["properties"],
  children: ElementContent[]
): Element => ({ type: "element", tagName, properties, children });

const txt = (value: string): Text => ({ type: "text", value });

function fenceLanguage(code: Element): string {
  const cls = (code.properties?.className as string[] | undefined) ?? [];
  const match = cls.find((c: string) => typeof c === "string" && c.startsWith("language-"));
  return match ? match.slice("language-".length).toLowerCase() : "";
}

const LABELS: Record<string, string> = {
  text: "plain text",
  bash: "shell",
  ini: "config",
};

export default function rehypeCode() {
  return async (tree: Root) => {
    const highlighter = await getHighlighter();
    const jobs: Array<{ code: Element; parent: Element; index: number }> = [];

    const walk = (node: Root | Element) => {
      const kids = node.children ?? [];
      for (let i = 0; i < kids.length; i++) {
        const child = kids[i];
        if (child.type !== "element") continue;
        if (child.tagName === "pre") {
          const code = child.children.find(
            (c: ElementContent): c is Element => c.type === "element" && c.tagName === "code"
          );
          if (code) jobs.push({ code, parent: node as Element, index: i });
          continue;
        }
        walk(child);
      }
    };
    walk(tree);

    for (const job of jobs) {
      const raw = job.code.children
        .filter((c: ElementContent): c is Text => c.type === "text")
        .map((c: Text) => c.value)
        .join("");
      const fenceLang = fenceLanguage(job.code) || "text";
      const lang = ALIASES[fenceLang] ?? fenceLang;

      // Mermaid is rendered client-side on demand; keep the source as text.
      if (lang === "mermaid") {
        job.parent.children[job.index] = el(
          "div",
          { className: ["mermaid-block"], "data-mermaid": "true", "data-rendered": "false" },
          [txt(raw.replace(/\n$/, ""))]
        );
        continue;
      }

      let loaded = highlighter.getLoadedLanguages().includes(lang);
      if (!loaded) {
        try {
          await highlighter.loadLanguage(lang as Parameters<Highlighter["loadLanguage"]>[0]);
          loaded = true;
        } catch {
          loaded = false;
        }
      }

      let pre: Element;
      if (loaded) {
        const hast = highlighter.codeToHast(raw.replace(/\n$/, ""), {
          lang,
          themes: { dark: "devshelf", light: "devshelf" },
          defaultColor: false,
        });
        pre = hast.children[0] as Element;
        pre.properties = { ...pre.properties, class: ["astro-code"], style: undefined };
      } else {
        pre = el("pre", { className: ["astro-code"] }, [
          el("code", {}, [txt(raw.replace(/\n$/, ""))]),
        ]);
      }

      const label = LABELS[lang] ?? (fenceLang === "text" ? "plain text" : lang);
      job.parent.children[job.index] = el(
        "figure",
        { className: ["code-block"], "data-lang": lang },
        [
          el("figcaption", { className: ["code-block__bar"] }, [
            el("span", { className: ["code-block__lang"] }, [txt(label)]),
            el(
              "button",
              {
                type: "button",
                className: ["code-copy"],
                "data-copy": "true",
                "aria-label": `Copy ${label} code to clipboard`,
              },
              [txt("copy")]
            ),
          ]),
          pre,
        ]
      );
    }
  };
}
