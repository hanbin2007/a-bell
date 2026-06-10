import sqlite3
from pathlib import Path

from abell.engine import BellItem

SCHEMA = """
CREATE TABLE IF NOT EXISTS schedules(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS ringtones(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  filename TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS bell_items(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  time TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  weekdays TEXT NOT NULL DEFAULT '1111100',
  ringtone_id INTEGER REFERENCES ringtones(id) ON DELETE SET NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS calendar_overrides(
  date TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('holiday','workday')),
  note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS settings(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ring_logs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  label TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ok','fail')),
  detail TEXT NOT NULL DEFAULT ''
);
"""


def connect(db_path: str | Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    # API 连接与调度器连接共存于同一数据库文件：WAL 允许读写并发，
    # busy_timeout 避免偶发写锁竞争直接报错
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.executescript(SCHEMA)
    conn.isolation_level = None  # autocommit
    return conn


def get_setting(conn, key: str, default: str = "") -> str:
    row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(conn, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO settings(key,value) VALUES(?,?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, value),
    )


def add_log(conn, label: str, status: str, detail: str = "") -> None:
    conn.execute(
        "INSERT INTO ring_logs(label,status,detail) VALUES(?,?,?)", (label, status, detail)
    )
    conn.execute(
        "DELETE FROM ring_logs WHERE id NOT IN "
        "(SELECT id FROM ring_logs ORDER BY id DESC LIMIT 1000)"
    )


def load_active_items(conn) -> list[BellItem]:
    rows = conn.execute(
        "SELECT b.* FROM bell_items b JOIN schedules s ON s.id=b.schedule_id "
        "WHERE s.is_active=1 AND b.enabled=1 ORDER BY b.time"
    ).fetchall()
    return [
        BellItem(
            id=r["id"], time=r["time"], label=r["label"], weekdays=r["weekdays"],
            ringtone_id=r["ringtone_id"], enabled=bool(r["enabled"]),
        )
        for r in rows
    ]


def load_overrides(conn) -> dict[str, str]:
    return {r["date"]: r["kind"] for r in conn.execute("SELECT date,kind FROM calendar_overrides")}


def ringtone_path(conn, ringtone_id, data_dir: Path):
    if ringtone_id is None:
        return None
    row = conn.execute("SELECT filename FROM ringtones WHERE id=?", (ringtone_id,)).fetchone()
    if not row:
        return None
    return Path(data_dir) / "ringtones" / row["filename"]
