import asyncio
from pathlib import Path

from abell import db
from abell.scheduler import scheduler_loop


def seed(data_dir: Path, time_str: str):
    conn = db.connect(data_dir / "bell.db")
    (data_dir / "ringtones").mkdir(exist_ok=True)
    conn.execute("INSERT INTO schedules(name,is_active) VALUES('s',1)")
    conn.execute("INSERT INTO ringtones(name,filename) VALUES('r','1_r.wav')")
    (data_dir / "ringtones" / "1_r.wav").write_bytes(b"x")
    conn.execute(
        "INSERT INTO bell_items(schedule_id,time,label,weekdays,ringtone_id,enabled) "
        "VALUES(1,?,'测试铃','1111111',1,1)", (time_str,),
    )
    return conn


async def run_loop_briefly(data_dir, player, seconds=0.3):
    task = asyncio.create_task(scheduler_loop(data_dir, player, tick=0.05))
    await asyncio.sleep(seconds)
    task.cancel()


async def test_rings_due_item_once_and_logs_ok(data_dir, fake_player):
    from datetime import datetime
    now = datetime.now().strftime("%H:%M")
    conn = seed(data_dir, now)
    await run_loop_briefly(data_dir, fake_player)
    assert len(fake_player.played) == 1          # 多个 tick 只响一次
    assert fake_player.played[0].endswith("1_r.wav")
    log = conn.execute("SELECT * FROM ring_logs").fetchone()
    assert log["status"] == "ok" and log["label"] == "测试铃"


async def test_logs_fail_when_player_fails(data_dir, fake_player):
    from datetime import datetime
    now = datetime.now().strftime("%H:%M")
    conn = seed(data_dir, now)
    fake_player.fail_times = 99
    await run_loop_briefly(data_dir, fake_player)
    log = conn.execute("SELECT * FROM ring_logs").fetchone()
    assert log["status"] == "fail" and "fake failure" in log["detail"]


async def test_missing_ringtone_logs_fail(data_dir, fake_player):
    from datetime import datetime
    now = datetime.now().strftime("%H:%M")
    conn = seed(data_dir, now)
    (data_dir / "ringtones" / "1_r.wav").unlink()
    await run_loop_briefly(data_dir, fake_player)
    log = conn.execute("SELECT * FROM ring_logs").fetchone()
    assert log["status"] == "fail" and fake_player.played == []
