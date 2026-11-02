// Server data of the phone pages: who is signed in, and the actions that change it.
// The phone session lives in a cookie, so "signed in" is simply "GET /phone/me works".
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api-client";
import { type PhoneMe, phoneApi, type SignedIn } from "./phone-api";

export const PHONE_ME_KEY = ["phone", "me"] as const;

/** The signed-in employee. A 401 is final (no retry): the gate component then goes to sign-in. */
export function usePhoneMe() {
  return useQuery({
    queryKey: PHONE_ME_KEY,
    queryFn: phoneApi.me,
    retry: false,
    staleTime: 30_000,
  });
}

/** Only reads what is already loaded, so the sign-in pages never call /phone/me themselves. */
export function useKnownPhoneMe(): PhoneMe | undefined {
  return useQuery({ queryKey: PHONE_ME_KEY, queryFn: phoneApi.me, enabled: false }).data;
}

/** Why the session ended, from `details.ended` of PHONE_NOT_SIGNED_IN (spec §7 rule 4). */
export function endedReason(error: unknown): "new_login" | "expired" | "other" | null {
  if (!(error instanceof ApiError) || error.code !== "PHONE_NOT_SIGNED_IN") return null;
  const ended = error.details.ended;
  if (ended === "new_login") return "new_login";
  if (ended === "expired") return "expired";
  return "other";
}

/** After a sign-in: forget the old data so the next page loads the new employee's data. */
export function useAfterSignIn() {
  const queryClient = useQueryClient();
  return async (_answer: SignedIn) => {
    queryClient.removeQueries({ queryKey: ["phone"] });
  };
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: phoneApi.logout,
    onSettled: () => queryClient.removeQueries({ queryKey: ["phone"] }),
  });
}

export function useStopPhonePunching() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: phoneApi.stop,
    onSettled: () => queryClient.removeQueries({ queryKey: ["phone"] }),
  });
}
