import reflex as rx

from droppilot_release_manager.components.app_shell import app_shell
from droppilot_release_manager.components.brand import alert
from droppilot_release_manager.states.releases_state import ReleaseCard, ReleasesState


def _artwork(path: rx.Var) -> rx.Component:
    return rx.cond(
        path != "",
        rx.image(
            src=rx.get_upload_url(path),
            alt="Release artwork",
            class_name="h-16 w-16 shrink-0 rounded-2xl object-cover",
        ),
        rx.el.div(
            rx.icon("disc-3", class_name="h-6 w-6 text-violet-300"),
            class_name="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-violet-400/20 bg-violet-400/10",
        ),
    )


def _card(release: ReleaseCard) -> rx.Component:
    return rx.el.div(
        rx.el.div(
            _artwork(release["artwork"]),
            rx.el.div(
                rx.el.p(
                    release["title"],
                    class_name="truncate text-base font-semibold text-stone-50",
                ),
                rx.el.p(
                    f"{release['release_type']} \u00b7 {release['genre']} \u00b7 {release['release_date']}",
                    class_name="mt-1 truncate text-xs font-medium capitalize text-stone-500",
                ),
                rx.el.span(
                    release["countdown"],
                    class_name="mt-2 flex w-fit rounded-full bg-orange-400/15 px-2.5 py-1 text-[11px] font-semibold text-orange-200",
                ),
                class_name="min-w-0 flex-1",
            ),
            class_name="flex min-w-0 items-start gap-4",
        ),
        rx.el.div(
            rx.el.div(
                rx.el.p(
                    release["campaign_name"],
                    class_name="truncate text-xs font-medium text-stone-400",
                ),
                rx.el.p(
                    f"{release['done_items']}/{release['total_items']}",
                    class_name="shrink-0 text-xs font-semibold text-violet-200",
                ),
                class_name="flex items-center justify-between gap-3",
            ),
            rx.el.div(
                rx.el.div(
                    class_name="h-full rounded-full bg-violet-400",
                    style={"width": f"{release['progress']}%"},
                ),
                class_name="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10",
            ),
            class_name="mt-5 w-full",
        ),
        rx.cond(
            release["campaign_id"] > 0,
            rx.el.a(
                "Open campaign",
                rx.icon("arrow-right", class_name="h-4 w-4"),
                href=f"/campaigns/{release['campaign_id']}",
                class_name="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-stone-200 transition-colors hover:border-violet-400/50",
            ),
            rx.el.a(
                "Plan this release",
                href="/campaigns/new",
                class_name="mt-5 flex w-full items-center justify-center rounded-xl bg-violet-400 px-4 py-2.5 text-sm font-semibold text-stone-950 transition-colors hover:bg-violet-300",
            ),
        ),
        class_name="flex w-full flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-5",
    )


def _content() -> rx.Component:
    return rx.el.div(
        rx.el.div(
            rx.el.div(
                rx.el.h1(
                    "My releases",
                    class_name="text-3xl font-semibold tracking-tight text-stone-50",
                ),
                rx.cond(
                    ReleasesState.query != "",
                    rx.el.p(
                        f"Filtered by \u201c{ReleasesState.query}\u201d",
                        class_name="mt-2 text-sm font-medium text-stone-400",
                    ),
                    rx.el.p(
                        "Every release saved to your account.",
                        class_name="mt-2 text-sm font-medium text-stone-400",
                    ),
                ),
                class_name="min-w-0",
            ),
            rx.el.a(
                rx.icon("plus", class_name="h-4 w-4"),
                "New campaign",
                href="/campaigns/new",
                class_name="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-400 px-5 py-3 text-sm font-semibold text-stone-950 transition-colors hover:bg-violet-300 sm:w-fit",
            ),
            class_name="flex w-full flex-col items-start justify-between gap-5 sm:flex-row sm:items-center",
        ),
        rx.cond(
            ReleasesState.error != "",
            rx.el.div(alert(ReleasesState.error), class_name="mt-6 w-full"),
            rx.fragment(),
        ),
        rx.cond(
            ReleasesState.has_releases,
            rx.el.div(
                rx.foreach(ReleasesState.releases, _card),
                class_name="mt-6 grid w-full grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3",
            ),
            rx.el.div(
                rx.icon("disc-3", class_name="h-6 w-6 text-violet-300"),
                rx.el.p(
                    "No releases here yet.",
                    class_name="mt-4 text-lg font-semibold text-stone-50",
                ),
                rx.el.p(
                    "Add a release in the campaign wizard and it will appear here with its plan progress.",
                    class_name="mt-2 max-w-md text-sm font-medium leading-relaxed text-stone-400",
                ),
                rx.el.a(
                    "Start a campaign",
                    href="/campaigns/new",
                    class_name="mt-6 flex w-fit items-center rounded-xl bg-violet-400 px-5 py-3 text-sm font-semibold text-stone-950 transition-colors hover:bg-violet-300",
                ),
                class_name="mt-6 w-full rounded-2xl border border-white/10 bg-white/[0.02] p-8",
            ),
        ),
        class_name="mx-auto flex w-full max-w-6xl flex-col",
    )


def releases_page() -> rx.Component:
    return app_shell(
        rx.cond(
            ReleasesState.is_loading,
            rx.el.div(
                class_name="h-64 w-full animate-pulse rounded-2xl bg-white/[0.04]"
            ),
            _content(),
        ),
        active="/releases",
    )
