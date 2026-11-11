import logging
from typing import TypedDict

import reflex as rx

from droppilot_release_manager import lyric_bridge
from sqlalchemy import select

from droppilot_release_manager.models import Campaign, Pitch, PitchStatus, Release

FACTUALITY_NOTE = (
    "Every draft is written only from the details you gave DropPilot. It never "
    "invents stream counts, playlist adds, press quotes or awards. Add real "
    "numbers yourself only if you can back them up."
)

CATEGORY_META: dict[str, dict[str, str | int | bool]] = {
    "Spotify editorial pitch": {
        "label": "Spotify editorial",
        "icon": "audio-lines",
        "has_subject": False,
        "limit": 500,
        "guidance": (
            "Spotify for Artists allows roughly 500 characters and no links. "
            "Lead with genre, mood and instrumentation, then who it is for. "
            "Pitch at least seven days before release day."
        ),
    },
    "Radio introduction": {
        "label": "Radio introduction",
        "icon": "radio",
        "has_subject": True,
        "limit": 1200,
        "guidance": (
            "Specialist radio and DJs skim. Keep it to a short paragraph, name "
            "the genre and BPM feel, and mention that a clean edit is "
            "available on request."
        ),
    },
    "Music blog email": {
        "label": "Music-blog email",
        "icon": "newspaper",
        "has_subject": True,
        "limit": 1800,
        "guidance": (
            "Address the writer by name, say why their publication fits, and "
            "offer an early private listen. Never paste the whole press "
            "release into the email body."
        ),
    },
    "Playlist curator message": {
        "label": "Playlist curator",
        "icon": "list-music",
        "has_subject": True,
        "limit": 900,
        "guidance": (
            "Independent curators get hundreds of messages. Name the playlist, "
            "compare the track to two artists already on it, and keep it under "
            "a screen of text."
        ),
    },
    "Short artist biography": {
        "label": "Artist biography",
        "icon": "user-round",
        "has_subject": False,
        "limit": 800,
        "guidance": (
            "One short paragraph in the third person for press pages and "
            "playlist submissions. Facts only \u2014 where you are from, what "
            "you make and what is out now."
        ),
    },
    "Social release announcement": {
        "label": "Social announcement",
        "icon": "megaphone",
        "has_subject": False,
        "limit": 280,
        "guidance": (
            "Fits X and short captions at 280 characters. Say the title, the "
            "date and one line of feeling. Put the link in the first comment "
            "if the platform buries links."
        ),
    },
}

FALLBACK_META: dict[str, dict[str, str | int | bool]] = {
    "playlist": {
        "label": "Playlist pitch",
        "icon": "list-music",
        "has_subject": True,
        "limit": 900,
        "guidance": "Keep it short, factual and specific to the playlist.",
    },
    "blog": {
        "label": "Blog pitch",
        "icon": "newspaper",
        "has_subject": True,
        "limit": 1800,
        "guidance": "Offer an early listen and keep claims verifiable.",
    },
    "radio": {
        "label": "Radio pitch",
        "icon": "radio",
        "has_subject": True,
        "limit": 1200,
        "guidance": "Mention the genre, the release date and available edits.",
    },
    "press": {
        "label": "Press note",
        "icon": "user-round",
        "has_subject": True,
        "limit": 1500,
        "guidance": "Facts only. Attach artwork and photos separately.",
    },
    "label": {
        "label": "Label pitch",
        "icon": "building-2",
        "has_subject": True,
        "limit": 1500,
        "guidance": "Be direct about what you are asking for.",
    },
    "sync": {
        "label": "Sync pitch",
        "icon": "clapperboard",
        "has_subject": True,
        "limit": 1200,
        "guidance": "State clearly who controls the master and publishing.",
    },
}


class PitchCard(TypedDict):
    id: int
    label: str
    icon: str
    target_type: str
    target_name: str
    has_subject: bool
    limit: int
    guidance: str
    subject: str
    body: str
    status: str


EMPTY_CARD: PitchCard = {
    "id": 0,
    "label": "",
    "icon": "send",
    "target_type": "",
    "target_name": "",
    "has_subject": True,
    "limit": 1200,
    "guidance": "",
    "subject": "",
    "body": "",
    "status": "draft",
}


class PitchState(rx.State):
    """Owned pitch workspace for a single campaign."""

    is_loading: bool = True
    not_found: bool = False
    is_saving: bool = False
    error: str = ""
    notice: str = ""
    campaign_name: str = ""
    song_title: str = ""
    factuality_note: str = FACTUALITY_NOTE
    cards: list[PitchCard] = []
    active_id: int = 0
    edit_subject: str = ""
    edit_body: str = ""

    @rx.var
    def campaign_url(self) -> str:
        raw = str(self.router.page.params.get("campaign_id", ""))
        try:
            return f"/campaigns/{int(raw)}"
        except ValueError:
            return "/dashboard"

    @rx.var
    def active(self) -> PitchCard:
        for card in self.cards:
            if card["id"] == self.active_id:
                return card
        return EMPTY_CARD

    @rx.var
    def body_count(self) -> int:
        return len(self.edit_body)

    @rx.var
    def subject_count(self) -> int:
        return len(self.edit_subject)

    @rx.var
    def over_limit(self) -> bool:
        return len(self.edit_body) > self.active["limit"]

    @rx.var
    def is_dirty(self) -> bool:
        card = self.active
        return (
            self.edit_body != card["body"]
            or self.edit_subject != card["subject"]
        )

    async def _uid(self) -> int:
        from droppilot_release_manager.states.auth_state import AuthState

        auth = await self.get_state(AuthState)
        return auth.user_id

    def _campaign_id(self) -> int:
        raw = str(self.router.page.params.get("campaign_id", ""))
        try:
            return int(raw)
        except ValueError:
            return 0

    @staticmethod
    def _meta(
        target_name: str, target_type: str
    ) -> dict[str, str | int | bool]:
        meta = CATEGORY_META.get(target_name)
        if meta is None:
            meta = FALLBACK_META.get(target_type)
        if meta is None:
            meta = {
                "label": target_name or "Pitch draft",
                "icon": "send",
                "has_subject": True,
                "limit": 1500,
                "guidance": "Keep every claim verifiable.",
            }
        return meta

    @rx.event
    async def load(self):
        uid = await self._uid()
        cid = self._campaign_id()
        self.is_loading = True
        self.not_found = False
        self.error = ""
        self.notice = ""
        yield
        if uid <= 0:
            self.is_loading = False
            yield rx.redirect(lyric_bridge.app_url("login.html"))
            return
        if cid <= 0:
            self.is_loading = False
            self.not_found = True
            return
        try:
            async with rx.asession() as session:
                campaign = (
                    await session.scalars(
                        select(Campaign).where(
                            Campaign.id == cid, Campaign.user_id == uid
                        )
                    )
                ).first()
                if campaign is None:
                    self.cards = []
                    self.not_found = True
                    self.is_loading = False
                    return
                self.campaign_name = campaign.name
                release = None
                if campaign.release_id is not None:
                    release = (
                        await session.scalars(
                            select(Release).where(
                                Release.id == campaign.release_id,
                                Release.user_id == uid,
                            )
                        )
                    ).first()
                self.song_title = (
                    release.title if release is not None else campaign.name
                )
                rows = (
                    await session.scalars(
                        select(Pitch)
                        .where(
                            Pitch.campaign_id == campaign.id,
                            Pitch.user_id == uid,
                        )
                        .order_by(Pitch.id)
                    )
                ).all()
                cards: list[PitchCard] = []
                for row in rows:
                    meta = self._meta(row.target_name, row.target_type)
                    cards.append(
                        {
                            "id": int(row.id),
                            "label": str(meta["label"]),
                            "icon": str(meta["icon"]),
                            "target_type": row.target_type,
                            "target_name": row.target_name,
                            "has_subject": bool(meta["has_subject"]),
                            "limit": int(meta["limit"]),
                            "guidance": str(meta["guidance"]),
                            "subject": row.subject,
                            "body": row.body,
                            "status": row.status,
                        }
                    )
                self.cards = cards
                if cards:
                    match = [c for c in cards if c["id"] == self.active_id]
                    current = match[0] if match else cards[0]
                    self.active_id = current["id"]
                    self.edit_subject = current["subject"]
                    self.edit_body = current["body"]
                else:
                    self.active_id = 0
                    self.edit_subject = ""
                    self.edit_body = ""
        except Exception as e:
            logging.exception(f"Pitch load failed: {e}")
            self.error = "We could not load these pitch drafts. Please refresh."
        self.is_loading = False

    @rx.event
    def select_card(self, pitch_id: int):
        for card in self.cards:
            if card["id"] == pitch_id:
                self.active_id = pitch_id
                self.edit_subject = card["subject"]
                self.edit_body = card["body"]
                self.error = ""
                self.notice = ""
                return

    @rx.event
    def set_subject(self, value: str):
        self.edit_subject = value
        self.notice = ""

    @rx.event
    def set_body(self, value: str):
        self.edit_body = value
        self.notice = ""

    @rx.event
    def revert(self):
        card = self.active
        self.edit_subject = card["subject"]
        self.edit_body = card["body"]
        self.notice = "Reverted to the saved draft."

    @rx.event
    async def save(self):
        uid = await self._uid()
        if uid > 0 and not await lyric_bridge.can_write(uid):
            self.error = lyric_bridge.READ_ONLY_MESSAGE
            return
        cid = self._campaign_id()
        pitch_id = self.active_id
        if uid <= 0 or cid <= 0 or pitch_id <= 0:
            return
        if not self.edit_body.strip():
            self.error = "The draft needs a body before you can save it."
            return
        self.is_saving = True
        self.error = ""
        yield
        try:
            async with rx.asession() as session:
                pitch = (
                    await session.scalars(
                        select(Pitch).where(
                            Pitch.id == pitch_id,
                            Pitch.user_id == uid,
                            Pitch.campaign_id == cid,
                        )
                    )
                ).first()
                if pitch is None:
                    self.is_saving = False
                    self.error = "That draft is no longer available."
                    return
                pitch.subject = self.edit_subject.strip()[:240]
                pitch.body = self.edit_body
                if pitch.status == PitchStatus.DRAFT.value:
                    pitch.status = PitchStatus.READY.value
                await session.commit()
        except Exception as e:
            logging.exception(f"Pitch save failed: {e}")
            self.is_saving = False
            self.error = "We could not save that draft. Please try again."
            return
        self.is_saving = False
        for index, card in enumerate(self.cards):
            if card["id"] == pitch_id:
                updated = dict(card)
                updated["subject"] = self.edit_subject.strip()[:240]
                updated["body"] = self.edit_body
                if updated["status"] == PitchStatus.DRAFT.value:
                    updated["status"] = PitchStatus.READY.value
                self.cards[index] = updated  # type: ignore[assignment]
                break
        self.notice = "Draft saved."
