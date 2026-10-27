// The Ctrl+K palette (F-6): jump to a page, an employee (by code, name or QR card serial), a
// plant or a kiosk, or run a command such as "Issue QR card…". The server only returns what the
// user may see (a Plant Head sees only their own plant). Opens from the top bar button or with
// Ctrl+K / Cmd+K on any admin page.
import { Command } from "cmdk";
import { Factory, type LucideIcon, Search, Tablet, User, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FaceStateBadge } from "@/features/face/face-badges";
import type { FaceState } from "@/features/face/use-face";
import { MIN_SEARCH_LENGTH, useQuickSearch } from "./use-search";

export type PalettePage = { to: string; label: string };

// A command either goes to an address, or first asks for an employee and then goes to the
// address made for that employee ("Issue QR card…").
type CommandBase = { id: string; label: string; hint: string; icon: LucideIcon };
export type PaletteCommand =
  | (CommandBase & { kind: "go"; to: string })
  | (CommandBase & {
      kind: "pickEmployee";
      placeholder: string;
      pathFor: (employeeId: string) => string;
    });

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pages: PalettePage[];
  commands?: PaletteCommand[];
};

const ITEM_CLASS =
  "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm aria-selected:bg-primary-soft aria-selected:text-primary-soft-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground";

export function CommandPalette({ open, onOpenChange, pages, commands = [] }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [typed, setTyped] = useState("");
  // Set while a command waits for the user to choose an employee.
  const [picking, setPicking] = useState<Extract<PaletteCommand, { kind: "pickEmployee" }> | null>(
    null,
  );
  const results = useQuickSearch(typed);

  // Wait a moment after typing so the server is not asked on every key.
  useEffect(() => {
    const timer = setTimeout(() => setTyped(text), 250);
    return () => clearTimeout(timer);
  }, [text]);

  const close = () => {
    setText("");
    setPicking(null);
    onOpenChange(false);
  };

  const go = (path: string) => {
    close();
    navigate(path);
  };

  const needle = text.trim().toLowerCase();
  const matchingPages = picking
    ? []
    : pages.filter((page) => !needle || page.label.toLowerCase().includes(needle));
  const matchingCommands = picking
    ? []
    : commands.filter((command) => !needle || command.label.toLowerCase().includes(needle));
  const tooShort = needle.length > 0 && needle.length < MIN_SEARCH_LENGTH;
  const searching = needle.length >= MIN_SEARCH_LENGTH;
  const found = results.data;
  const employees = found?.employees ?? [];
  const nothing =
    searching &&
    !results.isFetching &&
    results.data !== undefined &&
    matchingPages.length === 0 &&
    matchingCommands.length === 0 &&
    employees.length === 0 &&
    (picking || (found?.plants.length === 0 && found?.kiosks.length === 0));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setText("");
          setPicking(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="top-[20%] max-w-xl translate-y-0 gap-0 p-0">
        <DialogTitle className="sr-only">{t("palette.title")}</DialogTitle>
        <DialogDescription className="sr-only">{t("palette.description")}</DialogDescription>
        {/* We filter pages ourselves and the server filters people, so cmdk must not. */}
        <Command shouldFilter={false} label={t("palette.title")}>
          <div className="flex items-center gap-2 border-b px-4">
            <Search className="size-4 text-muted-foreground" aria-hidden />
            <Command.Input
              value={text}
              onValueChange={setText}
              placeholder={picking ? picking.placeholder : t("palette.placeholder")}
              className="h-12 flex-1 bg-transparent text-[15px] outline-none"
            />
            <kbd className="rounded border px-1.5 text-xs text-muted-foreground">Esc</kbd>
          </div>
          <Command.List className="max-h-80 overflow-y-auto p-2">
            {picking ? <p className="px-3 py-2 text-sm font-semibold">{picking.label}</p> : null}
            {tooShort ? (
              <p className="p-4 text-center text-sm text-muted-foreground">
                {t("palette.typeMore", { count: MIN_SEARCH_LENGTH })}
              </p>
            ) : null}
            {results.isError ? (
              <p role="alert" className="p-4 text-center text-sm text-destructive">
                {t("palette.error")}
              </p>
            ) : null}
            {searching && results.isFetching && !found ? (
              <p className="p-4 text-center text-sm text-muted-foreground">
                {t("palette.loading")}
              </p>
            ) : null}
            {nothing ? (
              <p className="p-4 text-center text-sm text-muted-foreground">
                {t("palette.noResult", { text: text.trim() })}
              </p>
            ) : null}

            {matchingCommands.length > 0 ? (
              <Command.Group
                heading={t("palette.commands")}
                className="pb-2 text-xs text-muted-foreground"
              >
                {matchingCommands.map((command) => (
                  <Command.Item
                    key={command.id}
                    value={`command-${command.id}`}
                    className={ITEM_CLASS}
                    onSelect={() => {
                      if (command.kind === "go") {
                        go(command.to);
                      } else {
                        setPicking(command);
                        setText("");
                        setTyped("");
                      }
                    }}
                  >
                    <command.icon aria-hidden />
                    <span className="text-foreground">
                      {command.label}
                      <span className="block text-xs text-muted-foreground">{command.hint}</span>
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}

            {employees.length > 0 ? (
              <Command.Group
                heading={t("palette.employees")}
                className="pb-2 text-xs text-muted-foreground"
              >
                {employees.map((employee) => (
                  <Command.Item
                    key={employee.id}
                    value={`employee-${employee.id}`}
                    className={ITEM_CLASS}
                    onSelect={() =>
                      go(picking ? picking.pathFor(employee.id) : `/admin/employees/${employee.id}`)
                    }
                  >
                    <User aria-hidden />
                    {employee.card_serial ? (
                      <span className="code rounded bg-muted px-1.5 text-xs font-bold text-foreground">
                        {employee.card_serial}
                      </span>
                    ) : null}
                    <span className="code font-bold text-foreground">{employee.employee_code}</span>
                    <span className="text-foreground">{employee.full_name}</span>
                    {picking?.id === "enrol-face" && employee.face_state ? (
                      <FaceStateBadge state={employee.face_state as FaceState} />
                    ) : null}
                    <span className="ml-auto text-xs">
                      {employee.plant_code}
                      {employee.status === "left" ? ` · ${t("employees.status.left")}` : ""}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}
            {!picking && found && found.plants.length > 0 ? (
              <Command.Group
                heading={t("palette.plants")}
                className="pb-2 text-xs text-muted-foreground"
              >
                {found.plants.map((plant) => (
                  <Command.Item
                    key={plant.id}
                    value={`plant-${plant.id}`}
                    className={ITEM_CLASS}
                    onSelect={() => go(`/admin/plants/${plant.id}`)}
                  >
                    <Factory aria-hidden />
                    <span className="code font-bold text-foreground">{plant.code}</span>
                    <span className="text-foreground">{plant.name}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}
            {!picking && found && found.kiosks.length > 0 ? (
              <Command.Group
                heading={t("palette.kiosks")}
                className="pb-2 text-xs text-muted-foreground"
              >
                {found.kiosks.map((kiosk) => (
                  <Command.Item
                    key={kiosk.id}
                    value={`kiosk-${kiosk.id}`}
                    className={ITEM_CLASS}
                    onSelect={() => go("/admin/kiosks")}
                  >
                    <Tablet aria-hidden />
                    <span className="text-foreground">{kiosk.name}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}
            {matchingPages.length > 0 ? (
              <Command.Group heading={t("palette.pages")} className="text-xs text-muted-foreground">
                {matchingPages.map((page) => (
                  <Command.Item
                    key={page.to}
                    value={`page-${page.to}`}
                    className={ITEM_CLASS}
                    onSelect={() => go(page.to)}
                  >
                    <Users aria-hidden />
                    <span className="text-foreground">{page.label}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}
            {!needle && !picking ? (
              <p className="px-3 pt-2 text-xs text-muted-foreground">{t("palette.cardHint")}</p>
            ) : null}
          </Command.List>
          <div className="flex items-center gap-4 border-t px-4 py-2 text-xs text-muted-foreground">
            <span>↑↓ {t("palette.hintMove")}</span>
            <span>↵ {t("palette.hintOpen")}</span>
            <span>Esc {t("palette.hintClose")}</span>
            {picking ? (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto h-6 px-2 text-xs"
                onClick={() => {
                  setPicking(null);
                  setText("");
                  setTyped("");
                }}
              >
                {t("palette.back")}
              </Button>
            ) : null}
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
