"""Makes a new secret key for encrypting face templates. Run it once per installation:

    uv run python -m app.scripts.make_face_key

It only prints the line to put in the .env file (or in Render's environment). It writes no
file and touches no database. This key is separate from the snapshot key (decision 0016).
"""

import sys

from app.core.crypto import generate_key_text


def main() -> int:
    print(f"FACE_TEMPLATE_KEY={generate_key_text()}")
    print()
    print("Put this line in your .env file (locally) or in Render's environment (production).")
    print("- It is a secret: never commit it, never send it in chat or email.")
    print("- Keep a copy in the password manager. If it is lost, every stored face template")
    print("  becomes unreadable and EVERY employee must be enrolled again.")
    print("- If it leaks, make a new one, delete all templates and enrol everyone again")
    print("  (spec M3 section 8.4).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
