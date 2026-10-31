"""Optional email for alerts (M5 spec §7 rule 20, §8.2; decision 0034 line 16).

The bell is the main channel. Email works only when the server has the SMTP variables (for
example on the client's own server). With them unset (the free tiers) email is silently off:
nothing is queued, nothing is logged as an error. No other email service is ever used.
The text is short and has no personal names or codes.
"""

import logging
import smtplib
import ssl
from email.message import EmailMessage
from typing import Any

from app.core.config import get_settings

logger = logging.getLogger(__name__)

# One plain sentence per alert kind. Only counts and plant codes: never a name or an employee code.
EMAIL_TEXTS: dict[str, str] = {
    "notification.device_offline": "An attendance device at {plant} is offline.",
    "notification.still_inside": "{count} people are still inside {plant} after the shift ended.",
    "notification.many_rejections": "{count} punches were refused at {plant} in a short time.",
    "notification.incomplete_days": "{count} days at {plant} have no OUT and need a correction.",
    "notification.review_digest": "{count} punches are waiting in Needs review.",
    "notification.absence_streak": "A person at {plant} was absent several working days in a row.",
    "notification.monthly_register": "The attendance register of {month} for {plant} is ready.",
    "notification.correction_requested": "A correction is waiting for your decision.",
    "notification.correction_decided": "Your correction request was decided.",
}


def email_configured() -> bool:
    """True only when the server has an SMTP host and a sender address."""
    settings = get_settings()
    return bool(settings.smtp_host and settings.smtp_from)


def email_text(text_key: str, params: dict[str, Any]) -> str:
    template = EMAIL_TEXTS.get(text_key, "There is a new alert in Upasthiti.")
    try:
        return template.format(**params)
    except KeyError, IndexError:
        return "There is a new alert in Upasthiti."


def send_email(to_address: str, subject: str, body: str) -> None:
    """Send one email through the configured SMTP server. Raises `OSError`, `smtplib.SMTPException`
    or `ssl.SSLError` on a problem; the caller records a failure code, never the address."""
    settings = get_settings()
    host = settings.smtp_host
    if host is None or not settings.smtp_from:
        raise RuntimeError("SMTP is not configured")
    message = EmailMessage()
    message["From"] = settings.smtp_from
    message["To"] = to_address
    message["Subject"] = subject
    message.set_content(body)
    timeout = 15
    if settings.smtp_security == "ssl":
        server: smtplib.SMTP = smtplib.SMTP_SSL(
            host,
            settings.smtp_port,
            timeout=timeout,
            context=ssl.create_default_context(),
        )
    else:
        server = smtplib.SMTP(host, settings.smtp_port, timeout=timeout)
    with server:
        if settings.smtp_security == "starttls":
            server.starttls(context=ssl.create_default_context())
        if settings.smtp_username and settings.smtp_password:
            server.login(settings.smtp_username, settings.smtp_password.get_secret_value())
        server.send_message(message)
