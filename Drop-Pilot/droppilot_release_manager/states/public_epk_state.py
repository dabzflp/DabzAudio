import logging
from typing import TypedDict

import reflex as rx
from sqlalchemy import select

from droppilot_release_manager.models import EPK, Release


class PublicLink(TypedDict):
    label: str
    url: str
    icon: str


class PublicEPKState(rx.State):
    """Read-only public press kit. No auth guard, no private fields."""

    is_loading: bool = True
    not_found: bool = False
    artist_name: str = ""
    photo: str = ""
    genre: str = ""
    location: str = ""
    headline: str = ""
    bio: str = ""
    highlight_lines: list[str] = []
    release_title: str = ""
    release_artwork: str = ""
    streaming_links: list[PublicLink] = []
    social_links: list[PublicLink] = []
    contact_email: str = ""

    def _reset_fields(self) -> None:
        self.artist_name = ""
        self.photo = ""
        self.genre = ""
        self.location = ""
        self.headline = ""
        self.bio = ""
        self.highlight_lines = []
        self.release_title = ""
        self.release_artwork = ""
        self.streaming_links = []
        self.social_links = []
        self.contact_email = ""

    @rx.event
    async def load(self):
        slug = str(self.router.page.params.get("slug", "")).strip().lower()
        self.is_loading = True
        self.not_found = False
        self._reset_fields()
        yield
        if not slug:
            self.not_found = True
            self.is_loading = False
            return
        try:
            async with rx.asession() as session:
                epk = (
                    await session.scalars(
                        select(EPK).where(
                            EPK.public_slug == slug,
                            EPK.is_published == True,  # noqa: E712
                        )
                    )
                ).first()
                if epk is None:
                    self.not_found = True
                    self.is_loading = False
                    return
                self.artist_name = epk.artist_name or "Independent artist"
                self.photo = epk.artist_photo_path
                self.genre = epk.genre
                self.location = epk.location
                self.headline = epk.headline
                self.bio = epk.bio
                self.contact_email = epk.contact_email or ""
                self.highlight_lines = [
                    line.strip("\u2022 -\t")
                    for line in epk.highlights.splitlines()
                    if line.strip()
                ]
                self.streaming_links = [
                    row
                    for row in [
                        {
                            "label": "Spotify",
                            "icon": "audio-lines",
                            "url": epk.spotify_url.strip(),
                        },
                        {
                            "label": "Apple Music",
                            "icon": "disc-3",
                            "url": epk.apple_music_url.strip(),
                        },
                        {
                            "label": "YouTube",
                            "icon": "youtube",
                            "url": epk.youtube_url.strip(),
                        },
                        {
                            "label": "Bandcamp",
                            "icon": "music",
                            "url": epk.bandcamp_url.strip(),
                        },
                    ]
                    if row["url"]
                ]
                self.social_links = [
                    row
                    for row in [
                        {
                            "label": "Instagram",
                            "icon": "instagram",
                            "url": epk.instagram_url.strip(),
                        },
                        {
                            "label": "TikTok",
                            "icon": "music",
                            "url": epk.tiktok_url.strip(),
                        },
                        {
                            "label": "X",
                            "icon": "at-sign",
                            "url": epk.x_url.strip(),
                        },
                        {
                            "label": "Website",
                            "icon": "globe",
                            "url": epk.website_url.strip(),
                        },
                    ]
                    if row["url"]
                ]
                if epk.release_id is not None:
                    release = (
                        await session.scalars(
                            select(Release).where(Release.id == epk.release_id)
                        )
                    ).first()
                    if release is not None:
                        self.release_title = release.title
                        self.release_artwork = release.artwork_path
                epk.view_count = int(epk.view_count) + 1
                await session.commit()
        except Exception as e:
            logging.exception(f"Public EPK load failed: {e}")
            self.not_found = True
        self.is_loading = False
