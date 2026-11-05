// The language choice of the /phone pages (F-99): English, Marathi or Hindi, remembered on the
// phone. The admin and the gate pages always stay English, so the choice only applies while a
// /phone page is open (PhoneLayout switches back to English when it closes).
import i18n from "i18next";
import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";

export type PhoneLanguage = "en" | "mr" | "hi";

// The names are written in their own language on purpose: a worker must find his own language
// even when the page is in another one.
export const PHONE_LANGUAGES: { code: PhoneLanguage; label: string }[] = [
  { code: "en", label: "EN" },
  { code: "mr", label: "मराठी" },
  { code: "hi", label: "हिंदी" },
];

const STORAGE_KEY = "upasthiti.phone.language";

function isPhoneLanguage(value: unknown): value is PhoneLanguage {
  return PHONE_LANGUAGES.some((language) => language.code === value);
}

/** The remembered choice, or English. Browser storage can be blocked, so it never throws. */
export function readStoredPhoneLanguage(): PhoneLanguage {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isPhoneLanguage(stored) ? stored : "en";
  } catch {
    return "en";
  }
}

function storePhoneLanguage(language: PhoneLanguage) {
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Not remembered; the choice still works until the page is closed.
  }
}

/** Used when the app starts: a /phone address opens in the remembered language, all others in English. */
export function startingLanguage(pathname: string): PhoneLanguage {
  return pathname === "/phone" || pathname.startsWith("/phone/") ? readStoredPhoneLanguage() : "en";
}

/** The language shown now (English for any code that is not one of the three). */
export function usePhoneLanguage() {
  const { i18n: instance } = useTranslation();
  const current = instance.language;
  const language: PhoneLanguage = isPhoneLanguage(current) ? current : "en";

  const setLanguage = useCallback((next: PhoneLanguage) => {
    storePhoneLanguage(next);
    void i18n.changeLanguage(next);
  }, []);

  return { language, setLanguage };
}

/** Put on the PhoneLayout: opens the page in the remembered language and gives English back
 * when the person leaves the /phone pages. */
export function useApplyPhoneLanguage() {
  useEffect(() => {
    void i18n.changeLanguage(readStoredPhoneLanguage());
    return () => {
      void i18n.changeLanguage("en");
    };
  }, []);

  const { language } = usePhoneLanguage();
  useEffect(() => {
    document.documentElement.lang = language;
    return () => {
      document.documentElement.lang = "en";
    };
  }, [language]);
}
