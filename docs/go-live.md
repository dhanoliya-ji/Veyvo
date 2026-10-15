# Going live: step by step

Do these in order. Each step says what to sign up for, which values to copy, and where to paste them. You'll paste every value into **Render → veyvo-api → Environment** (step 6) unless it says otherwise. Keep them in a private note as you go.

## 1. Cloudflare R2: photo storage (about $0 to start)
1. Go to dash.cloudflare.com → sign up → left menu **R2 Object Storage** → add a payment method (there's a free allowance).
2. **Create bucket**, name it `veyvo-media`, and leave public access **off**.
3. **Manage R2 API Tokens → Create API token**: permission *Object Read & Write*, applied to `veyvo-media` only.
4. Copy these into your note:
   - `S3_BUCKET` = `veyvo-media`
   - `S3_ENDPOINT_URL` = `https://<your-account-id>.r2.cloudflarestorage.com` (shown on the R2 page)
   - `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` (shown once)

## 2. Sightengine: photo and live-video safety checks
1. Go to sightengine.com and sign up. A free tier exists; pick a paid plan before launch.
2. Dashboard → **API keys**. Copy `SIGHTENGINE_API_USER` and `SIGHTENGINE_API_SECRET`.

## 3. Resend: verification emails
1. Go to resend.com and sign up. **Domains → Add domain**: use a domain you own and add the DNS records it shows.
2. **API Keys → Create**. Copy `RESEND_API_KEY`.
3. `EMAIL_FROM` = `Veyvo <no-reply@yourdomain.com>`

No domain yet? You can buy one at Cloudflare or Namecheap for about $10 a year. Without email, people can't verify their accounts in production.

## 4. LiveKit: voice and video
You already have a LiveKit Cloud project. Because the secret was shared in chat, **regenerate the API key and secret first** (LiveKit → Settings → Keys).
- Copy `LIVEKIT_URL` (`wss://…livekit.cloud`), `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`.
- The webhook is set in step 7, after the server has its address.

## 5. Sentry: crash reports (optional, free tier)
1. Go to sentry.io → sign up → **Create project**, platform *Python (FastAPI)*.
2. Copy the DSN → `SENTRY_DSN`. App crashes are sent to your own server, which forwards them there.

## 6. Render: the server
1. Go to render.com → **Sign in with GitHub** → allow access to the `Veyvo` repo.
2. **New + → Blueprint** → choose `dhanoliya-ji/Veyvo` and the branch you use (`clean-live-branch` or `projects`).
3. Render reads `render.yaml` and asks for each secret. Paste the values from steps 1–5. For `PUBLIC_BASE_URL`, type `https://veyvo-api.onrender.com` for now. Leave the Google Play ones empty for now.
4. Click **Apply** and wait about 5–10 minutes for the build.
5. Open `https://veyvo-api.onrender.com/api/v1/health` in a browser. You should see `"status":"ok"`.
   - If Render gave the service a different address (shown at the top of the service page), use that everywhere instead, including `PUBLIC_BASE_URL` and `mobile/eas.json`.
6. Make yourself admin: Render → veyvo-api → **Shell** tab. After signing up in the app, run:
   ```
   python -m scripts.set_role you@example.com admin
   ```

Cost: roughly $20–30 a month in total for the starter web service, database and Redis (check render.com/pricing for current prices). Free plans sleep, which breaks calls and games.

## 7. Point LiveKit at the server
LiveKit Cloud → your project → **Settings → Webhooks → Add**:
`https://veyvo-api.onrender.com/api/v1/rooms/livekit-webhook`
This turns on automatic safety checks for live video in public rooms.

## 8. AdMob: real ads (can wait until after the first release)
Follow docs/deployment.md, section 9: create the app and a rewarded ad unit, put the real App ID in `mobile/app.json` in **both** places, set `EXPO_PUBLIC_ADMOB_REWARDED_ID` in `eas.json` → production → env, and set the SSV callback URL.

## 9. Build the Play Store version
`mobile/eas.json` already points release builds at `https://veyvo-api.onrender.com`.
```powershell
cd C:\Users\gajen\OneDrive\Desktop\Veyvo\mobile
npx eas-cli@latest build --profile production --platform android
```
Download the `.aab` and follow [play-store.md](play-store.md).

## 10. Google Play Billing (after the app is on Play)
Follow docs/deployment.md, section 9 → "Gem packs + Veyvo Plus". Then add `GOOGLE_PLAY_SERVICE_ACCOUNT` in Render.

## Checklist before inviting testers
- [ ] Health check shows `"status":"ok"`
- [ ] Sign-up email arrives
- [ ] Uploading a photo works, and a clearly bad image gets rejected
- [ ] Two phones can video call
- [ ] Friend Swipe match works between two accounts
- [ ] Privacy policy opens at `/legal/privacy`; support email updated in `mobile/src/lib/config.ts`
