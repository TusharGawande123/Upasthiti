"""Creates the first Super Admin. Run once per installation:

    uv run python -m app.scripts.create_super_admin

It asks for the details in the terminal (the password is not shown while typing) and
refuses if an active Super Admin already exists. There is no default account anywhere.
"""

import getpass
import sys

from app.core.config import load_settings_or_exit
from app.core.db import get_session_factory
from app.core.errors import ApiError
from app.modules.users.service import create_first_super_admin


def ask(question: str, *, required: bool = True) -> str:
    while True:
        answer = input(question).strip()
        if answer or not required:
            return answer
        print("This is needed.")


def ask_password() -> str:
    while True:
        password = getpass.getpass("Password (at least 10 characters): ")
        if password == getpass.getpass("Type the password again: "):
            return password
        print("The two passwords are different. Try again.")


def main() -> int:
    load_settings_or_exit()
    print("Create the first Upasthiti Super Admin.\n")
    name = ask("Full name: ")
    username = ask("Username (small letters, digits, . or _): ")
    email = ask("Email (optional, press Enter to skip): ", required=False) or None
    password = ask_password()

    with get_session_factory()() as session:
        try:
            user = create_first_super_admin(
                session, name=name, username=username, email=email, password=password
            )
        except ApiError as error:
            print(f"\nNot created: {error.message} ({error.code})")
            return 1
    print(f"\nDone. Log in at /admin with the username '{user.username}'.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
