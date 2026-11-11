import reflex as rx

from droppilot_release_manager.components.app_shell import app_shell
from droppilot_release_manager.components.brand import alert, waveform
from droppilot_release_manager.states.calendar_state import CalendarState, DayCell, TaskGroup, TaskRow

INPUT = (
    "w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 "
    "text-sm font-medium text-stone-50 placeholder:text-stone-500 "
    "outline-hidden transition-colors focus:border-violet-400 "
    "focus:ring-2 focus:ring-violet-400/30"
)
GHOST_BUTTON = (
    "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border "
    "border-white/10 text-stone-300 transition-colors "
    "hover:border-violet-400/40 hover:text-stone-50"
)


def _status_pill(task: TaskRow) -> rx.Component:
    return rx.el.span(
        task["status_label"],
        class_name=rx.cond(
            task["status"] == "done",
            "w-fit rounded-full bg-emerald-400/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-200",
            rx.cond(
                task["status"] == "in_progress",
                "w-fit rounded-full bg-violet-400/15 px-2.5 py-1 text-[11px] font-semibold text-violet-200",
                rx.cond(
                    task["status"] == "skipped",
                    "w-fit rounded-full bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-stone-400",
                    "w-fit rounded-full bg-orange-400/15 px-2.5 py-1 text-[11px] font-semibold text-orange-200",
                ),
            ),
        ),
    )


def _platform_chip(task: TaskRow) -> rx.Component:
    return rx.el.span(
        rx.icon(task["platform_icon"], class_name="h-3 w-3"),
        rx.el.span(task["platform_label"]),
        class_name=rx.match(
            task["platform"],
            (
                "instagram",
                "flex w-fit items-center gap-1 rounded-full border border-violet-400/30 bg-violet-400/10 px-2 py-0.5 text-[10px] font-semibold text-violet-100",
            ),
            (
                "tiktok",
                "flex w-fit items-center gap-1 rounded-full border border-orange-400/30 bg-orange-400/10 px-2 py-0.5 text-[10px] font-semibold text-orange-100",
            ),
            (
                "youtube",
                "flex w-fit items-center gap-1 rounded-full border border-rose-400/30 bg-rose-400/10 px-2 py-0.5 text-[10px] font-semibold text-rose-100",
            ),
            (
                "spotify",
                "flex w-fit items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-100",
            ),
            (
                "email",
                "flex w-fit items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-100",
            ),
            (
                "x",
                "flex w-fit items-center gap-1 rounded-full border border-sky-400/30 bg-sky-400/10 px-2 py-0.5 text-[10px] font-semibold text-sky-100",
            ),
            "flex w-fit items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-stone-200",
        ),
    )


def _month_chip(task: TaskRow) -> rx.Component:
    return rx.el.button(
        rx.icon(task["platform_icon"], class_name="h-3 w-3 shrink-0"),
        rx.el.span(
            task["title"],
            class_name="min-w-0 flex-1 truncate text-left text-[11px] font-semibold",
        ),
        on_click=lambda: CalendarState.open_task(task["id"]),
        title=task["title"],
        class_name=rx.cond(
            task["status"] == "done",
            "flex w-full items-center gap-1.5 rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-1.5 py-1 text-emerald-100 transition-colors hover:border-emerald-400/50",
            "flex w-full items-center gap-1.5 rounded-lg border border-violet-400/25 bg-violet-400/10 px-1.5 py-1 text-violet-100 transition-colors hover:border-violet-400/60",
        ),
    )


def _month_cell(cell: DayCell) -> rx.Component:
    return rx.el.div(
        rx.el.div(
            rx.el.span(
                cell["day_label"],
                class_name=rx.cond(
                    cell["is_today"],
                    "flex h-6 w-6 items-center justify-center rounded-full bg-violet-400 text-[11px] font-bold text-stone-950",
                    rx.cond(
                        cell["in_month"],
                        "text-[11px] font-semibold text-stone-300",
                        "text-[11px] font-semibold text-stone-600",
                    ),
                ),
            ),
            rx.cond(
                cell["task_count"] > 0,
                rx.el.span(
                    cell["task_count"],
                    class_name="w-fit rounded-full bg-white/5 px-1.5 text-[10px] font-semibold text-stone-400",
                ),
                rx.fragment(),
            ),
            class_name="flex items-center justify-between gap-1",
        ),
        rx.el.div(
            rx.foreach(cell["tasks"], _month_chip),
            class_name="mt-2 flex flex-col gap-1",
        ),
        class_name=rx.cond(
            cell["in_month"],
            "flex min-h-28 flex-col rounded-xl border border-white/10 bg-white/[0.03] p-2",
            "flex min-h-28 flex-col rounded-xl border border-white/5 bg-white/[0.01] p-2",
        ),
    )


def _month_view() -> rx.Component:
    return rx.el.div(
        rx.el.div(
            rx.el.div(
                rx.foreach(
                    CalendarState.weekdays,
                    lambda day: rx.el.p(
                        day,
                        class_name="px-2 text-[11px] font-bold uppercase tracking-wider text-stone-500",
                    ),
                ),
                class_name="grid grid-cols-7 gap-2",
            ),
            rx.el.div(
                rx.foreach(CalendarState.month_cells, _month_cell),
                class_name="mt-2 grid grid-cols-7 gap-2",
            ),
            class_name="min-w-[860px]",
        ),
        class_name="w-full overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.02] p-3",
    )


def _agenda_task(task: TaskRow) -> rx.Component:
    return rx.el.button(
        rx.el.div(
            _platform_chip(task),
            _status_pill(task),
            class_name="flex flex-wrap items-center gap-2",
        ),
        rx.el.p(
            task["title"],
            class_name="mt-2 text-left text-sm font-semibold text-stone-50",
        ),
        rx.el.p(
            f"{task['item_type_label']} \u00b7 {task['song']}",
            class_name="mt-1 text-left text-[11px] font-medium text-stone-400",
        ),
        rx.el.p(
            task["scheduled_label"],
            class_name="mt-1 text-left text-[11px] font-medium text-stone-500",
        ),
        on_click=lambda: CalendarState.open_task(task["id"]),
        class_name="flex w-full flex-col rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:border-violet-400/40",
    )


def _week_column(cell: DayCell) -> rx.Component:
    return rx.el.div(
        rx.el.div(
            rx.el.p(
                cell["weekday_label"],
                class_name="text-[11px] font-bold uppercase tracking-wider text-stone-500",
            ),
            rx.el.p(
                cell["day_label"],
                class_name=rx.cond(
                    cell["is_today"],
                    "text-lg font-semibold text-violet-200",
                    "text-lg font-semibold text-stone-100",
                ),
            ),
            class_name="flex items-baseline justify-between gap-2 border-b border-white/5 pb-2",
        ),
        rx.cond(
            cell["task_count"] > 0,
            rx.el.div(
                rx.foreach(cell["tasks"], _agenda_task),
                class_name="mt-3 flex flex-col gap-2",
            ),
            rx.el.p(
                "Nothing scheduled",
                class_name="mt-3 text-[11px] font-medium text-stone-600",
            ),
        ),
        class_name=rx.cond(
            cell["is_today"],
            "flex w-full min-w-0 flex-col rounded-2xl border border-violet-400/30 bg-violet-400/[0.05] p-3",
            "flex w-full min-w-0 flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-3",
        ),
    )


def _week_view() -> rx.Component:
    return rx.el.div(
        rx.el.div(
            rx.foreach(CalendarState.week_cells, _week_column),
            class_name="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:min-w-[1000px] lg:grid-cols-7",
        ),
        class_name="w-full lg:overflow-x-auto",
    )


def _list_group(group: TaskGroup) -> rx.Component:
    return rx.el.div(
        rx.el.div(
            rx.el.p(
                group["label"],
                class_name="text-sm font-semibold text-stone-100",
            ),
            rx.el.span(
                group["sub_label"],
                class_name="w-fit rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-semibold text-stone-400",
            ),
            class_name="flex flex-wrap items-center justify-between gap-2",
        ),
        rx.el.div(
            rx.foreach(group["tasks"], _list_row),
            class_name="mt-3 flex flex-col gap-2",
        ),
        class_name="w-full rounded-2xl border border-white/10 bg-white/[0.02] p-4",
    )


def _list_row(task: TaskRow) -> rx.Component:
    return rx.el.button(
        rx.el.div(
            rx.icon(task["platform_icon"], class_name="h-4 w-4"),
            class_name="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-violet-200",
        ),
        rx.el.div(
            rx.el.p(
                task["title"],
                class_name="truncate text-left text-sm font-semibold text-stone-50",
            ),
            rx.el.p(
                f"{task['platform_label']} \u00b7 {task['item_type_label']} \u00b7 {task['song']}",
                class_name="mt-0.5 truncate text-left text-[11px] font-medium text-stone-400",
            ),
            class_name="min-w-0 flex-1",
        ),
        rx.el.span(
            task["scheduled_label"],
            class_name="hidden shrink-0 text-[11px] font-medium text-stone-500 sm:block",
        ),
        _status_pill(task),
        on_click=lambda: CalendarState.open_task(task["id"]),
        class_name="flex w-full items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5 transition-colors hover:border-violet-400/30",
    )


def _list_view() -> rx.Component:
    return rx.el.div(
        rx.foreach(CalendarState.list_groups, _list_group),
        class_name="flex w-full flex-col gap-3",
    )


def _select(
    options: rx.Var, value: rx.Var, handler, width: str = "sm:w-48"
) -> rx.Component:
    return rx.el.div(
        rx.el.select(
            rx.foreach(
                options,
                lambda option: rx.el.option(
                    option["label"], value=option["value"]
                ),
            ),
            value=value,
            on_change=handler,
            class_name=f"appearance-none {INPUT}",
        ),
        rx.icon(
            "chevron-down",
            class_name="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500",
        ),
        class_name=f"relative w-full {width}",
    )


def _view_button(item: dict[str, str]) -> rx.Component:
    return rx.el.button(
        rx.icon(item["icon"], class_name="h-4 w-4"),
        rx.el.span(item["label"]),
        on_click=lambda: CalendarState.set_view(item["value"]),
        class_name=rx.cond(
            CalendarState.view == item["value"],
            "flex flex-1 items-center justify-center gap-2 rounded-xl bg-violet-400/10 px-4 py-2.5 text-sm font-semibold text-violet-100 sm:flex-none",
            "flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-stone-400 transition-colors hover:text-stone-100 sm:flex-none",
        ),
    )


def _controls() -> rx.Component:
    return rx.el.div(
        rx.el.div(
            rx.el.button(
                rx.icon("chevron-left", class_name="h-4 w-4"),
                on_click=lambda: CalendarState.shift(-1),
                aria_label="Previous period",
                class_name=GHOST_BUTTON,
            ),
            rx.el.button(
                "Today",
                on_click=CalendarState.go_today,
                class_name="h-10 shrink-0 rounded-xl border border-white/10 px-4 text-sm font-semibold text-stone-200 transition-colors hover:border-violet-400/40",
            ),
            rx.el.button(
                rx.icon("chevron-right", class_name="h-4 w-4"),
                on_click=lambda: CalendarState.shift(1),
                aria_label="Next period",
                class_name=GHOST_BUTTON,
            ),
            rx.el.p(
                CalendarState.period_label,
                class_name="ml-1 min-w-0 truncate text-sm font-semibold text-stone-100",
            ),
            class_name="flex min-w-0 flex-1 items-center gap-2",
        ),
        rx.el.div(
            rx.foreach(CalendarState.views, _view_button),
            class_name="flex w-full items-center gap-1 rounded-2xl border border-white/10 bg-white/[0.02] p-1.5 lg:w-fit",
        ),
        class_name="flex w-full flex-col gap-3 lg:flex-row lg:items-center lg:justify-between",
    )


def _filters() -> rx.Component:
    return rx.el.div(
        _select(
            CalendarState.release_options,
            CalendarState.release_filter,
            CalendarState.set_release_filter,
        ),
        _select(
            CalendarState.platform_options,
            CalendarState.platform_filter,
            CalendarState.set_platform_filter,
        ),
        _select(
            CalendarState.status_choices,
            CalendarState.status_filter,
            CalendarState.set_status_filter,
        ),
        rx.el.button(
            rx.icon("filter-x", class_name="h-4 w-4"),
            "Clear filters",
            on_click=CalendarState.clear_filters,
            disabled=~CalendarState.filters_active,
            class_name="flex w-full shrink-0 items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-stone-300 transition-colors hover:border-violet-400/50 disabled:opacity-40 sm:w-fit",
        ),
        class_name="flex w-full flex-col gap-2.5 sm:flex-row sm:items-center",
    )


def _no_campaigns() -> rx.Component:
    return rx.el.div(
        rx.icon("calendar-plus", class_name="h-6 w-6 text-violet-300"),
        rx.el.p(
            "Your wall planner is empty.",
            class_name="mt-4 text-lg font-semibold text-stone-50",
        ),
        rx.el.p(
            "Create a campaign and DropPilot fills 21 days of dated tasks straight onto this calendar.",
            class_name="mt-2 max-w-md text-sm font-medium leading-relaxed text-stone-400",
        ),
        rx.el.a(
            rx.icon("plus", class_name="h-4 w-4"),
            "Start a campaign",
            href="/campaigns/new",
            class_name="mt-6 flex w-fit items-center gap-2 rounded-xl bg-violet-400 px-5 py-3 text-sm font-semibold text-stone-950 transition-colors hover:bg-violet-300",
        ),
        waveform("mt-8 opacity-30"),
        class_name="mx-auto flex w-full max-w-2xl flex-col items-start rounded-2xl border border-white/10 bg-white/[0.02] p-8",
    )


def _no_results() -> rx.Component:
    return rx.el.div(
        rx.icon("search-x", class_name="h-5 w-5 text-stone-500"),
        rx.el.p(
            "No tasks match these filters.",
            class_name="mt-3 text-sm font-semibold text-stone-100",
        ),
        rx.el.p(
            "Try another release, platform or status \u2014 or clear the filters and scan the whole rollout.",
            class_name="mt-1 text-sm font-medium text-stone-400",
        ),
        rx.el.button(
            "Clear filters",
            on_click=CalendarState.clear_filters,
            class_name="mt-5 w-fit rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-stone-200 transition-colors hover:border-violet-400/50",
        ),
        class_name="w-full rounded-2xl border border-white/10 bg-white/[0.02] p-8",
    )


def _drawer_block(label: str, value: rx.Var) -> rx.Component:
    return rx.cond(
        value != "",
        rx.el.div(
            rx.el.p(
                label,
                class_name="text-xs font-semibold uppercase tracking-wider text-stone-500",
            ),
            rx.el.p(
                value,
                class_name="mt-1.5 whitespace-pre-line text-sm font-medium leading-relaxed text-stone-200",
            ),
            class_name="w-full rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3",
        ),
        rx.fragment(),
    )


def _drawer() -> rx.Component:
    return rx.el.div(
        rx.el.div(
            on_click=CalendarState.close_drawer,
            class_name="absolute inset-0 bg-stone-950/70",
        ),
        rx.el.div(
            rx.el.div(
                rx.el.div(
                    rx.el.div(
                        _platform_chip(CalendarState.selected),
                        _status_pill(CalendarState.selected),
                        class_name="flex flex-wrap items-center gap-2",
                    ),
                    rx.el.p(
                        CalendarState.selected["title"],
                        class_name="mt-2 text-lg font-semibold text-stone-50",
                    ),
                    rx.el.p(
                        f"Day {CalendarState.selected['day_number']} \u00b7 {CalendarState.selected['scheduled_long']}",
                        class_name="mt-1 text-xs font-medium text-stone-400",
                    ),
                    class_name="min-w-0",
                ),
                rx.el.button(
                    rx.icon("x", class_name="h-4 w-4"),
                    on_click=CalendarState.close_drawer,
                    aria_label="Close task",
                    class_name="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 text-stone-300",
                ),
                class_name="flex shrink-0 items-start justify-between gap-4 border-b border-white/5 px-5 py-4",
            ),
            rx.el.div(
                rx.el.div(
                    rx.el.div(
                        rx.el.p(
                            "Song",
                            class_name="text-xs font-semibold uppercase tracking-wider text-stone-500",
                        ),
                        rx.el.p(
                            CalendarState.selected["song"],
                            class_name="mt-1 text-sm font-semibold text-stone-100",
                        ),
                        class_name="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3",
                    ),
                    rx.el.div(
                        rx.el.p(
                            "Content type",
                            class_name="text-xs font-semibold uppercase tracking-wider text-stone-500",
                        ),
                        rx.el.p(
                            CalendarState.selected["item_type_label"],
                            class_name="mt-1 text-sm font-semibold text-stone-100",
                        ),
                        class_name="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3",
                    ),
                    rx.el.div(
                        rx.el.p(
                            "Campaign",
                            class_name="text-xs font-semibold uppercase tracking-wider text-stone-500",
                        ),
                        rx.el.p(
                            CalendarState.selected["campaign_name"],
                            class_name="mt-1 truncate text-sm font-semibold text-stone-100",
                        ),
                        class_name="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3",
                    ),
                    rx.el.div(
                        rx.el.p(
                            "Prep time",
                            class_name="text-xs font-semibold uppercase tracking-wider text-stone-500",
                        ),
                        rx.el.p(
                            f"{CalendarState.selected['prep_minutes']} minutes",
                            class_name="mt-1 text-sm font-semibold text-stone-100",
                        ),
                        class_name="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3",
                    ),
                    class_name="grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2",
                ),
                _drawer_block(
                    "Opening hook", CalendarState.selected["opening_hook"]
                ),
                _drawer_block(
                    "Content concept", CalendarState.selected["content_concept"]
                ),
                _drawer_block(
                    "Script / shot list", CalendarState.selected["script_notes"]
                ),
                _drawer_block("Caption", CalendarState.selected["caption"]),
                _drawer_block("Hashtags", CalendarState.selected["hashtags"]),
                _drawer_block(
                    "Call to action", CalendarState.selected["call_to_action"]
                ),
                _drawer_block(
                    "Suggested song section",
                    CalendarState.selected["song_section"],
                ),
                _drawer_block(
                    "Suggested lyric", CalendarState.selected["suggested_lyric"]
                ),
                class_name="flex min-h-0 w-full flex-1 flex-col gap-3 overflow-y-auto px-5 py-5",
            ),
            rx.el.div(
                rx.el.button(
                    rx.icon("copy", class_name="h-4 w-4"),
                    "Copy caption",
                    on_click=rx.set_clipboard(
                        f"{CalendarState.selected['caption']}\n\n{CalendarState.selected['hashtags']}"
                    ),
                    class_name="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-stone-200 transition-colors hover:border-violet-400/50 sm:w-fit",
                ),
                rx.el.button(
                    rx.icon("check", class_name="h-4 w-4"),
                    "Mark completed",
                    on_click=lambda: CalendarState.mark_done(
                        CalendarState.selected["id"]
                    ),
                    class_name="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-stone-200 transition-colors hover:border-emerald-400/50 hover:text-emerald-200 sm:w-fit",
                ),
                rx.el.a(
                    rx.icon("pencil", class_name="h-4 w-4"),
                    "Open in campaign editor",
                    href=f"/campaigns/{CalendarState.selected['campaign_id']}",
                    class_name="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-400 px-4 py-2.5 text-sm font-semibold text-stone-950 transition-colors hover:bg-violet-300 sm:w-fit",
                ),
                class_name="flex shrink-0 flex-col gap-2 border-t border-white/5 px-5 py-4 sm:flex-row sm:justify-end",
            ),
            class_name="relative z-10 ml-auto flex h-full w-full max-w-xl flex-col border-l border-white/10 bg-stone-900",
        ),
        class_name="fixed inset-0 z-50 flex",
    )


def _content() -> rx.Component:
    return rx.el.div(
        rx.el.div(
            rx.el.div(
                rx.el.h1(
                    "Content calendar",
                    class_name="text-2xl font-semibold tracking-tight text-stone-50 sm:text-3xl",
                ),
                rx.el.p(
                    f"{CalendarState.total_filtered} tasks across your campaigns \u00b7 {CalendarState.visible_count} in this view",
                    class_name="mt-1 text-sm font-medium text-stone-400",
                ),
                class_name="min-w-0",
            ),
            rx.el.a(
                rx.icon("plus", class_name="h-4 w-4"),
                "New campaign",
                href="/campaigns/new",
                class_name="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-stone-200 transition-colors hover:border-violet-400/50 sm:w-fit",
            ),
            class_name="flex w-full flex-col gap-3 sm:flex-row sm:items-end sm:justify-between",
        ),
        rx.el.div(_controls(), class_name="mt-6 w-full"),
        rx.el.div(_filters(), class_name="mt-3 w-full"),
        rx.cond(
            CalendarState.error != "",
            rx.el.div(alert(CalendarState.error), class_name="mt-4 w-full"),
            rx.fragment(),
        ),
        rx.el.div(
            rx.cond(
                CalendarState.total_filtered > 0,
                rx.match(
                    CalendarState.view,
                    ("month", _month_view()),
                    ("week", _week_view()),
                    ("list", _list_view()),
                    _month_view(),
                ),
                _no_results(),
            ),
            class_name="mt-5 w-full",
        ),
        class_name="mx-auto flex w-full max-w-7xl flex-col",
    )


def calendar_page() -> rx.Component:
    return app_shell(
        rx.cond(
            CalendarState.is_loading,
            rx.el.div(
                rx.el.div(
                    class_name="h-10 w-64 animate-pulse rounded-xl bg-white/[0.05]"
                ),
                rx.el.div(
                    class_name="mt-6 h-14 w-full animate-pulse rounded-2xl bg-white/[0.04]"
                ),
                rx.el.div(
                    class_name="mt-4 h-96 w-full animate-pulse rounded-2xl bg-white/[0.03]"
                ),
                class_name="mx-auto w-full max-w-7xl",
            ),
            rx.cond(CalendarState.has_campaigns, _content(), _no_campaigns()),
        ),
        rx.cond(CalendarState.drawer_open, _drawer(), rx.fragment()),
        active="/calendar",
    )
