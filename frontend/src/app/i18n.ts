// Translation setup. Every visible text comes from public/locales/<language>/common.json.
// English (en-IN) is the language of the whole website. Marathi (mr) and Hindi (hi) exist only for
// the /phone pages (F-99): their files hold just those texts and anything missing falls back to
// English. The admin and gate pages always stay English.
// Note for M4 (offline kiosk): these files load over HTTP, so the service worker must
// precache /locales/ or the kiosk shows a blank screen when it starts offline.
import i18n from "i18next";
import HttpBackend from "i18next-http-backend";
import { initReactI18next } from "react-i18next";
import { startingLanguage } from "@/features/phone/phone-language";
import { sharedI18nOptions } from "./i18n-options";

i18n
  .use(HttpBackend)
  .use(initReactI18next)
  .init({
    ...sharedI18nOptions,
    // Only the /phone pages have Marathi and Hindi (F-99); everything else starts in English.
    lng: startingLanguage(window.location.pathname),
    backend: { loadPath: "/locales/{{lng}}/{{ns}}.json" },
  });

export default i18n;
