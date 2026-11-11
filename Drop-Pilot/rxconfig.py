import reflex as rx
import reflex_xy

config = rx.Config(
    app_name="droppilot_release_manager",
    plugins=[
        rx.plugins.SitemapPlugin(),
        rx.plugins.TailwindV4Plugin(),
        reflex_xy.XYPlugin(),
    ],
)
