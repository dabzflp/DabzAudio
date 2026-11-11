import reflex as rx

from droppilot_release_manager.components.brand import wordmark
from droppilot_release_manager.components.epk_preview import epk_preview
from droppilot_release_manager.states.public_epk_state import PublicEPKState


def _footer() -> rx.Component:
    return rx.el.footer(
        rx.el.p(
            "Press kit built with DropPilot",
            class_name="text-xs font-medium text-stone-500",
        ),
        rx.el.a(
            "droppilot.app",
            href="/",
            aria_label="Go to the DropPilot home page",
            class_name="text-xs font-semibold text-violet-300 transition-colors hover:text-violet-200",
        ),
        class_name="mt-10 flex w-full flex-col items-center justify-between gap-2 border-t border-white/5 pt-6 sm:flex-row",
    )


def _not_found() -> rx.Component:
    return rx.el.div(
        rx.el.div(
            rx.icon("file-x", class_name="h-6 w-6 text-stone-500"),
            rx.el.h1(
                "This press kit is not available.",
                class_name="mt-4 text-xl font-semibold text-stone-50",
            ),
            rx.el.p(
                "The link may be wrong, or the artist has taken their press kit offline.",
                class_name="mt-2 text-sm font-medium leading-relaxed text-stone-400",
            ),
            rx.el.a(
                rx.icon("arrow-right", class_name="h-4 w-4"),
                "See what DropPilot does",
                href="/",
                class_name="mt-6 flex w-fit items-center gap-2 rounded-xl bg-violet-400 px-5 py-3 text-sm font-semibold text-stone-950 transition-colors hover:bg-violet-300",
            ),
            class_name="w-full rounded-2xl border border-white/10 bg-white/[0.02] p-8",
        ),
        class_name="w-full",
    )


def _loading() -> rx.Component:
    return rx.el.div(
        rx.el.div(
            class_name="h-44 w-44 animate-pulse rounded-2xl bg-white/[0.05]"
        ),
        rx.el.div(
            class_name="mt-6 h-10 w-64 animate-pulse rounded-xl bg-white/[0.05]"
        ),
        rx.el.div(
            class_name="mt-4 h-40 w-full animate-pulse rounded-2xl bg-white/[0.03]"
        ),
        class_name="w-full",
    )


def public_epk_page() -> rx.Component:
    return rx.el.div(
        rx.el.div(
            rx.el.div(
                wordmark(),
                class_name="flex h-16 w-full items-center border-b border-white/5",
            ),
            rx.el.div(
                rx.cond(
                    PublicEPKState.is_loading,
                    _loading(),
                    rx.cond(
                        PublicEPKState.not_found,
                        _not_found(),
                        epk_preview(
                            PublicEPKState.artist_name,
                            PublicEPKState.photo,
                            PublicEPKState.genre,
                            PublicEPKState.location,
                            PublicEPKState.headline,
                            PublicEPKState.bio,
                            PublicEPKState.release_title,
                            PublicEPKState.release_artwork,
                            PublicEPKState.streaming_links,
                            PublicEPKState.social_links,
                            PublicEPKState.highlight_lines,
                            PublicEPKState.contact_email,
                        ),
                    ),
                ),
                class_name="mt-8 w-full",
            ),
            _footer(),
            class_name="mx-auto w-full max-w-3xl px-4 pb-12 sm:px-6",
        ),
        class_name="font-['Inter'] min-h-dvh w-full bg-stone-950",
    )
