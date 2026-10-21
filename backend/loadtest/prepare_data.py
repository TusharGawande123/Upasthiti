"""Prepares a THROWAWAY database for the load test (S-22):

    cd backend
    uv sync --group loadtest
    uv run python loadtest/prepare_data.py

It makes the database `upasthiti_loadtest` on the local Postgres (from `docker compose up -d`),
wipes it, migrates it, and fills it with 7 plants, 7 paired gate kiosks and 300 temporary workers
with a QR card per plant, all with invented names. It writes two files into `loadtest/.data/`
(git-ignored, never commit them):

- `server.env`: fake keys and settings for the backend container (`docker run --env-file`);
- `fixture.json`: for every kiosk its private key and the QR texts of the cards of its plant, which
  `locustfile.py` uses to send correctly signed punches.

It refuses to run unless the database name ends in `_loadtest` and APP_ENV is not production. The
data never leaves this laptop and nothing in it is real.
"""

import base64
import hashlib
import json
import os
import secrets
import sys
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

LOADTEST_FOLDER = Path(__file__).resolve().parent
BACKEND_FOLDER = LOADTEST_FOLDER.parent
DATA_FOLDER = LOADTEST_FOLDER / ".data"
sys.path.insert(0, str(BACKEND_FOLDER))  # so `app` can be imported when run as a script

DATABASE_URL = "postgresql+psycopg://upasthiti:upasthiti@127.0.0.1:5432/upasthiti_loadtest"
# The container reaches the laptop's Postgres through Docker's host name.
CONTAINER_DATABASE_URL = DATABASE_URL.replace("127.0.0.1", "host.docker.internal")
PLANTS = 7
WORKERS_PER_PLANT = 300  # one card punch per worker: 300 punches per gate in 10 minutes
ORIGIN = "http://localhost:8001"  # where the container is published (see README.md)


def make_server_env() -> dict[str, str]:
    """Fake keys for this run only, kept in server.env so the container and this script agree."""
    path = DATA_FOLDER / "server.env"
    if path.exists():
        return dict(
            line.split("=", 1)
            for line in path.read_text(encoding="utf-8").splitlines()
            if "=" in line
        )

    def key(phrase: str) -> str:
        return (
            base64.urlsafe_b64encode(hashlib.sha256(phrase.encode()).digest()).rstrip(b"=").decode()
        )

    values = {
        "APP_ENV": "test",
        "RUN_SCHEDULER": "false",
        "DATABASE_URL": CONTAINER_DATABASE_URL,
        "APP_SECRET_KEY": secrets.token_urlsafe(32),
        "APP_PUBLIC_ORIGIN": ORIGIN,
        "QR_SIGNING_KEY": key("loadtest qr signing " + secrets.token_hex(8)),
        "QR_SIGNING_KEY_ID": "A",
        "SNAPSHOT_ENCRYPTION_KEY": key("loadtest snapshots " + secrets.token_hex(8)),
        "STORAGE_BACKEND": "local",
        "STORAGE_LOCAL_DIR": "/tmp/loadtest-photos",  # noqa: S108 (inside the throwaway container)
    }
    DATA_FOLDER.mkdir(exist_ok=True)
    path.write_text(
        "".join(f"{name}={value}\n" for name, value in values.items()), encoding="utf-8"
    )
    return values


def main() -> int:
    server_env = make_server_env()
    # This script itself talks to the database from the laptop, with the same keys.
    os.environ.update(server_env)
    os.environ["DATABASE_URL"] = DATABASE_URL
    if os.environ["APP_ENV"] == "production" or not DATABASE_URL.endswith("_loadtest"):
        print("Refused: only for a throwaway *_loadtest database, never in production.")
        return 1

    # The app is imported only now, after the environment above is set.
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from sqlalchemy import select

    from app.core.config import get_settings
    from app.core.db import get_session_factory
    from app.core.time import today_ist
    from app.modules.audit.service import Actor
    from app.modules.auth.passwords import hash_password
    from app.modules.employees.operations import AuditContext as EmployeeAuditContext
    from app.modules.employees.operations import create_employee
    from app.modules.employees.rules import EmployeeValues
    from app.modules.kiosks.models import KioskDevice
    from app.modules.org.models import EmployeeCategory, Plant, Shift
    from app.modules.org.plants_service import add_client_plants
    from app.modules.qr_cards.models import QrCredential
    from app.modules.qr_cards.payload import build_payload
    from app.modules.qr_cards.service import issue_card
    from app.modules.users.models import Role, User
    from app.scripts.e2e_seed import _create_database_if_missing, _wipe_and_migrate

    print("Making the database (wiped and migrated)...")
    _create_database_if_missing(DATABASE_URL, "upasthiti_loadtest")
    _wipe_and_migrate(DATABASE_URL)

    fixture: list[dict[str, object]] = []
    with get_session_factory()() as session:
        # The cards need an issuer. This user can never log in (the password is random and unused).
        issuer = User(
            name="Load test issuer",
            username="loadtest.issuer",
            password_hash=hash_password(secrets.token_urlsafe(24)),
            role=Role.SUPER_ADMIN.value,
            must_change_password=False,
        )
        session.add(issuer)
        session.flush()
        actor = Actor("user", issuer.id)
        add_client_plants(session, actor=actor)
        plants = list(session.scalars(select(Plant).order_by(Plant.code)))[:PLANTS]
        next_code = 1

        for plant in plants:
            shift = session.scalars(select(Shift).where(Shift.plant_id == plant.id)).first()
            helper = session.scalars(
                select(EmployeeCategory).where(
                    EmployeeCategory.plant_id == plant.id, EmployeeCategory.name == "Helper"
                )
            ).one()
            if shift is None:
                raise SystemExit(f"Plant {plant.code} has no shift.")
            private_key = ec.generate_private_key(ec.SECP256R1())
            spki = private_key.public_key().public_bytes(
                serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
            )
            kiosk = KioskDevice(
                plant_id=plant.id,
                name=f"{plant.code} gate",
                status="active",
                public_key=base64.b64encode(spki).decode(),
            )
            session.add(kiosk)
            session.flush()

            card_texts = []
            for _ in range(WORKERS_PER_PLANT):
                employee = create_employee(
                    session,
                    EmployeeAuditContext(actor),
                    EmployeeValues(
                        employee_code=f"L{next_code:05d}",
                        full_name=f"Load Worker {next_code}",
                        type="temporary",
                        plant_id=plant.id,
                        category_id=helper.id,
                        department_id=None,
                        contractor_id=None,
                        shift_id=shift.id,
                        punch_method="qr",
                        hourly_rate=Decimal("85.00"),
                        ot_rate_per_hour=None,
                        joined_on=today_ist() - timedelta(days=30),
                    ),
                )
                next_code += 1
                issued = issue_card(session, actor, employee)
                card: QrCredential = issued.card
                card_texts.append(build_payload(get_settings(), card.card_serial))
            session.commit()
            fixture.append(
                {
                    "kiosk_id": str(kiosk.id),
                    "name": kiosk.name,
                    "private_key_pem": private_key.private_bytes(
                        serialization.Encoding.PEM,
                        serialization.PrivateFormat.PKCS8,
                        serialization.NoEncryption(),
                    ).decode(),
                    "cards": card_texts,
                }
            )
            print(f"  {plant.code}: kiosk and {WORKERS_PER_PLANT} cards")

    (DATA_FOLDER / "fixture.json").write_text(json.dumps({"kiosks": fixture}), encoding="utf-8")
    print(f"Done. {len(fixture)} kiosks and {len(fixture) * WORKERS_PER_PLANT} cards.")
    print(f"Wrote {DATA_FOLDER / 'server.env'} and {DATA_FOLDER / 'fixture.json'} (never commit).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
