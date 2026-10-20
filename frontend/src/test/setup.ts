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

// jsdom has no layout engine; the command palette (cmdk) needs these two browser features.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};

// Pages load data and render big tables; under coverage a laptop can need more than 1 second.
// Pages are also loaded lazily (app/router.tsx): the first test that opens a big page, such as
// the plant page with its map, waits for that code to load as well.
configure({ asyncUtilTimeout: 8000 });

afterEach(() => {
  cleanup();
});
