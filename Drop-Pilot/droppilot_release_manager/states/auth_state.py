import datetime
import logging
from typing import Any

import reflex as rx
from sqlalchemy import select

from droppilot_release_manager import lyric_bridge, security
from droppilot_release_manager.models import (
    ArtistProfile,
    Subscription,
    SubscriptionPlan,
    SubscriptionStatus,
    User,
    utcnow,
)

class AuthState(rx.State):
    """Session created from a Lyric Book hand-off. There is no sign-in here."""

    session_token: str = rx.Cookie(
        "",
        name="droppilot_session",
        max_age=security.SESSION_MAX_AGE,
        same_site="lax",
        path="/",
    )
    email: str = ""
    display_name: str = ""
    onboarding_complete: bool = False
    is_loading: bool = False
    error: str = ""
    notice: str = ""
    # Lyric Book decides who is Pro; lapsed Pro accounts are read-only.
    pro: bool = False
    credits: int = 0

    @rx.var
    def user_id(self) -> int:
        return security.read_session_token(self.session_token)

    @rx.var
    def is_authenticated(self) -> bool:
        return self.user_id > 0

    @rx.var
    def read_only(self) -> bool:
        return not self.pro

    @rx.var
    def initials(self) -> str:
        source = self.display_name or self.email
        parts = [p for p in source.replace("@", " ").split() if p]
        if not parts:
            return "DP"
        if len(parts) == 1:
            return parts[0][:2].upper()
        return f"{parts[0][0]}{parts[1][0]}".upper()

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------

    def _clear_messages(self) -> None:
        self.error = ""
        self.notice = ""

    async def _load_user(self) -> dict[str, bool] | None:
        uid = self.user_id
        if uid <= 0:
            return None
        try:
            async with rx.asession() as session:
                user = (
                    await session.scalars(select(User).where(User.id == uid))
                ).first()
                if user is None or not user.is_active:
                    return None
                self.email = user.email
                self.onboarding_complete = user.onboarding_complete
                profile = (
                    await session.scalars(
                        select(ArtistProfile).where(
                            ArtistProfile.user_id == uid
                        )
                    )
                ).first()
                self.display_name = (
                    profile.artist_name if profile else user.full_name
                ) or user.email.split("@")[0]
                return {"onboarding_complete": user.onboarding_complete}
        except Exception as e:
            logging.exception(f"Error loading session user: {e}")
            return None

    # ------------------------------------------------------------------
    # route guards
    # ------------------------------------------------------------------

    async def _guard(self, allow_onboarding: bool):
        self._clear_messages()
        user = await self._load_user()
        if user is None:
            self.session_token = ""
            return rx.redirect(lyric_bridge.app_url("subscription.html"))
        ent = await lyric_bridge.entitlement(self.user_id)
        if not ent.reachable:
            self.error = "Lyric Book could not be reached. Please try again."
        elif not ent.exists:
            # The Lyric Book account is gone, so this session is no longer valid.
            self.session_token = ""
            return rx.redirect(lyric_bridge.app_url("login.html"))
        self.pro = ent.pro
        self.credits = ent.credits
        if not allow_onboarding and not user["onboarding_complete"]:
            return rx.redirect("/onboarding")

    @rx.event
    async def require_auth(self):
        return await self._guard(False)

    @rx.event
    async def require_auth_allow_onboarding(self):
        return await self._guard(True)

    @rx.event
    async def refresh_entitlement(self):
        ent = await lyric_bridge.entitlement(self.user_id, fresh=True)
        self.pro = ent.pro
        self.credits = ent.credits

    # ------------------------------------------------------------------
    # hand-off from Lyric Book
    # ------------------------------------------------------------------

    @rx.event
    async def handoff(self):
        token = str(self.router.url.query_parameters.get("token", ""))
        info = lyric_bridge.verify_handoff(token)
        if info is None:
            logging.warning(
                "Drop Pilot hand-off rejected: token missing, expired, replayed, or invalid."
            )
            return rx.redirect(lyric_bridge.app_url("subscription.html"))
        try:
            onboarded = await self._upsert_user(info)
        except Exception as e:
            logging.exception(f"Hand-off failed: {e}")
            return rx.redirect(lyric_bridge.app_url("subscription.html"))
        self.session_token = security.make_session_token(info.uid)
        self.email = info.email
        self.onboarding_complete = onboarded
        return rx.redirect("/dashboard" if onboarded else "/onboarding")

    async def _upsert_user(self, info: "lyric_bridge.Handoff") -> bool:
        """Create (or refresh) the local row that mirrors the Lyric Book user."""
        async with rx.asession() as session:
            user = (
                await session.scalars(select(User).where(User.id == info.uid))
            ).first()
            name = info.name or info.email.split("@")[0]
            if user is None:
                user = User(
                    email=info.email,
                    # Unusable hash: this app never accepts passwords.
                    password_hash="!",
                    full_name=name,
                    email_verified=True,
                )
                user.id = info.uid
                session.add(user)
                await session.flush()
                session.add(
                    ArtistProfile(
                        user_id=info.uid,
                        artist_name=name,
                        slug=f"{security.slugify(name, 'artist')}-{info.uid}",
                    )
                )
                session.add(
                    Subscription(
                        user_id=info.uid,
                        plan=SubscriptionPlan.PRO.value,
                        status=SubscriptionStatus.ACTIVE.value,
                        price_cents=0,
                        # 0 means unlimited: credits and daily caps are the limit.
                        campaign_quota=0,
                    )
                )
            else:
                user.email = info.email or user.email
            user.is_active = True
            user.last_login_at = utcnow()
            await session.commit()
            return bool(user.onboarding_complete)

    @rx.event
    def back_to_lyric_book(self):
        self.session_token = ""
        self.email = ""
        self.display_name = ""
        self.onboarding_complete = False
        self._clear_messages()
        return rx.redirect(lyric_bridge.app_url("app.html"))
