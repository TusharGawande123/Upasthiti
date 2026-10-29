// "Why paused?" (F-53, design gate A): the small drawing of the plant fence, its margin and this
// device's position. The drawing works for a circle and for a polygon, and its sentence says how
// far outside the device is, or how weak its signal is.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { GateFence } from "./fence-distance";
import { FenceSketch } from "./fence-sketch";

const CIRCLE: GateFence = {
  version_id: "g-1",
  shape: "circle",
  geojson: { type: "Point", coordinates: [75.25, 19.85] },
  radius_m: 120,
  buffer_m: 25,
};
const SQUARE: GateFence = {
  version_id: "g-2",
  shape: "polygon",
  geojson: {
    type: "Polygon",
    coordinates: [
      [
        [75.248, 19.848],
        [75.252, 19.848],
        [75.252, 19.852],
        [75.248, 19.852],
        [75.248, 19.848],
      ],
    ],
  },
  radius_m: null,
  buffer_m: 25,
};
// About 220 m north of the circle's centre: outside the drawn circle and its margin.
const OUTSIDE = { lat: 19.852, lon: 75.25, accuracyM: 15, atMs: 0 };

describe("the fence drawing", () => {
  it("says how far outside the fence a circle-fenced device is", () => {
    const { container } = render(
      <FenceSketch
        fence={CIRCLE}
        reading={OUTSIDE}
        distanceM={101}
        accuracyLimitM={50}
        weak={false}
      />,
    );

    expect(screen.getByRole("img", { name: /101 m/ })).toBeInTheDocument();
    expect(container.querySelectorAll("circle").length).toBe(5); // margin, fence, accuracy, limit, dot
    expect(container.querySelector("polygon")).toBeNull();
  });

  it("draws a polygon fence with its margin", () => {
    const { container } = render(
      <FenceSketch
        fence={SQUARE}
        reading={OUTSIDE}
        distanceM={null}
        accuracyLimitM={50}
        weak={false}
      />,
    );

    expect(container.querySelectorAll("polygon").length).toBe(2); // margin band and the fence
    expect(screen.getByRole("img", { name: /0 m/ })).toBeInTheDocument(); // unknown distance
  });

  it("explains a weak signal with the accuracy now and the accuracy needed", () => {
    render(
      <FenceSketch
        fence={CIRCLE}
        reading={{ ...OUTSIDE, lat: 19.85, accuracyM: 80 }}
        distanceM={0}
        accuracyLimitM={50}
        weak
      />,
    );

    const drawing = screen.getByRole("img");
    expect(drawing.getAttribute("aria-label")).toMatch(/80/);
    expect(drawing.getAttribute("aria-label")).toMatch(/50/);
  });
});
