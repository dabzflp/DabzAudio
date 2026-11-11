import logging
from typing import Any, TypedDict

import reflex as rx

from droppilot_release_manager import lyric_bridge
from sqlalchemy import select

from droppilot_release_manager.models import Notification, utcnow


class NavLink(TypedDict):
    label: str
    href: str
    icon: str


NAV_LINKS: list[NavLink] = [
    {"label": "Overview", "href": "/dashboard", "icon": "layout-dashboard"},
    {"label": "My Releases", "href": "/releases", "icon": "disc-3"},
    {"label": "New Campaign", "href": "/campaigns/new", "icon": "plus"},
    {"label": "Content Calendar", "href": "/calendar", "icon": "calendar-days"},
    {"label": "EPK Builder", "href": "/epk", "icon": "file-text"},
    {"label": "Plan & credits", "href": lyric_bridge.app_url("subscription.html"), "icon": "credit-card"},
]

# Lyric Book products, opened in the same tab so the two apps feel like one.
LYRIC_LINKS: list[NavLink] = [
    {"label": "Lyric Book", "href": lyric_bridge.app_url("app.html"), "icon": "book-open"},
    {"label": "Playback", "href": lyric_bridge.app_url("playback.html"), "icon": "headphones"},
    {"label": "Transfer a file", "href": lyric_bridge.app_url("transfer.html"), "icon": "send"},
    {"label": "Split Sheet", "href": lyric_bridge.app_url("contract.html"), "icon": "file-signature"},
    {"label": "Invoices", "href": lyric_bridge.app_url("app.html?open=invoices"), "icon": "receipt"},
    {"label": "Gifts", "href": lyric_bridge.app_url("app.html?open=gifts"), "icon": "gift"},
]

MOBILE_LINKS: list[NavLink] = [
    {"label": "Overview", "href": "/dashboard", "icon": "layout-dashboard"},
    {"label": "Releases", "href": "/releases", "icon": "disc-3"},
    {"label": "New", "href": "/campaigns/new", "icon": "plus"},
    {"label": "Calendar", "href": "/calendar", "icon": "calendar-days"},
]


class NotificationRow(TypedDict):
    id: int
    title: str
    message: str
    kind: str
    is_read: bool


class ShellState(rx.State):
    """Chrome for the authenticated app: sidebar, drawer and top bar menus."""

    collapsed: bool = False
    drawer_open: bool = False
    profile_open: bool = False
    notifications_open: bool = False
    search_query: str = ""
    notifications: list[NotificationRow] = []
    unread_count: int = 0
    nav_links: list[NavLink] = NAV_LINKS
    mobile_links: list[NavLink] = MOBILE_LINKS
    lyric_links: list[NavLink] = LYRIC_LINKS

    @rx.event
    def toggle_collapsed(self):
        self.collapsed = not self.collapsed

    @rx.event
    def toggle_drawer(self):
        self.drawer_open = not self.drawer_open

    @rx.event
    def close_drawer(self):
        self.drawer_open = False

    @rx.event
    def toggle_profile(self):
        self.profile_open = not self.profile_open
        self.notifications_open = False

    @rx.event
    def toggle_notifications(self):
        self.notifications_open = not self.notifications_open
        self.profile_open = False

    @rx.event
    def close_menus(self):
        self.profile_open = False
        self.notifications_open = False

    @rx.event
    def set_search_query(self, value: str):
        self.search_query = value

    @rx.event
    def submit_search(self, form_data: dict[str, Any]):
        query = str(form_data.get("q", "")).strip()
        self.search_query = query
        self.drawer_open = False
        return rx.redirect(f"/releases?q={query}")

    @rx.event
    async def load_notifications(self):
        from droppilot_release_manager.states.auth_state import AuthState

        auth = await self.get_state(AuthState)
        uid = auth.user_id
        self.notifications = []
        self.unread_count = 0
        if uid <= 0:
            return
        try:
            async with rx.asession() as session:
                rows = (
                    await session.scalars(
                        select(Notification)
                        .where(Notification.user_id == uid)
                        .order_by(Notification.created_at.desc())
                        .limit(12)
                    )
                ).all()
                self.notifications = [
                    {
                        "id": int(row.id),
                        "title": row.title,
                        "message": row.message,
                        "kind": row.kind,
                        "is_read": bool(row.is_read),
                    }
                    for row in rows
                ]
                self.unread_count = sum(
                    1 for n in self.notifications if not n["is_read"]
                )
        except Exception as e:
            logging.exception(f"Could not load notifications: {e}")

    @rx.event
    async def mark_all_read(self):
        from droppilot_release_manager.states.auth_state import AuthState

        auth = await self.get_state(AuthState)
        uid = auth.user_id
        if uid <= 0:
            return
        try:
            async with rx.asession() as session:
                rows = (
                    await session.scalars(
                        select(Notification).where(
                            Notification.user_id == uid,
                            Notification.is_read == False,  # noqa: E712
                        )
                    )
                ).all()
                for row in rows:
                    row.is_read = True
                    row.read_at = utcnow()
                await session.commit()
        except Exception as e:
            logging.exception(f"Could not mark notifications read: {e}")
            return
        yield ShellState.load_notifications
