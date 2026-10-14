"""Seed demo data for LOCAL DEVELOPMENT ONLY.

Creates a handful of demo accounts, communities and scheduled hangouts so the app isn't empty
while you build. Refuses to run when APP_ENV=production. Demo accounts all use the password
printed at the end. Never run this against a real database.

    python -m scripts.seed_dev
"""

import asyncio
import random
import sys
from datetime import timedelta

from sqlalchemy import select

from app.content.catalog import AVATAR_OPTIONS, DEFAULT_AVATAR
from app.core.config import get_settings
from app.core.database import session_factory, utcnow
from app.core.security import hash_password
from app.main import sync_interests
from app.models import Community, CommunityMember, Friendship, Interest, PrivacySettings, Profile, Room, RoomMember, User, UserInterest
from app.services.rewards import init_quests
from app.services.users import ordered_pair

PASSWORD = "veyvo-demo-123"
PEOPLE = [
    ("maya_draws", "Maya", "Sketchbook always open. Ask me about watercolors.", ["art", "anime", "music"]),
    ("leo.codes", "Leo", "Backend dev by day, board game nerd by night.", ["programming", "board-games", "coworking"]),
    ("amara_reads", "Amara", "Two books a month. Currently: sci-fi.", ["books", "writing", "deep-talks"]),
    ("kenji_plays", "Kenji", "Strategy games and lofi beats.", ["gaming", "music", "esports"]),
    ("sofia.runs", "Sofía", "Marathon in training. Coffee enthusiast.", ["running", "fitness", "travel"]),
    ("dev_ravi", "Ravi", "Studying for exams. Pomodoro buddy wanted!", ["study", "technology", "cricket"]),
    ("chloe_cooks", "Chloé", "Home cook, plant parent, terrible at trivia.", ["cooking", "plants", "trivia"]),
    ("omar.films", "Omar", "Film buff. Will recommend you a movie.", ["movies", "podcasts", "just-chatting"]),
]
COMMUNITIES = [
    ("Night Owls Lounge", "night-owls", "For everyone awake at odd hours. Calm chats, good vibes."),
    ("Study Together", "study", "Silent focus sessions and exam support across time zones."),
    ("Board & Party Games", "board-games", "Trivia nights, doodle battles and game recommendations."),
    ("Bookworms", "books", "Monthly picks, spoiler-tagged discussions and cosy reading rooms."),
    ("Lofi & Chill", "music", "Share what you're listening to and hang out."),
]


async def main() -> None:
    settings = get_settings()
    if settings.is_production or settings.app_env == "production":
        sys.exit("Refusing to seed demo data in production.")
    await sync_interests()
    rng = random.Random(7)
    async with session_factory()() as db:
        interests = {i.slug: i for i in await db.scalars(select(Interest))}
        users: list[User] = []
        for username, name, bio, tags in PEOPLE:
            existing = await db.scalar(select(Profile).where(Profile.username == username))
            if existing:
                users.append(await db.get(User, existing.user_id))
                continue
            avatar = dict(DEFAULT_AVATAR)
            for key in ("skin", "hairColor", "outfitColor", "bg", "eyes"):
                avatar[key] = rng.choice(AVATAR_OPTIONS[key])
            avatar["hair"] = rng.choice(["curlyTop", "bob", "short", "long", "bun", "buzz", "afro", "braids"])
            avatar["outfit"] = rng.choice(["tee", "hoodie", "collar", "sweater"])
            avatar["accessory"] = rng.choice(["none", "glasses", "headphones"])
            user = User(
                email=f"{username.replace('.', '_')}@example.com", password_hash=hash_password(PASSWORD), email_verified_at=utcnow()
            )
            user.profile = Profile(
                username=username, display_name=name, bio=bio, avatar=avatar, onboarded_at=utcnow(), gems=120, xp=rng.randint(50, 900)
            )
            user.privacy = PrivacySettings(notification_prefs={})
            db.add(user)
            await db.flush()
            await init_quests(db, user.id)
            for tag in tags:
                if tag in interests:
                    db.add(UserInterest(user_id=user.id, interest_id=interests[tag].id))
            users.append(user)
        await db.flush()

        # A few friendships so friend features have something to show.
        for a, b in [(0, 1), (0, 2), (1, 3), (2, 4), (3, 5), (5, 6), (6, 7)]:
            low, high = ordered_pair(users[a].id, users[b].id)
            if not await db.scalar(select(Friendship.id).where(Friendship.user_low_id == low, Friendship.user_high_id == high)):
                db.add(Friendship(user_low_id=low, user_high_id=high, points=rng.randint(5, 80)))

        for i, (name, slug, desc) in enumerate(COMMUNITIES):
            if await db.scalar(select(Community.id).where(Community.name == name)):
                continue
            owner = users[i % len(users)]
            c = Community(
                slug=f"{slug}-demo",
                name=name,
                description=desc,
                interest_id=interests[slug].id,
                owner_id=owner.id,
                rules=["Be kind and respectful.", "Stay on topic.", "No spam."],
            )
            db.add(c)
            await db.flush()
            db.add(CommunityMember(community_id=c.id, user_id=owner.id, role="owner"))
            for other in rng.sample(users, 4):
                if other.id != owner.id:
                    db.add(CommunityMember(community_id=c.id, user_id=other.id))

        # Scheduled (not live) hangouts. Live counts always come from real presence, never seeded.
        titles = [
            ("Trivia Night", "trivia", "cafe"),
            ("Silent Study Hour", "study", "library"),
            ("Late Night Deep Talks", "deep-talks", "rooftop"),
            ("Lofi Listening Party", "music", "campfire"),
        ]
        for hours, (title, tag, scene) in enumerate(titles, start=2):
            if await db.scalar(select(Room.id).where(Room.title == title, Room.status == "scheduled")):
                continue
            host = rng.choice(users)
            room = Room(
                host_id=host.id,
                title=title,
                description="A Veyvo demo event.",
                kind="study" if tag == "study" else "hangout",
                format="voice",
                scene=scene,
                interest_id=interests[tag].id,
                status="scheduled",
                scheduled_for=utcnow() + timedelta(hours=hours),
                timer={"phase": "idle", "focus_minutes": 25, "break_minutes": 5, "cycle": 1} if tag == "study" else {},
            )
            db.add(room)
            await db.flush()
            db.add(RoomMember(room_id=room.id, user_id=host.id, role="host"))
        await db.commit()
    print(f"Seeded {len(PEOPLE)} demo users (password: {PASSWORD}), {len(COMMUNITIES)} communities and scheduled hangouts.")
    print("Demo emails look like maya_draws@example.com")


if __name__ == "__main__":
    asyncio.run(main())
