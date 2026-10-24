// A small drawing of each enrolment pose (gate B mockup): a head-and-shoulders figure as the
// employee sees themselves in the mirrored preview, with an arrow for the movement. Drawn, not a
// photo, so no real person is shown.
import type { Pose } from "./use-face";

const INK = "#1a3282";
const ARROW = {
  fill: "none",
  stroke: "#1f3a93",
  strokeWidth: 3.2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

// How the head moves inside the 96 × 96 picture for each pose.
const SHAPES: Record<Pose, { dx: number; dy: number; eyeShift: number }> = {
  straight: { dx: 0, dy: 0, eyeShift: 0 },
  left: { dx: -9, dy: 0, eyeShift: 0 },
  right: { dx: 9, dy: 0, eyeShift: 0 },
  up: { dx: 0, dy: -4, eyeShift: -2 },
  down: { dx: 0, dy: 5, eyeShift: 2 },
};

const ARROWS: Partial<Record<Pose, string>> = {
  left: "M20 14 H6 M12 8 L6 14 L12 20",
  right: "M76 14 H90 M84 8 L90 14 L84 20",
  up: "M80 30 V10 M73 17 L80 10 L87 17",
  down: "M80 10 V30 M73 23 L80 30 L87 23",
};

export function PosePicture({ pose, className }: { pose: Pose; className?: string }) {
  const { dx, dy, eyeShift } = SHAPES[pose];
  const centreX = 48 + dx;
  const centreY = 42 + dy;
  const eyeY = centreY - 4 + eyeShift;
  const eyeX = 6.5;
  const noseX = centreX + dx * 0.5;
  const arrow = ARROWS[pose];
  return (
    <svg viewBox="0 0 96 96" className={className} aria-hidden="true">
      <path d="M12 96 C12 76 28 70 48 70 C68 70 84 76 84 96 Z" fill="#b9c6ef" />
      <ellipse
        cx={centreX}
        cy={centreY}
        rx={16}
        ry={20}
        fill="#fff"
        stroke={INK}
        strokeWidth={2.4}
      />
      <circle cx={centreX - eyeX + dx * 0.4} cy={eyeY} r={2} fill={INK} />
      <circle cx={centreX + eyeX + dx * 0.4} cy={eyeY} r={2} fill={INK} />
      <path
        d={`M${noseX} ${eyeY + 3} l-2 7 h4`}
        fill="none"
        stroke={INK}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={`M${centreX - 6 + dx * 0.3} ${centreY + 12} q6 3.5 12 0`}
        fill="none"
        stroke={INK}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      {arrow ? <path d={arrow} {...ARROW} /> : null}
    </svg>
  );
}
