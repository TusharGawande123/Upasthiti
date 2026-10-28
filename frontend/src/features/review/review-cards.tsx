// The Super Admin's dashboard cards for "Needs review" (spec M4 §4.10): how many flagged punches
// are waiting, and the daily review digest per plant (F-48) with a date arrow for the last 7 days.
import { ChevronLeft, ChevronRight, Flag, ListChecks } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { addDays } from "@/lib/dates";
import { formatDate, formatNumber, todayIst } from "@/lib/format";
import { queryString } from "@/lib/paging";
import { formatMinutes } from "../punches/punch-cells";
import { useReviewDigest, useReviewSummary } from "./use-review";

const DIGEST_DAYS_BACK = 7;

export function ToCheckCard() {
  const { t } = useTranslation();
  const summary = useReviewSummary(true);
  const count = summary.data?.to_check ?? 0;
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-warning-soft text-warning">
          <Flag className="size-5" aria-hidden />
        </span>
        <div>
          <CardTitle>{t("review.cards.toCheckTitle", { count })}</CardTitle>
          <CardDescription>
            {summary.isError ? t("review.cards.error") : t("review.cards.toCheckText")}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex items-center justify-between">
        <span className="tnum text-4xl font-bold">{summary.data ? formatNumber(count) : "–"}</span>
        <Link to="/admin/review" className="text-sm font-semibold text-primary underline">
          {t("review.cards.open")}
        </Link>
      </CardContent>
    </Card>
  );
}

export function DigestCard() {
  const { t } = useTranslation();
  const today = todayIst();
  const yesterday = addDays(today, -1);
  const [date, setDate] = useState(yesterday);
  const digest = useReviewDigest(date, true);
  const oldest = addDays(today, -DIGEST_DAYS_BACK);
  const plants = digest.data?.plants ?? [];
  const dayLabel = date === yesterday ? t("review.digest.yesterday") : t("review.digest.day");

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-primary-soft text-primary-soft-foreground">
          <ListChecks className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <CardTitle>{t("review.digest.title")}</CardTitle>
          <CardDescription>
            {dayLabel} ({formatDate(date)})
          </CardDescription>
        </div>
        <span className="flex gap-1">
          <Button
            size="icon"
            variant="outline"
            aria-label={t("review.digest.earlier")}
            disabled={date <= oldest}
            onClick={() => setDate(addDays(date, -1))}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <Button
            size="icon"
            variant="outline"
            aria-label={t("review.digest.later")}
            disabled={date >= today}
            onClick={() => setDate(addDays(date, 1))}
          >
            <ChevronRight aria-hidden />
          </Button>
        </span>
      </CardHeader>
      <CardContent>
        {digest.isError ? (
          <p className="text-sm text-destructive">{t("review.cards.error")}</p>
        ) : null}
        {plants.length === 0 && digest.data ? (
          <p className="text-sm text-muted-foreground">{t("review.digest.none")}</p>
        ) : null}
        <ul className="divide-y">
          {plants.map((row) => {
            const link = `/admin/review${queryString({
              plant_id: row.plant.id,
              date_from: date,
              date_to: date,
            })}`;
            return (
              <li
                key={row.plant.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm"
              >
                <Link to={link} className="min-w-24 font-semibold text-primary underline">
                  {row.plant.code}
                </Link>
                <span>{t("review.digest.flagged", { count: row.flagged })}</span>
                <span>{t("review.digest.rejected", { count: row.rejected_with_employee })}</span>
                <span className={row.to_check > 0 ? "font-semibold text-warning" : ""}>
                  {t("review.digest.toCheck", { count: row.to_check })}
                </span>
                <span className="text-muted-foreground">
                  {t("review.digest.offline", {
                    time: formatMinutes(row.device_offline_minutes_in_shifts, t),
                  })}
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
