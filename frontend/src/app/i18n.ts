// Translation setup. Every visible text comes from public/locales/<language>/common.json.
// English (en-IN) is the only language now; Marathi (mr) and Hindi (hi) can be added later
// by adding their JSON files, with no code changes.
// Note for M4 (offline kiosk): these files load over HTTP, so the service worker must
// precache /locales/ or the kiosk shows a blank screen when it starts offline.
import i18n from "i18next";
import HttpBackend from "i18next-http-backend";
import { initReactI18next } from "react-i18next";
import { sharedI18nOptions } from "./i18n-options";

i18n
  .use(HttpBackend)
  .use(initReactI18next)
  .init({
    ...sharedI18nOptions,
    backend: { loadPath: "/locales/{{lng}}/{{ns}}.json" },
  });

export default i18n;
