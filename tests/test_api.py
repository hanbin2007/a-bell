import io

from fastapi.testclient import TestClient

from abell.api import create_app


def make_client(data_dir, fake_player):
    app = create_app(data_dir, fake_player)
    return TestClient(app)


def test_schedule_crud_and_activate(data_dir, fake_player):
    c = make_client(data_dir, fake_player)
    sid = c.post("/api/schedules", json={"name": "夏季"}).json()["id"]
    sid2 = c.post("/api/schedules", json={"name": "冬季"}).json()["id"]
    assert c.post(f"/api/schedules/{sid}/activate").json() == {"ok": True}
    lst = c.get("/api/schedules").json()
    assert [s["is_active"] for s in lst] == [1, 0]
    # active 不可删
    assert c.delete(f"/api/schedules/{sid}").status_code == 400
    assert c.delete(f"/api/schedules/{sid2}").json() == {"ok": True}


def test_items_crud(data_dir, fake_player):
    c = make_client(data_dir, fake_player)
    sid = c.post("/api/schedules", json={"name": "夏季"}).json()["id"]
    body = {"time": "08:00", "label": "早读", "weekdays": "1111100", "ringtone_id": None, "enabled": True}
    iid = c.post(f"/api/schedules/{sid}/items", json=body).json()["id"]
    body["label"] = "升旗"
    assert c.put(f"/api/items/{iid}", json=body).json() == {"ok": True}
    assert c.get("/api/schedules").json()[0]["items"][0]["label"] == "升旗"
    assert c.delete(f"/api/items/{iid}").json() == {"ok": True}
    # 非法时间/掩码
    bad = dict(body, time="25:00")
    assert c.post(f"/api/schedules/{sid}/items", json=bad).status_code == 422
    bad = dict(body, weekdays="11")
    assert c.post(f"/api/schedules/{sid}/items", json=bad).status_code == 422


def test_ringtone_upload_download_delete(data_dir, fake_player):
    c = make_client(data_dir, fake_player)
    f = {"file": ("bell.mp3", io.BytesIO(b"fake-mp3-bytes"), "audio/mpeg")}
    rid = c.post("/api/ringtones", files=f, data={"name": "上课铃"}).json()["id"]
    assert c.get("/api/ringtones").json()[0]["name"] == "上课铃"
    assert c.get(f"/api/ringtones/{rid}/file").content == b"fake-mp3-bytes"
    assert c.delete(f"/api/ringtones/{rid}").json() == {"ok": True}
    assert not list((data_dir / "ringtones").iterdir())
    # 非法扩展名
    f = {"file": ("x.m4a", io.BytesIO(b"x"), "audio/mp4")}
    assert c.post("/api/ringtones", files=f).status_code == 400


def test_calendar_upsert_and_delete(data_dir, fake_player):
    c = make_client(data_dir, fake_player)
    c.post("/api/calendar", json={"date": "2026-10-01", "kind": "holiday", "note": "国庆"})
    c.post("/api/calendar", json={"date": "2026-10-01", "kind": "workday", "note": "改"})
    lst = c.get("/api/calendar").json()
    assert lst == [{"date": "2026-10-01", "kind": "workday", "note": "改"}]
    assert c.delete("/api/calendar/2026-10-01").json() == {"ok": True}


def test_settings_and_suspend(data_dir, fake_player):
    c = make_client(data_dir, fake_player)
    c.put("/api/settings", json={"device_id": "AA:BB", "volume": "40"})
    s = c.get("/api/settings").json()
    assert s["device_id"] == "AA:BB" and s["volume"] == "40" and s["backend"] == "pyatv"
    c.post("/api/suspend", json={"suspended": True})
    assert c.get("/api/status").json()["suspended"] is True


def test_status_next_bell_and_manual_ring(data_dir, fake_player):
    c = make_client(data_dir, fake_player)
    sid = c.post("/api/schedules", json={"name": "夏季"}).json()["id"]
    c.post(f"/api/schedules/{sid}/activate")
    f = {"file": ("bell.wav", io.BytesIO(b"x"), "audio/wav")}
    rid = c.post("/api/ringtones", files=f, data={"name": "铃"}).json()["id"]
    c.post(f"/api/schedules/{sid}/items",
           json={"time": "23:59", "label": "晚自习", "weekdays": "1111111", "ringtone_id": rid, "enabled": True})
    st = c.get("/api/status").json()
    assert st["next_bell"]["label"] == "晚自习" and st["next_bell"]["seconds"] >= 0
    # 手动打铃（后台任务，TestClient 同步等待 background task 完成）
    assert c.post("/api/ring", json={}).json() == {"ok": True}
    assert len(fake_player.played) == 1
    logs = c.get("/api/logs").json()
    assert logs[0]["status"] == "ok" and "手动" in logs[0]["label"]


def test_manual_ring_without_ringtone_400(data_dir, fake_player):
    c = make_client(data_dir, fake_player)
    assert c.post("/api/ring", json={}).status_code == 400
