// Turns any error from the server into a short English sentence from the translation file.
// The error code from the API doubles as the translation key: errors.<CODE>.
import type { TFunction } from "i18next";
import { ApiError } from "@/lib/api-client";

export function describeError(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    const key = `errors.${error.code}`;
    // `defaultValue` keeps an unknown code readable instead of showing the raw key.
    return t(key, {
      defaultValue: t("errors.UNKNOWN"),
      ...error.details,
    });
  }
  return t("errors.UNKNOWN");
}
