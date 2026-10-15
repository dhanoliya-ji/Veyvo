"""Small periodic jobs (letter delivery notices, squad night reminders, friendship anniversaries). Runs inside each API instance."""

import asyncio

from app.core.database import session_factory
from app.core.logging import logger

INTERVAL_SECONDS = 60


async def tick() -> None:
    """One pass of every periodic job. Each job must be idempotent (safe to run on several instances)."""
    from app.services import letters, milestones, squads

    jobs = (
        ("letters_delivery", letters.notify_deliveries),
        ("squad_reminders", squads.send_reminders),
        ("squad_streaks", squads.tick_streaks),
        ("friend_anniversaries", milestones.send_anniversaries),
    )
    for name, job in jobs:
        # A fresh session per job, so one failing job never blocks the others.
        try:
            async with session_factory()() as db:
                await job(db)
        except Exception:
            logger.exception("scheduler_job_failed", extra={"job": name})


async def run_forever() -> None:
    while True:
        try:
            await tick()
        except Exception:
            logger.exception("scheduler_tick_failed")
        await asyncio.sleep(INTERVAL_SECONDS)
