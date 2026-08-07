from math import asin, cos, radians, sin, sqrt


EARTH_RADIUS_METERS = 6_371_000


def distance_meters(
    origin_latitude: float,
    origin_longitude: float,
    point_latitude: float,
    point_longitude: float,
) -> float:
    dlat = radians(point_latitude - origin_latitude)
    dlon = radians(point_longitude - origin_longitude)
    lat1 = radians(origin_latitude)
    lat2 = radians(point_latitude)
    haversine = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_METERS * asin(sqrt(haversine))


def is_inside_geofence(
    origin_latitude: float | None,
    origin_longitude: float | None,
    point_latitude: float | None,
    point_longitude: float | None,
    radius_meters: int,
) -> tuple[bool, float | None]:
    if None in {origin_latitude, origin_longitude, point_latitude, point_longitude}:
        return True, None
    distance = distance_meters(
        float(origin_latitude),
        float(origin_longitude),
        float(point_latitude),
        float(point_longitude),
    )
    return distance <= radius_meters, distance

