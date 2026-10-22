// The kiosk's heartbeat (spec M2 §5.2): GET /kiosk/me every 60 seconds. It keeps the gate notices,
// the screen settings and the server clock fresh, tells the admin the kiosk is alive, and finds
// out within a minute when the admin switches this device off.
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/api-client";
import { signedRequest } from "../signer";
import { DEFAULT_SCREEN_SETTINGS, type KioskMe } from "./punch-types";

export const HEARTBEAT_MS = 60_000;

export function useHeartbeat(
  initialMe: KioskMe | null,
  initialOffsetMs: number,
  handlers: { onRevoked: () => void; onUnpaired: () => void },
) {
  const [me, setMe] = useState<KioskMe | null>(initialMe);
  const [serverOffsetMs, setServerOffsetMs] = useState(initialOffsetMs);
  const [online, setOnline] = useState(true);
  const { onRevoked, onUnpaired } = handlers;

  const beat = useCallback(async () => {
    try {
      const answer = await signedRequest<KioskMe>("GET", "/kiosk/me");
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
  }, [onRevoked, onUnpaired]);

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
