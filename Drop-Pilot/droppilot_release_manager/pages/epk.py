import reflex as rx

from droppilot_release_manager.components.app_shell import app_shell
from droppilot_release_manager.components.brand import alert
from droppilot_release_manager.components.epk_preview import epk_preview
from droppilot_release_manager.states.epk_state import UPLOAD_ID, EPKState

INPUT = (
    "w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 "
    "text-sm font-medium text-stone-50 placeholder:text-stone-500 "
    "outline-hidden transition-colors focus:border-violet-400 "
    "focus:ring-2 focus:ring-violet-400/30"
)
CARD = "w-full rounded-2xl border border-white/10 bg-white/[0.02] p-5"


def _text_field(
    label: str,
    field: str,
    value: rx.Var,
    placeholder: str = "",
    helper: str = "",
) -> rx.Component:
    return rx.el.div(
        rx.el.label(label, class_name="text-xs font-semibold text-stone-300"),
        rx.el.input(
            default_value=value,
            placeholder=placeholder,
            on_change=lambda v: EPKState.set_field(field, v).debounce(400),
            class_name=f"mt-2 {INPUT}",
        ),
        rx.cond(
            helper != "",
            rx.el.p(
                helper,
                class_name="mt-1.5 text-[11px] font-medium text-stone-500",
            ),
            rx.fragment(),
        ),
        class_name="w-full",
    )


def _area_field(
    label: str,
    field: str,
    value: rx.Var,
    rows: str = "5",
    helper: str = "",
) -> rx.Component:
    return rx.el.div(
        rx.el.label(label, class_name="text-xs font-semibold text-stone-300"),
        rx.el.textarea(
            default_value=value,
            rows=rows,
            on_change=lambda v: EPKState.set_field(field, v).debounce(400),
            class_name=f"mt-2 leading-relaxed {INPUT}",
        ),
        rx.cond(
            helper != "",
            rx.el.p(
                helper,
                class_name="mt-1.5 text-[11px] font-medium text-stone-500",
            ),
            rx.fragment(),
        ),
        class_name="w-full",
    )


def _link_field(spec: dict[str, str]) -> rx.Component:
    return rx.el.div(
        rx.el.label(
            rx.icon(spec["icon"], class_name="h-3.5 w-3.5"),
            rx.el.span(spec["label"]),
            class_name="flex items-center gap-1.5 text-xs font-semibold text-stone-300",
        ),
        rx.el.input(
            default_value=rx.match(
                spec["field"],
                ("spotify_url", EPKState.spotify_url),
                ("apple_music_url", EPKState.apple_music_url),
                ("youtube_url", EPKState.youtube_url),
                ("bandcamp_url", EPKState.bandcamp_url),
                ("instagram_url", EPKState.instagram_url),
                ("tiktok_url", EPKState.tiktok_url),
                ("x_url", EPKState.x_url),
                ("website_url", EPKState.website_url),
                "",
            ),
            placeholder=spec["placeholder"],
            on_change=lambda v: EPKState.set_field(spec["field"], v).debounce(
                400
            ),
            class_name=f"mt-2 {INPUT}",
        ),
        class_name="w-full",
    )


def _photo_block() -> rx.Component:
    return rx.el.div(
        rx.el.p(
            "Artist photograph",
            class_name="text-xs font-semibold uppercase tracking-wider text-stone-500",
        ),
        rx.el.div(
            rx.cond(
                EPKState.artist_photo != "",
                rx.image(
                    src=rx.cond(
                        EPKState.artist_photo.startswith("http"),
                        EPKState.artist_photo,
                        rx.get_upload_url(EPKState.artist_photo),
                    ),
                    alt="Current artist photograph",
                    class_name="h-24 w-24 shrink-0 rounded-2xl object-cover",
                ),
                rx.el.div(
                    rx.icon("image", class_name="h-6 w-6 text-violet-300"),
                    class_name="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl border border-violet-400/20 bg-violet-400/10",
                ),
            ),
            rx.el.div(
                rx.upload.root(
                    rx.el.div(
                        rx.icon(
                            "cloud-upload",
                            class_name="h-5 w-5 text-violet-300",
                        ),
                        rx.el.p(
                            "Drop a JPG, PNG or WEBP here, or click to choose",
                            class_name="mt-2 text-xs font-medium text-stone-300",
                        ),
                        rx.el.p(
                            "Maximum 5 MB",
                            class_name="mt-1 text-[11px] font-medium text-stone-500",
                        ),
                        class_name="flex w-full flex-col items-center justify-center px-4 py-5 text-center",
                    ),
                    id=UPLOAD_ID,
                    multiple=False,
                    max_files=1,
                    accept={
                        "image/jpeg": [".jpg", ".jpeg"],
                        "image/png": [".png"],
                        "image/webp": [".webp"],
                    },
                    on_drop=EPKState.handle_photo(
                        rx.upload_files(upload_id=UPLOAD_ID)
                    ),
                    class_name="w-full cursor-pointer rounded-xl border border-dashed border-white/15 bg-white/[0.02] transition-colors hover:border-violet-400/50",
                ),
                rx.cond(
                    EPKState.artist_photo != "",
                    rx.el.button(
                        rx.icon("trash-2", class_name="h-3.5 w-3.5"),
                        "Remove photo",
                        on_click=EPKState.clear_photo,
                        class_name="mt-2 flex w-fit items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-stone-300 transition-colors hover:border-rose-400/40 hover:text-rose-200",
                    ),
                    rx.fragment(),
                ),
                class_name="min-w-0 flex-1",
            ),
            class_name="mt-3 flex w-full flex-col gap-4 sm:flex-row sm:items-start",
        ),
        rx.cond(
            EPKState.upload_error != "",
            rx.el.div(alert(EPKState.upload_error), class_name="mt-3 w-full"),
            rx.fragment(),
        ),
        class_name=CARD,
    )


def _release_select() -> rx.Component:
    return rx.el.div(
        rx.el.label(
            "Current release",
            class_name="text-xs font-semibold text-stone-300",
        ),
        rx.cond(
            EPKState.releases.length() > 0,
            rx.el.div(
                rx.el.select(
                    rx.el.option("No release selected", value=""),
                    rx.foreach(
                        EPKState.releases,
                        lambda option: rx.el.option(
                            option["label"], value=option["value"]
                        ),
                    ),
                    value=EPKState.release_id,
                    on_change=EPKState.set_release,
                    class_name=f"appearance-none {INPUT}",
                ),
                rx.icon(
                    "chevron-down",
                    class_name="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500",
                ),
                class_name="relative mt-2 w-full",
            ),
            rx.el.p(
                "You have no releases yet. Upload a song in a campaign and it becomes selectable here.",
                class_name="mt-2 text-xs font-medium text-stone-500",
            ),
        ),
        class_name="w-full",
    )


def _publish_bar() -> rx.Component:
    return rx.el.div(
        rx.el.div(
            rx.el.div(
                rx.el.span(
                    rx.cond(EPKState.is_published, "Published", "Draft"),
                    class_name=rx.cond(
                        EPKState.is_published,
                        "w-fit rounded-full bg-emerald-400/15 px-3 py-1 text-[11px] font-semibold text-emerald-200",
                        "w-fit rounded-full bg-orange-400/15 px-3 py-1 text-[11px] font-semibold text-orange-200",
                    ),
                ),
                rx.cond(
                    EPKState.public_path != "",
                    rx.el.p(
                        EPKState.public_path,
                        class_name="truncate text-xs font-medium text-stone-400",
                    ),
                    rx.el.p(
                        "A public link is created the first time you save.",
                        class_name="text-xs font-medium text-stone-500",
                    ),
                ),
                class_name="flex min-w-0 flex-1 items-center gap-3",
            ),
            rx.el.div(
                rx.cond(
                    EPKState.public_path != "",
                    rx.el.div(
                        rx.el.button(
                            rx.icon("copy", class_name="h-4 w-4"),
                            "Copy link",
                            on_click=rx.set_clipboard(EPKState.public_url),
                            class_name="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-stone-200 transition-colors hover:border-violet-400/50 sm:w-fit",
                        ),
                        rx.el.a(
                            rx.icon("external-link", class_name="h-4 w-4"),
                            "Open",
                            href=EPKState.public_path,
                            target="_blank",
                            rel="noopener noreferrer",
                            class_name="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-stone-200 transition-colors hover:border-violet-400/50 sm:w-fit",
                        ),
                        class_name="flex w-full flex-col gap-2 sm:w-fit sm:flex-row",
                    ),
                    rx.fragment(),
                ),
                rx.cond(
                    EPKState.is_published,
                    rx.el.button(
                        rx.icon("eye-off", class_name="h-4 w-4"),
                        "Unpublish",
                        on_click=EPKState.unpublish,
                        disabled=EPKState.is_saving,
                        class_name="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-stone-300 transition-colors hover:border-rose-400/40 hover:text-rose-200 disabled:opacity-60 sm:w-fit",
                    ),
                    rx.el.button(
                        rx.icon("globe", class_name="h-4 w-4"),
                        "Publish",
                        on_click=EPKState.publish,
                        disabled=EPKState.is_saving,
                        class_name="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2.5 text-sm font-semibold text-emerald-100 transition-colors hover:bg-emerald-400/20 disabled:opacity-60 sm:w-fit",
                    ),
                ),
                rx.el.button(
                    rx.cond(
                        EPKState.is_saving,
                        rx.icon(
                            "loader-circle", class_name="h-4 w-4 animate-spin"
                        ),
                        rx.icon("save", class_name="h-4 w-4"),
                    ),
                    "Save draft",
                    on_click=EPKState.save_draft,
                    disabled=EPKState.is_saving,
                    class_name="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-400 px-4 py-2.5 text-sm font-semibold text-stone-950 transition-colors hover:bg-violet-300 disabled:opacity-60 sm:w-fit",
                ),
                class_name="flex w-full flex-col gap-2 sm:w-fit sm:flex-row sm:items-center",
            ),
            class_name="flex w-full flex-col gap-3 lg:flex-row lg:items-center lg:justify-between",
        ),
        class_name="w-full rounded-2xl border border-white/10 bg-white/[0.03] p-4",
    )


def _editor() -> rx.Component:
    return rx.el.div(
        rx.cond(
            EPKState.error != "",
            rx.el.div(alert(EPKState.error), class_name="w-full"),
            rx.fragment(),
        ),
        rx.cond(
            EPKState.notice != "",
            rx.el.div(alert(EPKState.notice, "success"), class_name="w-full"),
            rx.fragment(),
        ),
        rx.el.div(
            rx.el.p(
                "Identity",
                class_name="text-xs font-semibold uppercase tracking-wider text-stone-500",
            ),
            rx.el.div(
                _text_field(
                    "Artist name",
                    "artist_name",
                    EPKState.artist_name,
                    "Your artist name",
                ),
                _text_field("Genre", "genre", EPKState.genre, "e.g. Alt-pop"),
                _text_field(
                    "Location",
                    "location",
                    EPKState.location,
                    "City, country",
                ),
                _text_field(
                    "Contact email",
                    "contact_email",
                    EPKState.contact_email,
                    "press@yourname.com",
                    "Shown publicly so press can reach you.",
                ),
                class_name="mt-3 grid w-full grid-cols-1 gap-4 sm:grid-cols-2",
            ),
            rx.el.div(
                _text_field(
                    "Headline",
                    "headline",
                    EPKState.headline,
                    "One factual line about the release",
                ),
                class_name="mt-4 w-full",
            ),
            class_name=CARD,
        ),
        _photo_block(),
        rx.el.div(
            rx.el.p(
                "Music",
                class_name="text-xs font-semibold uppercase tracking-wider text-stone-500",
            ),
            rx.el.div(_release_select(), class_name="mt-3 w-full"),
            rx.el.div(
                rx.el.div(
                    _area_field(
                        "Biography",
                        "bio",
                        EPKState.bio,
                        "7",
                        f"{EPKState.bio_count} characters. Keep every claim true \u2014 press will check.",
                    ),
                    class_name="w-full",
                ),
                class_name="mt-4 w-full",
            ),
            rx.el.div(
                _area_field(
                    "Career highlights",
                    "highlights",
                    EPKState.highlights,
                    "5",
                    "One per line. Only real, verifiable highlights.",
                ),
                class_name="mt-4 w-full",
            ),
            class_name=CARD,
        ),
        rx.el.div(
            rx.el.p(
                "Streaming links",
                class_name="text-xs font-semibold uppercase tracking-wider text-stone-500",
            ),
            rx.el.div(
                rx.foreach(EPKState.link_fields, _link_field),
                class_name="mt-3 grid w-full grid-cols-1 gap-4 sm:grid-cols-2",
            ),
            class_name=CARD,
        ),
        rx.el.div(
            rx.el.p(
                "Social links",
                class_name="text-xs font-semibold uppercase tracking-wider text-stone-500",
            ),
            rx.el.div(
                rx.foreach(EPKState.social_fields, _link_field),
                class_name="mt-3 grid w-full grid-cols-1 gap-4 sm:grid-cols-2",
            ),
            class_name=CARD,
        ),
        class_name="flex w-full min-w-0 flex-col gap-4",
    )


def _preview() -> rx.Component:
    return rx.el.div(
        rx.el.p(
            "Live preview",
            class_name="text-xs font-semibold uppercase tracking-wider text-stone-500",
        ),
        rx.el.div(
            epk_preview(
                EPKState.artist_name,
                EPKState.artist_photo,
                EPKState.genre,
                EPKState.location,
                EPKState.headline,
                EPKState.bio,
                EPKState.release_title,
                EPKState.release_artwork,
                EPKState.streaming_links,
                EPKState.social_links,
                EPKState.highlight_lines,
                EPKState.contact_email,
            ),
            class_name="mt-3 w-full",
        ),
        class_name="w-full min-w-0",
    )


def _mobile_tabs() -> rx.Component:
    return rx.el.div(
        rx.el.button(
            rx.icon("pencil", class_name="h-4 w-4"),
            "Editor",
            on_click=lambda: EPKState.set_mobile_tab("edit"),
            class_name=rx.cond(
                EPKState.mobile_tab == "edit",
                "flex flex-1 items-center justify-center gap-2 rounded-xl bg-violet-400/10 px-4 py-2.5 text-sm font-semibold text-violet-100",
                "flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-stone-400",
            ),
        ),
        rx.el.button(
            rx.icon("eye", class_name="h-4 w-4"),
            "Preview",
            on_click=lambda: EPKState.set_mobile_tab("preview"),
            class_name=rx.cond(
                EPKState.mobile_tab == "preview",
                "flex flex-1 items-center justify-center gap-2 rounded-xl bg-violet-400/10 px-4 py-2.5 text-sm font-semibold text-violet-100",
                "flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-stone-400",
            ),
        ),
        class_name="flex w-full items-center gap-1 rounded-2xl border border-white/10 bg-white/[0.02] p-1.5 xl:hidden",
    )


def _content() -> rx.Component:
    return rx.el.div(
        rx.el.div(
            rx.el.h1(
                "EPK builder",
                class_name="text-2xl font-semibold tracking-tight text-stone-50 sm:text-3xl",
            ),
            rx.el.p(
                "One editorial press kit, always up to date, on a link you can send to anyone.",
                class_name="mt-1 text-sm font-medium text-stone-400",
            ),
            class_name="w-full",
        ),
        rx.el.div(_publish_bar(), class_name="mt-5 w-full"),
        rx.el.div(_mobile_tabs(), class_name="mt-4 w-full"),
        rx.el.div(
            rx.el.div(
                _editor(),
                class_name=rx.cond(
                    EPKState.mobile_tab == "edit",
                    "flex w-full min-w-0 flex-1 flex-col xl:flex",
                    "hidden w-full min-w-0 flex-1 flex-col xl:flex",
                ),
            ),
            rx.el.div(
                _preview(),
                class_name=rx.cond(
                    EPKState.mobile_tab == "preview",
                    "block w-full min-w-0 flex-1 xl:block",
                    "hidden w-full min-w-0 flex-1 xl:block",
                ),
            ),
            class_name="mt-4 flex w-full flex-col gap-6 xl:flex-row xl:items-start",
        ),
        class_name="mx-auto flex w-full max-w-7xl flex-col",
    )


def epk_page() -> rx.Component:
    return app_shell(
        rx.cond(
            EPKState.is_loading,
            rx.el.div(
                rx.el.div(
                    class_name="h-10 w-56 animate-pulse rounded-xl bg-white/[0.05]"
                ),
                rx.el.div(
                    class_name="mt-5 h-20 w-full animate-pulse rounded-2xl bg-white/[0.04]"
                ),
                rx.el.div(
                    class_name="mt-4 h-96 w-full animate-pulse rounded-2xl bg-white/[0.03]"
                ),
                class_name="mx-auto w-full max-w-7xl",
            ),
            _content(),
        ),
        active="/epk",
    )
