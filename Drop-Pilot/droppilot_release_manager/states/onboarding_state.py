import logging
import random
import string

import reflex as rx

from droppilot_release_manager import lyric_bridge
from sqlalchemy import select

from droppilot_release_manager.models import ArtistProfile, User

GENRES: list[str] = [
    "Pop",
    "Hip-Hop",
    "R&B",
    "Indie",
    "Rock",
    "Electronic",
    "House",
    "Afrobeats",
    "Latin",
    "Country",
    "Jazz",
    "Classical",
    "Metal",
    "Other",
]

CAREER_STAGES: list[dict[str, str]] = [
    {
        "value": "emerging",
        "label": "Emerging",
        "hint": "First releases, building a first audience.",
    },
    {
        "value": "developing",
        "label": "Developing",
        "hint": "Steady releases and a growing listener base.",
    },
    {
        "value": "established",
        "label": "Established",
        "hint": "Consistent streams, press and playlist support.",
    },
    {
        "value": "professional",
        "label": "Professional",
        "hint": "Full-time artist with a team behind the rollout.",
    },
]

PLATFORMS: list[dict[str, str]] = [
    {"value": "instagram", "label": "Instagram", "icon": "instagram"},
    {"value": "tiktok", "label": "TikTok", "icon": "music-2"},
    {"value": "youtube", "label": "YouTube", "icon": "youtube"},
    {"value": "spotify", "label": "Spotify", "icon": "audio-lines"},
    {"value": "x", "label": "X", "icon": "at-sign"},
    {"value": "other", "label": "Somewhere else", "icon": "globe"},
]

GOALS: list[dict[str, str]] = [
    {
        "value": "streams",
        "label": "Grow streams",
        "hint": "More plays and saves on every release.",
    },
    {
        "value": "playlists",
        "label": "Land playlists",
        "hint": "Editorial and curator placements.",
    },
    {
        "value": "fans",
        "label": "Build a fanbase",
        "hint": "Followers who show up on release day.",
    },
    {
        "value": "press",
        "label": "Earn press",
        "hint": "Blogs, radio and interviews.",
    },
    {
        "value": "shows",
        "label": "Sell out shows",
        "hint": "Turn listeners into ticket buyers.",
    },
]


class OnboardingState(rx.State):
    """Short, resumable onboarding that persists the artist profile."""

    step: int = 1
    total_steps: int = 3
    genres: list[str] = GENRES
    career_stages: list[dict[str, str]] = CAREER_STAGES
    platforms: list[dict[str, str]] = PLATFORMS
    goals: list[dict[str, str]] = GOALS
    artist_name: str = ""
    genre: str = ""
    career_stage: str = "emerging"
    primary_platform: str = ""
    campaign_goal: str = ""
    avatar_url: str = ""
    error: str = ""
    is_saving: bool = False
    is_uploading: bool = False
    loaded: bool = False

    @rx.var
    def progress_label(self) -> str:
        return f"Step {self.step} of {self.total_steps}"

    @rx.var
    def progress_percent(self) -> int:
        return int(self.step / self.total_steps * 100)

    @rx.event
    async def load_profile(self):
        from droppilot_release_manager.states.auth_state import AuthState

        auth = await self.get_state(AuthState)
        uid = auth.user_id
        self.loaded = False
        self.error = ""
        if uid <= 0:
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
                if profile is not None:
                    self.artist_name = profile.artist_name
                    self.genre = profile.genre
                    self.career_stage = profile.career_stage or "emerging"
                    self.primary_platform = profile.primary_platform
                    self.campaign_goal = profile.campaign_goal
                    self.avatar_url = profile.avatar_url
        except Exception as e:
            logging.exception(f"Could not load onboarding profile: {e}")
        self.loaded = True

    @rx.event
    def set_artist_name(self, value: str):
        self.artist_name = value
        self.error = ""

    @rx.event
    def set_genre(self, value: str):
        self.genre = value
        self.error = ""

    @rx.event
    def set_career_stage(self, value: str):
        self.career_stage = value

    @rx.event
    def set_primary_platform(self, value: str):
        self.primary_platform = value

    @rx.event
    def set_campaign_goal(self, value: str):
        self.campaign_goal = value

    @rx.event
    def clear_avatar(self):
        self.avatar_url = ""

    @rx.event
    def previous_step(self):
        self.error = ""
        self.step = max(1, self.step - 1)

    @rx.event
    def next_step(self):
        self.error = ""
        if self.step == 1:
            if not self.artist_name.strip():
                self.error = "Add the name you release music under."
                return
            if not self.genre:
                self.error = "Pick the genre that fits you best."
                return
        self.step = min(self.total_steps, self.step + 1)

    @rx.event
    async def handle_avatar_upload(self, files: list[rx.UploadFile]):
        self.is_uploading = True
        try:
            for file in files:
                data = await file.read()
                upload_dir = rx.get_upload_dir()
                upload_dir.mkdir(parents=True, exist_ok=True)
                suffix = "".join(
                    random.choices(string.ascii_lowercase + string.digits, k=10)
                )
                name = f"{suffix}_{file.name}"
                path = upload_dir / name
                with path.open("wb") as handle:
                    handle.write(data)
                self.avatar_url = name
                break
        except Exception as e:
            logging.exception(f"Avatar upload failed: {e}")
            self.error = "That image could not be uploaded. Try another file."
        self.is_uploading = False

    @rx.event
    async def submit_profile(self):
        from droppilot_release_manager.states.auth_state import AuthState

        self.error = ""
        auth = await self.get_state(AuthState)
        uid = auth.user_id
        if uid <= 0:
            yield rx.redirect(lyric_bridge.app_url("login.html"))
            return
        if not self.artist_name.strip() or not self.genre:
            self.step = 1
            self.error = "Add your artist name and main genre to continue."
            return

        self.is_saving = True
        yield
        try:
            async with rx.asession() as session:
                profile = (
                    await session.scalars(
                        select(ArtistProfile).where(
                            ArtistProfile.user_id == uid
                        )
                    )
                ).first()
                if profile is None:
                    self.is_saving = False
                    self.error = (
                        "Your profile is missing. Please sign in again."
                    )
                    return
                profile.artist_name = self.artist_name.strip()[:120]
                profile.genre = self.genre
                profile.career_stage = self.career_stage
                profile.primary_platform = self.primary_platform
                profile.campaign_goal = self.campaign_goal
                profile.avatar_url = self.avatar_url
                user = (
                    await session.scalars(select(User).where(User.id == uid))
                ).first()
                if user is not None:
                    user.onboarding_complete = True
                    if not user.full_name:
                        user.full_name = profile.artist_name
                await session.commit()
        except Exception as e:
            logging.exception(f"Onboarding save failed: {e}")
            self.is_saving = False
            self.error = "We could not save your profile. Please try again."
            return

        self.is_saving = False
        auth.onboarding_complete = True
        auth.display_name = self.artist_name.strip()
        yield rx.redirect("/dashboard")
