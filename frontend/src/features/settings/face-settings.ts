// How the face settings are shown (spec M3 §4.12, design gate C). The server keeps all of them in
// one group ("face"); the screen splits them into five sub-groups so they can be scanned.
import type { Setting } from "./use-settings";

export const FACE_SUBGROUPS = [
  {
    id: "matching",
    keys: [
      "face_match_threshold",
      "face_match_margin",
      "face_code_offer_floor",
      "face_duplicate_threshold",
    ],
  },
  {
    id: "liveness",
    keys: [
      "face_consistency_threshold",
      "face_antispoof_threshold",
      "face_min_yaw_degrees",
      "face_frontal_max_yaw_degrees",
      "face_challenge_steps",
    ],
  },
  {
    id: "quality",
    keys: ["face_min_face_px", "face_blur_min", "face_brightness_min"],
  },
  {
    id: "code",
    keys: [
      "face_code_match_threshold",
      "face_challenge_seconds",
      "face_code_entry_seconds",
      "face_code_max_tries",
    ],
  },
  {
    id: "hints",
    keys: ["face_reenrol_code_count", "face_reenrol_score_margin"],
  },
] as const;

export type FaceSubgroupId = (typeof FACE_SUBGROUPS)[number]["id"];

// The settings that the accuracy report of slice D gives a value for. They show "Report value"
// (or "No report yet"); the others are plain timings and limits.
export const REPORT_KEYS: ReadonlySet<string> = new Set([
  "face_match_threshold",
  "face_match_margin",
  "face_code_offer_floor",
  "face_duplicate_threshold",
  "face_consistency_threshold",
  "face_antispoof_threshold",
  "face_min_yaw_degrees",
  "face_blur_min",
  "face_code_match_threshold",
]);

/** A lower threshold lets more strangers through, so lowering one asks for care (spec §4.12). */
export function isThreshold(setting: Setting): boolean {
  return setting.group === "face" && setting.key.endsWith("_threshold");
}

/** The code-entry floor must stay below the match threshold (the server checks it too). */
export function floorIsAboveThreshold(floor: string, threshold: string): boolean {
  const low = Number(floor);
  const high = Number(threshold);
  return (
    floor !== "" && threshold !== "" && !Number.isNaN(low) && !Number.isNaN(high) && low >= high
  );
}
