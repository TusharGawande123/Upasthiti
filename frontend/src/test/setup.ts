// Runs before every test file: adds DOM matchers and loads the English texts directly
// (no network), so components render real strings in tests.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { afterEach } from "vitest";
import englishTexts from "../../public/locales/en/common.json";

i18n.use(initReactI18next).init({
  lng: "en",
  ns: ["common"],
  defaultNS: "common",
  resources: { en: { common: englishTexts } },
  interpolation: { escapeValue: false },
});

afterEach(() => {
  cleanup();
});
