"""The kiosk's sound switch and last self-test on the kiosks list, and the gate poster PDF
(spec M2 §4.12, §5.5, §7 rules 1 and 20; F-1, F-27, F-34; AC-36). Real PostgreSQL; fake data."""

import uuid

import pypdfium2
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from fpdf import FPDF
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import utc_now
from app.modules.audit.models import AuditLog
from app.modules.kiosks.models import KioskDevice
from app.modules.org.models import Plant
from app.modules.printing import poster_pdf
from app.modules.users.models import Role, User
from app.modules.users.plant_access import set_user_plant
from tests.people_helpers import PlantIds, client_for, create_plant

KIOSKS = "/api/v1/kiosks"


@pytest.fixture
def boss(db_app: FastAPI, db_session: Session) -> TestClient:
    return client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")


@pytest.fixture
def k134(boss: TestClient, db_session: Session) -> PlantIds:
    return create_plant(boss, db_session, "K134")


@pytest.fixture
def tp1(boss: TestClient, db_session: Session) -> PlantIds:
    return create_plant(boss, db_session, "TP1")


@pytest.fixture
def head(db_app: FastAPI, db_session: Session, k134: PlantIds) -> TestClient:
    client = client_for(db_app, db_session, Role.PLANT_HEAD, "head.k134")
    user = db_session.scalars(select(User).where(User.username == "head.k134")).one()
    set_user_plant(db_session, user, uuid.UUID(k134.id))
    db_session.commit()
    return client


@pytest.fixture
def corporate(db_app: FastAPI, db_session: Session) -> TestClient:
    return client_for(db_app, db_session, Role.CORPORATE_HEAD, "corp")


def make_kiosk(session: Session, plant: PlantIds, name: str) -> KioskDevice:
    kiosk = KioskDevice(plant_id=uuid.UUID(plant.id), name=name, status="active")
    session.add(kiosk)
    session.commit()
    return kiosk


# --- Kiosks list and the sound switch -----------------------------------------------------------


def test_the_kiosks_list_shows_the_sound_switch_and_the_last_self_test(
    boss: TestClient, db_session: Session, k134: PlantIds
) -> None:
    quiet = make_kiosk(db_session, k134, "Quiet gate")
    tested = make_kiosk(db_session, k134, "Tested gate")
    tested.last_self_test_at = utc_now()
    db_session.commit()

    kiosks = {kiosk["name"]: kiosk for kiosk in boss.get(KIOSKS).json()}

    assert kiosks["Quiet gate"]["sound_muted"] is False
    assert kiosks["Quiet gate"]["last_self_test_at"] is None
    assert kiosks["Tested gate"]["last_self_test_at"] is not None
    assert quiet.id is not None


def test_the_super_admin_switches_a_gates_sound_off_and_it_is_audited(
    boss: TestClient, db_session: Session, k134: PlantIds
) -> None:
    kiosk = make_kiosk(db_session, k134, "Main gate")

    answer = boss.patch(f"{KIOSKS}/{kiosk.id}", json={"sound_muted": True}).json()

    assert answer["sound_muted"] is True and answer["name"] == "Main gate"
    entry = db_session.scalars(select(AuditLog).where(AuditLog.action == "kiosk.update")).one()
    assert entry.before is not None and entry.before["sound_muted"] is False
    assert entry.after is not None and entry.after["sound_muted"] is True
    assert entry.plant_id == kiosk.plant_id


def test_renaming_leaves_the_sound_switch_alone(
    boss: TestClient, db_session: Session, k134: PlantIds
) -> None:
    kiosk = make_kiosk(db_session, k134, "Main gate")
    boss.patch(f"{KIOSKS}/{kiosk.id}", json={"sound_muted": True})

    answer = boss.patch(f"{KIOSKS}/{kiosk.id}", json={"name": "  Gate 1  "}).json()

    assert answer["name"] == "Gate 1" and answer["sound_muted"] is True


def test_a_plant_head_switches_sound_only_at_their_own_plant(
    head: TestClient, db_session: Session, k134: PlantIds, tp1: PlantIds
) -> None:
    own = make_kiosk(db_session, k134, "Own gate")
    other = make_kiosk(db_session, tp1, "Other gate")

    assert head.patch(f"{KIOSKS}/{own.id}", json={"sound_muted": True}).json()["sound_muted"]
    other_answer = head.patch(f"{KIOSKS}/{other.id}", json={"sound_muted": True})
    assert other_answer.json()["error"]["code"] == "NOT_FOUND"


def test_the_corporate_head_cannot_switch_sound(
    corporate: TestClient, db_session: Session, k134: PlantIds
) -> None:
    kiosk = make_kiosk(db_session, k134, "Main gate")

    response = corporate.patch(f"{KIOSKS}/{kiosk.id}", json={"sound_muted": True})

    assert response.json()["error"]["code"] == "FORBIDDEN"


def test_an_empty_name_is_still_refused(
    boss: TestClient, db_session: Session, k134: PlantIds
) -> None:
    kiosk = make_kiosk(db_session, k134, "Main gate")

    assert boss.patch(f"{KIOSKS}/{kiosk.id}", json={"name": ""}).status_code == 422


# --- Gate poster --------------------------------------------------------------------------------


def poster_text(response) -> str:
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/pdf"
    document = pypdfium2.PdfDocument(response.content)
    assert len(document) == 1  # one A4 page
    width, height = document[0].get_size()
    assert (round(width), round(height)) == (595, 842)  # A4 in points
    # Wrapped lines come out with line breaks: compare the words, not the layout.
    return " ".join(document[0].get_textpage().get_text_range().split())


def test_the_poster_names_the_plant_and_the_current_retention(
    boss: TestClient, k134: PlantIds
) -> None:
    text = poster_text(boss.get(f"/api/v1/plants/{k134.id}/gate-poster.pdf"))

    assert "Plant K134" in text and "K134" in text
    assert "Card: hold your card to the camera" in text
    assert "Face: tap Punch with face, turn your head as the arrow shows" in text
    assert "NOT ACCEPTED" in text
    assert "kept for 60 days" in text
    # The face notice of spec M3 §8.1 and the address of the public privacy page (as text).
    assert "Pressing Punch with face means your face is checked." in text
    assert "your face is checked against an encrypted record" in text
    assert "Full privacy notice:" in text and "/privacy" in text
    assert "never used for face recognition" not in text
    # M4 §4.12: what happens without internet, and the offline privacy sentence of §4.2.
    assert "No internet? Your punch is saved on this attendance device" in text
    assert "deleted from the device once it is sent" in text
    assert "the plant office will tell you" in text
    assert "kiosk" not in text.lower()


@pytest.mark.parametrize("retention_days", [1, 60, 365])
def test_the_privacy_box_fits_above_the_help_line(retention_days: int) -> None:
    pdf = FPDF(format="A4", unit="mm")
    pdf.add_font(poster_pdf.FONT_NAME, "", str(poster_pdf.FONT_FOLDER / "Inter-Regular.ttf"))
    pdf.add_font(poster_pdf.FONT_NAME, "B", str(poster_pdf.FONT_FOLDER / "Inter-Bold.ttf"))
    pdf.add_page()
    box_top = 199.0  # below the two ways, the result box and the NOT ACCEPTED note

    assert (
        poster_pdf.privacy_box_height(pdf, retention_days) <= poster_pdf.BOTTOM_LIMIT_MM - box_top
    )


def test_the_poster_follows_a_changed_retention(boss: TestClient, k134: PlantIds) -> None:
    boss.put(
        "/api/v1/settings",
        json={"values": {"snapshot_retention_days": 30}, "reason": "Shorter retention"},
    )

    text = poster_text(boss.get(f"/api/v1/plants/{k134.id}/gate-poster.pdf"))

    assert "kept for 30 days" in text


def test_a_very_long_plant_name_still_fits_on_one_page(
    boss: TestClient, db_session: Session, k134: PlantIds
) -> None:
    plant = db_session.get(Plant, uuid.UUID(k134.id))
    assert plant is not None
    plant.name = "Sheet Shapers " + "Very Long Plant Name " * 5
    db_session.commit()

    text = poster_text(boss.get(f"/api/v1/plants/{k134.id}/gate-poster.pdf"))

    assert "Very Long Plant Name" in text


def test_a_plant_head_prints_the_poster_of_their_own_plant_only(
    head: TestClient, k134: PlantIds, tp1: PlantIds
) -> None:
    poster_text(head.get(f"/api/v1/plants/{k134.id}/gate-poster.pdf"))

    other = head.get(f"/api/v1/plants/{tp1.id}/gate-poster.pdf")
    assert other.json()["error"]["code"] == "PLANT_NOT_FOUND"


def test_the_corporate_head_does_not_print_posters(corporate: TestClient, k134: PlantIds) -> None:
    response = corporate.get(f"/api/v1/plants/{k134.id}/gate-poster.pdf")

    assert response.json()["error"]["code"] == "FORBIDDEN"


def test_an_unknown_plant_has_no_poster(boss: TestClient) -> None:
    response = boss.get(f"/api/v1/plants/{uuid.uuid4()}/gate-poster.pdf")

    assert response.json()["error"]["code"] == "PLANT_NOT_FOUND"
