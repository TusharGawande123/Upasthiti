// The changing phone code of the gate screen (spec M4b §4.2, §5.4). While the panel may show, the
// gate asks the server for the current code (signed, like every gate request) and asks again
// shortly before it changes. The server signs the code; the gate never makes one. If no fresh
// code arrives for 15 seconds the panel says so instead of showing an old code.
import { useEffect, useState } from "react";
import { signedRequest } from "../signer";

export type GateCode = {
  code_text: string | null;
  svg: string | null;
  issued_at: string;
  expires_at: string;
  refresh_in_seconds: number;
};

/** No fresh code for this long: "Phone code not available now". */
export const STALE_AFTER_MS = 15_000;
const MIN_WAIT_MS = 3_000;
const RETRY_WAIT_MS = 5_000;

export type GateCodeState =
  | { kind: "off" } // not enabled, or no worker at this plant has phone punching: show nothing
  | { kind: "unavailable" } // enabled, but no fresh code (offline or the server did not answer)
  | { kind: "code"; code: GateCode; receivedAtMs: number };

export function useGateCode(active: boolean): GateCodeState {
  const [state, setState] = useState<GateCodeState>({ kind: "off" });

  useEffect(() => {
    if (!active) {
      setState({ kind: "off" });
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastOkAt = 0;

    const load = async () => {
      let waitMs = RETRY_WAIT_MS;
      try {
        const code = await signedRequest<GateCode>("POST", "/kiosk/gate-code");
        if (stopped) return;
        lastOkAt = Date.now();
        setState(
          code.code_text === null || code.svg === null
            ? { kind: "off" }
            : { kind: "code", code, receivedAtMs: lastOkAt },
        );
        waitMs = Math.max(MIN_WAIT_MS, code.refresh_in_seconds * 1000);
      } catch {
        if (stopped) return;
        // A stale code is never shown: after 15 s without a new one the panel says so.
        if (Date.now() - lastOkAt >= STALE_AFTER_MS) setState({ kind: "unavailable" });
      }
      timer = setTimeout(load, waitMs);
    };
    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [active]);

  return state;
}
