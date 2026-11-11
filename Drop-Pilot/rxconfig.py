import os
from pathlib import Path

import reflex as rx
import reflex_xy
from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"))

database_url = os.environ.get("DATABASE_URL", "sqlite:///reflex.db")
if database_url.startswith("postgres://"):
    database_url = "postgresql+psycopg://" + database_url.removeprefix("postgres://")
elif database_url.startswith("postgresql://"):
    database_url = "postgresql+psycopg://" + database_url.removeprefix("postgresql://")

async_database_url = database_url
if database_url.startswith("sqlite:///"):
    async_database_url = "sqlite+aiosqlite:" + database_url.removeprefix("sqlite:")

config = rx.Config(
    app_name="droppilot_release_manager",
    db_url=database_url,
    async_db_url=async_database_url,
    plugins=[
        rx.plugins.SitemapPlugin(),
        rx.plugins.TailwindV4Plugin(),
        reflex_xy.XYPlugin(),
    ],
)
