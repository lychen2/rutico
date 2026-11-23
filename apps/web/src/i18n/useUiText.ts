import { useLocale } from "gt-react";

import { readUiLocale, uiText } from "./index";

/** Translates Usage / Cost / Tokens / Limits copy reactively against GT's active locale. */
export function useUiText() {
  const locale = useLocale();
  const gtLocale = locale.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
  // Allow test harness overrides via readUiLocale() when explicitly set.
  const active = readUiLocale() === "zh-CN" ? "zh-CN" : gtLocale;
  return (source: string, values?: Readonly<Record<string, unknown>>) =>
    uiText(source, values, active);
}
