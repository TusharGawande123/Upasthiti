// Server data and actions of the "Phone attendance" card on an employee's page (spec M4b §4.12,
// §5.5). Reading is for the Super Admin, the Corporate Head and the Plant Head (own plant); every
// change is for the Super Admin only, and the server checks that again. Each change needs a reason
// (3 to 300 characters) that goes into the audit log.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPut } from "@/lib/api-client";

export type PhoneAccountState = "no_password" | "active" | "locked" | "new_password_required";

export type PhoneAdminView = {
  phone_punch_enabled: boolean;
  phone_changed_at: string | null;
  outside_work_allowed: boolean;
  outside_work_until: string | null;
  /** F-69: the "until" day is over (the daily job turns it off). */
  outside_work_ended: boolean;
  outside_changed_at: string | null;
  account: {
    state: PhoneAccountState;
    password_set_at: string | null;
    proof_kind: "face" | "card" | null;
    locked_until: string | null;
  };
  notice: { version: string; accepted_at: string } | null;
  sessions: {
    id: string;
    started_at: string;
    last_seen_at: string;
    expires_at: string;
    browser: string;
    system: string;
    /** Only the Super Admin gets the address. */
    ip: string | null;
  }[];
  passkeys: { id: string; label: string; created_at: string; last_used_at: string | null }[];
};

const phoneKey = (employeeId: string) => ["employees", employeeId, "phone"] as const;

export function usePhoneAdmin(employeeId: string) {
  return useQuery({
    queryKey: phoneKey(employeeId),
    queryFn: () => apiGet<PhoneAdminView>(`/employees/${employeeId}/phone`),
    retry: false,
  });
}

/** Runs one change, then reloads the card, the employee and the audit-based timeline. */
function usePhoneChange<Input>(send: (input: Input) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: send,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
  });
}

export const useSetPhoneAccess = (employeeId: string) =>
  usePhoneChange((input: { enabled: boolean; reason: string }) =>
    apiPut(`/employees/${employeeId}/phone/access`, {
      phone_punch_enabled: input.enabled,
      reason: input.reason,
    }),
  );

export const useSetOutsideWork = (employeeId: string) =>
  usePhoneChange((input: { allowed: boolean; reason: string; until: string | null }) =>
    apiPut(`/employees/${employeeId}/phone/outside-work`, {
      allowed: input.allowed,
      reason: input.reason,
      ...(input.until ? { until: input.until } : {}),
    }),
  );

export const useSignOutAllPhones = (employeeId: string) =>
  usePhoneChange((input: { reason: string }) =>
    apiPost<{ ended: number }>(`/employees/${employeeId}/phone/sign-out-all`, input),
  );

export const useRequireNewPassword = (employeeId: string) =>
  usePhoneChange((input: { reason: string }) =>
    apiPost(`/employees/${employeeId}/phone/require-new-password`, input),
  );

export const useRemovePasskey = (employeeId: string) =>
  usePhoneChange((input: { passkeyId: string; reason: string }) =>
    apiPost(`/employees/${employeeId}/phone/passkeys/${input.passkeyId}/remove`, {
      reason: input.reason,
    }),
  );
