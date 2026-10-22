// Which camera this device uses for reading cards and for the photo (front or back). The choice is
// kept on the device, so whoever sets up the gate phone or tablet picks it once.
import type { Facing } from "./camera";

export type CameraTask = "scan" | "photo";

const KEY_PREFIX = "upasthiti.camera.";

/** The front camera is the default for both: it is right for a tablet or PC fixed at the gate. */
export function loadFacing(task: CameraTask): Facing {
  try {
    return localStorage.getItem(KEY_PREFIX + task) === "environment" ? "environment" : "user";
  } catch {
    return "user";
  }
}

export function saveFacing(task: CameraTask, facing: Facing): void {
  try {
    localStorage.setItem(KEY_PREFIX + task, facing);
  } catch {
    // Private mode or blocked storage: the choice just lasts until the page is reloaded.
  }
}
