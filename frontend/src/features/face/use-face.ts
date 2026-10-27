// Server data and actions for face enrolment (spec M3 §5.3, §5.4): an employee's face state,
// the consent text, consent give / decline / withdraw, the enrolment session with its shots,
// deleting face data, and the enrolment progress.
//
// Reading is for every role (a Plant Head sees their own plant); every change is for the Super
// Admin only, and the server checks that again. No template or face vector ever reaches the
// browser: the server only answers with states, dates and names.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api-client";

export const CONSENT_VERSION = "face-consent-v1";
export const CONSENT_LANGUAGES = ["en", "mr", "hi"] as const;
export type ConsentLanguage = (typeof CONSENT_LANGUAGES)[number];
export type ExplainedLanguage = "mr" | "hi" | "other";

// The five enrolment poses, in the order the wizard asks for them (decision 0018).
export const ENROLMENT_POSES = ["straight", "left", "right", "up", "down"] as const;
export type Pose = (typeof ENROLMENT_POSES)[number];

// The face column of the employees list. "reenrol_suggested" is F-41, "old_model" means the
// stored template was made by another face model than the one running now.
export type FaceState =
  | "enrolled"
  | "not_enrolled"
  | "reenrol_suggested"
  | "old_model"
  | "withdrawn"
  | "not_face_method";
export type FaceFilter = "enrolled" | "not_enrolled" | "reenrol_suggested" | "old_model";
export const FACE_FILTERS: FaceFilter[] = [
  "enrolled",
  "not_enrolled",
  "reenrol_suggested",
  "old_model",
];

type PersonRef = { id: string; name: string };

export type Consent = {
  choice: "agreed" | "declined";
  text_version: string;
  language: string;
  explained_language: string | null;
  given_at: string;
  recorded_by: PersonRef | null;
  withdrawn_at: string | null;
  withdrawn_by: PersonRef | null;
  withdraw_kind: "withdrawn" | "left" | null;
  withdraw_reason: string | null;
};

export type Template = {
  enrolled_at: string;
  enrolled_by?: PersonRef | null;
  model_id: string;
  shot_count: number;
  duplicate_override?: boolean;
};

export type HistoryItem = {
  kind: string;
  at: string;
  by: PersonRef | null;
  detail: string | null;
};

export type EmployeeFace = {
  punch_method: "face" | "qr";
  face_state: FaceState;
  consent: Consent | null;
  template: Template | null;
  reenrol_suggested: boolean;
  reenrol_reason: string | null;
  history: HistoryItem[];
};

export type ConsentText = { version: string; language: string; text: string; text_sha256: string };

export type EnrolmentSession = {
  session_id: string;
  expires_at: string;
  model_id: string;
  poses: Pose[];
};

export type ShotAnswer = {
  accepted: boolean;
  reason_code: string | null;
  shots_done: number;
  next_pose: Pose | null;
};

// One possible duplicate from the 409 FACE_DUPLICATE_FOUND answer (F-39). No photo: there is none.
export type DuplicateMatch = {
  employee_id: string;
  employee_code: string;
  name: string;
  plant_code: string;
};

type ProgressCounts = {
  face_employees: number;
  enrolled: number;
  not_enrolled: number;
  old_model: number;
  reenrol_suggested: number;
};
export type EnrolmentProgress = {
  plants: ({ plant: { id: string; code: string; name: string } } & ProgressCounts)[];
  totals: ProgressCounts;
};

const FACE_KEY = ["face"];

export function useEmployeeFace(employeeId: string) {
  return useQuery({
    queryKey: [...FACE_KEY, "employee", employeeId],
    queryFn: () => apiGet<EmployeeFace>(`/employees/${employeeId}/face`),
  });
}

export function useConsentText(language: ConsentLanguage, enabled = true) {
  return useQuery({
    queryKey: [...FACE_KEY, "consent-text", CONSENT_VERSION, language],
    queryFn: () =>
      apiGet<ConsentText>(`/face/consent-texts/${CONSENT_VERSION}?language=${language}`),
    enabled,
    staleTime: Number.POSITIVE_INFINITY, // a text version never changes
  });
}

export function useEnrolmentProgress(enabled = true) {
  return useQuery({
    queryKey: [...FACE_KEY, "progress"],
    queryFn: () => apiGet<EnrolmentProgress>("/face/enrolment-progress"),
    enabled,
  });
}

// A face change also changes the employee (punch method) and the employees list (face column).
function useRefreshFace() {
  const client = useQueryClient();
  return () => {
    client.invalidateQueries({ queryKey: FACE_KEY });
    client.invalidateQueries({ queryKey: ["employees"] });
  };
}

export function useRecordConsent(employeeId: string) {
  const refresh = useRefreshFace();
  return useMutation({
    mutationFn: (input: {
      language: ConsentLanguage;
      choice: "agreed" | "declined";
      explained_language?: ExplainedLanguage;
    }) =>
      apiPost<{ consent: Consent; punch_method: string }>(`/employees/${employeeId}/face/consent`, {
        text_version: CONSENT_VERSION,
        ...input,
      }),
    onSuccess: refresh,
  });
}

export function useWithdrawConsent(employeeId: string) {
  const refresh = useRefreshFace();
  return useMutation({
    mutationFn: (reason: string) =>
      apiPost(`/employees/${employeeId}/face/consent/withdraw`, { reason: reason || null }),
    onSuccess: refresh,
  });
}

export function useDeleteFaceData(employeeId: string) {
  const refresh = useRefreshFace();
  return useMutation({
    mutationFn: (reason: string) =>
      apiPost(`/employees/${employeeId}/face/template/delete`, { reason }),
    onSuccess: refresh,
  });
}

// --- Enrolment session: plain functions, the wizard drives them step by step -----------------

export function startEnrolment(employeeId: string) {
  return apiPost<EnrolmentSession>(`/employees/${employeeId}/face/enrolment-sessions`);
}

export function sendShot(sessionId: string, pose: Pose, imageBase64: string) {
  return apiPost<ShotAnswer>(`/face/enrolment-sessions/${sessionId}/shots`, {
    pose,
    image_jpeg: imageBase64,
  });
}

export function finishEnrolment(sessionId: string, duplicateOverrideReason?: string) {
  return apiPost<{ template: Template; replaced_previous: boolean }>(
    `/face/enrolment-sessions/${sessionId}/finish`,
    duplicateOverrideReason ? { duplicate_override_reason: duplicateOverrideReason } : {},
  );
}

export function cancelEnrolment(sessionId: string) {
  return apiPost<void>(`/face/enrolment-sessions/${sessionId}/cancel`);
}

/** Call after the wizard closes, so the panel and the list show the new state. */
export function useRefreshAfterEnrolment() {
  return useRefreshFace();
}
