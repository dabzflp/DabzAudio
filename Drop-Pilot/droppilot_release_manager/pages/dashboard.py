import reflex as rx

from droppilot_release_manager import lyric_bridge

from droppilot_release_manager.components.app_shell import app_shell
from droppilot_release_manager.components.brand import alert, waveform
from droppilot_release_manager.states.auth_state import AuthState
from droppilot_release_manager.states.dashboard_state import (
    DashboardState,
    ReleaseRow,
    TaskRow,
)

CARD = "w-full rounded-2xl border border-white/10 bg-white/[0.02] p-5"


def _stat(
    label: str, value: rx.Var | str, icon: str, hint: rx.Var | str
) -> rx.Component:
    return rx.el.div(
        rx.el.div(
            rx.icon(icon, class_name="h-4 w-4 text-violet-300"),
            rx.el.p(
                label,
                class_name="text-xs font-semibold uppercase tracking-wider text-stone-500",
            ),
            class_name="flex items-center gap-2",
        ),
        rx.el.p(
            value,
            class_name="mt-3 text-2xl font-semibold tracking-tight text-stone-50",
        ),
        rx.el.p(hint, class_name="mt-1 text-xs font-medium text-stone-500"),
        class_name=f"{CARD} w-full",
    )


def _skeleton() -> rx.Component:
    return rx.el.div(
        rx.el.div(
            class_name="h-28 w-full animate-pulse rounded-2xl bg-white/[0.04]"
        ),
        rx.el.div(
            rx.el.div(
                class_name="h-24 w-full animate-pulse rounded-2xl bg-white/[0.04]"
            ),
            rx.el.div(
                class_name="h-24 w-full animate-pulse rounded-2xl bg-white/[0.04]"
            ),
            rx.el.div(
                class_name="h-24 w-full animate-pulse rounded-2xl bg-white/[0.04]"
            ),
            rx.el.div(
                class_name="h-24 w-full animate-pulse rounded-2xl bg-white/[0.04]"
            ),
            class_name="grid w-full grid-cols-2 gap-4 lg:grid-cols-4",
        ),
        rx.el.div(
            class_name="h-64 w-full animate-pulse rounded-2xl bg-white/[0.04]"
        ),
        class_name="flex w-full flex-col gap-4",
    )


def _artwork(path: rx.Var, size: str) -> rx.Component:
    return rx.cond(
        path != "",
        rx.image(
            src=rx.get_upload_url(path),
            alt="Release artwork",
            class_name=f"{size} rounded-2xl object-cover",
        ),
        rx.el.div(
            rx.icon("disc-3", class_name="h-7 w-7 text-violet-300"),
            class_name=f"{size} flex items-center justify-center rounded-2xl border border-violet-400/20 bg-violet-400/10",
        ),
    )


def _active_card() -> rx.Component:
    return rx.el.div(
        rx.el.div(
            _artwork(DashboardState.active["artwork"], "h-20 w-20 shrink-0"),
            rx.el.div(
                rx.el.div(
                    rx.el.span(
                        DashboardState.active["countdown_label"],
                        class_name="w-fit rounded-full bg-orange-400/15 px-3 py-1 text-[11px] font-semibold text-orange-200",
                    ),
                    rx.cond(
                        DashboardState.active["is_demo"],
                        rx.el.span(
                            "Demo",
                            class_name="w-fit rounded-full border border-white/10 px-3 py-1 text-[11px] font-semibold text-stone-400",
                        ),
                        rx.fragment(),
                    ),
                    class_name="flex flex-wrap items-center gap-2",
                ),
                rx.el.h2(
                    DashboardState.active["title"],
                    class_name="mt-3 truncate text-2xl font-semibold tracking-tight text-stone-50",
                ),
                rx.el.p(
                    f"{DashboardState.active['release_date']} \u00b7 {DashboardState.active['goal']}",
                    class_name="mt-1 text-sm font-medium text-stone-400",
                ),
                class_name="min-w-0 flex-1",
            ),
            class_name="flex min-w-0 items-start gap-4",
        ),
        rx.el.div(
            rx.el.div(
                rx.el.p(
                    "Plan progress",
                    class_name="text-xs font-semibold uppercase tracking-wider text-stone-500",
                ),
                rx.el.p(
                    f"{DashboardState.active['done_items']} of {DashboardState.active['total_items']} done",
                    class_name="text-xs font-semibold text-violet-200",
                ),
                class_name="flex items-center justify-between gap-4",
            ),
            rx.el.div(
                rx.el.div(
                    class_name="h-full rounded-full bg-violet-400 transition-all duration-500",
                    style={"width": f"{DashboardState.active['progress']}%"},
                ),
                class_name="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10",
            ),
            class_name="mt-6 w-full",
        ),
        rx.el.div(
            rx.el.a(
                rx.icon("list-checks", class_name="h-4 w-4"),
                "Open campaign",
                href=f"/campaigns/{DashboardState.active['campaign_id']}",
                class_name="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-400 px-4 py-2.5 text-sm font-semibold text-stone-950 transition-colors hover:bg-violet-300 sm:w-fit",
            ),
            rx.el.a(
                rx.icon("printer", class_name="h-4 w-4"),
                "Printable plan",
                href=f"/campaigns/{DashboardState.active['campaign_id']}/print",
                class_name="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-stone-200 transition-colors hover:border-violet-400/50 sm:w-fit",
            ),
            class_name="mt-6 flex flex-col gap-2 sm:flex-row",
        ),
        class_name="w-full rounded-2xl border border-white/10 bg-white/[0.03] p-6",
    )


def _empty_state() -> rx.Component:
    return rx.el.div(
        rx.el.div(
            rx.icon("rocket", class_name="h-5 w-5 text-violet-300"),
            class_name="flex h-12 w-12 items-center justify-center rounded-2xl border border-violet-400/20 bg-violet-400/10",
        ),
        rx.el.h2(
            "No campaigns yet.",
            class_name="mt-5 text-2xl font-semibold tracking-tight text-stone-50",
        ),
        rx.el.p(
            "Add a release and DropPilot builds a 21-day plan from the details you submit. If you would rather look around first, load an example campaign into your own account.",
            class_name="mt-3 max-w-xl text-sm font-medium leading-relaxed text-stone-400",
        ),
        rx.el.div(
            rx.el.a(
                rx.icon("plus", class_name="h-4 w-4"),
                "Create a campaign",
                href="/campaigns/new",
                class_name="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-400 px-5 py-3 text-sm font-semibold text-stone-950 transition-colors hover:bg-violet-300 sm:w-fit",
            ),
            rx.el.button(
                rx.cond(
                    DashboardState.is_seeding,
                    rx.icon("loader-circle", class_name="h-4 w-4 animate-spin"),
                    rx.icon("play", class_name="h-4 w-4"),
                ),
                rx.cond(
                    DashboardState.is_seeding,
                    "Building demo\u2026",
                    "Load Demo Campaign",
                ),
                on_click=DashboardState.load_demo_campaign,
                disabled=DashboardState.is_seeding,
                class_name="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-stone-200 transition-colors hover:border-violet-400/50 disabled:opacity-60 sm:w-fit",
            ),
            class_name="mt-7 flex flex-col gap-2 sm:flex-row",
        ),
        waveform("mt-10 opacity-50"),
        class_name="w-full rounded-2xl border border-white/10 bg-white/[0.02] p-6 sm:p-8",
    )


def _task_row(task: TaskRow) -> rx.Component:
    return rx.el.a(
        rx.el.span(
            f"Day {task['day_number']}",
            class_name="w-16 shrink-0 text-xs font-bold uppercase tracking-wider text-stone-500",
        ),
        rx.el.div(
            rx.el.p(
                task["title"],
                class_name="truncate text-sm font-semibold text-stone-100",
            ),
            rx.el.p(
                f"{task['platform']} \u00b7 {task['scheduled']} \u00b7 {task['prep_minutes']} min",
                class_name="mt-0.5 truncate text-xs font-medium text-stone-500",
            ),
            class_name="min-w-0 flex-1",
        ),
        rx.el.span(
            task["phase"],
            class_name="w-fit shrink-0 rounded-full bg-violet-400/10 px-2.5 py-1 text-[11px] font-semibold capitalize text-violet-200",
        ),
        href=f"/campaigns/{task['campaign_id']}",
        class_name="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5 transition-colors hover:border-violet-400/30",
    )


def _task_list(title: str, icon: str, rows: rx.Var, empty: str) -> rx.Component:
    return rx.el.div(
        rx.el.div(
            rx.icon(icon, class_name="h-4 w-4 text-violet-300"),
            rx.el.h3(title, class_name="text-sm font-semibold text-stone-100"),
            class_name="flex items-center gap-2",
        ),
        rx.cond(
            rows.length() > 0,
            rx.el.div(
                rx.foreach(rows, _task_row),
                class_name="mt-4 flex flex-col gap-2",
            ),
            rx.el.p(
                empty,
                class_name="mt-4 text-sm font-medium leading-relaxed text-stone-500",
            ),
        ),
        class_name=CARD,
    )


def _release_card(release: ReleaseRow) -> rx.Component:
    return rx.el.div(
        _artwork(release["artwork"], "h-14 w-14 shrink-0"),
        rx.el.div(
            rx.el.p(
                release["title"],
                class_name="truncate text-sm font-semibold text-stone-100",
            ),
            rx.el.p(
                f"{release['release_date']} \u00b7 {release['item_count']} items",
                class_name="mt-0.5 truncate text-xs font-medium text-stone-500",
            ),
            class_name="min-w-0 flex-1",
        ),
        rx.cond(
            release["campaign_id"] > 0,
            rx.el.a(
                rx.icon("arrow-right", class_name="h-4 w-4"),
                href=f"/campaigns/{release['campaign_id']}",
                class_name="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 text-stone-300 transition-colors hover:border-violet-400/40 hover:text-stone-50",
            ),
            rx.fragment(),
        ),
        class_name="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-3",
    )


def _quota_prompt() -> rx.Component:
    return rx.el.div(
        rx.el.div(
            rx.icon("zap", class_name="h-4 w-4 text-orange-200"),
            rx.el.p(
                "You have used every campaign on your plan.",
                class_name="text-sm font-semibold text-orange-100",
            ),
            class_name="flex items-center gap-2",
        ),
        rx.el.p(
            f"{DashboardState.quota_label}. Upgrade to plan your next release without deleting this one.",
            class_name="mt-2 text-sm font-medium leading-relaxed text-orange-100/80",
        ),
        rx.el.a(
            "See plans",
            href=lyric_bridge.app_url("subscription.html"),
            class_name="mt-4 flex w-fit items-center rounded-xl bg-orange-400 px-4 py-2 text-sm font-semibold text-stone-950 transition-colors hover:bg-orange-300",
        ),
        class_name="w-full rounded-2xl border border-orange-400/30 bg-orange-400/[0.07] p-5",
    )


def _content() -> rx.Component:
    return rx.el.div(
        rx.el.div(
            rx.el.div(
                rx.el.p(
                    "Overview",
                    class_name="text-xs font-semibold uppercase tracking-[0.2em] text-violet-300",
                ),
                rx.el.h1(
                    f"Welcome back, {AuthState.display_name}.",
                    class_name="mt-2 text-3xl font-semibold tracking-tight text-stone-50",
                ),
                rx.el.p(
                    f"{DashboardState.plan_label} plan \u00b7 {DashboardState.quota_label}",
                    class_name="mt-2 text-sm font-medium text-stone-400",
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
            DashboardState.error != "",
            rx.el.div(alert(DashboardState.error), class_name="mt-6 w-full"),
            rx.fragment(),
        ),
        rx.cond(
            DashboardState.notice != "",
            rx.el.div(
                alert(DashboardState.notice, "success"),
                class_name="mt-6 w-full",
            ),
            rx.fragment(),
        ),
        rx.cond(
            DashboardState.quota_reached,
            rx.el.div(_quota_prompt(), class_name="mt-6 w-full"),
            rx.fragment(),
        ),
        rx.el.div(
            _stat(
                "Campaigns",
                DashboardState.campaign_count.to_string(),
                "rocket",
                DashboardState.quota_label,
            ),
            _stat(
                "Releases",
                DashboardState.release_count.to_string(),
                "disc-3",
                "In your account",
            ),
            _stat(
                "Content items",
                DashboardState.items_total.to_string(),
                "list-checks",
                f"{DashboardState.items_done} completed",
            ),
            _stat(
                "Plan completion",
                f"{DashboardState.completion_percent}%",
                "trending-up",
                "Across all campaigns",
            ),
            class_name="mt-6 grid w-full grid-cols-2 gap-4 lg:grid-cols-4",
        ),
        rx.cond(
            DashboardState.has_campaigns,
            rx.el.div(
                _active_card(),
                rx.el.div(
                    _task_list(
                        "Today's tasks",
                        "calendar-check",
                        DashboardState.today_tasks,
                        "Nothing is scheduled for today. Enjoy the quiet or pull something forward.",
                    ),
                    _task_list(
                        "Coming up",
                        "calendar-days",
                        DashboardState.upcoming,
                        "No upcoming items in the next ten days.",
                    ),
                    class_name="grid w-full grid-cols-1 gap-4 xl:grid-cols-2",
                ),
                rx.el.div(
                    rx.el.div(
                        rx.el.div(
                            rx.icon(
                                "disc-3", class_name="h-4 w-4 text-violet-300"
                            ),
                            rx.el.h3(
                                "Recent releases",
                                class_name="text-sm font-semibold text-stone-100",
                            ),
                            class_name="flex items-center gap-2",
                        ),
                        rx.el.a(
                            "View all",
                            href="/releases",
                            class_name="w-fit text-xs font-semibold text-violet-300 transition-colors hover:text-violet-200",
                        ),
                        class_name="flex items-center justify-between gap-4",
                    ),
                    rx.cond(
                        DashboardState.recent_releases.length() > 0,
                        rx.el.div(
                            rx.foreach(
                                DashboardState.recent_releases, _release_card
                            ),
                            class_name="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2",
                        ),
                        rx.el.p(
                            "No releases saved yet.",
                            class_name="mt-4 text-sm font-medium text-stone-500",
                        ),
                    ),
                    class_name=CARD,
                ),
                rx.cond(
                    DashboardState.has_demo,
                    rx.fragment(),
                    rx.el.div(
                        rx.el.div(
                            rx.el.p(
                                "Want a worked example?",
                                class_name="text-sm font-semibold text-stone-100",
                            ),
                            rx.el.p(
                                "Load a demo release with a full 21-day plan and six pitch drafts into your own account.",
                                class_name="mt-1 text-sm font-medium text-stone-400",
                            ),
                            class_name="min-w-0",
                        ),
                        rx.el.button(
                            rx.cond(
                                DashboardState.is_seeding,
                                rx.icon(
                                    "loader-circle",
                                    class_name="h-4 w-4 animate-spin",
                                ),
                                rx.icon("play", class_name="h-4 w-4"),
                            ),
                            "Load Demo Campaign",
                            on_click=DashboardState.load_demo_campaign,
                            disabled=DashboardState.is_seeding,
                            class_name="flex w-full shrink-0 items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-stone-200 transition-colors hover:border-violet-400/50 disabled:opacity-60 sm:w-fit",
                        ),
                        class_name=f"{CARD} flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center",
                    ),
                ),
                class_name="mt-6 flex w-full flex-col gap-4",
            ),
            rx.el.div(_empty_state(), class_name="mt-6 w-full"),
        ),
        class_name="mx-auto flex w-full max-w-6xl flex-col",
    )


def dashboard_page() -> rx.Component:
    return app_shell(
        rx.cond(DashboardState.is_loading, _skeleton(), _content()),
        active="/dashboard",
    )
