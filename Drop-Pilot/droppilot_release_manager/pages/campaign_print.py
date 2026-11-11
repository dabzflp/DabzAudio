import reflex as rx

from droppilot_release_manager.states.campaign_detail_state import (
    CampaignDetailState,
    ItemRow,
    PitchRow,
)


def _row(item: ItemRow) -> rx.Component:
    return rx.el.tr(
        rx.el.td(
            f"Day {item['day_number']}",
            class_name="border-b border-stone-200 px-3 py-3 align-top text-xs font-semibold uppercase tracking-wider text-stone-500",
        ),
        rx.el.td(
            item["scheduled"],
            class_name="border-b border-stone-200 px-3 py-3 align-top text-sm font-medium text-stone-700",
        ),
        rx.el.td(
            rx.el.p(
                item["title"],
                class_name="text-sm font-semibold text-stone-900",
            ),
            rx.el.p(
                item["opening_hook"],
                class_name="mt-1 text-xs font-medium leading-relaxed text-stone-600",
            ),
            rx.el.p(
                item["content_concept"],
                class_name="mt-1 text-xs font-medium leading-relaxed text-stone-600",
            ),
            class_name="border-b border-stone-200 px-3 py-3 align-top",
        ),
        rx.el.td(
            rx.el.p(
                item["platform"],
                class_name="text-xs font-semibold capitalize text-stone-700",
            ),
            rx.el.p(
                item["phase_label"],
                class_name="mt-1 text-xs font-medium text-stone-500",
            ),
            class_name="border-b border-stone-200 px-3 py-3 align-top",
        ),
        rx.el.td(
            item["status_label"],
            class_name="border-b border-stone-200 px-3 py-3 align-top text-xs font-medium text-stone-600",
        ),
    )


def _pitch(pitch: PitchRow) -> rx.Component:
    return rx.el.div(
        rx.el.p(
            f"{pitch['target_name']} \u00b7 {pitch['target_type']}",
            class_name="text-sm font-semibold capitalize text-stone-900",
        ),
        rx.el.p(
            pitch["subject"],
            class_name="mt-1 text-xs font-semibold text-stone-600",
        ),
        rx.el.p(
            pitch["body"],
            class_name="mt-2 whitespace-pre-line text-xs font-medium leading-relaxed text-stone-700",
        ),
        class_name="break-inside-avoid border-b border-stone-200 py-4",
    )


def campaign_print_page() -> rx.Component:
    return rx.el.main(
        rx.el.div(
            rx.el.div(
                rx.el.p(
                    "DropPilot campaign plan",
                    class_name="text-xs font-semibold uppercase tracking-[0.2em] text-violet-700",
                ),
                rx.el.h1(
                    CampaignDetailState.header["song_title"],
                    class_name="mt-2 text-3xl font-semibold tracking-tight text-stone-900",
                ),
                rx.el.p(
                    f"{CampaignDetailState.header['artist_name']} \u00b7 {CampaignDetailState.header['release_date']} \u00b7 {CampaignDetailState.header['genre']}",
                    class_name="mt-1 text-sm font-medium text-stone-600",
                ),
                rx.el.p(
                    CampaignDetailState.header["goal"],
                    class_name="mt-1 text-sm font-medium text-stone-700",
                ),
                class_name="min-w-0",
            ),
            rx.el.div(
                rx.el.button(
                    rx.icon("printer", class_name="h-4 w-4"),
                    "Print this plan",
                    on_click=rx.call_script("window.print()"),
                    class_name="dp-no-print flex w-fit items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-500",
                ),
                rx.el.a(
                    "Back to campaign",
                    href=f"/campaigns/{CampaignDetailState.header['id']}",
                    class_name="dp-no-print flex w-fit items-center rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-semibold text-stone-700 transition-colors hover:border-violet-500",
                ),
                class_name="flex shrink-0 flex-col gap-2 sm:flex-row",
            ),
            class_name="flex w-full flex-col items-start justify-between gap-5 border-b border-stone-200 pb-6 sm:flex-row sm:items-end",
        ),
        rx.cond(
            CampaignDetailState.not_found,
            rx.el.p(
                "This campaign is not available on your account.",
                class_name="mt-8 text-sm font-medium text-stone-700",
            ),
            rx.el.div(
                rx.el.h2(
                    "21-day content schedule",
                    class_name="mt-8 text-lg font-semibold text-stone-900",
                ),
                rx.el.table(
                    rx.el.thead(
                        rx.el.tr(
                            rx.el.th(
                                "Day",
                                class_name="border-b border-stone-300 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider text-stone-500",
                            ),
                            rx.el.th(
                                "Date",
                                class_name="border-b border-stone-300 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider text-stone-500",
                            ),
                            rx.el.th(
                                "Idea",
                                class_name="border-b border-stone-300 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider text-stone-500",
                            ),
                            rx.el.th(
                                "Platform",
                                class_name="border-b border-stone-300 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider text-stone-500",
                            ),
                            rx.el.th(
                                "Status",
                                class_name="border-b border-stone-300 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider text-stone-500",
                            ),
                        )
                    ),
                    rx.el.tbody(rx.foreach(CampaignDetailState.items, _row)),
                    class_name="mt-4 w-full table-auto",
                ),
                rx.el.h2(
                    "Pitch drafts",
                    class_name="mt-10 text-lg font-semibold text-stone-900",
                ),
                rx.el.div(
                    rx.foreach(CampaignDetailState.pitches, _pitch),
                    class_name="mt-2 w-full",
                ),
                rx.el.p(
                    CampaignDetailState.header["methodology"],
                    class_name="mt-8 text-xs font-medium leading-relaxed text-stone-500",
                ),
                class_name="w-full",
            ),
        ),
        class_name="dp-print font-['Inter'] mx-auto min-h-dvh w-full max-w-5xl bg-white px-6 py-10 sm:px-10",
    )
