"""Grant or remove staff roles from the command line (server access required).

There is intentionally no default admin account. Create a normal account in the app, then:

    python -m scripts.set_role someone@example.com admin
    python -m scripts.set_role someone@example.com moderator
    python -m scripts.set_role someone@example.com user
"""

import asyncio
import sys

from sqlalchemy import select

from app.core.database import session_factory
from app.models import ModerationAction, User


async def main(email: str, role: str) -> None:
    if role not in ("user", "moderator", "admin"):
        sys.exit("Role must be one of: user, moderator, admin")
    async with session_factory()() as db:
        user = await db.scalar(select(User).where(User.email == email.strip().lower()))
        if user is None:
            sys.exit("No account with that email.")
        previous = user.role
        user.role = role
        db.add(
            ModerationAction(
                actor_id=None,
                action=f"cli_set_role:{role}",
                target_type="user",
                target_id=str(user.id),
                reason=f"CLI change from {previous}",
            )
        )
        await db.commit()
    print(f"{email}: {previous} -> {role}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    asyncio.run(main(sys.argv[1], sys.argv[2]))
