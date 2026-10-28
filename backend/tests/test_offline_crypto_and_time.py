"""Sealed evidence and the time proof of offline punches (M4 spec §7 rule 8, §8.2; AC-13, AC-14,
AC-31). Pure functions: no database."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.core.config import Settings
from app.core.offline_crypto import (
    EvidenceUnreadableError,
    SealedEvidence,
    evidence_binding,
    generate_offline_key_text,
    load_offline_key,
    open_evidence,
    public_point,
    seal_evidence,
)
from app.modules.kiosks.time_anchor import TimeAnchor, anchor_is_valid, make_anchor
from app.modules.punches.offline_time import ANCHORED, UNPROVEN, ReportedTime, prove_punch_time

KIOSK = uuid.UUID("11111111-2222-3333-4444-555555555555")
PUNCH = uuid.UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
NOW = datetime(2026, 10, 28, 9, 0, tzinfo=UTC)


def make_key_pair():
    key = load_offline_key(generate_offline_key_text())
    return key, public_point(key)


# --- Sealed evidence --------------------------------------------------------------------------


def test_evidence_sealed_for_the_server_opens_with_its_key() -> None:
    key, point = make_key_pair()
    binding = evidence_binding(KIOSK, PUNCH, "qr", "A")

    sealed = seal_evidence(point, b"card and photo", binding, "A")

    assert open_evidence(key, sealed, binding) == b"card and photo"
    assert b"card and photo" not in sealed.ciphertext  # nothing readable is kept


def test_evidence_moved_to_another_punch_or_edited_does_not_open() -> None:
    key, point = make_key_pair()
    binding = evidence_binding(KIOSK, PUNCH, "qr", "A")
    sealed = seal_evidence(point, b"secret", binding, "A")

    other_punch = evidence_binding(KIOSK, uuid.uuid4(), "qr", "A")
    other_kiosk = evidence_binding(uuid.uuid4(), PUNCH, "qr", "A")
    other_method = evidence_binding(KIOSK, PUNCH, "face", "A")
    flipped = SealedEvidence(
        "A",
        sealed.ephemeral_public_key,
        sealed.nonce,
        bytes([sealed.ciphertext[0] ^ 1]) + sealed.ciphertext[1:],
    )
    for bad_binding in (other_punch, other_kiosk, other_method):
        with pytest.raises(EvidenceUnreadableError):
            open_evidence(key, sealed, bad_binding)
    with pytest.raises(EvidenceUnreadableError):
        open_evidence(key, flipped, binding)


def test_another_servers_key_cannot_open_the_evidence() -> None:
    _, point = make_key_pair()
    other_key, _ = make_key_pair()
    binding = evidence_binding(KIOSK, PUNCH, "face", "A")

    sealed = seal_evidence(point, b"frames", binding, "A")

    with pytest.raises(EvidenceUnreadableError):
        open_evidence(other_key, sealed, binding)


def test_malformed_sealed_parts_are_unreadable_not_a_crash() -> None:
    key, _ = make_key_pair()
    broken = SealedEvidence("A", b"too short", b"nonce", b"data")

    with pytest.raises(EvidenceUnreadableError):
        open_evidence(key, broken, b"binding")


def test_a_key_that_is_not_p256_is_refused_without_echoing_it() -> None:
    with pytest.raises(ValueError, match="not a valid offline evidence key") as refusal:
        load_offline_key("not-a-key-at-all")
    assert "not-a-key-at-all" not in str(refusal.value)


def test_production_needs_the_offline_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("OFFLINE_EVIDENCE_KEY", "")

    with pytest.raises(ValueError, match="offline_evidence_key"):
        Settings(_env_file=None)  # type: ignore[call-arg]


# --- Time anchor ------------------------------------------------------------------------------


def test_an_anchor_is_valid_only_for_its_own_device_and_values() -> None:
    anchor = make_anchor(KIOSK, NOW, 7)

    assert anchor_is_valid(KIOSK, anchor)
    assert not anchor_is_valid(uuid.uuid4(), anchor)
    forged_time = TimeAnchor(server_time=NOW + timedelta(hours=2), counter=7, token=anchor.token)
    forged_counter = TimeAnchor(server_time=NOW, counter=1, token=anchor.token)
    assert not anchor_is_valid(KIOSK, forged_time)
    assert not anchor_is_valid(KIOSK, forged_counter)


# --- The punch time ---------------------------------------------------------------------------


def reported(
    elapsed_minutes: float = 30,
    wall_minutes: float | None = None,
    *,
    anchor: TimeAnchor | None = None,
    same_session: bool = True,
    device_time: datetime | None = None,
) -> ReportedTime:
    wall = elapsed_minutes if wall_minutes is None else wall_minutes
    return ReportedTime(
        anchor=anchor or make_anchor(KIOSK, NOW, 5),
        elapsed_ms=int(elapsed_minutes * 60_000),
        wall_elapsed_ms=int(wall * 60_000),
        same_session=same_session,
        device_time=device_time,
    )


def prove(rep: ReportedTime, counter: int = 6, received: datetime | None = None):
    return prove_punch_time(KIOSK, counter, rep, received or NOW + timedelta(hours=1), 120, 72)


def test_a_good_anchor_and_elapsed_time_give_a_proven_time() -> None:
    proven = prove(reported(30))

    assert proven.proof == ANCHORED
    assert proven.punch_time == NOW + timedelta(minutes=30)


def test_the_device_clock_cannot_change_the_proven_time() -> None:
    # The wall clock was moved a day back; the monotonic clock still says 30 minutes. The two
    # disagree, so the time is unproven instead of trusted.
    proven = prove(reported(30, wall_minutes=-24 * 60))

    assert proven.proof == UNPROVEN
    assert NOW <= proven.punch_time <= NOW + timedelta(hours=1)  # never outside the window


@pytest.mark.parametrize(
    "changes",
    [
        {"same_session": False},  # the device restarted while offline
        {"elapsed_minutes": 180},  # more time than has passed since the anchor was received
    ],
)
def test_other_problems_make_the_time_unproven(changes: dict) -> None:
    proven = prove(reported(**{"elapsed_minutes": 30, **changes}))

    assert proven.proof == UNPROVEN
    assert proven.punch_time <= NOW + timedelta(hours=1)  # never later than the sync


def test_a_forged_anchor_is_unproven_and_stays_inside_the_72_hour_window() -> None:
    forged = TimeAnchor(server_time=NOW - timedelta(days=30), counter=5, token="forged-token")
    claimed = NOW - timedelta(days=20)

    proven = prove(reported(30, anchor=forged, device_time=claimed))

    assert proven.proof == UNPROVEN
    # A made-up time 20 days back is pulled forward to the latest 72 hours.
    assert proven.punch_time == NOW + timedelta(hours=1) - timedelta(hours=72)


def test_a_counter_from_before_the_anchor_cannot_be_proven() -> None:
    proven = prove(reported(30), counter=5)  # the anchor itself came with counter 5

    assert proven.proof == UNPROVEN


# --- The vector shared with the gate's Vitest test ----------------------------------------------


def test_the_gates_sealed_evidence_in_the_shared_vector_opens_on_the_server() -> None:
    import json
    from pathlib import Path

    path = Path(__file__).resolve().parents[2] / "frontend/src/kiosk/offline/test-vector.json"
    shared = json.loads(path.read_text())
    key = load_offline_key(shared["server_private_key_pkcs8"])
    from app.core.offline_crypto import b64url_decode

    evidence = shared["evidence"]
    sealed = SealedEvidence(
        evidence["key_id"],
        b64url_decode(evidence["ephemeral_public_key"]),
        b64url_decode(evidence["nonce"]),
        b64url_decode(evidence["ciphertext"]),
    )
    binding = evidence_binding(
        uuid.UUID(shared["kiosk_id"]), uuid.UUID(shared["client_punch_id"]), "qr", "A"
    )

    assert open_evidence(key, sealed, binding).decode() == shared["plaintext"]
