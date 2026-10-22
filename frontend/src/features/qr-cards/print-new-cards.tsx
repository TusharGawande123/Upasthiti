// "Print the N new cards": one button, or one button per 200 cards when there are more (a PDF
// holds at most 200 cards). Used after a bulk issue and after an Excel import.
import { Loader2, Printer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { describeError } from "@/features/auth/error-message";
import { todayIst } from "@/lib/format";
import { inParts } from "./bulk-plan";
import { fetchCardsPdf, MAX_PRINT, usePdfPrinting } from "./use-qr-cards";

export function PrintNewCards({ cardIds }: { cardIds: string[] }) {
  const { t } = useTranslation();
  const printing = usePdfPrinting();
  const parts = inParts(cardIds, MAX_PRINT);
  if (parts.length === 0) return null;

  return (
    <div className="space-y-2">
      {printing.error ? (
        <Alert tone="danger">
          <span>{describeError(printing.error, t)}</span>
        </Alert>
      ) : null}
      {parts.length > 1 ? (
        <p className="text-sm text-muted-foreground">
          {t("qrCards.bulk.printInParts", { max: MAX_PRINT })}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {parts.map((part, index) => {
          const first = index * MAX_PRINT + 1;
          const last = first + part.length - 1;
          return (
            <Button
              key={first}
              disabled={printing.pending}
              onClick={() =>
                printing.print(
                  () => fetchCardsPdf(part, "a4_sheet"),
                  `cards-${todayIst()}-${part.length}.pdf`,
                )
              }
            >
              {printing.pending ? <Loader2 className="animate-spin" /> : <Printer aria-hidden />}
              {parts.length === 1
                ? t("qrCards.bulk.printNew", { count: part.length })
                : t("qrCards.bulk.printPart", { from: first, to: last })}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
