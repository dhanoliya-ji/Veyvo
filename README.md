# Veyvo

**Meet your people. Find your vibe. Hang out together.**

Veyvo is a privacy-first social hangout app for adults (18+). People meet through shared interests, hang out in voice, video and text rooms, play real multiplayer games together, and make friends. Profiles use real photos, which are moderated and served privately. An optional selfie check gives people a verified badge.

| | |
|---|---|
| **Mobile** | React Native · Expo SDK 57 · Expo Router · TypeScript · TanStack Query · Zustand · Reanimated |
| **Backend** | Python 3.11+ · FastAPI · SQLAlchemy 2 (async) · Alembic · PostgreSQL · Redis · WebSockets |
| **Voice & video** | LiveKit (WebRTC). The backend issues short-lived room tokens after permission checks. |
| **Target** | Android / Google Play first (iOS-ready via Expo) |

## What's inside

- **Accounts**: email sign-up with an 18+ check (the birth date is checked and then discarded), email verification, password reset, rotating refresh tokens with reuse detection, and sign-out on all devices.
- **Profiles**: up to 6 photos. Each photo is re-encoded (EXIF and GPS removed), checked by image moderation and stored in a private bucket behind short-lived signed URLs. Profiles also have interests, vibe status, levels and kudos. Optional **selfie verification** adds a verified badge, and the selfie is deleted right after review.
- **Privacy controls**: who can see your photos, profile visibility, search discoverability, who can send requests, invite or message you, online status (which also controls read receipts), message previews (off by default), data export and account deletion (in the app and on the web).
- **Friends & chat**: friend requests, 1-to-1 messages between friends only, real-time delivery, typing indicators, read receipts, optimistic sending with retry, pagination. **Private video calls** between friends.
- **Hangouts**: public or invite-only rooms in voice, video or text. Rooms have host and moderator controls (mute, camera off, remove), room chat, reactions, invites, scheduled events shown in local time, and study rooms with a shared Pomodoro timer.
- **Video safety**:
  - Cameras are off by default.
  - Using your camera with non-friends requires a verified selfie.
  - Video from non-friends only downloads when you tap to show it.
  - Every video tile has report and block.
  - In public rooms, **automatic live checks** take a still frame every few seconds, moderate it, and switch off unsafe cameras with evidence sent to moderators.
- **Games** (server-authoritative, so moves are validated on the server and hidden cards are never sent to the wrong player): **Chess, Ludo, Crazy Eights, Four in a Row, Truth or Dare, Werewolf**. Hosts can set house rules in the lobby. Also included: the **Daily Question** and **Icebreaker Match**, where a friendship is created only if both people choose to connect.
- **Healthy engagement**: first-week quests, a forgiving streak with freeze days, friendship levels, Moments, events, leagues, and gems that unlock game themes (chess boards, card backs, Ludo boards).
- **Money**: rewarded ads (AdMob with server-side verification), gem packs and **Veyvo Plus** through Google Play Billing. All of it is verified on the server.
- **Safety**: report anything, block anyone, leave instantly, a moderation queue with photo, verification and report reviews plus an audit log, suspensions and bans enforced on every request, rate limiting, retention purges, and Google Play's required legal pages.

## Repository layout

```
Veyvo/
├── backend/            FastAPI service (API, WebSockets, migrations, tests)
│   ├── app/
│   │   ├── api/        dependencies + versioned routes (/api/v1/...)
│   │   ├── core/       config, database, security, storage, logging, errors, ephemeral store
│   │   ├── games/      pure game engines (chess, ludo, crazy eights, four in a row, truth or dare, werewolf)
│   │   ├── models/     SQLAlchemy models
│   │   ├── schemas/    Pydantic request/response models
│   │   ├── services/   business logic (auth, rooms, games, photos, live moderation, billing, ...)
│   │   ├── websocket/  realtime hub + WS endpoint
│   │   ├── content/    interests, game themes, quests, daily content
│   │   └── web/        legal pages + web account deletion
│   ├── migrations/     Alembic
│   ├── scripts/        seed_dev.py (dev only), set_role.py
│   └── tests/          pytest suite
├── mobile/             Expo app
│   └── src/
│       ├── app/        Expo Router routes (screens)
│       ├── api/        typed API hooks (TanStack Query)
│       ├── components/ UI kit, photos, video grid, game boards, cards, safety
│       ├── hooks/      realtime sync, push notifications
│       ├── lib/        api client, realtime client, voice/video, ads, billing, formatting
│       ├── stores/     Zustand stores (session, preferences, toasts)
│       └── theme/      design tokens + theme provider
├── docs/               architecture, privacy, realtime contract, deployment, testing
├── render.yaml         one-click hosting on Render (API + PostgreSQL + Redis)
└── docker-compose.yml  PostgreSQL + Redis for local development
```

## Quick start (local development)

### 1. Backend

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env                 # defaults work out of the box (SQLite, no Redis, local photo storage)
alembic upgrade head
python -m scripts.seed_dev           # optional demo data (dev only)
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

- Health check: http://localhost:8000/api/v1/health
- Interactive API docs (development only): http://localhost:8000/docs
- `--host 0.0.0.0` matters: it lets a phone on your Wi-Fi reach the server.
- In development, photos are saved under `backend/media/` and auto-approved (`MODERATION_PROVIDER=none`).

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

- **Use a development build.** Voice, video, the camera, ads, billing and push all need native modules, so Expo Go only covers the basics. Build the dev client once (and again whenever native modules change):
  ```bash
  npx eas-cli@latest build --profile development --platform android
  ```
  Install the APK on your phone, run `npx expo start`, and open the project from the Veyvo dev app.
- **API address on a physical device**: create `mobile/.env` with `EXPO_PUBLIC_API_URL=http://<your-computer-LAN-IP>:8000`. `localhost` on a phone means the phone itself. The phone and computer must be on the same network, and your firewall must allow port 8000.

A full step-by-step device testing checklist is in [docs/testing.md](docs/testing.md).

### 3. Tests and checks

```bash
cd backend && python -m pytest -q        # backend test suite
cd backend && ruff check .               # lint
cd mobile  && npx tsc --noEmit           # typecheck
cd mobile  && npx expo lint              # lint
cd mobile  && npx jest                   # unit tests
cd mobile  && npx expo-doctor            # dependency health
```

## Staff accounts

There's no default admin account. Create a normal account in the app, then grant the role from the server:

```bash
cd backend && python -m scripts.set_role you@example.com admin
```

Moderators and admins get a **Moderation** entry under Profile, with queues for reports, photos and selfie verifications. Every privileged action is checked on the server and written to the audit log.

## External services

| Service | Needed for | Variables |
|---|---|---|
| PostgreSQL | Production database | `DATABASE_URL` |
| Redis | Presence, rate limits, multi-instance realtime | `REDIS_URL` |
| LiveKit (Cloud or self-hosted) | Voice and video | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` |
| S3-compatible bucket (Cloudflare R2, AWS S3) | Private photo storage, live-video snapshots | `STORAGE_BACKEND=s3`, `S3_*` |
| Sightengine | Photo, selfie and live-video moderation | `MODERATION_PROVIDER=sightengine`, `SIGHTENGINE_*`, `LIVE_VIDEO_MODERATION` |
| Resend | Verification and password-reset emails | `RESEND_API_KEY`, `EMAIL_FROM` |
| AdMob | Rewarded ads | `ADMOB_ENABLED`, app ID in `app.json` |
| Google Play Billing | Gem packs, Veyvo Plus | `GOOGLE_PLAY_SERVICE_ACCOUNT`, `GOOGLE_RTDN_TOKEN` |
| Expo / EAS | Builds and push notifications | EAS project ID, `EXPO_PUBLIC_API_URL`, `EXPO_PUSH_ACCESS_TOKEN` |

Without LiveKit, voice and video rooms show a clear "voice isn't set up" state and still work as text rooms. Without billing credentials, the store says purchases aren't available. Nothing is faked.

## Documentation

- [docs/architecture.md](docs/architecture.md): how the pieces fit together
- [docs/privacy.md](docs/privacy.md): data inventory, retention, deletion and security
- [docs/realtime.md](docs/realtime.md): WebSocket protocol and event contract
- [docs/deployment.md](docs/deployment.md): hosting on Render, external services, Android builds, Play Store checklist
- [docs/testing.md](docs/testing.md): step-by-step testing on a real phone
- [docs/roadmap.md](docs/roadmap.md): what's next
