// "Download gate poster (A4 PDF)" on the plant page (F-34, spec M2 §4.12): the page to put up
// next to the kiosk, with three steps and the photo notice. The Super Admin and the Plant Head of
// the plant may print it; it holds no personal data and no card, so it is not a credential.
// The poster can be printed in English, Marathi or Hindi (M6 F-99): the picker sits next to the button.
import { Loader2, Printer } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { describeError } from "@/features/auth/error-message";
import { openPdfInNewTab } from "@/features/qr-cards/use-qr-cards";
import { apiBlob } from "@/lib/api-client";

const POSTER_LANGUAGES = ["en", "mr", "hi"] as const;
type PosterLanguage = (typeof POSTER_LANGUAGES)[number];

export function GatePosterButton({ plantId, plantCode }: { plantId: string; plantCode: string }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [language, setLanguage] = useState<PosterLanguage>("en");

  // English is the default of the server, so its address stays as it always was.
  const languageQuery = language === "en" ? "" : `?language=${language}`;

  const open = async () => {
    setPending(true);
    setError(null);
    try {
      await openPdfInNewTab(
        () => apiBlob(`/plants/${plantId}/gate-poster.pdf${languageQuery}`, { method: "GET" }),
        `gate-poster-${plantCode}${language === "en" ? "" : `-${language}`}.pdf`,
      );
    } catch (failure) {
      setError(failure);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Select
        aria-label={t("plants.poster.language")}
        className="w-auto"
        value={language}
        onChange={(event) => setLanguage(event.target.value as PosterLanguage)}
        disabled={pending}
      >
        {POSTER_LANGUAGES.map((code) => (
          <option key={code} value={code}>
            {t(`plants.poster.languages.${code}`)}
          </option>
        ))}
      </Select>
      <Button variant="outline" onClick={open} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Printer aria-hidden />}
        {t("plants.poster.button")}
      </Button>
      {error ? (
        <Alert tone="danger" className="basis-full">
          <span>{describeError(error, t)}</span>
        </Alert>
      ) : null}
    </>
  );
}
