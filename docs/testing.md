# Testing on a real phone

This guide covers running the backend on your laptop, installing the Veyvo dev app on an Android phone, and checking every feature.

## What you need

- Laptop and phone on **the same Wi-Fi or hotspot**.
- Windows Firewall allowing inbound TCP **8000** (API) and **8081** (Metro) on the network profile you're using.
- The **Veyvo development build** installed on the phone. Rebuild it whenever native modules change (camera, video, ads and billing were added after the first build).
- For anything multiplayer (friends, chat, calls, games, video rooms): **a second account on a second device**. That can be a friend's Android phone with the same dev APK, or the Android emulator. Demo accounts from `python -m scripts.seed_dev` are good for filling up lists, but they can't act.

## 1. Start the backend (PowerShell window #1)

```powershell
cd C:\Users\gajen\OneDrive\Desktop\Veyvo\backend
.venv\Scripts\activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Check from the phone's browser: `http://<laptop-IP>:8000/api/v1/health` should show `"status":"ok"`.
Find the laptop IP with `ipconfig` (the IPv4 address of the Wi-Fi adapter).

## 2. Start the app (PowerShell window #2)

1. Put the laptop IP in `mobile\.env`: `EXPO_PUBLIC_API_URL=http://<laptop-IP>:8000`
2. Run:
   ```powershell
   cd C:\Users\gajen\OneDrive\Desktop\Veyvo\mobile
   npm install
   npx expo start --dev-client --clear
   ```
3. Open the **Veyvo** dev app on the phone and scan the QR code (or pick the server from the list).

To rebuild the dev app: `npx eas-cli@latest build --profile development --platform android`. Answer **n** to "Install and run on an emulator?", then open the link EAS prints on the phone and install the APK.

## 3. Make yourself an admin (window #3, after signing up in the app)

```powershell
cd C:\Users\gajen\OneDrive\Desktop\Veyvo\backend
.venv\Scripts\activate
python -m scripts.set_role your@email.com admin
```

Restart the app. **Profile → Moderation** appears.

## 4. Checklist

### Account & profile
- [ ] Sign up (18+ date of birth). The verification code shows on screen in development.
- [ ] Add 2–3 photos (camera and gallery). Reorder them and delete one. The first photo becomes your profile picture.
- [ ] Settings → Privacy: turn off "All my photos visible to everyone". A non-friend account now sees only your profile picture.
- [ ] Verification: take the posed selfie. As admin, approve it in **Moderation → Verifications**. The verified badge appears, and the selfie is deleted.

### Friends, chat, calls (two devices)
- [ ] Search for the other account, send a friend request and accept it.
- [ ] Chat: messages arrive live, with typing indicator and read receipts.
- [ ] Video call: tap the call button in chat. The other phone rings, then answer, flip camera, mute and hang up. Also try declining a call.

### Rooms
- [ ] Create a **Voice** room. The other device joins, then speak, raise hand and mute.
- [ ] Create a **Video** room. Turn the camera on (needs verification for non-friends). Non-friends see a hidden tile until they tap **Tap to show video**.
- [ ] As host, switch someone's camera off. They get a notice and can't turn it back on.
- [ ] Report a video tile. The report shows up in **Moderation → Reports**.
- [ ] Room chat, reactions and invites.

### Games (two devices; Ludo, Werewolf and Truth or Dare allow more)
- [ ] Chess: legal moves only, check and checkmate, resign.
- [ ] Four in a Row: win detection.
- [ ] Ludo: roll, move out on a 6, capture, finish.
- [ ] Crazy Eights: as host, toggle house rules in the lobby, then play; an 8 lets you pick a suit.
- [ ] Truth or Dare: as host, choose turns and packs, then play; skip limits apply.
- [ ] Werewolf (4+ players): night and day phases, voting. A phase moves on automatically after 2 minutes if someone is idle.
- [ ] Joining by code works.

### Meeting people & staying close (two devices)
- [ ] Profile → Profile prompts: answer up to 3.
- [ ] Friend Swipe: both accounts swipe 👋 on each other, see "It's a match", and are friends. Try adding a note on a photo or prompt, which arrives as the first message.
- [ ] A skip is silent: the other person sees nothing.
- [ ] Home → Free to talk: set 30 min. The other phone sees you under "Free now".
- [ ] 👋 Wave from the Hang out button. Waving back within 10 minutes suggests a call.
- [ ] Chat: hold the mic to record a voice note, play it on the other phone, then delete it.
- [ ] Hang out sheet: voice call, video call, play a game (the join code is posted in chat), private room.
- [ ] Incoming call: Decline (the caller only sees "No answer"), Decline & block, Report. In a call, End call for everyone.
- [ ] Squads: create a squad with your friend, chat, start a squad hangout, set squad night.
- [ ] Slow Letters: both accounts tap "Find a pen pal" and write letters. In development, delays are 60× shorter (minutes instead of hours).
- [ ] Games: start a game, tap **Start call**, see the face bubbles; mute someone just for you; at the end, Add friend / Send a vibe.
- [ ] Rooms: create a room with **Repeat weekly**, end it, and see next week's room scheduled.
- [ ] Safety centre → Your rights & controls.

### Gems, ads, Plus
- [ ] Quests and streak give gems.
- [ ] Shop → **Watch for +20 gems** shows a Google *test* ad and adds gems. There's a daily cap.
- [ ] Shop: buy a chess board, card back or Ludo board with gems, equip it and see it in a game.
- [ ] Gem packs and Plus show "not available" until Google Play Billing is set up (they only work in builds installed from Play).

### Moments, events, safety
- [ ] Moments: share a moment card.
- [ ] Block someone, then confirm they disappear and can't message you.
- [ ] Safety Centre: report reasons, blocked list.
- [ ] Account: data export, and delete account (this removes all photos).

## What only works once hosted

These need the paid services from [deployment.md](deployment.md), so don't expect them on the laptop:

- Real photo moderation (in development every photo is auto-approved).
- Automatic live-video checks (need S3/R2 + Sightengine + the LiveKit webhook reaching a public URL).
- Real emails, Play Billing purchases, real AdMob ads.
