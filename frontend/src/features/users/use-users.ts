// Server data and actions for admin users (Super Admin only).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Role } from "@/features/auth/use-auth";
import { apiGet, apiPost } from "@/lib/api-client";
import { type Page, queryString } from "@/lib/paging";

export type AdminUser = {
  id: string;
  name: string;
  username: string;
  email: string | null;
  role: Role;
  plant_id: string | null;
  is_active: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
  created_at: string;
};

export type NewUserInput = {
  name: string;
  username: string;
  email?: string;
  role: Role;
  plant_id?: string;
};

const USERS_KEY = ["users"];

export function useUsers(filters: { q?: string; role?: string; page: number }) {
  return useQuery({
    queryKey: [...USERS_KEY, filters],
    queryFn: () => apiGet<Page<AdminUser>>(`/users${queryString({ ...filters, page_size: 50 })}`),
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewUserInput) =>
      apiPost<{ user: AdminUser; temporary_password: string }>("/users", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: USERS_KEY }),
  });
}

type UserAction = "deactivate" | "reactivate" | "reset-password" | "force-logout";

export function useUserAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: UserAction; reason: string }) =>
      apiPost<{ temporary_password?: string } | undefined>(`/users/${id}/${action}`, { reason }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: USERS_KEY }),
  });
}
