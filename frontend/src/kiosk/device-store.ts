// The gate device's own memory (IndexedDB through Dexie): its private key, its public key and,
// once paired, which kiosk it is. The private key is a WebCrypto key made with
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

class KioskDatabase extends Dexie {
  device!: Table<StoredDevice, string>;

  constructor() {
    super("upasthiti-kiosk");
    this.version(1).stores({ device: "id" });
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
  await db().device.delete("this-device");
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
