// "Download gate poster (A4 PDF)" on the plant page (F-34, spec M2 §4.12): the page to put up
// next to the kiosk, with three steps and the photo notice. The Super Admin and the Plant Head of
// the plant may print it; it holds no personal data and no card, so it is not a credential.
import { Loader2, Printer } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { describeError } from "@/features/auth/error-message";
import { openPdfInNewTab } from "@/features/qr-cards/use-qr-cards";
import { apiBlob } from "@/lib/api-client";

export function GatePosterButton({ plantId, plantCode }: { plantId: string; plantCode: string }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const open = async () => {
    setPending(true);
    setError(null);
    try {
      await openPdfInNewTab(
        () => apiBlob(`/plants/${plantId}/gate-poster.pdf`, { method: "GET" }),
        `gate-poster-${plantCode}.pdf`,
      );
    } catch (failure) {
      setError(failure);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
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
