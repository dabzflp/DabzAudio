import reflex as rx

from droppilot_release_manager import lyric_bridge

from droppilot_release_manager.components.brand import wordmark
from droppilot_release_manager.states.auth_state import AuthState
from droppilot_release_manager.states.shell_state import NavLink, ShellState

ACTIVE_LINK = (
    "flex w-full items-center gap-3 rounded-xl border border-violet-400/30 "
    "bg-violet-400/10 px-3 py-2.5 text-sm font-semibold text-violet-100 "
    "transition-colors"
)
IDLE_LINK = (
    "flex w-full items-center gap-3 rounded-xl border border-transparent "
    "px-3 py-2.5 text-sm font-medium text-stone-400 transition-colors "
    "hover:border-white/10 hover:bg-white/[0.04] hover:text-stone-100"
)


def _nav_item(item: NavLink, active: str) -> rx.Component:
    return rx.el.a(
        rx.icon(item["icon"], class_name="h-4 w-4 shrink-0"),
        rx.cond(
            ShellState.collapsed,
            rx.fragment(),
            rx.el.span(item["label"], class_name="truncate"),
        ),
        href=item["href"],
        title=item["label"],
        class_name=rx.cond(item["href"] == active, ACTIVE_LINK, IDLE_LINK),
    )


def _drawer_item(item: NavLink, active: str) -> rx.Component:
    return rx.el.a(
        rx.icon(item["icon"], class_name="h-4 w-4 shrink-0"),
        rx.el.span(item["label"]),
        href=item["href"],
        on_click=ShellState.close_drawer,
        class_name=rx.cond(item["href"] == active, ACTIVE_LINK, IDLE_LINK),
    )


def _lyric_group(item_fn, active: str) -> rx.Component:
    return rx.el.div(
        rx.cond(
            ShellState.collapsed,
            rx.el.div(class_name="mx-3 my-2 border-t border-white/10"),
            rx.el.p(
                "Lyric Book",
                class_name="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-stone-500",
            ),
        ),
        rx.foreach(ShellState.lyric_links, lambda item: item_fn(item, active)),
        class_name="flex flex-col gap-1.5",
    )


def _sidebar(active: str) -> rx.Component:
    return rx.el.aside(
        rx.el.div(
            rx.cond(
                ShellState.collapsed,
                rx.el.div(
                    rx.icon("play", class_name="h-3.5 w-3.5 text-stone-950"),
                    class_name="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-400",
                ),
                wordmark(),
            ),
            rx.el.button(
                rx.icon(
                    rx.cond(
                        ShellState.collapsed,
                        "chevrons-right",
                        "chevrons-left",
                    ),
                    class_name="h-4 w-4",
                ),
                on_click=ShellState.toggle_collapsed,
                aria_label="Collapse navigation",
                class_name="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/10 text-stone-400 transition-colors hover:border-violet-400/40 hover:text-stone-100",
            ),
            class_name="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-white/5 px-4",
        ),
        rx.el.nav(
            rx.foreach(
                ShellState.nav_links, lambda item: _nav_item(item, active)
            ),
            _lyric_group(_nav_item, active),
            class_name="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-1.5 overflow-y-auto p-3",
        ),
        rx.el.div(
            rx.cond(
                ShellState.collapsed,
                rx.fragment(),
                rx.el.p(
                    "DropPilot plans and runs your rollout. It never distributes your music.",
                    class_name="text-xs font-medium leading-relaxed text-stone-500",
                ),
            ),
            class_name="shrink-0 border-t border-white/5 p-4",
        ),
        class_name=rx.cond(
            ShellState.collapsed,
            "hidden h-full w-20 shrink-0 flex-col border-r border-white/5 bg-white/[0.02] lg:flex",
            "hidden h-full w-64 shrink-0 flex-col border-r border-white/5 bg-white/[0.02] lg:flex",
        ),
    )


def _notifications_menu() -> rx.Component:
    return rx.el.div(
        rx.el.div(
            rx.el.p(
                "Notifications",
                class_name="text-sm font-semibold text-stone-100",
            ),
            rx.el.button(
                "Mark all read",
                on_click=ShellState.mark_all_read,
                class_name="w-fit text-xs font-semibold text-violet-300 transition-colors hover:text-violet-200",
            ),
            class_name="flex items-center justify-between gap-4 border-b border-white/5 px-4 py-3",
        ),
        rx.cond(
            ShellState.notifications.length() > 0,
            rx.el.div(
                rx.foreach(
                    ShellState.notifications,
                    lambda n: rx.el.div(
                        rx.el.p(
                            n["title"],
                            class_name="text-sm font-semibold text-stone-100",
                        ),
                        rx.el.p(
                            n["message"],
                            class_name="mt-1 text-xs font-medium leading-relaxed text-stone-400",
                        ),
                        class_name=rx.cond(
                            n["is_read"],
                            "border-b border-white/5 px-4 py-3",
                            "border-b border-white/5 bg-violet-400/[0.06] px-4 py-3",
                        ),
                    ),
                ),
                class_name="max-h-72 overflow-y-auto",
            ),
            rx.el.p(
                "Nothing yet. Campaign reminders will appear here.",
                class_name="px-4 py-6 text-sm font-medium text-stone-500",
            ),
        ),
        class_name="absolute right-0 top-12 z-40 w-80 overflow-hidden rounded-2xl border border-white/10 bg-stone-900",
    )


def _profile_menu() -> rx.Component:
    return rx.el.div(
        rx.el.div(
            rx.el.p(
                AuthState.display_name,
                class_name="truncate text-sm font-semibold text-stone-100",
            ),
            rx.el.p(
                AuthState.email,
                class_name="mt-0.5 truncate text-xs font-medium text-stone-500",
            ),
            class_name="border-b border-white/5 px-4 py-3",
        ),
        rx.el.div(
            rx.icon("sparkles", class_name="h-4 w-4 text-violet-300"),
            rx.el.span(AuthState.credits, " AI credits"),
            class_name="flex items-center gap-2 px-4 py-3 text-sm font-medium text-stone-300",
        ),
        rx.el.a(
            rx.icon("credit-card", class_name="h-4 w-4"),
            "Plan & credits",
            href=lyric_bridge.app_url("subscription.html"),
            class_name="flex items-center gap-2 px-4 py-3 text-sm font-medium text-stone-300 transition-colors hover:bg-white/[0.04] hover:text-stone-50",
        ),
        rx.el.button(
            rx.icon("arrow-left", class_name="h-4 w-4"),
            "Back to Lyric Book",
            on_click=AuthState.back_to_lyric_book,
            class_name="flex w-full items-center gap-2 border-t border-white/5 px-4 py-3 text-sm font-semibold text-stone-100 transition-colors hover:bg-violet-400/10",
        ),
        class_name="absolute right-0 top-12 z-40 w-64 overflow-hidden rounded-2xl border border-white/10 bg-stone-900",
    )


def _top_bar() -> rx.Component:
    return rx.el.header(
        rx.el.button(
            rx.icon("menu", class_name="h-5 w-5"),
            on_click=ShellState.toggle_drawer,
            aria_label="Open navigation",
            class_name="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 text-stone-300 transition-colors hover:border-violet-400/40 lg:hidden",
        ),
        rx.el.form(
            rx.el.div(
                rx.icon(
                    "search",
                    class_name="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500",
                ),
                rx.el.input(
                    name="q",
                    placeholder="Search your releases",
                    default_value=ShellState.search_query,
                    key=ShellState.search_query,
                    class_name="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2.5 pl-9 pr-3 text-sm font-medium text-stone-50 placeholder:text-stone-500 outline-hidden transition-colors focus:border-violet-400 focus:ring-2 focus:ring-violet-400/30",
                ),
                class_name="relative w-full",
            ),
            rx.el.button(type="submit", class_name="hidden"),
            on_submit=ShellState.submit_search,
            class_name="w-full max-w-md",
        ),
        rx.el.div(
            rx.el.div(
                rx.el.button(
                    rx.icon("bell", class_name="h-5 w-5"),
                    rx.cond(
                        ShellState.unread_count > 0,
                        rx.el.span(
                            ShellState.unread_count,
                            class_name="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-400 px-1 text-[10px] font-bold text-stone-950",
                        ),
                        rx.fragment(),
                    ),
                    on_click=ShellState.toggle_notifications,
                    aria_label="Notifications",
                    class_name="relative flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 text-stone-300 transition-colors hover:border-violet-400/40 hover:text-stone-50",
                ),
                rx.cond(
                    ShellState.notifications_open,
                    _notifications_menu(),
                    rx.fragment(),
                ),
                class_name="relative",
            ),
            rx.el.div(
                rx.el.button(
                    rx.el.span(
                        AuthState.initials,
                        class_name="text-xs font-bold text-stone-950",
                    ),
                    on_click=ShellState.toggle_profile,
                    aria_label="Account menu",
                    class_name="flex h-10 w-10 items-center justify-center rounded-full bg-violet-400 transition-colors hover:bg-violet-300",
                ),
                rx.cond(
                    ShellState.profile_open, _profile_menu(), rx.fragment()
                ),
                class_name="relative",
            ),
            class_name="flex shrink-0 items-center gap-2.5",
        ),
        class_name="flex h-16 w-full shrink-0 items-center gap-3 border-b border-white/5 bg-stone-950/80 px-4 sm:px-6",
    )


def _drawer(active: str) -> rx.Component:
    return rx.el.div(
        rx.el.div(
            on_click=ShellState.close_drawer,
            class_name="absolute inset-0 bg-stone-950/70",
        ),
        rx.el.div(
            rx.el.div(
                wordmark(),
                rx.el.button(
                    rx.icon("x", class_name="h-4 w-4"),
                    on_click=ShellState.close_drawer,
                    aria_label="Close navigation",
                    class_name="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 text-stone-300",
                ),
                class_name="flex h-16 items-center justify-between border-b border-white/5 px-4",
            ),
            rx.el.nav(
                rx.foreach(
                    ShellState.nav_links,
                    lambda item: _drawer_item(item, active),
                ),
                _lyric_group(_drawer_item, active),
                class_name="flex flex-1 flex-col gap-1.5 overflow-y-auto p-3",
            ),
            class_name="relative z-10 flex h-full w-72 max-w-[85vw] flex-col border-r border-white/10 bg-stone-900",
        ),
        class_name="fixed inset-0 z-50 flex lg:hidden",
    )


def _bottom_nav(active: str) -> rx.Component:
    return rx.el.nav(
        rx.foreach(
            ShellState.mobile_links,
            lambda item: rx.el.a(
                rx.icon(item["icon"], class_name="h-5 w-5"),
                rx.el.span(
                    item["label"], class_name="text-[11px] font-semibold"
                ),
                href=item["href"],
                class_name=rx.cond(
                    item["href"] == active,
                    "flex flex-1 flex-col items-center gap-1 rounded-xl py-2 text-violet-200",
                    "flex flex-1 flex-col items-center gap-1 rounded-xl py-2 text-stone-500 transition-colors hover:text-stone-200",
                ),
            ),
        ),
        rx.el.button(
            rx.icon("menu", class_name="h-5 w-5"),
            rx.el.span("More", class_name="text-[11px] font-semibold"),
            on_click=ShellState.toggle_drawer,
            class_name="flex flex-1 flex-col items-center gap-1 rounded-xl py-2 text-stone-500 transition-colors hover:text-stone-200",
        ),
        class_name="flex w-full shrink-0 items-stretch gap-1 border-t border-white/5 bg-stone-950 px-2 pb-1 lg:hidden",
    )


def _read_only_banner() -> rx.Component:
    return rx.el.div(
        rx.icon("lock", class_name="h-4 w-4 shrink-0 text-orange-200"),
        rx.el.p(
            "Your Pro plan is not active. You can still view your campaigns, but changes and new AI generations are paused.",
            class_name="text-sm font-medium text-orange-100",
        ),
        rx.el.a(
            "Renew Pro",
            href=lyric_bridge.app_url("subscription.html"),
            class_name="ml-auto shrink-0 rounded-full bg-orange-400 px-3 py-1 text-xs font-semibold text-stone-950",
        ),
        class_name="flex items-center gap-3 border-b border-orange-400/30 bg-orange-400/10 px-4 py-2.5",
    )


def app_shell(
    *children: rx.Component, active: str = "/dashboard"
) -> rx.Component:
    return rx.el.div(
        _sidebar(active),
        rx.el.div(
            _top_bar(),
            rx.cond(AuthState.read_only, _read_only_banner(), rx.fragment()),
            rx.el.main(
                *children,
                class_name="w-full min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8",
            ),
            _bottom_nav(active),
            class_name="flex h-full min-w-0 flex-1 flex-col",
        ),
        rx.cond(ShellState.drawer_open, _drawer(active), rx.fragment()),
        class_name="font-['Inter'] flex h-dvh w-full overflow-hidden bg-stone-950",
    )
