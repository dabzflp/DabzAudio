import reflex as rx

from droppilot_release_manager.pages.calendar import calendar_page
from droppilot_release_manager.pages.campaign_detail import campaign_detail_page
from droppilot_release_manager.pages.campaign_new import campaign_new_page
from droppilot_release_manager.pages.campaign_print import campaign_print_page
from droppilot_release_manager.pages.dashboard import dashboard_page
from droppilot_release_manager.pages.epk import epk_page
from droppilot_release_manager.pages.onboarding import onboarding_page
from droppilot_release_manager.pages.pitches import campaign_pitches_page
from droppilot_release_manager.pages.public_epk import public_epk_page
from droppilot_release_manager.pages.releases import releases_page
from droppilot_release_manager.pages.studio_redirect import studio_redirect_page
from droppilot_release_manager.states.auth_state import AuthState
from droppilot_release_manager.states.calendar_state import CalendarState
from droppilot_release_manager.states.campaign_detail_state import CampaignDetailState
from droppilot_release_manager.states.dashboard_state import DashboardState
from droppilot_release_manager.states.epk_state import EPKState
from droppilot_release_manager.states.onboarding_state import OnboardingState
from droppilot_release_manager.states.pitch_state import PitchState
from droppilot_release_manager.states.public_epk_state import PublicEPKState
from droppilot_release_manager.states.releases_state import ReleasesState
from droppilot_release_manager.states.shell_state import ShellState
from droppilot_release_manager.states.wizard_state import WizardState


def index() -> rx.Component:
    """The root has no content of its own: send people to their dashboard."""
    return rx.el.main(on_mount=rx.redirect("/dashboard"))


app = rx.App(
    theme=rx.theme(appearance="dark", accent_color="orange", has_background=False),
    stylesheets=["/dabz-skin.css", "/print.css"],
    head_components=[
        rx.el.script(src="/dabz-theme.js"),
        rx.el.link(rel="preconnect", href="https://fonts.googleapis.com"),
        rx.el.link(
            rel="preconnect",
            href="https://fonts.gstatic.com",
            cross_origin="",
        ),
        rx.el.link(
            href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap",
            rel="stylesheet",
        ),
    ],
)

# Dynamic routes first so they are matched before static siblings.
app.add_page(
    campaign_print_page,
    route="/campaigns/[campaign_id]/print",
    title="Printable campaign plan \u00b7 DropPilot",
    on_load=[AuthState.require_auth, CampaignDetailState.load],
)
app.add_page(
    campaign_pitches_page,
    route="/campaigns/[campaign_id]/pitches",
    title="Pitch workspace \u00b7 DropPilot",
    on_load=[
        AuthState.require_auth,
        ShellState.load_notifications,
        PitchState.load,
    ],
)
app.add_page(
    public_epk_page,
    route="/epk/[slug]",
    title="Press kit \u00b7 DropPilot",
    on_load=PublicEPKState.load,
)
app.add_page(
    campaign_detail_page,
    route="/campaigns/[campaign_id]",
    title="Campaign \u00b7 DropPilot",
    on_load=[
        AuthState.require_auth,
        ShellState.load_notifications,
        CampaignDetailState.load,
    ],
)
app.add_page(
    campaign_new_page,
    route="/campaigns/new",
    title="New campaign \u00b7 DropPilot",
    on_load=[
        AuthState.require_auth,
        ShellState.load_notifications,
        WizardState.check_quota,
    ],
)
app.add_page(
    dashboard_page,
    route="/dashboard",
    title="Overview \u00b7 DropPilot",
    on_load=[
        AuthState.require_auth,
        ShellState.load_notifications,
        DashboardState.load,
    ],
)
app.add_page(
    releases_page,
    route="/releases",
    title="My releases \u00b7 DropPilot",
    on_load=[
        AuthState.require_auth,
        ShellState.load_notifications,
        ReleasesState.load,
    ],
)
app.add_page(
    calendar_page,
    route="/calendar",
    title="Content calendar \u00b7 DropPilot",
    on_load=[
        AuthState.require_auth,
        ShellState.load_notifications,
        CalendarState.load,
    ],
)
app.add_page(
    epk_page,
    route="/epk",
    title="EPK builder \u00b7 DropPilot",
    on_load=[
        AuthState.require_auth,
        ShellState.load_notifications,
        EPKState.load,
    ],
)
app.add_page(
    studio_redirect_page,
    route="/studio",
    title="Studio \u00b7 DropPilot",
)
app.add_page(
    lambda: rx.el.main(
        rx.el.p("Opening Drop Pilot\u2026", class_name="p-8 text-sm"),
    ),
    route="/auth/handoff",
    title="Opening Drop Pilot",
    on_load=AuthState.handoff,
)
app.add_page(
    onboarding_page,
    route="/onboarding",
    title="Set up your studio \u00b7 DropPilot",
    on_load=[
        AuthState.require_auth_allow_onboarding,
        OnboardingState.load_profile,
    ],
)
app.add_page(
    index,
    route="/",
    title="DropPilot \u00b7 Turn one song into 21 days of content",
)
