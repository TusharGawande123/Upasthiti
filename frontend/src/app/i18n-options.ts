// Translation settings shared by the app (i18n.ts) and the tests (test/setup.ts), so both
// always behave the same.
import type { InitOptions } from "i18next";

export const sharedI18nOptions: InitOptions = {
  lng: "en",
  fallbackLng: "en",
  ns: ["common"],
  defaultNS: "common",
  // React already escapes text, so i18next must not escape it a second time.
  interpolation: { escapeValue: false },
};
