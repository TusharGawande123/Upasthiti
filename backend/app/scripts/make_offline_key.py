"""Makes a new key for opening the punches that gate devices save while offline (M4):

    uv run python -m app.scripts.make_offline_key

It only prints the line to put in the .env file (or in Render's environment). It writes no
file and touches no database. Gate devices get the matching public key from the server.
"""

import sys

from app.core.offline_crypto import generate_offline_key_text


def main() -> int:
    print(f"OFFLINE_EVIDENCE_KEY={generate_offline_key_text()}")
    print()
    print("Put this line in your .env file (locally) or in Render's environment (production).")
    print("- It is a secret: never commit it, never send it in chat or email.")
    print("- Keep a copy in the password manager. If it is lost, the punches still waiting on")
    print("  gate devices at that moment can no longer be read (punches already sent are safe).")
    print("- If it leaks together with a stolen gate device, that device's waiting punches could")
    print("  be read: make a new key and set OFFLINE_EVIDENCE_KEY_ID to the next letter.")
    print("  The server opens punches with the CURRENT key only, so first check on the devices page")
    print("  that every gate device has sent its waiting punches (count 0), or accept losing them.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
