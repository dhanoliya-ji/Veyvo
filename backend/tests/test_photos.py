import io
import uuid

from PIL import Image

from app.core.storage import get_storage
from tests.conftest import befriend, make_user, set_role


def jpeg_with_gps(size=(800, 600), color=(120, 90, 200)) -> bytes:
    img = Image.new("RGB", size, color)
    exif = Image.Exif()
    exif[0x8825] = {1: "N", 2: (12.0, 58.0, 0.0), 3: "E", 4: (77.0, 35.0, 0.0)}  # GPSInfo
    exif[0x0110] = "SecretPhone 9"  # camera model
    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif)
    return buf.getvalue()


async def upload(client, user, data=None, name="p.jpg"):
    return await client.post("/me/photos", files={"file": (name, data or jpeg_with_gps(), "image/jpeg")}, headers=user["headers"])


async def test_upload_strips_location_and_appears_in_profile(client):
    u, viewer = await make_user(client), await make_user(client)
    raw = jpeg_with_gps()
    assert Image.open(io.BytesIO(raw)).getexif().get(0x8825)  # the original really has GPS
    r = await upload(client, u, raw)
    assert r.status_code == 201, r.text
    photo = r.json()
    assert photo["status"] == "approved"  # auto-approved only in development/test
    key = photo["url"].split("/media/")[1].split("?")[0]
    stored = Image.open(io.BytesIO(get_storage().get(key)))
    assert not stored.getexif()  # no EXIF at all: GPS and device info are gone

    prof = (await client.get(f"/users/{u['id']}", headers=viewer["headers"])).json()
    assert prof["photo_url"] and prof["photos"][0]["id"] == photo["id"]
    # Signed URL works; tampered signature doesn't.
    assert photo["url"].startswith("http://test/media/")  # built from the request host, so phones on the LAN can load it
    path = photo["url"].split("http://test")[1]
    import httpx

    from app.main import app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as raw_client:
        assert (await raw_client.get(path)).status_code == 200
        assert (await raw_client.get(path[:-4] + "0000")).status_code == 404


async def test_rejects_non_images_and_enforces_limit(client):
    u = await make_user(client)
    r = await upload(client, u, b"not an image at all", "x.jpg")
    assert r.status_code == 422
    small = io.BytesIO()
    Image.new("RGB", (50, 50)).save(small, format="PNG")
    assert (await upload(client, u, small.getvalue(), "s.png")).status_code == 422
    for _ in range(6):
        assert (await upload(client, u)).status_code == 201
    assert (await upload(client, u)).status_code == 409


async def test_friends_only_photos_and_delete(client):
    owner, friend, stranger = (
        await make_user(client, privacy={"photo_visibility": "friends"}),
        await make_user(client),
        await make_user(client),
    )
    await befriend(client, owner, friend)
    ids = [(await upload(client, owner)).json()["id"] for _ in range(3)]
    assert len((await client.get(f"/users/{owner['id']}/photos", headers=stranger["headers"])).json()) == 1  # profile pic only
    assert len((await client.get(f"/users/{owner['id']}/photos", headers=friend["headers"])).json()) == 3
    # Reorder and delete keep the profile picture in sync.
    await client.put("/me/photos/order", json={"ids": [ids[2], ids[0], ids[1]]}, headers=owner["headers"])
    assert (await client.get("/me/photos", headers=owner["headers"])).json()[0]["id"] == ids[2]
    assert (await client.delete(f"/me/photos/{ids[2]}", headers=owner["headers"])).status_code == 200
    assert (await client.delete(f"/me/photos/{ids[0]}", headers=friend["headers"])).status_code == 404
    assert len((await client.get("/me/photos", headers=owner["headers"])).json()) == 2


async def test_verification_flow(client):
    u, mod = await make_user(client), await make_user(client)
    status = (await client.get("/me/verification", headers=u["headers"])).json()
    assert status["verified"] is False and status["gesture"]
    files = {"file": ("selfie.jpg", jpeg_with_gps(), "image/jpeg")}
    # Needs a profile photo first.
    assert (
        await client.post("/me/verification", data={"gesture": status["gesture"]}, files=files, headers=u["headers"])
    ).status_code == 409
    await upload(client, u)
    r = await client.post("/me/verification", data={"gesture": status["gesture"]}, files=files, headers=u["headers"])
    assert r.json()["request_status"] == "pending"
    # Regular users can't review.
    assert (await client.get("/moderation/verifications", headers=u["headers"])).status_code == 403
    await set_role(mod["email"], "moderator")
    queue = (await client.get("/moderation/verifications", headers=mod["headers"])).json()
    assert queue[0]["user"]["id"] == u["id"] and queue[0]["selfie_url"]
    selfie_key = queue[0]["selfie_url"].split("/media/")[1].split("?")[0]
    assert (
        await client.post(f"/moderation/verifications/{queue[0]['id']}", json={"decision": "approve"}, headers=mod["headers"])
    ).status_code == 200
    assert get_storage().get(selfie_key) is None  # selfie deleted right after review
    me = (await client.get("/me", headers=u["headers"])).json()
    assert me["verified"] is True
    viewer = await make_user(client)
    assert (await client.get(f"/users/{u['id']}", headers=viewer["headers"])).json()["verified"] is True


async def test_account_deletion_removes_files_and_report_photo(client):
    u, reporter = await make_user(client), await make_user(client)
    photo = (await upload(client, u)).json()
    key = photo["url"].split("/media/")[1].split("?")[0]
    r = await client.post(
        "/reports", json={"target_type": "photo", "target_id": photo["id"], "reason": "sexual"}, headers=reporter["headers"]
    )
    assert r.status_code == 201
    await client.post("/me/delete", json={"password": u["password"], "confirm": "DELETE"}, headers=u["headers"])
    assert get_storage().get(key) is None
    assert (await client.get(f"/users/{u['id']}/photos", headers=reporter["headers"])).status_code == 404
    assert uuid.UUID(photo["id"])
