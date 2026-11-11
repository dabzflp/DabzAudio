import datetime
import logging
from typing import TypedDict

import reflex as rx

from droppilot_release_manager import lyric_bridge
from sqlalchemy import select

from droppilot_release_manager.models import (
    ArtistProfile,
    Campaign,
    CampaignItem,
    CampaignItemStatus,
    Pitch,
    Release,
    utcnow,
)

STATUS_LABELS: dict[str, str] = {
    "todo": "Not started",
    "in_progress": "In progress",
    "scheduled": "Scheduled",
    "done": "Completed",
    "skipped": "Skipped",
}

STATUS_CHOICES: list[dict[str, str]] = [
    {"value": "todo", "label": "Not started"},
    {"value": "in_progress", "label": "In progress"},
    {"value": "done", "label": "Completed"},
    {"value": "skipped", "label": "Skipped"},
]

TABS: list[dict[str, str]] = [
    {"value": "overview", "label": "Overview", "icon": "layout-dashboard"},
    {"value": "calendar", "label": "Calendar", "icon": "calendar-days"},
    {"value": "ideas", "label": "Content Ideas", "icon": "lightbulb"},
    {"value": "pitches", "label": "Pitches", "icon": "send"},
    {"value": "assets", "label": "Assets", "icon": "folder"},
]


class ItemRow(TypedDict):
    id: int
    day_number: int
    week_number: int
    title: str
    body: str
    caption: str
    hashtags: str
    item_type: str
    platform: str
    status: str
    status_label: str
    phase: str
    phase_label: str
    scheduled: str
    scheduled_iso: str
    opening_hook: str
    content_concept: str
    script_notes: str
    song_section: str
    suggested_lyric: str
    call_to_action: str
    prep_minutes: int


class PitchRow(TypedDict):
    id: int
    target_type: str
    target_name: str
    subject: str
    body: str
    status: str


class CampaignHeader(TypedDict):
    id: int
    name: str
    goal: str
    status: str
    song_title: str
    artist_name: str
    artwork: str
    audio_name: str
    artwork_name: str
    release_date: str
    countdown_label: str
    genre: str
    mood: str
    objectives: str
    locations: str
    personality: str
    resources: str
    audience: str
    instructions: str
    methodology: str
    is_demo: bool
    lyrics: str


EMPTY_HEADER: CampaignHeader = {
    "id": 0,
    "name": "",
    "goal": "",
    "status": "",
    "song_title": "",
    "artist_name": "",
    "artwork": "",
    "audio_name": "",
    "artwork_name": "",
    "release_date": "",
    "countdown_label": "",
    "genre": "",
    "mood": "",
    "objectives": "",
    "locations": "",
    "personality": "",
    "resources": "",
    "audience": "",
    "instructions": "",
    "methodology": "",
    "is_demo": False,
    "lyrics": "",
}

EMPTY_ITEM: ItemRow = {
    "id": 0,
    "day_number": 0,
    "week_number": 0,
    "title": "",
    "body": "",
    "caption": "",
    "hashtags": "",
    "item_type": "",
    "platform": "",
    "status": "todo",
    "status_label": "Not started",
    "phase": "pre_release",
    "phase_label": "Pre-release",
    "scheduled": "",
    "scheduled_iso": "",
    "opening_hook": "",
    "content_concept": "",
    "script_notes": "",
    "song_section": "",
    "suggested_lyric": "",
    "call_to_action": "",
    "prep_minutes": 0,
}


class CampaignDetailState(rx.State):
    """Owned campaign detail: every read and write is scoped by user_id."""

    is_loading: bool = True
    not_found: bool = False
    error: str = ""
    notice: str = ""
    is_saving: bool = False
    tab: str = "overview"
    tabs: list[dict[str, str]] = TABS
    status_choices: list[dict[str, str]] = STATUS_CHOICES
    phase_filter: str = "all"
    platform_filter: str = "all"
    status_filter: str = "all"
    header: CampaignHeader = EMPTY_HEADER
    items: list[ItemRow] = []
    pitches: list[PitchRow] = []
    selected: ItemRow = EMPTY_ITEM
    panel_open: bool = False
    delete_open: bool = False
    edit_title: str = ""
    edit_hook: str = ""
    edit_concept: str = ""
    edit_script: str = ""
    edit_caption: str = ""
    edit_hashtags: str = ""
    edit_cta: str = ""
    edit_date: str = ""

    @rx.var
    def platform_options(self) -> list[str]:
        seen: list[str] = []
        for item in self.items:
            if item["platform"] not in seen:
                seen.append(item["platform"])
        return ["all"] + seen

    @rx.var
    def filtered_items(self) -> list[ItemRow]:
        rows = self.items
        if self.phase_filter != "all":
            rows = [r for r in rows if r["phase"] == self.phase_filter]
        if self.platform_filter != "all":
            rows = [r for r in rows if r["platform"] == self.platform_filter]
        if self.status_filter != "all":
            rows = [r for r in rows if r["status"] == self.status_filter]
        return rows

    @rx.var
    def total_items(self) -> int:
        return len(self.items)

    @rx.var
    def done_items(self) -> int:
        return len([i for i in self.items if i["status"] == "done"])

    @rx.var
    def progress_percent(self) -> int:
        if not self.items:
            return 0
        return int(self.done_items / len(self.items) * 100)

    @rx.var
    def prep_hours(self) -> str:
        minutes = sum(i["prep_minutes"] for i in self.items)
        return f"{minutes / 60:.1f}"

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

    @rx.event
    async def load(self):
        uid = await self._uid()
        cid = self._campaign_id()
        self.is_loading = True
        self.not_found = False
        self.error = ""
        self.notice = ""
        self.panel_open = False
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
                    self.is_loading = False
                    self.not_found = True
                    self.header = EMPTY_HEADER
                    self.items = []
                    self.pitches = []
                    return
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
                profile = (
                    await session.scalars(
                        select(ArtistProfile).where(
                            ArtistProfile.user_id == uid
                        )
                    )
                ).first()
                date = release.release_date if release else campaign.start_date
                days = (date - datetime.date.today()).days if date else 0
                self.header = {
                    "id": int(campaign.id),
                    "name": campaign.name,
                    "goal": campaign.goal,
                    "status": campaign.status.replace("_", " "),
                    "song_title": release.title if release else campaign.name,
                    "artist_name": profile.artist_name if profile else "",
                    "artwork": release.artwork_path if release else "",
                    "audio_name": release.audio_name if release else "",
                    "artwork_name": release.artwork_name if release else "",
                    "release_date": (
                        date.strftime("%d %B %Y") if date else "No date set"
                    ),
                    "countdown_label": (
                        f"{days} days to release"
                        if days > 0
                        else (
                            "Release day"
                            if days == 0
                            else f"{abs(days)} days since release"
                        )
                    ),
                    "genre": release.primary_genre if release else "",
                    "mood": release.mood if release else "",
                    "objectives": campaign.objectives.replace(",", ", "),
                    "locations": campaign.target_locations,
                    "personality": campaign.content_personality.replace(
                        "_", " "
                    ),
                    "resources": campaign.resources.replace(",", ", "),
                    "audience": campaign.target_audience,
                    "instructions": campaign.instructions,
                    "methodology": campaign.methodology,
                    "is_demo": bool(campaign.is_demo),
                    "lyrics": release.lyrics if release else "",
                }
                rows = (
                    await session.scalars(
                        select(CampaignItem)
                        .where(CampaignItem.campaign_id == campaign.id)
                        .order_by(CampaignItem.day_number)
                    )
                ).all()
                self.items = [self._item_row(r) for r in rows]
                pitches = (
                    await session.scalars(
                        select(Pitch).where(
                            Pitch.campaign_id == campaign.id,
                            Pitch.user_id == uid,
                        )
                    )
                ).all()
                self.pitches = [
                    {
                        "id": int(p.id),
                        "target_type": p.target_type,
                        "target_name": p.target_name,
                        "subject": p.subject,
                        "body": p.body,
                        "status": p.status,
                    }
                    for p in pitches
                ]
        except Exception as e:
            logging.exception(f"Campaign load failed: {e}")
            self.error = "We could not load this campaign. Please refresh."
        self.is_loading = False

    def _item_row(self, item: CampaignItem) -> ItemRow:
        return {
            "id": int(item.id),
            "day_number": int(item.day_number),
            "week_number": int(item.week_number),
            "title": item.title,
            "body": item.body,
            "caption": item.caption,
            "hashtags": item.hashtags,
            "item_type": item.item_type,
            "platform": item.platform,
            "status": item.status,
            "status_label": STATUS_LABELS.get(item.status, "Not started"),
            "phase": item.campaign_phase,
            "phase_label": item.campaign_phase.replace("_", " ").title(),
            "scheduled": (
                item.scheduled_for.strftime("%a %d %b")
                if item.scheduled_for
                else "Unscheduled"
            ),
            "scheduled_iso": (
                item.scheduled_for.isoformat() if item.scheduled_for else ""
            ),
            "opening_hook": item.opening_hook,
            "content_concept": item.content_concept,
            "script_notes": item.script_notes,
            "song_section": item.song_section,
            "suggested_lyric": item.suggested_lyric,
            "call_to_action": item.call_to_action,
            "prep_minutes": int(item.prep_minutes),
        }

    # ------------------------------------------------------------------
    # view controls
    # ------------------------------------------------------------------

    @rx.event
    def set_tab(self, value: str):
        self.tab = value

    @rx.event
    def set_phase_filter(self, value: str):
        self.phase_filter = value

    @rx.event
    def set_platform_filter(self, value: str):
        self.platform_filter = value

    @rx.event
    def set_status_filter(self, value: str):
        self.status_filter = value

    @rx.event
    def clear_filters(self):
        self.phase_filter = "all"
        self.platform_filter = "all"
        self.status_filter = "all"

    @rx.event
    def open_item(self, item_id: int):
        for row in self.items:
            if row["id"] == item_id:
                self.selected = row
                self.edit_title = row["title"]
                self.edit_hook = row["opening_hook"]
                self.edit_concept = row["content_concept"]
                self.edit_script = row["script_notes"]
                self.edit_caption = row["caption"]
                self.edit_hashtags = row["hashtags"]
                self.edit_cta = row["call_to_action"]
                self.edit_date = row["scheduled_iso"]
                self.panel_open = True
                self.error = ""
                self.notice = ""
                return

    @rx.event
    def close_panel(self):
        self.panel_open = False

    @rx.event
    def set_edit_field(self, field: str, value: str):
        allowed = {
            "edit_title",
            "edit_hook",
            "edit_concept",
            "edit_script",
            "edit_caption",
            "edit_hashtags",
            "edit_cta",
            "edit_date",
        }
        if field in allowed:
            setattr(self, field, value)
            self.error = ""

    @rx.event
    def open_delete(self):
        self.delete_open = True

    @rx.event
    def close_delete(self):
        self.delete_open = False

    # ------------------------------------------------------------------
    # owned writes
    # ------------------------------------------------------------------

    async def _owned_item(self, session, uid: int, item_id: int):
        return (
            await session.scalars(
                select(CampaignItem)
                .join(Campaign, Campaign.id == CampaignItem.campaign_id)
                .where(
                    CampaignItem.id == item_id,
                    Campaign.user_id == uid,
                )
            )
        ).first()

    @rx.event
    async def save_item(self):
        uid = await self._uid()
        if uid > 0 and not await lyric_bridge.can_write(uid):
            self.error = lyric_bridge.READ_ONLY_MESSAGE
            return
        item_id = self.selected["id"]
        if uid <= 0 or item_id <= 0:
            return
        if not self.edit_title.strip():
            self.error = "The item needs a title."
            return
        new_date: datetime.date | None = None
        if self.edit_date:
            try:
                new_date = datetime.date.fromisoformat(self.edit_date)
            except ValueError:
                self.error = "That date is not valid. Use the date picker."
                return
        self.is_saving = True
        yield
        try:
            async with rx.asession() as session:
                item = await self._owned_item(session, uid, item_id)
                if item is None:
                    self.is_saving = False
                    self.error = "That item is no longer available."
                    return
                item.title = self.edit_title.strip()[:200]
                item.opening_hook = self.edit_hook
                item.content_concept = self.edit_concept
                item.script_notes = self.edit_script
                item.caption = self.edit_caption
                item.hashtags = self.edit_hashtags[:400]
                item.call_to_action = self.edit_cta[:300]
                if new_date is not None:
                    item.scheduled_for = new_date
                await session.commit()
        except Exception as e:
            logging.exception(f"Item save failed: {e}")
            self.is_saving = False
            self.error = "We could not save that item. Please try again."
            return
        self.is_saving = False
        self.notice = "Saved."
        yield CampaignDetailState.reload_items

    @rx.event
    async def set_item_status(self, item_id: int, status: str):
        uid = await self._uid()
        if uid <= 0 or status not in {s.value for s in CampaignItemStatus}:
            return
        try:
            async with rx.asession() as session:
                item = await self._owned_item(session, uid, item_id)
                if item is None:
                    self.error = "That item is no longer available."
                    return
                item.status = status
                item.completed_at = (
                    utcnow()
                    if status == CampaignItemStatus.DONE.value
                    else None
                )
                await session.commit()
        except Exception as e:
            logging.exception(f"Status update failed: {e}")
            self.error = "We could not update that item."
            return
        yield CampaignDetailState.reload_items

    @rx.event
    async def reload_items(self):
        uid = await self._uid()
        cid = self._campaign_id()
        if uid <= 0 or cid <= 0:
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
                    self.not_found = True
                    return
                rows = (
                    await session.scalars(
                        select(CampaignItem)
                        .where(CampaignItem.campaign_id == campaign.id)
                        .order_by(CampaignItem.day_number)
                    )
                ).all()
                self.items = [self._item_row(r) for r in rows]
                for row in self.items:
                    if row["id"] == self.selected["id"]:
                        self.selected = row
        except Exception as e:
            logging.exception(f"Item reload failed: {e}")

    @rx.event
    async def delete_campaign(self):
        uid = await self._uid()
        if uid > 0 and not await lyric_bridge.can_write(uid):
            self.error = lyric_bridge.READ_ONLY_MESSAGE
            return
        cid = self._campaign_id()
        if uid <= 0 or cid <= 0:
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
                    self.delete_open = False
                    self.not_found = True
                    return
                await session.delete(campaign)
                await session.commit()
        except Exception as e:
            logging.exception(f"Campaign delete failed: {e}")
            self.error = "We could not delete this campaign."
            return
        self.delete_open = False
        yield rx.redirect("/dashboard")
