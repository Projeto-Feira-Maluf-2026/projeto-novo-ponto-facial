from app.services.geofencing import distance_meters, is_inside_geofence


def test_distance_meters_for_nearby_points() -> None:
    distance = distance_meters(-25.443, -49.287, -25.4435, -49.2875)
    assert 60 <= distance <= 90


def test_inside_geofence() -> None:
    inside, distance = is_inside_geofence(-25.443, -49.287, -25.4435, -49.2875, 120)
    assert inside is True
    assert distance is not None


def test_outside_geofence() -> None:
    inside, distance = is_inside_geofence(-25.443, -49.287, -25.46, -49.30, 120)
    assert inside is False
    assert distance is not None

