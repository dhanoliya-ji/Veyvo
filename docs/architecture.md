# Architecture

```
┌──────────────────────────────┐        HTTPS /api/v1/*         ┌─────────────────────────────┐
│  Expo app (React Native)     │ ─────────────────────────────▶ │  FastAPI (N instances)      │
│  TanStack Query cache        │        WSS /api/v1/ws          │  routes → services → models │
│  Zustand (session, prefs)    │ ◀────────────────────────────▶ │  realtime hub               │
│  LiveKit client (voice)      │                                └──────┬───────────┬──────────┘
└──────────────┬───────────────┘                                       │           │
               │ WebRTC (voice only, token from API)                    │           │
               ▼                                                 ┌─────▼───┐  ┌────▼──────┐
       ┌───────────────┐                                         │Postgres │  │  Redis    │
       │ LiveKit SFU   │ ◀── server API (mute/kick/close) ────────│ durable │  │ presence  │
       └───────────────┘                                         │ data    │  │ pub/sub   │
                                                                 └─────────┘  │ rate limit│
                                                                              └───────────┘
```

## Backend

- **Layers.** `api/routes/*` handle HTTP only (validation and dependencies). Business rules live in `services/*`. Models are in `models/*`, and request/response contracts in `schemas/*`.
- **Auth.**
  - Access tokens are JWTs that last 15 minutes and carry a session id. Refresh tokens are opaque, stored as keyed hashes in `auth_sessions`, and **rotate on every use**. Replaying an old refresh token revokes the session.
  - Every request reloads the user row, so suspensions, bans and role changes apply immediately. Roles are never trusted from the token or the client.
- **Errors.** One shape everywhere: `{"error": {"code", "message", "details?"}}`. Messages are written for end users, and stack traces never leave the server.
- **Ephemeral state** (`core/store.py`). Presence, room occupancy, rate-limit counters, matchmaking queues and cross-instance pub/sub run on Redis. When `REDIS_URL` is empty, an in-memory implementation is used for single-instance development and tests; production config validation refuses to start without Redis.
- **Realtime** (`websocket/`). Each instance holds its own sockets. Events are published to Redis, and every instance delivers to the sockets it owns. Clients authenticate with the first message, not a URL token, so tokens never appear in proxy logs. Channel subscriptions go through the same access checks as REST. See [realtime.md](realtime.md).
- **Games** (`services/games.py`). The engine is server-authoritative and advances lazily: phase deadlines are stored in the session state, and any read or submission first rolls the state forward from the server clock. There are no background timers, so it works across instances and survives restarts. Scores, correctness and timing are computed only on the server. A unique constraint on `(session, user, round)` blocks duplicate answers, and rewards use idempotency keys.
- **Rewards** (`services/rewards.py`). Gems and XP go through a ledger with unique idempotency keys, so a reward can never be granted twice.
- **Voice.** The backend checks authentication, room access, bans, presence and speaker role, then mints a 10-minute LiveKit token. It can only publish the microphone (no camera). Host moderation is mirrored to LiveKit through its server API (mute, remove, close room).
- **Migrations.** Alembic in `migrations/`. The initial schema is `0001`.

## Mobile

- **Routing.** Expo Router, with routes in `src/app`. Route groups are `(auth)`, `(onboarding)` and `(tabs)` (Home, Explore, Hangouts, Games, Profile). Detail screens are stack routes. An `AuthGate` in the root layout sends people to sign-up, verification, onboarding or the app.
- **State ownership.**
  - Server state lives only in TanStack Query (`src/api/hooks.ts`), with query keys in `qk`.
  - Client-only UI state lives in Zustand: session tokens (in the OS keystore via `expo-secure-store`), device preferences (theme, reduced motion, haptics, recent searches; AsyncStorage) and toasts.
  - Nothing authoritative is stored in two places.
- **Realtime sync** (`hooks/useRealtimeSync.ts`). One WebSocket (`lib/realtime.ts`) with exponential-backoff reconnects, a heartbeat, ref-counted channel subscriptions and duplicate-event filtering. Events update or invalidate the query cache. After reconnecting or returning to the foreground, queries refetch. The socket closes in the background, so you aren't shown as online.
- **Offline.** NetInfo feeds both TanStack's `onlineManager` (which pauses requests) and an offline banner. Chat messages are sent optimistically with a client id. Failures are marked and can be retried with the same id, which the server de-duplicates.
- **Design system.** Tokens in `theme/tokens.ts` (separately tuned dark and light palettes, a 4-point spacing grid, a type scale), plus a UI kit in `components/ui`. Avatars are composed SVG parts (`components/avatar`), and hangout scenes are SVG illustrations (`components/scene`).
- **Voice** (`lib/voice.ts`). LiveKit is loaded lazily, and only if the WebRTC native module exists. That keeps the app working in Expo Go while voice stays disabled there. Speaking indicators come only from real SDK events.

## Scaling notes

- The API is stateless apart from WebSockets, so you can run several instances behind a load balancer. Sticky sessions are not required because Redis fans out events.
- Run Postgres with connection pooling (PgBouncer) and add read replicas if needed. The hot paths are indexed (messages by conversation and time, rooms by status and visibility, notifications by recipient and time).
- LiveKit Cloud handles media scaling and global edge routing.
