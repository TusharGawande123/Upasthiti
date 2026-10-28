// The gate device's own memory (IndexedDB through Dexie): its private key, its public key,
// once paired, which kiosk it is, and (M4) the last server time anchor and the punches saved while
// offline. The private key is a WebCrypto key made with
// `extractable: false`, so even code running on this page can use it to sign but never read it.
import Dexie, { type Table } from "dexie";

export type PairedKiosk = {
  kioskId: string;
  kioskName: string;
  plantId: string;
  plantCode: string;
  plantName: string;
  // How accurate the location was when pairing (shown on the paired screen).
  accuracyM: number | null;
};

export type StoredDevice = {
  id: "this-device"; // there is only ever one row
  privateKey: CryptoKey;
  publicKeySpki: string;
  paired: PairedKiosk;
  // The last request counter used. The server only accepts a bigger one next time.
  counter: number;
};

/** A punch saved while offline (M4 spec §6): only its signed, sealed form is kept. */
export type QueuedPunch = {
  clientPunchId: string;
  counter: number;
  method: "qr" | "face";
  /** The exact JSON text the device signed; the evidence inside is sealed for the server. */
  signedItem: string;
  signature: string;
  bytes: number;
  /** The device clock when it was saved: only for the "waiting since" line on the screen. */
  savedWallMs: number;
};

class KioskDatabase extends Dexie {
  device!: Table<StoredDevice, string>;
  queue!: Table<QueuedPunch, string>;

  constructor() {
    super("upasthiti-kiosk");
    this.version(1).stores({ device: "id" });
    // M4: punches saved while offline, sent oldest counter first.
    this.version(2).stores({ device: "id", queue: "clientPunchId, counter" });
  }
}

let database: KioskDatabase | null = null;

function db(): KioskDatabase {
  database ??= new KioskDatabase();
  return database;
}

export async function loadDevice(): Promise<StoredDevice | undefined> {
  return db().device.get("this-device");
}

export async function saveDevice(device: Omit<StoredDevice, "id">): Promise<void> {
  await db().device.put({ ...device, id: "this-device" });
}

export async function forgetDevice(): Promise<void> {
  // A forgotten (or re-paired) device can never send its saved punches: they go too.
  await db().transaction("rw", db().device, db().queue, async () => {
    await db().device.delete("this-device");
    await db().queue.clear();
  });
}

// --- Offline queue (M4 spec §7 rules 11 and 12) --------------------------------------------

export async function addToQueue(punch: QueuedPunch): Promise<void> {
  await db().queue.put(punch);
}

/** The oldest saved punches, at most `maxItems` and about `maxBytes` (always at least one). */
export async function oldestQueued(maxItems: number, maxBytes: number): Promise<QueuedPunch[]> {
  const picked: QueuedPunch[] = [];
  let bytes = 0;
  await db()
    .queue.orderBy("counter")
    .until(() => picked.length >= maxItems)
    .each((punch) => {
      if (picked.length > 0 && bytes + punch.bytes > maxBytes) return;
      picked.push(punch);
      bytes += punch.bytes;
    });
  return picked;
}

export async function removeFromQueue(clientPunchIds: string[]): Promise<void> {
  await db().queue.bulkDelete(clientPunchIds);
}

export async function clearQueue(): Promise<void> {
  await db().queue.clear();
}

export type QueueSummary = { count: number; bytes: number; oldestSavedWallMs: number | null };

/** Counts and times only, never contents (for the screen and the heartbeat). */
export async function queueSummary(): Promise<QueueSummary> {
  let count = 0;
  let bytes = 0;
  let oldest: number | null = null;
  await db().queue.each((punch) => {
    count += 1;
    bytes += punch.bytes;
    oldest = oldest === null ? punch.savedWallMs : Math.min(oldest, punch.savedWallMs);
  });
  return { count, bytes, oldestSavedWallMs: oldest };
}

/** Reserves the next request counter. Done inside a transaction so two requests never share one. */
export async function takeNextCounter(): Promise<number> {
  return db().transaction("rw", db().device, async () => {
    const device = await db().device.get("this-device");
    if (!device) throw new Error("This device is not paired.");
    const next = device.counter + 1;
    await db().device.update("this-device", { counter: next });
    return next;
  });
}
