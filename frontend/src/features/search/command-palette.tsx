// The Ctrl+K palette (F-6): jump to a page, an employee, a plant or a kiosk. The server only
// returns what the user may see (a Plant Head sees only their own plant). Opens from the top
// bar button or with Ctrl+K / Cmd+K on any admin page.
import { Command } from "cmdk";
import { Factory, Search, Tablet, User, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { MIN_SEARCH_LENGTH, useQuickSearch } from "./use-search";

export type PalettePage = { to: string; label: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pages: PalettePage[];
};

const ITEM_CLASS =
  "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm aria-selected:bg-primary-soft aria-selected:text-primary-soft-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground";

export function CommandPalette({ open, onOpenChange, pages }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [typed, setTyped] = useState("");
  const results = useQuickSearch(typed);

  // Wait a moment after typing so the server is not asked on every key.
  useEffect(() => {
    const timer = setTimeout(() => setTyped(text), 250);
    return () => clearTimeout(timer);
  }, [text]);

  const go = (path: string) => {
    onOpenChange(false);
    setText("");
    navigate(path);
  };

  const needle = text.trim().toLowerCase();
  const matchingPages = pages.filter(
    (page) => !needle || page.label.toLowerCase().includes(needle),
  );
  const tooShort = needle.length > 0 && needle.length < MIN_SEARCH_LENGTH;
  const searching = needle.length >= MIN_SEARCH_LENGTH;
  const found = results.data;
  const nothing =
    searching &&
    !results.isFetching &&
    results.data !== undefined &&
    matchingPages.length === 0 &&
    found?.employees.length === 0 &&
    found?.plants.length === 0 &&
    found?.kiosks.length === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setText("");
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
              placeholder={t("palette.placeholder")}
              className="h-12 flex-1 bg-transparent text-[15px] outline-none"
            />
            <kbd className="rounded border px-1.5 text-xs text-muted-foreground">Esc</kbd>
          </div>
          <Command.List className="max-h-80 overflow-y-auto p-2">
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

            {found && found.employees.length > 0 ? (
              <Command.Group
                heading={t("palette.employees")}
                className="pb-2 text-xs text-muted-foreground"
              >
                {found.employees.map((employee) => (
                  <Command.Item
                    key={employee.id}
                    value={`employee-${employee.id}`}
                    className={ITEM_CLASS}
                    onSelect={() => go(`/admin/employees/${employee.id}`)}
                  >
                    <User aria-hidden />
                    <span className="code font-bold text-foreground">{employee.employee_code}</span>
                    <span className="text-foreground">{employee.full_name}</span>
                    <span className="ml-auto text-xs">
                      {employee.plant_code}
                      {employee.status === "left" ? ` · ${t("employees.status.left")}` : ""}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}
            {found && found.plants.length > 0 ? (
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
            {found && found.kiosks.length > 0 ? (
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
          </Command.List>
          <div className="flex gap-4 border-t px-4 py-2 text-xs text-muted-foreground">
            <span>↑↓ {t("palette.hintMove")}</span>
            <span>↵ {t("palette.hintOpen")}</span>
            <span>Esc {t("palette.hintClose")}</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
