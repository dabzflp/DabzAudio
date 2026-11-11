import reflex as rx

from droppilot_release_manager.components.app_shell import app_shell
from droppilot_release_manager.components.brand import alert
from droppilot_release_manager.states.wizard_state import WizardState

INPUT = (
    "w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 "
    "text-sm font-medium text-stone-50 placeholder:text-stone-500 "
    "outline-hidden transition-colors focus:border-violet-400 "
    "focus:ring-2 focus:ring-violet-400/30"
)
CARD = "w-full rounded-2xl border border-white/10 bg-white/[0.02] p-5 sm:p-6"
CHIP_ON = (
    "flex w-full items-center gap-2 rounded-xl border border-violet-400/40 "
    "bg-violet-400/10 px-4 py-3 text-sm font-semibold text-violet-100 "
    "transition-colors"
)
CHIP_OFF = (
    "flex w-full items-center gap-2 rounded-xl border border-white/10 "
    "px-4 py-3 text-sm font-medium text-stone-300 transition-colors "
    "hover:border-violet-400/40 hover:text-stone-50"
)


def _label(text: str) -> rx.Component:
    return rx.el.p(text, class_name="text-sm font-semibold text-stone-200")


def _field(
    label: str,
    field: str,
    placeholder: str,
    value: rx.Var,
    input_type: str = "text",
) -> rx.Component:
    return rx.el.div(
        _label(label),
        rx.el.input(
            type=input_type,
            placeholder=placeholder,
            default_value=value,
            on_change=lambda v: WizardState.set_field(field, v).debounce(400),
            class_name=f"mt-2 {INPUT}",
        ),
        class_name="w-full",
    )


def _textarea(
    label: str, field: str, placeholder: str, value: rx.Var, rows: str = "4"
) -> rx.Component:
    return rx.el.div(
        _label(label),
        rx.el.textarea(
            placeholder=placeholder,
            default_value=value,
            rows=rows,
            on_change=lambda v: WizardState.set_field(field, v).debounce(500),
            class_name=f"mt-2 {INPUT}",
        ),
        class_name="w-full",
    )


def _select(
    label: str, field: str, options: rx.Var, value: rx.Var
) -> rx.Component:
    return rx.el.div(
        _label(label),
        rx.el.div(
            rx.el.select(
                rx.foreach(
                    options,
                    lambda option: rx.el.option(
                        option["label"], value=option["value"]
                    ),
                ),
                value=value,
                on_change=lambda v: WizardState.set_field(field, v),
                class_name=f"appearance-none {INPUT}",
            ),
            rx.icon(
                "chevron-down",
                class_name="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500",
            ),
            class_name="relative mt-2 w-full",
        ),
        class_name="w-full",
    )


def _genre_select(label: str, field: str, value: rx.Var) -> rx.Component:
    return rx.el.div(
        _label(label),
        rx.el.div(
            rx.el.select(
                rx.el.option("Choose a genre", value=""),
                rx.foreach(
                    WizardState.genres,
                    lambda genre: rx.el.option(genre, value=genre),
                ),
                value=value,
                on_change=lambda v: WizardState.set_field(field, v),
                class_name=f"appearance-none {INPUT}",
            ),
            rx.icon(
                "chevron-down",
                class_name="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500",
            ),
            class_name="relative mt-2 w-full",
        ),
        class_name="w-full",
    )


def _step_one() -> rx.Component:
    return rx.el.div(
        rx.el.div(
            _field(
                "Song or project title",
                "title",
                "Neon Hours",
                WizardState.title,
            ),
            _select(
                "Release type",
                "release_type",
                WizardState.release_types,
                WizardState.release_type,
            ),
            _genre_select(
                "Main genre", "primary_genre", WizardState.primary_genre
            ),
            _genre_select(
                "Secondary genre (optional)",
                "secondary_genre",
                WizardState.secondary_genre,
            ),
            _field(
                "Featured artists (optional)",
                "featured_artists",
                "Comma separated",
                WizardState.featured_artists,
            ),
            _field(
                "Mood in a few words",
                "mood",
                "late-night, hopeful",
                WizardState.mood,
            ),
            _field(
                "Release date",
                "release_date",
                "",
                WizardState.release_date,
                "date",
            ),
            rx.el.div(
                _label("Explicit lyrics"),
                rx.el.button(
                    rx.icon(
                        rx.cond(WizardState.is_explicit, "check", "minus"),
                        class_name="h-4 w-4",
                    ),
                    rx.cond(
                        WizardState.is_explicit,
                        "Marked explicit",
                        "Not explicit",
                    ),
                    on_click=WizardState.toggle_explicit,
                    class_name=rx.cond(
                        WizardState.is_explicit,
                        f"mt-2 {CHIP_ON}",
                        f"mt-2 {CHIP_OFF}",
                    ),
                ),
                class_name="w-full",
            ),
            class_name="grid w-full grid-cols-1 gap-5 md:grid-cols-2",
        ),
        _textarea(
            "Short description",
            "description",
            "What is this release about?",
            WizardState.description,
        ),
        class_name="flex w-full flex-col gap-5",
    )


def _upload_box(
    label: str,
    hint: str,
    upload_id: str,
    accept: dict[str, list[str]],
    handler,
    file_name: rx.Var,
    status: rx.Var,
    error: rx.Var,
    is_uploading: rx.Var,
    clear,
) -> rx.Component:
    return rx.el.div(
        _label(label),
        rx.el.p(hint, class_name="mt-1 text-xs font-medium text-stone-500"),
        rx.upload.root(
            rx.el.div(
                rx.icon("upload", class_name="h-5 w-5 text-violet-300"),
                rx.el.p(
                    "Click or drop the file here",
                    class_name="mt-3 text-sm font-semibold text-stone-200",
                ),
                class_name="flex flex-col items-center justify-center px-4 py-8 text-center",
            ),
            id=upload_id,
            accept=accept,
            max_files=1,
            multiple=False,
            on_drop=handler(rx.upload_files(upload_id=upload_id)),
            class_name="mt-3 w-full cursor-pointer rounded-2xl border-2 border-dashed border-white/10 transition-colors hover:border-violet-400/50",
        ),
        rx.cond(
            is_uploading,
            rx.el.div(
                rx.icon(
                    "loader-circle",
                    class_name="h-4 w-4 animate-spin text-violet-300",
                ),
                rx.el.p(
                    "Uploading\u2026",
                    class_name="text-sm font-medium text-stone-300",
                ),
                class_name="mt-3 flex items-center gap-2",
            ),
            rx.fragment(),
        ),
        rx.cond(
            file_name != "",
            rx.el.div(
                rx.icon(
                    "circle-check",
                    class_name="h-4 w-4 shrink-0 text-violet-300",
                ),
                rx.el.div(
                    rx.el.p(
                        file_name,
                        class_name="truncate text-sm font-semibold text-stone-100",
                    ),
                    rx.el.p(
                        status,
                        class_name="mt-0.5 text-xs font-medium text-stone-500",
                    ),
                    class_name="min-w-0 flex-1",
                ),
                rx.el.button(
                    rx.icon("x", class_name="h-4 w-4"),
                    on_click=clear,
                    aria_label="Remove file",
                    class_name="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/10 text-stone-400 transition-colors hover:border-rose-400/40 hover:text-rose-200",
                ),
                class_name="mt-3 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5",
            ),
            rx.fragment(),
        ),
        rx.cond(
            error != "",
            rx.el.div(alert(error), class_name="mt-3 w-full"),
            rx.fragment(),
        ),
        class_name=CARD,
    )


def _step_two() -> rx.Component:
    return rx.el.div(
        rx.el.div(
            _upload_box(
                "Audio file",
                "MP3 or WAV, up to 25MB. Stored privately against your account.",
                "wizard_audio",
                {"audio/mpeg": [".mp3"], "audio/wav": [".wav"]},
                WizardState.handle_audio_upload,
                WizardState.audio_name,
                WizardState.audio_status,
                WizardState.audio_error,
                WizardState.is_uploading_audio,
                WizardState.clear_audio,
            ),
            _upload_box(
                "Artwork",
                "JPG, PNG or WEBP, up to 8MB. Square artwork looks best.",
                "wizard_artwork",
                {
                    "image/jpeg": [".jpg", ".jpeg"],
                    "image/png": [".png"],
                    "image/webp": [".webp"],
                },
                WizardState.handle_artwork_upload,
                WizardState.artwork_name,
                WizardState.artwork_status,
                WizardState.artwork_error,
                WizardState.is_uploading_artwork,
                WizardState.clear_artwork,
            ),
            class_name="grid w-full grid-cols-1 gap-4 lg:grid-cols-2",
        ),
        _textarea(
            "Lyrics (optional)",
            "lyrics",
            "Paste the lyrics so ideas can quote real lines.",
            WizardState.lyrics,
            "8",
        ),
        rx.el.p(
            WizardState.methodology,
            class_name="text-xs font-medium leading-relaxed text-stone-500",
        ),
        class_name="flex w-full flex-col gap-5",
    )


def _objective_button(option: dict[str, str]) -> rx.Component:
    return rx.el.button(
        rx.icon(
            rx.cond(
                WizardState.objectives.contains(option["value"]),
                "check",
                "plus",
            ),
            class_name="h-4 w-4",
        ),
        rx.el.span(option["label"]),
        on_click=lambda: WizardState.toggle_objective(option["value"]),
        class_name=rx.cond(
            WizardState.objectives.contains(option["value"]),
            CHIP_ON,
            CHIP_OFF,
        ),
    )


def _step_three() -> rx.Component:
    return rx.el.div(
        rx.el.div(
            _label("What should this campaign achieve?"),
            rx.el.p(
                "Pick everything that matters. The plan leans into these.",
                class_name="mt-1 text-xs font-medium text-stone-500",
            ),
            rx.el.div(
                rx.foreach(WizardState.objectives_options, _objective_button),
                class_name="mt-4 grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2",
            ),
            class_name=CARD,
        ),
        class_name="flex w-full flex-col gap-5",
    )


def _personality_button(option: dict[str, str]) -> rx.Component:
    return rx.el.button(
        rx.el.div(
            rx.el.p(option["label"], class_name="text-sm font-semibold"),
            rx.el.p(
                option["hint"],
                class_name="mt-1 text-xs font-medium text-stone-500",
            ),
            class_name="text-left",
        ),
        on_click=lambda: WizardState.set_field("personality", option["value"]),
        class_name=rx.cond(
            WizardState.personality == option["value"],
            "flex w-full flex-col rounded-xl border border-violet-400/40 bg-violet-400/10 px-4 py-3 text-violet-100",
            "flex w-full flex-col rounded-xl border border-white/10 px-4 py-3 text-stone-300 transition-colors hover:border-violet-400/40",
        ),
    )


def _resource_button(option: dict[str, str]) -> rx.Component:
    return rx.el.button(
        rx.icon(option["icon"], class_name="h-4 w-4"),
        rx.el.span(option["label"]),
        on_click=lambda: WizardState.toggle_resource(option["value"]),
        class_name=rx.cond(
            WizardState.resources.contains(option["value"]),
            CHIP_ON,
            CHIP_OFF,
        ),
    )


def _step_four() -> rx.Component:
    return rx.el.div(
        rx.el.div(
            _textarea(
                "Who is this release for?",
                "audience",
                "Late-night listeners, 18\u201334, into alt-pop",
                WizardState.audience,
                "3",
            ),
            _field(
                "Cities and countries to target",
                "locations",
                "London, Manchester, Berlin",
                WizardState.locations,
            ),
            class_name="grid w-full grid-cols-1 gap-5 md:grid-cols-2",
        ),
        rx.el.div(
            _label("Content personality"),
            rx.el.div(
                rx.foreach(WizardState.personalities, _personality_button),
                class_name="mt-4 grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3",
            ),
            class_name=CARD,
        ),
        rx.el.div(
            _label("What do you have to work with?"),
            rx.el.div(
                rx.foreach(WizardState.resource_options, _resource_button),
                class_name="mt-4 grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4",
            ),
            class_name=CARD,
        ),
        rx.el.div(
            _select(
                "Weekly posting capacity",
                "weekly_capacity",
                WizardState.capacities,
                WizardState.weekly_capacity,
            ),
            _select(
                "Budget band",
                "budget_band",
                WizardState.budget_bands,
                WizardState.budget_band,
            ),
            class_name="grid w-full grid-cols-1 gap-5 md:grid-cols-2",
        ),
        _textarea(
            "Anything else DropPilot should know?",
            "instructions",
            "No dance trends, keep it low-budget, mention the launch show\u2026",
            WizardState.instructions,
            "4",
        ),
        class_name="flex w-full flex-col gap-5",
    )


def _review_row(label: str, value: rx.Var | str, step: int) -> rx.Component:
    return rx.el.div(
        rx.el.div(
            rx.el.p(
                label,
                class_name="text-xs font-semibold uppercase tracking-wider text-stone-500",
            ),
            rx.el.p(
                value,
                class_name="mt-1 break-words text-sm font-semibold text-stone-100",
            ),
            class_name="min-w-0 flex-1",
        ),
        rx.el.button(
            "Edit",
            on_click=lambda: WizardState.go_to_step(step),
            class_name="w-fit shrink-0 rounded-xl border border-white/10 px-3 py-1.5 text-xs font-semibold text-stone-300 transition-colors hover:border-violet-400/50 hover:text-stone-50",
        ),
        class_name="flex items-start justify-between gap-4 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3",
    )


def _generating() -> rx.Component:
    return rx.el.div(
        rx.icon(
            "loader-circle", class_name="h-6 w-6 animate-spin text-violet-300"
        ),
        rx.el.p(
            WizardState.stage_label,
            class_name="mt-5 text-lg font-semibold text-stone-50",
        ),
        rx.el.p(
            "Building 21 content items, then six pitch drafts. This uses the details you submitted \u2014 genre, lyrics, goals and context. Your audio is never analysed.",
            class_name="mt-2 max-w-md text-sm font-medium leading-relaxed text-stone-400",
        ),
        class_name="flex w-full flex-col items-center rounded-2xl border border-white/10 bg-white/[0.02] px-6 py-14 text-center",
    )


def _step_five() -> rx.Component:
    return rx.el.div(
        rx.el.div(
            _review_row("Title", WizardState.title, 1),
            _review_row("Release date", WizardState.release_date_label, 1),
            _review_row("Genre", WizardState.primary_genre, 1),
            _review_row("Audio file", WizardState.audio_name, 2),
            _review_row("Artwork", WizardState.artwork_name, 2),
            _review_row("Objectives", WizardState.objectives_label, 3),
            _review_row("Audience", WizardState.audience, 4),
            _review_row("Locations", WizardState.locations, 4),
            _review_row("Personality", WizardState.personality_label, 4),
            _review_row("Resources", WizardState.resources_label, 4),
            _review_row("Budget", WizardState.budget_label, 4),
            class_name="flex w-full flex-col gap-2",
        ),
        rx.el.p(
            WizardState.methodology,
            class_name="mt-5 text-xs font-medium leading-relaxed text-stone-500",
        ),
        class_name=CARD,
    )


def _step_dot(index: int) -> rx.Component:
    return rx.el.button(
        rx.el.span(index),
        on_click=lambda: WizardState.go_to_step(index),
        class_name=rx.cond(
            WizardState.step >= index,
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-400 text-xs font-bold text-stone-950",
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 text-xs font-bold text-stone-500",
        ),
    )


def _progress() -> rx.Component:
    return rx.el.div(
        rx.el.div(
            rx.el.p(
                f"Step {WizardState.step} of {WizardState.total_steps}",
                class_name="text-xs font-semibold uppercase tracking-wider text-violet-300",
            ),
            rx.el.p(
                WizardState.step_title,
                class_name="mt-1 text-xl font-semibold tracking-tight text-stone-50",
            ),
            class_name="min-w-0",
        ),
        rx.el.div(
            _step_dot(1),
            _step_dot(2),
            _step_dot(3),
            _step_dot(4),
            _step_dot(5),
            class_name="flex shrink-0 items-center gap-2",
        ),
        class_name="flex w-full flex-col items-start justify-between gap-4 sm:flex-row sm:items-center",
    )


def _footer_actions() -> rx.Component:
    return rx.el.div(
        rx.el.button(
            rx.icon("arrow-left", class_name="h-4 w-4"),
            "Back",
            on_click=WizardState.previous_step,
            disabled=WizardState.step <= 1,
            class_name="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-stone-300 transition-colors hover:border-violet-400/40 disabled:opacity-40 sm:w-fit",
        ),
        rx.cond(
            WizardState.step < WizardState.total_steps,
            rx.el.button(
                "Continue",
                rx.icon("arrow-right", class_name="h-4 w-4"),
                on_click=WizardState.next_step,
                class_name="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-400 px-5 py-3 text-sm font-semibold text-stone-950 transition-colors hover:bg-violet-300 sm:w-fit",
            ),
            rx.el.button(
                rx.cond(
                    WizardState.is_generating,
                    rx.icon("loader-circle", class_name="h-4 w-4 animate-spin"),
                    rx.icon("sparkles", class_name="h-4 w-4"),
                ),
                rx.cond(
                    WizardState.is_generating,
                    "Generating\u2026",
                    "Generate my 21-day plan",
                ),
                on_click=WizardState.generate,
                disabled=WizardState.is_generating | WizardState.quota_reached,
                class_name="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-400 px-5 py-3 text-sm font-semibold text-stone-950 transition-colors hover:bg-violet-300 disabled:cursor-not-allowed disabled:opacity-60 sm:w-fit",
            ),
        ),
        class_name="flex w-full flex-col-reverse gap-3 sm:flex-row sm:justify-between",
    )


def _content() -> rx.Component:
    return rx.el.div(
        _progress(),
        rx.el.div(
            rx.el.div(
                class_name="h-full rounded-full bg-violet-400 transition-all duration-300",
                style={"width": f"{WizardState.progress_percent}%"},
            ),
            class_name="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-white/10",
        ),
        rx.cond(
            WizardState.quota_reached,
            rx.el.div(
                alert(WizardState.quota_message),
                class_name="mt-6 w-full",
            ),
            rx.fragment(),
        ),
        rx.cond(
            WizardState.error != "",
            rx.el.div(alert(WizardState.error), class_name="mt-6 w-full"),
            rx.fragment(),
        ),
        rx.el.div(
            rx.match(
                WizardState.step,
                (1, _step_one()),
                (2, _step_two()),
                (3, _step_three()),
                (4, _step_four()),
                (5, _step_five()),
                _step_one(),
            ),
            class_name="mt-6 w-full",
        ),
        rx.el.div(_footer_actions(), class_name="mt-8 w-full"),
        class_name="mx-auto flex w-full max-w-4xl flex-col",
    )


def campaign_new_page() -> rx.Component:
    return app_shell(
        rx.cond(WizardState.is_generating, _generating(), _content()),
        active="/campaigns/new",
    )
