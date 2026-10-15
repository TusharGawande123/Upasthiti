// Server data for the settings screen.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPut } from "@/lib/api-client";

export type SettingValue = number | string | null;

export type Setting = {
  key: string;
  group: string;
  value: SettingValue;
  default: SettingValue;
  unit: string;
  used_from: number;
  editable: boolean;
  minimum: number | null;
  maximum: number | null;
  allowed_values: SettingValue[] | null;
};

const SETTINGS_KEY = ["settings"];

export function useSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => apiGet<{ settings: Setting[] }>("/settings"),
  });
}

export function useSaveSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { values: Record<string, SettingValue>; reason: string }) =>
      apiPut<{ settings: Setting[] }>("/settings", input),
    onSuccess: (result) => queryClient.setQueryData(SETTINGS_KEY, result),
  });
}
