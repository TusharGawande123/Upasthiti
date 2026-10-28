// Saving a punch while the internet is down (M4 spec §7 rules 10-12, decision 0025 item 2).
// The punch is signed NOW with the device key and its own counter, its evidence is sealed for the
// server, and only that locked form is stored. Nothing readable stays on the device: no name, no
// card text, no code, no picture. The server decides everything when the punch is sent.
import { addToQueue, loadDevice, queueSummary, takeNextCounter } from "../device-store";
import type { LocationReport } from "../location/gate-location";
import { sha256Hex, signText } from "../signer";
import { evidenceBinding, sealEvidence } from "./sealer";
import { reportTime } from "./time-anchor";

const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? "dev";

/** What the server sends in /kiosk/me under kiosk_settings.offline (spec §5.1). */
export type KioskOfflineSettings = {
  enabled: boolean;
  evidence_key_id: string;
  evidence_public_key: string;
  max_items: number;
  max_mb: number;
  max_hours: number;
  cooldown_minutes: number;
  sync_max_items: number;
  sync_max_bytes: number;
};

export type CardEvidence = { qr_payload: string; snapshot_jpeg: string };
export type FaceEvidence = {
  employee_code: string;
  frames: { role: "frontal" | "turn"; jpeg: string }[];
};

export type SaveOutcome =
  | "OFFLINE_SAVED"
  | "QUEUE_FULL"
  | "OFFLINE_STORAGE_TOO_SMALL"
  | "OFFLINE_NOT_READY"; // no anchor yet, or offline mode is off on this server

/** The statement the device signs for one queued punch (backend sync_service.item_statement). */
export async function itemStatement(kioskId: string, counter: number, signedItem: string) {
  return `UPS-OFFLINE-1\n${kioskId}\n${counter}\n${await sha256Hex(signedItem)}`;
}

export async function saveOfflinePunch(input: {
  clientPunchId: string;
  method: "qr" | "face";
  evidence: CardEvidence | FaceEvidence;
  challenge?: string;
  location: LocationReport;
  settings: KioskOfflineSettings | undefined;
  offlineReady: boolean;
}): Promise<SaveOutcome> {
  const { settings } = input;
  if (!settings?.enabled) return "OFFLINE_NOT_READY";
  if (!input.offlineReady) return "OFFLINE_STORAGE_TOO_SMALL";
  const time = reportTime();
  const device = await loadDevice();
  if (!time || !device) return "OFFLINE_NOT_READY";
  const queued = await queueSummary();
  if (queued.count >= settings.max_items || queued.bytes >= settings.max_mb * 1024 * 1024) {
    return "QUEUE_FULL";
  }

  const kioskId = device.paired.kioskId;
  const counter = await takeNextCounter();
  const evidence = await sealEvidence(
    settings.evidence_public_key,
    settings.evidence_key_id,
    new TextEncoder().encode(JSON.stringify(input.evidence)),
    evidenceBinding(kioskId, input.clientPunchId, input.method, settings.evidence_key_id),
  );
  const signedItem = JSON.stringify({
    v: 1,
    client_punch_id: input.clientPunchId,
    method: input.method,
    ...(input.challenge ? { challenge: input.challenge } : {}),
    time,
    location: input.location,
    evidence,
    app_version: APP_VERSION,
  });
  const signature = await signText(await itemStatement(kioskId, counter, signedItem));
  await addToQueue({
    clientPunchId: input.clientPunchId,
    counter,
    method: input.method,
    signedItem,
    signature,
    bytes: signedItem.length,
    savedWallMs: Date.now(),
  });
  return "OFFLINE_SAVED";
}
