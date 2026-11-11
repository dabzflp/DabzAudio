import datetime
import logging
from typing import TypedDict

import reflex as rx
from sqlalchemy import select

from droppilot_release_manager.models import Campaign, CampaignItem, CampaignItemStatus, Release


class ReleaseCard(TypedDict):
    id: int
    title: str
    genre: str
    release_type: str
    release_date: str
    countdown: str
    artwork: str
    campaign_id: int
    campaign_name: str
    total_items: int
    done_items: int
    progress: int
    is_demo: bool


class ReleasesState(rx.State):
    """Owned release list with optional search from the top bar."""

    is_loading: bool = True
    error: str = ""
    query: str = ""
    releases: list[ReleaseCard] = []

    @rx.var
    def has_releases(self) -> bool:
        return len(self.releases) > 0

    @rx.event
    async def load(self):
        from droppilot_release_manager.states.auth_state import AuthState

        auth = await self.get_state(AuthState)
        uid = auth.user_id
        self.query = str(self.router.url.query_parameters.get("q", ""))
        self.is_loading = True
        self.error = ""
        yield
        if uid <= 0:
            self.is_loading = False
            return
        try:
            async with rx.asession() as session:
                releases = (
                    await session.scalars(
                        select(Release)
                        .where(Release.user_id == uid)
                        .order_by(Release.release_date.desc())
                        .limit(50)
                    )
                ).all()
                campaigns = (
                    await session.scalars(
                        select(Campaign).where(Campaign.user_id == uid)
                    )
                ).all()
                campaign_by_release: dict[int, Campaign] = {}
                for c in campaigns:
                    if c.release_id is not None:
                        campaign_by_release.setdefault(c.release_id, c)
                items: list[CampaignItem] = []
                if campaigns:
                    items = list(
                        (
                            await session.scalars(
                                select(CampaignItem).where(
                                    CampaignItem.campaign_id.in_(
                                        [c.id for c in campaigns]
                                    )
                                )
                            )
                        ).all()
                    )
                totals: dict[int, int] = {}
                dones: dict[int, int] = {}
                for i in items:
                    totals[i.campaign_id] = totals.get(i.campaign_id, 0) + 1
                    if i.status == CampaignItemStatus.DONE.value:
                        dones[i.campaign_id] = dones.get(i.campaign_id, 0) + 1

                needle = self.query.strip().lower()
                cards: list[ReleaseCard] = []
                for r in releases:
                    if needle and needle not in (
                        f"{r.title} {r.primary_genre}".lower()
                    ):
                        continue
                    campaign = campaign_by_release.get(r.id)
                    cid = int(campaign.id) if campaign else 0
                    total = totals.get(cid, 0)
                    done = dones.get(cid, 0)
                    days = (
                        (r.release_date - datetime.date.today()).days
                        if r.release_date
                        else 0
                    )
                    cards.append(
                        {
                            "id": int(r.id),
                            "title": r.title,
                            "genre": r.primary_genre,
                            "release_type": r.release_type,
                            "release_date": (
                                r.release_date.strftime("%d %b %Y")
                                if r.release_date
                                else "No date set"
                            ),
                            "countdown": (
                                f"{days} days to go"
                                if days > 0
                                else (
                                    "Out today"
                                    if days == 0
                                    else f"Out {abs(days)} days"
                                )
                            ),
                            "artwork": r.artwork_path,
                            "campaign_id": cid,
                            "campaign_name": (
                                campaign.name if campaign else "No campaign yet"
                            ),
                            "total_items": total,
                            "done_items": done,
                            "progress": (
                                int(done / total * 100) if total else 0
                            ),
                            "is_demo": bool(campaign.is_demo)
                            if campaign
                            else False,
                        }
                    )
                self.releases = cards
        except Exception as e:
            logging.exception(f"Releases load failed: {e}")
            self.error = "We could not load your releases. Please refresh."
        self.is_loading = False
