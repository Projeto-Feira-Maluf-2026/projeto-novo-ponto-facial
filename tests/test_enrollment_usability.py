from types import SimpleNamespace

from app.models.enums import EnrollmentPose, EnrollmentState
from app.services.enrollment import FaceEnrollmentService


def _processed(
    *,
    yaw: float = 0.0,
    pitch: float = 0.0,
    face_area_ratio: float = 0.2,
    quality_score: float = 0.9,
) -> SimpleNamespace:
    return SimpleNamespace(
        inference=SimpleNamespace(
            pose=SimpleNamespace(yaw=yaw, pitch=pitch, roll=0.0),
        ),
        quality=SimpleNamespace(
            quality_score=quality_score,
            metrics=SimpleNamespace(face_area_ratio=face_area_ratio),
        ),
    )


def test_expected_side_pose_can_exceed_global_recognition_yaw() -> None:
    reasons = FaceEnrollmentService._effective_quality_reasons(
        EnrollmentPose.TURN_RIGHT,
        _processed(yaw=32.0),
        ["EXCESSIVE_YAW"],
    )

    assert reasons == []


def test_side_pose_that_is_too_far_gets_specific_feedback() -> None:
    reason = FaceEnrollmentService._pose_rejection(
        EnrollmentPose.TURN_RIGHT,
        _processed(yaw=48.0),
    )

    assert reason == "TURN_TOO_FAR"
    assert "Volte um pouco" in FaceEnrollmentService._instruction_for_pose(
        EnrollmentPose.TURN_RIGHT,
        reason,
    )


def test_quality_feedback_does_not_report_pose_as_centering_problem() -> None:
    state, instruction = FaceEnrollmentService._quality_instruction(
        ["EXCESSIVE_YAW"]
    )

    assert state == EnrollmentState.ALIGN_FACE
    assert instruction == "Reduza um pouco o movimento do rosto"


def test_final_frontal_capture_may_resemble_initial_frontal_capture() -> None:
    captures = [
        SimpleNamespace(
            request=SimpleNamespace(pose=EnrollmentPose.FRONTAL, step_index=0),
            perceptual_hash="0000000000000000",
        ),
        SimpleNamespace(
            request=SimpleNamespace(pose=EnrollmentPose.FRONTAL_FINAL, step_index=4),
            perceptual_hash="0000000000000000",
        ),
    ]

    FaceEnrollmentService._validate_perceptual_diversity(captures)


def test_enrollment_accepts_a_smaller_but_still_usable_face() -> None:
    reasons = FaceEnrollmentService._effective_quality_reasons(
        EnrollmentPose.FRONTAL,
        _processed(face_area_ratio=0.013),
        ["FACE_TOO_SMALL"],
    )

    assert reasons == []


def test_enrollment_keeps_rejecting_faces_below_the_distance_floor() -> None:
    reasons = FaceEnrollmentService._effective_quality_reasons(
        EnrollmentPose.FRONTAL,
        _processed(face_area_ratio=0.009),
        ["FACE_TOO_SMALL"],
    )

    assert reasons == ["FACE_TOO_SMALL"]


def test_enrollment_uses_its_own_quality_floor_for_challenging_cameras() -> None:
    reasons = FaceEnrollmentService._effective_quality_reasons(
        EnrollmentPose.FRONTAL,
        _processed(quality_score=0.49),
        ["LOW_OVERALL_QUALITY"],
    )

    assert reasons == []
