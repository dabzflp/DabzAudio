import reflex as rx

from droppilot_release_manager.components.brand import waveform, wordmark

INPUT_CLASS = (
    "w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 "
    "text-base font-medium text-stone-50 placeholder:text-stone-500 "
    "outline-hidden transition-colors focus:border-violet-400 "
    "focus:ring-2 focus:ring-violet-400/30"
)

PRIMARY_BUTTON = (
    "flex w-full items-center justify-center gap-2 rounded-xl bg-violet-400 "
    "px-5 py-3 text-base font-semibold text-stone-950 transition-colors "
    "hover:bg-violet-300 disabled:cursor-not-allowed disabled:opacity-60"
)

GHOST_BUTTON = (
    "flex w-fit items-center justify-center gap-2 rounded-xl border "
    "border-white/10 px-5 py-3 text-sm font-semibold text-stone-200 "
    "transition-colors hover:border-violet-400/50 hover:text-white"
)


def text_field(
    label: str,
    name: str,
    placeholder: str,
    input_type: str = "text",
    *,
    required: bool = True,
    helper: str = "",
    trailing: rx.Component | None = None,
) -> rx.Component:
    return rx.el.div(
        rx.el.div(
            rx.el.label(
                label,
                html_for=name,
                class_name="text-sm font-semibold text-stone-200",
            ),
            trailing,
            class_name="flex items-center justify-between gap-4",
        ),
        rx.el.input(
            id=name,
            name=name,
            type=input_type,
            placeholder=placeholder,
            required=required,
            auto_complete="on",
            class_name=f"mt-2 {INPUT_CLASS}",
        ),
        rx.cond(
            helper != "",
            rx.el.p(
                helper, class_name="mt-2 text-xs font-medium text-stone-500"
            ),
            rx.fragment(),
        ),
        class_name="w-full",
    )


def _side_point(icon: str, title: str, body: str) -> rx.Component:
    return rx.el.li(
        rx.el.div(
            rx.icon(icon, class_name="h-4 w-4 text-violet-300"),
            class_name="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-400/10",
        ),
        rx.el.div(
            rx.el.p(title, class_name="text-sm font-semibold text-stone-100"),
            rx.el.p(
                body,
                class_name="mt-1 text-sm font-medium leading-relaxed text-stone-400",
            ),
            class_name="min-w-0",
        ),
        class_name="flex items-start gap-3",
    )


def auth_aside() -> rx.Component:
    return rx.el.aside(
        rx.el.div(
            wordmark(),
            rx.el.h2(
                "Run every release like a mission.",
                class_name="mt-12 max-w-md text-3xl font-semibold leading-tight tracking-tight text-stone-50 lg:text-4xl",
            ),
            rx.el.p(
                "DropPilot is the control room for independent artists: a 21-day rollout plan, pitch drafts, a press kit and the numbers that matter \u2014 all in one calm workspace.",
                class_name="mt-5 max-w-md text-base font-medium leading-relaxed text-stone-400",
            ),
            rx.el.ul(
                _side_point(
                    "list-checks",
                    "A plan, not a to-do pile",
                    "Day-by-day content built around your release date.",
                ),
                _side_point(
                    "send",
                    "Pitches that get opened",
                    "Playlist, blog and radio drafts ready to send.",
                ),
                _side_point(
                    "trending-up",
                    "Progress you can see",
                    "Track streams, saves and follows release over release.",
                ),
                class_name="mt-10 flex flex-col gap-6",
            ),
            waveform("mt-14 opacity-80"),
            class_name="flex w-full flex-col",
        ),
        class_name="hidden w-full flex-col justify-center border-r border-white/5 bg-white/[0.02] px-10 py-16 lg:flex lg:w-1/2 lg:px-16",
    )


def auth_shell(
    title: str,
    subtitle: str,
    *children: rx.Component,
    footer: rx.Component | None = None,
) -> rx.Component:
    return rx.el.main(
        auth_aside(),
        rx.el.section(
            rx.el.div(
                wordmark("mb-10 lg:hidden"),
                rx.el.h1(
                    title,
                    class_name="text-3xl font-semibold tracking-tight text-stone-50",
                ),
                rx.el.p(
                    subtitle,
                    class_name="mt-3 text-base font-medium leading-relaxed text-stone-400",
                ),
                rx.el.div(*children, class_name="mt-8 flex flex-col gap-5"),
                footer,
                class_name="w-full max-w-md",
            ),
            class_name="flex w-full flex-1 items-center justify-center px-6 py-16 sm:px-10 lg:w-1/2",
        ),
        class_name="font-['Inter'] flex min-h-dvh w-full flex-col bg-stone-950 lg:flex-row",
    )
