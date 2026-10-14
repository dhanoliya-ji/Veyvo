# Veyvo

**Meet your people. Find your vibe. Hang out together.**

Veyvo is a privacy-first social hangout app for adults (18+). People meet through shared interests, hang out in voice and text rooms drawn as cosy illustrated scenes, play party games together, and make friends. Everyone appears as a cartoon avatar instead of a photo.

| | |
|---|---|
| **Mobile** | React Native · Expo SDK 57 · Expo Router · TypeScript · TanStack Query · Zustand · Reanimated |
| **Backend** | Python 3.11+ · FastAPI · SQLAlchemy 2 (async) · Alembic · PostgreSQL · Redis · WebSockets |
| **Voice** | LiveKit (WebRTC). The backend issues short-lived room tokens after permission checks. |
| **Target** | Android / Google Play first (iOS-ready via Expo) |

## What's inside

- **Accounts**: email sign-up with an 18+ check (the birth date is checked and then discarded), email verification, password reset, rotating refresh tokens with reuse detection, and sign-out on all devices.
- **Profiles**: cartoon avatar builder (no photo uploads anywhere), interests, vibe status, levels, kudos.
- **Privacy controls**: profile visibility, search discoverability, who can send requests, invite or message you, online status (which also controls read receipts), message previews (off by default), data export and account deletion (in the app and on the web).
- **Friends & chat**: friend requests, 1-to-1 messages between friends only, real-time delivery, typing indicators, read receipts, optimistic sending with retry, pagination.
- **Hangouts**: public or invite-only rooms, voice or text, illustrated scenes, host and moderator controls, room chat, reactions, invites, scheduled events shown in local time, and study rooms with a shared Pomodoro timer.
- **Communities**: public or private groups with a discussion board, member management and community hangouts.
- **Games**: server-authoritative multiplayer **Trivia** and **Doodle & Guess**, plus the **Daily Question**, and **Icebreaker Match**, where a friendship is created only if both people choose to connect.
- **Healthy engagement**: first-week quests, a forgiving streak with freeze days, friendship levels, gems and a cosmetic shop. Gems can only be earned in v1; nothing is sold yet.
- **Safety**: report anything, block anyone, leave instantly, a moderation queue with an audit log, suspensions and bans enforced on every request, rate limiting, retention purges, and Google Play's required legal pages.

## Repository layout

```
Veyvo/
├── backend/            FastAPI service (API, WebSockets, migrations, tests)
│   ├── app/
│   │   ├── api/        dependencies + versioned routes (/api/v1/...)
│   │   ├── core/       config, database, security, logging, errors, ephemeral store
│   │   ├── models/     SQLAlchemy models
│   │   ├── schemas/    Pydantic request/response models
│   │   ├── services/   business logic (auth, rooms, games, moderation, ...)
│   │   ├── websocket/  realtime hub + WS endpoint
│   │   ├── content/    interests, cosmetics, original trivia/doodle/daily content
│   │   └── web/        legal pages + web account deletion
│   ├── migrations/     Alembic
│   ├── scripts/        seed_dev.py (dev only), set_role.py
│   └── tests/          pytest suite
├── mobile/             Expo app
│   └── src/
│       ├── app/        Expo Router routes (screens)
│       ├── api/        typed API hooks (TanStack Query)
│       ├── components/ UI kit, avatar, scenes, cards, safety
│       ├── hooks/      realtime sync, push notifications
│       ├── lib/        api client, realtime client, voice, formatting
│       ├── stores/     Zustand stores (session, preferences, toasts)
│       └── theme/      design tokens + theme provider
├── docs/               architecture, privacy, realtime contract, deployment
└── docker-compose.yml  PostgreSQL + Redis for local development
```

## Quick start (local development)

### 1. Backend

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env                 # defaults work out of the box (SQLite, no Redis)
alembic upgrade head
python -m scripts.seed_dev           # optional demo data (dev only)
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

- Health check: http://localhost:8000/api/v1/health
- Interactive API docs (development only): http://localhost:8000/docs
- `--host 0.0.0.0` matters: it lets a phone on your Wi-Fi reach the server.

**Using PostgreSQL and Redis** (recommended, and required in production):

```bash
docker compose up -d                 # from the repo root
# in backend/.env:
DATABASE_URL=postgresql+asyncpg://veyvo:veyvo@localhost:5432/veyvo
REDIS_URL=redis://localhost:6379/0
alembic upgrade head
```

Demo accounts from `seed_dev.py` use the password `veyvo-demo-123`, e.g. `maya_draws@example.com`.

In development, email verification and reset codes are shown in the app and in the server log, so you don't need an email provider.

### 2. Mobile

```bash
cd mobile
npm install
npx expo start
```

- Open the app on an Android emulator (press `a`) or scan the QR code with **Expo Go** on your phone.
- **API address on a physical device**: the app automatically uses your computer's LAN IP (from Metro) on port 8000, because `localhost` on a phone means the phone itself. To override it, create `mobile/.env` with `EXPO_PUBLIC_API_URL=http://192.168.x.x:8000`. Your phone and computer must be on the same network, and your firewall must allow port 8000.
- **Voice rooms and push notifications need a development build**, not Expo Go:
  ```bash
  npx expo run:android          # local build (Android Studio + SDK required)
  # or: npx eas-cli build --profile development --platform android
  ```
  Everything else (rooms, chat, games, profiles) works in Expo Go.

### 3. Tests and checks

```bash
cd backend && python -m pytest -q        # backend test suite
cd backend && ruff check .               # lint
cd mobile  && npx tsc --noEmit           # typecheck
cd mobile  && npx expo lint              # lint
cd mobile  && npx expo-doctor            # dependency health
```

## Staff accounts

There's no default admin account. Create a normal account in the app, then grant the role from the server:

```bash
cd backend && python -m scripts.set_role you@example.com admin
```

Moderators and admins get a **Moderation** entry under Profile. Every privileged action is checked on the server and written to the audit log.

## External services

| Service | Needed for | Variables |
|---|---|---|
| PostgreSQL | Production database | `DATABASE_URL` |
| Redis | Presence, rate limits, multi-instance realtime | `REDIS_URL` |
| LiveKit (Cloud or self-hosted) | Voice in hangouts | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` |
| Resend | Verification and password-reset emails | `RESEND_API_KEY`, `EMAIL_FROM` |
| Expo / EAS | Builds and push notifications | EAS project ID in `app.json`, optional `EXPO_PUBLIC_API_URL`, `EXPO_PUSH_ACCESS_TOKEN` |

Without LiveKit, voice rooms show a clear "voice isn't set up" state and still work as text rooms. Nothing is faked.

## Documentation

- [docs/architecture.md](docs/architecture.md): how the pieces fit together
- [docs/privacy.md](docs/privacy.md): data inventory, retention, deletion and security
- [docs/realtime.md](docs/realtime.md): WebSocket protocol and event contract
- [docs/deployment.md](docs/deployment.md): production config, Android builds, Play Store checklist
- [docs/roadmap.md](docs/roadmap.md): what's next (avatar face tracking, monetization, more games)
