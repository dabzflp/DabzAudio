import reflex as rx


def _bar(height: str) -> rx.Component:
    return rx.el.span(class_name=f"w-1 rounded-full bg-violet-400/40 {height}")


def waveform(class_name: str = "") -> rx.Component:
    """Sparse static waveform motif built from matte bars."""
    return rx.el.div(
        _bar("h-3"),
        _bar("h-7"),
        _bar("h-12"),
        _bar("h-5"),
        _bar("h-16"),
        _bar("h-9"),
        _bar("h-4"),
        _bar("h-11"),
        _bar("h-6"),
        _bar("h-14"),
        _bar("h-8"),
        _bar("h-3"),
        _bar("h-10"),
        _bar("h-5"),
        _bar("h-13"),
        _bar("h-7"),
        _bar("h-4"),
        _bar("h-9"),
        _bar("h-15"),
        _bar("h-6"),
        _bar("h-3"),
        _bar("h-8"),
        _bar("h-11"),
        _bar("h-4"),
        class_name=f"flex items-end gap-1.5 {class_name}",
    )


def wordmark(class_name: str = "") -> rx.Component:
    return rx.el.a(
        rx.el.div(
            rx.el.span("D\u039b", class_name="dp-logo text-[13px] text-stone-950"),
            class_name="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-400",
            role="img",
            aria_label="DA",
        ),
        rx.el.span(
            "DropPilot",
            class_name="text-lg font-semibold tracking-tight text-stone-50",
        ),
        href="/",
        class_name=f"flex w-fit items-center gap-2.5 {class_name}",
    )


def alert(message: rx.Var | str, tone: str = "error") -> rx.Component:
    styles = {
        "error": "border-rose-400/30 bg-rose-400/10 text-rose-200",
        "success": "border-violet-400/30 bg-violet-400/10 text-violet-100",
    }
    icons = {"error": "circle-alert", "success": "circle-check"}
    return rx.el.div(
        rx.icon(icons[tone], class_name="h-4 w-4 shrink-0"),
        rx.el.p(message, class_name="text-sm font-medium leading-relaxed"),
        class_name=f"flex w-full items-start gap-2.5 rounded-xl border px-4 py-3 {styles[tone]}",
    )
