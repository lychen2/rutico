import { getActiveLocale } from "./messages";
import { usageZhCN } from "./usageCatalog";

export type UiLocale = "zh-CN" | "en";

let localeOverride: UiLocale | null = null;

export function syncCustomLocale(locale: string | null): void {
  if (locale === null) {
    localeOverride = null;
    return;
  }
  localeOverride = locale.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function readUiLocale(): UiLocale {
  if (localeOverride !== null) return localeOverride;
  return getActiveLocale().toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function uiText(
  source: string,
  values?: Readonly<Record<string, unknown>>,
  locale: UiLocale = readUiLocale(),
): string {
  const translated = locale === "zh-CN" ? (usageZhCN[source] ?? source) : source;
  if (!values) return translated;
  return translated.replace(/\{([A-Za-z0-9_]+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : placeholder,
  );
}
