import json

import pytest

from scripts.calibrate_face_embeddings import evaluate_dataset


def sample(identifier, identity, axis, quality=None):
    record = {
        "sample_id": identifier,
        "identity_id": identity,
        "embedding": [int(i == axis) for i in range(512)],
    }
    if quality is not None:
        record["quality_score"] = quality
    return record


def dataset():
    return {
        "templates": [sample("t-a", "a", 0, 0.9), sample("t-b", "b", 1, 0.9)],
        "queries": [
            sample("q-a", "a", 0),
            sample("q-b", "b", 1),
            sample("unknown", None, 2),
        ],
    }


def test_independent_synthetic_dataset_rates_and_private_output():
    report = evaluate_dataset(dataset(), [0.62], 0.06)
    result = report["results"][0]
    assert result["verification_fmr"]["trials"] == 4
    assert result["verification_fmr"]["rate"] == 0
    assert result["verification_fnmr"]["trials"] == 2
    assert result["verification_fnmr"]["rate"] == 0
    assert result["identification_unknown_false_positive"]["rate"] == 0
    assert result["identification_known_miss_or_wrong"]["rate"] == 0
    assert result["verification_fmr"]["wilson95"][1] > 0
    assert "q-a" not in json.dumps(report) and 'embedding"' not in json.dumps(report)


def test_low_quality_gallery_counts_rejections_without_hidden_drop():
    data = dataset()
    data["templates"][0]["quality_score"] = 0
    result = evaluate_dataset(data, [0.62], 0.06)["results"][0]
    assert result["verification_fnmr"]["rate"] == 0.5
    assert result["identification_known_miss_or_wrong"]["rate"] == 0.5


def test_threshold_sweep_does_not_modify_dataset():
    data = dataset()
    original = json.dumps(data)
    report = evaluate_dataset(data, [0.62, 1.0], 0.06)
    assert len(report["results"]) == 2
    assert report["results"][1]["verification_fnmr"]["rate"] == 1
    assert json.dumps(data) == original


def test_duplicate_samples_reject_split_leakage():
    data = dataset()
    data["queries"][0]["sample_id"] = "t-a"
    with pytest.raises(ValueError, match="Unique sample_id"):
        evaluate_dataset(data, [0.62], 0.06)


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -1, 2])
def test_invalid_threshold_rejected(value):
    with pytest.raises(ValueError, match="Thresholds"):
        evaluate_dataset(dataset(), [value], 0.06)


def test_unknown_gallery_label_requires_explicit_open_set_label():
    data = dataset()
    data["queries"][0]["identity_id"] = "not-enrolled"
    with pytest.raises(ValueError, match="Known queries"):
        evaluate_dataset(data, [0.62], 0.06)


def test_unknown_query_matching_known_identity_is_counted_as_false_accept():
    data = dataset()
    data["queries"][-1] = sample("unknown", None, 0)
    result = evaluate_dataset(data, [0.62], 0.06)["results"][0]
    assert result["identification_unknown_false_positive"]["errors"] == 1
    assert result["verification_fmr"]["errors"] == 1


def test_malformed_vector_error_never_echoes_private_input():
    data = dataset()
    data["queries"][0]["embedding"] = ["synthetic-private-value"]
    with pytest.raises(ValueError) as error:
        evaluate_dataset(data, [0.62], 0.06)
    assert "synthetic-private-value" not in str(error.value)
