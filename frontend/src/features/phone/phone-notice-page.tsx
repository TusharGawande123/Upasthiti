// The phone punching notice (spec M4b §4.7, rule 20, design gate P1 screen 4). Shown after the
// first sign-in and whenever the version changes; punching stays blocked until "I agree". The
// words come from the server file, not from the translation file (the hash of the text is
// sent back, so the server knows exactly which words were accepted). "Not now" signs out.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/features/auth/error-message";
import { ApiError } from "@/lib/api-client";
import { phoneApi } from "./phone-api";
import { Notice, PhoneButton, PhoneCard, PhoneTitle } from "./phone-ui";
import { PHONE_ME_KEY, useKnownPhoneMe, useSignOut } from "./phone-use-phone";

const NOTICE_KEY = ["phone", "notice"] as const;

export function PhoneNoticePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useKnownPhoneMe();
  const signOut = useSignOut();
  const notice = useQuery({
    queryKey: NOTICE_KEY,
    queryFn: phoneApi.notice,
    retry: false,
    staleTime: 0,
  });
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);
  const mustAccept = me?.notice.required ?? true;

  const agree = async () => {
    if (!notice.data) return;
    setSaving(true);
    setProblem(null);
    try {
      await phoneApi.acceptNotice({
        version: notice.data.version,
        text_sha256: notice.data.text_sha256,
      });
      await queryClient.invalidateQueries({ queryKey: PHONE_ME_KEY });
      navigate("/phone", { replace: true });
    } catch (error) {
      setProblem(error);
      // The text changed while it was open: load the new one so it can be read again.
      if (error instanceof ApiError && error.code === "NOTICE_TEXT_CHANGED") await notice.refetch();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pb-28">
      <PhoneTitle
        hint={notice.data ? t("phone.notice.version", { version: notice.data.version }) : undefined}
      >
        {t("phone.notice.title")}
      </PhoneTitle>
      {notice.isPending ? (
        <div className="space-y-3" aria-busy>
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-5/6" />
          <Skeleton className="h-6 w-4/6" />
        </div>
      ) : notice.isError ? (
        <Notice tone="danger">
          {notice.error instanceof ApiError &&
          (notice.error.code === "PRIVACY_CONTACT_MISSING" ||
            notice.error.code === "COMPANY_ADDRESS_MISSING")
            ? describeError(notice.error, t)
            : t("phone.notice.error")}
        </Notice>
      ) : (
        <PhoneCard className="max-h-[60dvh] overflow-y-auto whitespace-pre-wrap text-lg leading-relaxed">
          {notice.data.text}
        </PhoneCard>
      )}
      {problem ? (
        <Notice tone="warning" className="mt-4">
          {describeError(problem, t)}
        </Notice>
      ) : null}
      <div className="fixed inset-x-0 bottom-0 border-t bg-card p-4">
        <div className="mx-auto flex max-w-140 flex-col gap-3 sm:flex-row">
          {mustAccept ? (
            <>
              <PhoneButton busy={saving} disabled={!notice.data} onClick={agree}>
                {t("phone.notice.agree")}
              </PhoneButton>
              <PhoneButton
                variant="outline"
                disabled={saving}
                onClick={() =>
                  signOut.mutate(undefined, {
                    onSuccess: () => navigate("/phone/login", { replace: true }),
                  })
                }
              >
                {t("phone.notice.notNow")}
              </PhoneButton>
            </>
          ) : (
            <PhoneButton variant="outline" onClick={() => navigate("/phone")}>
              {t("phone.back")}
            </PhoneButton>
          )}
        </div>
      </div>
    </div>
  );
}
