"""First-party password hashing, session signing and reset tokens.

Only the Python standard library is used: PBKDF2-HMAC-SHA256 with a
per-user random salt, and constant-time comparison for verification.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import os
import re
import secrets
import time

import logging

PBKDF2_ITERATIONS = 260_000
SALT_BYTES = 16
HASH_BYTES = 32
SESSION_MAX_AGE = 60 * 60 * 24 * 30
RESET_TOKEN_TTL_SECONDS = 60 * 60

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$")


def _secret() -> bytes:
    value = os.environ.get("DROPPILOT_SECRET_KEY")
    if not value:
        value = "droppilot-dev-session-secret"
    return value.encode("utf-8")


# ---------------------------------------------------------------------------
# Passwords
# ---------------------------------------------------------------------------


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(SALT_BYTES)
    derived = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS, HASH_BYTES
    )
    return "pbkdf2_sha256${}${}${}".format(
        PBKDF2_ITERATIONS,
        binascii.hexlify(salt).decode(),
        binascii.hexlify(derived).decode(),
    )


def verify_password(password: str, encoded: str) -> bool:
    """Constant-time verification; always does work to avoid timing leaks."""
    dummy = "pbkdf2_sha256${}${}${}".format(
        PBKDF2_ITERATIONS, "00" * SALT_BYTES, "00" * HASH_BYTES
    )
    candidate = encoded or dummy
    parts = candidate.split("$")
    if len(parts) != 4 or parts[0] != "pbkdf2_sha256":
        parts = dummy.split("$")
    try:
        iterations = int(parts[1])
        salt = binascii.unhexlify(parts[2])
        expected = binascii.unhexlify(parts[3])
    except (ValueError, binascii.Error):
        logging.exception("Unexpected error")
        iterations, salt, expected = (
            PBKDF2_ITERATIONS,
            b"\x00" * SALT_BYTES,
            b"\x00" * HASH_BYTES,
        )
    derived = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, iterations, len(expected)
    )
    ok = hmac.compare_digest(derived, expected)
    return bool(ok and encoded)


def password_problem(password: str, confirm: str | None = None) -> str:
    """Return an empty string when the password meets minimum strength."""
    if len(password) < 10:
        return "Password must be at least 10 characters."
    if not re.search(r"[A-Za-z]", password):
        return "Password must include at least one letter."
    if not re.search(r"\d", password):
        return "Password must include at least one number."
    if password.lower() in {"password12", "droppilot1", "1234567890"}:
        return "That password is too common. Choose something less guessable."
    if confirm is not None and password != confirm:
        return "Passwords do not match."
    return ""


# ---------------------------------------------------------------------------
# Email normalization
# ---------------------------------------------------------------------------


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def is_valid_email(email: str) -> bool:
    return bool(_EMAIL_RE.match(email or ""))


def slugify(value: str, fallback: str = "artist") -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")
    return slug[:60] or fallback


# ---------------------------------------------------------------------------
# Signed session cookie
# ---------------------------------------------------------------------------


def _sign(payload: str) -> str:
    digest = hmac.new(_secret(), payload.encode("utf-8"), hashlib.sha256)
    return base64.urlsafe_b64encode(digest.digest()).decode().rstrip("=")


def make_session_token(user_id: int) -> str:
    issued = int(time.time())
    payload = f"{user_id}.{issued}"
    return f"{payload}.{_sign(payload)}"


def read_session_token(token: str) -> int:
    """Return the user id for a valid, unexpired token, else 0."""
    if not token:
        return 0
    parts = token.split(".")
    if len(parts) != 3:
        return 0
    payload = f"{parts[0]}.{parts[1]}"
    if not hmac.compare_digest(_sign(payload), parts[2]):
        return 0
    try:
        user_id = int(parts[0])
        issued = int(parts[1])
    except ValueError:
        return 0
    if issued + SESSION_MAX_AGE < int(time.time()):
        return 0
    return max(user_id, 0)


def make_reset_token() -> str:
    return secrets.token_urlsafe(32)
