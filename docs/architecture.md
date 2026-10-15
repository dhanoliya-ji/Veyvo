# Architecture

```
┌──────────────────────────────┐        HTTPS /api/v1/*         ┌─────────────────────────────┐
│  Expo app (React Native)     │ ─────────────────────────────▶ │  FastAPI (N instances)      │
│  TanStack Query cache        │        WSS /api/v1/ws          │  routes → services → models │
│  Zustand (session, prefs)    │ ◀────────────────────────────▶ │  realtime hub, livemod task │
│  LiveKit client (voice/video)│                                └──┬───────────┬──────────┬───┘
└──────────────┬───────────────┘                                   │           │          │
               │ WebRTC (mic + camera, token from API)              │      ┌────▼────┐ ┌───▼───────┐
               ▼                                                    │      │Postgres │ │  Redis    │
       ┌───────────────┐ ◀── server API (mute/camera/kick/close) ───┤      │ durable │ │ presence  │
       │ LiveKit SFU   │ ─── webhooks (camera on/off) ─────────────▶│      │ data    │ │ pub/sub   │
       └───────┬───────┘                                            │      └─────────┘ │ rate limit│
               │ snapshot egress (stills only)                      │                  └───────────┘
               ▼                                                    ▼
       ┌─────────────────────────────────────────────────────────────────┐
       │ Private S3 bucket (photos, selfies, live-video snapshots)       │
       └─────────────────────────────────────────────────────────────────┘
```

## Backend

- **Layers.** `api/routes/*` handle HTTP only (validation and dependencies). Business rules live in `services/*`. Models are in `models/*`, and request/response contracts in `schemas/*`.
- **Auth.**
  - Access tokens are JWTs that last 15 minutes and carry a session id. Refresh tokens are opaque, stored as keyed hashes in `auth_sessions`, and **rotate on every use**. Replaying an old refresh token revokes the session.
  - Every request reloads the user row, so suspensions, bans and role changes apply immediately. Roles are never trusted from the token or the client.
- **Errors.** One shape everywhere: `{"error": {"code", "message", "details?"}}`. Messages are written for end users, and stack traces never leave the server.
- **Ephemeral state** (`core/store.py`). Presence, room occupancy, rate-limit counters, Icebreaker queues, Werewolf phase timers and cross-instance pub/sub run on Redis. When `REDIS_URL` is empty, an in-memory implementation is used for single-instance development and tests; production config validation refuses to start without Redis.
- **Realtime** (`websocket/`). Each instance holds its own sockets. Events are published to Redis, and every instance delivers to the sockets it owns. Clients authenticate with the first message, not a URL token, so tokens never appear in proxy logs. Channel subscriptions go through the same access checks as REST. See [realtime.md](realtime.md).
- **Photos and verification** (`services/photos.py`). Uploads are decoded, downscaled and re-encoded as JPEG on the server, which strips EXIF data such as GPS location. Each photo is moderated before anyone else can see it: automatically when a provider (Sightengine) is configured, otherwise it waits for a moderator (auto-approved only in development). Files live in private storage (`core/storage.py`) and are reachable only through short-lived signed URLs; production requires `STORAGE_BACKEND=s3`. Extra photos can be limited to friends. Selfie verification asks for a random pose, a moderator compares it with the profile photos, and the selfie is deleted after review.
- **Games** (`games/`, `services/games.py`). Each game (Chess, Ludo, Crazy Eights, Four in a Row, Truth or Dare, Werewolf) is a pure engine with no database, network or clock access; randomness comes from a server-side RNG passed in. `services/games.py` runs generic sessions on top: create (on its own or in a room), join by code, host lobby options (allow-listed per game), start, and `POST /games/{id}/action` with the client's `version`. Actions run under a row lock; a stale version gets `409 stale_version` and an illegal move gets `422 illegal_move`. Clients only ever receive `engine.view(state, viewer)`, so other players' cards, deck order and Werewolf roles never leave the server. Werewolf day and discussion phases advance on their own after a deadline kept in Redis and checked on reads, so an idle host can't stall the game. Finishing a game grants rewards with per-player idempotency keys.
- **Rewards** (`services/rewards.py`). Gems and XP go through a ledger with unique idempotency keys, so a reward can never be granted twice. Gems buy game themes (chess boards, card backs, Ludo boards).
- **Monetization** (`services/monetization.py`). Rewarded-ad gems are granted only after AdMob server-side verification (a signed callback). Google Play purchases (gem packs, Veyvo Plus) are checked with the Play Developer API before anything is granted. Every grant uses an idempotency key (ad transaction id or purchase-token hash).
- **Voice and video.** The backend checks authentication, room access, bans, presence and speaker role, then mints a 10-minute LiveKit token. The token always allows the microphone (for speakers) and allows the camera only in video rooms: in friend calls (`services/calls.py`, private rooms of kind `call`) for everyone, elsewhere only for verified users whose camera the host hasn't turned off. Host moderation is mirrored to LiveKit through its server API (mute, camera off, remove, close room).
- **Live-video checks** (`services/livemod.py`). LiveKit calls a signed webhook (`POST /rooms/livekit-webhook`) when a camera is published. For rooms that aren't friend calls, the backend starts an egress that saves a still of that camera every few seconds to the private bucket (no video is recorded). A background task moderates each still and deletes it. A clearly unsafe frame switches that person's camera off for the room and files a report with the frame as evidence; a borderline frame only files a report. This needs LiveKit, S3 storage and a moderation provider.
- **Game calls.** `POST /games/{id}/call` gives each game its own private room (kind `game`) linked by `game_sessions.call_room_id`; only players can join, and it ends when the last person leaves. Camera in a game call needs verification unless everyone else who can see you is your friend (re-checked when someone new joins). Call, game and squad rooms never appear in listings.
- **Meeting and staying close** (`services/discover.py`, `presence.py`, `squads.py`, `letters.py`).
  - **Friend Swipe:** a daily deck (20 decisions a day, 40 with Plus), with the top 3 as Daily Picks. Candidates respect blocks, request privacy, photo visibility and the "show me in Friend Swipe" / "verified only" settings. Skips are silent and likes are never revealed; a mutual like creates the friendship and delivers any notes as first messages.
  - **Presence:** waves (10-minute TTL in Redis) and "Free to talk" (`profiles.free_until`, shown to friends only).
  - **Squads:** up to 8 friends, with chat, a private squad room, a weekly reminder and a weekly streak.
  - **Slow Letters:** pen pals are matched by coarse UTC offset. Letter delay grows with the time-zone gap, and you can become friends after 3 letters each.
  - **Periodic jobs** (`services/scheduler.py`): letter-arrival notices, squad-night reminders and streaks. They run idempotently on every instance.
- **Voice notes.** `POST /conversations/{id}/voice` checks the real audio type from the file bytes, limits notes to 60 s / 2 MB, and stores them privately under `voice/`. They're served by signed URL and deleted with the message or the account. A reported voice note is copied to evidence so moderators can listen.
- **Text safety** (`core/textfilter.py`, terms in `content/blocked_terms.py`).
  - Slurs, hate, threats ("kys") and sexual solicitation are rejected everywhere people write. The filter normalises leetspeak, stretched and spaced-out letters, and matches whole words to avoid false positives.
  - Links, emails, phone numbers and off-platform handles are also rejected wherever strangers can read the text: profiles, prompts, rooms, communities, letters, swipe notes, squad names. Friends-only chats skip that check.
  - Reports are never filtered.
- **Game invites, milestones, sparks.**
  - **Game invites:** `POST /games/{id}/invite` lets a player invite up to 8 friends to a game lobby. It sends a notification and a `game.invite` event, and invited people may enter games tied to private rooms.
  - **Milestones** (`services/milestones.py`): friendship level-ups, anniversaries (1 week / 1 month / 6 months / 1 year, via the scheduler) and games played together (10/25/50). Each fires exactly once, deduplicated with a Moment key.
  - **Spark** (`GET /conversations/{id}/spark`): suggests an editable opener when a chat has been quiet for 24h, built from the other person's prompts, shared interests, recent games or an anniversary. It never sends anything itself.
- **Squad, game and call rooms** refuse to let someone join while a person they've blocked (or who blocked them) is inside.
- **Regulars.** Rooms can repeat weekly: when one ends, the next is scheduled 7 days later. Room cards show how many "regulars" (people you've been in 2+ rooms with) are inside.
- **Error reporting.** `POST /client-errors` (no sign-in, rate-limited per hashed IP) accepts anonymous crash reports from the app: message, scrubbed stack, app version, platform, OS version, screen pattern and a random install id. The server scrubs them again (emails, tokens, ids, paths), logs a `client_error` warning and forwards to Sentry when `SENTRY_DSN` is set. The API itself also reports to Sentry then, with `send_default_pii=False` and a `before_send` that drops request bodies, cookies, Authorization and IP headers (`core/sentry.py`).
- **Migrations.** Alembic in `migrations/`, from `0001` (initial schema) to `0007` (swipe, squads, letters, voice notes, game calls).

## Mobile

- **Routing.** Expo Router, with routes in `src/app`. Route groups are `(auth)`, `(onboarding)` and `(tabs)` (Home, Explore, Hangouts, Games, Profile). Detail screens (rooms, games, photos, verification, shop, Plus and so on) are stack routes. An `AuthGate` in the root layout sends people to sign-up, verification, onboarding or the app.
- **State ownership.**
  - Server state lives only in TanStack Query (`src/api/hooks.ts`), with query keys in `qk`.
  - Client-only UI state lives in Zustand: session tokens (in the OS keystore via `expo-secure-store`), device preferences (theme, reduced motion, haptics, recent searches; AsyncStorage) and toasts.
  - Nothing authoritative is stored in two places.
- **Realtime sync** (`hooks/useRealtimeSync.ts`). One WebSocket (`lib/realtime.ts`) with exponential-backoff reconnects, a heartbeat, ref-counted channel subscriptions and duplicate-event filtering. Events update or invalidate the query cache. After reconnecting or returning to the foreground, queries refetch. The socket closes in the background, so you aren't shown as online.
- **Offline.** NetInfo feeds both TanStack's `onlineManager` (which pauses requests) and an offline banner. Chat messages are sent optimistically with a client id. Failures are marked and can be retried with the same id, which the server de-duplicates.
- **Crash reporting** (`lib/crash.ts`, `components/ErrorBoundary.tsx`). A global JS error handler, Hermes unhandled-rejection tracking and error boundaries (one per screen plus one around the whole app) send anonymous reports to the backend in release builds only: at most 10 per session, identical messages once. Nothing about the account or what people wrote is included; the random install id is wiped on sign-out. A crashed screen shows "Something went wrong" with a Restart button that goes Home.
- **Welcome tour** (`app/tour.tsx`). Shown once per device after onboarding (flag in the persisted preferences store), replayable from Settings.
- **Design system.** Tokens in `theme/tokens.ts` (separately tuned dark and light palettes, a 4-point spacing grid, a type scale), plus a UI kit in `components/ui`. People appear as real photos (`components/UserPhoto.tsx`, with a verified badge and speaking ring; galleries in `components/photos`). Game boards and tables live in `components/games` and use the player's theme from `lib/themes.ts`.
- **Voice and video** (`lib/voice.ts`). LiveKit is loaded lazily, and only if the WebRTC native module exists. That keeps the app working in Expo Go while voice and video stay disabled there. Mic and camera use are explained before the OS prompt. Remote cameras are only downloaded while visible: friends' cameras and calls show automatically, other people's only after a tap (`components/room/VideoGrid.tsx`). If the server takes away camera rights, the camera is switched off locally. Speaking indicators come only from real SDK events.
- **Ads and billing** (`lib/ads.ts`, `lib/billing.ts`). The app shows rewarded ads and starts Google Play purchases, but gems and Plus are granted only after the backend verifies them.

## Scaling notes

- The API is stateless apart from WebSockets, so you can run several instances behind a load balancer. Sticky sessions are not required because Redis fans out events.
- Run Postgres with connection pooling (PgBouncer) and add read replicas if needed. The hot paths are indexed (messages by conversation and time, rooms by status and visibility, notifications by recipient and time).
- LiveKit Cloud handles media scaling and global edge routing. Live-video checks cost one egress per public camera plus one moderation call per snapshot; tune `LIVE_VIDEO_SNAPSHOT_SECONDS` to your budget.
