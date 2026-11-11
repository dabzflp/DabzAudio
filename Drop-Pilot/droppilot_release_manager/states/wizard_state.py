import asyncio
import datetime
import logging
import random
import secrets
import string

import reflex as rx

from droppilot_release_manager import lyric_bridge
from sqlalchemy import select

from droppilot_release_manager import ai_campaign
from droppilot_release_manager import campaign_generator as gen
from droppilot_release_manager.models import (
    ArtistProfile,
    Campaign,
    CampaignItem,
    CampaignStatus,
    Pitch,
    PitchStatus,
    Release,
    ReleaseType,
    Subscription,
    utcnow,
)

AUDIO_EXTENSIONS: list[str] = [".mp3", ".wav"]
IMAGE_EXTENSIONS: list[str] = [".jpg", ".jpeg", ".png", ".webp"]
AUDIO_MAX_BYTES = 25 * 1024 * 1024
IMAGE_MAX_BYTES = 8 * 1024 * 1024

RELEASE_TYPES: list[dict[str, str]] = [
    {"value": "single", "label": "Single"},
    {"value": "ep", "label": "EP"},
    {"value": "album", "label": "Album"},
    {"value": "mixtape", "label": "Mixtape"},
    {"value": "remix", "label": "Remix"},
]

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
    "Metal",
    "Other",
]

CAPACITIES: list[dict[str, str]] = [
    {"value": "2", "label": "2 posts a week"},
    {"value": "3", "label": "3 posts a week"},
    {"value": "5", "label": "5 posts a week"},
    {"value": "7", "label": "Every day"},
]

STEP_TITLES: list[str] = [
    "Release information",
    "Audio, artwork and lyrics",
    "Campaign objectives",
    "Audience and style",
    "Review and generate",
]

GENERATION_STAGES: list[str] = [
    "Reading release details",
    "Planning campaign phases",
    "Creating content ideas",
    "Drafting pitches",
]


def _unique_name(original: str) -> str:
    suffix = "".join(
        random.choices(string.ascii_lowercase + string.digits, k=10)
    )
    safe = "".join(c for c in original if c.isalnum() or c in {".", "-", "_"})[
        -80:
    ]
    return f"{suffix}_{safe or 'file'}"


class WizardState(rx.State):
    """Resumable five-step campaign wizard."""

    step: int = 1
    total_steps: int = 5
    step_titles: list[str] = STEP_TITLES
    release_types: list[dict[str, str]] = RELEASE_TYPES
    genres: list[str] = GENRES
    objectives_options: list[dict[str, str]] = gen.OBJECTIVES
    personalities: list[dict[str, str]] = gen.PERSONALITIES
    resource_options: list[dict[str, str]] = gen.RESOURCES
    budget_bands: list[dict[str, str]] = gen.BUDGET_BANDS
    capacities: list[dict[str, str]] = CAPACITIES
    methodology: str = gen.METHODOLOGY_NOTE

    # step 1
    title: str = ""
    release_type: str = "single"
    primary_genre: str = ""
    secondary_genre: str = ""
    featured_artists: str = ""
    mood: str = ""
    is_explicit: bool = False
    release_date: str = ""
    description: str = ""

    # step 2
    audio_path: str = ""
    audio_name: str = ""
    audio_error: str = ""
    audio_status: str = ""
    is_uploading_audio: bool = False
    artwork_path: str = ""
    artwork_name: str = ""
    artwork_error: str = ""
    artwork_status: str = ""
    is_uploading_artwork: bool = False
    lyrics: str = ""

    # step 3
    objectives: list[str] = []

    # step 4
    audience: str = ""
    locations: str = ""
    personality: str = "storyteller"
    resources: list[str] = []
    weekly_capacity: str = "5"
    budget_band: str = "none"
    instructions: str = ""

    error: str = ""
    is_generating: bool = False
    stage_index: int = 0
    quota_reached: bool = False
    quota_message: str = ""

    @rx.var
    def progress_percent(self) -> int:
        return int(self.step / self.total_steps * 100)

    @rx.var
    def step_title(self) -> str:
        return STEP_TITLES[max(0, min(self.step - 1, 4))]

    @rx.var
    def stage_label(self) -> str:
        return GENERATION_STAGES[
            max(0, min(self.stage_index, len(GENERATION_STAGES) - 1))
        ]

    @rx.var
    def release_date_label(self) -> str:
        return self.release_date or "No date chosen"

    @rx.var
    def objectives_label(self) -> str:
        chosen = [
            o["label"] for o in gen.OBJECTIVES if o["value"] in self.objectives
        ]
        return ", ".join(chosen) or "None chosen"

    @rx.var
    def resources_label(self) -> str:
        chosen = [
            r["label"] for r in gen.RESOURCES if r["value"] in self.resources
        ]
        return ", ".join(chosen) or "None chosen"

    @rx.var
    def personality_label(self) -> str:
        for p in gen.PERSONALITIES:
            if p["value"] == self.personality:
                return p["label"]
        return "Storyteller"

    @rx.var
    def budget_label(self) -> str:
        for b in gen.BUDGET_BANDS:
            if b["value"] == self.budget_band:
                return b["label"]
        return "No paid budget"

    # ------------------------------------------------------------------
    # simple setters
    # ------------------------------------------------------------------

    @rx.event
    def set_field(self, field: str, value: str):
        allowed = {
            "title",
            "release_type",
            "primary_genre",
            "secondary_genre",
            "featured_artists",
            "mood",
            "release_date",
            "description",
            "lyrics",
            "audience",
            "locations",
            "personality",
            "weekly_capacity",
            "budget_band",
            "instructions",
        }
        if field in allowed:
            setattr(self, field, value)
            self.error = ""

    @rx.event
    def toggle_explicit(self):
        self.is_explicit = not self.is_explicit

    @rx.event
    def toggle_objective(self, value: str):
        if value in self.objectives:
            self.objectives = [o for o in self.objectives if o != value]
        else:
            self.objectives = self.objectives + [value]
        self.error = ""

    @rx.event
    def toggle_resource(self, value: str):
        if value in self.resources:
            self.resources = [r for r in self.resources if r != value]
        else:
            self.resources = self.resources + [value]

    @rx.event
    def go_to_step(self, step: int):
        self.error = ""
        self.step = max(1, min(self.total_steps, step))

    @rx.event
    def previous_step(self):
        self.error = ""
        self.step = max(1, self.step - 1)

    def _validate_step(self, step: int) -> str:
        if step == 1:
            if not self.title.strip():
                return "Add the song or project title."
            if not self.primary_genre:
                return "Pick the main genre."
            if not self.release_date:
                return "Choose a release date."
            try:
                datetime.date.fromisoformat(self.release_date)
            except ValueError:
                return "That release date is not a valid date."
        if step == 2:
            if not self.audio_path:
                return "Upload your MP3 or WAV before continuing."
            if not self.artwork_path:
                return "Upload artwork as JPG, PNG or WEBP."
        if step == 3 and not self.objectives:
            return "Choose at least one objective."
        if step == 4:
            if not self.audience.strip():
                return "Describe who this release is for."
            if not self.personality:
                return "Pick one content personality."
        return ""

    @rx.event
    def next_step(self):
        problem = self._validate_step(self.step)
        if problem:
            self.error = problem
            return
        self.error = ""
        self.step = min(self.total_steps, self.step + 1)

    # ------------------------------------------------------------------
    # uploads
    # ------------------------------------------------------------------

    @rx.event
    async def handle_audio_upload(self, files: list[rx.UploadFile]):
        self.audio_error = ""
        self.audio_status = ""
        self.is_uploading_audio = True
        yield
        for file in files:
            name = file.name or "audio"
            ext = f".{name.rsplit('.', 1)[-1].lower()}" if "." in name else ""
            if ext not in AUDIO_EXTENSIONS:
                self.is_uploading_audio = False
                self.audio_error = "Audio must be an MP3 or WAV file."
                return
            try:
                data = await file.read()
            except Exception as e:
                logging.exception(f"Audio read failed: {e}")
                self.is_uploading_audio = False
                self.audio_error = "We could not read that file. Try again."
                return
            if len(data) > AUDIO_MAX_BYTES:
                self.is_uploading_audio = False
                self.audio_error = "Audio files must be 25MB or smaller."
                return
            if len(data) == 0:
                self.is_uploading_audio = False
                self.audio_error = "That file is empty."
                return
            try:
                upload_dir = rx.get_upload_dir()
                upload_dir.mkdir(parents=True, exist_ok=True)
                stored = _unique_name(name)
                path = upload_dir / stored
                with path.open("wb") as handle:
                    handle.write(data)
            except Exception as e:
                logging.exception(f"Audio write failed: {e}")
                self.is_uploading_audio = False
                self.audio_error = (
                    "We could not save that file on the server. Please retry."
                )
                return
            self.audio_path = stored
            self.audio_name = name
            self.audio_status = f"Uploaded \u00b7 {len(data) // 1024} KB"
            break
        self.is_uploading_audio = False

    @rx.event
    async def handle_artwork_upload(self, files: list[rx.UploadFile]):
        self.artwork_error = ""
        self.artwork_status = ""
        self.is_uploading_artwork = True
        yield
        for file in files:
            name = file.name or "artwork"
            ext = f".{name.rsplit('.', 1)[-1].lower()}" if "." in name else ""
            if ext not in IMAGE_EXTENSIONS:
                self.is_uploading_artwork = False
                self.artwork_error = "Artwork must be a JPG, PNG or WEBP image."
                return
            try:
                data = await file.read()
            except Exception as e:
                logging.exception(f"Artwork read failed: {e}")
                self.is_uploading_artwork = False
                self.artwork_error = "We could not read that image. Try again."
                return
            if len(data) > IMAGE_MAX_BYTES:
                self.is_uploading_artwork = False
                self.artwork_error = "Artwork must be 8MB or smaller."
                return
            try:
                upload_dir = rx.get_upload_dir()
                upload_dir.mkdir(parents=True, exist_ok=True)
                stored = _unique_name(name)
                path = upload_dir / stored
                with path.open("wb") as handle:
                    handle.write(data)
            except Exception as e:
                logging.exception(f"Artwork write failed: {e}")
                self.is_uploading_artwork = False
                self.artwork_error = (
                    "We could not save that image on the server. Please retry."
                )
                return
            self.artwork_path = stored
            self.artwork_name = name
            self.artwork_status = f"Uploaded \u00b7 {len(data) // 1024} KB"
            break
        self.is_uploading_artwork = False

    @rx.event
    def clear_audio(self):
        self.audio_path = ""
        self.audio_name = ""
        self.audio_status = ""

    @rx.event
    def clear_artwork(self):
        self.artwork_path = ""
        self.artwork_name = ""
        self.artwork_status = ""

    # ------------------------------------------------------------------
    # quota + generation
    # ------------------------------------------------------------------

    @rx.event
    async def check_quota(self):
        from droppilot_release_manager.states.auth_state import AuthState

        auth = await self.get_state(AuthState)
        uid = auth.user_id
        self.quota_reached = False
        self.quota_message = ""
        if uid <= 0:
            return
        try:
            async with rx.asession() as session:
                sub = (
                    await session.scalars(
                        select(Subscription).where(Subscription.user_id == uid)
                    )
                ).first()
                quota = sub.campaign_quota if sub else 1
                used = len(
                    (
                        await session.scalars(
                            select(Campaign).where(Campaign.user_id == uid)
                        )
                    ).all()
                )
                if quota > 0 and used >= quota:
                    self.quota_reached = True
                    self.quota_message = (
                        f"Your plan includes {quota} campaign(s) and you have "
                        f"{used}. Upgrade to generate another."
                    )
        except Exception as e:
            logging.exception(f"Quota check failed: {e}")

    @rx.event
    def reset_wizard(self):
        self.step = 1
        self.title = ""
        self.release_type = "single"
        self.primary_genre = ""
        self.secondary_genre = ""
        self.featured_artists = ""
        self.mood = ""
        self.is_explicit = False
        self.release_date = ""
        self.description = ""
        self.audio_path = ""
        self.audio_name = ""
        self.audio_status = ""
        self.audio_error = ""
        self.artwork_path = ""
        self.artwork_name = ""
        self.artwork_status = ""
        self.artwork_error = ""
        self.lyrics = ""
        self.objectives = []
        self.audience = ""
        self.locations = ""
        self.personality = "storyteller"
        self.resources = []
        self.weekly_capacity = "5"
        self.budget_band = "none"
        self.instructions = ""
        self.error = ""
        self.stage_index = 0

    @rx.event
    async def generate(self):
        from droppilot_release_manager.states.auth_state import AuthState

        if self.is_generating:
            return
        for step in range(1, 5):
            problem = self._validate_step(step)
            if problem:
                self.step = step
                self.error = problem
                return
        auth = await self.get_state(AuthState)
        uid = auth.user_id
        if uid <= 0:
            yield rx.redirect(lyric_bridge.app_url("login.html"))
            return

        self.error = ""
        self.is_generating = True
        self.stage_index = 0
        yield
        await asyncio.sleep(0.7)
        self.stage_index = 1
        yield
        await asyncio.sleep(0.7)
        self.stage_index = 2
        yield

        release_date = datetime.date.fromisoformat(self.release_date)
        try:
            capacity = int(self.weekly_capacity)
        except ValueError:
            capacity = 5

        new_campaign_id = 0
        try:
            async with rx.asession() as session:
                sub = (
                    await session.scalars(
                        select(Subscription).where(Subscription.user_id == uid)
                    )
                ).first()
                quota = sub.campaign_quota if sub else 1
                used = len(
                    (
                        await session.scalars(
                            select(Campaign).where(Campaign.user_id == uid)
                        )
                    ).all()
                )
                if quota > 0 and used >= quota:
                    self.is_generating = False
                    self.quota_reached = True
                    self.quota_message = (
                        "You have used every campaign on your plan. Upgrade to "
                        "generate another."
                    )
                    self.error = self.quota_message
                    return
                profile = (
                    await session.scalars(
                        select(ArtistProfile).where(
                            ArtistProfile.user_id == uid
                        )
                    )
                ).first()
                artist = (
                    profile.artist_name if profile else "Independent artist"
                )

                release = Release(
                    user_id=uid,
                    title=self.title.strip()[:200],
                    release_type=(
                        self.release_type
                        if self.release_type in {t.value for t in ReleaseType}
                        else ReleaseType.SINGLE.value
                    ),
                    primary_genre=self.primary_genre,
                    secondary_genre=self.secondary_genre,
                    featured_artists=self.featured_artists.strip()[:240],
                    mood=self.mood.strip()[:120],
                    description=self.description.strip(),
                    is_explicit=self.is_explicit,
                    audio_path=self.audio_path,
                    audio_name=self.audio_name[:300],
                    artwork_path=self.artwork_path,
                    artwork_name=self.artwork_name[:300],
                    lyrics=self.lyrics,
                    release_date=release_date,
                    is_released=release_date <= datetime.date.today(),
                )
                session.add(release)
                await session.flush()

                campaign = Campaign(
                    user_id=uid,
                    release_id=release.id,
                    name=f"{self.title.strip()} \u00b7 21-day rollout",
                    goal=", ".join(
                        o["label"]
                        for o in gen.OBJECTIVES
                        if o["value"] in self.objectives
                    )[:200],
                    status=CampaignStatus.ACTIVE.value,
                    target_audience=self.audience.strip(),
                    duration_days=21,
                    start_date=release_date - datetime.timedelta(days=13),
                    end_date=release_date + datetime.timedelta(days=7),
                    objectives=",".join(self.objectives)[:400],
                    target_locations=self.locations.strip()[:400],
                    content_personality=self.personality,
                    resources=",".join(self.resources)[:400],
                    weekly_capacity=capacity,
                    budget_band=self.budget_band,
                    instructions=self.instructions.strip(),
                    methodology=gen.METHODOLOGY_NOTE,
                    notes=self.instructions.strip(),
                    generated_at=utcnow(),
                    public_token=secrets.token_urlsafe(16),
                )
                session.add(campaign)
                await session.flush()

                ctx = gen.GenerationContext(
                    artist_name=artist,
                    song_title=self.title.strip(),
                    genre=self.primary_genre,
                    secondary_genre=self.secondary_genre,
                    mood=self.mood,
                    lyrics=self.lyrics,
                    objectives=list(self.objectives),
                    personality=self.personality,
                    resources=list(self.resources),
                    audience=self.audience.strip(),
                    locations=self.locations.strip(),
                    weekly_capacity=capacity,
                    release_date=release_date,
                    featured_artists=self.featured_artists.strip(),
                )
                items, pitches, ai_used = await ai_campaign.generate(ctx, uid)
                platforms: list[str] = []
                for order, draft in enumerate(items):
                    if draft.platform not in platforms:
                        platforms.append(draft.platform)
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
                campaign.platforms = ",".join(platforms)[:300]
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
        except ai_campaign.AINotAllowed as e:
            self.is_generating = False
            self.error = e.message
            return
        except Exception as e:
            logging.exception(f"Campaign generation failed: {e}")
            self.is_generating = False
            self.error = (
                "We could not save your campaign. Nothing was created \u2014 "
                "please try again."
            )
            return

        self.stage_index = 3
        yield
        await asyncio.sleep(0.5)
        self.is_generating = False
        yield WizardState.reset_wizard
        yield rx.redirect(f"/campaigns/{new_campaign_id}")
