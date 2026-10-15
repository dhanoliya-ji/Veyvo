# Google Play listing kit

Everything you need to fill in Play Console, ready to copy and paste. Graphics are in [`store/`](../store).

## 1. Store listing

**App name** (max 30 characters)
```
Veyvo: Meet & Hang Out
```

**Short description** (max 80 characters)
```
Make real friends: swipe, video hangouts, games with faces and voice. 18+
```

**Full description** (max 4,000 characters)
```
Veyvo is where adults meet new friends and actually hang out, not just scroll.

💜 FRIEND SWIPE: FRIENDS, NOT DATING
Every evening you get a fresh Daily Drop of people who share your interests. Swipe 👋 to be friends. Skips are silent and nobody can see who liked them. When you both say yes, it's a match and you're friends instantly.

🎥 HANG OUT LIVE
Jump into voice and video rooms by topic, start a private room with friends, or call a friend with one tap. Your camera always starts off, and video from people you don't know stays hidden until you choose to show it.

♟️ PLAY TOGETHER, FACE TO FACE
Chess, Ludo, Crazy Eights, Four in a Row, Truth or Dare and Werewolf, with live voice and video bubbles right on the game screen. Invite friends, play strangers, and make friends after the game.

🤝 STAY CLOSE
• Squads: small friend groups with their own chat, hangouts and weekly squad night
• Voice notes, waves 👋 and "Free to talk" so you know who's around
• Slow Letters: pen pals around the world, with letters that take time to arrive
• Friendship milestones, Moments and Vibes (positive compliments only)

🛡️ SAFE BY DESIGN
• Adults only (18+)
• Photos are checked before anyone sees them, and location data is removed
• Optional selfie verification for a verified badge
• Block, report and leave anywhere, in one tap
• Only friends can message you
• Automatic safety checks on live video in public rooms
• Your data stays yours: download or delete it anytime

Free to use. Optional gem packs and Veyvo Plus.
```

**App category:** Social · **Tags:** Social networking, Video chat, Party games, Friends
**Contact email:** your support address (also update `SUPPORT_EMAIL` in `mobile/src/lib/config.ts`)
**Privacy policy URL:** `https://<your-api-host>/legal/privacy`

### Graphics
| Asset | File | Required size |
|---|---|---|
| App icon | `store/icon-512.png` | 512 × 512 PNG |
| Feature graphic | `store/feature-graphic.png` | 1024 × 500 PNG |
| Phone screenshots | take them yourself (below) | 2–8, 9:16, min 1080 px tall |

**Screenshots to take** (use a test account with real-looking photos of **yourself or friends who agree**; never use stock photos of strangers):
1. Friend Swipe card with "You both…" chips
2. Match screen
3. A video room
4. Chess or Ludo with face bubbles
5. Squad chat
6. Slow Letters thread
7. Safety centre → Your rights & controls

To take one: press Power + Volume down on the phone. Or from the laptop: `adb exec-out screencap -p > shot1.png`.

## 2. App content (Policy → App content)

**Privacy policy:** URL above.

**Ads:** **Yes, contains ads.** These are rewarded ads only, and only when the user taps "Watch for gems".

**App access:** "All or some functionality is restricted." Give reviewers a working test account:
- Email / password: create one on your production server, verified and onboarded, with a photo.
- Instructions: "Sign in with the account above. Friend Swipe is under Home. Video features need a second account; the reviewer may use the in-app rooms."

**Target audience:** 18 and over **only**. Not designed for children. Don't join the Families programme.

**Content rating (IARC questionnaire)**, answer honestly:
- Category: Social / Communication.
- Users can interact or exchange content: **Yes** (chat, voice, video, photos).
- Shares user's location with other users: **No**.
- Digital purchases: **Yes** (gem packs, subscription).
- Violence, sexual content, profanity in the app's own content: **No** (Truth or Dare packs are mild; user content is moderated).
- Gambling or simulated gambling: **No** (no casino games, no paid random rewards).
- Expected result: Mature 17+ / PEGI 16–18, with "Users interact" and "In-app purchases" notices.

**News app:** No. **COVID-19 app:** No. **Government app:** No. **Financial features:** None.

**Data safety.** Use this table, which matches the privacy policy:

| Data type | Collected | Shared | Optional? | Purpose |
|---|---|---|---|---|
| Email address | Yes | No | Required | Account management, communications (codes) |
| User IDs | Yes | No | Required | App functionality, account management |
| Photos | Yes | No | Optional (but needed for Friend Swipe) | App functionality (profile photos, selfie verification, deleted after review) |
| Voice or sound recordings | Yes | No | Optional | App functionality (voice notes) |
| Other in-app messages | Yes | No | Optional | App functionality (chat, squad chat, letters) |
| Other user-generated content | Yes | No | Optional | App functionality (bio, prompts, posts) |
| App interactions | Yes | No | Required | App functionality (games, quests, streaks) |
| Purchase history | Yes | No | Optional | App functionality (gems, Plus) |
| Crash logs | Yes | No | Required | Analytics (stability); anonymous, no account link |
| Diagnostics | Yes | No | Required | Analytics (app version, OS) |
| Device or other IDs | Yes (by AdMob) | Yes (with Google for ads) | Optional (only when watching an ad) | Advertising |

Not collected: name, phone number, address, location (precise or approximate), contacts, calendar, files, health, financial info, web history.

Security answers: data is **encrypted in transit** ✔. Users **can request deletion** ✔: in the app and at `https://<api-host>/account/delete`.

**Child safety standards** (required for social apps): link `https://<api-host>/legal/child-safety`. Name a contact person and email.

**Account deletion URL:** `https://<api-host>/account/delete`

## 3. Release path (new personal developer account)

1. **Internal testing:** upload the first `.aab`, add yourself, and check it installs from Play.
2. **Closed testing:** you need **at least 12 testers opted in for 14 days in a row** before you can apply for production. Share the opt-in link with friends; they install from Play and keep it installed.
3. **Apply for production** (Dashboard → "Apply for production") after the 14 days. Answer the questions about your testing.
4. **Production:** start with a staged rollout (for example 20%), watch crash reports and reviews, then go to 100%.

Build the Play bundle:
```powershell
cd C:\Users\gajen\OneDrive\Desktop\Veyvo\mobile
npx eas-cli@latest build --profile production --platform android
```
Download the `.aab` from the link and upload it in Play Console → Testing → Internal testing → Create release.
