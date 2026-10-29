// The pairing screen's brain (spec §4.8, §7 rule 5): type the 6-digit code, measure the
// location, send the public key to the server and keep the result on this device.
// Screens never talk to the server themselves; they only show `state` and call the actions.
// Once paired, the attendance screen takes over (and runs the 60-second heartbeat itself).
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiPost } from "@/lib/api-client";
import type { KioskMe } from "./attendance/punch-types";
import { browserCanPair, createDeviceKey } from "./device-key";
import {
  dropQueueOfRevokedDevice,
  forgetDevice,
  loadDevice,
  type PairedKiosk,
  saveDevice,
} from "./device-store";
import { LocationError, type LocationReading, measureLocation } from "./location";
import { signedRequest } from "./signer";

export const CODE_LENGTH = 6;

// What the error screens can be (each has its own text in the translation file).
export type PairingProblem =
  | "code-expired"
  | "locked"
  | "location-off"
  | "gps-weak"
  | "outside"
  | "unsupported"
  | "revoked"
  | "network"
  | "unknown";

export type PairingState =
  | { phase: "starting" }
  | { phase: "enter"; wrongCode: boolean }
  | { phase: "locating"; accuracyM: number | null }
  | { phase: "checking" }
  // `me` is the server's first heartbeat answer (null right after pairing, or when offline).
  | { phase: "paired"; kiosk: PairedKiosk; serverOffsetMs: number; me: KioskMe | null }
  | {
      phase: "problem";
      problem: PairingProblem;
      code: string;
      bestAccuracyM: number | null;
      // M4: saved punches deleted because the device was switched off (shown on that screen).
      lostPunches?: number;
    };

type RegisterResponse = {
  kiosk_id: string;
  kiosk_name: string;
  plant: { id: string; name: string; code: string };
  server_time: string;
};

const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? "dev";

// Server error code -> which problem screen to show.
const PROBLEM_FOR_CODE: Record<string, PairingProblem> = {
  PAIRING_CODE_EXPIRED: "code-expired",
  PAIRING_LOCKED: "locked",
  TOO_MANY_REQUESTS: "locked",
  LOCATION_REQUIRED: "location-off",
  GPS_ACCURACY_TOO_LOW: "gps-weak",
  OUTSIDE_GEOFENCE: "outside",
  DEVICE_REVOKED: "revoked",
  KIOSK_REVOKED: "revoked",
  NETWORK_ERROR: "network",
};

export function problemFor(error: unknown): PairingProblem {
  if (error instanceof ApiError) return PROBLEM_FOR_CODE[error.code] ?? "unknown";
  return "unknown";
}

/** Reads `?code=482913` from the address, then removes it so the code is not left in history. */
function takeCodeFromAddress(): string {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code") ?? "";
  if (params.has("code")) {
    params.delete("code");
    const rest = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : ""));
  }
  return /^[0-9]{6}$/.test(code) ? code : "";
}

export function usePairing() {
  const [state, setState] = useState<PairingState>({ phase: "starting" });
  const [code, setCode] = useState("");
  const [codeFromLink, setCodeFromLink] = useState(false);
  // The best accuracy seen in the last attempt, kept for the "not accurate enough" screen.
  const bestAccuracy = useRef<number | null>(null);

  // On start: unsupported browser? already paired? or ready for a code (maybe from the QR link).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!browserCanPair()) {
        setState({
          phase: "problem",
          problem: "unsupported",
          code: "BROWSER_NOT_SUPPORTED",
          bestAccuracyM: null,
        });
        return;
      }
      const device = await loadDevice().catch(() => undefined);
      if (device) {
        try {
          const me = await signedRequest<KioskMe>("GET", "/kiosk/me");
          if (!cancelled) {
            setState({
              phase: "paired",
              kiosk: device.paired,
              serverOffsetMs: new Date(me.server_time).getTime() - Date.now(),
              me,
            });
          }
          return;
        } catch (error) {
          if (cancelled) return;
          if (error instanceof ApiError && error.code === "DEVICE_REVOKED") {
            const lostPunches = await dropQueueOfRevokedDevice();
            if (cancelled) return;
            setState({
              phase: "problem",
              problem: "revoked",
              code: "DEVICE_REVOKED",
              bestAccuracyM: null,
              lostPunches,
            });
            return;
          }
          if (error instanceof ApiError && error.code === "NETWORK_ERROR") {
            // Offline right now: keep showing the paired screen; the clock uses this device's time.
            setState({ phase: "paired", kiosk: device.paired, serverOffsetMs: 0, me: null });
            return;
          }
          // The server does not know this device any more: start again with a new code.
          await forgetDevice().catch(() => undefined);
        }
      }
      if (cancelled) return;
      const linkCode = takeCodeFromAddress();
      if (linkCode) {
        setCode(linkCode);
        setCodeFromLink(true);
      }
      setState({ phase: "enter", wrongCode: false });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const typeDigit = useCallback((digit: string) => {
    setCode((current) => (current.length < CODE_LENGTH ? current + digit : current));
    setCodeFromLink(false);
    setState((current) =>
      current.phase === "enter" ? { phase: "enter", wrongCode: false } : current,
    );
  }, []);

  const backspace = useCallback(() => {
    setCode((current) => current.slice(0, -1));
    setState((current) =>
      current.phase === "enter" ? { phase: "enter", wrongCode: false } : current,
    );
  }, []);

  const clear = useCallback(() => {
    setCode("");
    setCodeFromLink(false);
    setState((current) =>
      current.phase === "enter" ? { phase: "enter", wrongCode: false } : current,
    );
  }, []);

  const showProblem = useCallback(
    (problem: PairingProblem, errorCode: string) =>
      setState({ phase: "problem", problem, code: errorCode, bestAccuracyM: bestAccuracy.current }),
    [],
  );

  const submit = useCallback(async () => {
    if (code.length !== CODE_LENGTH) return;
    bestAccuracy.current = null;

    // 1. Location first: if it is off, we never use up one of the code's tries.
    setState({ phase: "locating", accuracyM: null });
    let location: LocationReading;
    try {
      location = await measureLocation({
        onReading: (reading) => {
          bestAccuracy.current = Math.min(
            bestAccuracy.current ?? reading.accuracy_m,
            reading.accuracy_m,
          );
          setState({ phase: "locating", accuracyM: reading.accuracy_m });
        },
      });
    } catch (error) {
      const denied = error instanceof LocationError && error.reason === "denied";
      showProblem("location-off", denied ? "LOCATION_REQUIRED" : "LOCATION_UNAVAILABLE");
      return;
    }

    // 2. Make the key pair and ask the server to pair this device.
    setState({ phase: "checking" });
    try {
      const key = await createDeviceKey();
      const result = await apiPost<RegisterResponse>("/kiosk/register", {
        pairing_code: code,
        public_key_spki: key.publicKeySpki,
        location,
        app_version: APP_VERSION,
      });
      const kiosk: PairedKiosk = {
        kioskId: result.kiosk_id,
        kioskName: result.kiosk_name,
        plantId: result.plant.id,
        plantCode: result.plant.code,
        plantName: result.plant.name,
        accuracyM: location.accuracy_m,
      };
      await saveDevice({
        privateKey: key.privateKey,
        publicKeySpki: key.publicKeySpki,
        paired: kiosk,
        counter: 0,
      });
      setState({
        phase: "paired",
        kiosk,
        serverOffsetMs: new Date(result.server_time).getTime() - Date.now(),
        me: null,
      });
    } catch (error) {
      if (error instanceof ApiError && error.code === "PAIRING_CODE_INVALID") {
        // A wrong code stays on the typing screen so it can be corrected.
        setCode("");
        setState({ phase: "enter", wrongCode: true });
        return;
      }
      showProblem(problemFor(error), error instanceof ApiError ? error.code : "UNKNOWN");
    }
  }, [code, showProblem]);

  /** From a problem screen: try the same code again, or start over with a new one. */
  const tryAgain = useCallback(
    (problem: PairingProblem) => {
      if (problem === "code-expired" || problem === "locked" || problem === "revoked") {
        setCode("");
        setCodeFromLink(false);
        void forgetDevice().catch(() => undefined);
        setState({ phase: "enter", wrongCode: false });
        return;
      }
      void submit();
    },
    [submit],
  );

  /** The attendance screen learned the admin switched this device off. */
  const markRevoked = useCallback(() => {
    void dropQueueOfRevokedDevice().then((lostPunches) =>
      setState({
        phase: "problem",
        problem: "revoked",
        code: "DEVICE_REVOKED",
        bestAccuracyM: null,
        lostPunches,
      }),
    );
  }, []);

  /** The server no longer knows this device's key (for example after a reset): pair again. */
  const startOver = useCallback(() => {
    setCode("");
    setCodeFromLink(false);
    void forgetDevice().catch(() => undefined);
    setState({ phase: "enter", wrongCode: false });
  }, []);

  return {
    state,
    code,
    codeFromLink,
    typeDigit,
    backspace,
    clear,
    submit,
    tryAgain,
    markRevoked,
    startOver,
  };
}
