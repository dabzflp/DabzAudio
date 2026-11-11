import reflex as rx

from droppilot_release_manager.components.app_shell import app_shell
from droppilot_release_manager.components.brand import alert
from droppilot_release_manager.states.pitch_state import PitchCard, PitchState

INPUT = (
    "w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 "
    "text-sm font-medium text-stone-50 placeholder:text-stone-500 "
    "outline-hidden transition-colors focus:border-violet-400 "
    "focus:ring-2 focus:ring-violet-400/30"
)


def _category_button(card: PitchCard) -> rx.Component:
    return rx.el.button(
        rx.icon(card["icon"], class_name="h-4 w-4 shrink-0"),
        rx.el.div(
            rx.el.p(
                card["label"],
                class_name="truncate text-left text-sm font-semibold",
            ),
            rx.el.p(
                card["status"],
                class_name="mt-0.5 text-left text-[11px] font-medium capitalize text-stone-500",
            ),
            class_name="min-w-0 flex-1",
        ),
        on_click=lambda: PitchState.select_card(card["id"]),
        class_name=rx.cond(
            PitchState.active_id == card["id"],
            "flex w-full shrink-0 items-center gap-3 rounded-xl border border-violet-400/30 bg-violet-400/10 px-3 py-2.5 text-violet-100 sm:w-auto lg:w-full",
            "flex w-full shrink-0 items-center gap-3 rounded-xl border border-white/10 px-3 py-2.5 text-stone-300 transition-colors hover:border-violet-400/40 hover:text-stone-50 sm:w-auto lg:w-full",
        ),
    )


def _sidebar() -> rx.Component:
    return rx.el.div(
        rx.el.p(
            "Draft categories",
            class_name="text-xs font-semibold uppercase tracking-wider text-stone-500",
        ),
        rx.el.div(
            rx.foreach(PitchState.cards, _category_button),
            class_name="mt-3 flex w-full gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0",
        ),
        class_name="w-full shrink-0 rounded-2xl border border-white/10 bg-white/[0.02] p-4 lg:w-72",
    )


def _guidance() -> rx.Component:
    return rx.el.div(
        rx.icon("info", class_name="h-4 w-4 shrink-0 text-violet-300"),
        rx.el.p(
            PitchState.active["guidance"],
            class_name="text-sm font-medium leading-relaxed text-stone-300",
        ),
        class_name="flex w-full items-start gap-2.5 rounded-xl border border-violet-400/20 bg-violet-400/[0.06] px-4 py-3",
    )


def _factuality() -> rx.Component:
    return rx.el.div(
        rx.icon("shield-check", class_name="h-4 w-4 shrink-0 text-orange-300"),
        rx.el.p(
            PitchState.factuality_note,
            class_name="text-sm font-medium leading-relaxed text-stone-300",
        ),
        class_name="flex w-full items-start gap-2.5 rounded-xl border border-orange-400/20 bg-orange-400/[0.06] px-4 py-3",
    )


def _editor() -> rx.Component:
    return rx.el.div(
        rx.el.div(
            rx.el.div(
                rx.el.p(
                    PitchState.active["label"],
                    class_name="text-lg font-semibold text-stone-50",
                ),
                rx.el.p(
                    PitchState.active["target_name"],
                    class_name="mt-0.5 text-xs font-medium text-stone-400",
                ),
                class_name="min-w-0",
            ),
            rx.el.span(
                PitchState.active["status"],
                class_name="w-fit rounded-full border border-white/10 px-3 py-1 text-[11px] font-semibold capitalize text-stone-300",
            ),
            class_name="flex flex-wrap items-start justify-between gap-3",
        ),
        rx.el.div(_guidance(), class_name="mt-4 w-full"),
        rx.el.div(_factuality(), class_name="mt-2.5 w-full"),
        rx.cond(
            PitchState.error != "",
            rx.el.div(alert(PitchState.error), class_name="mt-3 w-full"),
            rx.fragment(),
        ),
        rx.cond(
            PitchState.notice != "",
            rx.el.div(
                alert(PitchState.notice, "success"), class_name="mt-3 w-full"
            ),
            rx.fragment(),
        ),
        rx.cond(
            PitchState.active["has_subject"],
            rx.el.div(
                rx.el.div(
                    rx.el.p(
                        "Subject line",
                        class_name="text-xs font-semibold text-stone-300",
                    ),
                    rx.el.span(
                        f"{PitchState.subject_count}/240",
                        class_name="text-[11px] font-medium text-stone-500",
                    ),
                    class_name="flex items-center justify-between gap-3",
                ),
                rx.el.input(
                    default_value=PitchState.edit_subject,
                    max_length=240,
                    placeholder="Subject line",
                    on_change=PitchState.set_subject.debounce(300),
                    class_name=f"mt-2 {INPUT}",
                ),
                class_name="mt-5 w-full",
            ),
            rx.fragment(),
        ),
        rx.el.div(
            rx.el.div(
                rx.el.p(
                    "Draft body",
                    class_name="text-xs font-semibold text-stone-300",
                ),
                rx.el.span(
                    f"{PitchState.body_count} / {PitchState.active['limit']} characters",
                    class_name=rx.cond(
                        PitchState.over_limit,
                        "text-[11px] font-semibold text-rose-300",
                        "text-[11px] font-medium text-stone-500",
                    ),
                ),
                class_name="flex items-center justify-between gap-3",
            ),
            rx.el.textarea(
                default_value=PitchState.edit_body,
                rows="16",
                on_change=PitchState.set_body.debounce(300),
                class_name=f"mt-2 leading-relaxed {INPUT}",
            ),
            rx.cond(
                PitchState.over_limit,
                rx.el.p(
                    "This is longer than the recommended limit for this channel. Trim it before sending.",
                    class_name="mt-2 text-xs font-medium text-rose-300",
                ),
                rx.fragment(),
            ),
            class_name="mt-5 w-full",
        ),
        rx.el.div(
            rx.el.p(
                rx.cond(
                    PitchState.is_dirty,
                    "Unsaved changes",
                    "All changes saved",
                ),
                class_name=rx.cond(
                    PitchState.is_dirty,
                    "text-xs font-semibold text-orange-200",
                    "text-xs font-medium text-stone-500",
                ),
            ),
            rx.el.div(
                rx.el.button(
                    rx.icon("rotate-ccw", class_name="h-4 w-4"),
                    "Revert",
                    on_click=PitchState.revert,
                    class_name="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-stone-300 transition-colors hover:border-violet-400/50 sm:w-fit",
                ),
                rx.el.button(
                    rx.icon("copy", class_name="h-4 w-4"),
                    "Copy body",
                    on_click=rx.set_clipboard(PitchState.edit_body),
                    class_name="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-stone-200 transition-colors hover:border-violet-400/50 sm:w-fit",
                ),
                rx.el.button(
                    rx.icon("clipboard-copy", class_name="h-4 w-4"),
                    "Copy with subject",
                    on_click=rx.set_clipboard(
                        f"{PitchState.edit_subject}\n\n{PitchState.edit_body}"
                    ),
                    class_name="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-stone-200 transition-colors hover:border-violet-400/50 sm:w-fit",
                ),
                rx.el.button(
                    rx.cond(
                        PitchState.is_saving,
                        rx.icon(
                            "loader-circle", class_name="h-4 w-4 animate-spin"
                        ),
                        rx.icon("save", class_name="h-4 w-4"),
                    ),
                    "Save draft",
                    on_click=PitchState.save,
                    disabled=PitchState.is_saving,
                    class_name="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-400 px-4 py-2.5 text-sm font-semibold text-stone-950 transition-colors hover:bg-violet-300 disabled:opacity-60 sm:w-fit",
                ),
                class_name="flex w-full flex-col gap-2 sm:w-fit sm:flex-row",
            ),
            class_name="mt-5 flex w-full flex-col gap-3 border-t border-white/5 pt-5 sm:flex-row sm:items-center sm:justify-between",
        ),
        class_name="w-full min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/[0.02] p-5 sm:p-6",
    )


def _empty() -> rx.Component:
    return rx.el.div(
        rx.icon("send", class_name="h-6 w-6 text-violet-300"),
        rx.el.p(
            "No pitch drafts for this campaign yet.",
            class_name="mt-4 text-lg font-semibold text-stone-50",
        ),
        rx.el.p(
            "Pitch drafts are written when a campaign is generated. Generate this campaign's plan and six factual drafts will appear here.",
            class_name="mt-2 max-w-md text-sm font-medium leading-relaxed text-stone-400",
        ),
        rx.el.a(
            "Back to the campaign",
            href=PitchState.campaign_url,
            class_name="mt-6 flex w-fit items-center rounded-xl bg-violet-400 px-5 py-3 text-sm font-semibold text-stone-950 transition-colors hover:bg-violet-300",
        ),
        class_name="mx-auto flex w-full max-w-xl flex-col items-start rounded-2xl border border-white/10 bg-white/[0.02] p-8",
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
        rx.el.div(
            rx.el.div(
                rx.el.a(
                    rx.icon("chevron-left", class_name="h-3.5 w-3.5"),
                    "Back to campaign",
                    href=PitchState.campaign_url,
                    class_name="flex w-fit items-center gap-1.5 text-xs font-semibold text-violet-300 transition-colors hover:text-violet-200",
                ),
                rx.el.h1(
                    "Pitch workspace",
                    class_name="mt-2 text-2xl font-semibold tracking-tight text-stone-50 sm:text-3xl",
                ),
                rx.el.p(
                    f"{PitchState.song_title} \u00b7 {PitchState.campaign_name}",
                    class_name="mt-1 text-sm font-medium text-stone-400",
                ),
                class_name="min-w-0",
            ),
            class_name="w-full",
        ),
        rx.cond(
            PitchState.cards.length() > 0,
            rx.el.div(
                _sidebar(),
                _editor(),
                class_name="mt-6 flex w-full flex-col gap-4 lg:flex-row lg:items-start",
            ),
            rx.el.div(_empty(), class_name="mt-6 w-full"),
        ),
        class_name="mx-auto flex w-full max-w-6xl flex-col",
    )


def campaign_pitches_page() -> rx.Component:
    return app_shell(
        rx.cond(
            PitchState.is_loading,
            rx.el.div(
                rx.el.div(
                    class_name="h-10 w-64 animate-pulse rounded-xl bg-white/[0.05]"
                ),
                rx.el.div(
                    class_name="mt-6 h-96 w-full animate-pulse rounded-2xl bg-white/[0.03]"
                ),
                class_name="mx-auto w-full max-w-6xl",
            ),
            rx.cond(PitchState.not_found, _not_found(), _content()),
        ),
        active="/releases",
    )
