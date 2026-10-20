"""Makes a new secret key for encrypting kiosk snapshots. Run it once per installation:

    uv run python -m app.scripts.make_snapshot_key

It only prints the line to put in the .env file (or in Render's environment). It writes no
file and touches no database.
"""

import sys

from app.core.crypto import generate_key_text


def main() -> int:
    print(f"SNAPSHOT_ENCRYPTION_KEY={generate_key_text()}")
    print()
    print("Put this line in your .env file (locally) or in Render's environment (production).")
    print("- It is a secret: never commit it, never send it in chat or email.")
    print("- Keep a copy in the password manager. If it is lost, the stored photos can no")
    print("  longer be opened (they are deleted after the retention period anyway).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
