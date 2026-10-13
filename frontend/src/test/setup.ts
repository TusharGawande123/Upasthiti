// Runs before every test file: adds DOM matchers and loads the English texts directly
// (no network), with the same settings as the real app, so components render real strings.
import "@testing-library/jest-dom/vitest";
// An in-memory IndexedDB, so the kiosk's device storage (Dexie) works in tests.
import "fake-indexeddb/auto";
import { cleanup, configure } from "@testing-library/react";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { afterEach } from "vitest";
import englishTexts from "../../public/locales/en/common.json";
import { sharedI18nOptions } from "../app/i18n-options";

i18n.use(initReactI18next).init({
  ...sharedI18nOptions,
  resources: { en: { common: englishTexts } },
});

// Pages load data and render big tables; under coverage a laptop can need more than 1 second.
configure({ asyncUtilTimeout: 4000 });

afterEach(() => {
  cleanup();
});
