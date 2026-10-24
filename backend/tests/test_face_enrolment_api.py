"""Face enrolment, the face panel, progress and the hooks that delete face data (spec M3 AC-5 to
AC-8, AC-19, AC-22, AC-25, AC-35, AC-36). The fake face engine reads painted test pictures."""

import base64
import uuid
from datetime import timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.crypto import (
    FaceDecryptionError,
    SealedVector,
    decode_key,
    open_vector,
    template_binding,
)
from app.core.time import today_ist, utc_now
from app.face.engine import FaceEngine
from app.face.fake_engine import Problem, fake_embedding
from app.face.matcher import cosine
from app.modules.audit.models import AuditLog
from app.modules.employees.models import Employee
from app.modules.face import gallery_cache
from app.modules.face.cleanup import run_face_cleanup
from app.modules.face.engine_provider import get_face_engine
from app.modules.face.models import (
    FaceConsent,
    FaceEnrolmentSession,
    FaceEnrolmentShot,
    FaceTemplate,
)
from app.modules.users.models import Role, User
from app.modules.users.plant_access import set_user_plant
from tests.face_helpers import POSE_FRAMES, enrol, new_employee, set_privacy, shot, start
from tests.people_helpers import PlantIds, client_for, create_plant


@pytest.fixture
def boss(db_app: FastAPI, db_session: Session) -> TestClient:
    set_privacy(db_session)
    return client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")


@pytest.fixture
def k134(boss: TestClient, db_session: Session) -> PlantIds:
    return create_plant(boss, db_session, "K134")


def face_key() -> bytes:
    key = get_settings().face_template_key
    assert key is not None
    return decode_key(key.get_secret_value())


def test_a_shot_restarts_the_one_hour_idle_clock(
    boss: TestClient, db_session: Session, k134: PlantIds
) -> None:
    session_id = start(boss, new_employee(boss, k134))
    row = db_session.get(FaceEnrolmentSession, uuid.UUID(session_id))
    assert row is not None
    row.expires_at = utc_now() + timedelta(minutes=5)  # nearly idle for an hour
    db_session.commit()

    shot(boss, session_id, "straight", person=8)

    db_session.refresh(row)
    assert row.expires_at > utc_now() + timedelta(minutes=55)


def head_of(db_app: FastAPI, db_session: Session, plant: PlantIds) -> TestClient:
    head = client_for(db_app, db_session, Role.PLANT_HEAD, "plant.head")
    user = db_session.scalars(select(User).where(User.username == "plant.head")).one()
    set_user_plant(db_session, user, uuid.UUID(plant.id))
    db_session.commit()
    return head


# --- A full enrolment (AC-6) -----------------------------------------------------------------


def test_five_good_shots_make_one_encrypted_template(
    boss: TestClient, db_session: Session, k134: PlantIds
) -> None:
    employee_id = new_employee(boss, k134)
    session_id = start(boss, employee_id)

    answers = [shot(boss, session_id, pose, person=3).json() for pose in POSE_FRAMES]
    finished = boss.post(f"/api/v1/face/enrolment-sessions/{session_id}/finish", json={})

    assert [answer["accepted"] for answer in answers] == [True] * 5
    assert [answer["shots_done"] for answer in answers] == list(range(1, 6))
    assert answers[0]["next_pose"] == "left" and answers[-1]["next_pose"] is None
    assert answers[0]["quality"]["face_px"] == 240
    assert finished.status_code == 201, finished.text
    assert finished.json()["template"]["shot_count"] == 5
    assert finished.json()["replaced_previous"] is False

    template = db_session.scalars(select(FaceTemplate)).one()
    assert template.nonce is not None and template.ciphertext is not None
    sealed = SealedVector(template.nonce, template.ciphertext)
    vector = open_vector(sealed, template_binding(uuid.UUID(employee_id), "fake/fake"), face_key())
    assert cosine(vector, fake_embedding(3)) == pytest.approx(1.0, abs=1e-4)
    with pytest.raises(FaceDecryptionError):  # not readable as another employee's template
        open_vector(sealed, template_binding(uuid.uuid4(), "fake/fake"), face_key())
    # The shots are gone; the session is a small trail without face data.
    assert db_session.scalars(select(FaceEnrolmentShot)).all() == []
    row = db_session.get(FaceEnrolmentSession, uuid.UUID(session_id))
    assert row is not None and row.state == "finished" and row.finished_template_id == template.id


def test_the_face_panel_shows_the_state_but_never_the_template(
    boss: TestClient, k134: PlantIds
) -> None:
    employee_id = new_employee(boss, k134)
    before = boss.get(f"/api/v1/employees/{employee_id}/face").json()
    assert before["face_state"] == "not_enrolled" and before["template"] is None
    assert before["consent"]["choice"] == "agreed"

    enrol(boss, employee_id, person=4)
    after = boss.get(f"/api/v1/employees/{employee_id}/face")

    body = after.json()
    assert body["face_state"] == "enrolled"
    assert body["template"]["model_id"] == "fake/fake" and body["template"]["enrolled_by"]["name"]
    assert [item["kind"] for item in body["history"]] == ["enrolled", "consent_given"]
    assert "ciphertext" not in after.text and "nonce" not in after.text


def test_re_enrolling_replaces_the_old_template(
    boss: TestClient, db_session: Session, k134: PlantIds
) -> None:
    employee_id = new_employee(boss, k134)
    enrol(boss, employee_id, person=5)

    again = enrol(boss, employee_id, person=5)  # the same person is not a duplicate of themself

    assert again.status_code == 201 and again.json()["replaced_previous"] is True
    kinds = [t.delete_kind for t in db_session.scalars(select(FaceTemplate)).all()]
    assert sorted(kinds, key=str) == sorted([None, "re_enrolled"], key=str)


# --- Refused shots (AC-7) ----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("pose", "problem", "yaw", "pitch", "reason"),
    [
        ("left", Problem.TWO_FACES, None, None, "ENROL_MULTIPLE_FACES"),
        ("left", Problem.BLURRY, None, None, "ENROL_BLURRY"),
        ("left", Problem.DARK, None, None, "ENROL_TOO_DARK"),
        ("left", Problem.SMALL_FACE, None, None, "ENROL_FACE_TOO_SMALL"),
        ("left", Problem.SPOOF, None, None, "ENROL_SPOOF_SUSPECTED"),
        ("left", Problem.NONE, -20, None, "ENROL_POSE_WRONG"),  # turned the wrong way
        ("up", Problem.NONE, None, 0, "ENROL_POSE_WRONG"),  # chin not lifted
        ("down", Problem.NONE, None, 20, "ENROL_POSE_WRONG"),  # chin lifted, not lowered
    ],
)
def test_a_bad_shot_is_refused_with_its_reason_and_can_be_retaken(
    boss: TestClient,
    k134: PlantIds,
    pose: str,
    problem: Problem,
    yaw: float | None,
    pitch: float | None,
    reason: str,
) -> None:
    session_id = start(boss, new_employee(boss, k134))
    shot(boss, session_id, "straight", person=6)

    refused = shot(boss, session_id, pose, person=6, problem=problem, yaw=yaw, pitch=pitch)

    assert refused.status_code == 200
    assert refused.json()["accepted"] is False and refused.json()["reason_code"] == reason
    assert shot(boss, session_id, pose, person=6).json()["accepted"] is True


def test_another_person_in_a_later_shot_is_refused(boss: TestClient, k134: PlantIds) -> None:
    session_id = start(boss, new_employee(boss, k134))
    shot(boss, session_id, "straight", person=6)

    answer = shot(boss, session_id, "left", person=7).json()

    assert answer["reason_code"] == "ENROL_NOT_SAME_PERSON"


def test_shots_without_a_face_or_a_picture_are_refused(boss: TestClient, k134: PlantIds) -> None:
    session_id = start(boss, new_employee(boss, k134))

    assert shot(boss, session_id, "straight", person=0).json()["reason_code"] == "ENROL_NO_FACE"
    small = shot(boss, session_id, "straight", person=6, width=320, height=240).json()
    assert small["reason_code"] == "ENROL_IMAGE_INVALID"  # narrower than 480 px
    not_jpeg = boss.post(
        f"/api/v1/face/enrolment-sessions/{session_id}/shots",
        json={"pose": "straight", "image_jpeg": base64.b64encode(b"hello").decode()},
    )
    assert not_jpeg.json()["reason_code"] == "ENROL_IMAGE_INVALID"
    broken = boss.post(
        f"/api/v1/face/enrolment-sessions/{session_id}/shots",
        json={"pose": "straight", "image_jpeg": "***"},
    )
    assert broken.json()["error"]["code"] == "ENROL_IMAGE_INVALID"


def test_the_straight_shot_comes_first(boss: TestClient, k134: PlantIds) -> None:
    session_id = start(boss, new_employee(boss, k134))

    assert shot(boss, session_id, "left", person=6).json()["reason_code"] == "ENROL_POSE_WRONG"


def test_refused_shots_are_only_counted(
    boss: TestClient, db_session: Session, k134: PlantIds
) -> None:
    session_id = start(boss, new_employee(boss, k134))
    shot(boss, session_id, "straight", person=0)
    shot(boss, session_id, "straight", person=6)

    row = db_session.get(FaceEnrolmentSession, uuid.UUID(session_id))
    assert row is not None and (row.accepted_shots, row.refused_shots) == (1, 1)


def test_a_picture_over_the_limits_is_refused(boss: TestClient, k134: PlantIds) -> None:
    session_id = start(boss, new_employee(boss, k134))
    url = f"/api/v1/face/enrolment-sessions/{session_id}/shots"

    over_150_kb = base64.b64encode(b"\xff\xd8\xff" + b"0" * 160_000).decode()
    assert boss.post(url, json={"pose": "straight", "image_jpeg": over_150_kb}).status_code == 413
    huge_body = boss.post(
        url, content=b"x" * (300 * 1024), headers={"Content-Type": "application/json"}
    )
    assert huge_body.status_code == 413
    assert huge_body.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"


# --- Session rules (AC-5, AC-8) ----------------------------------------------------------------


def test_enrolment_needs_consent_a_face_method_and_an_active_employee(
    boss: TestClient, db_session: Session, k134: PlantIds
) -> None:
    no_consent = new_employee(boss, k134, code="1001", consent=False)
    response = boss.post(f"/api/v1/employees/{no_consent}/face/enrolment-sessions")
    assert response.json()["error"]["code"] == "CONSENT_REQUIRED"

    qr = new_employee(boss, k134, code="1002")
    stored = db_session.get(Employee, uuid.UUID(qr))
    assert stored is not None
    stored.punch_method = "qr"
    db_session.commit()
    response = boss.post(f"/api/v1/employees/{qr}/face/enrolment-sessions")
    assert response.json()["error"]["code"] == "EMPLOYEE_NOT_FACE"


@pytest.mark.parametrize("role", [Role.CORPORATE_HEAD, Role.PLANT_HEAD])
def test_only_the_super_admin_enrols_or_deletes_face_data(
    db_app: FastAPI, db_session: Session, boss: TestClient, k134: PlantIds, role: Role
) -> None:
    employee_id = new_employee(boss, k134)
    session_id = start(boss, employee_id)
    other = client_for(db_app, db_session, role, "someone")

    for url, body in (
        (f"/api/v1/employees/{employee_id}/face/enrolment-sessions", None),
        (
            f"/api/v1/face/enrolment-sessions/{session_id}/shots",
            {"pose": "straight", "image_jpeg": "x"},
        ),
        (f"/api/v1/face/enrolment-sessions/{session_id}/finish", {}),
        (f"/api/v1/face/enrolment-sessions/{session_id}/cancel", None),
        (f"/api/v1/employees/{employee_id}/face/template/delete", {"reason": "test"}),
    ):
        response = other.post(url, json=body)
        assert response.status_code == 403, url


def test_another_super_admin_cannot_use_my_session(
    db_app: FastAPI, db_session: Session, boss: TestClient, k134: PlantIds
) -> None:
    session_id = start(boss, new_employee(boss, k134))
    second = client_for(db_app, db_session, Role.SUPER_ADMIN, "second.boss")

    response = second.post(f"/api/v1/face/enrolment-sessions/{session_id}/finish", json={})

    assert response.json()["error"]["code"] == "ENROLMENT_SESSION_NOT_FOUND"


def test_finish_needs_all_five_shots(boss: TestClient, k134: PlantIds) -> None:
    session_id = start(boss, new_employee(boss, k134))
    for pose in list(POSE_FRAMES)[:4]:
        shot(boss, session_id, pose, person=8)

    response = boss.post(f"/api/v1/face/enrolment-sessions/{session_id}/finish", json={})

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "ENROLMENT_INCOMPLETE"


def test_a_new_session_cancels_the_open_one_and_deletes_its_shots(
    boss: TestClient, db_session: Session, k134: PlantIds
) -> None:
    employee_id = new_employee(boss, k134)
    first = start(boss, employee_id)
    shot(boss, first, "straight", person=8)

    start(boss, employee_id)

    assert db_session.get(FaceEnrolmentSession, uuid.UUID(first)).state == "cancelled"  # type: ignore[union-attr]
    assert db_session.scalars(select(FaceEnrolmentShot)).all() == []
    closed = shot(boss, first, "left", person=8)
    assert closed.json()["error"]["code"] == "ENROLMENT_SESSION_CLOSED"


def test_cancel_deletes_the_shots_and_can_be_repeated(
    boss: TestClient, db_session: Session, k134: PlantIds
) -> None:
    session_id = start(boss, new_employee(boss, k134))
    shot(boss, session_id, "straight", person=8)

    for _ in range(2):
        assert boss.post(f"/api/v1/face/enrolment-sessions/{session_id}/cancel").status_code == 204

    assert db_session.scalars(select(FaceEnrolmentShot)).all() == []
    missing = boss.post(f"/api/v1/face/enrolment-sessions/{uuid.uuid4()}/cancel")
    assert missing.json()["error"]["code"] == "ENROLMENT_SESSION_NOT_FOUND"


def test_an_expired_session_loses_its_shots(
    boss: TestClient, db_session: Session, k134: PlantIds
) -> None:
    session_id = start(boss, new_employee(boss, k134))
    shot(boss, session_id, "straight", person=8)
    row = db_session.get(FaceEnrolmentSession, uuid.UUID(session_id))
    assert row is not None
    row.started_at = utc_now() - timedelta(minutes=20)
    row.expires_at = utc_now() - timedelta(minutes=5)
    db_session.commit()

    response = shot(boss, session_id, "left", person=8)

    assert response.json()["error"]["code"] == "ENROLMENT_SESSION_EXPIRED"
    assert db_session.scalars(select(FaceEnrolmentShot)).all() == []


def test_the_cleanup_job_expires_old_sessions(
    boss: TestClient, db_session: Session, k134: PlantIds
) -> None:
    session_id = start(boss, new_employee(boss, k134))
    shot(boss, session_id, "straight", person=8)
    row = db_session.get(FaceEnrolmentSession, uuid.UUID(session_id))
    assert row is not None
    row.started_at = utc_now() - timedelta(minutes=20)
    row.expires_at = utc_now() - timedelta(minutes=5)
    db_session.commit()

    assert run_face_cleanup(db_session)["enrolment_sessions_expired"] == 1
    assert run_face_cleanup(db_session)["enrolment_sessions_expired"] == 0  # safe to repeat
    assert db_session.scalars(select(FaceEnrolmentShot)).all() == []


def test_consent_withdrawn_during_the_enrolment_stops_the_finish(
    boss: TestClient, db_session: Session, k134: PlantIds
) -> None:
    employee_id = new_employee(boss, k134)
    session_id = start(boss, employee_id)
    for pose in POSE_FRAMES:
        shot(boss, session_id, pose, person=9)
    boss.post(f"/api/v1/employees/{employee_id}/face/consent/withdraw", json={})

    response = boss.post(f"/api/v1/face/enrolment-sessions/{session_id}/finish", json={})

    # The withdrawal cancelled the session and deleted its shots at once.
    assert response.json()["error"]["code"] == "ENROLMENT_SESSION_CLOSED"
    assert db_session.scalars(select(FaceTemplate)).all() == []


def test_the_face_engine_must_be_ready(db_app: FastAPI, boss: TestClient, k134: PlantIds) -> None:
    employee_id = new_employee(boss, k134)
    db_app.dependency_overrides[get_face_engine] = lambda: FaceEngine(None)

    response = boss.post(f"/api/v1/employees/{employee_id}/face/enrolment-sessions")

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "FACE_SERVICE_UNAVAILABLE"


def test_too_many_shots_a_minute_are_refused(boss: TestClient, k134: PlantIds) -> None:
    session_id = start(boss, new_employee(boss, k134))
    for _ in range(60):
        shot(boss, session_id, "straight", person=0)

    assert shot(boss, session_id, "straight", person=8).status_code == 429


# --- Duplicate face (AC-35) --------------------------------------------------------------------


def test_the_same_face_under_another_code_is_blocked_then_overridden_with_a_reason(
    boss: TestClient, db_session: Session, k134: PlantIds
) -> None:
    first = new_employee(boss, k134, code="2001")
    enrol(boss, first, person=10)
    second = new_employee(boss, k134, code="2002")

    blocked = enrol(boss, second, person=10)

    assert blocked.status_code == 409
    error = blocked.json()["error"]
    assert error["code"] == "FACE_DUPLICATE_FOUND"
    assert error["details"]["matches"] == [
        {"employee_id": first, "employee_code": "2001", "name": "Worker 2001", "plant_code": "K134"}
    ]
    assert "score" not in blocked.text

    session_id = db_session.scalars(
        select(FaceEnrolmentSession.id).where(FaceEnrolmentSession.state == "open")
    ).one()
    overridden = boss.post(
        f"/api/v1/face/enrolment-sessions/{session_id}/finish",
        json={"duplicate_override_reason": "Twins, checked their ID cards"},
    )
    assert overridden.status_code == 201
    assert overridden.json()["template"]["duplicate_override"] is True
    stored = db_session.scalars(
        select(FaceTemplate).where(FaceTemplate.employee_id == uuid.UUID(second))
    ).one()
    assert stored.duplicate_of_employee_id == uuid.UUID(first)
    assert (
        db_session.scalars(
            select(AuditLog).where(AuditLog.action == "face_template.duplicate_override")
        )
        .one()
        .reason
        == "Twins, checked their ID cards"
    )


def test_a_short_override_reason_is_refused(boss: TestClient, k134: PlantIds) -> None:
    session_id = start(boss, new_employee(boss, k134))

    response = boss.post(
        f"/api/v1/face/enrolment-sessions/{session_id}/finish",
        json={"duplicate_override_reason": "twins"},
    )

    assert response.status_code == 422


# --- Deleting face data (AC-19, decision 0016 item 13) -----------------------------------------


def test_delete_face_data_keeps_the_consent(
    boss: TestClient, db_session: Session, k134: PlantIds
) -> None:
    employee_id = new_employee(boss, k134)
    enrol(boss, employee_id, person=11)
    url = f"/api/v1/employees/{employee_id}/face/template/delete"

    assert boss.post(url, json={"reason": "Bad enrolment"}).json() == {"template_deleted": True}

    panel = boss.get(f"/api/v1/employees/{employee_id}/face").json()
    assert panel["face_state"] == "not_enrolled" and panel["consent"]["choice"] == "agreed"
    template = db_session.scalars(select(FaceTemplate)).one()
    assert template.ciphertext is None and template.delete_kind == "deleted_by_admin"
    again = boss.post(url, json={"reason": "Bad enrolment"})
    assert again.json()["error"]["code"] == "FACE_NOT_ENROLLED"


def test_marking_as_left_deletes_the_template_and_closes_the_consent(
    boss: TestClient, db_session: Session, k134: PlantIds
) -> None:
    employee_id = new_employee(boss, k134)
    enrol(boss, employee_id, person=12)
    gallery_cache.remember_gallery(uuid.UUID(k134.id), "cached")

    response = boss.post(
        f"/api/v1/employees/{employee_id}/mark-left",
        json={"left_on": today_ist().isoformat(), "reason": "Resigned"},
    )

    assert response.status_code == 200, response.text
    db_session.expire_all()
    template = db_session.scalars(select(FaceTemplate)).one()
    assert template.ciphertext is None and template.nonce is None
    assert template.delete_kind == "left"
    consent = db_session.scalars(select(FaceConsent)).one()
    assert consent.withdraw_kind == "left" and consent.withdrawn_by is None
    assert uuid.UUID(k134.id) not in gallery_cache.cached_plants()
    rows = db_session.scalars(
        select(AuditLog).where(AuditLog.action.in_(["employee.mark_left", "face_template.delete"]))
    ).all()
    assert len(rows) == 2 and len({row.request_id for row in rows}) == 1


def test_changing_the_punch_method_to_qr_deletes_the_template(
    boss: TestClient, db_session: Session, k134: PlantIds
) -> None:
    employee_id = new_employee(boss, k134)
    enrol(boss, employee_id, person=13)

    response = boss.patch(
        f"/api/v1/employees/{employee_id}", json={"punch_method": "qr", "reason": "Asked"}
    )

    assert response.status_code == 200, response.text
    template = db_session.scalars(select(FaceTemplate)).one()
    assert template.ciphertext is None and template.delete_kind == "method_changed"
    assert db_session.scalars(select(FaceConsent)).one().withdrawn_at is None  # consent stays
    assert response.json()["face_state"] == "not_face_method"


def test_a_transfer_clears_both_plant_galleries(
    boss: TestClient, db_session: Session, k134: PlantIds
) -> None:
    tp1 = create_plant(boss, db_session, "TP1")
    employee_id = new_employee(boss, k134)
    gallery_cache.remember_gallery(uuid.UUID(k134.id), "cached")
    gallery_cache.remember_gallery(uuid.UUID(tp1.id), "cached")

    response = boss.post(
        f"/api/v1/employees/{employee_id}/transfer",
        json={
            "to_plant_id": tp1.id,
            "category_id": tp1.staff_id,
            "shift_id": tp1.shift_id,
            "effective_from": today_ist().isoformat(),
            "reason": "Moved",
        },
    )

    assert response.status_code == 200, response.text
    assert gallery_cache.cached_plants() == set()


# --- Lists and progress (AC-25, AC-36) ---------------------------------------------------------


def test_the_employees_list_shows_and_filters_the_face_state(
    boss: TestClient, k134: PlantIds
) -> None:
    enrolled = new_employee(boss, k134, code="3001")
    enrol(boss, enrolled, person=14)
    new_employee(boss, k134, code="3002")

    listed = boss.get("/api/v1/employees").json()["items"]
    states = {item["employee_code"]: item["face_state"] for item in listed}
    assert states == {"3001": "enrolled", "3002": "not_enrolled"}
    only_not = boss.get("/api/v1/employees", params={"face_state": "not_enrolled"}).json()
    assert [item["employee_code"] for item in only_not["items"]] == ["3002"]
    only_yes = boss.get("/api/v1/employees", params={"face_state": "enrolled"}).json()
    assert [item["employee_code"] for item in only_yes["items"]] == ["3001"]
    assert boss.get("/api/v1/employees", params={"face_state": "nonsense"}).status_code == 422


def test_progress_per_plant_and_the_plant_head_sees_only_their_own(
    db_app: FastAPI, db_session: Session, boss: TestClient, k134: PlantIds
) -> None:
    tp1 = create_plant(boss, db_session, "TP1")
    enrol(boss, new_employee(boss, k134, code="4001"), person=1)
    new_employee(boss, k134, code="4002")
    new_employee(boss, tp1, code="4003")

    progress = boss.get("/api/v1/face/enrolment-progress").json()

    by_plant = {row["plant"]["code"]: row for row in progress["plants"]}
    assert (by_plant["K134"]["face_employees"], by_plant["K134"]["enrolled"]) == (2, 1)
    assert by_plant["TP1"]["not_enrolled"] == 1
    assert progress["totals"] == {
        "face_employees": 3,
        "enrolled": 1,
        "not_enrolled": 2,
        "old_model": 0,
        "reenrol_suggested": 0,
    }
    head = head_of(db_app, db_session, tp1)
    assert [
        row["plant"]["code"] for row in head.get("/api/v1/face/enrolment-progress").json()["plants"]
    ] == ["TP1"]


def test_plant_and_corporate_heads_read_the_panel_but_not_other_plants(
    db_app: FastAPI, db_session: Session, boss: TestClient, k134: PlantIds
) -> None:
    tp1 = create_plant(boss, db_session, "TP1")
    employee_id = new_employee(boss, k134)
    enrol(boss, employee_id, person=2)

    corporate = client_for(db_app, db_session, Role.CORPORATE_HEAD, "corp")
    assert corporate.get(f"/api/v1/employees/{employee_id}/face").json()["face_state"] == "enrolled"
    head = head_of(db_app, db_session, tp1)
    hidden = head.get(f"/api/v1/employees/{employee_id}/face")
    assert hidden.json()["error"]["code"] == "EMPLOYEE_NOT_FOUND"


def test_a_template_of_another_model_shows_old_model(
    boss: TestClient, db_session: Session, k134: PlantIds
) -> None:
    employee_id = new_employee(boss, k134)
    enrol(boss, employee_id, person=3)
    template = db_session.scalars(select(FaceTemplate)).one()
    template.model_id = "buffalo_l/w600k_r50"
    db_session.commit()

    assert boss.get(f"/api/v1/employees/{employee_id}/face").json()["face_state"] == "old_model"
    progress = boss.get("/api/v1/face/enrolment-progress").json()["totals"]
    assert (progress["enrolled"], progress["old_model"]) == (0, 1)
