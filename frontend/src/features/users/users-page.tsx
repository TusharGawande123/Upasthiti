// Users page (Super Admin): the admin accounts, with add, switch off/on, reset password and
// force logout. Status is always an icon plus a word.
import {
  Ban,
  CircleCheck,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  Plus,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { describeError } from "@/features/auth/error-message";
import type { Role } from "@/features/auth/use-auth";
import { usePlants } from "@/features/plants/use-plants";
import { formatDate, formatTime } from "@/lib/format";
import { AddUserDialog } from "./add-user-dialog";
import { type AdminUser, useUserAction, useUsers } from "./use-users";
import { ReasonDialog, TemporaryPasswordDialog } from "./user-dialogs";

type PendingAction = {
  user: AdminUser;
  action: "deactivate" | "reactivate" | "reset-password" | "force-logout";
};

function StatusBadge({ user }: { user: AdminUser }) {
  const { t } = useTranslation();
  if (!user.is_active) {
    return (
      <Badge tone="neutral">
        <Ban aria-hidden />
        {t("users.status.inactive")}
      </Badge>
    );
  }
  if (user.must_change_password) {
    return (
      <Badge tone="warning">
        <Lock aria-hidden />
        {t("users.status.tempPassword")}
      </Badge>
    );
  }
  return (
    <Badge tone="success">
      <CircleCheck aria-hidden />
      {t("users.status.active")}
    </Badge>
  );
}

export function UsersPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [shownPassword, setShownPassword] = useState<{ name: string; password: string } | null>(
    null,
  );
  const users = useUsers({ q: search.trim() || undefined, page: 1 });
  const plants = usePlants();
  const action = useUserAction();

  const plantName = (plantId: string | null) =>
    plants.data?.items.find((plant) => plant.id === plantId);

  const confirmAction = (reason: string) => {
    if (!pending) return;
    action.mutate(
      { id: pending.user.id, action: pending.action, reason },
      {
        onSuccess: (result) => {
          if (pending.action === "reset-password" && result?.temporary_password) {
            setShownPassword({ name: pending.user.name, password: result.temporary_password });
          }
          setPending(null);
        },
      },
    );
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">{t("users.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("users.subtitle")}</p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus aria-hidden />
          {t("users.add")}
        </Button>
      </div>

      <Input
        type="search"
        placeholder={t("users.searchPlaceholder")}
        aria-label={t("users.searchPlaceholder")}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="max-w-sm"
      />

      {users.isError ? (
        <Alert tone="danger">
          <span>{describeError(users.error, t)}</span>
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => users.refetch()}>
            {t("common.tryAgain")}
          </Button>
        </Alert>
      ) : null}

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t("users.columns.name")}</TableHead>
              <TableHead>{t("users.columns.username")}</TableHead>
              <TableHead>{t("users.columns.role")}</TableHead>
              <TableHead>{t("users.columns.plant")}</TableHead>
              <TableHead>{t("users.columns.status")}</TableHead>
              <TableHead>{t("users.columns.lastLogin")}</TableHead>
              <TableHead>
                <span className="sr-only">{t("common.actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.isPending
              ? Array.from({ length: 4 }, (_, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder rows
                  <TableRow key={index}>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              : users.data?.items.map((user) => {
                  const plant = plantName(user.plant_id);
                  return (
                    <TableRow key={user.id}>
                      <TableCell className="font-semibold">{user.name}</TableCell>
                      <TableCell>
                        <span className="code block">{user.username}</span>
                        {user.email ? (
                          <span className="block text-xs text-muted-foreground">{user.email}</span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge tone="primary">
                          {user.role === "super_admin" ? (
                            <ShieldCheck aria-hidden />
                          ) : (
                            <UserRound aria-hidden />
                          )}
                          {t(`roles.${user.role as Role}`)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {plant ? (
                          <>
                            <span className="code block">{plant.code}</span>
                            <span className="block text-xs text-muted-foreground">
                              {plant.name}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">–</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge user={user} />
                      </TableCell>
                      <TableCell className="tnum text-muted-foreground">
                        {user.last_login_at
                          ? `${formatDate(user.last_login_at)}, ${formatTime(user.last_login_at)}`
                          : t("users.neverLoggedIn")}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={t("users.actions.resetFor", { name: user.name })}
                            title={t("users.actions.resetFor", { name: user.name })}
                            onClick={() => setPending({ user, action: "reset-password" })}
                          >
                            <KeyRound className="size-4" aria-hidden />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={t("users.actions.forceLogoutFor", { name: user.name })}
                            title={t("users.actions.forceLogoutFor", { name: user.name })}
                            onClick={() => setPending({ user, action: "force-logout" })}
                          >
                            <LogOut className="size-4" aria-hidden />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setPending({
                                user,
                                action: user.is_active ? "deactivate" : "reactivate",
                              })
                            }
                          >
                            {user.is_active
                              ? t("users.actions.deactivate")
                              : t("users.actions.reactivate")}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
          </TableBody>
        </Table>
        {users.data && users.data.items.length === 0 ? (
          <p className="p-8 text-center text-muted-foreground">{t("users.empty")}</p>
        ) : null}
      </Card>

      <AddUserDialog
        open={adding}
        onOpenChange={setAdding}
        onCreated={(name, password) => setShownPassword({ name, password })}
      />

      <ReasonDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={pending ? t(`users.reasonTitle.${pending.action}`, { name: pending.user.name }) : ""}
        confirmLabel={pending ? t(`users.actions.${camel(pending.action)}`) : ""}
        isPending={action.isPending}
        error={action.error ? describeError(action.error, t) : undefined}
        onConfirm={confirmAction}
      />

      <TemporaryPasswordDialog shown={shownPassword} onClose={() => setShownPassword(null)} />
      {action.isPending ? <Loader2 className="sr-only animate-spin" /> : null}
    </div>
  );
}

// "reset-password" -> "resetPassword" (the translation keys are written in camelCase).
function camel(action: string) {
  return action.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase());
}
