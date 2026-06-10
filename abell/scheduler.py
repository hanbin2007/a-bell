import asyncio
import logging
from datetime import datetime
from pathlib import Path

from abell import db, engine

log = logging.getLogger("abell.scheduler")


async def scheduler_loop(data_dir: Path, player, tick: float = 10) -> None:
    data_dir = Path(data_dir)
    conn = db.connect(data_dir / "bell.db")
    fired: set[tuple[str, int]] = set()
    while True:
        try:
            now = datetime.now()
            items = db.load_active_items(conn)
            overrides = db.load_overrides(conn)
            suspended = db.get_setting(conn, "suspended", "0") == "1"
            for item in engine.due_now(now, items, overrides, suspended, fired):
                fired.add((now.date().isoformat(), item.id))
                path = db.ringtone_path(conn, item.ringtone_id, data_dir)
                if path is None or not path.exists():
                    db.add_log(conn, item.label, "fail", "铃声文件缺失或未设置")
                    continue
                try:
                    await player.ring(str(path))
                    db.add_log(conn, item.label, "ok")
                except Exception as e:  # noqa: BLE001
                    db.add_log(conn, item.label, "fail", str(e))
            today = now.date().isoformat()
            fired = {k for k in fired if k[0] == today}
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 — 调度循环永不退出
            log.exception("scheduler tick failed")
        await asyncio.sleep(tick)
