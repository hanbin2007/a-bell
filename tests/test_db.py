from abell import db
from abell.engine import BellItem


def make_conn(tmp_path):
    return db.connect(tmp_path / "t.db")


def test_settings_roundtrip(tmp_path):
    conn = make_conn(tmp_path)
    assert db.get_setting(conn, "suspended", "0") == "0"
    db.set_setting(conn, "suspended", "1")
    db.set_setting(conn, "suspended", "1")  # upsert 不报错
    assert db.get_setting(conn, "suspended") == "1"


def test_log_trim(tmp_path):
    conn = make_conn(tmp_path)
    for i in range(1005):
        db.add_log(conn, f"x{i}", "ok")
    n = conn.execute("SELECT COUNT(*) c FROM ring_logs").fetchone()["c"]
    assert n == 1000


def test_load_active_items_only_enabled_of_active_schedule(tmp_path):
    conn = make_conn(tmp_path)
    conn.execute("INSERT INTO schedules(name, is_active) VALUES('夏季',1)")
    conn.execute("INSERT INTO schedules(name, is_active) VALUES('冬季',0)")
    conn.execute("INSERT INTO bell_items(schedule_id,time,label,weekdays,enabled) VALUES(1,'08:00','早读','1111100',1)")
    conn.execute("INSERT INTO bell_items(schedule_id,time,label,weekdays,enabled) VALUES(1,'09:00','停用','1111100',0)")
    conn.execute("INSERT INTO bell_items(schedule_id,time,label,weekdays,enabled) VALUES(2,'10:00','冬季项','1111100',1)")
    items = db.load_active_items(conn)
    assert [i.label for i in items] == ["早读"]
    assert isinstance(items[0], BellItem)


def test_load_overrides(tmp_path):
    conn = make_conn(tmp_path)
    conn.execute("INSERT INTO calendar_overrides(date,kind,note) VALUES('2026-10-01','holiday','国庆')")
    assert db.load_overrides(conn) == {"2026-10-01": "holiday"}


def test_ringtone_path(tmp_path):
    conn = make_conn(tmp_path)
    conn.execute("INSERT INTO ringtones(name,filename) VALUES('上课铃','1_bell.mp3')")
    p = db.ringtone_path(conn, 1, tmp_path)
    assert p == tmp_path / "ringtones" / "1_bell.mp3"
    assert db.ringtone_path(conn, None, tmp_path) is None
    assert db.ringtone_path(conn, 99, tmp_path) is None
