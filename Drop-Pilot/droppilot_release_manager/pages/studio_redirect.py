import reflex as rx

from droppilot_release_manager.components.brand import wordmark


def studio_redirect_page() -> rx.Component:
    """Compatibility route: /studio now lives at /dashboard."""
    return rx.el.main(
        rx.el.div(
            wordmark(),
            rx.el.p(
                "The studio has moved to your dashboard\u2026",
                class_name="mt-6 text-sm font-medium text-stone-400",
            ),
            rx.el.a(
                "Go to dashboard",
                href="/dashboard",
                class_name="mt-6 flex w-fit items-center rounded-xl bg-violet-400 px-5 py-3 text-sm font-semibold text-stone-950 transition-colors hover:bg-violet-300",
            ),
            class_name="flex flex-col items-start",
        ),
        on_mount=rx.redirect("/dashboard"),
        class_name="font-['Inter'] flex min-h-dvh w-full items-center justify-center bg-stone-950 px-6",
    )
