"""Public web pages required for store listings: legal documents and web-based account deletion.

The legal text describes what this codebase actually does. Have it reviewed by a lawyer and fill
in the operator details (company name, address, contact) before launch.
"""

import html

from fastapi import APIRouter, Form, Request
from fastapi.responses import HTMLResponse
from sqlalchemy import select

from app.core.config import get_settings
from app.core.database import session_factory
from app.core.exceptions import AppError
from app.models import User
from app.services import account
from app.services.rate_limit import client_ip, hit

router = APIRouter(include_in_schema=False)

CONTACT = "privacy@veyvo.app"
SAFETY_CONTACT = "safety@veyvo.app"
UPDATED = "15 October 2026"

_STYLE = """
:root{--bg:#10111A;--surface:#191B28;--text:#F5F5FB;--muted:#A5A8BA;--accent:#9385FF;--coral:#FF8F9A;--line:#2A2C40}
@media (prefers-color-scheme: light){:root{--bg:#F7F6FB;--surface:#FFFFFF;--text:#181926;--muted:#5D6074;--accent:#5B4BE0;--coral:#D9485A;--line:#E3E2EC}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.65 Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:40px 20px 80px}
.brand{font-weight:800;letter-spacing:-.02em;font-size:22px;color:var(--accent);text-decoration:none}
h1{font-size:32px;line-height:1.2;letter-spacing:-.02em;margin:24px 0 4px}h2{font-size:20px;margin:32px 0 8px}
p,li{color:var(--text)}.muted{color:var(--muted)}a{color:var(--accent)}
nav a{margin-right:16px;font-size:14px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:20px;margin-top:20px}
label{display:block;font-weight:600;margin:14px 0 6px}input{width:100%;padding:12px 14px;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:16px}
button{margin-top:20px;background:var(--coral);color:#fff;border:0;border-radius:12px;padding:13px 18px;font-weight:700;font-size:16px;cursor:pointer}
.ok{border-color:#43CFA0}.err{border-color:var(--coral)}
"""


def _page(title: str, body: str) -> HTMLResponse:
    nav = (
        '<nav><a href="/legal/privacy">Privacy</a><a href="/legal/terms">Terms</a>'
        '<a href="/legal/guidelines">Guidelines</a><a href="/legal/child-safety">Child safety</a>'
        '<a href="/account/delete">Delete account</a></nav>'
    )
    doc = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)} · Veyvo</title><meta name="robots" content="index,follow"><style>{_STYLE}</style></head>
<body><main><a class="brand" href="/legal/privacy">Veyvo</a>{nav}{body}</main></body></html>"""
    return HTMLResponse(
        doc, headers={"Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY"}
    )


@router.get("/legal/privacy", response_class=HTMLResponse)
async def privacy():
    return _page(
        "Privacy Policy",
        f"""
<h1>Privacy Policy</h1><p class="muted">Last updated {UPDATED}</p>
<p>Veyvo is built to collect as little about you as possible. This policy explains exactly what we store, why, and how to control it.</p>
<h2>What we collect</h2>
<ul>
<li><strong>Account:</strong> your email address and a securely hashed password (Argon2id). We never see or store your password itself.</li>
<li><strong>Age confirmation:</strong> you enter your date of birth at sign-up so we can confirm you are 18 or older. <strong>We do not store your date of birth</strong> — only the fact and time that you confirmed you're an adult.</li>
<li><strong>Profile:</strong> your username, display name, optional bio, interests, an optional "vibe" status and up to 6 profile photos you choose to upload. Photos are re-saved on our servers, which <strong>removes hidden location (GPS) and device data</strong>, and are checked for safety before others can see them.</li>
<li><strong>Selfie verification (optional):</strong> if you ask to be verified, you take one selfie doing a pose. A reviewer (or an automated check) compares it with your profile photos. <strong>The selfie is deleted as soon as it has been reviewed.</strong> We keep only whether you are verified. We don't build or keep a facial template.</li>
<li><strong>Profile prompts (optional):</strong> up to 3 short answers to fun prompts, shown on your profile.</li>
<li><strong>Activity you create:</strong> friend connections, direct messages and voice notes you send, hangout and squad chat, community posts, game scores, Daily Question answers, vibes (compliments), gems and quest progress.</li>
<li><strong>Friend Swipe:</strong> who you chose to connect with or skip, so we don't show you the same people again. Skips are never shown to anyone, and nobody can see who liked them.</li>
<li><strong>Slow Letters (optional):</strong> letters you write to pen pals, and, while you're looking for a pen pal, your device's time-zone offset from UTC (for example "+5:30"). We use it only to pair people in different time zones and to work out how long a letter takes to arrive. It is never shown to anyone and isn't a location.</li>
<li><strong>"Free to talk" status (optional):</strong> when you set it, friends can see you're free until the time you chose.</li>
<li><strong>Safety records:</strong> reports you file or that are filed about content, and records of moderation actions.</li>
<li><strong>Device:</strong> a push notification token if you allow notifications, and the platform (Android/iOS) of signed-in devices.</li>
<li><strong>Crash and error reports:</strong> when the app crashes or hits an error, it sends us an anonymous technical report: the error message and code location, app version, device platform and OS version, which screen you were on, and a random install ID that is reset when you sign out. Reports never include your name, email, account ID, messages or anything you've written.</li>
</ul>
<h2>What we don't collect</h2>
<ul><li>No real name, phone number, contacts, location or date of birth. Photo location data is stripped on upload.</li>
<li>No IP address storage. IPs are used briefly, in hashed form, only to limit abuse (rate limiting) and then expire.</li>
<li>We don't store advertising identifiers, and we never sell or rent your data or use data brokers. If ads are shown, Google AdMob may use your device's advertising ID under its own policy and your consent choices.</li>
<li>Voice and video in hangouts and calls are relayed live and <strong>are not recorded</strong> by Veyvo. Your camera and microphone are only used while you turn them on.</li><li><strong>Live video safety checks:</strong> while your camera is on in a hangout that isn't a private call with a friend, we take a still image of your video every few seconds and run it through an automated image-safety check. Images that pass are deleted straight away. If an image may break our guidelines, that single image is kept as evidence for our safety team to review, and if it is clearly unsafe your camera is switched off for that hangout. Private calls between friends are not checked this way.</li></ul>
<h2>How we use it</h2>
<p>To run the service (accounts, messaging, hangouts, games), keep people safe (reports, moderation, blocking), and send notifications you've enabled. Notification previews of messages are <strong>off by default</strong>.</p>
<h2>Who can see what</h2>
<ul><li>Messages can only be exchanged between friends, and only if both people allow it.</li>
<li>Online status is shown only to friends, and you can turn it off. Turning it off also turns off read receipts.</li>
<li>You can make your profile friends-only, hide your interests, hide from search, and control who can send friend requests or invites.</li>
<li>Your profile picture is visible to other members. You can limit your other photos to friends only.</li>
<li>Video from people who aren't your friends stays hidden until you choose to show it.</li>
<li>Your email is never shown to other users.</li></ul>
<h2>How long we keep data</h2>
<ul><li>Hangout chat: 30 days, then deleted automatically.</li><li>Notifications: 90 days.</li>
<li>Report evidence: cleared 180 days after a report is resolved.</li>
<li>Verification selfies: deleted immediately after review.</li><li>Live video safety images: deleted right after the check, unless flagged (then kept with the report).</li>
<li>Profile photos: until you delete them or your account (deleted photos are removed from storage).</li>
<li>Direct messages and voice notes: until you or the other person deletes them, or an account is deleted (deleted voice notes are removed from storage).</li>
<li>Letters and squad chat: until the sender deletes their account. Ending a pen pal connection hides the letters from both people.</li>
<li>Pen-pal time-zone offset: kept only while you're looking for a pen pal or have an active pen pal, and cleared when you stop looking or the connection ends.</li>
<li>Everything else: until you delete your account.</li></ul>
<h2>Your rights and controls</h2>
<ul><li><strong>Download your data:</strong> Settings → Account → Download my data.</li>
<li><strong>In-app controls:</strong> see Safety centre → Your rights &amp; controls for everything you can do: decline or end calls, hide anyone's video, leave instantly, block, report, hide from Friend Swipe and turn off pen pal matching.</li>
<li><strong>Delete your account:</strong> in the app (Settings → Account → Delete account) or on the web at <a href="/account/delete">/account/delete</a>. Deletion is permanent and immediate: your profile, messages you sent, chat, posts, friendships and all other personal data are erased. Reports you filed are kept without your identity so open safety reviews can finish.</li>
<li>You can also contact us at <a href="mailto:{CONTACT}">{CONTACT}</a> to access, correct or delete your data.</li></ul>
<h2>Security</h2><p>Data is encrypted in transit (HTTPS/TLS). Passwords are hashed with Argon2id, sign-in tokens are short-lived and rotate, and staff access to moderation tools is role-restricted and audited.</p>
<h2>Service providers</h2><p>We use infrastructure providers to host the service, send email codes and deliver push notifications, a real-time media provider to relay live voice and video, private cloud storage for photos, and (where enabled) an image-safety service that checks uploaded photos and still images from live video in hangouts. If enabled, an error-tracking provider (Sentry) processes crash reports and server errors without personal data. Payments are processed by Google Play and ads by Google AdMob, under their own privacy policies. They process data only on our instructions.</p>
<h2>Adults only</h2><p>Veyvo is for people aged 18 and over. If we learn an account belongs to someone younger, we delete it.</p>
<h2>Changes</h2><p>We'll notify you in the app before material changes take effect.</p>
<p class="muted">Contact: <a href="mailto:{CONTACT}">{CONTACT}</a></p>""",
    )


@router.get("/legal/terms", response_class=HTMLResponse)
async def terms():
    return _page(
        "Terms of Service",
        f"""
<h1>Terms of Service</h1><p class="muted">Last updated {UPDATED}</p>
<h2>1. Who can use Veyvo</h2><p>You must be at least 18 years old. You may hold one account, and the information you give us must be accurate.</p>
<h2>2. Your content</h2><p>You own what you post. You give Veyvo a limited licence to store and display it to the people you share it with, only to operate the service. Don't post anything you don't have the right to share.</p>
<h2>3. Community Guidelines</h2><p>You agree to follow the <a href="/legal/guidelines">Community Guidelines</a>. We may remove content, limit features, suspend or ban accounts that break them.</p>
<h2>4. Virtual items</h2><p>Gems and cosmetic items have no cash value, can't be exchanged for money, and are not transferable. Any future purchases will be processed by the app store and governed by its terms.</p>
<h2>5. Safety tools are always free</h2><p>Blocking, reporting, privacy controls and leaving a room are available to everyone at no cost.</p>
<h2>6. Ending your account</h2><p>You can delete your account at any time. We may suspend or end accounts that violate these terms or put others at risk.</p>
<h2>7. Disclaimers</h2><p>Veyvo is provided "as is". We work hard to keep it safe but can't guarantee other users' behaviour. Use your judgement and report anything that feels wrong.</p>
<h2>8. Changes</h2><p>We'll give notice in the app before material changes take effect.</p>
<p class="muted">Contact: <a href="mailto:{CONTACT}">{CONTACT}</a></p>""",
    )


@router.get("/legal/guidelines", response_class=HTMLResponse)
async def guidelines():
    return _page(
        "Community Guidelines",
        f"""
<h1>Community Guidelines</h1><p class="muted">Last updated {UPDATED}</p>
<p>Veyvo is a place to hang out, play and make friends. These rules keep it that way.</p>
<h2>Be kind</h2><p>No harassment, bullying, hate speech, threats or encouraging self-harm.</p>
<h2>Adults only</h2><p>You must be 18+. Never pretend to be younger or older than you are. Report anyone who appears to be under 18.</p>
<h2>Keep it safe</h2><p>No sexual content, nudity, graphic violence or illegal activity. No sexualising anyone, ever.</p>
<h2>Respect privacy</h2><p>Don't share other people's personal information, private messages or recordings without consent. Don't record voice rooms.</p>
<h2>Be real</h2><p>No impersonation, fake accounts, spam, scams or misleading links.</p>
<h2>Play fair</h2><p>No cheating, exploiting bugs or manipulating games and rewards.</p>
<h2>If something goes wrong</h2><p>Leave any room instantly, block anyone, and use Report from a profile, message, room or community. Reports are confidential: the person is not told who reported them.</p>
<h2>Enforcement</h2><p>Depending on severity: content removal, warnings, temporary suspension or permanent ban. Severe harm, including any child exploitation, results in an immediate ban and reporting to authorities.</p>
<p class="muted">Safety contact: <a href="mailto:{SAFETY_CONTACT}">{SAFETY_CONTACT}</a></p>""",
    )


@router.get("/legal/child-safety", response_class=HTMLResponse)
async def child_safety():
    return _page(
        "Child Safety Standards",
        f"""
<h1>Child Safety Standards</h1><p class="muted">Last updated {UPDATED}</p>
<p>Veyvo has zero tolerance for child sexual abuse and exploitation (CSAE), including child sexual abuse material (CSAM), grooming, and any sexualisation of minors.</p>
<h2>Our standards</h2>
<ul><li><strong>Adults only:</strong> accounts require confirming an age of 18+ at sign-up. Accounts found to belong to minors are removed.</li>
<li><strong>Photo safety:</strong> every profile photo is checked before anyone else can see it, and location data is removed. There is no sharing of photos or videos in chat.</li>
<li><strong>Camera safeguards:</strong> cameras are off by default. Only selfie-verified members can use their camera with people who aren't their friends, video from strangers stays hidden until a viewer chooses to show it, hosts can turn off anyone's camera, and every video tile has Report and Block.</li>
<li><strong>Limited contact:</strong> direct messages are only possible between mutual friends who both allow messages.</li>
<li><strong>In-app reporting:</strong> every profile, message, room and community has a Report option, including a dedicated "User may be under 18" reason.</li>
<li><strong>Moderation:</strong> reports are reviewed by trained moderators. Violations lead to immediate permanent bans.</li>
<li><strong>Legal compliance:</strong> we comply with applicable child safety laws and report apparent CSAM to the relevant authorities, such as NCMEC or regional equivalents.</li></ul>
<h2>Contact</h2><p>Our designated child safety point of contact can be reached at <a href="mailto:{SAFETY_CONTACT}">{SAFETY_CONTACT}</a>.</p>""",
    )


def _delete_form(message: str = "", ok: bool = False) -> HTMLResponse:
    note = f'<div class="card {"ok" if ok else "err"}">{html.escape(message)}</div>' if message else ""
    if ok:
        return _page("Account deleted", f"<h1>Account deleted</h1>{note}")
    return _page(
        "Delete your account",
        f"""
<h1>Delete your Veyvo account</h1>
<p>You can also do this in the app: <strong>Profile → Settings → Account → Delete account</strong>.</p>
<p class="muted">Deleting is permanent and happens immediately. Your profile, photos, messages you sent, hangout chat, posts, friendships, gems and items are erased. Reports you filed are kept without your identity so open safety reviews can finish.</p>
{note}
<form class="card" method="post" action="/account/delete" autocomplete="off">
<label for="email">Email</label><input id="email" name="email" type="email" required maxlength="320">
<label for="password">Password</label><input id="password" name="password" type="password" required maxlength="128">
<label for="confirm">Type DELETE to confirm</label><input id="confirm" name="confirm" required maxlength="10">
<button type="submit">Permanently delete my account</button>
</form>
<p class="muted">Forgot your password? Reset it in the app first, or email <a href="mailto:{CONTACT}">{CONTACT}</a>.</p>""",
    )


@router.get("/account/delete", response_class=HTMLResponse)
async def delete_page():
    return _delete_form()


@router.post("/account/delete", response_class=HTMLResponse)
async def delete_submit(
    request: Request, email: str = Form(max_length=320), password: str = Form(max_length=128), confirm: str = Form(max_length=10)
):
    try:
        await hit("login", client_ip(request))
    except AppError as exc:
        return _delete_form(exc.message)
    if confirm.strip().upper() != "DELETE":
        return _delete_form("Please type DELETE to confirm.")
    async with session_factory()() as db:
        user = await db.scalar(select(User).where(User.email == email.strip().lower()))
        try:
            if user is None:
                raise AppError("Email or password is incorrect.")
            await account.delete_account(db, user, password)
        except AppError:
            return _delete_form("Email or password is incorrect.")
    return _delete_form("Your account and personal data have been permanently deleted.", ok=True)


@router.get("/", response_class=HTMLResponse)
async def index():
    settings = get_settings()
    return _page(
        "Veyvo",
        f"""<h1>Meet your people. Find your vibe. Hang out together.</h1>
<p class="muted">This is the {html.escape(settings.app_name)} API server. Get the app on Google Play.</p>""",
    )
