"""Short browser and system names from a user agent: "Chrome" on "Android".

Kept only so the employee and the Super Admin recognise a phone in the list of signed-in phones
(M4b spec §8.1), and to count different phones for the F-70 alert. It is a rough guess, never a
device identifier: two phones of the same kind look the same, and that is accepted.
"""

from dataclasses import dataclass

UNKNOWN = "Other"
USER_AGENT_MAX_LENGTH = 300

# Order matters: Edge and Samsung Internet also say "Chrome", and Chrome also says "Safari".
_BROWSERS = (
    ("EdgA/", "Edge"),
    ("EdgiOS/", "Edge"),
    ("Edg/", "Edge"),
    ("SamsungBrowser/", "Samsung Internet"),
    ("OPR/", "Opera"),
    ("Firefox/", "Firefox"),
    ("FxiOS/", "Firefox"),
    ("CriOS/", "Chrome"),
    ("Chrome/", "Chrome"),
    ("Safari/", "Safari"),
)
_SYSTEMS = (
    ("Android", "Android"),
    ("iPhone", "iOS"),
    ("iPad", "iOS"),
    ("Windows", "Windows"),
    ("Mac OS X", "macOS"),
    ("CrOS", "ChromeOS"),
    ("Linux", "Linux"),
)


@dataclass(frozen=True)
class PhoneKind:
    browser: str
    system: str

    @property
    def label(self) -> str:
        """The passkey label: "Chrome on Android"."""
        return f"{self.browser} on {self.system}"


def phone_kind(user_agent: str | None) -> PhoneKind:
    text = user_agent or ""
    browser = next((name for marker, name in _BROWSERS if marker in text), UNKNOWN)
    system = next((name for marker, name in _SYSTEMS if marker in text), UNKNOWN)
    return PhoneKind(browser, system)


def short_user_agent(user_agent: str | None) -> str | None:
    return (user_agent or "")[:USER_AGENT_MAX_LENGTH] or None
