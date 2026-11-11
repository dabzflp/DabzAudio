"""AI personalisation for the 21-day campaign, through Lyric Book's gateway.

The template engine still builds the schedule and structure, so every campaign
has the same 21 days and six pitches. The model rewrites the creative text on
top of that skeleton. If the model is unavailable or answers badly, the
template version is used and the user is not charged.
"""

from __future__ import annotations

import json
import logging
import os
import re

from droppilot_release_manager import campaign_generator as gen
from droppilot_release_manager import lyric_bridge

AI_FLAG = "DROPPILOT_AI"


class AINotAllowed(Exception):
    """The user must act (top up credits, upgrade) before AI can run."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


SYSTEM = (
    "You are a music marketing strategist writing a 21-day release campaign for an "
    "independent artist. Be specific, practical and honest. Never invent streaming "
    "numbers, press coverage, playlist placements or contacts. Do not promise results. "
    "Reply with a single JSON object and nothing else."
)


def ai_enabled() -> bool:
    return os.environ.get(AI_FLAG, "1").strip().lower() not in {"0", "false", "off", "no"}


def _prompt(ctx: gen.GenerationContext, items: list[gen.ItemDraft], pitches: list[gen.PitchDraft]) -> str:
    brief = {
        "artist": ctx.artist_name,
        "song": ctx.song_title,
        "genre": ", ".join(x for x in [ctx.genre, ctx.secondary_genre] if x),
        "mood": ctx.mood,
        "voice": ctx.personality,
        "goals": ctx.objectives,
        "audience": ctx.audience,
        "target_places": ctx.locations,
        "featured_artists": ctx.featured_artists,
        "release_date": ctx.release_date.isoformat() if ctx.release_date else "not set",
        "lyrics_excerpt": (ctx.lyrics or "")[:1500],
        "available_resources": ctx.resources,
    }
    skeleton = [
        {"day": i.day_number, "platform": i.platform, "type": i.item_type, "phase": i.campaign_phase, "idea": i.title}
        for i in items
    ]
    pitch_targets = [{"target": p.target_name, "type": p.target_type} for p in pitches]
    return (
        f"Artist brief:\n{json.dumps(brief, ensure_ascii=False)}\n\n"
        f"Campaign skeleton (keep the day, platform and type):\n{json.dumps(skeleton)}\n\n"
        f"Pitch targets:\n{json.dumps(pitch_targets)}\n\n"
        "Return JSON shaped exactly like:\n"
        '{"items":[{"day":1,"title":"","opening_hook":"","content_concept":"","caption":"",'
        '"script_notes":"","call_to_action":"","hashtags":"#a #b"}],'
        '"pitches":[{"subject":"","body":""}]}\n'
        "Include all 21 days and all pitches, in order. Keep each field under 400 characters, "
        "pitch bodies under 900. Write in the artist's voice."
    )


def _parse(text: str) -> dict | None:
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    if not text.startswith("{"):
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end <= start:
            return None
        text = text[start : end + 1]
    try:
        data = json.loads(text)
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def _clean(value: object, limit: int) -> str:
    return str(value).strip()[:limit] if isinstance(value, (str, int, float)) else ""


def _merge(items: list[gen.ItemDraft], pitches: list[gen.PitchDraft], data: dict) -> int:
    """Overlay model text on the template; returns how many fields were replaced."""
    changed = 0
    by_day = {}
    for row in data.get("items") or []:
        if isinstance(row, dict):
            try:
                by_day[int(row.get("day"))] = row
            except (TypeError, ValueError):
                continue
    fields = {
        "title": ("title", 140),
        "opening_hook": ("opening_hook", 400),
        "content_concept": ("content_concept", 600),
        "caption": ("caption", 900),
        "script_notes": ("script_notes", 600),
        "call_to_action": ("call_to_action", 300),
        "hashtags": ("hashtags", 300),
    }
    for item in items:
        row = by_day.get(item.day_number)
        if not row:
            continue
        for key, (attr, limit) in fields.items():
            value = _clean(row.get(key), limit)
            if value:
                setattr(item, attr, value)
                changed += 1
        if row.get("content_concept"):
            item.body = _clean(row["content_concept"], 600)
    rows = [r for r in (data.get("pitches") or []) if isinstance(r, dict)]
    for pitch, row in zip(pitches, rows):
        subject = _clean(row.get("subject"), 200)
        body = _clean(row.get("body"), 1500)
        if subject and body:
            pitch.subject, pitch.body = subject, body
            changed += 2
    return changed


async def generate(
    ctx: gen.GenerationContext, uid: int, model_tier: str = "standard"
) -> tuple[list[gen.ItemDraft], list[gen.PitchDraft], bool]:
    """Returns (items, pitches, ai_used). Raises AINotAllowed when the user must act."""
    items, pitches = gen.generate_campaign(ctx)
    if not ai_enabled():
        return items, pitches, False
    try:
        text, _left = await lyric_bridge.generate(
            uid, "campaign_generate", SYSTEM, _prompt(ctx, items, pitches), model_tier
        )
    except lyric_bridge.AIError as err:
        if err.code == "INSUFFICIENT_CREDITS":
            raise AINotAllowed(err.code, "You need more AI credits to generate a campaign. Top up from your Lyric Book plan page.") from err
        if err.code == "PRO_REQUIRED":
            raise AINotAllowed(err.code, "Your Pro plan is not active, so Drop Pilot is read-only.") from err
        if err.code == "DAILY_CAP":
            raise AINotAllowed(err.code, "You have reached today's generation limit. Try again tomorrow.") from err
        logging.warning("AI generation unavailable (%s); using the built-in planner.", err.code)
        return items, pitches, False
    data = _parse(text)
    if not data or not _merge(items, pitches, data):
        logging.warning("AI reply could not be used; kept the built-in plan.")
        return items, pitches, False
    return items, pitches, True
