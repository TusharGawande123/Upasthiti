// The plant filter in the top bar: "All plants" or one plant. Lists and counts on many pages
// start with this plant. It is remembered in this browser between logins (decision of
// design gate D). A Plant Head has only one plant, so the filter is fixed to it.
import { Building2, Lock } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Select } from "@/components/ui/select";
import type { Me } from "@/features/auth/use-auth";
import { usePlants } from "@/features/plants/use-plants";

const STORAGE_KEY = "upasthiti.plantFilter";

type PlantFilter = {
  /** The chosen plant id, or "" for all plants. */
  plantId: string;
  setPlantId: (plantId: string) => void;
  /** True for a Plant Head: the plant cannot be changed. */
  locked: boolean;
};

const PlantFilterContext = createContext<PlantFilter>({
  plantId: "",
  setPlantId: () => {},
  locked: false,
});

function readSaved(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    // Storage can be blocked (private window); the filter simply starts at "All plants".
    return "";
  }
}

export function PlantFilterProvider({ user, children }: { user: Me; children: ReactNode }) {
  const locked = user.role === "plant_head";
  const [saved, setSaved] = useState(readSaved);
  const plants = usePlants({ is_active: true });

  // A saved plant that no longer exists (or is switched off) falls back to "All plants".
  const known = plants.data?.items.some((plant) => plant.id === saved) ?? true;
  const lockedPlant = user.plant_ids[0] ?? "";
  const plantId = locked ? lockedPlant : known ? saved : "";

  const setPlantId = useCallback((next: string) => {
    setSaved(next);
    try {
      if (next) localStorage.setItem(STORAGE_KEY, next);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Not remembered; still applied for this visit.
    }
  }, []);

  const value = useMemo(() => ({ plantId, setPlantId, locked }), [plantId, setPlantId, locked]);
  return <PlantFilterContext.Provider value={value}>{children}</PlantFilterContext.Provider>;
}

export function usePlantFilter() {
  return useContext(PlantFilterContext);
}

export function PlantFilterSelect() {
  const { t } = useTranslation();
  const { plantId, setPlantId, locked } = usePlantFilter();
  const plants = usePlants({ is_active: true });
  const items = plants.data?.items ?? [];

  if (locked) {
    const own = items.find((plant) => plant.id === plantId);
    return (
      <span className="inline-flex h-10 items-center gap-2 rounded-md border bg-muted px-3 text-sm font-semibold">
        <Lock className="size-4" aria-hidden />
        {own ? `${own.code} · ${own.name}` : t("plantFilter.yourPlant")}
      </span>
    );
  }

  return (
    <div className="relative">
      <Building2
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Select
        aria-label={t("plantFilter.label")}
        value={plantId}
        onChange={(event) => setPlantId(event.target.value)}
        className="h-10 w-auto min-w-44 pl-9 text-sm font-semibold"
      >
        <option value="">{t("plantFilter.all")}</option>
        {items.map((plant) => (
          <option key={plant.id} value={plant.id}>
            {plant.code} · {plant.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
