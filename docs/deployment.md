# Deployment & Google Play release

## 1. Backend in production

**Required environment** (see `backend/.env.example` for every variable):

```
APP_ENV=production
PUBLIC_BASE_URL=https://api.yourdomain.com
DATABASE_URL=postgresql+asyncpg://USER:PASS@HOST:5432/veyvo
REDIS_URL=redis://HOST:6379/0           # use rediss:// with TLS where available
JWT_SECRET_KEY=<python -c "import secrets; print(secrets.token_urlsafe(48))">
DEV_EXPOSE_CODES=false
RESEND_API_KEY=...   EMAIL_FROM="Veyvo <no-reply@yourdomain.com>"
LIVEKIT_URL=wss://<project>.livekit.cloud   LIVEKIT_API_KEY=...   LIVEKIT_API_SECRET=...
EXPO_PUSH_ACCESS_TOKEN=...               # optional, recommended
```

The server **refuses to start** in production with a weak secret, SQLite, no Redis, or a non-HTTPS public URL.

**Run it:** `backend/Dockerfile` runs `alembic upgrade head`, then Uvicorn. Deploy it to any container host (Fly.io, Render, Railway, Cloud Run, ECS, a VPS):

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
| Email codes | Returned in the API response and logged | Sent via Resend, never returned |
| API docs `/docs` | Enabled | Disabled |
| HSTS | Off | On |

## 2. LiveKit (voice)

1. Create a project at livekit.io (Cloud) or self-host LiveKit.
2. Put the URL, API key and secret in the backend env.
3. Voice needs a native build (see below). Expo Go can't load WebRTC.

## 3. Android builds (EAS)

```bash
cd mobile
npm i -g eas-cli          # or use npx eas-cli@latest
eas login
eas init                  # writes extra.eas.projectId to app.json (also required for push)
eas build --profile development --platform android   # dev client for testing voice/push
eas build --profile production --platform android    # .aab for Play Store
```

- Set `EXPO_PUBLIC_API_URL` for each build profile in `eas.json`.
- Push notifications: add your FCM credentials with `eas credentials` (Android → Google Service Account / FCM V1).
- Bump `expo.version` and `android.versionCode` for every release. EAS can auto-increment (`"autoIncrement": true` is set in the production profile).

## 4. Google Play checklist

1. **Developer account.** New personal accounts must run a **closed test with at least 12 testers for 14 continuous days** before production access. Plan for this.
2. **App content → Target audience:** 18+ only. Don't opt into the Families program.
3. **Content rating (IARC questionnaire):** declare user interaction (chat, voice) and user-generated content. Expect Teen or Mature.
4. **User-generated content policy:** in-app reporting ✔, blocking ✔, moderation ✔, published guidelines ✔ (`/legal/guidelines`).
5. **Child safety standards** (required for social apps): published at `/legal/child-safety`, with in-app reporting including "User may be under 18" ✔ and a named contact. Fill in `safety@yourdomain`.
6. **Account deletion:** in the app ✔, plus a web URL for the Play listing: `https://<api-host>/account/delete` ✔.
7. **Privacy policy URL:** `https://<api-host>/legal/privacy`. Have counsel review it and add your company details.
8. **Data safety form.** Declare:
   - Collected: email (account management), user IDs, in-app messages (app functionality), other user-generated content (profile, posts), app interactions (game results).
   - Not collected: location, photos, contacts, financial info, device IDs for ads.
   - Data is encrypted in transit, and users can request deletion.
9. **Permissions:** `RECORD_AUDIO` (voice rooms, requested on demand) and `POST_NOTIFICATIONS`. Camera, location, contacts and media are explicitly blocked.
10. **Foreground service:** if you add "keep talking with the screen off", declare a `microphone` foreground service type and justify it in Play Console.
11. **Billing:** v1 sells nothing. When you add gem packs or Veyvo Plus, use **Google Play Billing** for digital goods, verify purchases server-side, and never sell randomised items without published odds.
12. **Ads (planned):** if you add AdMob, set up the UMP consent form (GDPR) and avoid ads in voice rooms or chats.

## 5. Store listing assets to prepare

- 512×512 icon (replace `mobile/assets/icon.png` and the adaptive icon layers with the Veyvo mark)
- Feature graphic 1024×500 and 4–8 phone screenshots (Home, a live room scene, Trivia, Doodle, Profile, Safety centre)
- Short description (80 characters), for example: "Hang out with people who share your vibe — voice rooms, games and new friends."

## 6. Money features (AdMob + Google Play Billing)

Everything is server-verified. The app never grants gems or Plus by itself.

### Rewarded ads (AdMob)
1. Create an AdMob account → add an Android app (`app.veyvo`) → create a **Rewarded** ad unit.
2. In `mobile/app.json`, replace the **test** `androidAppId` under the `react-native-google-mobile-ads` plugin with your real AdMob App ID.
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
