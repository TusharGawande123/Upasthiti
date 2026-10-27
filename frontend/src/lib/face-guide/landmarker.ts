// Loads MediaPipe Face Landmarker in the browser and reads the faces in a video frame (spec M3
// §4.2, §4.9). Used only for live hints ("a little more to the left"); the server never sees or
// trusts what it finds. The library, its .wasm and the model are served from our own site, and
// loaded only when a face screen opens, so other pages stay small.
//
// If anything fails (old browser, slow phone, blocked WebAssembly) `loadFaceGuide` returns null
// and the screens fall back to the plain "Take shot" button (timed fallback, spec §4.2).
import { type FaceMarks, LANDMARK_INDEX, type Measure, measure } from "./pose-estimate";

const MODEL_PATH = "/models/face_landmarker.task";
const MAX_FACES = 2; // two are enough to say "only one person, please"

export type FaceGuide = {
  /** The faces in the current video frame (empty when none). */
  read: (video: HTMLVideoElement, timeMs: number) => Measure[];
  close: () => void;
};

type Landmark = { x: number; y: number };

function pick(landmarks: Landmark[]): FaceMarks | null {
  const point = (index: number) => landmarks[index];
  const leftEyeOuter = point(LANDMARK_INDEX.leftEyeOuter);
  const rightEyeOuter = point(LANDMARK_INDEX.rightEyeOuter);
  const noseTip = point(LANDMARK_INDEX.noseTip);
  const mouthCentre = point(LANDMARK_INDEX.mouthCentre);
  if (!leftEyeOuter || !rightEyeOuter || !noseTip || !mouthCentre) return null;
  return { leftEyeOuter, rightEyeOuter, noseTip, mouthCentre };
}

export async function loadFaceGuide(): Promise<FaceGuide | null> {
  try {
    const [vision, loader, binary] = await Promise.all([
      import("@mediapipe/tasks-vision"),
      import("@mediapipe/tasks-vision/vision_wasm_internal.js?url"),
      import("@mediapipe/tasks-vision/vision_wasm_internal.wasm?url"),
    ]);
    const landmarker = await vision.FaceLandmarker.createFromOptions(
      { wasmLoaderPath: loader.default, wasmBinaryPath: binary.default },
      {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: "CPU" },
        runningMode: "VIDEO",
        numFaces: MAX_FACES,
      },
    );
    let lastTime = -1;
    return {
      read: (video, timeMs) => {
        // MediaPipe needs a strictly growing timestamp for each frame.
        const time = Math.max(timeMs, lastTime + 1);
        lastTime = time;
        const result = landmarker.detectForVideo(video, time);
        return result.faceLandmarks
          .map((landmarks) => pick(landmarks))
          .filter((marks): marks is FaceMarks => marks !== null)
          .map(measure);
      },
      close: () => landmarker.close(),
    };
  } catch {
    return null;
  }
}
