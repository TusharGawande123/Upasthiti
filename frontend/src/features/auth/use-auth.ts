// Server data about the logged-in user: who am I, log in, log out, change password.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiGet, apiPost } from "@/lib/api-client";

export type Role = "super_admin" | "corporate_head" | "plant_head";

export type Me = {
  id: string;
  name: string;
  username: string;
  email: string | null;
  role: Role;
  plant_ids: string[];
  must_change_password: boolean;
};

export const ME_QUERY_KEY = ["me"];

/** The logged-in user, or null when nobody is logged in. */
export function useMe() {
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: async (): Promise<Me | null> => {
      try {
        return await apiGet<Me>("/auth/me");
      } catch (error) {
        if (error instanceof ApiError && error.code === "NOT_AUTHENTICATED") {
          return null;
        }
        throw error;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (credentials: { login: string; password: string }) =>
      apiPost<Me>("/auth/login", credentials),
    onSuccess: (me) => queryClient.setQueryData(ME_QUERY_KEY, me),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<void>("/auth/logout"),
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(ME_QUERY_KEY, null);
    },
  });
}

export function useChangePassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (passwords: { current_password: string; new_password: string }) =>
      apiPost<void>("/auth/change-password", passwords),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
  });
}
