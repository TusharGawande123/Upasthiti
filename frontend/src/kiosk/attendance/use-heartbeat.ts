// The gate's heartbeat (spec M2 §5.2, M4 §5.2): every 60 seconds the gate tells the server how it
// is doing (saved punches waiting, location, storage, battery, camera) and gets the notices, the
// screen settings and the server time back. That keeps the notices fresh, shows the admin the
// attendance device is alive, and finds out within a minute when it is switched off.
// A server that does not know the heartbeat yet (during a deploy) is asked with GET /kiosk/me.
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api-client";
import { signedRequest } from "../signer";
import type { HeartbeatBody } from "./heartbeat-report";
import { DEFAULT_SCREEN_SETTINGS, type KioskMe } from "./punch-types";

export const HEARTBEAT_MS = 60_000;

export function useHeartbeat(
  initialMe: KioskMe | null,
  initialOffsetMs: number,
  handlers: {
    onRevoked: () => void;
    onUnpaired: () => void;
    /** What the gate knows right now. Read at each beat, so the timer never goes stale. */
    getReport?: () => Promise<HeartbeatBody>;
  },
) {
  const [me, setMe] = useState<KioskMe | null>(initialMe);
  const [serverOffsetMs, setServerOffsetMs] = useState(initialOffsetMs);
  const [online, setOnline] = useState(true);
  const { onRevoked, onUnpaired } = handlers;
  const getReport = useRef(handlers.getReport);
  getReport.current = handlers.getReport;

  const ask = useCallback(async (): Promise<KioskMe> => {
    const report = getReport.current;
    if (!report) return signedRequest<KioskMe>("GET", "/kiosk/me");
    try {
      return await signedRequest<KioskMe>("POST", "/kiosk/heartbeat", await report());
    } catch (error) {
      // An older server has no heartbeat yet: the old call still works and keeps the queue.
      if (error instanceof ApiError && error.status === 404) {
        return signedRequest<KioskMe>("GET", "/kiosk/me");
      }
      throw error;
    }
  }, []);

  const beat = useCallback(async () => {
    try {
      const answer = await ask();
      setMe(answer);
      setServerOffsetMs(new Date(answer.server_time).getTime() - Date.now());
      setOnline(true);
    } catch (error) {
      if (!(error instanceof ApiError)) return;
      if (error.code === "DEVICE_REVOKED") onRevoked();
      else if (error.code === "DEVICE_SIGNATURE_INVALID") onUnpaired();
      else if (error.code === "NETWORK_ERROR") setOnline(false);
      // Any other failure is ignored; the next beat tries again.
    }
  }, [ask, onRevoked, onUnpaired]);

  useEffect(() => {
    // Right after pairing (or an offline start) nothing is known yet: ask at once.
    if (initialMe === null) void beat();
    const timer = setInterval(() => void beat(), HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [beat, initialMe]);

  return {
    notices: me?.notices ?? [],
    settings: me?.kiosk_settings ?? DEFAULT_SCREEN_SETTINGS,
    serverOffsetMs,
    online,
    /** A punch answer or failure also tells whether the internet works. */
    setOnline,
  };
}
