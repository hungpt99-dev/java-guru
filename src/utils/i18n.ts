import { DEFAULT_LOCALE, LOCALE_META, LOCALES, isLocale, type Locale } from "@/i18n/config";

export const localePrefix = (locale: Locale): string => `/${locale}`;

/** Builds a locale-prefixed path from an unprefixed route ("/posts/" -> "/vi/posts/"). */
export function localePath(locale: Locale, path = "/"): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${localePrefix(locale)}${clean === "/" ? "/" : clean}`;
}

/** "/vi/posts/foo/" -> "/posts/foo/" (root becomes "/"). */
export function stripLocale(pathname: string): string {
  const match = pathname.match(/^\/([a-z]{2})(\/.*)?$/);
  if (match && isLocale(match[1])) return match[2] && match[2] !== "" ? match[2] : "/";
  return pathname;
}

export function localeFromPath(pathname: string): Locale {
  const match = pathname.match(/^\/([a-z]{2})(?:\/|$)/);
  if (match && isLocale(match[1])) return match[1];
  return DEFAULT_LOCALE;
}

/** Same page, other language. Works for articles because slugs are shared. */
export function alternatePath(pathname: string, target: Locale): string {
  return localePath(target, stripLocale(pathname));
}

/** Absolute URL for canonical/hreflang tags. */
export function absoluteUrl(path: string, site: string | undefined): string {
  return new URL(path, site ?? "https://java-guru.dev").href;
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: Locale, long: boolean, withYear = true): Intl.DateTimeFormat {
  const key = `${locale}-${long}-${withYear}`;
  let fmt = dateFormatters.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(LOCALE_META[locale].dateLocale, {
      day: "numeric",
      month: long ? "long" : "short",
      ...(withYear ? { year: "numeric" } : {}),
      timeZone: "Asia/Ho_Chi_Minh",
    });
    dateFormatters.set(key, fmt);
  }
  return fmt;
}

/** Dates are rendered in the author's timezone so a build server never shifts them. */
export const formatDate = (date: Date, locale: Locale): string =>
  formatter(locale, false).format(date);
export const formatLongDate = (date: Date, locale: Locale): string =>
  formatter(locale, true).format(date);

export const isoDate = (date: Date): string =>
  new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(date);

export const localeOptions = LOCALES.map((locale) => ({
  locale,
  label: LOCALE_META[locale].label,
  short: LOCALE_META[locale].short,
  htmlLang: LOCALE_META[locale].htmlLang,
}));
