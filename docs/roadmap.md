# Roadmap

## v1 (this codebase)

Accounts with an 18+ check, avatars, interests, friends, 1-to-1 chat, voice and text hangouts in illustrated scenes, study rooms, communities, Trivia, Doodle & Guess, Daily Question, Icebreaker Match, quests, streaks, kudos, an earn-only gem shop, notifications, the Safety Centre, the moderation queue, account deletion and data export.

## v2: identity & engagement

- **Camera-driven avatars:** on-device face tracking (e.g. MediaPipe Face Landmarker via a native module) drives the 2D avatar's eyes, mouth and head pose. **Only animation parameters are sent** (over LiveKit data channels); no video ever leaves the phone. The avatar component already takes a `talking` level.
- Walking avatars and proximity voice inside scenes.
- Communities: ranks, weekly team leagues.
- More games: Word Guess, Guess the Song, Mafia/Werewolf.
- Moments: shareable recap cards after hangouts.
- Seasonal events and limited-time cosmetics (genuinely limited, no fake timers).
- Captions in voice rooms (speech-to-text).

## v3: monetization (keeping safety free)

- **Rewarded ads** (AdMob, with server-side verification for gem grants), plus light interstitials only at natural breaks. Never in rooms or chats.
- **Veyvo Plus** subscription: ad-free, monthly gems, exclusive cosmetics, bigger rooms. Uses regional pricing through Google Play Billing.
- **Gem packs and Season Pass** (free and premium tracks), via Google Play Billing with server-side receipt validation. No paid loot boxes.
- **Gifting** in rooms, and creator payouts later (needs KYC and tax handling).
- Host Pro tools and boosted events.

## Technical follow-ups

- End-to-end tests (Maestro) for the main user journeys.
- Optional end-to-end encryption for DMs (this trades off against moderation of reported messages; decide based on policy).
- Translations (strings are centralised enough to extract with i18n tooling when you add languages).
- Admin web dashboard (the moderation API is ready; the in-app moderation screens cover v1).
