"""Database schema for DropPilot.

All persistent models live here and share a single declarative ``Base``.
Definitions stay portable across managed PostgreSQL and local SQLite:
no vendor-specific column types, enums modelled as constrained strings
with CHECK constraints, and timezone-aware UTC timestamps.
"""

from __future__ import annotations

import datetime
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    MappedAsDataclass,
    mapped_column,
    relationship,
)


class Base(MappedAsDataclass, DeclarativeBase, kw_only=True):
    pass


def utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.UTC)


class TimestampMixin(MappedAsDataclass, kw_only=True):
    """Created/updated timestamps applied to every table."""

    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        default_factory=utcnow,
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        default_factory=utcnow,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


# ---------------------------------------------------------------------------
# Constrained string enums
# ---------------------------------------------------------------------------


class SubscriptionPlan(StrEnum):
    FREE = "free"
    INDIE = "indie"
    PRO = "pro"
    LABEL = "label"


class SubscriptionStatus(StrEnum):
    TRIALING = "trialing"
    ACTIVE = "active"
    PAST_DUE = "past_due"
    CANCELED = "canceled"
    INCOMPLETE = "incomplete"


class ReleaseType(StrEnum):
    SINGLE = "single"
    EP = "ep"
    ALBUM = "album"
    MIXTAPE = "mixtape"
    REMIX = "remix"


class CampaignStatus(StrEnum):
    DRAFT = "draft"
    GENERATING = "generating"
    ACTIVE = "active"
    PAUSED = "paused"
    COMPLETED = "completed"
    ARCHIVED = "archived"


class CampaignItemType(StrEnum):
    POST = "post"
    REEL = "reel"
    STORY = "story"
    EMAIL = "email"
    AD = "ad"
    TASK = "task"
    PITCH = "pitch"


class CampaignItemStatus(StrEnum):
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    SCHEDULED = "scheduled"
    DONE = "done"
    SKIPPED = "skipped"


class Platform(StrEnum):
    INSTAGRAM = "instagram"
    TIKTOK = "tiktok"
    YOUTUBE = "youtube"
    SPOTIFY = "spotify"
    APPLE_MUSIC = "apple_music"
    X = "x"
    EMAIL = "email"
    OTHER = "other"


class PitchTarget(StrEnum):
    PLAYLIST = "playlist"
    BLOG = "blog"
    RADIO = "radio"
    PRESS = "press"
    LABEL = "label"
    SYNC = "sync"


class PitchStatus(StrEnum):
    DRAFT = "draft"
    READY = "ready"
    SENT = "sent"
    REPLIED = "replied"
    PLACED = "placed"
    REJECTED = "rejected"


class AnalyticsMetric(StrEnum):
    STREAMS = "streams"
    LISTENERS = "listeners"
    SAVES = "saves"
    FOLLOWERS = "followers"
    VIEWS = "views"
    LIKES = "likes"
    PLAYLIST_ADDS = "playlist_adds"
    REVENUE = "revenue"


class NotificationKind(StrEnum):
    INFO = "info"
    SUCCESS = "success"
    WARNING = "warning"
    ERROR = "error"
    REMINDER = "reminder"


def _enum_check(column: str, enum: type[StrEnum], name: str) -> CheckConstraint:
    values = ", ".join(f"'{member.value}'" for member in enum)
    return CheckConstraint(f"{column} IN ({values})", name=name)


# ---------------------------------------------------------------------------
# Core ownership
# ---------------------------------------------------------------------------


class User(TimestampMixin, Base):
    __tablename__ = "user"
    __table_args__ = (
        UniqueConstraint("email", name="uq_user_email"),
        Index("ix_user_reset_token", "reset_token"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, init=False)
    email: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(120), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    onboarding_complete: Mapped[bool] = mapped_column(Boolean, default=False)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    last_login_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), default=None, nullable=True
    )
    # --- reset-token lifecycle -------------------------------------------
    reset_token: Mapped[str | None] = mapped_column(
        String(128), default=None, nullable=True, unique=True
    )
    reset_token_expires_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), default=None, nullable=True
    )
    reset_token_used_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), default=None, nullable=True
    )
    failed_login_count: Mapped[int] = mapped_column(Integer, default=0)

    profile: Mapped["ArtistProfile | None"] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        uselist=False,
        init=False,
    )
    subscription: Mapped["Subscription | None"] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        uselist=False,
        init=False,
    )
    releases: Mapped[list["Release"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
        default_factory=list,
        init=False,
    )
    campaigns: Mapped[list["Campaign"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
        default_factory=list,
        init=False,
    )
    pitches: Mapped[list["Pitch"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
        default_factory=list,
        init=False,
    )
    epks: Mapped[list["EPK"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
        default_factory=list,
        init=False,
    )
    analytics_entries: Mapped[list["AnalyticsEntry"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
        default_factory=list,
        init=False,
    )
    notifications: Mapped[list["Notification"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
        default_factory=list,
        init=False,
    )


class ArtistProfile(TimestampMixin, Base):
    __tablename__ = "artist_profile"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_artist_profile_user"),
        UniqueConstraint("slug", name="uq_artist_profile_slug"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, init=False)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True
    )
    artist_name: Mapped[str] = mapped_column(String(120), nullable=False)
    slug: Mapped[str] = mapped_column(String(140), nullable=False, index=True)
    genre: Mapped[str] = mapped_column(String(80), default="")
    secondary_genre: Mapped[str] = mapped_column(String(80), default="")
    hometown: Mapped[str] = mapped_column(String(120), default="")
    bio_short: Mapped[str] = mapped_column(String(400), default="")
    bio_long: Mapped[str] = mapped_column(Text, default="")
    avatar_url: Mapped[str] = mapped_column(String(500), default="")
    banner_url: Mapped[str] = mapped_column(String(500), default="")
    website_url: Mapped[str | None] = mapped_column(
        String(500), default=None, nullable=True
    )
    spotify_url: Mapped[str | None] = mapped_column(
        String(500), default=None, nullable=True
    )
    instagram_handle: Mapped[str | None] = mapped_column(
        String(120), default=None, nullable=True
    )
    tiktok_handle: Mapped[str | None] = mapped_column(
        String(120), default=None, nullable=True
    )
    youtube_url: Mapped[str | None] = mapped_column(
        String(500), default=None, nullable=True
    )
    monthly_listeners: Mapped[int] = mapped_column(Integer, default=0)
    career_stage: Mapped[str] = mapped_column(String(40), default="emerging")
    primary_platform: Mapped[str] = mapped_column(String(40), default="")
    campaign_goal: Mapped[str] = mapped_column(String(200), default="")

    user: Mapped["User"] = relationship(back_populates="profile", init=False)


class Subscription(TimestampMixin, Base):
    __tablename__ = "subscription"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_subscription_user"),
        UniqueConstraint(
            "stripe_subscription_id",
            name="uq_subscription_stripe_subscription_id",
        ),
        _enum_check("plan", SubscriptionPlan, "ck_subscription_plan"),
        _enum_check("status", SubscriptionStatus, "ck_subscription_status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, init=False)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True
    )
    plan: Mapped[str] = mapped_column(
        String(20), default=SubscriptionPlan.FREE.value, index=True
    )
    status: Mapped[str] = mapped_column(
        String(20), default=SubscriptionStatus.TRIALING.value, index=True
    )
    billing_interval: Mapped[str] = mapped_column(String(20), default="monthly")
    price_cents: Mapped[int] = mapped_column(Integer, default=0)
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    campaign_quota: Mapped[int] = mapped_column(Integer, default=1)
    stripe_customer_id: Mapped[str | None] = mapped_column(
        String(120), default=None, nullable=True
    )
    stripe_subscription_id: Mapped[str | None] = mapped_column(
        String(120), default=None, nullable=True
    )
    trial_ends_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), default=None, nullable=True
    )
    current_period_end: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), default=None, nullable=True
    )
    canceled_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), default=None, nullable=True
    )

    user: Mapped["User"] = relationship(
        back_populates="subscription", init=False
    )


# ---------------------------------------------------------------------------
# Music + campaign content
# ---------------------------------------------------------------------------


class Release(TimestampMixin, Base):
    __tablename__ = "release"
    __table_args__ = (
        Index("ix_release_user_release_date", "user_id", "release_date"),
        _enum_check("release_type", ReleaseType, "ck_release_type"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, init=False)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    release_type: Mapped[str] = mapped_column(
        String(20), default=ReleaseType.SINGLE.value
    )
    primary_genre: Mapped[str] = mapped_column(String(80), default="")
    secondary_genre: Mapped[str] = mapped_column(String(80), default="")
    featured_artists: Mapped[str] = mapped_column(String(240), default="")
    mood: Mapped[str] = mapped_column(String(120), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    cover_art_url: Mapped[str] = mapped_column(String(500), default="")
    is_explicit: Mapped[bool] = mapped_column(Boolean, default=False)
    audio_path: Mapped[str] = mapped_column(String(500), default="")
    audio_name: Mapped[str] = mapped_column(String(300), default="")
    artwork_path: Mapped[str] = mapped_column(String(500), default="")
    artwork_name: Mapped[str] = mapped_column(String(300), default="")
    lyrics: Mapped[str] = mapped_column(Text, default="")
    isrc: Mapped[str | None] = mapped_column(
        String(20), default=None, nullable=True
    )
    upc: Mapped[str | None] = mapped_column(
        String(20), default=None, nullable=True
    )
    label: Mapped[str | None] = mapped_column(
        String(160), default=None, nullable=True
    )
    distributor: Mapped[str | None] = mapped_column(
        String(160), default=None, nullable=True
    )
    track_count: Mapped[int] = mapped_column(Integer, default=1)
    release_date: Mapped[datetime.date | None] = mapped_column(
        default=None, nullable=True
    )
    is_released: Mapped[bool] = mapped_column(Boolean, default=False)

    user: Mapped["User"] = relationship(back_populates="releases", init=False)
    campaigns: Mapped[list["Campaign"]] = relationship(
        back_populates="release",
        cascade="all, delete-orphan",
        passive_deletes=True,
        default_factory=list,
        init=False,
    )
    analytics_entries: Mapped[list["AnalyticsEntry"]] = relationship(
        back_populates="release",
        cascade="all, delete-orphan",
        passive_deletes=True,
        default_factory=list,
        init=False,
    )


class Campaign(TimestampMixin, Base):
    __tablename__ = "campaign"
    __table_args__ = (
        UniqueConstraint("public_token", name="uq_campaign_public_token"),
        Index("ix_campaign_user_status", "user_id", "status"),
        _enum_check("status", CampaignStatus, "ck_campaign_status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, init=False)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True
    )
    release_id: Mapped[int | None] = mapped_column(
        ForeignKey("release.id", ondelete="CASCADE"),
        default=None,
        nullable=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    goal: Mapped[str] = mapped_column(String(200), default="")
    status: Mapped[str] = mapped_column(
        String(20), default=CampaignStatus.DRAFT.value, index=True
    )
    target_audience: Mapped[str] = mapped_column(Text, default="")
    budget_cents: Mapped[int] = mapped_column(Integer, default=0)
    duration_days: Mapped[int] = mapped_column(Integer, default=21)
    start_date: Mapped[datetime.date | None] = mapped_column(
        default=None, nullable=True
    )
    end_date: Mapped[datetime.date | None] = mapped_column(
        default=None, nullable=True
    )
    platforms: Mapped[str] = mapped_column(String(300), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    objectives: Mapped[str] = mapped_column(String(400), default="")
    target_locations: Mapped[str] = mapped_column(String(400), default="")
    content_personality: Mapped[str] = mapped_column(String(60), default="")
    resources: Mapped[str] = mapped_column(String(400), default="")
    weekly_capacity: Mapped[int] = mapped_column(Integer, default=5)
    budget_band: Mapped[str] = mapped_column(String(60), default="")
    instructions: Mapped[str] = mapped_column(Text, default="")
    methodology: Mapped[str] = mapped_column(Text, default="")
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    generated_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), default=None, nullable=True
    )
    public_token: Mapped[str | None] = mapped_column(
        String(64), default=None, nullable=True
    )

    user: Mapped["User"] = relationship(back_populates="campaigns", init=False)
    release: Mapped["Release | None"] = relationship(
        back_populates="campaigns", init=False
    )
    items: Mapped[list["CampaignItem"]] = relationship(
        back_populates="campaign",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="CampaignItem.day_number",
        default_factory=list,
        init=False,
    )
    pitches: Mapped[list["Pitch"]] = relationship(
        back_populates="campaign",
        cascade="all, delete-orphan",
        passive_deletes=True,
        default_factory=list,
        init=False,
    )


class CampaignItem(TimestampMixin, Base):
    __tablename__ = "campaign_item"
    __table_args__ = (
        Index("ix_campaign_item_campaign_day", "campaign_id", "day_number"),
        _enum_check("item_type", CampaignItemType, "ck_campaign_item_type"),
        _enum_check("status", CampaignItemStatus, "ck_campaign_item_status"),
        _enum_check("platform", Platform, "ck_campaign_item_platform"),
        CheckConstraint("day_number >= 1", name="ck_campaign_item_day_number"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, init=False)
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("campaign.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    day_number: Mapped[int] = mapped_column(Integer, default=1)
    week_number: Mapped[int] = mapped_column(Integer, default=1)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, default="")
    caption: Mapped[str] = mapped_column(Text, default="")
    hashtags: Mapped[str] = mapped_column(String(400), default="")
    item_type: Mapped[str] = mapped_column(
        String(20), default=CampaignItemType.POST.value
    )
    platform: Mapped[str] = mapped_column(
        String(20), default=Platform.INSTAGRAM.value
    )
    status: Mapped[str] = mapped_column(
        String(20), default=CampaignItemStatus.TODO.value, index=True
    )
    scheduled_for: Mapped[datetime.date | None] = mapped_column(
        default=None, nullable=True
    )
    completed_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), default=None, nullable=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    campaign_phase: Mapped[str] = mapped_column(
        String(30), default="pre_release"
    )
    opening_hook: Mapped[str] = mapped_column(Text, default="")
    content_concept: Mapped[str] = mapped_column(Text, default="")
    script_notes: Mapped[str] = mapped_column(Text, default="")
    song_section: Mapped[str] = mapped_column(String(80), default="")
    suggested_lyric: Mapped[str] = mapped_column(String(400), default="")
    call_to_action: Mapped[str] = mapped_column(String(300), default="")
    prep_minutes: Mapped[int] = mapped_column(Integer, default=30)

    campaign: Mapped["Campaign"] = relationship(
        back_populates="items", init=False
    )


class Pitch(TimestampMixin, Base):
    __tablename__ = "pitch"
    __table_args__ = (
        Index("ix_pitch_user_status", "user_id", "status"),
        _enum_check("target_type", PitchTarget, "ck_pitch_target_type"),
        _enum_check("status", PitchStatus, "ck_pitch_status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, init=False)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True
    )
    campaign_id: Mapped[int | None] = mapped_column(
        ForeignKey("campaign.id", ondelete="CASCADE"),
        default=None,
        nullable=True,
        index=True,
    )
    target_type: Mapped[str] = mapped_column(
        String(20), default=PitchTarget.PLAYLIST.value
    )
    target_name: Mapped[str] = mapped_column(String(200), default="")
    contact_name: Mapped[str | None] = mapped_column(
        String(160), default=None, nullable=True
    )
    contact_email: Mapped[str | None] = mapped_column(
        String(320), default=None, nullable=True
    )
    subject: Mapped[str] = mapped_column(String(240), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(
        String(20), default=PitchStatus.DRAFT.value, index=True
    )
    sent_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), default=None, nullable=True
    )
    response_notes: Mapped[str] = mapped_column(Text, default="")

    user: Mapped["User"] = relationship(back_populates="pitches", init=False)
    campaign: Mapped["Campaign | None"] = relationship(
        back_populates="pitches", init=False
    )


class EPK(TimestampMixin, Base):
    __tablename__ = "epk"
    __table_args__ = (
        UniqueConstraint("public_slug", name="uq_epk_public_slug"),
        Index("ix_epk_user_published", "user_id", "is_published"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, init=False)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True
    )
    release_id: Mapped[int | None] = mapped_column(
        ForeignKey("release.id", ondelete="SET NULL"),
        default=None,
        nullable=True,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(200), default="Press Kit")
    public_slug: Mapped[str] = mapped_column(
        String(80), nullable=False, index=True
    )
    headline: Mapped[str] = mapped_column(String(240), default="")
    artist_name: Mapped[str] = mapped_column(String(120), default="")
    artist_photo_path: Mapped[str] = mapped_column(String(500), default="")
    genre: Mapped[str] = mapped_column(String(80), default="")
    location: Mapped[str] = mapped_column(String(120), default="")
    spotify_url: Mapped[str] = mapped_column(String(500), default="")
    apple_music_url: Mapped[str] = mapped_column(String(500), default="")
    youtube_url: Mapped[str] = mapped_column(String(500), default="")
    bandcamp_url: Mapped[str] = mapped_column(String(500), default="")
    instagram_url: Mapped[str] = mapped_column(String(500), default="")
    tiktok_url: Mapped[str] = mapped_column(String(500), default="")
    x_url: Mapped[str] = mapped_column(String(500), default="")
    website_url: Mapped[str] = mapped_column(String(500), default="")
    bio: Mapped[str] = mapped_column(Text, default="")
    highlights: Mapped[str] = mapped_column(Text, default="")
    press_quotes: Mapped[str] = mapped_column(Text, default="")
    tour_dates: Mapped[str] = mapped_column(Text, default="")
    contact_email: Mapped[str | None] = mapped_column(
        String(320), default=None, nullable=True
    )
    booking_email: Mapped[str | None] = mapped_column(
        String(320), default=None, nullable=True
    )
    photo_urls: Mapped[str] = mapped_column(Text, default="")
    embed_url: Mapped[str | None] = mapped_column(
        String(500), default=None, nullable=True
    )
    theme_accent: Mapped[str] = mapped_column(String(20), default="violet")
    is_published: Mapped[bool] = mapped_column(Boolean, default=False)
    view_count: Mapped[int] = mapped_column(Integer, default=0)

    user: Mapped["User"] = relationship(back_populates="epks", init=False)


# ---------------------------------------------------------------------------
# Insights + messaging
# ---------------------------------------------------------------------------


class AnalyticsEntry(TimestampMixin, Base):
    __tablename__ = "analytics_entry"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "release_id",
            "platform",
            "metric",
            "entry_date",
            name="uq_analytics_entry_unique_point",
        ),
        Index("ix_analytics_entry_user_date", "user_id", "entry_date"),
        _enum_check("platform", Platform, "ck_analytics_entry_platform"),
        _enum_check("metric", AnalyticsMetric, "ck_analytics_entry_metric"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, init=False)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True
    )
    release_id: Mapped[int | None] = mapped_column(
        ForeignKey("release.id", ondelete="CASCADE"),
        default=None,
        nullable=True,
        index=True,
    )
    platform: Mapped[str] = mapped_column(
        String(20), default=Platform.SPOTIFY.value
    )
    metric: Mapped[str] = mapped_column(
        String(20), default=AnalyticsMetric.STREAMS.value
    )
    value: Mapped[float] = mapped_column(Float, default=0.0)
    entry_date: Mapped[datetime.date] = mapped_column(
        default_factory=lambda: utcnow().date(), nullable=False
    )
    source: Mapped[str] = mapped_column(String(40), default="manual")
    note: Mapped[str] = mapped_column(String(300), default="")

    user: Mapped["User"] = relationship(
        back_populates="analytics_entries", init=False
    )
    release: Mapped["Release | None"] = relationship(
        back_populates="analytics_entries", init=False
    )


class Notification(TimestampMixin, Base):
    __tablename__ = "notification"
    __table_args__ = (
        Index("ix_notification_user_read", "user_id", "is_read"),
        _enum_check("kind", NotificationKind, "ck_notification_kind"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, init=False)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    message: Mapped[str] = mapped_column(Text, default="")
    kind: Mapped[str] = mapped_column(
        String(20), default=NotificationKind.INFO.value
    )
    link_url: Mapped[str | None] = mapped_column(
        String(500), default=None, nullable=True
    )
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    read_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), default=None, nullable=True
    )

    user: Mapped["User"] = relationship(
        back_populates="notifications", init=False
    )
