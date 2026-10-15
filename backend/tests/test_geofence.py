"""Geofence checks and distances (spec §7 rule 7, AC-7, AC-8)."""

import math

import pytest

from app.core.errors import ApiError
from app.modules.org.geofence import (
    EARTH_RADIUS_M,
    check_shape,
    distance_to_geofence_m,
    is_inside_geofence,
)

# Near MIDC Waluj (fake shape, not a real plant boundary).
LON0, LAT0 = 75.2190, 19.8400
METRES_PER_DEGREE_LAT = EARTH_RADIUS_M * math.pi / 180
METRES_PER_DEGREE_LON = METRES_PER_DEGREE_LAT * math.cos(math.radians(LAT0))


def offset(east_m: float, north_m: float) -> list[float]:
    """A position `east_m` metres east and `north_m` metres north of the reference."""
    return [LON0 + east_m / METRES_PER_DEGREE_LON, LAT0 + north_m / METRES_PER_DEGREE_LAT]


def square(size_m: float) -> dict:
    corners = [offset(0, 0), offset(size_m, 0), offset(size_m, size_m), offset(0, size_m)]
    return {"type": "Polygon", "coordinates": [[*corners, corners[0]]]}


def test_margin_decides_inside_or_outside() -> None:
    shape = check_shape("polygon", square(100), None, buffer_m=25)
    inside, twenty_out, forty_out = offset(50, 50), offset(120, 50), offset(140, 50)

    results = [
        is_inside_geofence(shape.shape, shape.geojson, None, 25, lon, lat)
        for lon, lat in (inside, twenty_out, forty_out)
    ]

    assert results == [True, True, False]


def test_distance_is_measured_in_metres() -> None:
    shape = check_shape("polygon", square(100), None, buffer_m=0)
    lon, lat = offset(140, 50)

    assert distance_to_geofence_m(shape.shape, shape.geojson, None, lon, lat) == pytest.approx(
        40, abs=0.5
    )


def test_circle_distance() -> None:
    shape = check_shape("circle", {"type": "Point", "coordinates": offset(0, 0)}, 100, 0)
    lon, lat = offset(130, 0)

    assert distance_to_geofence_m(
        shape.shape, shape.geojson, shape.radius_m, lon, lat
    ) == pytest.approx(30, abs=0.5)


def test_open_ring_is_closed_automatically() -> None:
    corners = square(100)["coordinates"][0][:-1]

    shape = check_shape("polygon", {"type": "Polygon", "coordinates": [corners]}, None, 25)

    ring = shape.geojson["coordinates"][0]
    assert ring[0] == ring[-1]


@pytest.mark.parametrize(
    ("shape", "geojson", "radius", "buffer", "code", "reason"),
    [
        # A "bow tie": the edges cross each other.
        (
            "polygon",
            {
                "type": "Polygon",
                "coordinates": [[offset(0, 0), offset(100, 100), offset(100, 0), offset(0, 100)]],
            },
            None,
            25,
            "GEOFENCE_INVALID",
            "crosses_itself",
        ),
        (
            "polygon",
            {"type": "Polygon", "coordinates": [[offset(0, 0), offset(50, 0)]]},
            None,
            25,
            "GEOFENCE_INVALID",
            "too_few_points",
        ),
        ("polygon", square(5), None, 25, "GEOFENCE_TOO_SMALL", None),
        ("polygon", square(2000), None, 25, "GEOFENCE_TOO_LARGE", None),
        ("polygon", square(100), None, 500, "GEOFENCE_INVALID", "margin_out_of_range"),
        (
            "circle",
            {"type": "Point", "coordinates": offset(0, 0)},
            5,
            25,
            "GEOFENCE_TOO_SMALL",
            None,
        ),
        (
            "circle",
            {"type": "Point", "coordinates": [500, 20]},
            100,
            25,
            "GEOFENCE_INVALID",
            "bad_position",
        ),
        ("triangle", {}, None, 25, "GEOFENCE_INVALID", "unknown_shape"),
    ],
)
def test_bad_shapes_are_refused(
    shape: str, geojson: dict, radius: float | None, buffer: int, code: str, reason: str | None
) -> None:
    with pytest.raises(ApiError) as refused:
        check_shape(shape, geojson, radius, buffer)

    assert refused.value.code == code
    if reason:
        assert refused.value.details["reason"] == reason
