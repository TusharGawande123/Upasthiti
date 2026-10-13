// "My sessions" (F-23): the devices where the user is logged in, with a log-out per device.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MonitorSmartphone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiDelete, apiGet } from "@/lib/api-client";
import { formatDate, formatTime } from "@/lib/format";
import { describeError } from "./error-message";

type SessionInfo = {
  id: string;
  created_at: string;
  last_seen_at: string;
  ip: string | null;
  browser: string | null;
  is_current: boolean;
};

const SESSIONS_KEY = ["sessions"];

export function SessionsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const sessions = useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: () => apiGet<SessionInfo[]>("/auth/sessions"),
  });
  const endSession = useMutation({
    mutationFn: (id: string) => apiDelete<void>(`/auth/sessions/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SESSIONS_KEY }),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-[26px] font-bold tracking-tight">{t("sessions.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("sessions.subtitle")}</p>
      </div>
      {sessions.isError ? (
        <Alert tone="danger">
          <span>{describeError(sessions.error, t)}</span>
        </Alert>
      ) : null}
      {sessions.isPending ? <Skeleton className="h-40 w-full" /> : null}
      <ul className="space-y-3">
        {sessions.data?.map((item) => (
          <li key={item.id}>
            <Card className="flex items-center gap-4 p-4">
              <MonitorSmartphone className="size-6 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {item.browser ?? t("sessions.unknownBrowser")}
                </p>
                <p className="tnum text-[13px] text-muted-foreground">
                  {t("sessions.lastActive", {
                    date: formatDate(item.last_seen_at),
                    time: formatTime(item.last_seen_at),
                  })}
                  {item.ip ? ` · ${item.ip}` : ""}
                </p>
              </div>
              {item.is_current ? (
                <Badge tone="success">{t("sessions.thisDevice")}</Badge>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={endSession.isPending}
                  onClick={() => endSession.mutate(item.id)}
                >
                  {t("sessions.logOut")}
                </Button>
              )}
            </Card>
          </li>
        ))}
      </ul>
      <p className="text-[13px] text-muted-foreground">{t("sessions.note")}</p>
    </div>
  );
}
