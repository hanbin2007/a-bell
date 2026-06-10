"""FastAPI REST API — 单 sqlite 连接，所有路由必须 async（共跑事件循环线程，避免连接竞争）。"""
import asyncio
import contextlib
import re
from datetime import datetime
from pathlib import Path
from typing import Literal

from fastapi import BackgroundTasks, FastAPI, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, field_validator

from abell import db, engine
from abell.player import ensure_test_tone, scan_devices

ALLOWED_EXT = {".mp3", ".wav", ".flac", ".ogg"}
MAX_UPLOAD = 20 * 1024 * 1024
SETTING_KEYS = ("device_id", "airplay_password", "volume", "backend")


class ItemBody(BaseModel):
    time: str
    label: str = ""
    weekdays: str = "1111100"
    ringtone_id: int | None = None
    enabled: bool = True

    @field_validator("time")
    @classmethod
    def _time(cls, v):
        if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", v):
            raise ValueError("时间格式须为 HH:MM")
        return v

    @field_validator("weekdays")
    @classmethod
    def _mask(cls, v):
        if not re.fullmatch(r"[01]{7}", v):
            raise ValueError("weekdays 须为 7 位 0/1 掩码")
        return v


class NameBody(BaseModel):
    name: str


class SuspendBody(BaseModel):
    suspended: bool


class RingBody(BaseModel):
    ringtone_id: int | None = None


class CalendarBody(BaseModel):
    date: str
    kind: Literal["holiday", "workday"]
    note: str = ""

    @field_validator("date")
    @classmethod
    def _date(cls, v):
        try:
            datetime.strptime(v, "%Y-%m-%d")
        except ValueError:
            raise ValueError("日期格式须为 YYYY-MM-DD") from None
        return v


def _sanitize_stem(stem: str) -> str:
    return re.sub(r"[^A-Za-z0-9_\-一-鿿]", "_", stem)


def create_app(data_dir: Path, player, run_scheduler: bool = False) -> FastAPI:
    data_dir = Path(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "ringtones").mkdir(exist_ok=True)
    conn = db.connect(data_dir / "bell.db")

    @contextlib.asynccontextmanager
    async def lifespan(app):
        task = None
        if run_scheduler:
            from abell.scheduler import scheduler_loop

            task = asyncio.create_task(scheduler_loop(data_dir, player))
        yield
        if task:
            task.cancel()

    app = FastAPI(lifespan=lifespan)

    async def _ring_and_log(label: str, path: Path) -> None:
        try:
            await player.ring(str(path))
            db.add_log(conn, label, "ok")
        except Exception as e:  # noqa: BLE001 — 任何播放失败都记录
            db.add_log(conn, label, "fail", str(e))

    # ---- status / suspend / ring -------------------------------------------

    @app.get("/api/status")
    async def status():
        now = datetime.now()
        items = db.load_active_items(conn)
        overrides = db.load_overrides(conn)
        suspended = db.get_setting(conn, "suspended") == "1"
        nb = engine.next_bell(now, items, overrides, suspended)
        next_bell = None
        if nb:
            dt, it = nb
            next_bell = {
                "time": dt.isoformat(timespec="minutes"),
                "label": it.label,
                "seconds": int(max(0, (dt - now).total_seconds())),
            }
        row = conn.execute("SELECT id,name FROM schedules WHERE is_active=1").fetchone()
        fail = conn.execute(
            "SELECT ts,label,detail FROM ring_logs WHERE status='fail' ORDER BY id DESC LIMIT 1"
        ).fetchone()
        today = now.date().isoformat()
        return {
            "suspended": suspended,
            "active_schedule": {"id": row["id"], "name": row["name"]} if row else None,
            "today": {"date": today, "kind": overrides.get(today, "normal")},
            "next_bell": next_bell,
            "last_fail": dict(fail) if fail else None,
        }

    @app.post("/api/suspend")
    async def suspend(body: SuspendBody):
        db.set_setting(conn, "suspended", "1" if body.suspended else "0")
        return {"ok": True}

    @app.post("/api/ring")
    async def ring(body: RingBody, background: BackgroundTasks):
        rid = body.ringtone_id
        if rid is None:
            row = conn.execute("SELECT id FROM ringtones ORDER BY id LIMIT 1").fetchone()
            if not row:
                raise HTTPException(400, "请先上传铃声")
            rid = row["id"]
        path = db.ringtone_path(conn, rid, data_dir)
        if path is None or not path.exists():
            raise HTTPException(400, "铃声文件不存在")
        background.add_task(_ring_and_log, "手动打铃", path)
        return {"ok": True}

    # ---- schedules ----------------------------------------------------------

    @app.get("/api/schedules")
    async def list_schedules():
        out = []
        for s in conn.execute("SELECT * FROM schedules ORDER BY id").fetchall():
            items = conn.execute(
                "SELECT * FROM bell_items WHERE schedule_id=? ORDER BY time", (s["id"],)
            ).fetchall()
            out.append({**dict(s), "items": [dict(i) for i in items]})
        return out

    @app.post("/api/schedules")
    async def create_schedule(body: NameBody):
        cur = conn.execute("INSERT INTO schedules(name) VALUES(?)", (body.name,))
        return {"id": cur.lastrowid}

    @app.put("/api/schedules/{sid}")
    async def rename_schedule(sid: int, body: NameBody):
        cur = conn.execute("UPDATE schedules SET name=? WHERE id=?", (body.name, sid))
        if cur.rowcount == 0:
            raise HTTPException(404, "作息表不存在")
        return {"ok": True}

    @app.delete("/api/schedules/{sid}")
    async def delete_schedule(sid: int):
        row = conn.execute("SELECT is_active FROM schedules WHERE id=?", (sid,)).fetchone()
        if not row:
            raise HTTPException(404, "作息表不存在")
        if row["is_active"]:
            raise HTTPException(400, "不能删除当前启用的作息表")
        conn.execute("DELETE FROM schedules WHERE id=?", (sid,))
        return {"ok": True}

    @app.post("/api/schedules/{sid}/activate")
    async def activate_schedule(sid: int):
        if not conn.execute("SELECT 1 FROM schedules WHERE id=?", (sid,)).fetchone():
            raise HTTPException(404, "作息表不存在")
        conn.execute("UPDATE schedules SET is_active=0")
        conn.execute("UPDATE schedules SET is_active=1 WHERE id=?", (sid,))
        return {"ok": True}

    # ---- bell items ----------------------------------------------------------

    @app.post("/api/schedules/{sid}/items")
    async def create_item(sid: int, body: ItemBody):
        if not conn.execute("SELECT 1 FROM schedules WHERE id=?", (sid,)).fetchone():
            raise HTTPException(404, "作息表不存在")
        cur = conn.execute(
            "INSERT INTO bell_items(schedule_id,time,label,weekdays,ringtone_id,enabled) "
            "VALUES(?,?,?,?,?,?)",
            (sid, body.time, body.label, body.weekdays, body.ringtone_id, int(body.enabled)),
        )
        return {"id": cur.lastrowid}

    @app.put("/api/items/{iid}")
    async def update_item(iid: int, body: ItemBody):
        cur = conn.execute(
            "UPDATE bell_items SET time=?,label=?,weekdays=?,ringtone_id=?,enabled=? WHERE id=?",
            (body.time, body.label, body.weekdays, body.ringtone_id, int(body.enabled), iid),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "铃声条目不存在")
        return {"ok": True}

    @app.delete("/api/items/{iid}")
    async def delete_item(iid: int):
        cur = conn.execute("DELETE FROM bell_items WHERE id=?", (iid,))
        if cur.rowcount == 0:
            raise HTTPException(404, "铃声条目不存在")
        return {"ok": True}

    # ---- ringtones -----------------------------------------------------------

    @app.get("/api/ringtones")
    async def list_ringtones():
        rows = conn.execute(
            "SELECT id,name,filename,created_at FROM ringtones ORDER BY id"
        ).fetchall()
        return [dict(r) for r in rows]

    @app.post("/api/ringtones")
    async def upload_ringtone(file: UploadFile, name: str = Form("")):
        ext = Path(file.filename or "").suffix.lower()
        if ext not in ALLOWED_EXT:
            raise HTTPException(400, f"不支持的格式 {ext}，仅限 {' '.join(sorted(ALLOWED_EXT))}")
        data = await file.read()
        if len(data) > MAX_UPLOAD:
            raise HTTPException(400, "文件过大（上限 20MB）")
        stem = Path(file.filename or "ringtone").stem
        cur = conn.execute(
            "INSERT INTO ringtones(name,filename) VALUES(?,?)", (name or stem, "")
        )
        rid = cur.lastrowid
        filename = f"{rid}_{_sanitize_stem(stem)}{ext}"
        (data_dir / "ringtones" / filename).write_bytes(data)
        conn.execute("UPDATE ringtones SET filename=? WHERE id=?", (filename, rid))
        return {"id": rid}

    @app.put("/api/ringtones/{rid}")
    async def rename_ringtone(rid: int, body: NameBody):
        cur = conn.execute("UPDATE ringtones SET name=? WHERE id=?", (body.name, rid))
        if cur.rowcount == 0:
            raise HTTPException(404, "铃声不存在")
        return {"ok": True}

    @app.delete("/api/ringtones/{rid}")
    async def delete_ringtone(rid: int):
        path = db.ringtone_path(conn, rid, data_dir)
        cur = conn.execute("DELETE FROM ringtones WHERE id=?", (rid,))
        if cur.rowcount == 0:
            raise HTTPException(404, "铃声不存在")
        if path is not None:
            path.unlink(missing_ok=True)
        return {"ok": True}

    @app.get("/api/ringtones/{rid}/file")
    async def ringtone_file(rid: int):
        path = db.ringtone_path(conn, rid, data_dir)
        if path is None or not path.exists():
            raise HTTPException(404, "铃声文件不存在")
        return FileResponse(path)

    # ---- calendar ------------------------------------------------------------

    @app.get("/api/calendar")
    async def list_calendar():
        rows = conn.execute(
            "SELECT date,kind,note FROM calendar_overrides ORDER BY date"
        ).fetchall()
        return [dict(r) for r in rows]

    @app.post("/api/calendar")
    async def upsert_calendar(body: CalendarBody):
        conn.execute(
            "INSERT INTO calendar_overrides(date,kind,note) VALUES(?,?,?) "
            "ON CONFLICT(date) DO UPDATE SET kind=excluded.kind, note=excluded.note",
            (body.date, body.kind, body.note),
        )
        return {"ok": True}

    @app.delete("/api/calendar/{date}")
    async def delete_calendar(date: str):
        conn.execute("DELETE FROM calendar_overrides WHERE date=?", (date,))
        return {"ok": True}

    # ---- settings ------------------------------------------------------------

    @app.get("/api/settings")
    async def get_settings():
        out = {k: db.get_setting(conn, k) for k in SETTING_KEYS}
        out["backend"] = out["backend"] or "pyatv"
        return out

    @app.put("/api/settings")
    async def put_settings(body: dict):
        for k in SETTING_KEYS:
            if k in body:
                db.set_setting(conn, k, str(body[k]))
        return {"ok": True}

    # ---- device ---------------------------------------------------------------

    @app.get("/api/device/scan")
    async def device_scan():
        return await scan_devices()

    @app.post("/api/device/test")
    async def device_test(background: BackgroundTasks):
        path = ensure_test_tone(data_dir / "test-tone.wav")
        background.add_task(_ring_and_log, "测试播放", path)
        return {"ok": True}

    # ---- logs / frontend -------------------------------------------------------

    @app.get("/api/logs")
    async def logs(limit: int = 100):
        limit = min(max(limit, 1), 1000)
        rows = conn.execute(
            "SELECT id,ts,label,status,detail FROM ring_logs ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]

    @app.get("/")
    async def index():
        return FileResponse(Path(__file__).parent / "web" / "index.html")

    app.mount("/static", StaticFiles(directory=Path(__file__).parent / "web"), name="static")
    return app
