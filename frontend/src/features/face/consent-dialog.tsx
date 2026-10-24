// The consent dialog before a face enrolment (spec M3 §4.8, decision 0016 item 6). The employee
// reads the server's consent text in their language and taps "I agree" (or the Super Admin taps
// it in front of them, decision 0017). The camera is NOT started while this dialog is open.
// "No, I prefer a QR card" is just as easy: it records the choice and switches the employee to QR.
import { CameraOff, Loader2, Settings } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { describeError } from "@/features/auth/error-message";
import { ApiError } from "@/lib/api-client";
import {
  CONSENT_LANGUAGES,
  CONSENT_VERSION,
  type ConsentLanguage,
  type ExplainedLanguage,
  useConsentText,
  useRecordConsent,
} from "./use-face";

// The text has short paragraphs; **words** are bold. Built as React nodes, never as HTML.
function ConsentTextView({ text }: { text: string }) {
  const paragraphs = text.split(/\n\s*\n/).filter((paragraph) => paragraph.trim() !== "");
  return (
    <div className="space-y-3 text-[18px] leading-relaxed">
      {paragraphs.map((paragraph, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the text never changes order
        <p key={index}>
          {paragraph.split(/(\*\*[^*]+\*\*)/).map((piece, pieceIndex) =>
            piece.startsWith("**") && piece.endsWith("**") ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: pieces of one fixed paragraph
              <b key={pieceIndex}>{piece.slice(2, -2)}</b>
            ) : (
              piece
            ),
          )}
        </p>
      ))}
    </div>
  );
}

// The privacy contact and the company address are named in the text, so they must be set first.
const SETTINGS_MISSING = new Set(["PRIVACY_CONTACT_MISSING", "COMPANY_ADDRESS_MISSING"]);

type Props = {
  employee: { id: string; name: string };
  onAgreed: () => void;
  onClose: () => void;
};

export function ConsentDialog({ employee, onAgreed, onClose }: Props) {
  const { t } = useTranslation();
  const [language, setLanguage] = useState<ConsentLanguage>("en");
  const [explained, setExplained] = useState(false);
  const [explainedLanguage, setExplainedLanguage] = useState<ExplainedLanguage>("mr");
  const [declined, setDeclined] = useState(false);
  const text = useConsentText(language);
  const record = useRecordConsent(employee.id);
  const settingsMissing = text.error instanceof ApiError && SETTINGS_MISSING.has(text.error.code);

  const answer = (choice: "agreed" | "declined") =>
    record.mutate(
      { language, choice, explained_language: explained ? explainedLanguage : undefined },
      {
        onSuccess: () => {
          if (choice === "agreed") onAgreed();
          else setDeclined(true);
        },
      },
    );

  if (declined) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent>
          <DialogTitle>{t("face.consent.declinedTitle")}</DialogTitle>
          <DialogDescription>
            {t("face.consent.declinedText", { name: employee.name })}
          </DialogDescription>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              {t("common.close")}
            </Button>
            <Link
              to="?issue=card"
              onClick={onClose}
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground"
            >
              {t("face.panel.issueCard")}
            </Link>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[92dvh] max-w-2xl flex-col">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <DialogTitle>{t("face.consent.title")}</DialogTitle>
            <DialogDescription>
              {t("face.consent.for", { name: employee.name, version: CONSENT_VERSION })}
            </DialogDescription>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
            <CameraOff className="size-3.5" aria-hidden />
            {t("face.consent.cameraOff")}
          </span>
        </div>

        {/* The employee picks the language they read best. */}
        <div role="radiogroup" aria-label={t("face.consent.language")} className="mt-3 flex gap-2">
          {CONSENT_LANGUAGES.map((option) => (
            <Button
              key={option}
              role="radio"
              aria-checked={language === option}
              variant={language === option ? "primary" : "outline"}
              size="sm"
              lang={option}
              onClick={() => setLanguage(option)}
            >
              {t(`face.consent.languages.${option}`)}
            </Button>
          ))}
        </div>

        <div
          className="mt-3 min-h-40 flex-1 overflow-y-auto rounded-lg border bg-muted/40 p-4"
          lang={language}
        >
          {text.isPending ? (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t("face.consent.loading")}
            </p>
          ) : text.isError ? (
            <Alert tone={settingsMissing ? "warning" : "danger"} className="items-center">
              <span>{describeError(text.error, t)}</span>
              {settingsMissing ? (
                <Link
                  to="/admin/settings"
                  className="ml-auto inline-flex items-center gap-1.5 font-semibold underline"
                >
                  <Settings className="size-4" aria-hidden />
                  {t("face.consent.openSettings")}
                </Link>
              ) : null}
            </Alert>
          ) : (
            <ConsentTextView text={text.data.text} />
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={explained}
              onChange={(event) => setExplained(event.target.checked)}
              className="size-4"
            />
            {t("face.consent.explained")}
          </label>
          {explained ? (
            <Select
              aria-label={t("face.consent.explainedLanguage")}
              value={explainedLanguage}
              onChange={(event) => setExplainedLanguage(event.target.value as ExplainedLanguage)}
              className="h-9 w-auto"
            >
              <option value="mr">{t("face.consent.languages.mr")}</option>
              <option value="hi">{t("face.consent.languages.hi")}</option>
              <option value="other">{t("face.consent.languages.other")}</option>
            </Select>
          ) : null}
        </div>

        {record.isError ? (
          <Alert tone="danger" className="mt-3">
            <span>{describeError(record.error, t)}</span>
          </Alert>
        ) : null}

        {/* Two buttons of the same size: saying no must be as easy as saying yes. */}
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Button
            size="lg"
            variant="outline"
            disabled={!text.isSuccess || record.isPending}
            onClick={() => answer("declined")}
          >
            {t("face.consent.decline")}
          </Button>
          <Button
            size="lg"
            disabled={!text.isSuccess || record.isPending}
            onClick={() => answer("agreed")}
          >
            {record.isPending ? <Loader2 className="animate-spin" /> : null}
            {t("face.consent.agree")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
