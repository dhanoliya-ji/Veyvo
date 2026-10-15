# Privacy, data handling & security

Veyvo's rule: **collect the minimum, default to private, enforce on the server.**

## Data inventory

| Data | Why | Where | Retention |
|---|---|---|---|
| Email | Sign-in, verification, recovery | `users.email` | Until account deletion |
| Password | Sign-in | Argon2id hash only | Until deletion |
| Birth date | Confirm 18+ at sign-up | **Not stored**. Only `adult_attested_at` is kept | — |
| Username, display name, bio, interests, vibe | Profile | `profiles`, `user_interests` | Until deletion |
| Profile photos (re-encoded, EXIF/GPS stripped, moderated) | Profile | `photos` + private bucket, signed URLs | Until the user deletes them or the account |
| Verification selfie | Prove photos are real | private bucket | **Deleted immediately after review**; only `verified_at` is kept |
| Live-video safety frames (public rooms only, every few seconds while a camera is on) | Automatic moderation | private bucket (`livemod/`) | **Deleted right after the check**; a flagged frame is kept as report evidence (`evidence/live/`) and cleared with the report |
| Game themes, purchases | Features / accounting | `profiles.game_theme`, `store_purchases` | Purchases kept for accounting with the user link removed on deletion |
| Privacy & notification settings | User control | `privacy_settings` | Until deletion |
| Friendships, requests, blocks | Social graph and safety | respective tables | Until deletion |
| Direct messages | Chat | `messages` | Until the sender deletes them or deletes their account |
| Voice notes | Chat | `messages` (kind `voice`) + private bucket `voice/` | Until deleted by the sender or account deletion; the file is removed with the message |
| Profile prompts (max 3) | Profile | `profiles.prompts` | Until edited or account deletion |
| Friend Swipe decisions | Don't show the same people twice; mutual match | `swipe_decisions` | Until account deletion. Passes are never shown to anyone, and likes are never revealed |
| "Free to talk" until | Shown to friends | `profiles.free_until` | Overwritten or cleared by the user |
| Squads, squad chat | Small friend groups | `squads`, `squad_members`, `squad_messages` | Until removed or account deletion |
| Slow Letters | Pen pals | `pen_pals`, `letters` | Hidden from both when the connection ends; deleted with the account |
| UTC offset (pen pals only) | Pairing across time zones and letter delay | `pen_pal_waiting`, `pen_pals` | Only while looking or connected; cleared when the connection ends. Never shown to anyone |
| Waves 👋 | Friend nudges | Redis only, TTL 10 minutes | Ephemeral |
| Hangout chat | Rooms | `room_messages` | **30 days**, then purged automatically |
| Community posts | Communities | `community_posts` | Until removed or account deletion |
| Game results, gems ledger, quests, kudos, daily answers | Features | respective tables | Until deletion |
| Notifications (never contain message text) | In-app alerts | `notifications` | **90 days** |
| Push token, device platform | Push delivery and device list | `push_tokens`, `auth_sessions` | Until sign-out or deletion; expired sessions purged |
| Reports and moderation actions | Safety | `reports`, `moderation_actions` | Evidence snapshot cleared **180 days** after resolution |
| Presence and online status | Live features | Redis only, with a TTL of about 75 seconds | Ephemeral |
| IP address | Abuse rate limiting | Redis, as a keyed hash in rate-limit counters only | Minutes (window TTL) |

**Never collected:** real name, phone, contacts, precise or approximate location (photo GPS is stripped), voice or video recordings (live-video safety frames are single stills, checked and deleted). Camera and microphone are used only while the person has them turned on.

## Defaults (most private first)

- Messages: friends only, and both people must allow it. Strangers can never DM.
- Online status: friends only, and it can be turned off. Turning it off also disables read receipts in both directions.
- Hangout invites: friends only.
- Notification message previews: **off** (lock screen shows "New message").
- Email is never exposed to other users. Moderators search by username; only admins can look up an exact email.

## Account deletion

- In the app: *Settings → Account & security → Delete account* (password plus typing DELETE).
- On the web (required by Google Play): `https://<api-host>/account/delete`.

Deletion is immediate and permanent. The user row is deleted, and `ON DELETE CASCADE` removes the profile, privacy settings, interests, friendships, requests, blocks, sent messages, conversation memberships, room chat, posts, game data, kudos, ledger, quests, notifications, push tokens and sessions. Before deleting, the service ends live rooms the user hosts and hands owned communities to a moderator or the longest-standing member.

**Kept without identity:** reports the user filed (reporter set to null) so open reviews can finish, and moderation audit entries (actor set to null).

## Data export

*Settings → Account & security → Download my data* returns JSON containing the account, profile, privacy settings, interests, friends, blocked accounts, sent messages and room chat, filed reports, kudos received, the gem ledger, items, quests, daily answers and signed-in devices.

## Security controls

- Argon2id password hashing with a timing-equalised login for unknown emails.
- Short-lived JWT access tokens. Refresh tokens are rotated, stored as HMAC hashes, and reuse is detected.
- Tokens are stored on the device in the OS keystore (`expo-secure-store`).
- Object-level authorisation on every endpoint, including conversation membership, room access (private, banned, blocked host, private community), game access and staff roles loaded from the database.
- Input validation with Pydantic. Control and bidirectional-override characters are stripped (anti-spoofing). Lengths are capped.
- Rate limits on authentication, messaging, reports, requests, rooms, search and WebSocket events.
- WebSocket auth is sent in the first message (no tokens in URLs or logs), with message size limits and strict stroke validation.
- Structured JSON logs redact passwords, tokens and message content. Unhandled errors log the type and path only.
- Security headers, HSTS in production, CORS restricted to configured origins, and API docs disabled in production.
- Production refuses to start with a weak JWT secret, SQLite, missing Redis or a non-HTTPS public URL.
- Android: location, contacts and broad media-storage permissions are explicitly **blocked** in the manifest. Camera (photos, selfie, video), microphone and notifications are requested only when the user turns those features on. Photos are chosen through the system photo picker, so no storage permission is needed.
- Video: camera off by default; selfie verification required to use the camera with non-friends; non-friends' video is not even downloaded until the viewer taps to show it; hosts can disable cameras; report/block on every tile.

## Backups & recovery (operator checklist)

- Enable automated daily Postgres backups with point-in-time recovery (most managed providers support this). Keep backups for 30 days or less so deleted accounts age out.
- Redis holds only ephemeral data, so no backups are needed.
- Rotate `JWT_SECRET_KEY` only with a planned forced sign-out (it invalidates all sessions and hashed codes).
- Restrict database access to the API's network and use separate credentials for migrations.

## Not claimed

The age check is a self-declared birth date plus reporting and moderation. That's a common baseline, but it isn't verified age assurance. If a jurisdiction requires stronger age assurance, add a provider (for example facial age estimation) before launching there. Have the legal pages reviewed by counsel and fill in the operator's company details before release.
