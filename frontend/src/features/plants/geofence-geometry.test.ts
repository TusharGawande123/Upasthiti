// The geofence helpers: area, self-crossing, limits and the margin outline.
import { describe, expect, it } from "vitest";
import { analyseDraft, type Draft, marginOutline } from "./geofence-geometry";

// A square of about 100 m x 100 m near MIDC Waluj (0.0009 degrees is roughly 100 m).
function square(sizeDegrees: number): Draft {
  const lon = 75.2;
  const lat = 19.85;
  const ring = [
    [lon, lat],
    [lon + sizeDegrees, lat],
    [lon + sizeDegrees, lat + sizeDegrees],
    [lon, lat + sizeDegrees],
    [lon, lat],
  ];
  return { shape: "polygon", geojson: { type: "Polygon", coordinates: [ring] } };
}

describe("analyseDraft", () => {
  it("accepts a plant-sized polygon and counts its corners", () => {
    const result = analyseDraft(square(0.0009));

    expect(result.problem).toBeNull();
    expect(result.corners).toBe(4);
    expect(result.areaM2).toBeGreaterThan(8_000);
  });

  it("flags a tiny polygon and a huge one", () => {
    expect(analyseDraft(square(0.00005)).problem).toBe("too_small");
    expect(analyseDraft(square(0.02)).problem).toBe("too_large");
  });

  it("finds a bow-tie that crosses itself", () => {
    const bowTie: Draft = {
      shape: "polygon",
      geojson: {
        type: "Polygon",
        coordinates: [
          [
            [75.2, 19.85],
            [75.2009, 19.8509],
            [75.2009, 19.85],
            [75.2, 19.8509],
            [75.2, 19.85],
          ],
        ],
      },
    };

    const result = analyseDraft(bowTie);

    expect(result.problem).toBe("crosses_itself");
    expect(result.crossing).not.toBeNull();
  });

  it("checks the radius of a circle", () => {
    const point: GeoJSON.Point = { type: "Point", coordinates: [75.2, 19.85] };

    expect(analyseDraft({ shape: "circle", geojson: point, radius_m: 150 }).problem).toBeNull();
    expect(analyseDraft({ shape: "circle", geojson: point, radius_m: 5 }).problem).toBe(
      "radius_range",
    );
    expect(analyseDraft({ shape: "circle", geojson: point, radius_m: 5000 }).problem).toBe(
      "radius_range",
    );
  });
});

describe("marginOutline", () => {
  it("has no outline for a zero margin and a bigger one otherwise", () => {
    const draft = square(0.0009);

    expect(marginOutline(draft, 0)).toBeNull();
    expect(marginOutline(draft, 25)).not.toBeNull();
  });
});
