import datetime
import logging
from typing import TypedDict

import reflex as rx

from droppilot_release_manager import lyric_bridge
from sqlalchemy import select

from droppilot_release_manager.models import (
    Campaign,
    CampaignItem,
    CampaignItemStatus,
    Release,
    utcnow,
)

WEEKDAYS: list[str] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

VIEWS: list[dict[str, str]] = [
    {"value": "month", "label": "Month", "icon": "calendar-days"},
    {"value": "week", "label": "Week", "icon": "calendar-range"},
    {"value": "list", "label": "List", "icon": "list"},
]

STATUS_LABELS: dict[str, str] = {
    "todo": "Not started",
    "in_progress": "In progress",
    "scheduled": "Scheduled",
    "done": "Completed",
    "skipped": "Skipped",
}

STATUS_CHOICES: list[dict[str, str]] = [
    {"value": "all", "label": "All statuses"},
    {"value": "todo", "label": "Not started"},
    {"value": "in_progress", "label": "In progress"},
    {"value": "done", "label": "Completed"},
    {"value": "skipped", "label": "Skipped"},
]

PLATFORM_META: dict[str, dict[str, str]] = {
    "instagram": {
        "label": "Instagram",
        "icon": "instagram",
        "chip": "border-violet-400/30 bg-violet-400/10 text-violet-100",
    },
    "tiktok": {
        "label": "TikTok",
        "icon": "music",
        "chip": "border-orange-400/30 bg-orange-400/10 text-orange-100",
    },
    "youtube": {
        "label": "YouTube",
        "icon": "youtube",
        "chip": "border-rose-400/30 bg-rose-400/10 text-rose-100",
    },
    "spotify": {
        "label": "Spotify",
        "icon": "audio-lines",
        "chip": "border-emerald-400/30 bg-emerald-400/10 text-emerald-100",
    },
    "apple_music": {
        "label": "Apple Music",
        "icon": "disc-3",
        "chip": "border-stone-400/30 bg-white/10 text-stone-100",
    },
    "x": {
        "label": "X",
        "icon": "at-sign",
        "chip": "border-sky-400/30 bg-sky-400/10 text-sky-100",
    },
    "email": {
        "label": "Email",
        "icon": "mail",
        "chip": "border-amber-400/30 bg-amber-400/10 text-amber-100",
    },
    "other": {
        "label": "Other",
        "icon": "sparkles",
        "chip": "border-white/15 bg-white/5 text-stone-200",
    },
}

DEFAULT_META: dict[str, str] = {
    "label": "Other",
    "icon": "sparkles",
    "chip": "border-white/15 bg-white/5 text-stone-200",
}


class TaskRow(TypedDict):
    id: int
    campaign_id: int
    campaign_name: str
    release_key: str
    song: str
    title: str
    item_type: str
    item_type_label: str
    platform: str
    platform_label: str
    platform_icon: str
    platform_chip: str
    status: str
    status_label: str
    day_number: int
    week_number: int
    phase_label: str
    scheduled_iso: str
    scheduled_label: str
    scheduled_long: str
    body: str
    caption: str
    hashtags: str
    opening_hook: str
    content_concept: str
    script_notes: str
    song_section: str
    suggested_lyric: str
    call_to_action: str
    prep_minutes: int


class DayCell(TypedDict):
    date_iso: str
    day_label: str
    weekday_label: str
    long_label: str
    in_month: bool
    is_today: bool
    task_count: int
    tasks: list[TaskRow]


class TaskGroup(TypedDict):
    label: str
    sub_label: str
    tasks: list[TaskRow]


EMPTY_TASK: TaskRow = {
    "id": 0,
    "campaign_id": 0,
    "campaign_name": "",
    "release_key": "",
    "song": "",
    "title": "",
    "item_type": "",
    "item_type_label": "",
    "platform": "",
    "platform_label": "",
    "platform_icon": "sparkles",
    "platform_chip": DEFAULT_META["chip"],
    "status": "todo",
    "status_label": "Not started",
    "day_number": 0,
    "week_number": 0,
    "phase_label": "",
    "scheduled_iso": "",
    "scheduled_label": "",
    "scheduled_long": "",
    "body": "",
    "caption": "",
    "hashtags": "",
    "opening_hook": "",
    "content_concept": "",
    "script_notes": "",
    "song_section": "",
    "suggested_lyric": "",
    "call_to_action": "",
    "prep_minutes": 0,
}


class CalendarState(rx.State):
    """Cross-campaign content calendar, scoped to the signed-in owner."""

    is_loading: bool = True
    error: str = ""
    has_campaigns: bool = False
    view: str = "month"
    anchor: str = ""
    tasks: list[TaskRow] = []
    release_options: list[dict[str, str]] = [
        {"value": "all", "label": "All releases"}
    ]
    weekdays: list[str] = WEEKDAYS
    views: list[dict[str, str]] = VIEWS
    status_choices: list[dict[str, str]] = STATUS_CHOICES
    release_filter: str = "all"
    platform_filter: str = "all"
    status_filter: str = "all"
    selected: TaskRow = EMPTY_TASK
    drawer_open: bool = False

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------

    def _anchor_date(self) -> datetime.date:
        if self.anchor:
            try:
                return datetime.date.fromisoformat(self.anchor)
            except ValueError:
                logging.exception("Bad calendar anchor")
        return datetime.date.today()

    async def _uid(self) -> int:
        from droppilot_release_manager.states.auth_state import AuthState

        auth = await self.get_state(AuthState)
        return auth.user_id

    # ------------------------------------------------------------------
    # computed views
    # ------------------------------------------------------------------

    @rx.var
    def platform_options(self) -> list[dict[str, str]]:
        options: list[dict[str, str]] = [
            {"value": "all", "label": "All platforms"}
        ]
        seen: list[str] = []
        for task in self.tasks:
            if task["platform"] not in seen:
                seen.append(task["platform"])
                options.append(
                    {
                        "value": task["platform"],
                        "label": task["platform_label"],
                    }
                )
        return options

    @rx.var
    def filters_active(self) -> bool:
        return (
            self.release_filter != "all"
            or self.platform_filter != "all"
            or self.status_filter != "all"
        )

    @rx.var
    def filtered_tasks(self) -> list[TaskRow]:
        rows = self.tasks
        if self.release_filter != "all":
            rows = [r for r in rows if r["release_key"] == self.release_filter]
        if self.platform_filter != "all":
            rows = [r for r in rows if r["platform"] == self.platform_filter]
        if self.status_filter != "all":
            rows = [r for r in rows if r["status"] == self.status_filter]
        return rows

    @rx.var
    def visible_count(self) -> int:
        if self.view == "month":
            return sum(c["task_count"] for c in self.month_cells)
        if self.view == "week":
            return sum(c["task_count"] for c in self.week_cells)
        return len(self.filtered_tasks)

    @rx.var
    def total_filtered(self) -> int:
        return len(self.filtered_tasks)

    def _by_date(self) -> dict[str, list[TaskRow]]:
        grouped: dict[str, list[TaskRow]] = {}
        for task in self.filtered_tasks:
            if not task["scheduled_iso"]:
                continue
            grouped.setdefault(task["scheduled_iso"], []).append(task)
        return grouped

    def _cell(
        self,
        day: datetime.date,
        grouped: dict[str, list[TaskRow]],
        month: int,
    ) -> DayCell:
        iso = day.isoformat()
        rows = grouped.get(iso, [])
        return {
            "date_iso": iso,
            "day_label": day.strftime("%d"),
            "weekday_label": day.strftime("%a"),
            "long_label": day.strftime("%A %d %B"),
            "in_month": day.month == month,
            "is_today": day == datetime.date.today(),
            "task_count": len(rows),
            "tasks": rows,
        }

    @rx.var
    def month_cells(self) -> list[DayCell]:
        anchor = self._anchor_date()
        first = anchor.replace(day=1)
        start = first - datetime.timedelta(days=first.weekday())
        grouped = self._by_date()
        return [
            self._cell(start + datetime.timedelta(days=i), grouped, first.month)
            for i in range(42)
        ]

    @rx.var
    def week_cells(self) -> list[DayCell]:
        anchor = self._anchor_date()
        start = anchor - datetime.timedelta(days=anchor.weekday())
        grouped = self._by_date()
        return [
            self._cell(
                start + datetime.timedelta(days=i), grouped, anchor.month
            )
            for i in range(7)
        ]

    @rx.var
    def list_groups(self) -> list[TaskGroup]:
        grouped = self._by_date()
        groups: list[TaskGroup] = []
        today = datetime.date.today()
        for iso in sorted(grouped):
            day = datetime.date.fromisoformat(iso)
            delta = (day - today).days
            if delta == 0:
                sub = "Today"
            elif delta > 0:
                sub = f"In {delta} days"
            else:
                sub = f"{abs(delta)} days ago"
            groups.append(
                {
                    "label": day.strftime("%A %d %B %Y"),
                    "sub_label": sub,
                    "tasks": grouped[iso],
                }
            )
        unscheduled = [t for t in self.filtered_tasks if not t["scheduled_iso"]]
        if unscheduled:
            groups.append(
                {
                    "label": "Unscheduled",
                    "sub_label": f"{len(unscheduled)} tasks without a date",
                    "tasks": unscheduled,
                }
            )
        return groups

    @rx.var
    def period_label(self) -> str:
        anchor = self._anchor_date()
        if self.view == "month":
            return anchor.strftime("%B %Y")
        if self.view == "week":
            start = anchor - datetime.timedelta(days=anchor.weekday())
            end = start + datetime.timedelta(days=6)
            return (
                f"{start.strftime('%d %b')} \u2013 {end.strftime('%d %b %Y')}"
            )
        return "Every scheduled task"

    # ------------------------------------------------------------------
    # loading
    # ------------------------------------------------------------------

    @rx.event
    async def load(self):
        uid = await self._uid()
        self.is_loading = True
        self.error = ""
        self.drawer_open = False
        if not self.anchor:
            self.anchor = datetime.date.today().isoformat()
        yield
        if uid <= 0:
            self.is_loading = False
            yield rx.redirect(lyric_bridge.app_url("login.html"))
            return
        try:
            async with rx.asession() as session:
                campaign_ids = (
                    await session.scalars(
                        select(Campaign.id).where(Campaign.user_id == uid)
                    )
                ).all()
                self.has_campaigns = len(campaign_ids) > 0
                rows = (
                    await session.execute(
                        select(CampaignItem, Campaign, Release)
                        .join(Campaign, Campaign.id == CampaignItem.campaign_id)
                        .outerjoin(Release, Release.id == Campaign.release_id)
                        .where(Campaign.user_id == uid)
                        .order_by(
                            CampaignItem.scheduled_for,
                            CampaignItem.day_number,
                        )
                    )
                ).all()
                tasks: list[TaskRow] = []
                options: list[dict[str, str]] = [
                    {"value": "all", "label": "All releases"}
                ]
                seen_releases: list[str] = []
                for item, campaign, release in rows:
                    key = (
                        f"r{release.id}" if release is not None else "unlinked"
                    )
                    label = (
                        release.title if release is not None else "No release"
                    )
                    if key not in seen_releases:
                        seen_releases.append(key)
                        options.append({"value": key, "label": label})
                    tasks.append(self._task_row(item, campaign, label, key))
                self.tasks = tasks
                self.release_options = options
        except Exception as e:
            logging.exception(f"Calendar load failed: {e}")
            self.error = "We could not load your calendar. Please refresh."
        self.is_loading = False

    def _task_row(
        self,
        item: CampaignItem,
        campaign: Campaign,
        song: str,
        release_key: str,
    ) -> TaskRow:
        meta = PLATFORM_META.get(item.platform, DEFAULT_META)
        return {
            "id": int(item.id),
            "campaign_id": int(campaign.id),
            "campaign_name": campaign.name,
            "release_key": release_key,
            "song": song,
            "title": item.title,
            "item_type": item.item_type,
            "item_type_label": item.item_type.replace("_", " ").title(),
            "platform": item.platform,
            "platform_label": meta["label"],
            "platform_icon": meta["icon"],
            "platform_chip": meta["chip"],
            "status": item.status,
            "status_label": STATUS_LABELS.get(item.status, "Not started"),
            "day_number": int(item.day_number),
            "week_number": int(item.week_number),
            "phase_label": item.campaign_phase.replace("_", " ").title(),
            "scheduled_iso": (
                item.scheduled_for.isoformat() if item.scheduled_for else ""
            ),
            "scheduled_label": (
                item.scheduled_for.strftime("%a %d %b")
                if item.scheduled_for
                else "Unscheduled"
            ),
            "scheduled_long": (
                item.scheduled_for.strftime("%A %d %B %Y")
                if item.scheduled_for
                else "No date set"
            ),
            "body": item.body,
            "caption": item.caption,
            "hashtags": item.hashtags,
            "opening_hook": item.opening_hook,
            "content_concept": item.content_concept,
            "script_notes": item.script_notes,
            "song_section": item.song_section,
            "suggested_lyric": item.suggested_lyric,
            "call_to_action": item.call_to_action,
            "prep_minutes": int(item.prep_minutes),
        }

    # ------------------------------------------------------------------
    # controls
    # ------------------------------------------------------------------

    @rx.event
    def set_view(self, value: str):
        if value in {"month", "week", "list"}:
            self.view = value

    @rx.event
    def go_today(self):
        self.anchor = datetime.date.today().isoformat()

    @rx.event
    def shift(self, direction: int):
        anchor = self._anchor_date()
        if self.view == "week":
            anchor = anchor + datetime.timedelta(days=7 * direction)
        else:
            month = anchor.month + direction
            year = anchor.year
            if month < 1:
                month, year = 12, year - 1
            elif month > 12:
                month, year = 1, year + 1
            day = min(anchor.day, 28)
            anchor = datetime.date(year, month, day)
        self.anchor = anchor.isoformat()

    @rx.event
    def set_release_filter(self, value: str):
        self.release_filter = value

    @rx.event
    def set_platform_filter(self, value: str):
        self.platform_filter = value

    @rx.event
    def set_status_filter(self, value: str):
        self.status_filter = value

    @rx.event
    def clear_filters(self):
        self.release_filter = "all"
        self.platform_filter = "all"
        self.status_filter = "all"

    @rx.event
    def open_task(self, task_id: int):
        for task in self.tasks:
            if task["id"] == task_id:
                self.selected = task
                self.drawer_open = True
                return

    @rx.event
    def close_drawer(self):
        self.drawer_open = False

    @rx.event
    async def mark_done(self, task_id: int):
        uid = await self._uid()
        if uid > 0 and not await lyric_bridge.can_write(uid):
            self.error = lyric_bridge.READ_ONLY_MESSAGE
            return
        if uid <= 0:
            return
        try:
            async with rx.asession() as session:
                item = (
                    await session.scalars(
                        select(CampaignItem)
                        .join(Campaign, Campaign.id == CampaignItem.campaign_id)
                        .where(
                            CampaignItem.id == task_id,
                            Campaign.user_id == uid,
                        )
                    )
                ).first()
                if item is None:
                    self.error = "That task is no longer available."
                    return
                item.status = CampaignItemStatus.DONE.value
                item.completed_at = utcnow()
                await session.commit()
        except Exception as e:
            logging.exception(f"Calendar status update failed: {e}")
            self.error = "We could not update that task."
            return
        for index, task in enumerate(self.tasks):
            if task["id"] == task_id:
                updated = dict(task)
                updated["status"] = CampaignItemStatus.DONE.value
                updated["status_label"] = "Completed"
                self.tasks[index] = updated  # type: ignore[assignment]
                if self.selected["id"] == task_id:
                    self.selected = updated  # type: ignore[assignment]
                return
