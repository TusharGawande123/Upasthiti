// The public privacy notice (SPDI Rule 4, spec M3 §8.1, design gate C): what Upasthiti collects at
// the gate, why, for how long, where, who can see it, and the employee's rights. No login, no admin
// menu; it reads only the company address, the privacy contact and the retention days from
// GET /privacy-notice. The facts are the same as in the consent text (face-consent-v1).
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Clock,
  Eye,
  Globe2,
  HandHeart,
  Loader2,
  MessageCircle,
  Printer,
  Scale,
  ScanFace,
  Target,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/api-client";

type PrivacyNotice = {
  company_address: string;
  privacy_contact: string;
  retention_days: number;
  consent_version: string;
};

function usePrivacyNotice() {
  return useQuery({
    queryKey: ["privacy-notice"],
    queryFn: () => apiGet<PrivacyNotice>("/privacy-notice"),
  });
}

const SECTIONS = ["collect", "why", "keep", "where", "see", "choice", "rights", "contact"] as const;

function Section({
  id,
  icon: Icon,
  title,
  children,
}: {
  id: string;
  icon: typeof Eye;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6 border-t pt-6">
      <div className="mb-3 flex items-center gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary-soft text-primary">
          <Icon className="size-6" aria-hidden />
        </span>
        <h2 className="text-[21px] leading-tight font-bold">{title}</h2>
      </div>
      <div className="space-y-3 text-[17px] leading-[1.6]">{children}</div>
    </section>
  );
}

function ShortTile({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-[17px] font-bold">{title}</p>
      <p className="mt-1 text-[15px] leading-snug text-muted-foreground">{text}</p>
    </div>
  );
}

function KeepRow({ what, when }: { what: string; when: string }) {
  return (
    <div className="grid gap-1 border-b py-3 last:border-0 sm:grid-cols-[1fr_1fr] sm:gap-4">
      <dt className="text-[15px] text-muted-foreground">{what}</dt>
      <dd className="text-[17px] font-bold">{when}</dd>
    </div>
  );
}

export function PrivacyPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const notice = usePrivacyNotice();
  const data = notice.data;
  const days = data?.retention_days ?? 60;

  return (
    <div className="min-h-screen bg-background text-foreground print:bg-white">
      <div
        aria-hidden
        className="h-3 bg-[repeating-linear-gradient(135deg,var(--signal)_0_18px,#0f172a_18px_36px)]"
      />
      <header className="border-b bg-card print:hidden">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <p className="text-sm font-bold">{t("privacy.topbar")}</p>
          <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft aria-hidden />
            {t("privacy.back")}
          </Button>
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-8 lg:grid-cols-[200px_1fr]">
        <nav aria-label={t("privacy.onThisPage")} className="hidden lg:block print:hidden">
          <div className="sticky top-6 space-y-2 text-sm">
            <p className="font-bold">{t("privacy.onThisPage")}</p>
            {SECTIONS.map((section) => (
              <a
                key={section}
                href={`#${section}`}
                className="block text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                {t(`privacy.${section}.title`)}
              </a>
            ))}
          </div>
        </nav>

        <main className="min-w-0 space-y-6">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-sm font-semibold text-primary">
              <ScanFace className="size-4" aria-hidden />
              {t("privacy.eyebrow")}
            </p>
            <h1 className="mt-3 text-[30px] leading-tight font-extrabold tracking-tight">
              {t("privacy.title")}
            </h1>
            <p className="mt-2 text-[17px] leading-[1.6] text-muted-foreground">
              {t("privacy.lead")}
            </p>
            {data ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {t("privacy.version", { version: data.consent_version })}
                {data.company_address
                  ? ` · ${t("privacy.company", { address: data.company_address })}`
                  : ""}
              </p>
            ) : null}
          </div>

          {notice.isPending ? (
            <p role="status" className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t("privacy.loading")}
            </p>
          ) : null}
          {notice.isError ? (
            <Alert tone="danger">
              <span>{t("privacy.error")}</span>
            </Alert>
          ) : null}

          <section aria-labelledby="short-title" className="grid gap-3 sm:grid-cols-2">
            <h2 id="short-title" className="sr-only">
              {t("privacy.short.title")}
            </h2>
            <ShortTile
              title={t("privacy.short.purpose.title")}
              text={t("privacy.short.purpose.text")}
            />
            <ShortTile
              title={t("privacy.short.template.title")}
              text={t("privacy.short.template.text")}
            />
            <ShortTile
              title={t("privacy.short.choice.title")}
              text={t("privacy.short.choice.text")}
            />
            <ShortTile
              title={t("privacy.short.questions.title")}
              text={t("privacy.short.questions.text")}
            />
          </section>

          <Section id="collect" icon={Eye} title={t("privacy.collect.title")}>
            <p>{t("privacy.collect.faceLead")}</p>
            <ul className="list-disc space-y-2 pl-6">
              <li>{t("privacy.collect.template")}</li>
              <li>{t("privacy.collect.pictures")}</li>
              <li>{t("privacy.collect.photo")}</li>
            </ul>
            <p>{t("privacy.collect.cardLead")}</p>
            <p>{t("privacy.collect.everyone")}</p>
            <p>{t("privacy.collect.offline")}</p>
          </Section>

          <Section id="why" icon={Target} title={t("privacy.why.title")}>
            <p>{t("privacy.why.text")}</p>
            <p>{t("privacy.why.more")}</p>
          </Section>

          <Section id="keep" icon={Clock} title={t("privacy.keep.title")}>
            <dl className="rounded-xl border bg-card px-4">
              <KeepRow what={t("privacy.keep.template")} when={t("privacy.keep.templateWhen")} />
              <KeepRow what={t("privacy.keep.pictures")} when={t("privacy.keep.picturesWhen")} />
              <KeepRow
                what={t("privacy.keep.failedPhoto")}
                when={t("privacy.keep.days", { count: days })}
              />
              <KeepRow
                what={t("privacy.keep.cardPhoto")}
                when={t("privacy.keep.days", { count: days })}
              />
              <KeepRow what={t("privacy.keep.offline")} when={t("privacy.keep.offlineWhen")} />
              <KeepRow what={t("privacy.keep.punches")} when={t("privacy.keep.punchesWhen")} />
              <KeepRow what={t("privacy.keep.consent")} when={t("privacy.keep.consentWhen")} />
            </dl>
            <p>{t("privacy.keep.after")}</p>
          </Section>

          <Section id="where" icon={Globe2} title={t("privacy.where.title")}>
            <p>{t("privacy.where.text")}</p>
          </Section>

          <Section id="see" icon={Eye} title={t("privacy.see.title")}>
            <p>{t("privacy.see.text")}</p>
          </Section>

          <Section id="choice" icon={HandHeart} title={t("privacy.choice.title")}>
            <p>{t("privacy.choice.text")}</p>
            <p className="font-bold">{t("privacy.choice.withdraw")}</p>
          </Section>

          <Section id="rights" icon={Scale} title={t("privacy.rights.title")}>
            <p>{t("privacy.rights.text")}</p>
            <p>{t("privacy.rights.reply")}</p>
          </Section>

          <Section id="contact" icon={MessageCircle} title={t("privacy.contact.title")}>
            {data?.privacy_contact ? (
              <div className="rounded-xl border-2 border-foreground bg-card p-4">
                <p className="text-sm text-muted-foreground">{t("privacy.contact.grievance")}</p>
                <p className="mt-1 font-bold">{data.privacy_contact}</p>
                {data.company_address ? (
                  <p className="mt-2 text-[15px] text-muted-foreground">
                    {t("privacy.company", { address: data.company_address })}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="rounded-xl border-2 border-dashed border-warning bg-warning-soft p-4 text-warning">
                {t("privacy.contact.missing")}
              </p>
            )}
            <p>{t("privacy.contact.orOffice")}</p>
          </Section>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm text-muted-foreground print:hidden">
            <span>{t("privacy.footer")}</span>
            <span className="flex gap-4">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 font-semibold text-primary underline"
              >
                <Printer className="size-4" aria-hidden />
                {t("privacy.print")}
              </button>
              <Link to="/admin/login" className="font-semibold text-primary underline">
                {t("privacy.adminLogin")}
              </Link>
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
