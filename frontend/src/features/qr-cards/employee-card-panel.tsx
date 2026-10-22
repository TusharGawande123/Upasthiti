// The QR card panel on an employee's page (spec §4.7). Shows the working card with its actions
// and the card history. The Super Admin issues, prints, changes the end date and revokes; all
// other roles only read. Nothing here decides rights: the server refuses what is not allowed.
import {
  CalendarClock,
  CircleCheck,
  History,
  Loader2,
  Printer,
  QrCode,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardContent, CardHeader, CardTitle, Card as Panel } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/features/auth/error-message";
import { formatDate, formatTime } from "@/lib/format";
import { CardStateBadge, useValidityHint } from "./card-badges";
import { ChangeValidUntilDialog, IssueCardDialog, RevokeCardDialog } from "./card-dialogs";
import { type Card, fetchCardPdf, useEmployeeCards, usePdfPrinting } from "./use-qr-cards";

type PanelEmployee = {
  id: string;
  full_name: string;
  plant_code: string;
  punch_method: "face" | "qr";
  status: "active" | "left";
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[150px_1fr] gap-3 border-b border-dashed py-2 text-sm last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function WorkingCardDetails({ card, plantCode }: { card: Card; plantCode: string }) {
  const { t } = useTranslation();
  const hint = useValidityHint(card);
  return (
    <dl>
      <Row label={t("qrCards.panel.serial")}>
        <span className="code text-lg font-bold">{card.serial}</span>
      </Row>
      <Row label={t("qrCards.panel.validFrom")}>{formatDate(card.valid_from)}</Row>
      <Row label={t("qrCards.panel.validUntil")}>
        {formatDate(card.valid_until)}
        {hint ? <span className="font-normal text-muted-foreground"> · {hint}</span> : null}
      </Row>
      <Row label={t("qrCards.panel.issued")}>
        {t("qrCards.panel.issuedLine", {
          date: formatDate(card.issued_at),
          time: formatTime(card.issued_at),
          name: card.issued_by,
        })}
      </Row>
      <Row label={t("qrCards.panel.printed")}>
        {card.print_count === 0
          ? t("qrCards.panel.printedNever")
          : t("qrCards.panel.printedLine", {
              count: card.print_count,
              date: card.last_printed_at ? formatDate(card.last_printed_at) : "–",
              time: card.last_printed_at ? formatTime(card.last_printed_at) : "",
            })}
      </Row>
      <Row label={t("qrCards.panel.printedPlant")}>
        {card.printed_plant
          ? card.reprint_needed
            ? t("qrCards.panel.plantDiffers", {
                plant: card.printed_plant.code,
                current: plantCode,
              })
            : t("qrCards.panel.plantMatches", { plant: card.printed_plant.code })
          : t("qrCards.panel.printedNever")}
      </Row>
    </dl>
  );
}

function HistoryList({ cards }: { cards: Card[] }) {
  const { t } = useTranslation();
  return (
    <details className="group rounded-lg border bg-card">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-semibold">
        <History className="size-4" aria-hidden />
        {t("qrCards.panel.history")}
        <Badge tone="neutral">{t("qrCards.panel.historyCount", { count: cards.length })}</Badge>
      </summary>
      <ul className="divide-y border-t">
        {cards.map((card) => (
          <li key={card.id} className="flex flex-wrap items-start gap-3 px-4 py-3 text-sm">
            <span className="code font-bold">{card.serial}</span>
            <CardStateBadge state={card.state} />
            <span className="tnum text-muted-foreground">
              {formatDate(card.valid_from)} – {formatDate(card.valid_until)}
            </span>
            {card.revoked_at && card.revoke_kind ? (
              <span className="basis-full text-[13px] text-muted-foreground">
                {t("qrCards.panel.revokedLine", {
                  date: formatDate(card.revoked_at),
                  name: card.revoked_by ?? "–",
                  kind: t(`qrCards.revokeKind.${card.revoke_kind}`),
                })}
                {card.revoke_reason ? ` · ${card.revoke_reason}` : ""}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function EmployeeCardPanel({
  employee,
  canManage,
}: {
  employee: PanelEmployee;
  // True only for the Super Admin: the buttons that change or print cards are hidden otherwise.
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const cards = useEmployeeCards(employee.id);
  const printing = usePdfPrinting();
  const [dialog, setDialog] = useState<"issue" | "revoke" | "end" | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const wantsIssue = searchParams.get("issue") === "card";
  const mayIssue = canManage && employee.status === "active" && employee.punch_method !== "face";

  // The Ctrl+K command "Issue QR card…" sends the Super Admin here with ?issue=card: open the
  // issue dialog once the cards are loaded, and remove the word from the address.
  useEffect(() => {
    if (!wantsIssue || !cards.isSuccess) return;
    if (mayIssue) setDialog("issue");
    setSearchParams(
      (current) => {
        current.delete("issue");
        return current;
      },
      { replace: true },
    );
  }, [wantsIssue, cards.isSuccess, mayIssue, setSearchParams]);

  if (cards.isError) return <Alert tone="danger">{describeError(cards.error, t)}</Alert>;
  if (cards.isPending) return <Skeleton className="h-48 w-full" />;

  // The card that is not revoked (it may still be expired or not yet valid), and the older ones.
  const working = cards.data.find((card) => card.state !== "revoked") ?? null;
  const earlier = cards.data.filter((card) => card !== working);
  const active = employee.status === "active";
  const punchesByFace = employee.punch_method === "face";
  const canIssue = canManage && active && !punchesByFace;

  return (
    <Panel>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <QrCode className="size-5" aria-hidden />
          {t("qrCards.panel.title")}
        </CardTitle>
        {working ? <CardStateBadge state={working.state} /> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {working && punchesByFace && active ? (
          // The Super Admin switched the employee to face but did not revoke the card: the kiosk
          // refuses it (EMPLOYEE_NOT_QR), so tell them to revoke it.
          <Alert tone="warning" className="items-center">
            <TriangleAlert aria-hidden />
            <span>
              <b>{t("qrCards.panel.faceSwitched.title")}</b>{" "}
              {t("qrCards.panel.faceSwitched.text", { name: employee.full_name })}
            </span>
            {canManage ? (
              <Button
                size="sm"
                variant="danger"
                className="ml-auto"
                onClick={() => setDialog("revoke")}
              >
                {t("qrCards.panel.revokeCard")}
              </Button>
            ) : null}
          </Alert>
        ) : null}

        {working?.reprint_needed ? (
          <Alert tone="warning">
            <Printer aria-hidden />
            <span>
              <b>{t("qrCards.panel.reprint.title")}</b>{" "}
              {t("qrCards.panel.reprint.text", {
                printed: working.printed_plant?.code ?? "?",
                current: employee.plant_code,
              })}
            </span>
          </Alert>
        ) : null}

        {working ? (
          <>
            <WorkingCardDetails card={working} plantCode={employee.plant_code} />
            {printing.error ? (
              <Alert tone="danger">
                <span>{describeError(printing.error, t)}</span>
              </Alert>
            ) : null}
            {canManage && active ? (
              <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                <Button
                  variant="outline"
                  disabled={printing.pending}
                  onClick={() =>
                    printing.print(() => fetchCardPdf(working.id), `card-${working.serial}.pdf`)
                  }
                >
                  {printing.pending ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Printer aria-hidden />
                  )}
                  {t("qrCards.panel.print")}
                </Button>
                <Button variant="outline" onClick={() => setDialog("end")}>
                  <CalendarClock aria-hidden />
                  {t("qrCards.panel.changeEnd")}
                </Button>
                {canIssue ? (
                  <Button variant="outline" onClick={() => setDialog("issue")}>
                    {t("qrCards.panel.issueNew")}
                  </Button>
                ) : null}
                <Button variant="danger" className="ml-auto" onClick={() => setDialog("revoke")}>
                  {t("qrCards.panel.revoke")}
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm">
              <CircleCheck className="size-4 text-muted-foreground" aria-hidden />
              <b>{t("qrCards.panel.none")}</b>
            </p>
            <p className="text-sm text-muted-foreground">
              {!active
                ? t("qrCards.panel.leftNote")
                : punchesByFace
                  ? t("qrCards.panel.faceNote")
                  : t("qrCards.panel.noneHelp")}
            </p>
            {canIssue ? (
              <Button onClick={() => setDialog("issue")}>{t("qrCards.panel.issue")}</Button>
            ) : null}
          </div>
        )}

        {earlier.length > 0 ? <HistoryList cards={earlier} /> : null}
      </CardContent>

      {dialog === "issue" ? (
        <IssueCardDialog
          employee={{ id: employee.id, name: employee.full_name }}
          replacing={working}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "revoke" && working ? (
        <RevokeCardDialog card={working} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "end" && working ? (
        <ChangeValidUntilDialog card={working} onClose={() => setDialog(null)} />
      ) : null}
    </Panel>
  );
}
