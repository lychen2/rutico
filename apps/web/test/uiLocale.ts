import { type UiLocale, readUiLocale, syncCustomLocale } from "../src/i18n";

export function testUiLocale(locale: UiLocale): Disposable {
  const previous = readUiLocale();
  syncCustomLocale(locale);
  return { [Symbol.dispose]: () => syncCustomLocale(previous) };
}
