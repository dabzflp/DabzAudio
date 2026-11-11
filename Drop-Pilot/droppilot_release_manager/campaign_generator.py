"""Modular 21-day campaign generator.

Today this ships a deterministic local template engine. The provider seam
below (``DROPPILOT_GENERATOR_PROVIDER``) is where a hosted model provider can
be added later without touching callers: they only ever call
``generate_campaign`` and receive plain dataclasses.

Nothing here inspects audio. Every idea is derived from the details the artist
submitted: genre, mood, lyrics text, goals, audience, locations, content
personality and available resources.
"""

from __future__ import annotations

import datetime
import hashlib
import logging
import os
from dataclasses import dataclass, field

PROVIDER_ENV = "DROPPILOT_GENERATOR_PROVIDER"
TEMPLATE_PROVIDER = "template"

METHODOLOGY_NOTE = (
    "This plan was generated from the details you submitted \u2014 genre, mood, "
    "lyrics text, campaign goals, audience, locations, content personality and "
    "the resources you said you have. DropPilot does not listen to or analyse "
    "your audio file, and it does not distribute your music."
)

PERSONALITIES: list[dict[str, str]] = [
    {
        "value": "storyteller",
        "label": "Storyteller",
        "hint": "Long-form context, meaning behind the lyrics.",
    },
    {
        "value": "high_energy",
        "label": "High energy",
        "hint": "Fast cuts, loud hooks, punchy captions.",
    },
    {
        "value": "intimate",
        "label": "Intimate",
        "hint": "Close, quiet, one-to-one with listeners.",
    },
    {
        "value": "playful",
        "label": "Playful",
        "hint": "Humour, memes and in-jokes with fans.",
    },
    {
        "value": "craft_focused",
        "label": "Craft focused",
        "hint": "Production, gear and songwriting detail.",
    },
    {
        "value": "community_led",
        "label": "Community led",
        "hint": "Fans, collaborators and local scene first.",
    },
]

RESOURCES: list[dict[str, str]] = [
    {"value": "phone_video", "label": "Phone video", "icon": "video"},
    {"value": "camera", "label": "Proper camera", "icon": "camera"},
    {
        "value": "studio_footage",
        "label": "Studio footage",
        "icon": "clapperboard",
    },
    {"value": "live_footage", "label": "Live footage", "icon": "mic-vocal"},
    {"value": "photos", "label": "Photo shoot", "icon": "image"},
    {"value": "design", "label": "Design skills", "icon": "palette"},
    {"value": "email_list", "label": "Email list", "icon": "mail"},
    {"value": "collaborators", "label": "Collaborators", "icon": "users"},
]

OBJECTIVES: list[dict[str, str]] = [
    {"value": "streams", "label": "Grow streams"},
    {"value": "playlists", "label": "Land playlists"},
    {"value": "fans", "label": "Build a fanbase"},
    {"value": "press", "label": "Earn press"},
    {"value": "shows", "label": "Sell show tickets"},
    {"value": "presaves", "label": "Drive pre-saves"},
    {"value": "video", "label": "Grow short-form video"},
    {"value": "sync", "label": "Find sync placements"},
]

BUDGET_BANDS: list[dict[str, str]] = [
    {"value": "none", "label": "No paid budget"},
    {"value": "under_100", "label": "Under \u00a3100"},
    {"value": "100_500", "label": "\u00a3100 \u2013 \u00a3500"},
    {"value": "500_2000", "label": "\u00a3500 \u2013 \u00a32,000"},
    {"value": "over_2000", "label": "Over \u00a32,000"},
]

PHASES: list[dict[str, str]] = [
    {"value": "pre_release", "label": "Pre-release"},
    {"value": "release_day", "label": "Release day"},
    {"value": "post_release", "label": "Post-release"},
]


@dataclass
class GenerationContext:
    artist_name: str
    song_title: str
    genre: str = ""
    secondary_genre: str = ""
    mood: str = ""
    lyrics: str = ""
    objectives: list[str] = field(default_factory=list)
    personality: str = "storyteller"
    resources: list[str] = field(default_factory=list)
    audience: str = ""
    locations: str = ""
    weekly_capacity: int = 5
    release_date: datetime.date | None = None
    featured_artists: str = ""


@dataclass
class ItemDraft:
    day_number: int
    week_number: int
    scheduled_for: datetime.date
    campaign_phase: str
    title: str
    body: str
    caption: str
    hashtags: str
    item_type: str
    platform: str
    opening_hook: str
    content_concept: str
    script_notes: str
    song_section: str
    suggested_lyric: str
    call_to_action: str
    prep_minutes: int


@dataclass
class PitchDraft:
    target_type: str
    target_name: str
    subject: str
    body: str


TONES: dict[str, str] = {
    "storyteller": "Keep the voiceover calm and let the story lead.",
    "high_energy": "Cut fast, start loud, no slow intro.",
    "intimate": "Talk straight to camera, low light, no music bed.",
    "playful": "Lean into the joke, on-screen text does the work.",
    "craft_focused": "Show the detail: takes, gear, arrangement choices.",
    "community_led": "Put fans and collaborators on screen, not just you.",
}

CAPTION_TAILS: dict[str, str] = {
    "storyteller": "The whole story is in the song.",
    "high_energy": "Turn it up.",
    "intimate": "Thanks for listening this closely.",
    "playful": "No notes. (Loads of notes.)",
    "craft_focused": "Every layer was on purpose.",
    "community_led": "This one belongs to all of us.",
}

# 21 blueprint entries. `needs` marks a resource that improves the idea; when
# the artist does not have it we fall back to the `alt_*` variant so the plan
# never assumes gear they told us they do not own.
BLUEPRINTS: list[dict[str, str | int]] = [
    {
        "platform": "instagram",
        "item_type": "story",
        "title": "Announce the date",
        "hook": "\u201cIt finally has a date.\u201d",
        "concept": "Three quick story frames: artwork corner, the date, the pre-save link sticker.",
        "script": "Frame 1 crop of the artwork. Frame 2 plain text with the release date. Frame 3 link sticker.",
        "section": "Chorus",
        "cta": "Tap to pre-save {song}.",
        "prep": 15,
        "needs": "",
        "alt_platform": "",
    },
    {
        "platform": "tiktok",
        "item_type": "reel",
        "title": "First eight seconds",
        "hook": "\u201cThis is the bit I could not stop replaying.\u201d",
        "concept": "Play the strongest eight seconds of {song} over a single unbroken shot, on-screen text naming the {genre} reference points.",
        "script": "One take, phone at chest height. Text on screen at 0:00. Audio in cold, no talking.",
        "section": "Hook",
        "cta": "Pre-save so it lands in your library on day one.",
        "prep": 30,
        "needs": "phone_video",
        "alt_platform": "instagram",
    },
    {
        "platform": "instagram",
        "item_type": "post",
        "title": "Artwork reveal",
        "hook": "\u201cThis is what {song} looks like.\u201d",
        "concept": "Full artwork post with a short caption on what the image has to do with the words.",
        "script": "Single image. Caption in two short paragraphs, date on the last line.",
        "section": "Title",
        "cta": "Save the post, pre-save the song.",
        "prep": 20,
        "needs": "design",
        "alt_platform": "",
    },
    {
        "platform": "youtube",
        "item_type": "reel",
        "title": "Lyric snippet short",
        "hook": "\u201cThe line people keep asking about.\u201d",
        "concept": "Vertical short built around one lyric, typed on screen line by line as it is sung.",
        "script": "Static background, animated captions, 12 seconds max, loop cleanly.",
        "section": "Verse 1",
        "cta": "Full song out {date}.",
        "prep": 40,
        "needs": "design",
        "alt_platform": "tiktok",
    },
    {
        "platform": "email",
        "item_type": "email",
        "title": "Pre-save email to your list",
        "hook": "Subject: a new one, out {date}",
        "concept": "Short letter to the list: what the song is, why now, one link.",
        "script": "120 words. One link. Reply-invitation at the end so it lands in the primary tab.",
        "section": "Bridge",
        "cta": "Pre-save now \u2014 it takes one tap.",
        "prep": 25,
        "needs": "email_list",
        "alt_platform": "instagram",
    },
    {
        "platform": "instagram",
        "item_type": "reel",
        "title": "Where the song started",
        "hook": "\u201cIt started as a voice note at 2am.\u201d",
        "concept": "Behind-the-scenes reel from writing or tracking, ending on the finished section.",
        "script": "Rough clips first, finished audio last. Cut on the downbeat.",
        "section": "Verse 2",
        "cta": "Pre-save {song}.",
        "prep": 45,
        "needs": "studio_footage",
        "alt_platform": "tiktok",
    },
    {
        "platform": "x",
        "item_type": "post",
        "title": "Thread: the story of the song",
        "hook": "\u201cA short thread about {song}, out {date}.\u201d",
        "concept": "Four posts: the moment, the demo, what changed, the release date.",
        "script": "Plain text, one image on the final post, link only at the end.",
        "section": "Verse 1",
        "cta": "Pre-save link in the last post.",
        "prep": 20,
        "needs": "",
        "alt_platform": "",
    },
    {
        "platform": "tiktok",
        "item_type": "reel",
        "title": "Ask one question",
        "hook": "\u201cHonest answers only \u2014 which line hits harder?\u201d",
        "concept": "Two candidate lyric lines on screen with the audio underneath; ask viewers to pick in the comments.",
        "script": "Split-screen text, hook audio, 10 seconds. Reply to comments with video.",
        "section": "Chorus",
        "cta": "Comment 1 or 2.",
        "prep": 25,
        "needs": "",
        "alt_platform": "",
    },
    {
        "platform": "instagram",
        "item_type": "post",
        "title": "Lyric carousel",
        "hook": "\u201cFive lines, no context.\u201d",
        "concept": "Five-slide carousel of typeset lyric lines matching the {mood} of the record.",
        "script": "Consistent type treatment, one line per slide, artwork on the last slide.",
        "section": "Chorus",
        "cta": "Out {date} \u2014 pre-save in bio.",
        "prep": 35,
        "needs": "design",
        "alt_platform": "",
    },
    {
        "platform": "youtube",
        "item_type": "reel",
        "title": "Stripped performance clip",
        "hook": "\u201cJust the voice and one instrument.\u201d",
        "concept": "Vertical stripped-back performance of the chorus, shot in one room.",
        "script": "One angle, natural light, record audio separately if you can.",
        "section": "Chorus",
        "cta": "The produced version drops {date}.",
        "prep": 60,
        "needs": "camera",
        "alt_platform": "instagram",
    },
    {
        "platform": "instagram",
        "item_type": "story",
        "title": "Countdown + poll",
        "hook": "\u201cTwo days. Quick question.\u201d",
        "concept": "Countdown sticker plus a two-option poll about the artwork or title.",
        "script": "Two frames only. Reshare the best replies the next day.",
        "section": "Hook",
        "cta": "Set the countdown reminder.",
        "prep": 10,
        "needs": "",
        "alt_platform": "",
    },
    {
        "platform": "tiktok",
        "item_type": "reel",
        "title": "Day before, honestly",
        "hook": "\u201cSong out tomorrow and I am nervous.\u201d",
        "concept": "Unpolished talk-to-camera clip about what tomorrow means, hook playing quietly under.",
        "script": "Handheld, one take, no edit. Post before 9am local time.",
        "section": "Bridge",
        "cta": "Pre-save tonight so it plays for you first.",
        "prep": 15,
        "needs": "",
        "alt_platform": "",
    },
    {
        "platform": "other",
        "item_type": "task",
        "title": "Send the pitch round",
        "hook": "Sending day \u2014 curators, blogs, radio.",
        "concept": "Send the six drafted pitches, log who received what and when to follow up.",
        "script": "Personalise the first line of each. One link, one short paragraph, no attachments.",
        "section": "\u2014",
        "cta": "Log every send so follow-ups are easy.",
        "prep": 50,
        "needs": "",
        "alt_platform": "",
    },
    {
        "platform": "instagram",
        "item_type": "reel",
        "title": "Release day reel",
        "hook": "\u201cIt is out. Right now.\u201d",
        "concept": "Best-performing pre-release clip re-cut with an \u201cout now\u201d frame and the link sticker.",
        "script": "Lead with the loudest three seconds. End card with platform names.",
        "section": "Chorus",
        "cta": "{song} is out now \u2014 link in bio.",
        "prep": 30,
        "needs": "",
        "alt_platform": "",
    },
    {
        "platform": "tiktok",
        "item_type": "reel",
        "title": "Release day sound push",
        "hook": "\u201cUse the sound, I will find you.\u201d",
        "concept": "Post using the official sound and invite viewers to make their own version around the hook.",
        "script": "Show the sound name on screen. Promise to duet the first ten.",
        "section": "Hook",
        "cta": "Tap the sound and make yours.",
        "prep": 25,
        "needs": "",
        "alt_platform": "",
    },
    {
        "platform": "spotify",
        "item_type": "task",
        "title": "Streaming housekeeping",
        "hook": "Make the profile match the moment.",
        "concept": "Update artist pic, bio and Artist Pick to {song}; add it to your own public playlist.",
        "script": "Check the canvas, the credits and the link in bio all point at the new release.",
        "section": "\u2014",
        "cta": "Ask listeners to follow the profile, not just the song.",
        "prep": 20,
        "needs": "",
        "alt_platform": "",
    },
    {
        "platform": "instagram",
        "item_type": "story",
        "title": "Reshare every mention",
        "hook": "\u201cSeeing all of these. Thank you.\u201d",
        "concept": "Reshare listener stories in a run of frames and reply to each one by name.",
        "script": "Batch it into two sessions so the story stays alive all day.",
        "section": "\u2014",
        "cta": "Tag me and I will reshare you.",
        "prep": 20,
        "needs": "",
        "alt_platform": "",
    },
    {
        "platform": "youtube",
        "item_type": "post",
        "title": "Visualiser upload",
        "hook": "\u201cThe full song, one image, no distractions.\u201d",
        "concept": "Upload a simple visualiser so the song is searchable and shareable off-platform.",
        "script": "Artwork plus a subtle motion loop. Full lyrics in the description.",
        "section": "Full song",
        "cta": "Subscribe if this is your kind of {genre}.",
        "prep": 55,
        "needs": "design",
        "alt_platform": "spotify",
    },
    {
        "platform": "instagram",
        "item_type": "post",
        "title": "What people said",
        "hook": "\u201cWeek one, in your words.\u201d",
        "concept": "Carousel of real comments, messages and adds from the first week.",
        "script": "Screenshot with permission, keep names cropped unless they are happy to be named.",
        "section": "Chorus",
        "cta": "Still out now \u2014 send it to one person.",
        "prep": 30,
        "needs": "",
        "alt_platform": "",
    },
    {
        "platform": "tiktok",
        "item_type": "reel",
        "title": "Second hook, second chance",
        "hook": "\u201cMost of you missed this part.\u201d",
        "concept": "Post a different section of the song for people who never heard past the hook.",
        "script": "Fresh visual, new on-screen text, same sound so plays compound.",
        "section": "Bridge",
        "cta": "Full song on every platform.",
        "prep": 25,
        "needs": "",
        "alt_platform": "",
    },
    {
        "platform": "email",
        "item_type": "email",
        "title": "Week-in-review and next step",
        "hook": "Subject: week one of {song}",
        "concept": "Thank the list, share one honest number, say what is next.",
        "script": "Short. One number, one ask, one link. Note the numbers you logged this week.",
        "section": "\u2014",
        "cta": "Add {song} to a playlist you actually listen to.",
        "prep": 25,
        "needs": "email_list",
        "alt_platform": "instagram",
    },
]

OBJECTIVE_CTAS: dict[str, str] = {
    "streams": "Ask for a full listen, not just a scroll.",
    "playlists": "Ask listeners to add it to a personal playlist.",
    "fans": "Ask for a follow, not just a like.",
    "press": "Point writers at the press kit.",
    "shows": "Mention the next show date.",
    "presaves": "Push the pre-save link hard.",
    "video": "Ask for a duet or stitch.",
    "sync": "Note the instrumental is available on request.",
}


def _fill(text: str, ctx: GenerationContext, release_label: str) -> str:
    return (
        text.replace("{song}", ctx.song_title or "the song")
        .replace("{artist}", ctx.artist_name or "you")
        .replace("{genre}", ctx.genre.lower() or "your genre")
        .replace("{mood}", ctx.mood.lower() or "the record")
        .replace("{date}", release_label)
    )


def _lyric_lines(lyrics: str) -> list[str]:
    return [
        line.strip()
        for line in (lyrics or "").splitlines()
        if len(line.strip()) > 8
    ][:40]


def _hashtags(ctx: GenerationContext, index: int) -> str:
    genre_tag = "".join(
        c for c in (ctx.genre or "newmusic").lower() if c.isalnum()
    )
    song_tag = "".join(
        c for c in (ctx.song_title or "release").lower() if c.isalnum()
    )[:18]
    pool = [
        f"#{genre_tag}",
        f"#{song_tag}",
        "#newmusic",
        "#indieartist",
        "#nowplaying",
        "#newrelease",
        "#songwriter",
        "#unsignedartist",
    ]
    picks = [pool[0], pool[1]] + [pool[2 + (index + i) % 6] for i in range(2)]
    return " ".join(dict.fromkeys(picks))


def _phase_for(day: datetime.date, release: datetime.date | None) -> str:
    if release is None:
        return "pre_release"
    if day < release:
        return "pre_release"
    if day == release:
        return "release_day"
    return "post_release"


def _schedule(release: datetime.date | None) -> list[datetime.date]:
    today = datetime.date.today()
    anchor = release or (today + datetime.timedelta(days=14))
    start = anchor - datetime.timedelta(days=13)
    if start < today:
        start = today
    return [start + datetime.timedelta(days=i) for i in range(21)]


def _seed(ctx: GenerationContext) -> int:
    raw = f"{ctx.artist_name}|{ctx.song_title}|{ctx.genre}|{ctx.personality}"
    return int(hashlib.sha256(raw.encode("utf-8")).hexdigest()[:8], 16)


def _generate_with_templates(
    ctx: GenerationContext,
) -> tuple[list[ItemDraft], list[PitchDraft]]:
    dates = _schedule(ctx.release_date)
    release_label = (
        ctx.release_date.strftime("%d %B")
        if ctx.release_date
        else "release day"
    )
    lines = _lyric_lines(ctx.lyrics)
    tone = TONES.get(ctx.personality, TONES["storyteller"])
    tail = CAPTION_TAILS.get(ctx.personality, "")
    seed = _seed(ctx)
    objective_notes = [
        OBJECTIVE_CTAS[o] for o in ctx.objectives if o in OBJECTIVE_CTAS
    ] or ["Ask for a full listen, not just a scroll."]

    items: list[ItemDraft] = []
    for index, blueprint in enumerate(BLUEPRINTS):
        needs = str(blueprint["needs"])
        alt = str(blueprint["alt_platform"])
        platform = str(blueprint["platform"])
        concept = str(blueprint["concept"])
        if needs and needs not in ctx.resources:
            if alt:
                platform = alt
            concept = (
                f"{concept} You did not list {needs.replace('_', ' ')}, so keep "
                "it simple: one clean shot or a still with strong on-screen text."
            )
        day_number = index + 1
        scheduled = dates[index]
        objective_note = objective_notes[(seed + index) % len(objective_notes)]
        lyric = lines[(seed + index) % len(lines)] if lines else ""
        body_bits = [
            _fill(concept, ctx, release_label),
            tone,
            objective_note,
        ]
        if ctx.audience:
            body_bits.append(f"Speaking to: {ctx.audience}.")
        if ctx.locations:
            body_bits.append(f"Worth targeting: {ctx.locations}.")
        if ctx.featured_artists:
            body_bits.append(
                f"Tag {ctx.featured_artists} so it reaches their side too."
            )
        caption_lines = [
            _fill(blueprint["hook"], ctx, release_label).strip("\u201c\u201d"),
            _fill(blueprint["cta"], ctx, release_label),
        ]
        if tail:
            caption_lines.insert(1, tail)
        items.append(
            ItemDraft(
                day_number=day_number,
                week_number=(day_number - 1) // 7 + 1,
                scheduled_for=scheduled,
                campaign_phase=_phase_for(scheduled, ctx.release_date),
                title=_fill(blueprint["title"], ctx, release_label),
                body="\n\n".join(body_bits),
                caption="\n".join(caption_lines),
                hashtags=_hashtags(ctx, index),
                item_type=str(blueprint["item_type"]),
                platform=platform,
                opening_hook=_fill(blueprint["hook"], ctx, release_label),
                content_concept=_fill(concept, ctx, release_label),
                script_notes=f"{_fill(blueprint['script'], ctx, release_label)} {tone}",
                song_section=str(blueprint["section"]),
                suggested_lyric=lyric,
                call_to_action=_fill(blueprint["cta"], ctx, release_label),
                prep_minutes=int(blueprint["prep"]),
            )
        )
    return items, _pitches(ctx, release_label)


def _pitches(ctx: GenerationContext, release_label: str) -> list[PitchDraft]:
    artist = ctx.artist_name or "Independent artist"
    song = ctx.song_title or "the new single"
    genre = ctx.genre or "independent"
    where = ctx.locations or "the UK"
    audience = ctx.audience or "listeners who follow new independent music"
    facts = (
        f"{song} is a {genre.lower()} release"
        + (f" featuring {ctx.featured_artists}" if ctx.featured_artists else "")
        + f", out {release_label}."
    )
    mood_line = f" The mood is {ctx.mood.lower()}." if ctx.mood else ""
    closing = (
        "I have not included any streaming numbers, playlist adds or press "
        "quotes, because I only want to send you things I can back up. If it "
        "is useful I can send the private link, the artwork and a short "
        "biography straight away."
    )
    specs: list[tuple[str, str, str, str]] = [
        (
            "playlist",
            "Spotify editorial pitch",
            f"{artist} \u2013 {song} ({genre})",
            (
                f"{facts} It is a {genre.lower()} track written for "
                f"{audience}.{mood_line} The strongest moment for a first-time "
                "listener is the hook, which arrives early.\n\n"
                f"I am based around {where} and I am releasing this "
                "independently. No numbers are claimed here \u2014 only what the "
                "track is and who it is for."
            ),
        ),
        (
            "radio",
            "Radio introduction",
            f"For airplay: {artist} \u2013 {song} ({genre})",
            (
                f"Hi,\n\n{facts} It sits with {audience}, mostly around "
                f"{where}.{mood_line}\n\n"
                "A clean edit and an instrumental are available on request, and "
                f"I can record a short introduction for the show.\n\n{closing}"
                f"\n\nThanks for your time,\n{artist}"
            ),
        ),
        (
            "blog",
            "Music blog email",
            f"Premiere or review: {artist} \u2013 {song}",
            (
                f"Hi,\n\nI read your writing on new {genre.lower()} music, so I "
                f"wanted to send this over directly.\n\n{facts} It was written "
                f"for {audience}, and it comes out of {where}.{mood_line}\n\n"
                "I am happy to offer an early private listen and to answer "
                f"questions in writing.\n\n{closing}\n\nThanks,\n{artist}"
            ),
        ),
        (
            "playlist",
            "Playlist curator message",
            f"{song} for your {genre.lower()} playlist",
            (
                f"Hi,\n\nI keep my pitch list short, so here is the quick "
                f"version. {facts}{mood_line}\n\n"
                f"It should sit comfortably next to the independent "
                f"{genre.lower()} artists you already feature, and it is aimed "
                f"at {audience}.\n\n{closing}\n\nThanks for listening,\n{artist}"
            ),
        ),
        (
            "press",
            "Short artist biography",
            f"{artist} \u2014 short biography",
            (
                f"{artist} is an independent {genre.lower()} artist based "
                f"around {where}. Their music is written for "
                f"{audience}.{mood_line}\n\n"
                f"{facts} {artist} writes, releases and promotes their own "
                "work.\n\n"
                "This biography contains no achievements or statistics that "
                "have not been supplied by the artist."
            ),
        ),
        (
            "press",
            "Social release announcement",
            f"{song} is out {release_label}",
            (
                f"{song} is out {release_label}.{mood_line} "
                f"Made for {audience}. Save it, share it, tell one person who "
                "would like it. Link in the comments."
            ),
        ),
    ]
    drafts: list[PitchDraft] = []
    for target_type, target_name, subject, body in specs:
        drafts.append(
            PitchDraft(
                target_type=target_type,
                target_name=target_name,
                subject=subject,
                body=body,
            )
        )
    return drafts


def generate_campaign(
    ctx: GenerationContext,
) -> tuple[list[ItemDraft], list[PitchDraft]]:
    """Return exactly 21 content items and six factual pitch drafts."""
    provider = os.environ.get(PROVIDER_ENV, TEMPLATE_PROVIDER).strip().lower()
    if provider not in {"", TEMPLATE_PROVIDER}:
        logging.info(
            f"Generator provider '{provider}' is not wired yet; using templates."
        )
    items, pitches = _generate_with_templates(ctx)
    return items[:21], pitches[:6]
