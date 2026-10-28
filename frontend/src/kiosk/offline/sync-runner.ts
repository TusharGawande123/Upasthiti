// Sending the saved punches when the internet is back (M4 spec §7 rule 11).
// Up to 20 punches (about 1 MB) per signed request, oldest first. The server answers each one:
// "saved", "already_saved" or "refused" -> the device deletes it; "retry_later" -> it stays.
// The device never learns names or IN/OUT for its saved punches (the worker left long ago).
import { ApiError } from "@/lib/api-client";
import { oldestQueued, removeFromQueue } from "../device-store";
import { signedRequest } from "../signer";

export const SYNC_MAX_ITEMS = 20;
export const SYNC_MAX_BYTES = 900_000;

type SyncResult = {
  client_punch_id: string | null;
  result: "saved" | "already_saved" | "retry_later" | "refused";
};

export type SyncRound =
  | { kind: "sent"; done: number; kept: number }
  | { kind: "empty" }
  | { kind: "offline" }
  | { kind: "revoked" }
  | { kind: "not-available" }; // an older server without /kiosk/sync (during a deploy)

export async function syncOnce(
  limits: { maxItems: number; maxBytes: number } = {
    maxItems: SYNC_MAX_ITEMS,
    maxBytes: SYNC_MAX_BYTES,
  },
): Promise<SyncRound> {
  const batch = await oldestQueued(limits.maxItems, limits.maxBytes);
  if (batch.length === 0) return { kind: "empty" };
  try {
    const answer = await signedRequest<{ results: SyncResult[] }>("POST", "/kiosk/sync", {
      items: batch.map((punch) => ({
        counter: punch.counter,
        signed_item: punch.signedItem,
        signature: punch.signature,
      })),
    });
    // The answers come in the order the items were sent.
    const finished = batch
      .filter((_, index) => answer.results[index]?.result !== "retry_later")
      .map((punch) => punch.clientPunchId);
    await removeFromQueue(finished);
    return { kind: "sent", done: finished.length, kept: batch.length - finished.length };
  } catch (error) {
    if (error instanceof ApiError && error.code === "DEVICE_REVOKED") return { kind: "revoked" };
    if (
      error instanceof ApiError &&
      (error.status === 404 || error.code === "OFFLINE_NOT_CONFIGURED")
    ) {
      return { kind: "not-available" };
    }
    return { kind: "offline" };
  }
}
