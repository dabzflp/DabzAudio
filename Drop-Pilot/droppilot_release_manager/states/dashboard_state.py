import datetime
import logging
import secrets
from typing import TypedDict

import reflex as rx

from droppilot_release_manager import lyric_bridge
from sqlalchemy import func, select

from droppilot_release_manager import campaign_generator as gen
from droppilot_release_manager.models import (
    ArtistProfile,
    Campaign,
    CampaignItem,
    CampaignItemStatus,
    CampaignStatus,
    Pitch,
    PitchStatus,
    Release,
    ReleaseType,
    Subscription,
    utcnow,
)

PLAN_LABELS: dict[str, str] = {
    "free": "Free",
    "indie": "Artist",
    "pro": "Pro",
    "label": "Manager",
}


class TaskRow(TypedDict):
    id: int
    campaign_id: int
    title: str
    platform: str
    item_type: str
    status: str
    phase: str
    scheduled: str
    day_number: int
    prep_minutes: int


class ReleaseRow(TypedDict):
    id: int
    title: str
    genre: str
    release_date: str
    artwork: str
    campaign_id: int
    item_count: int


class ActiveRelease(TypedDict):
    campaign_id: int
    campaign_name: str
    title: str
    artwork: str
    goal: str
    release_date: str
    countdown: int
    countdown_label: str
    total_items: int
    done_items: int
    progress: int
    is_demo: bool


EMPTY_ACTIVE: ActiveRelease = {
    "campaign_id": 0,
    "campaign_name": "",
    "title": "",
    "artwork": "",
    "goal": "",
    "release_date": "",
    "countdown": 0,
    "countdown_label": "",
    "total_items": 0,
    "done_items": 0,
    "progress": 0,
    "is_demo": False,
}


def countdown_label(days: int) -> str:
    if days > 1:
        return f"{days} days to release"
    if days == 1:
        return "Tomorrow"
    if days == 0:
        return "Release day"
    return f"{abs(days)} days since release"


class DashboardState(rx.State):
    """Overview data, always scoped to the signed-in user's own rows."""

    is_loading: bool = True
    is_seeding: bool = False
    error: str = ""
    notice: str = ""
    artist_name: str = ""
    plan_label: str = "Free"
    plan_status: str = ""
    campaign_quota: int = 1
    campaign_count: int = 0
    release_count: int = 0
    items_total: int = 0
    items_done: int = 0
    has_demo: bool = False
    active: ActiveRelease = EMPTY_ACTIVE
    today_tasks: list[TaskRow] = []
    upcoming: list[TaskRow] = []
    recent_releases: list[ReleaseRow] = []

    @rx.var
    def quota_reached(self) -> bool:
        return self.campaign_quota > 0 and (
            self.campaign_count >= self.campaign_quota
        )

    @rx.var
    def quota_label(self) -> str:
        if self.campaign_quota <= 0:
            return f"{self.campaign_count} campaigns \u00b7 unlimited"
        return f"{self.campaign_count} of {self.campaign_quota} campaigns used"

    @rx.var
    def has_campaigns(self) -> bool:
        return self.campaign_count > 0

    @rx.var
    def completion_percent(self) -> int:
        if self.items_total <= 0:
            return 0
        return int(self.items_done / self.items_total * 100)

    async def _uid(self) -> int:
        from droppilot_release_manager.states.auth_state import AuthState

        auth = await self.get_state(AuthState)
        return auth.user_id

    @rx.event
    async def load(self):
        uid = await self._uid()
        self.error = ""
        self.is_loading = True
        yield
        if uid <= 0:
            self.is_loading = False
            return
        try:
            async with rx.asession() as session:
                profile = (
                    await session.scalars(
                        select(ArtistProfile).where(
                            ArtistProfile.user_id == uid
                        )
                    )
                ).first()
                self.artist_name = profile.artist_name if profile else ""

                sub = (
                    await session.scalars(
                        select(Subscription).where(Subscription.user_id == uid)
                    )
                ).first()
                if sub is not None:
                    self.plan_label = PLAN_LABELS.get(sub.plan, "Free")
                    self.plan_status = sub.status.replace("_", " ")
                    self.campaign_quota = sub.campaign_quota

                campaigns = (
                    await session.scalars(
                        select(Campaign)
                        .where(Campaign.user_id == uid)
                        .order_by(Campaign.created_at.desc())
                    )
                ).all()
                self.campaign_count = len(campaigns)
                self.has_demo = any(c.is_demo for c in campaigns)

                releases = (
                    await session.scalars(
                        select(Release)
                        .where(Release.user_id == uid)
                        .order_by(Release.created_at.desc())
                        .limit(6)
                    )
                ).all()
                self.release_count = int(
                    (
                        await session.scalars(
                            select(func.count(Release.id)).where(
                                Release.user_id == uid
                            )
                        )
                    ).first()
                    or 0
                )

                campaign_ids = [c.id for c in campaigns]
                items: list[CampaignItem] = []
                if campaign_ids:
                    items = list(
                        (
                            await session.scalars(
                                select(CampaignItem)
                                .where(
                                    CampaignItem.campaign_id.in_(campaign_ids)
                                )
                                .order_by(CampaignItem.scheduled_for)
                            )
                        ).all()
                    )
                self.items_total = len(items)
                self.items_done = sum(
                    1
                    for i in items
                    if i.status == CampaignItemStatus.DONE.value
                )

                today = datetime.date.today()
                self.today_tasks = [
                    self._task_row(i) for i in items if i.scheduled_for == today
                ][:8]
                self.upcoming = [
                    self._task_row(i)
                    for i in items
                    if i.scheduled_for is not None
                    and today
                    < i.scheduled_for
                    <= today + datetime.timedelta(days=10)
                ][:8]

                by_release = {r.id: r for r in releases}
                counts: dict[int, int] = {}
                for i in items:
                    counts[i.campaign_id] = counts.get(i.campaign_id, 0) + 1
                release_campaign: dict[int, int] = {}
                for c in campaigns:
                    if c.release_id is not None:
                        release_campaign.setdefault(c.release_id, c.id)
                self.recent_releases = [
                    {
                        "id": int(r.id),
                        "title": r.title,
                        "genre": r.primary_genre,
                        "release_date": (
                            r.release_date.strftime("%d %b %Y")
                            if r.release_date
                            else "No date set"
                        ),
                        "artwork": r.artwork_path,
                        "campaign_id": int(release_campaign.get(r.id, 0)),
                        "item_count": int(
                            counts.get(release_campaign.get(r.id, 0), 0)
                        ),
                    }
                    for r in releases
                ]

                self.active = self._active_row(
                    campaigns, by_release, items, today
                )
        except Exception as e:
            logging.exception(f"Dashboard load failed: {e}")
            self.error = "We could not load your studio. Please refresh."
        self.is_loading = False

    def _task_row(self, item: CampaignItem) -> TaskRow:
        return {
            "id": int(item.id),
            "campaign_id": int(item.campaign_id),
            "title": item.title,
            "platform": item.platform.replace("_", " "),
            "item_type": item.item_type,
            "status": item.status,
            "phase": item.campaign_phase.replace("_", " "),
            "scheduled": (
                item.scheduled_for.strftime("%a %d %b")
                if item.scheduled_for
                else "Unscheduled"
            ),
            "day_number": int(item.day_number),
            "prep_minutes": int(item.prep_minutes),
        }

    def _active_row(
        self,
        campaigns: list[Campaign],
        releases: dict[int, Release],
        items: list[CampaignItem],
        today: datetime.date,
    ) -> ActiveRelease:
        live = [
            c
            for c in campaigns
            if c.status
            in {CampaignStatus.ACTIVE.value, CampaignStatus.DRAFT.value}
        ] or campaigns
        if not live:
            return EMPTY_ACTIVE
        chosen = live[0]
        release = (
            releases.get(chosen.release_id)
            if chosen.release_id is not None
            else None
        )
        own = [i for i in items if i.campaign_id == chosen.id]
        done = sum(1 for i in own if i.status == CampaignItemStatus.DONE.value)
        date = release.release_date if release else chosen.start_date
        days = (date - today).days if date else 0
        return {
            "campaign_id": int(chosen.id),
            "campaign_name": chosen.name,
            "title": release.title if release else chosen.name,
            "artwork": release.artwork_path if release else "",
            "goal": chosen.goal,
            "release_date": (
                date.strftime("%d %B %Y") if date else "No date set"
            ),
            "countdown": days,
            "countdown_label": countdown_label(days) if date else "No date set",
            "total_items": len(own),
            "done_items": done,
            "progress": int(done / len(own) * 100) if own else 0,
            "is_demo": bool(chosen.is_demo),
        }

    # ------------------------------------------------------------------
    # demo campaign
    # ------------------------------------------------------------------

    @rx.event
    async def load_demo_campaign(self):
        uid = await self._uid()
        if uid > 0 and not await lyric_bridge.can_write(uid):
            self.error = lyric_bridge.READ_ONLY_MESSAGE
            return
        self.error = ""
        self.notice = ""
        if uid <= 0:
            yield rx.redirect(lyric_bridge.app_url("login.html"))
            return
        if self.has_demo:
            self.notice = "You already have a demo campaign loaded."
            return
        self.is_seeding = True
        yield
        new_campaign_id = 0
        try:
            async with rx.asession() as session:
                existing = (
                    await session.scalars(
                        select(Campaign).where(
                            Campaign.user_id == uid,
                            Campaign.is_demo == True,  # noqa: E712
                        )
                    )
                ).first()
                if existing is not None:
                    self.is_seeding = False
                    self.has_demo = True
                    self.notice = "You already have a demo campaign loaded."
                    return
                profile = (
                    await session.scalars(
                        select(ArtistProfile).where(
                            ArtistProfile.user_id == uid
                        )
                    )
                ).first()
                artist = profile.artist_name if profile else "Your project"
                genre = (profile.genre if profile else "") or "Indie"
                release_date = datetime.date.today() + datetime.timedelta(
                    days=10
                )
                release = Release(
                    user_id=uid,
                    title="Neon Hours (Demo)",
                    release_type=ReleaseType.SINGLE.value,
                    primary_genre=genre,
                    secondary_genre="Alternative",
                    mood="late-night, hopeful",
                    description=(
                        "An example release so you can see a complete 21-day "
                        "plan before uploading your own song."
                    ),
                    release_date=release_date,
                    lyrics=(
                        "Neon hours on the ring road\n"
                        "I keep the windows down to stay awake\n"
                        "Every chorus is a promise that I make\n"
                        "Nothing closes till the morning\n"
                    ),
                )
                session.add(release)
                await session.flush()

                campaign = Campaign(
                    user_id=uid,
                    release_id=release.id,
                    name="Neon Hours \u00b7 21-day rollout (Demo)",
                    goal="Grow streams and land two playlists",
                    status=CampaignStatus.ACTIVE.value,
                    target_audience="Late-night listeners, 18\u201334",
                    duration_days=21,
                    start_date=release_date - datetime.timedelta(days=13),
                    end_date=release_date + datetime.timedelta(days=7),
                    objectives="streams,playlists,fans",
                    target_locations="London, Manchester, Berlin",
                    content_personality="storyteller",
                    resources="phone_video,design,email_list",
                    weekly_capacity=5,
                    budget_band="under_100",
                    instructions="Keep everything low-budget and honest.",
                    methodology=gen.METHODOLOGY_NOTE,
                    platforms="instagram,tiktok,youtube,email",
                    is_demo=True,
                    generated_at=utcnow(),
                    public_token=secrets.token_urlsafe(16),
                )
                session.add(campaign)
                await session.flush()

                ctx = gen.GenerationContext(
                    artist_name=artist,
                    song_title="Neon Hours",
                    genre=genre,
                    secondary_genre="Alternative",
                    mood="late-night, hopeful",
                    lyrics=release.lyrics,
                    objectives=["streams", "playlists", "fans"],
                    personality="storyteller",
                    resources=["phone_video", "design", "email_list"],
                    audience="Late-night listeners, 18\u201334",
                    locations="London, Manchester, Berlin",
                    weekly_capacity=5,
                    release_date=release_date,
                )
                items, pitches = gen.generate_campaign(ctx)
                for order, draft in enumerate(items):
                    session.add(
                        CampaignItem(
                            campaign_id=campaign.id,
                            day_number=draft.day_number,
                            week_number=draft.week_number,
                            title=draft.title,
                            body=draft.body,
                            caption=draft.caption,
                            hashtags=draft.hashtags,
                            item_type=draft.item_type,
                            platform=draft.platform,
                            scheduled_for=draft.scheduled_for,
                            sort_order=order,
                            campaign_phase=draft.campaign_phase,
                            opening_hook=draft.opening_hook,
                            content_concept=draft.content_concept,
                            script_notes=draft.script_notes,
                            song_section=draft.song_section,
                            suggested_lyric=draft.suggested_lyric,
                            call_to_action=draft.call_to_action,
                            prep_minutes=draft.prep_minutes,
                        )
                    )
                for pitch in pitches:
                    session.add(
                        Pitch(
                            user_id=uid,
                            campaign_id=campaign.id,
                            target_type=pitch.target_type,
                            target_name=pitch.target_name,
                            subject=pitch.subject,
                            body=pitch.body,
                            status=PitchStatus.DRAFT.value,
                        )
                    )
                await session.commit()
                new_campaign_id = campaign.id
        except Exception as e:
            logging.exception(f"Demo campaign creation failed: {e}")
            self.is_seeding = False
            self.error = (
                "We could not build the demo campaign. Please try again."
            )
            return

        self.is_seeding = False
        self.has_demo = True
        yield DashboardState.load
        yield rx.redirect(f"/campaigns/{new_campaign_id}")
