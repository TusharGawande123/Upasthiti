// Product name with the small safety-yellow dot (the only place yellow is used besides the
// active menu bar).
import { useTranslation } from "react-i18next";

export function BrandMark() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
        <span className="size-2.5 rounded-full bg-signal" />
      </span>
      <span className="text-lg font-bold tracking-tight">{t("app.shortName")}</span>
    </div>
  );
}
