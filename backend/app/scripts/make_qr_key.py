"""Makes a new secret key for signing QR cards. Run it once per installation:

    uv run python -m app.scripts.make_qr_key

It only prints the line to put in the .env file (or in Render's environment). It writes no
file and touches no database.
"""

import sys

from app.core.crypto import generate_key_text


def main() -> int:
    print(f"QR_SIGNING_KEY={generate_key_text()}")
    print()
    print("Put this line in your .env file (locally) or in Render's environment (production).")
    print("- It is a secret: never commit it, never send it in chat or email.")
    print("- Keep a copy in the password manager. If it is lost, every printed card stops")
    print("  working and all cards must be issued and printed again.")
    print("- Do not change it later unless you want to replace all cards.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
