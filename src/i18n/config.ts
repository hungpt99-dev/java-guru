/**
 * Locale registry. Every route is prefixed with one of these codes; the default
 * locale is also where the bare root URL sends first-time visitors.
 */
export const LOCALES = ["en", "vi"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_META: Record<
  Locale,
  {
    label: string;
    short: string;
    htmlLang: string;
    ogLocale: string;
    dateLocale: string;
    dir: "ltr" | "rtl";
  }
> = {
  en: {
    label: "English",
    short: "EN",
    htmlLang: "en",
    ogLocale: "en_US",
    dateLocale: "en-GB",
    dir: "ltr",
  },
  vi: {
    label: "Tiếng Việt",
    short: "VI",
    htmlLang: "vi",
    ogLocale: "vi_VN",
    dateLocale: "vi-VN",
    dir: "ltr",
  },
};

export const isLocale = (value: string): value is Locale =>
  (LOCALES as readonly string[]).includes(value);

/** The other locale — the blog is bilingual, so there is exactly one. */
export const otherLocale = (locale: Locale): Locale => (locale === "en" ? "vi" : "en");
