// Passkeys on the phone (F-80, spec M4b §4.8c, design gate P1 screen 7, proposed route
// /phone/passkey). A passkey is only a faster second way to sign in with the phone's own screen
// lock; the password always keeps working. The fingerprint or face never leaves the phone.
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CircleCheck, Fingerprint, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { describeError } from "@/features/auth/error-message";
import { ApiError } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { createPasskey, PasskeyCancelled, passkeysSupported } from "./passkey-support";
import { phoneApi } from "./phone-api";
import { Notice, PhoneButton, PhoneCard, PhoneTitle } from "./phone-ui";
import { PHONE_ME_KEY, usePhoneMe, useSignOut } from "./use-phone";

const LIMIT = 3;

export function PhonePasskeyPage() {
  const { t } = useTranslation();
  const me = usePhoneMe().data;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const signOut = useSignOut();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: "success" | "warning" | "danger";
    text: string;
  } | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);

  useEffect(() => {
    void passkeysSupported().then(setSupported);
  }, []);

  if (!me) return null;
  const refresh = () => queryClient.invalidateQueries({ queryKey: PHONE_ME_KEY });

  const add = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const { options } = await phoneApi.passkeyRegisterOptions();
      const credential = await createPasskey(options);
      await phoneApi.passkeyRegister(credential);
      await refresh();
      setMessage({ tone: "success", text: t("phone.passkey.added") });
    } catch (error) {
      if (error instanceof PasskeyCancelled) {
        setMessage({ tone: "warning", text: t("errors.PASSKEY_CANCELLED") });
      } else {
        if (error instanceof ApiError && error.code === "PHONE_RECENT_SIGN_IN_REQUIRED") {
          setNeedsSignIn(true);
        }
        setMessage({ tone: "danger", text: describeError(error, t) });
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await phoneApi.passkeyRemove(id);
      await refresh();
      setMessage({ tone: "success", text: t("phone.passkey.removed") });
    } catch (error) {
      setMessage({ tone: "danger", text: describeError(error, t) });
    }
  };

  const full = me.passkeys.length >= LIMIT;

  return (
    <>
      <Link
        to="/phone"
        className="inline-flex items-center gap-2 text-lg font-semibold text-primary"
      >
        <ArrowLeft aria-hidden />
        {t("phone.back")}
      </Link>
      <PhoneTitle hint={t("phone.passkey.note")}>{t("phone.passkey.title")}</PhoneTitle>
      {supported === false ? (
        <Notice tone="warning">{t("phone.passkey.notSupported")}</Notice>
      ) : null}
      <PhoneCard className="space-y-4">
        <PhoneButton busy={busy} disabled={full || supported === false} onClick={add}>
          <Fingerprint aria-hidden />
          {busy ? t("phone.passkey.waiting") : t("phone.passkey.add")}
        </PhoneButton>
        {full ? <Notice tone="warning">{t("errors.PASSKEY_LIMIT_REACHED")}</Notice> : null}
        <h2 className="text-lg font-bold">
          {t("phone.passkey.count", { count: me.passkeys.length, max: LIMIT })}
        </h2>
        <ul className="space-y-2">
          {me.passkeys.map((passkey) => (
            <li
              key={passkey.id}
              className="flex items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <p className="font-semibold">{passkey.label}</p>
                <p className="text-base text-muted-foreground">
                  {t("phone.passkey.addedOn", { date: formatDate(passkey.created_at) })}
                  {passkey.last_used_at
                    ? ` · ${t("phone.passkey.lastUsed", { date: formatDate(passkey.last_used_at) })}`
                    : ""}
                </p>
              </div>
              <PhoneButton
                variant="danger"
                className="h-12 w-auto px-3 text-base"
                onClick={() => remove(passkey.id)}
              >
                <Trash2 aria-hidden />
                {t("phone.passkey.remove")}
              </PhoneButton>
            </li>
          ))}
        </ul>
      </PhoneCard>
      {message ? (
        <Notice tone={message.tone} icon={message.tone === "success" ? CircleCheck : undefined}>
          {message.text}
        </Notice>
      ) : null}
      {needsSignIn ? (
        <PhoneButton
          variant="outline"
          onClick={() =>
            signOut.mutate(undefined, {
              onSuccess: () => navigate("/phone/login", { replace: true }),
            })
          }
        >
          {t("phone.passkey.signInAgain")}
        </PhoneButton>
      ) : null}
    </>
  );
}
