// "Prove it is you" (spec M4b §4.5, design gate P1 screen 2): the first step of setting or
// resetting a password. The employee chooses a way: "Check my face" (face employees) or "Scan my
// ID card" (workers with a card). The screen never says which way a code has; the server gives
// one answer for every "not you" case (PROOF_FAILED). Success goes to the password step with a
// proof token that is kept only in memory (router state), valid 5 minutes.
import { IdCard, ScanFace, UserRoundX } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import type { ProofAnswer } from "./phone-api";
import { phoneBrowserSupported } from "./phone-browser";
import { SetupCardProof } from "./phone-setup-card-proof";
import { SetupFaceProof } from "./phone-setup-face-proof";
import { PhoneTitle, ProblemCard, StepPills } from "./phone-ui";

type Way = "choose" | "face" | "card";

export function PhoneSetupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [way, setWay] = useState<Way>("choose");

  if (!phoneBrowserSupported()) {
    return (
      <ProblemCard icon={UserRoundX} tone="grey" title={t("errors.PHONE_BROWSER_UNSUPPORTED")}>
        <Link to="/phone/login" className="block text-lg font-semibold text-primary underline">
          {t("phone.backToSignIn")}
        </Link>
      </ProblemCard>
    );
  }

  const proven = (answer: ProofAnswer) =>
    navigate("/phone/setup/password", {
      replace: true,
      state: {
        proofToken: answer.proof_token,
        firstName: answer.employee.first_name,
        employeeCode: answer.employee.code,
      },
    });
  const back = () => setWay("choose");

  return (
    <>
      <StepPills current={1} labels={[t("phone.setup.stepCheck"), t("phone.setup.stepPassword")]} />
      {way === "choose" ? (
        <>
          <PhoneTitle hint={t("phone.setup.subtitle")}>{t("phone.setup.title")}</PhoneTitle>
          <div className="space-y-3">
            <ChoiceTile
              icon={ScanFace}
              title={t("phone.setup.face.title")}
              hint={t("phone.setup.face.hint")}
              onClick={() => setWay("face")}
            />
            <ChoiceTile
              icon={IdCard}
              title={t("phone.setup.card.title")}
              hint={t("phone.setup.card.hint")}
              onClick={() => setWay("card")}
            />
          </div>
          <p className="pt-2 text-center">
            <Link to="/phone/login" className="text-lg font-semibold text-primary underline">
              {t("phone.backToSignIn")}
            </Link>
          </p>
        </>
      ) : null}
      {way === "face" ? <SetupFaceProof onProven={proven} onBack={back} /> : null}
      {way === "card" ? <SetupCardProof onProven={proven} onBack={back} /> : null}
    </>
  );
}

function ChoiceTile({
  icon: Icon,
  title,
  hint,
  onClick,
}: {
  icon: typeof ScanFace;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-28 w-full items-center gap-4 rounded-xl border-2 bg-card p-5 text-left shadow-sm hover:border-primary"
    >
      <span className="grid size-16 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
        <Icon className="size-9" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-xl font-bold">{title}</span>
        <span className="block text-lg text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}
