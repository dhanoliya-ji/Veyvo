"""Small periodic jobs (letter delivery notices, squad night reminders). Runs inside each API instance."""

import asyncio

from app.core.logging import logger

INTERVAL_SECONDS = 60


async def tick() -> None:
    """One pass of every periodic job. Each job must be idempotent (safe to run on several instances)."""


async def run_forever() -> None:
    while True:
        try:
            await tick()
        except Exception:
            logger.exception("scheduler_tick_failed")
        await asyncio.sleep(INTERVAL_SECONDS)
