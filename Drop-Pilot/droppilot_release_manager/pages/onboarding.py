import reflex as rx

from droppilot_release_manager.components.auth_shell import GHOST_BUTTON, INPUT_CLASS, PRIMARY_BUTTON
from droppilot_release_manager.components.brand import alert, waveform, wordmark
from droppilot_release_manager.states.auth_state import AuthState
from droppilot_release_manager.states.onboarding_state import OnboardingState

CARD = "w-full rounded-2xl border border-white/10 bg-white/[0.03] p-6 sm:p-8"
CHOICE_BASE = (
    "flex w-full flex-col items-start gap-1 rounded-xl border px-4 py-3 "
    "text-left transition-colors"
)
CHOICE_ON = "border-violet-400 bg-violet-400/10"
CHOICE_OFF = "border-white/10 bg-white/[0.02] hover:border-white/25"


def _section(title: str, hint: str, body: rx.Component) -> rx.Component:
    return rx.el.div(
        rx.el.h3(title, class_name="text-base font-semibold text-stone-100"),
        rx.el.p(hint, class_name="mt-1 text-sm font-medium text-stone-400"),
        rx.el.div(body, class_name="mt-4"),
        class_name="w-full",
    )


def _stage_choice(item: dict[str, str]) -> rx.Component:
    return rx.el.button(
        rx.el.span(
            item["label"], class_name="text-sm font-semibold text-stone-50"
        ),
        rx.el.span(
            item["hint"],
            class_name="text-xs font-medium leading-relaxed text-stone-400",
        ),
        type="button",
        on_click=lambda: OnboardingState.set_career_stage(item["value"]),
        class_name=rx.cond(
            OnboardingState.career_stage == item["value"],
            f"{CHOICE_BASE} {CHOICE_ON}",
            f"{CHOICE_BASE} {CHOICE_OFF}",
        ),
    )


def _goal_choice(item: dict[str, str]) -> rx.Component:
    return rx.el.button(
        rx.el.span(
            item["label"], class_name="text-sm font-semibold text-stone-50"
        ),
        rx.el.span(
            item["hint"],
            class_name="text-xs font-medium leading-relaxed text-stone-400",
        ),
        type="button",
        on_click=lambda: OnboardingState.set_campaign_goal(item["value"]),
        class_name=rx.cond(
            OnboardingState.campaign_goal == item["value"],
            f"{CHOICE_BASE} {CHOICE_ON}",
            f"{CHOICE_BASE} {CHOICE_OFF}",
        ),
    )


def _platform_choice(item: dict[str, str]) -> rx.Component:
    return rx.el.button(
        rx.icon(item["icon"], class_name="h-4 w-4 text-violet-300"),
        rx.el.span(
            item["label"], class_name="text-sm font-semibold text-stone-50"
        ),
        type="button",
        on_click=lambda: OnboardingState.set_primary_platform(item["value"]),
        class_name=rx.cond(
            OnboardingState.primary_platform == item["value"],
            "flex w-fit items-center gap-2 rounded-xl border border-violet-400 bg-violet-400/10 px-4 py-2.5 transition-colors",
            "flex w-fit items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-2.5 transition-colors hover:border-white/25",
        ),
    )


def _genre_option(genre: str) -> rx.Component:
    return rx.el.option(genre, value=genre)


def _step_one() -> rx.Component:
    return rx.el.div(
        _section(
            "What name do you release under?",
            "This is the professional name on your campaigns and press kit.",
            rx.el.input(
                placeholder="e.g. Nova Reign",
                default_value=OnboardingState.artist_name,
                on_change=OnboardingState.set_artist_name.debounce(300),
                class_name=INPUT_CLASS,
            ),
        ),
        _section(
            "Your main genre",
            "We use this to shape captions, pitches and curator targets.",
            rx.el.div(
                rx.el.select(
                    rx.el.option("Select a genre", value="", disabled=True),
                    rx.foreach(OnboardingState.genres, _genre_option),
                    value=OnboardingState.genre,
                    on_change=OnboardingState.set_genre,
                    class_name=f"appearance-none {INPUT_CLASS}",
                ),
                rx.icon(
                    "chevron-down",
                    class_name="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400",
                ),
                class_name="relative w-full",
            ),
        ),
        class_name="flex w-full flex-col gap-8",
    )


def _step_two() -> rx.Component:
    return rx.el.div(
        _section(
            "Where are you in your career?",
            "It sets the pace and ambition of your rollout plan.",
            rx.el.div(
                rx.foreach(OnboardingState.career_stages, _stage_choice),
                class_name="grid w-full grid-cols-1 gap-3 sm:grid-cols-2",
            ),
        ),
        _section(
            "Primary social platform",
            "Optional \u2014 skip it and add it later from settings.",
            rx.el.div(
                rx.foreach(OnboardingState.platforms, _platform_choice),
                class_name="flex w-full flex-wrap gap-3",
            ),
        ),
        class_name="flex w-full flex-col gap-8",
    )


def _avatar_preview() -> rx.Component:
    return rx.el.div(
        rx.image(
            src=rx.get_upload_url(OnboardingState.avatar_url),
            alt="Profile image preview",
            class_name="size-16 rounded-full object-cover",
        ),
        rx.el.button(
            rx.icon("x", class_name="h-4 w-4"),
            "Remove",
            type="button",
            on_click=OnboardingState.clear_avatar,
            class_name="flex w-fit items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-stone-300 hover:border-rose-400/50 hover:text-rose-200",
        ),
        class_name="flex items-center gap-4",
    )


def _step_three() -> rx.Component:
    return rx.el.div(
        _section(
            "What should your first campaign chase?",
            "Optional \u2014 pick the outcome that matters most right now.",
            rx.el.div(
                rx.foreach(OnboardingState.goals, _goal_choice),
                class_name="grid w-full grid-cols-1 gap-3 sm:grid-cols-2",
            ),
        ),
        _section(
            "Profile image",
            "Optional \u2014 a square press photo or logo works best.",
            rx.el.div(
                rx.cond(
                    OnboardingState.avatar_url != "",
                    _avatar_preview(),
                    rx.el.div(
                        rx.upload.root(
                            rx.el.div(
                                rx.icon(
                                    "image-plus",
                                    class_name="h-5 w-5 text-violet-300",
                                ),
                                rx.el.p(
                                    "Drop an image or click to choose",
                                    class_name="text-sm font-medium text-stone-300",
                                ),
                                rx.el.p(
                                    "PNG, JPG or WEBP",
                                    class_name="text-xs font-medium text-stone-500",
                                ),
                                class_name="flex flex-col items-center justify-center gap-2 px-6 py-8 text-center",
                            ),
                            id="avatar_upload",
                            max_files=1,
                            multiple=False,
                            accept={
                                "image/png": [".png"],
                                "image/jpeg": [".jpg", ".jpeg"],
                                "image/webp": [".webp"],
                            },
                            on_drop=OnboardingState.handle_avatar_upload(
                                rx.upload_files(upload_id="avatar_upload")
                            ),
                            class_name="w-full cursor-pointer rounded-xl border border-dashed border-white/15 bg-white/[0.02] transition-colors hover:border-violet-400/50",
                        ),
                        rx.cond(
                            OnboardingState.is_uploading,
                            rx.el.p(
                                "Uploading\u2026",
                                class_name="mt-2 text-xs font-medium text-violet-300",
                            ),
                            rx.fragment(),
                        ),
                        class_name="w-full",
                    ),
                ),
            ),
        ),
        class_name="flex w-full flex-col gap-8",
    )


def _footer_actions() -> rx.Component:
    return rx.el.div(
        rx.cond(
            OnboardingState.step > 1,
            rx.el.button(
                rx.icon("arrow-left", class_name="h-4 w-4"),
                "Back",
                type="button",
                on_click=OnboardingState.previous_step,
                class_name=GHOST_BUTTON,
            ),
            rx.el.div(class_name="hidden sm:block"),
        ),
        rx.el.div(
            rx.cond(
                OnboardingState.step > 1,
                rx.el.button(
                    "Skip for now",
                    type="button",
                    on_click=OnboardingState.submit_profile,
                    class_name="w-fit rounded-xl px-4 py-3 text-sm font-semibold text-stone-400 transition-colors hover:text-stone-100",
                ),
                rx.fragment(),
            ),
            rx.cond(
                OnboardingState.step < OnboardingState.total_steps,
                rx.el.button(
                    "Continue",
                    rx.icon("arrow-right", class_name="h-4 w-4"),
                    type="button",
                    on_click=OnboardingState.next_step,
                    class_name=f"{PRIMARY_BUTTON} sm:w-fit",
                ),
                rx.el.button(
                    rx.cond(
                        OnboardingState.is_saving,
                        "Saving\u2026",
                        "Enter the studio",
                    ),
                    type="button",
                    disabled=OnboardingState.is_saving,
                    on_click=OnboardingState.submit_profile,
                    class_name=f"{PRIMARY_BUTTON} sm:w-fit",
                ),
            ),
            class_name="flex w-full flex-col-reverse items-stretch gap-3 sm:w-fit sm:flex-row sm:items-center",
        ),
        class_name="mt-8 flex flex-col-reverse gap-3 border-t border-white/10 pt-6 sm:flex-row sm:items-center sm:justify-between",
    )


def onboarding_page() -> rx.Component:
    return rx.el.main(
        rx.el.header(
            wordmark(),
            rx.el.button(
                rx.icon("log-out", class_name="h-4 w-4"),
                "Back to Lyric Book",
                on_click=AuthState.back_to_lyric_book,
                class_name="flex w-fit items-center gap-2 text-sm font-semibold text-stone-400 transition-colors hover:text-stone-100",
            ),
            class_name="flex w-full items-center justify-between border-b border-white/5 px-6 py-5 sm:px-10",
        ),
        rx.el.section(
            rx.el.div(
                rx.el.p(
                    OnboardingState.progress_label,
                    class_name="text-xs font-semibold uppercase tracking-[0.2em] text-violet-300",
                ),
                rx.el.h1(
                    "Set up your release control room.",
                    class_name="mt-3 text-3xl font-semibold tracking-tight text-stone-50 sm:text-4xl",
                ),
                rx.el.p(
                    "Three short steps. Only your artist name and genre are required \u2014 everything else can wait.",
                    class_name="mt-3 max-w-xl text-base font-medium leading-relaxed text-stone-400",
                ),
                rx.el.div(
                    rx.el.div(
                        class_name="h-full rounded-full bg-violet-400 transition-all",
                        style={"width": f"{OnboardingState.progress_percent}%"},
                    ),
                    class_name="mt-8 h-1.5 w-full overflow-hidden rounded-full bg-white/10",
                ),
                class_name="w-full",
            ),
            rx.el.div(
                rx.cond(
                    OnboardingState.error != "",
                    rx.el.div(
                        alert(OnboardingState.error), class_name="mb-6 w-full"
                    ),
                    rx.fragment(),
                ),
                rx.match(
                    OnboardingState.step,
                    (1, _step_one()),
                    (2, _step_two()),
                    _step_three(),
                ),
                _footer_actions(),
                class_name=f"mt-8 {CARD}",
            ),
            waveform("mt-12 opacity-60"),
            class_name="mx-auto w-full max-w-3xl px-6 py-12 sm:px-10",
        ),
        class_name="font-['Inter'] min-h-dvh w-full bg-stone-950",
    )
