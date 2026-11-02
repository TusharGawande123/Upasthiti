// The frame of every /phone page: a small top bar (logo, "Phone attendance", name and code once
// signed in, a Menu button) and one centred column. No admin menu and no sidebar (spec M4b §4.1).
// Also adds the web app manifest, so the phone can "Add to home screen" (F-74); only this area
// links it, the gate and the admin do not.

import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Menu, PowerOff, ShieldCheck, Smartphone, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { BrandMark } from "@/features/auth/brand-mark";
import { describeError } from "@/features/auth/error-message";
import { phoneApi } from "./phone-api";
import { Notice, PhoneButton } from "./phone-ui";
import {
  endedReason,
  PHONE_ME_KEY,
  useKnownPhoneMe,
  usePhoneMe,
  useSignOut,
  useStopPhonePunching,
} from "./phone-use-phone";

function useManifestLink() {
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = "/phone.webmanifest";
    document.head.append(link);
    return () => link.remove();
  }, []);
}

function PhoneMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const me = useKnownPhoneMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const signOut = useSignOut();
  const stop = useStopPhonePunching();
  const [confirmStop, setConfirmStop] = useState(false);

  if (!me) return null;
  const goToSignIn = () => navigate("/phone/login", { replace: true });

  const removePasskey = async (id: string) => {
    try {
      await phoneApi.passkeyRemove(id);
      toast.success(t("phone.passkey.removed"));
      await queryClient.invalidateQueries({ queryKey: PHONE_ME_KEY });
    } catch (error) {
      toast.error(describeError(error, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-auto bottom-0 max-w-140 translate-y-0 rounded-b-none text-lg sm:top-20 sm:right-4 sm:bottom-auto sm:left-auto sm:translate-x-0 sm:rounded-xl">
        <DialogTitle>{t("phone.menu.title")}</DialogTitle>
        <DialogDescription className="text-base">
          {me.employee.name} · <span className="font-mono">{me.employee.code}</span>
        </DialogDescription>
        {confirmStop ? (
          <div className="mt-4 space-y-3">
            <Notice tone="warning">{t("phone.menu.stopConfirm")}</Notice>
            <PhoneButton
              variant="danger"
              busy={stop.isPending}
              onClick={() => stop.mutate(undefined, { onSuccess: goToSignIn })}
            >
              <PowerOff aria-hidden />
              {t("phone.menu.stop")}
            </PhoneButton>
            <PhoneButton variant="outline" onClick={() => setConfirmStop(false)}>
              {t("phone.cancel")}
            </PhoneButton>
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            <li>
              <Link
                to="/phone/notice"
                onClick={() => onOpenChange(false)}
                className="flex h-15 items-center gap-3 rounded-lg border px-4 font-semibold"
              >
                <ShieldCheck className="size-6" aria-hidden />
                {t("phone.menu.notice")}
              </Link>
            </li>
            <li className="rounded-lg border p-4">
              <p className="mb-2 flex items-center gap-3 font-semibold">
                <Smartphone className="size-6" aria-hidden />
                {t("phone.menu.passkeys")}
              </p>
              {me.passkeys.length === 0 ? (
                <p className="text-base text-muted-foreground">{t("phone.menu.noPasskeys")}</p>
              ) : (
                <ul className="space-y-2">
                  {me.passkeys.map((passkey) => (
                    <li key={passkey.id} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 text-base">{passkey.label}</span>
                      <Button
                        variant="danger"
                        className="h-12 px-3 text-base"
                        onClick={() => removePasskey(passkey.id)}
                      >
                        <Trash2 aria-hidden />
                        {t("phone.passkey.remove")}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
            <li>
              <Button
                variant="danger"
                className="h-15 w-full text-lg"
                onClick={() => setConfirmStop(true)}
              >
                <PowerOff aria-hidden />
                {t("phone.menu.stop")}
              </Button>
            </li>
            <li>
              <Button
                variant="outline"
                className="h-15 w-full text-lg"
                disabled={signOut.isPending}
                onClick={() => signOut.mutate(undefined, { onSuccess: goToSignIn })}
              >
                <LogOut aria-hidden />
                {t("phone.menu.signOut")}
              </Button>
            </li>
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function PhoneLayout() {
  const { t } = useTranslation();
  const me = useKnownPhoneMe();
  const [menuOpen, setMenuOpen] = useState(false);
  useManifestLink();

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary-soft/60 to-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-160 items-center gap-3 px-4 py-3">
          <BrandMark />
          <div className="min-w-0 flex-1 text-right leading-tight">
            <p className="truncate text-sm font-semibold text-muted-foreground">
              {t("phone.title")}
            </p>
            {me ? (
              <p className="truncate text-base font-bold">
                {me.employee.name} · <span className="font-mono">{me.employee.code}</span>
              </p>
            ) : null}
          </div>
          {me ? (
            <Button
              variant="outline"
              className="h-13 px-4 text-base"
              onClick={() => setMenuOpen(true)}
            >
              <Menu aria-hidden />
              {t("phone.menu.button")}
            </Button>
          ) : null}
        </div>
        <div
          aria-hidden
          className="h-1.5 bg-[repeating-linear-gradient(135deg,#f5b700_0_14px,#0e1726_14px_28px)]"
        />
      </header>
      <main className="mx-auto max-w-140 space-y-4 px-4 py-6">
        <Outlet />
      </main>
      <PhoneMenu open={menuOpen} onOpenChange={setMenuOpen} />
    </div>
  );
}

/**
 * Wraps the pages that need a phone sign-in. Asks the server who is signed in; a 401 sends the
 * person to the sign-in page with the reason (`details.ended` of PHONE_NOT_SIGNED_IN, spec §7
 * rule 4). A phone-punching-off answer ends the session too, so it goes there as well.
 */
export function RequirePhoneSession() {
  const { t } = useTranslation();
  const location = useLocation();
  const me = usePhoneMe();

  if (me.isPending) {
    return (
      <div className="space-y-3" aria-busy>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (me.isError) {
    const reason = endedReason(me.error);
    const code = (me.error as { code?: string }).code;
    if (reason !== null || code === "PHONE_PUNCH_OFF") {
      return (
        <Navigate
          to="/phone/login"
          replace
          state={{ notice: code === "PHONE_PUNCH_OFF" ? "PHONE_PUNCH_OFF" : noticeFor(reason) }}
        />
      );
    }
    return (
      <Notice tone="danger">
        {t("phone.home.loadError")}
        <Button variant="outline" className="mt-3 h-12 w-full" onClick={() => me.refetch()}>
          {t("phone.tryAgain")}
        </Button>
      </Notice>
    );
  }
  // A notice that was not accepted yet blocks everything except the notice itself.
  if (me.data.notice.required && location.pathname !== "/phone/notice") {
    return <Navigate to="/phone/notice" replace />;
  }
  return <Outlet />;
}

function noticeFor(reason: ReturnType<typeof endedReason>): string {
  if (reason === "new_login") return "PHONE_SIGNED_OUT_ELSEWHERE";
  return "PHONE_NOT_SIGNED_IN";
}
