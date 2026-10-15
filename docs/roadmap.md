# Roadmap

## v1 (this codebase)

Accounts with an 18+ check, real profile photos (moderated, private, signed URLs) and optional selfie verification, interests, friends, 1-to-1 chat, friend video calls, voice, video and text hangouts with host camera controls and automatic live-video safety checks, study rooms, communities with points and leaderboards, server-authoritative games (Chess, Ludo, Crazy Eights, Four in a Row, Truth or Dare, Werewolf) with lobby options, Daily Question, Icebreaker Match, quests, streaks, kudos, moments, seasonal events, gems that buy game themes, rewarded ads, gem packs and Veyvo Plus through Google Play Billing, notifications, the Safety Centre, the moderation queue (including photo and verification review), account deletion and data export.

## v2: engagement

- More games on the same engine: Word Guess, Backgammon, Uno-style card variants, a quick party game for big rooms.
- Ranked play and simple Elo ratings for Chess and Four in a Row, with rematch and spectator mode.
- Communities: ranks and weekly team leagues on top of community points.
- Captions in voice and video rooms (speech-to-text).
- Better hangout discovery: recommendations from interests and friends' activity.
- Optional automatic selfie checks (face match) to speed up verification, with human review kept for edge cases.

## v3: monetization (keeping safety free)

- **Season Pass** (free and premium tracks), via Google Play Billing with server-side validation. No paid loot boxes.
- More game themes and limited seasonal themes (genuinely limited, no fake timers).
- Light interstitials only at natural breaks (for example after a game), never in rooms or chats, and never for Plus members.
- **Gifting** in rooms, and creator payouts later (needs KYC and tax handling).
- Host Pro tools and boosted events.
- Apple App Store release with StoreKit purchases.

## Technical follow-ups

- End-to-end tests (Maestro) for the main user journeys.
- Run the live-video snapshot task on a single worker (or with a lock) when several API instances run.
- Optional end-to-end encryption for DMs (this trades off against moderation of reported messages; decide based on policy).
- Translations (strings are centralised enough to extract with i18n tooling when you add languages).
- Admin web dashboard (the moderation API is ready; the in-app moderation screens cover v1).
