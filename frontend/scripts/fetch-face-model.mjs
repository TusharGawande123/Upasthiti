// Downloads MediaPipe's face landmark model into public/models/ before `npm run dev` and
// `npm run build` (spec M3 §13.1). The model only gives the person live pose hints in the browser;
// the server decides everything. It is served from our own site, never from a public CDN at run
// time, and is never committed (the folder is in .gitignore).
//
// The file is checked against a fixed sha256, so a changed or broken download stops the build.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const MODEL_SHA256 = "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff";
const FOLDER = fileURLToPath(new URL("../public/models/", import.meta.url));
const FILE = `${FOLDER}face_landmarker.task`;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

if (existsSync(FILE) && sha256(readFileSync(FILE)) === MODEL_SHA256) {
  console.log("Face guide model already present.");
  process.exit(0);
}

const response = await fetch(MODEL_URL);
if (!response.ok) {
  console.error(`Face guide model download failed: HTTP ${response.status}`);
  process.exit(1);
}
const bytes = Buffer.from(await response.arrayBuffer());
if (sha256(bytes) !== MODEL_SHA256) {
  console.error("Face guide model has the wrong sha256: refusing to use it.");
  process.exit(1);
}
mkdirSync(FOLDER, { recursive: true });
writeFileSync(FILE, bytes);
console.log(`Face guide model saved (${(bytes.length / 1024 / 1024).toFixed(1)} MB).`);
