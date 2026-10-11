// Translation setup. Every visible text comes from public/locales/<language>/common.json.
// English (en-IN) is the only language now; Marathi (mr) and Hindi (hi) can be added later
// by adding their JSON files, with no code changes.
import i18n from "i18next";
import HttpBackend from "i18next-http-backend";
import { initReactI18next } from "react-i18next";

i18n
  .use(HttpBackend)
  .use(initReactI18next)
  .init({
    lng: "en",
    fallbackLng: "en",
    ns: ["common"],
    defaultNS: "common",
    backend: { loadPath: "/locales/{{lng}}/{{ns}}.json" },
    // React already escapes text, so i18next must not escape it a second time.
    interpolation: { escapeValue: false },
  });

export default i18n;
