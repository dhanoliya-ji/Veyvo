# Deployment & Google Play release

## 1. Backend in production

**Required environment** (see `backend/.env.example` for every variable):

```
APP_ENV=production
PUBLIC_BASE_URL=https://api.yourdomain.com
DATABASE_URL=postgresql+asyncpg://USER:PASS@HOST:5432/veyvo   # postgres:// URLs are converted automatically
REDIS_URL=redis://HOST:6379/0           # use rediss:// with TLS where available
JWT_SECRET_KEY=<python -c "import secrets; print(secrets.token_urlsafe(48))">
DEV_EXPOSE_CODES=false
RESEND_API_KEY=...   EMAIL_FROM="Veyvo <no-reply@yourdomain.com>"
LIVEKIT_URL=wss://<project>.livekit.cloud   LIVEKIT_API_KEY=...   LIVEKIT_API_SECRET=...
STORAGE_BACKEND=s3   S3_BUCKET=...   S3_ENDPOINT_URL=...   S3_ACCESS_KEY_ID=...   S3_SECRET_ACCESS_KEY=...   S3_REGION=auto
MODERATION_PROVIDER=sightengine   SIGHTENGINE_API_USER=...   SIGHTENGINE_API_SECRET=...
LIVE_VIDEO_MODERATION=true
EXPO_PUSH_ACCESS_TOKEN=...               # optional, recommended
```

The server **refuses to start** in production if any of these is true: a weak secret, SQLite, no Redis, local photo storage, or a non-HTTPS public URL.

**Run it:** `backend/Dockerfile` runs `alembic upgrade head`, then Uvicorn on `$PORT` (default 8000). Deploy it to any container host (Render, Fly.io, Railway, Cloud Run, ECS, a VPS):

- Put a TLS-terminating load balancer or proxy in front. The app trusts `X-Forwarded-*` headers (`--proxy-headers`). Restrict `--forwarded-allow-ips` to your proxy where possible.
- Enable WebSocket upgrades on `/api/v1/ws` and set idle timeouts above 90 seconds.
- Run 2 or more instances for availability. Sticky sessions aren't needed, because Redis fans realtime events out to every instance.
- `GET /api/v1/health` is the health check.
- Retention purges run inside the app every 6 hours (safe to run on every instance).

**Development vs production**

| | Development | Production |
|---|---|---|
| Database | SQLite file (or Docker Postgres) | Managed PostgreSQL with backups |
| Redis | Optional (in-memory fallback) | Required |
| Photos | Local `backend/media/`, auto-approved | Private S3/R2 bucket, Sightengine moderation |
| Email codes | Returned in the API response and logged | Sent via Resend, never returned |
| API docs `/docs` | Enabled | Disabled |
| HSTS | Off | On |

## 2. Hosting on Render (recommended to start)

`render.yaml` in the repo root creates everything in one go: the API (Docker), PostgreSQL and Redis (Render "Key Value").

1. Push the repo to GitHub (already done for this project).
2. Go to render.com and sign in with GitHub. Then **New → Blueprint**, pick the `Veyvo` repo and choose the branch.
3. Render lists every value it needs (the ones marked `sync: false`). Fill them in from sections 3 to 5 below. If you don't have a value yet (e.g. Google Play), leave it empty; that feature then stays switched off.
4. Click **Apply**. The first deploy builds the image, runs the migrations and starts the API.
5. Copy the service URL (e.g. `https://veyvo-api.onrender.com`), set it as `PUBLIC_BASE_URL` in the service's **Environment** tab, and save. Render redeploys automatically.
6. Check `https://<your-url>/api/v1/health` returns `{"status":"ok"...}`.
7. Point the app at it: in `mobile/eas.json`, set `EXPO_PUBLIC_API_URL` to your Render URL in the `preview` and `production` profiles.

Notes:
- The blueprint uses paid "starter" plans. Free web services sleep after 15 minutes idle, which drops WebSockets and games.
- Regions default to Singapore. Change `region:` on all three resources together if most of your users are elsewhere.
- Custom domain: service → **Settings → Custom Domains**, then update `PUBLIC_BASE_URL`.
- The live-video check loop runs inside every instance. Keep one instance until you add a lock, or set `LIVE_VIDEO_MODERATION=false` on extra instances.

## 3. LiveKit (voice & video)

1. Create a project at livekit.io (Cloud) or self-host LiveKit.
2. Put the URL, API key and secret in the backend env.
3. **Live video safety checks.** In LiveKit Cloud → your project → **Settings → Webhooks**, add `https://<api-host>/api/v1/rooms/livekit-webhook`, signed with the same API key. When someone turns on their camera in a public room, the API asks LiveKit for a still frame every `LIVE_VIDEO_SNAPSHOT_SECONDS` (default 10). Frames go to your bucket, get moderated and are deleted. Unsafe cameras are switched off and reported with the frame as evidence. Private friend calls aren't scanned. This needs S3 storage (section 4), Sightengine (section 5) and `LIVE_VIDEO_MODERATION=true`. LiveKit bills egress minutes for the snapshots.
4. Voice and video need the native dev or production build (see below). Expo Go can't load WebRTC.
5. If a LiveKit secret was ever shared anywhere (chat, screenshots), rotate it in LiveKit before launch.

## 4. Photo storage (S3-compatible, private)

Cloudflare R2 is cheapest (no egress fees). AWS S3 works the same way.

1. Cloudflare dashboard → **R2 → Create bucket** (e.g. `veyvo-media`). Leave public access **off**: the API serves photos only through short-lived signed URLs.
2. **R2 → Manage API tokens → Create token** with *Object Read & Write* on that bucket.
3. Backend env:
   ```
   STORAGE_BACKEND=s3
   S3_BUCKET=veyvo-media
   S3_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com
   S3_ACCESS_KEY_ID=...   S3_SECRET_ACCESS_KEY=...   S3_REGION=auto
   ```

## 5. Image moderation (Sightengine)

1. Create an account at sightengine.com and copy the API user and secret.
2. Backend env: `MODERATION_PROVIDER=sightengine`, `SIGHTENGINE_API_USER`, `SIGHTENGINE_API_SECRET`.
3. What happens:
   - Clearly safe photos go live straight away.
   - Borderline photos wait in **Moderation → Photos**.
   - Clearly unsafe photos are rejected.
   - Selfie verifications always wait for a human in **Moderation → Verifications**, and the selfie is deleted after the decision.

With `MODERATION_PROVIDER=none` (development only), every photo is approved automatically.

## 6. Android builds (EAS)

```bash
cd mobile
npx eas-cli@latest login
npx eas-cli@latest build --profile development --platform android   # dev client for testing
npx eas-cli@latest build --profile production --platform android    # .aab for Play Store
```

- Set `EXPO_PUBLIC_API_URL` for each build profile in `eas.json`.
- `google-services.json` (push) is provided through the EAS file environment variable `GOOGLE_SERVICES_JSON`.
- Push notifications: add your FCM V1 service-account key with `eas credentials` (Android → Push Notifications).
- EAS auto-increments `android.versionCode` in the production profile. Bump `expo.version` yourself for user-visible releases.

## 7. Google Play checklist

1. **Developer account.** New personal accounts must run a **closed test with at least 12 testers for 14 continuous days** before production access. Plan for this.
2. **App content → Target audience:** 18+ only. Don't opt into the Families program.
3. **Content rating (IARC questionnaire):** declare user interaction (chat, voice, video), user-generated content and photo sharing. Expect Mature 17+ / PEGI 18 territory.
4. **User-generated content policy:** in-app reporting ✔, blocking ✔, moderation (human queue plus automatic photo and live-video checks) ✔, published guidelines ✔ (`/legal/guidelines`).
5. **Child safety standards** (required for social apps): published at `/legal/child-safety`, with in-app reporting including "User may be under 18" ✔ and a named contact. Fill in `safety@yourdomain`.
6. **Account deletion:** in the app ✔, plus a web URL for the Play listing: `https://<api-host>/account/delete` ✔.
7. **Privacy policy URL:** `https://<api-host>/legal/privacy`. Have counsel review it and add your company details.
8. **Data safety form.** Declare:
   - Collected: email (account management); user IDs; **photos** (profile photos, the verification selfie, which is deleted after review, and live-video frames from public rooms, which are deleted after moderation unless flagged); in-app messages; other user-generated content (profile, posts); app interactions (games); purchase history (gem packs, Plus).
   - Advertising: AdMob may collect the device advertising ID. Declare this, and show the UMP consent form.
   - Not collected: location (photo GPS is stripped), contacts, voice or video recordings.
   - Data is encrypted in transit, and users can request deletion.
9. **Permissions:**
   - `CAMERA`: photos, selfie and video, requested only when the user turns the feature on.
   - `RECORD_AUDIO`: voice and video.
   - `POST_NOTIFICATIONS`.
   - Location, contacts and broad storage permissions are blocked. Photos come through the system photo picker.
10. **Foreground service:** if you add "keep talking with the screen off", declare a `microphone` (and `camera`) foreground service type and justify it in Play Console.
11. **Billing:** gem packs and Plus use Google Play Billing and are verified server-side. Nothing randomised is sold.

## 8. Store listing assets to prepare

- 512×512 icon: export from `mobile/assets/icon.png` (1024×1024 Veyvo mark).
- Feature graphic 1024×500, and 4–8 phone screenshots: Home, a video room, a Chess or Ludo game, Werewolf, a profile with photos, the Safety centre.
- Short description (80 characters), for example: "Meet real people who share your vibe: video rooms, real games and new friends."

## 9. Money features (AdMob + Google Play Billing)

Everything is server-verified. The app never grants gems or Plus by itself.

### Rewarded ads (AdMob)
1. Create an AdMob account → add an Android app (`app.veyvo`) → create a **Rewarded** ad unit.
2. In `mobile/app.json`, replace the **test** App ID with your real AdMob App ID in **both** places: `androidAppId` under the `react-native-google-mobile-ads` plugin, and `android_app_id` in the top-level `react-native-google-mobile-ads` section. The library's Android build reads that top-level section and fails without it.
3. Set `EXPO_PUBLIC_ADMOB_REWARDED_ID=<your rewarded unit id>` in the production build env (`eas.json`). Without it, Google's test ad unit is used.
4. In the AdMob ad unit settings, turn on **Server-side verification** with the callback URL `https://<api-host>/api/v1/ads/ssv`.
5. Backend env: `ADMOB_ENABLED=true` (optionally `AD_REWARD_GEMS`, `AD_DAILY_REWARD_CAP`).
6. Set up the GDPR/UK consent message in AdMob → *Privacy & messaging*. The app shows it automatically through Google's UMP SDK.

In development (`APP_ENV=development`), Google can't reach your laptop, so the app uses a dev-only endpoint that stands in for the SSV callback. It's disabled in production.

### Gem packs + Veyvo Plus (Google Play Billing)
1. Play Console → your app → **Monetize → Products**:
   - In-app products (consumable): `gems_100`, `gems_550`, `gems_1200`
   - Subscription: `veyvo_plus_monthly` (one monthly base plan)
2. Create a Google Cloud **service account**, enable the *Google Play Android Developer API*, then invite the service account in Play Console → *Users and permissions* with "View financial data" and "Manage orders and subscriptions".
3. Backend env: `GOOGLE_PLAY_SERVICE_ACCOUNT=/path/to/key.json` (or the JSON itself) and `GOOGLE_PLAY_PACKAGE=app.veyvo`.
4. Real-time Developer Notifications (renewals and cancellations): create a Pub/Sub topic, set it in Play Console → *Monetization setup*, and add a push subscription to `https://<api-host>/api/v1/billing/google/rtdn?token=<GOOGLE_RTDN_TOKEN>`.
5. Purchases only work in builds installed from Play (internal testing track) with a licence-tester account.

Purchase records are kept for accounting with the user link removed on account deletion (`user_id` set to null).
