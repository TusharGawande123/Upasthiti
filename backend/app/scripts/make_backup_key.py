"""Makes a new key for encrypting backups (F-93):

    uv run python -m app.scripts.make_backup_key

It only prints the line to put in the .env file of the machine that runs the backup. It writes
no file and touches no database.
"""

import sys

from app.core.crypto import generate_key_text


def main() -> int:
    print(f"BACKUP_KEY={generate_key_text()}")
    print()
    print("Put this line in the .env file of the machine that makes and restores backups.")
    print("- It is a secret: never commit it, never send it in chat or email.")
    print("- Keep a copy in the password manager, NOT on the same drive as the backups.")
    print("  If it is lost, every backup made with it can no longer be read.")
    print("- To change the key later: make a new one, set BACKUP_KEY_ID to the next letter,")
    print("  and keep the old key until the old backups are no longer needed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
