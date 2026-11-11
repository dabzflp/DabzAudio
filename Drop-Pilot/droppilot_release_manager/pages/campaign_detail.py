import reflex as rx

from droppilot_release_manager.components.app_shell import app_shell
from droppilot_release_manager.components.brand import alert, waveform
from droppilot_release_manager.states.campaign_detail_state import (
    CampaignDetailState,
    ItemRow,
    PitchRow,
)

CARD = "w-full rounded-2xl border border-white/10 bg-white/[0.02] p-5"
INPUT = (
    "w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 "
    "text-sm font-medium text-stone-50 placeholder:text-stone-500 "
    "outline-hidden transition-colors focus:border-violet-400 "
    "focus:ring-2 focus:ring-violet-400/30"
)
PHASE_FILTERS: list[dict[str, str]] = [
    {"value": "all", "label": "All phases"},
    {"value": "pre_release", "label": "Pre-release"},
    {"value": "release_day", "label": "Release day"},
    {"value": "post_release", "label": "Post-release"},
]


def _artwork() -> rx.Component:
    return rx.cond(
        CampaignDetailState.header["artwork"] != "",
        rx.image(
            src=rx.get_upload_url(CampaignDetailState.header["artwork"]),
            alt="Release artwork",
            class_name="h-24 w-24 shrink-0 rounded-2xl object-cover",
        ),
        rx.el.div(
            rx.icon("disc-3", class_name="h-8 w-8 text-violet-300"),
            class_name="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl border border-violet-400/20 bg-violet-400/10",
        ),
    )


def _header() -> rx.Component:
    return rx.el.div(
        rx.el.div(
            _artwork(),
            rx.el.div(
                rx.el.div(
                    rx.el.span(
                        CampaignDetailState.header["countdown_label"],
                        class_name="w-fit rounded-full bg-orange-400/15 px-3 py-1 text-[11px] font-semibold text-orange-200",
                    ),
                    rx.el.span(
                        CampaignDetailState.header["status"],
                        class_name="w-fit rounded-full border border-white/10 px-3 py-1 text-[11px] font-semibold capitalize text-stone-300",
                    ),
                    rx.cond(
                        CampaignDetailState.header["is_demo"],
                        rx.el.span(
                            "Demo",
                            class_name="w-fit rounded-full border border-white/10 px-3 py-1 text-[11px] font-semibold text-stone-400",
                        ),
                        rx.fragment(),
                    ),
                    class_name="flex flex-wrap items-center gap-2",
                ),
                rx.el.h1(
                    CampaignDetailState.header["song_title"],
                    class_name="mt-3 text-3xl font-semibold tracking-tight text-stone-50",
                ),
                rx.el.p(
                    f"{CampaignDetailState.header['artist_name']} \u00b7 {CampaignDetailState.header['release_date']}",
                    class_name="mt-1 text-sm font-medium text-stone-400",
                ),
                rx.el.p(
                    CampaignDetailState.header["goal"],
                    class_name="mt-2 text-sm font-medium text-violet-200",
                ),
                class_name="min-w-0 flex-1",
            ),
            class_name="flex min-w-0 items-start gap-5",
        ),
        rx.el.div(
            rx.el.div(
                rx.el.p(
                    f"{CampaignDetailState.done_items} of {CampaignDetailState.total_items} items complete",
                    class_name="text-xs font-semibold uppercase tracking-wider text-stone-500",
                ),
                rx.el.p(
                    f"{CampaignDetailState.progress_percent}%",
                    class_name="text-xs font-semibold text-violet-200",
                ),
                class_name="flex items-center justify-between gap-4",
            ),
            rx.el.div(
                rx.el.div(
                    class_name="h-full rounded-full bg-violet-400 transition-all duration-500",
                    style={"width": f"{CampaignDetailState.progress_percent}%"},
                ),
                class_name="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10",
            ),
            class_name="mt-6 w-full",
        ),
        rx.el.div(
            rx.el.a(
                rx.icon("printer", class_name="h-4 w-4"),
                "Printable plan",
                href=f"/campaigns/{CampaignDetailState.header['id']}/print",
                class_name="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-stone-200 transition-colors hover:border-violet-400/50 sm:w-fit",
            ),
            rx.el.button(
                rx.icon("trash-2", class_name="h-4 w-4"),
                "Delete campaign",
                on_click=CampaignDetailState.open_delete,
                class_name="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-stone-300 transition-colors hover:border-rose-400/40 hover:text-rose-200 sm:w-fit",
            ),
            class_name="mt-6 flex flex-col gap-2 sm:flex-row",
        ),
        class_name="w-full rounded-2xl border border-white/10 bg-white/[0.03] p-6",
    )


def _tab_button(tab: dict[str, str]) -> rx.Component:
    return rx.el.button(
        rx.icon(tab["icon"], class_name="h-4 w-4"),
        rx.el.span(tab["label"]),
        on_click=lambda: CampaignDetailState.set_tab(tab["value"]),
        class_name=rx.cond(
            CampaignDetailState.tab == tab["value"],
            "flex w-fit shrink-0 items-center gap-2 rounded-xl bg-violet-400/10 px-4 py-2.5 text-sm font-semibold text-violet-100",
            "flex w-fit shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-stone-400 transition-colors hover:text-stone-100",
        ),
    )


def _tabs() -> rx.Component:
    return rx.el.div(
        rx.foreach(CampaignDetailState.tabs, _tab_button),
        class_name="flex w-full items-center gap-1 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.02] p-1.5",
    )


def _filter_select(options: rx.Var, value: rx.Var, handler) -> rx.Component:
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
        class_name="relative w-full sm:w-48",
    )


def _filters() -> rx.Component:
    return rx.el.div(
        _filter_select(
            PHASE_FILTERS,
            CampaignDetailState.phase_filter,
            CampaignDetailState.set_phase_filter,
        ),
        rx.el.div(
            rx.el.select(
                rx.foreach(
                    CampaignDetailState.platform_options,
                    lambda option: rx.el.option(
                        rx.cond(option == "all", "All platforms", option),
                        value=option,
                    ),
                ),
                value=CampaignDetailState.platform_filter,
                on_change=CampaignDetailState.set_platform_filter,
                class_name=f"appearance-none capitalize {INPUT}",
            ),
            rx.icon(
                "chevron-down",
                class_name="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500",
            ),
            class_name="relative w-full sm:w-48",
        ),
        rx.el.div(
            rx.el.select(
                rx.el.option("All statuses", value="all"),
                rx.foreach(
                    CampaignDetailState.status_choices,
                    lambda option: rx.el.option(
                        option["label"], value=option["value"]
                    ),
                ),
                value=CampaignDetailState.status_filter,
                on_change=CampaignDetailState.set_status_filter,
                class_name=f"appearance-none {INPUT}",
            ),
            rx.icon(
                "chevron-down",
                class_name="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500",
            ),
            class_name="relative w-full sm:w-48",
        ),
        rx.el.button(
            "Clear",
            on_click=CampaignDetailState.clear_filters,
            class_name="w-full shrink-0 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-stone-300 transition-colors hover:border-violet-400/50 sm:w-fit",
        ),
        class_name="flex w-full flex-col gap-2.5 sm:flex-row sm:items-center",
    )


def _status_pill(item: ItemRow) -> rx.Component:
    return rx.el.span(
        item["status_label"],
        class_name=rx.cond(
            item["status"] == "done",
            "w-fit rounded-full bg-green-400/15 px-2.5 py-1 text-[11px] font-semibold text-green-200",
            rx.cond(
                item["status"] == "in_progress",
                "w-fit rounded-full bg-violet-400/15 px-2.5 py-1 text-[11px] font-semibold text-violet-200",
                rx.cond(
                    item["status"] == "skipped",
                    "w-fit rounded-full bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-stone-400",
                    "w-fit rounded-full bg-orange-400/15 px-2.5 py-1 text-[11px] font-semibold text-orange-200",
                ),
            ),
        ),
    )


def _item_card(item: ItemRow) -> rx.Component:
    return rx.el.div(
        rx.el.div(
            rx.el.span(
                f"Day {item['day_number']}",
                class_name="text-xs font-bold uppercase tracking-wider text-stone-500",
            ),
            _status_pill(item),
            class_name="flex items-center justify-between gap-3",
        ),
        rx.el.p(
            item["title"],
            class_name="mt-3 text-sm font-semibold text-stone-50",
        ),
        rx.el.p(
            item["opening_hook"],
            class_name="mt-1.5 line-clamp-2 text-xs font-medium leading-relaxed text-stone-400",
        ),
        rx.el.div(
            rx.el.span(
                item["platform"],
                class_name="w-fit rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-semibold capitalize text-stone-300",
            ),
            rx.el.span(
                item["phase_label"],
                class_name="w-fit rounded-full bg-violet-400/10 px-2.5 py-1 text-[11px] font-semibold text-violet-200",
            ),
            rx.el.span(
                item["scheduled"],
                class_name="text-[11px] font-medium text-stone-500",
            ),
            class_name="mt-4 flex flex-wrap items-center gap-2",
        ),
        rx.el.div(
            rx.el.button(
                rx.icon("pencil", class_name="h-3.5 w-3.5"),
                "Open",
                on_click=lambda: CampaignDetailState.open_item(item["id"]),
                class_name="flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-stone-200 transition-colors hover:border-violet-400/50",
            ),
            rx.el.button(
                rx.icon("copy", class_name="h-3.5 w-3.5"),
                "Copy caption",
                on_click=rx.set_clipboard(
                    f"{item['caption']}\n\n{item['hashtags']}"
                ),
                class_name="flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-stone-200 transition-colors hover:border-violet-400/50",
            ),
            rx.el.button(
                rx.icon("check", class_name="h-3.5 w-3.5"),
                on_click=lambda: CampaignDetailState.set_item_status(
                    item["id"], "done"
                ),
                aria_label="Mark completed",
                class_name="flex w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 py-2 text-stone-300 transition-colors hover:border-green-400/50 hover:text-green-200",
            ),
            class_name="mt-4 flex items-center gap-2",
        ),
        class_name="flex w-full flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-4 transition-colors hover:border-violet-400/30",
    )


def _items_grid() -> rx.Component:
    return rx.cond(
        CampaignDetailState.filtered_items.length() > 0,
        rx.el.div(
            rx.foreach(CampaignDetailState.filtered_items, _item_card),
            class_name="grid w-full grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3",
        ),
        rx.el.p(
            "No items match these filters.",
            class_name="w-full rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-8 text-sm font-medium text-stone-500",
        ),
    )


def _calendar_row(item: ItemRow) -> rx.Component:
    return rx.el.button(
        rx.el.span(
            f"Day {item['day_number']}",
            class_name="w-16 shrink-0 text-left text-xs font-bold uppercase tracking-wider text-stone-500",
        ),
        rx.el.span(
            item["scheduled"],
            class_name="w-24 shrink-0 text-left text-xs font-medium text-stone-400",
        ),
        rx.el.span(
            item["title"],
            class_name="min-w-0 flex-1 truncate text-left text-sm font-semibold text-stone-100",
        ),
        rx.el.span(
            item["platform"],
            class_name="hidden w-fit shrink-0 rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-semibold capitalize text-stone-300 sm:block",
        ),
        _status_pill(item),
        on_click=lambda: CampaignDetailState.open_item(item["id"]),
        class_name="flex w-full items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5 transition-colors hover:border-violet-400/30",
    )


def _calendar() -> rx.Component:
    return rx.el.div(
        rx.foreach(CampaignDetailState.filtered_items, _calendar_row),
        class_name="flex w-full flex-col gap-2",
    )


def _pitch_card(pitch: PitchRow) -> rx.Component:
    return rx.el.div(
        rx.el.div(
            rx.el.span(
                pitch["target_type"],
                class_name="w-fit rounded-full bg-violet-400/10 px-2.5 py-1 text-[11px] font-semibold capitalize text-violet-200",
            ),
            rx.el.span(
                pitch["status"],
                class_name="w-fit rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-semibold capitalize text-stone-400",
            ),
            class_name="flex items-center gap-2",
        ),
        rx.el.p(
            pitch["target_name"],
            class_name="mt-3 text-sm font-semibold text-stone-50",
        ),
        rx.el.p(
            pitch["subject"],
            class_name="mt-1 text-xs font-medium text-stone-400",
        ),
        rx.el.p(
            pitch["body"],
            class_name="mt-3 whitespace-pre-line text-xs font-medium leading-relaxed text-stone-400",
        ),
        rx.el.div(
            rx.el.button(
                rx.icon("copy", class_name="h-3.5 w-3.5"),
                "Copy pitch",
                on_click=rx.set_clipboard(
                    f"{pitch['subject']}\n\n{pitch['body']}"
                ),
                class_name="flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-stone-200 transition-colors hover:border-violet-400/50 sm:w-fit",
            ),
            rx.el.a(
                rx.icon("pencil", class_name="h-3.5 w-3.5"),
                "Edit in workspace",
                href=f"/campaigns/{CampaignDetailState.header['id']}/pitches",
                class_name="flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-stone-200 transition-colors hover:border-violet-400/50 sm:w-fit",
            ),
            class_name="mt-4 flex flex-col gap-2 sm:flex-row",
        ),
        class_name="flex w-full flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-5",
    )


def _detail_line(label: str, value: rx.Var) -> rx.Component:
    return rx.el.div(
        rx.el.p(
            label,
            class_name="text-xs font-semibold uppercase tracking-wider text-stone-500",
        ),
        rx.el.p(
            rx.cond(value != "", value, "Not set"),
            class_name="mt-1 text-sm font-medium capitalize text-stone-100",
        ),
        class_name="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3",
    )


def _overview() -> rx.Component:
    return rx.el.div(
        rx.el.div(
            _detail_line("Genre", CampaignDetailState.header["genre"]),
            _detail_line("Mood", CampaignDetailState.header["mood"]),
            _detail_line(
                "Objectives", CampaignDetailState.header["objectives"]
            ),
            _detail_line("Audience", CampaignDetailState.header["audience"]),
            _detail_line("Locations", CampaignDetailState.header["locations"]),
            _detail_line(
                "Personality", CampaignDetailState.header["personality"]
            ),
            _detail_line("Resources", CampaignDetailState.header["resources"]),
            _detail_line(
                "Total prep time",
                f"{CampaignDetailState.prep_hours} hours",
            ),
            class_name="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4",
        ),
        rx.cond(
            CampaignDetailState.header["instructions"] != "",
            rx.el.div(
                rx.el.p(
                    "Your instructions",
                    class_name="text-xs font-semibold uppercase tracking-wider text-stone-500",
                ),
                rx.el.p(
                    CampaignDetailState.header["instructions"],
                    class_name="mt-2 text-sm font-medium leading-relaxed text-stone-300",
                ),
                class_name=f"{CARD} mt-4",
            ),
            rx.fragment(),
        ),
        rx.el.div(
            rx.el.p(
                "How this plan was made",
                class_name="text-xs font-semibold uppercase tracking-wider text-stone-500",
            ),
            rx.el.p(
                CampaignDetailState.header["methodology"],
                class_name="mt-2 text-sm font-medium leading-relaxed text-stone-400",
            ),
            waveform("mt-5 opacity-40"),
            class_name=f"{CARD} mt-4",
        ),
        class_name="w-full",
    )


def _assets() -> rx.Component:
    return rx.el.div(
        rx.el.div(
            _artwork(),
            rx.el.div(
                rx.el.p(
                    "Uploaded files",
                    class_name="text-xs font-semibold uppercase tracking-wider text-stone-500",
                ),
                rx.el.p(
                    rx.cond(
                        CampaignDetailState.header["audio_name"] != "",
                        CampaignDetailState.header["audio_name"],
                        "No audio uploaded",
                    ),
                    class_name="mt-2 text-sm font-semibold text-stone-100",
                ),
                rx.el.p(
                    rx.cond(
                        CampaignDetailState.header["artwork_name"] != "",
                        CampaignDetailState.header["artwork_name"],
                        "No artwork uploaded",
                    ),
                    class_name="mt-1 text-sm font-medium text-stone-400",
                ),
                class_name="min-w-0",
            ),
            class_name="flex items-start gap-5",
        ),
        rx.cond(
            CampaignDetailState.header["lyrics"] != "",
            rx.el.div(
                rx.el.p(
                    "Lyrics",
                    class_name="text-xs font-semibold uppercase tracking-wider text-stone-500",
                ),
                rx.el.p(
                    CampaignDetailState.header["lyrics"],
                    class_name="mt-2 whitespace-pre-line text-sm font-medium leading-relaxed text-stone-300",
                ),
                class_name="mt-6 w-full",
            ),
            rx.el.p(
                "No lyrics saved for this release.",
                class_name="mt-6 text-sm font-medium text-stone-500",
            ),
        ),
        class_name=CARD,
    )


def _edit_field(
    label: str, field: str, value: rx.Var, rows: str = "3"
) -> rx.Component:
    return rx.el.div(
        rx.el.p(label, class_name="text-xs font-semibold text-stone-300"),
        rx.el.textarea(
            default_value=value,
            rows=rows,
            on_change=lambda v: CampaignDetailState.set_edit_field(
                field, v
            ).debounce(400),
            class_name=f"mt-2 {INPUT}",
        ),
        class_name="w-full",
    )


def _status_button(option: dict[str, str]) -> rx.Component:
    return rx.el.button(
        option["label"],
        on_click=lambda: CampaignDetailState.set_item_status(
            CampaignDetailState.selected["id"], option["value"]
        ),
        class_name=rx.cond(
            CampaignDetailState.selected["status"] == option["value"],
            "w-fit rounded-xl bg-violet-400 px-3 py-2 text-xs font-semibold text-stone-950",
            "w-fit rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-stone-300 transition-colors hover:border-violet-400/50",
        ),
    )


def _item_panel() -> rx.Component:
    return rx.el.div(
        rx.el.div(
            on_click=CampaignDetailState.close_panel,
            class_name="absolute inset-0 bg-stone-950/70",
        ),
        rx.el.div(
            rx.el.div(
                rx.el.div(
                    rx.el.p(
                        f"Day {CampaignDetailState.selected['day_number']} \u00b7 {CampaignDetailState.selected['platform']}",
                        class_name="text-xs font-semibold uppercase tracking-wider capitalize text-violet-300",
                    ),
                    rx.el.p(
                        CampaignDetailState.selected["title"],
                        class_name="mt-1 text-lg font-semibold text-stone-50",
                    ),
                    class_name="min-w-0",
                ),
                rx.el.button(
                    rx.icon("x", class_name="h-4 w-4"),
                    on_click=CampaignDetailState.close_panel,
                    aria_label="Close item",
                    class_name="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 text-stone-300",
                ),
                class_name="flex shrink-0 items-start justify-between gap-4 border-b border-white/5 px-5 py-4",
            ),
            rx.el.div(
                rx.cond(
                    CampaignDetailState.error != "",
                    alert(CampaignDetailState.error),
                    rx.fragment(),
                ),
                rx.cond(
                    CampaignDetailState.notice != "",
                    alert(CampaignDetailState.notice, "success"),
                    rx.fragment(),
                ),
                rx.el.div(
                    rx.el.p(
                        "Status",
                        class_name="text-xs font-semibold text-stone-300",
                    ),
                    rx.el.div(
                        rx.foreach(
                            CampaignDetailState.status_choices, _status_button
                        ),
                        class_name="mt-2 flex flex-wrap gap-2",
                    ),
                    class_name="w-full",
                ),
                rx.el.div(
                    rx.el.p(
                        "Title",
                        class_name="text-xs font-semibold text-stone-300",
                    ),
                    rx.el.input(
                        default_value=CampaignDetailState.edit_title,
                        on_change=lambda v: CampaignDetailState.set_edit_field(
                            "edit_title", v
                        ).debounce(400),
                        class_name=f"mt-2 {INPUT}",
                    ),
                    class_name="w-full",
                ),
                _edit_field(
                    "Opening hook", "edit_hook", CampaignDetailState.edit_hook
                ),
                _edit_field(
                    "Content concept",
                    "edit_concept",
                    CampaignDetailState.edit_concept,
                    "4",
                ),
                _edit_field(
                    "Script / shot list",
                    "edit_script",
                    CampaignDetailState.edit_script,
                    "4",
                ),
                _edit_field(
                    "Caption",
                    "edit_caption",
                    CampaignDetailState.edit_caption,
                    "4",
                ),
                _edit_field(
                    "Hashtags",
                    "edit_hashtags",
                    CampaignDetailState.edit_hashtags,
                    "2",
                ),
                _edit_field(
                    "Call to action",
                    "edit_cta",
                    CampaignDetailState.edit_cta,
                    "2",
                ),
                rx.el.div(
                    rx.el.p(
                        "Suggested song section and lyric",
                        class_name="text-xs font-semibold text-stone-300",
                    ),
                    rx.el.p(
                        f"{CampaignDetailState.selected['song_section']} \u2014 {CampaignDetailState.selected['suggested_lyric']}",
                        class_name="mt-2 text-sm font-medium leading-relaxed text-stone-400",
                    ),
                    class_name="w-full",
                ),
                rx.el.div(
                    rx.el.p(
                        "Reschedule",
                        class_name="text-xs font-semibold text-stone-300",
                    ),
                    rx.el.input(
                        type="date",
                        default_value=CampaignDetailState.edit_date,
                        on_change=lambda v: CampaignDetailState.set_edit_field(
                            "edit_date", v
                        ),
                        class_name=f"mt-2 {INPUT}",
                    ),
                    class_name="w-full",
                ),
                class_name="flex min-h-0 w-full flex-1 flex-col gap-4 overflow-y-auto px-5 py-5",
            ),
            rx.el.div(
                rx.el.button(
                    rx.icon("copy", class_name="h-4 w-4"),
                    "Copy caption",
                    on_click=rx.set_clipboard(
                        f"{CampaignDetailState.edit_caption}\n\n{CampaignDetailState.edit_hashtags}"
                    ),
                    class_name="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-stone-200 transition-colors hover:border-violet-400/50 sm:w-fit",
                ),
                rx.el.button(
                    rx.cond(
                        CampaignDetailState.is_saving,
                        rx.icon(
                            "loader-circle", class_name="h-4 w-4 animate-spin"
                        ),
                        rx.icon("save", class_name="h-4 w-4"),
                    ),
                    "Save item",
                    on_click=CampaignDetailState.save_item,
                    disabled=CampaignDetailState.is_saving,
                    class_name="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-400 px-4 py-2.5 text-sm font-semibold text-stone-950 transition-colors hover:bg-violet-300 disabled:opacity-60 sm:w-fit",
                ),
                class_name="flex shrink-0 flex-col gap-2 border-t border-white/5 px-5 py-4 sm:flex-row sm:justify-end",
            ),
            class_name="relative z-10 ml-auto flex h-full w-full max-w-xl flex-col border-l border-white/10 bg-stone-900",
        ),
        class_name="fixed inset-0 z-50 flex",
    )


def _delete_dialog() -> rx.Component:
    return rx.el.div(
        rx.el.div(
            on_click=CampaignDetailState.close_delete,
            class_name="absolute inset-0 bg-stone-950/80",
        ),
        rx.el.div(
            rx.el.h2(
                "Delete this campaign?",
                class_name="text-lg font-semibold text-stone-50",
            ),
            rx.el.p(
                "This removes the campaign, its 21 content items and its pitch drafts. The release and your uploaded files stay in your account. This cannot be undone.",
                class_name="mt-3 text-sm font-medium leading-relaxed text-stone-400",
            ),
            rx.el.div(
                rx.el.button(
                    "Cancel",
                    on_click=CampaignDetailState.close_delete,
                    class_name="w-full rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-stone-300 transition-colors hover:border-violet-400/50 sm:w-fit",
                ),
                rx.el.button(
                    "Delete campaign",
                    on_click=CampaignDetailState.delete_campaign,
                    class_name="w-full rounded-xl bg-rose-400 px-4 py-2.5 text-sm font-semibold text-stone-950 transition-colors hover:bg-rose-300 sm:w-fit",
                ),
                class_name="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end",
            ),
            class_name="relative z-10 m-auto w-full max-w-md rounded-2xl border border-white/10 bg-stone-900 p-6",
        ),
        class_name="fixed inset-0 z-50 flex p-4",
    )


def _not_found() -> rx.Component:
    return rx.el.div(
        rx.icon("search-x", class_name="h-6 w-6 text-stone-500"),
        rx.el.p(
            "Campaign not found.",
            class_name="mt-4 text-lg font-semibold text-stone-50",
        ),
        rx.el.p(
            "It may have been deleted, or it belongs to another account.",
            class_name="mt-2 text-sm font-medium text-stone-400",
        ),
        rx.el.a(
            "Back to overview",
            href="/dashboard",
            class_name="mt-6 flex w-fit items-center rounded-xl bg-violet-400 px-5 py-3 text-sm font-semibold text-stone-950 transition-colors hover:bg-violet-300",
        ),
        class_name="mx-auto w-full max-w-xl rounded-2xl border border-white/10 bg-white/[0.02] p-8",
    )


def _content() -> rx.Component:
    return rx.el.div(
        _header(),
        rx.cond(
            CampaignDetailState.error != "",
            rx.el.div(
                alert(CampaignDetailState.error), class_name="mt-4 w-full"
            ),
            rx.fragment(),
        ),
        rx.el.div(_tabs(), class_name="mt-6 w-full"),
        rx.el.div(
            rx.match(
                CampaignDetailState.tab,
                ("overview", _overview()),
                (
                    "calendar",
                    rx.el.div(
                        _filters(),
                        rx.el.div(_calendar(), class_name="mt-4 w-full"),
                        class_name="w-full",
                    ),
                ),
                (
                    "ideas",
                    rx.el.div(
                        _filters(),
                        rx.el.div(_items_grid(), class_name="mt-4 w-full"),
                        class_name="w-full",
                    ),
                ),
                (
                    "pitches",
                    rx.cond(
                        CampaignDetailState.pitches.length() > 0,
                        rx.el.div(
                            rx.el.div(
                                rx.el.div(
                                    rx.el.p(
                                        "Six factual drafts",
                                        class_name="text-sm font-semibold text-stone-100",
                                    ),
                                    rx.el.p(
                                        "Edit subjects and bodies, watch the character count and copy them out in the pitch workspace.",
                                        class_name="mt-1 text-xs font-medium leading-relaxed text-stone-400",
                                    ),
                                    class_name="min-w-0",
                                ),
                                rx.el.a(
                                    rx.icon("square-pen", class_name="h-4 w-4"),
                                    "Open pitch workspace",
                                    href=f"/campaigns/{CampaignDetailState.header['id']}/pitches",
                                    class_name="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-400 px-4 py-2.5 text-sm font-semibold text-stone-950 transition-colors hover:bg-violet-300 sm:w-fit",
                                ),
                                class_name="flex w-full flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:flex-row sm:items-center sm:justify-between",
                            ),
                            rx.el.div(
                                rx.foreach(
                                    CampaignDetailState.pitches, _pitch_card
                                ),
                                class_name="mt-4 grid w-full grid-cols-1 gap-4 xl:grid-cols-2",
                            ),
                            class_name="w-full",
                        ),
                        rx.el.p(
                            "No pitch drafts for this campaign yet.",
                            class_name="w-full rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-8 text-sm font-medium text-stone-500",
                        ),
                    ),
                ),
                ("assets", _assets()),
                _overview(),
            ),
            class_name="mt-5 w-full",
        ),
        class_name="mx-auto flex w-full max-w-6xl flex-col",
    )


def campaign_detail_page() -> rx.Component:
    return app_shell(
        rx.cond(
            CampaignDetailState.is_loading,
            rx.el.div(
                class_name="h-64 w-full animate-pulse rounded-2xl bg-white/[0.04]"
            ),
            rx.cond(CampaignDetailState.not_found, _not_found(), _content()),
        ),
        rx.cond(CampaignDetailState.panel_open, _item_panel(), rx.fragment()),
        rx.cond(
            CampaignDetailState.delete_open, _delete_dialog(), rx.fragment()
        ),
        active="/releases",
    )
