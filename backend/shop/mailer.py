"""
Real email delivery over SMTP (Demo 1, Phase 11).

Configured from .env:
    SMTP_HOST, SMTP_PORT (default 587), SMTP_USERNAME, SMTP_PASSWORD,
    SMTP_FROM (default: SMTP_USERNAME), SMTP_SECURITY = starttls | ssl | none
    (default starttls).

For Gmail: SMTP_HOST=smtp.gmail.com, SMTP_PORT=587, SMTP_USERNAME is your
address, and SMTP_PASSWORD is an App Password (Google Account → Security →
2-Step Verification → App passwords), not your normal password.

Without SMTP_HOST, nothing is sent: messages stay in the demo outbox.

Check the settings by sending yourself a test email:
    python -m backend.shop.mailer you@example.com
"""
import os
import smtplib
import ssl
import sys
from email.message import EmailMessage
from email.utils import formataddr

from dotenv import load_dotenv

load_dotenv()


def settings() -> dict:
    username = os.getenv("SMTP_USERNAME", "").strip()
    return {
        "host": os.getenv("SMTP_HOST", "").strip(),
        "port": int(os.getenv("SMTP_PORT", "587") or 587),
        "username": username,
        "password": os.getenv("SMTP_PASSWORD", ""),
        "sender": os.getenv("SMTP_FROM", "").strip() or username,
        "security": (os.getenv("SMTP_SECURITY", "starttls") or "starttls").strip().lower(),
    }


def configured() -> bool:
    cfg = settings()
    return bool(cfg["host"] and cfg["sender"])


def send(to: str, subject: str, body: str) -> None:
    """Send one plain-text email. Raises on any failure (the caller records it)."""
    cfg = settings()
    if not (cfg["host"] and cfg["sender"]):
        raise RuntimeError("SMTP is not configured")
    msg = EmailMessage()
    msg["From"] = formataddr(("ShopSphere", cfg["sender"]))
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    context = ssl.create_default_context()
    if cfg["security"] == "ssl":
        server = smtplib.SMTP_SSL(cfg["host"], cfg["port"], timeout=20, context=context)
    else:
        server = smtplib.SMTP(cfg["host"], cfg["port"], timeout=20)
    with server:
        if cfg["security"] == "starttls":
            server.starttls(context=context)
        if cfg["username"]:
            server.login(cfg["username"], cfg["password"])
        server.send_message(msg)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: python -m backend.shop.mailer you@example.com")
        sys.exit(2)
    if not configured():
        print("SMTP is not configured: set SMTP_HOST, SMTP_USERNAME, SMTP_PASSWORD (and SMTP_PORT/SMTP_SECURITY) in .env")
        sys.exit(1)
    try:
        send(sys.argv[1], "ShopSphere test email", "This is a test email from ShopSphere. Your email settings work.")
    except Exception as exc:          # show the reason, never the password
        print(f"Sending failed: {type(exc).__name__}: {exc}")
        sys.exit(1)
    print(f"Test email sent to {sys.argv[1]} from {settings()['sender']} via {settings()['host']}.")
