"""Geofence geometry: checking a drawn shape and measuring how far a point is from it.

Positions are WGS84 longitude/latitude (GeoJSON order: lon, lat). To measure in metres we
project them onto a flat plane centred on the plant ("local equirectangular projection"):

    x = (lon - lon0) * cos(lat0) * R * pi / 180      y = (lat - lat0) * R * pi / 180

Over a few kilometres (a plant and its gate) the error is far below GPS accuracy, so this
simple formula is enough and needs no map library (spec §7 rule 7).

A point is "inside" when its distance to the shape is at most the margin (buffer_m); a point
inside the shape has distance 0. M4 reuses distance_to_geofence_m() for every punch.
"""

import math
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from shapely.geometry import Point, Polygon

from app.core.errors import ApiError

EARTH_RADIUS_M = 6_371_008.8
MIN_POLYGON_POINTS = 3
MAX_POLYGON_POINTS = 200
MIN_AREA_M2 = 100
MAX_AREA_M2 = 2_000_000  # 2 km²: more than any one plant needs
MIN_RADIUS_M = 20
MAX_RADIUS_M = 1_000
MIN_BUFFER_M = 0
MAX_BUFFER_M = 200


@dataclass(frozen=True)
class CheckedShape:
    shape: str  # "polygon" or "circle"
    geojson: dict[str, Any]
    radius_m: Decimal | None


@dataclass(frozen=True)
class LocalProjection:
    """Turns lon/lat into metres around a reference point."""

    lon0: float
    lat0: float

    def to_metres(self, lon: float, lat: float) -> tuple[float, float]:
        metres_per_degree = EARTH_RADIUS_M * math.pi / 180
        x = (lon - self.lon0) * math.cos(math.radians(self.lat0)) * metres_per_degree
        y = (lat - self.lat0) * metres_per_degree
        return x, y


def check_shape(
    shape: str, geojson: dict[str, Any], radius_m: float | None, buffer_m: int
) -> CheckedShape:
    """Validate a drawn geofence; raises GEOFENCE_INVALID / _TOO_SMALL / _TOO_LARGE."""
    if not MIN_BUFFER_M <= buffer_m <= MAX_BUFFER_M:
        raise _invalid("margin_out_of_range")
    if shape == "polygon":
        return _check_polygon(geojson)
    if shape == "circle":
        return _check_circle(geojson, radius_m)
    raise _invalid("unknown_shape")


def distance_to_geofence_m(
    shape: str, geojson: dict[str, Any], radius_m: Decimal | float | None, lon: float, lat: float
) -> float:
    """Metres from the point to the shape's edge; 0 when the point is inside the shape."""
    if shape == "circle":
        centre_lon, centre_lat = geojson["coordinates"]
        projection = LocalProjection(centre_lon, centre_lat)
        distance_to_centre = Point(projection.to_metres(lon, lat)).distance(Point(0, 0))
        return max(0.0, distance_to_centre - float(radius_m or 0))

    ring = geojson["coordinates"][0]
    projection = _projection_for_ring(ring)
    polygon = Polygon([projection.to_metres(x, y) for x, y in ring])
    return polygon.distance(Point(projection.to_metres(lon, lat)))


def is_inside_geofence(
    shape: str,
    geojson: dict[str, Any],
    radius_m: Decimal | float | None,
    buffer_m: int,
    lon: float,
    lat: float,
) -> bool:
    return distance_to_geofence_m(shape, geojson, radius_m, lon, lat) <= buffer_m


def _check_polygon(geojson: dict[str, Any]) -> CheckedShape:
    if geojson.get("type") != "Polygon" or not geojson.get("coordinates"):
        raise _invalid("not_a_polygon")
    ring = [_valid_position(position) for position in geojson["coordinates"][0]]
    if len(ring) >= 2 and ring[0] != ring[-1]:
        ring.append(ring[0])  # close the ring if the drawing tool did not
    distinct_points = len(ring) - 1
    if distinct_points < MIN_POLYGON_POINTS:
        raise _invalid("too_few_points")
    if distinct_points > MAX_POLYGON_POINTS:
        raise _invalid("too_many_points")

    projection = _projection_for_ring(ring)
    polygon = Polygon([projection.to_metres(lon, lat) for lon, lat in ring])
    if not polygon.is_valid:
        raise _invalid("crosses_itself")
    if polygon.area < MIN_AREA_M2:
        raise ApiError("GEOFENCE_TOO_SMALL", "The shape is too small.", 422, {"min_m2": 100})
    if polygon.area > MAX_AREA_M2:
        raise ApiError("GEOFENCE_TOO_LARGE", "The shape is too large.", 422, {"max_m2": 2e6})
    return CheckedShape(
        shape="polygon",
        geojson={"type": "Polygon", "coordinates": [[list(point) for point in ring]]},
        radius_m=None,
    )


def _check_circle(geojson: dict[str, Any], radius_m: float | None) -> CheckedShape:
    if geojson.get("type") != "Point":
        raise _invalid("not_a_point")
    centre = _valid_position(geojson.get("coordinates"))
    if radius_m is None:
        raise _invalid("radius_missing")
    if radius_m < MIN_RADIUS_M:
        raise ApiError("GEOFENCE_TOO_SMALL", "The circle is too small.", 422, {"min_m": 20})
    if radius_m > MAX_RADIUS_M:
        raise ApiError("GEOFENCE_TOO_LARGE", "The circle is too large.", 422, {"max_m": 1000})
    return CheckedShape(
        shape="circle",
        geojson={"type": "Point", "coordinates": list(centre)},
        radius_m=Decimal(str(round(radius_m, 1))),
    )


def _valid_position(position: Any) -> tuple[float, float]:
    try:
        lon, lat = float(position[0]), float(position[1])
    except TypeError, ValueError, IndexError:
        raise _invalid("bad_position") from None
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        raise _invalid("bad_position")
    return lon, lat


def _projection_for_ring(ring: list[Any]) -> LocalProjection:
    # The average corner is a good enough centre for a shape a few hundred metres wide.
    lons = [float(point[0]) for point in ring]
    lats = [float(point[1]) for point in ring]
    return LocalProjection(sum(lons) / len(lons), sum(lats) / len(lats))


def _invalid(reason: str) -> ApiError:
    return ApiError("GEOFENCE_INVALID", "The shape is not valid.", 422, {"reason": reason})
