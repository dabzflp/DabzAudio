import logging
import random
import string
from typing import TypedDict

import reflex as rx

from droppilot_release_manager import lyric_bridge
from sqlalchemy import select

from droppilot_release_manager import security
from droppilot_release_manager.models import EPK, ArtistProfile, Release

UPLOAD_ID = "epk_photo"
ALLOWED_EXTENSIONS: set[str] = {".jpg", ".jpeg", ".png", ".webp"}
ALLOWED_TYPES: set[str] = {"image/jpeg", "image/png", "image/webp"}
MAX_PHOTO_BYTES = 5 * 1024 * 1024

LINK_FIELDS: list[dict[str, str]] = [
    {
        "field": "spotify_url",
        "label": "Spotify",
        "icon": "audio-lines",
        "placeholder": "https://open.spotify.com/artist/...",
    },
    {
        "field": "apple_music_url",
        "label": "Apple Music",
        "icon": "disc-3",
        "placeholder": "https://music.apple.com/artist/...",
    },
    {
        "field": "youtube_url",
        "label": "YouTube",
        "icon": "youtube",
        "placeholder": "https://youtube.com/@...",
    },
    {
        "field": "bandcamp_url",
        "label": "Bandcamp",
        "icon": "music",
        "placeholder": "https://yourname.bandcamp.com",
    },
]

SOCIAL_FIELDS: list[dict[str, str]] = [
    {
        "field": "instagram_url",
        "label": "Instagram",
        "icon": "instagram",
        "placeholder": "https://instagram.com/...",
    },
    {
        "field": "tiktok_url",
        "label": "TikTok",
        "icon": "music",
        "placeholder": "https://tiktok.com/@...",
    },
    {
        "field": "x_url",
        "label": "X",
        "icon": "at-sign",
        "placeholder": "https://x.com/...",
    },
    {
        "field": "website_url",
        "label": "Website",
        "icon": "globe",
        "placeholder": "https://yourname.com",
    },
]


class ReleaseOption(TypedDict):
    value: str
    label: str
    artwork: str


class PreviewLink(TypedDict):
    label: str
    url: str
    icon: str


class EPKState(rx.State):
    """Owned press-kit editor with a live one-sheet preview."""

    is_loading: bool = True
    is_saving: bool = False
    error: str = ""
    notice: str = ""
    upload_error: str = ""
    mobile_tab: str = "edit"
    form_version: int = 0

    epk_id: int = 0
    epk_slug: str = ""
    is_published: bool = False
    artist_name: str = ""
    artist_photo: str = ""
    genre: str = ""
    location: str = ""
    release_id: str = ""
    headline: str = ""
    bio: str = ""
    highlights: str = ""
    contact_email: str = ""
    spotify_url: str = ""
    apple_music_url: str = ""
    youtube_url: str = ""
    bandcamp_url: str = ""
    instagram_url: str = ""
    tiktok_url: str = ""
    x_url: str = ""
    website_url: str = ""

    releases: list[ReleaseOption] = []
    link_fields: list[dict[str, str]] = LINK_FIELDS
    social_fields: list[dict[str, str]] = SOCIAL_FIELDS

    # ------------------------------------------------------------------
    # computed
    # ------------------------------------------------------------------

    @rx.var
    def public_path(self) -> str:
        return f"/epk/{self.epk_slug}" if self.epk_slug else ""

    @rx.var
    def public_url(self) -> str:
        if not self.epk_slug:
            return ""
        raw = str(self.router.url)
        parts = raw.split("/")
        origin = "/".join(parts[:3]) if len(parts) >= 3 else ""
        return f"{origin}/epk/{self.epk_slug}"

    @rx.var
    def release_title(self) -> str:
        for option in self.releases:
            if option["value"] == self.release_id:
                return option["label"]
        return ""

    @rx.var
    def release_artwork(self) -> str:
        for option in self.releases:
            if option["value"] == self.release_id:
                return option["artwork"]
        return ""

    @rx.var
    def highlight_lines(self) -> list[str]:
        return [
            line.strip("\u2022 -\t")
            for line in self.highlights.splitlines()
            if line.strip()
        ]

    @rx.var
    def streaming_links(self) -> list[PreviewLink]:
        pairs = [
            ("Spotify", "audio-lines", self.spotify_url),
            ("Apple Music", "disc-3", self.apple_music_url),
            ("YouTube", "youtube", self.youtube_url),
            ("Bandcamp", "music", self.bandcamp_url),
        ]
        return [
            {"label": label, "icon": icon, "url": url.strip()}
            for label, icon, url in pairs
            if url.strip()
        ]

    @rx.var
    def social_links(self) -> list[PreviewLink]:
        pairs = [
            ("Instagram", "instagram", self.instagram_url),
            ("TikTok", "music", self.tiktok_url),
            ("X", "at-sign", self.x_url),
            ("Website", "globe", self.website_url),
        ]
        return [
            {"label": label, "icon": icon, "url": url.strip()}
            for label, icon, url in pairs
            if url.strip()
        ]

    @rx.var
    def bio_count(self) -> int:
        return len(self.bio)

    async def _uid(self) -> int:
        from droppilot_release_manager.states.auth_state import AuthState

        auth = await self.get_state(AuthState)
        return auth.user_id

    # ------------------------------------------------------------------
    # loading
    # ------------------------------------------------------------------

    @rx.event
    async def load(self):
        uid = await self._uid()
        self.is_loading = True
        self.error = ""
        self.notice = ""
        self.upload_error = ""
        yield
        if uid <= 0:
            self.is_loading = False
            yield rx.redirect(lyric_bridge.app_url("login.html"))
            return
        try:
            async with rx.asession() as session:
                releases = (
                    await session.scalars(
                        select(Release)
                        .where(Release.user_id == uid)
                        .order_by(Release.created_at.desc())
                    )
                ).all()
                self.releases = [
                    {
                        "value": str(r.id),
                        "label": r.title,
                        "artwork": r.artwork_path,
                    }
                    for r in releases
                ]
                profile = (
                    await session.scalars(
                        select(ArtistProfile).where(
                            ArtistProfile.user_id == uid
                        )
                    )
                ).first()
                epk = (
                    await session.scalars(
                        select(EPK).where(EPK.user_id == uid).order_by(EPK.id)
                    )
                ).first()
                if epk is not None:
                    self.epk_id = int(epk.id)
                    self.epk_slug = epk.public_slug
                    self.is_published = bool(epk.is_published)
                    self.artist_name = epk.artist_name or (
                        profile.artist_name if profile else ""
                    )
                    self.artist_photo = epk.artist_photo_path
                    self.genre = epk.genre or (profile.genre if profile else "")
                    self.location = epk.location or (
                        profile.hometown if profile else ""
                    )
                    self.release_id = (
                        str(epk.release_id) if epk.release_id else ""
                    )
                    self.headline = epk.headline
                    self.bio = epk.bio or (profile.bio_long if profile else "")
                    self.highlights = epk.highlights
                    self.contact_email = epk.contact_email or ""
                    self.spotify_url = epk.spotify_url
                    self.apple_music_url = epk.apple_music_url
                    self.youtube_url = epk.youtube_url
                    self.bandcamp_url = epk.bandcamp_url
                    self.instagram_url = epk.instagram_url
                    self.tiktok_url = epk.tiktok_url
                    self.x_url = epk.x_url
                    self.website_url = epk.website_url
                else:
                    self.epk_id = 0
                    self.epk_slug = ""
                    self.is_published = False
                    self.artist_name = profile.artist_name if profile else ""
                    self.artist_photo = profile.avatar_url if profile else ""
                    self.genre = profile.genre if profile else ""
                    self.location = profile.hometown if profile else ""
                    self.release_id = (
                        self.releases[0]["value"] if self.releases else ""
                    )
                    self.headline = ""
                    self.bio = profile.bio_long if profile else ""
                    self.highlights = ""
                    self.contact_email = ""
                    self.spotify_url = (
                        profile.spotify_url
                        if profile and profile.spotify_url
                        else ""
                    )
                    self.apple_music_url = ""
                    self.youtube_url = (
                        profile.youtube_url
                        if profile and profile.youtube_url
                        else ""
                    )
                    self.bandcamp_url = ""
                    self.instagram_url = ""
                    self.tiktok_url = ""
                    self.x_url = ""
                    self.website_url = (
                        profile.website_url
                        if profile and profile.website_url
                        else ""
                    )
        except Exception as e:
            logging.exception(f"EPK load failed: {e}")
            self.error = "We could not load your press kit. Please refresh."
        self.form_version += 1
        self.is_loading = False

    # ------------------------------------------------------------------
    # field setters
    # ------------------------------------------------------------------

    @rx.event
    def set_field(self, field: str, value: str):
        allowed = {
            "artist_name",
            "genre",
            "location",
            "headline",
            "bio",
            "highlights",
            "contact_email",
            "spotify_url",
            "apple_music_url",
            "youtube_url",
            "bandcamp_url",
            "instagram_url",
            "tiktok_url",
            "x_url",
            "website_url",
        }
        if field in allowed:
            setattr(self, field, value)
            self.error = ""
            self.notice = ""

    @rx.event
    def set_release(self, value: str):
        self.release_id = value

    @rx.event
    def set_mobile_tab(self, value: str):
        self.mobile_tab = value

    @rx.event
    def clear_photo(self):
        self.artist_photo = ""
        self.upload_error = ""

    # ------------------------------------------------------------------
    # upload
    # ------------------------------------------------------------------

    @rx.event
    async def handle_photo(self, files: list[rx.UploadFile]):
        self.upload_error = ""
        if not files:
            self.upload_error = "No file was selected."
            return
        upload = files[0]
        name = upload.name or "photo"
        suffix = name[name.rfind(".") :].lower() if "." in name else ""
        if suffix not in ALLOWED_EXTENSIONS:
            self.upload_error = (
                "That file type is not supported. Use a JPG, PNG or WEBP image."
            )
            return
        content_type = str(getattr(upload, "content_type", "") or "").lower()
        if content_type and content_type not in ALLOWED_TYPES:
            self.upload_error = (
                f"That file reports itself as {content_type}, which is not an "
                "accepted image type."
            )
            return
        try:
            data = await upload.read()
        except Exception as e:
            logging.exception(f"EPK photo read failed: {e}")
            self.upload_error = (
                "We could not read that file. Nothing was saved \u2014 please "
                "try again."
            )
            return
        if not data:
            self.upload_error = "That file is empty."
            return
        if len(data) > MAX_PHOTO_BYTES:
            self.upload_error = f"That image is {len(data) / 1048576:.1f} MB. The limit is 5 MB."
            return
        if not self._looks_like_image(data):
            self.upload_error = (
                "That file does not look like a real JPG, PNG or WEBP image."
            )
            return
        try:
            upload_dir = rx.get_upload_dir()
            upload_dir.mkdir(parents=True, exist_ok=True)
            token = "".join(
                random.choices(string.ascii_lowercase + string.digits, k=10)
            )
            filename = f"epk_{token}{suffix}"
            (upload_dir / filename).write_bytes(data)
        except Exception as e:
            logging.exception(f"EPK photo save failed: {e}")
            self.upload_error = (
                "We could not save that image on the server. Nothing was "
                "changed."
            )
            return
        self.artist_photo = filename
        self.notice = "Photograph uploaded. Save your draft to keep it."

    @staticmethod
    def _looks_like_image(data: bytes) -> bool:
        if data[:3] == b"\xff\xd8\xff":
            return True
        if data[:8] == b"\x89PNG\r\n\x1a\n":
            return True
        return data[:4] == b"RIFF" and data[8:12] == b"WEBP"

    # ------------------------------------------------------------------
    # persistence
    # ------------------------------------------------------------------

    def _validate(self) -> str:
        if not self.artist_name.strip():
            return "Your artist name is required on a press kit."
        if len(self.artist_name.strip()) > 120:
            return "Keep the artist name under 120 characters."
        if self.contact_email.strip() and not security.is_valid_email(
            self.contact_email.strip().lower()
        ):
            return "That contact email address is not valid."
        if len(self.bio) > 4000:
            return "The biography is too long. Keep it under 4000 characters."
        for spec in LINK_FIELDS + SOCIAL_FIELDS:
            value = str(getattr(self, spec["field"], "")).strip()
            if value and not value.lower().startswith(("http://", "https://")):
                return f"The {spec['label']} link must start with https://"
        return ""

    async def _unique_slug(self, session, base: str, epk_id: int) -> str:
        candidate = security.slugify(base, "press-kit")[:60]
        suffix = 1
        while True:
            existing = (
                await session.scalars(
                    select(EPK).where(EPK.public_slug == candidate)
                )
            ).first()
            if existing is None or int(existing.id) == epk_id:
                return candidate
            suffix += 1
            candidate = f"{security.slugify(base, 'press-kit')[:52]}-{suffix}"

    async def _persist(self, publish: bool | None) -> str:
        uid = await self._uid()
        if uid <= 0:
            return "Open Drop Pilot again from Lyric Book."
        if not await lyric_bridge.can_write(uid):
            return lyric_bridge.READ_ONLY_MESSAGE
        try:
            async with rx.asession() as session:
                epk: EPK | None = None
                if self.epk_id > 0:
                    epk = (
                        await session.scalars(
                            select(EPK).where(
                                EPK.id == self.epk_id, EPK.user_id == uid
                            )
                        )
                    ).first()
                    if epk is None:
                        return "That press kit is no longer available."
                if epk is None:
                    slug = await self._unique_slug(session, self.artist_name, 0)
                    epk = EPK(user_id=uid, public_slug=slug)
                    session.add(epk)
                    await session.flush()
                elif not epk.public_slug:
                    epk.public_slug = await self._unique_slug(
                        session, self.artist_name, int(epk.id)
                    )
                release_id: int | None = None
                if self.release_id:
                    owned = (
                        await session.scalars(
                            select(Release).where(
                                Release.id == int(self.release_id),
                                Release.user_id == uid,
                            )
                        )
                    ).first()
                    release_id = int(owned.id) if owned is not None else None
                epk.title = f"{self.artist_name.strip()} press kit"[:200]
                epk.artist_name = self.artist_name.strip()[:120]
                epk.artist_photo_path = self.artist_photo[:500]
                epk.genre = self.genre.strip()[:80]
                epk.location = self.location.strip()[:120]
                epk.headline = self.headline.strip()[:240]
                epk.bio = self.bio
                epk.highlights = self.highlights
                epk.contact_email = self.contact_email.strip().lower() or None
                epk.release_id = release_id
                epk.spotify_url = self.spotify_url.strip()[:500]
                epk.apple_music_url = self.apple_music_url.strip()[:500]
                epk.youtube_url = self.youtube_url.strip()[:500]
                epk.bandcamp_url = self.bandcamp_url.strip()[:500]
                epk.instagram_url = self.instagram_url.strip()[:500]
                epk.tiktok_url = self.tiktok_url.strip()[:500]
                epk.x_url = self.x_url.strip()[:500]
                epk.website_url = self.website_url.strip()[:500]
                if publish is not None:
                    epk.is_published = publish
                await session.commit()
                self.epk_id = int(epk.id)
                self.epk_slug = epk.public_slug
                self.is_published = bool(epk.is_published)
        except Exception as e:
            logging.exception(f"EPK save failed: {e}")
            return "We could not save your press kit. Please try again."
        return ""

    @rx.event
    async def save_draft(self):
        self.error = ""
        self.notice = ""
        problem = self._validate()
        if problem:
            self.error = problem
            return
        self.is_saving = True
        yield
        failure = await self._persist(None)
        self.is_saving = False
        if failure:
            self.error = failure
            return
        self.notice = "Draft saved."

    @rx.event
    async def publish(self):
        self.error = ""
        self.notice = ""
        problem = self._validate()
        if problem:
            self.error = problem
            return
        if not self.bio.strip():
            self.error = "Add a short biography before publishing."
            return
        self.is_saving = True
        yield
        failure = await self._persist(True)
        self.is_saving = False
        if failure:
            self.error = failure
            return
        self.notice = "Your press kit is live at its public link."

    @rx.event
    async def unpublish(self):
        self.error = ""
        self.notice = ""
        if self.epk_id <= 0:
            return
        self.is_saving = True
        yield
        failure = await self._persist(False)
        self.is_saving = False
        if failure:
            self.error = failure
            return
        self.notice = "Your press kit is private again."
