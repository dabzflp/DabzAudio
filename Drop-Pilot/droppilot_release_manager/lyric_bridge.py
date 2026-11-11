"""Connection to Lyric Book, which owns identity, billing and the AI keys.

Drop Pilot has no sign-in of its own: Lyric Book hands the user over with a
short-lived signed token, and every AI call goes through Lyric Book's metered
gateway so credits and caps are enforced in one place.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from dataclasses import dataclass

import httpx
import jwt

HANDOFF_AUDIENCE = "droppilot"
HANDOFF_ISSUER = "lyricbook"
ENTITLEMENT_TTL = 30.0

_used_jti: dict[str, float] = {}
_jti_lock = threading.Lock()
_entitlements: dict[int, tuple[float, "Entitlement"]] = {}


def api_url() -> str:
    return os.environ.get("LYRICBOOK_API_URL", "http://localhost:4000").rstrip("/")


def app_url(path: str = "") -> str:
    base = os.environ.get("LYRICBOOK_APP_URL", f"{api_url()}/lyric-book").rstrip("/")
    return f"{base}/{path.lstrip('/')}" if path else base


def _service_headers() -> dict[str, str]:
    return {"x-service-key": os.environ.get("DROPPILOT_SERVICE_KEY", "")}


@dataclass
class Handoff:
    uid: int
    email: str
    name: str


def verify_handoff(token: str) -> Handoff | None:
    """Check signature, expiry, audience and issuer; each token works once."""
    secret = os.environ.get("DROPPILOT_SHARED_SECRET", "")
    if not secret or not token:
        return None
    try:
        claims = jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            audience=HANDOFF_AUDIENCE,
            issuer=HANDOFF_ISSUER,
            options={"require": ["exp", "jti", "uid"]},
        )
    except jwt.PyJWTError:
        return None
    jti = str(claims["jti"])
    now = time.time()
    with _jti_lock:
        for key, expiry in list(_used_jti.items()):
            if expiry < now:
                del _used_jti[key]
        if jti in _used_jti:
            return None
        _used_jti[jti] = float(claims["exp"]) + 5
    try:
        uid = int(claims["uid"])
    except (TypeError, ValueError):
        return None
    if uid <= 0:
        return None
    return Handoff(
        uid=uid,
        email=str(claims.get("email") or "").strip().lower(),
        name=str(claims.get("name") or "").strip(),
    )


@dataclass
class Entitlement:
    reachable: bool = False
    exists: bool = False
    pro: bool = False
    credits: int = 0

    @property
    def read_only(self) -> bool:
        return not self.pro


async def entitlement(uid: int, fresh: bool = False) -> Entitlement:
    cached = _entitlements.get(uid)
    now = time.time()
    if cached and not fresh and now - cached[0] < ENTITLEMENT_TTL:
        return cached[1]
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.get(
                f"{api_url()}/api/internal/droppilot/entitlement",
                params={"uid": uid},
                headers=_service_headers(),
            )
        resp.raise_for_status()
        data = resp.json()
        result = Entitlement(
            reachable=True,
            exists=bool(data.get("exists")),
            pro=bool(data.get("pro")),
            credits=int((data.get("balance") or {}).get("total") or 0),
        )
    except Exception as exc:
        logging.warning("Lyric Book entitlement check failed: %s", exc)
        # Keep working on a recent answer rather than locking users out.
        if cached and now - cached[0] < 600:
            return cached[1]
        return Entitlement(reachable=False)
    _entitlements[uid] = (now, result)
    return result


class AIError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


async def generate(uid: int, action: str, system: str, prompt: str, model_tier: str = "standard") -> tuple[str, int]:
    """Metered AI call. Returns (text, credits_left); raises AIError."""
    try:
        async with httpx.AsyncClient(timeout=180) as client:
            resp = await client.post(
                f"{api_url()}/api/internal/droppilot/ai",
                headers=_service_headers(),
                json={
                    "uid": uid,
                    "action": action,
                    "modelTier": model_tier,
                    "system": system,
                    "prompt": prompt,
                },
            )
    except Exception as exc:
        logging.warning("Lyric Book AI gateway unreachable: %s", exc)
        raise AIError("UNREACHABLE", "The AI service is unavailable right now.") from exc
    try:
        data = resp.json()
    except ValueError:
        data = {}
    if resp.status_code != 200:
        raise AIError(str(data.get("code") or "ERROR"), str(data.get("error") or "The AI request failed."))
    _entitlements.pop(uid, None)
    return str(data.get("text") or ""), int((data.get("balance") or {}).get("total") or 0)


READ_ONLY_MESSAGE = (
    "Your Pro plan is not active, so Drop Pilot is read-only. Renew Pro from your "
    "Lyric Book plan page to make changes."
)


async def can_write(uid: int) -> bool:
    """False only when Lyric Book confirms the account is not Pro.

    If Lyric Book can't be reached we don't block people from saving their work.
    """
    ent = await entitlement(uid)
    return ent.pro or not ent.reachable
