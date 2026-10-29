// The gate's offline side as one hook (M4 spec §7 rules 9, 11, 12):
//  - tells the screens how many punches wait and since when (F-55, "12 saved");
//  - checks the browser's storage once (S-38): saving offline is allowed only with room to spare;
//  - sends the saved punches by itself as soon as the gate is online again, one batch after the
//    other, and pauses while a punch is on the screen (live punches always go first);
//  - when the server says the device is switched off, says so (the pairing hook then throws the
//    queue away: nothing can ever be sent with a revoked key).
import { useCallback, useEffect, useRef, useState } from "react";
import { type QueueSummary, queueSummary } from "../device-store";
import type { LocationReport } from "../location/gate-location";
import {
  type CardEvidence,
  type FaceEvidence,
  type KioskOfflineSettings,
  type SaveOutcome,
  saveOfflinePunch,
} from "./offline-queue";
import { syncOnce } from "./sync-runner";

/** The browser must offer this much storage beyond the queue's own limit (spec §7 rule 12). */
const STORAGE_HEADROOM_MB = 50;
const RETRY_SYNC_MS = 15_000;

const EMPTY: QueueSummary = { count: 0, bytes: 0, oldestSavedWallMs: null };

export type StorageCheck = {
  ready: boolean;
  persisted: boolean | null;
  quotaMb: number | null;
  usageMb: number | null;
};

/** Is there room for a full queue? Also asks the browser not to evict our data (best effort). */
export async function checkStorage(maxMb: number): Promise<StorageCheck> {
  try {
    const persisted = (await navigator.storage?.persist?.()) ?? null;
    const estimate = await navigator.storage?.estimate?.();
    if (!estimate?.quota) return { ready: false, persisted, quotaMb: null, usageMb: null };
    const quotaMb = Math.round(estimate.quota / (1024 * 1024));
    const usageMb = Math.round((estimate.usage ?? 0) / (1024 * 1024));
    return { ready: quotaMb - usageMb >= maxMb + STORAGE_HEADROOM_MB, persisted, quotaMb, usageMb };
  } catch {
    return { ready: false, persisted: null, quotaMb: null, usageMb: null };
  }
}

export type OfflineGate = {
  queue: QueueSummary;
  /** Offline saving is on in this server AND this device has room for it. */
  ready: boolean;
  /** The gate has no internet right now and may save a punch instead of sending it. */
  canSave: boolean;
  /** When the last batch was sent (device clock; shown as a time only). */
  lastSentAtMs: number | null;
  /** What the browser says about its storage (for the heartbeat and the devices page). */
  storage: StorageCheck | null;
  save: (input: {
    clientPunchId: string;
    method: "qr" | "face";
    evidence: CardEvidence | FaceEvidence;
    challenge?: string;
    location: LocationReport | null;
  }) => Promise<SaveOutcome>;
};

export function useOfflineGate({
  settings,
  online,
  busy,
  onRevoked,
}: {
  settings: KioskOfflineSettings | undefined;
  online: boolean;
  /** A punch is on the screen: do not start a batch now. */
  busy: boolean;
  onRevoked: () => void;
}): OfflineGate {
  const [queue, setQueue] = useState<QueueSummary>(EMPTY);
  const [storage, setStorage] = useState<StorageCheck | null>(null);
  const storageReady = storage?.ready === true;
  const [lastSentAtMs, setLastSentAtMs] = useState<number | null>(null);
  const sending = useRef(false);
  const latest = useRef({ busy, onRevoked });
  latest.current = { busy, onRevoked };

  const refresh = useCallback(async () => setQueue(await queueSummary()), []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const maxMb = settings?.max_mb;
  useEffect(() => {
    if (maxMb === undefined) return;
    void checkStorage(maxMb).then(setStorage);
  }, [maxMb]);

  // Online with saved punches: send them. A failed batch (still no internet) tries again soon.
  const waiting = queue.count;
  useEffect(() => {
    if (!online || waiting === 0) return;
    let stopped = false;
    const run = async () => {
      if (sending.current || latest.current.busy) return;
      sending.current = true;
      try {
        for (;;) {
          const round = await syncOnce();
          if (stopped) return;
          if (round.kind === "revoked") {
            // The pairing hook counts and deletes the queue for the "Switched off" screen.
            latest.current.onRevoked();
            break;
          }
          if (round.kind === "sent") setLastSentAtMs(Date.now());
          if (round.kind !== "sent") break;
          if (round.done === 0) break; // the server asked for "later": wait for the next round
        }
      } finally {
        sending.current = false;
        if (!stopped) await refresh();
      }
    };
    void run();
    const timer = setInterval(() => void run(), RETRY_SYNC_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [online, waiting, refresh]);

  const ready = settings?.enabled === true && storageReady;
  const save: OfflineGate["save"] = useCallback(
    async (input) => {
      if (!input.location) return "OFFLINE_NOT_READY";
      const outcome = await saveOfflinePunch({
        ...input,
        location: input.location,
        settings,
        offlineReady: storageReady,
      });
      await refresh();
      return outcome;
    },
    [settings, storageReady, refresh],
  );

  return {
    queue,
    ready,
    canSave: !online && settings?.enabled === true,
    lastSentAtMs,
    storage,
    save,
  };
}
