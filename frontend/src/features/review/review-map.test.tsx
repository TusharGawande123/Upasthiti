// The map of one punch (spec M4 §4.8): fence version with margin, the punch point and its accuracy
// circle, two numbered points for a travel flag, the Map / Satellite choice and what happens when
// the map cannot be drawn. Leaflet itself is real (jsdom); only a failing shape is faked.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import L from "leaflet";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewMap } from "./review-map";

const CIRCLE = {
  shape: "circle" as const,
  geojson: { type: "Point" as const, coordinates: [75.2, 19.85] },
  radius_m: 120,
};
const SQUARE = {
  shape: "polygon" as const,
  geojson: {
    type: "Polygon" as const,
    coordinates: [
      [
        [75.198, 19.848],
        [75.202, 19.848],
        [75.202, 19.852],
        [75.198, 19.852],
        [75.198, 19.848],
      ],
    ],
  },
};

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("the review map", () => {
  it("draws a circle fence with its margin and one punch point", () => {
    const { container } = render(
      <ReviewMap
        fence={CIRCLE}
        marginM={25}
        points={[{ lat: 19.8512, lon: 75.2, accuracy_m: 12 }]}
        label="Where the punch was made"
      />,
    );

    expect(screen.getByRole("img", { name: "Where the punch was made" })).toBeInTheDocument();
    expect(container.querySelectorAll("path.leaflet-interactive, path").length).toBeGreaterThan(1);
    expect(screen.getByText(/OpenStreetMap/)).toBeInTheDocument();
  });

  it("draws a polygon fence and two numbered points for a travel flag", () => {
    const { container } = render(
      <ReviewMap
        fence={SQUARE}
        marginM={0}
        points={[
          { lat: 19.85, lon: 75.2, accuracy_m: 10, number: 2 },
          { lat: 19.8716, lon: 75.2, accuracy_m: null, number: 1 },
        ]}
        label="Both punches"
      />,
    );

    const numbers = [...container.querySelectorAll(".leaflet-marker-icon")].map(
      (marker) => marker.textContent,
    );
    expect(numbers.sort()).toEqual(["1", "2"]);
  });

  it("opens on the plant area when there is no fence and no point", () => {
    render(<ReviewMap fence={null} marginM={0} points={[]} label="Empty map" />);

    expect(screen.getByRole("img", { name: "Empty map" })).toBeInTheDocument();
  });

  it("starts at the first point when there is no fence", () => {
    render(
      <ReviewMap
        fence={null}
        marginM={0}
        points={[{ lat: 19.9, lon: 75.3, accuracy_m: 20 }]}
        label="Point only"
      />,
    );

    expect(screen.getByRole("img", { name: "Point only" })).toBeInTheDocument();
  });

  it("switches to the satellite picture, keeps the choice and credits Esri", async () => {
    const user = userEvent.setup();
    render(<ReviewMap fence={CIRCLE} marginM={25} points={[]} label="Map" />);
    expect(screen.getByRole("button", { name: "Map" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Satellite" }));

    expect(screen.getByRole("button", { name: "Satellite" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText(/Esri/)).toBeInTheDocument();
    expect(localStorage.getItem("upasthiti.map.layer")).toBe("satellite");
    await user.click(screen.getByRole("button", { name: "Map" }));
    expect(localStorage.getItem("upasthiti.map.layer")).toBe("map");
    expect(screen.getByText(/OpenStreetMap/)).toBeInTheDocument();
  });

  it("opens on the satellite picture when that was chosen before", () => {
    localStorage.setItem("upasthiti.map.layer", "satellite");

    render(<ReviewMap fence={CIRCLE} marginM={25} points={[]} label="Map" />);

    expect(screen.getByRole("button", { name: "Satellite" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("copes with blocked storage", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const user = userEvent.setup();

    render(<ReviewMap fence={CIRCLE} marginM={25} points={[]} label="Map" />);
    await user.click(screen.getByRole("button", { name: "Satellite" }));

    expect(screen.getByRole("button", { name: "Satellite" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("says so when the map cannot be drawn (the facts are written under the map)", () => {
    vi.spyOn(L, "circle").mockImplementation(() => {
      throw new Error("no map");
    });

    render(<ReviewMap fence={CIRCLE} marginM={25} points={[]} label="Broken map" />);

    expect(
      screen.getByText("The map could not be drawn. The distance is written below."),
    ).toBeVisible();
  });
});
