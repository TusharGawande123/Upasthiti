"""M6 S-61 (plan 5.3): a Hypothesis state machine that shakes the offline sync.

A fake gate queues sealed card punches, then Hypothesis drops some, sends some twice, sends them in
any order, replays a whole request, moves the device clock and finally revokes the device. After
every step four properties must hold:
  1. no punch is counted twice (one row per client punch id);
  2. the server time wins (no punch is dated before its anchor or after it arrived);
  3. a revoked device is refused and adds no rows;
  4. the sync is idempotent (sending a saved item again changes nothing).

CI uses a few examples. The nightly run sets CHAOS_EXAMPLES to a large number (M6 AC-M6-30)."""

import json
import os
import uuid
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from hypothesis import HealthCheck, settings
from hypothesis import strategies as st
from hypothesis.stateful import (
    RuleBasedStateMachine,
    invariant,
    precondition,
    rule,
    run_state_machine_as_test,
)
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import today_ist, utc_now
from app.modules.kiosks.models import KioskDevice, KioskStatus
from app.modules.punches.models import Punch
from app.modules.qr_cards.models import QrCredential
from app.modules.users.models import Role
from tests.conftest import clear_cached_settings
from tests.kiosk_helpers import Device, make_active_kiosk
from tests.offline_helpers import SYNC, OfflineGate, card_evidence
from tests.people_helpers import PlantIds, client_for, create_plant
from tests.test_punch_api import Worker, photo_text

pytestmark = pytest.mark.time_sensitive

CHAOS_EXAMPLES = int(os.environ.get("CHAOS_EXAMPLES", "6"))
STEPS_PER_EXAMPLE = 14


@pytest.fixture(autouse=True)
def snapshot_folder(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("STORAGE_LOCAL_DIR", str(tmp_path / "snapshots"))
    clear_cached_settings()
    return tmp_path / "snapshots"


def build_chaos_machine(
    db_client: TestClient, db_session: Session, boss: TestClient, plant: PlantIds
) -> type[RuleBasedStateMachine]:
    """The machine is built inside a function so it can use the test's database fixtures."""
    next_worker_number = iter(range(1, 10_000))

    class SyncChaos(RuleBasedStateMachine):
        def __init__(self) -> None:
            super().__init__()
            self.device = Device()
            number = next(next_worker_number)
            self.kiosk: KioskDevice = make_active_kiosk(
                db_session, plant, self.device, f"Gate {number}"
            )
            self.worker: Worker = self.make_worker(f"CH-{number}")
            self.gate = OfflineGate(self.device)
            self.anchor_time = utc_now() - timedelta(hours=1)
            self.gate.take_anchor(self.anchor_time)
            self.queue: list[dict] = []  # items made but not yet sent
            self.saved: dict[str, str] = {}  # client punch id -> punch id the server gave
            self.revoked = False
            self.jumped_ids: set[str] = set()  # items whose device clock was moved

        # --- helpers -------------------------------------------------------------------

        def make_worker(self, code: str) -> Worker:
            """Like make_worker() of the punch tests, but with its own employee code."""
            worker = Worker(boss, plant, code)
            card = db_session.get(QrCredential, worker.card_id)
            assert card is not None
            card.valid_from = today_ist() - timedelta(days=2)
            db_session.commit()
            return worker

        def punch_rows(self) -> list[Punch]:
            return list(
                db_session.scalars(
                    select(Punch)
                    .where(Punch.kiosk_id == self.kiosk.id)
                    .order_by(Punch.server_received_at, Punch.id)
                )
            )

        def make_item(self, minutes: int, *, clock_jump: bool = False) -> dict:
            item = self.gate.item(
                "qr",
                card_evidence(self.worker.qr_text, photo_text()),
                elapsed=timedelta(minutes=minutes),
                wall_elapsed=timedelta(hours=-24) if clock_jump else None,
            )
            client_punch_id = json.loads(item["signed_item"])["client_punch_id"]
            if clock_jump:
                self.jumped_ids.add(client_punch_id)
            return item

        def send(self, items: list[dict]) -> list[dict] | None:
            """Sends a batch; returns the results, or None when the server refused the request."""
            rows_before = len(self.punch_rows())
            response = self.gate.send(db_client, items)
            if self.revoked:
                assert response.status_code == 403, response.text
                assert response.json()["error"]["code"] == "DEVICE_REVOKED"
                assert len(self.punch_rows()) == rows_before  # property 3
                return None
            assert response.status_code == 200, response.text
            results = response.json()["results"]
            for item, result in zip(items, results, strict=True):
                client_punch_id = json.loads(item["signed_item"])["client_punch_id"]
                if client_punch_id in self.saved:
                    # property 4: an item the server already has is never made again
                    assert result["result"] == "already_saved"
                    assert result["punch_id"] == self.saved[client_punch_id]
                else:
                    assert result["result"] == "saved", result
                    self.saved[client_punch_id] = result["punch_id"]
            return results

        # --- rules (what the chaos does) -----------------------------------------------

        @rule(minutes=st.integers(min_value=1, max_value=58))
        def queue_punch(self, minutes: int) -> None:
            self.queue.append(self.make_item(minutes))

        @rule(minutes=st.integers(min_value=1, max_value=58))
        def queue_punch_after_clock_jump(self, minutes: int) -> None:
            self.queue.append(self.make_item(minutes, clock_jump=True))

        @precondition(lambda self: bool(self.queue))
        @rule(data=st.data())
        def drop_an_item(self, data: st.DataObject) -> None:
            """The gate loses an item before it was ever sent (browser data cleared)."""
            self.queue.pop(data.draw(st.integers(0, len(self.queue) - 1)))

        @precondition(lambda self: bool(self.queue))
        @rule(data=st.data())
        def sync_a_shuffled_part_of_the_queue(self, data: st.DataObject) -> None:
            chosen = data.draw(st.permutations(self.queue))
            count = data.draw(st.integers(1, len(chosen)))
            batch = list(chosen[:count])
            self.send(batch)
            self.queue = [item for item in self.queue if item not in batch]

        @precondition(lambda self: bool(self.saved) and len(self.queue) < 3)
        @rule(data=st.data())
        def send_a_saved_item_again(self, data: st.DataObject) -> None:
            """A lost answer: the gate keeps the item and sends it again (duplicate)."""
            minutes = data.draw(st.integers(1, 58))
            item = self.make_item(minutes)
            if not self.revoked:
                self.send([item])  # the first time it really arrives
            rows_before = len(self.punch_rows())
            self.send([item])  # the second time must change nothing
            if not self.revoked:
                assert len(self.punch_rows()) == rows_before

        @rule(minutes=st.integers(min_value=1, max_value=58))
        def replay_a_whole_request(self, minutes: int) -> None:
            """The same signed request twice (a copied request): the nonce is used up."""
            item = self.make_item(minutes)
            body = json.dumps({"items": [item], "app_version": "t"}).encode()
            headers = self.device.headers("POST", SYNC, body) | {"Content-Type": "application/json"}
            first = db_client.post(SYNC, content=body, headers=headers)
            rows_after_first = len(self.punch_rows())
            replay = db_client.post(SYNC, content=body, headers=headers)
            if self.revoked:
                assert first.status_code == 403 and replay.status_code == 403
            else:
                assert first.status_code == 200, first.text
                for result in first.json()["results"]:
                    self.saved.setdefault(
                        json.loads(item["signed_item"])["client_punch_id"], result["punch_id"]
                    )
                assert replay.status_code == 401
                assert replay.json()["error"]["code"] == "NONCE_REUSED"
            assert len(self.punch_rows()) == rows_after_first

        @precondition(lambda self: not self.revoked)
        @rule()
        def revoke_the_device(self) -> None:
            self.kiosk.status = KioskStatus.REVOKED.value
            self.kiosk.revoked_at = utc_now()
            db_session.commit()
            self.revoked = True

        # --- properties, checked after every step ----------------------------------------

        @invariant()
        def no_punch_is_counted_twice(self) -> None:
            rows = self.punch_rows()
            client_ids = [str(row.client_punch_id) for row in rows]
            assert len(client_ids) == len(set(client_ids))
            assert set(client_ids) == set(self.saved)

        @invariant()
        def server_time_wins(self) -> None:
            for row in self.punch_rows():
                assert row.punch_time >= self.anchor_time - timedelta(seconds=2)
                assert row.punch_time <= row.server_received_at + timedelta(seconds=2)
                if str(row.client_punch_id) in self.jumped_ids:
                    # a moved device clock never gives a proven time
                    assert row.time_proof == "unproven"

    return SyncChaos


def test_the_offline_sync_keeps_its_properties_under_chaos(
    db_app: FastAPI, db_client: TestClient, db_session: Session
) -> None:
    """M6 AC-M6-30 (S-61): drops, duplicates, reorder, clock jumps, nonce reuse, device revoke."""
    boss = client_for(db_app, db_session, Role.SUPER_ADMIN, "boss")
    plant = create_plant(boss, db_session, "K134")
    machine = build_chaos_machine(db_client, db_session, boss, plant)
    chaos_settings = settings(
        max_examples=CHAOS_EXAMPLES,
        stateful_step_count=STEPS_PER_EXAMPLE,
        deadline=None,
        database=None,
        derandomize=not os.environ.get("CHAOS_EXAMPLES"),  # CI is repeatable, nightly explores
        suppress_health_check=list(HealthCheck),
    )

    run_state_machine_as_test(machine, settings=chaos_settings)

    assert uuid.UUID(plant.id)  # the plant survived every example
