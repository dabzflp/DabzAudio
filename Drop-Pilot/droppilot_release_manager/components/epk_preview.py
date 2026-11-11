import reflex as rx

from droppilot_release_manager.components.brand import waveform


def _image_src(path: rx.Var) -> rx.Var:
    return rx.cond(path.startswith("http"), path, rx.get_upload_url(path))


def _link_pill(link: dict) -> rx.Component:
    return rx.el.a(
        rx.icon(link["icon"], class_name="h-3.5 w-3.5"),
        rx.el.span(link["label"]),
        href=link["url"],
        target="_blank",
        rel="noopener noreferrer",
        aria_label=f"Open {link['label']} in a new tab",
        class_name="flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-stone-200 transition-colors hover:border-violet-400/50 hover:text-stone-50",
    )


def _highlight(line: str) -> rx.Component:
    return rx.el.li(
        rx.icon(
            "disc-2", class_name="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-300"
        ),
        rx.el.span(
            line,
            class_name="text-sm font-medium leading-relaxed text-stone-300",
        ),
        class_name="flex items-start gap-2.5",
    )


def _portrait(photo: rx.Var, artist_name: rx.Var) -> rx.Component:
    return rx.cond(
        photo != "",
        rx.image(
            src=_image_src(photo),
            alt=f"Photograph of {artist_name}",
            class_name="h-40 w-40 shrink-0 rounded-2xl object-cover sm:h-44 sm:w-44",
        ),
        rx.el.div(
            rx.icon("user-round", class_name="h-8 w-8 text-violet-300"),
            rx.el.p(
                "No photo yet",
                class_name="mt-2 text-[11px] font-semibold text-stone-500",
            ),
            class_name="flex h-40 w-40 shrink-0 flex-col items-center justify-center rounded-2xl border border-violet-400/20 bg-violet-400/[0.07] sm:h-44 sm:w-44",
        ),
    )


def epk_preview(
    artist_name: rx.Var,
    photo: rx.Var,
    genre: rx.Var,
    location: rx.Var,
    headline: rx.Var,
    bio: rx.Var,
    release_title: rx.Var,
    release_artwork: rx.Var,
    streaming_links: rx.Var,
    social_links: rx.Var,
    highlight_lines: rx.Var,
    contact_email: rx.Var,
) -> rx.Component:
    """Editorial one-sheet used by the editor preview and the public page."""
    return rx.el.article(
        rx.el.div(
            _portrait(photo, artist_name),
            rx.el.div(
                rx.el.p(
                    "Press kit",
                    class_name="text-[11px] font-bold uppercase tracking-[0.2em] text-violet-300",
                ),
                rx.el.h2(
                    rx.cond(artist_name != "", artist_name, "Your artist name"),
                    class_name="mt-2 text-3xl font-semibold tracking-tight text-stone-50 sm:text-4xl",
                ),
                rx.el.div(
                    rx.cond(
                        genre != "",
                        rx.el.span(
                            genre,
                            class_name="w-fit rounded-full bg-violet-400/15 px-3 py-1 text-[11px] font-semibold text-violet-100",
                        ),
                        rx.fragment(),
                    ),
                    rx.cond(
                        location != "",
                        rx.el.span(
                            rx.icon("map-pin", class_name="h-3 w-3"),
                            rx.el.span(location),
                            class_name="flex w-fit items-center gap-1.5 rounded-full border border-white/10 px-3 py-1 text-[11px] font-semibold text-stone-300",
                        ),
                        rx.fragment(),
                    ),
                    class_name="mt-3 flex flex-wrap items-center gap-2",
                ),
                rx.cond(
                    headline != "",
                    rx.el.p(
                        headline,
                        class_name="mt-4 text-sm font-medium leading-relaxed text-orange-200",
                    ),
                    rx.fragment(),
                ),
                class_name="min-w-0 flex-1",
            ),
            class_name="flex w-full flex-col gap-5 sm:flex-row sm:items-end",
        ),
        waveform("mt-6 opacity-30"),
        rx.el.div(
            rx.el.p(
                "Biography",
                class_name="text-xs font-semibold uppercase tracking-wider text-stone-500",
            ),
            rx.el.p(
                rx.cond(
                    bio != "",
                    bio,
                    "Add a short biography and it appears here, exactly as press will read it.",
                ),
                class_name="mt-2 whitespace-pre-line text-sm font-medium leading-relaxed text-stone-300",
            ),
            class_name="mt-7 w-full",
        ),
        rx.cond(
            release_title != "",
            rx.el.div(
                rx.cond(
                    release_artwork != "",
                    rx.image(
                        src=_image_src(release_artwork),
                        alt=f"Cover artwork for {release_title}",
                        class_name="h-20 w-20 shrink-0 rounded-xl object-cover",
                    ),
                    rx.el.div(
                        rx.icon("disc-3", class_name="h-6 w-6 text-violet-300"),
                        class_name="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-400/10",
                    ),
                ),
                rx.el.div(
                    rx.el.p(
                        "Current release",
                        class_name="text-xs font-semibold uppercase tracking-wider text-stone-500",
                    ),
                    rx.el.p(
                        release_title,
                        class_name="mt-1 text-lg font-semibold text-stone-50",
                    ),
                    class_name="min-w-0",
                ),
                class_name="mt-7 flex w-full items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4",
            ),
            rx.fragment(),
        ),
        rx.cond(
            highlight_lines.length() > 0,
            rx.el.div(
                rx.el.p(
                    "Career highlights",
                    class_name="text-xs font-semibold uppercase tracking-wider text-stone-500",
                ),
                rx.el.ul(
                    rx.foreach(highlight_lines, _highlight),
                    class_name="mt-3 flex flex-col gap-2",
                ),
                class_name="mt-7 w-full",
            ),
            rx.fragment(),
        ),
        rx.cond(
            streaming_links.length() > 0,
            rx.el.div(
                rx.el.p(
                    "Listen",
                    class_name="text-xs font-semibold uppercase tracking-wider text-stone-500",
                ),
                rx.el.div(
                    rx.foreach(streaming_links, _link_pill),
                    class_name="mt-3 flex flex-wrap gap-2",
                ),
                class_name="mt-7 w-full",
            ),
            rx.fragment(),
        ),
        rx.cond(
            social_links.length() > 0,
            rx.el.div(
                rx.el.p(
                    "Follow",
                    class_name="text-xs font-semibold uppercase tracking-wider text-stone-500",
                ),
                rx.el.div(
                    rx.foreach(social_links, _link_pill),
                    class_name="mt-3 flex flex-wrap gap-2",
                ),
                class_name="mt-7 w-full",
            ),
            rx.fragment(),
        ),
        rx.cond(
            contact_email != "",
            rx.el.div(
                rx.el.p(
                    "Contact",
                    class_name="text-xs font-semibold uppercase tracking-wider text-stone-500",
                ),
                rx.el.a(
                    rx.icon("mail", class_name="h-4 w-4"),
                    contact_email,
                    href=f"mailto:{contact_email}",
                    aria_label=f"Email {artist_name}",
                    class_name="mt-2 flex w-fit items-center gap-2 text-sm font-semibold text-violet-200 transition-colors hover:text-violet-100",
                ),
                class_name="mt-7 w-full border-t border-white/5 pt-6",
            ),
            rx.fragment(),
        ),
        class_name="w-full rounded-2xl border border-white/10 bg-white/[0.02] p-6 sm:p-8",
    )
