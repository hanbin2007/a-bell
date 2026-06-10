from datetime import date, datetime

from abell.engine import BellItem, applies_on, due_now, next_bell


def item(**kw):
    base = dict(id=1, time="08:00", label="上课", weekdays="1111100", ringtone_id=1, enabled=True)
    base.update(kw)
    return BellItem(**base)


MON = date(2026, 6, 8)   # 周一
SAT = date(2026, 6, 13)  # 周六


def test_applies_weekday_mask():
    assert applies_on(item(), MON, None) is True
    assert applies_on(item(), SAT, None) is False
    assert applies_on(item(weekdays="0000011"), SAT, None) is True


def test_applies_disabled_and_holiday():
    assert applies_on(item(enabled=False), MON, None) is False
    assert applies_on(item(), MON, "holiday") is False


def test_applies_workday_override_forces_weekday_items():
    # 调休周六：周一~周五任一位为 1 的项要响
    assert applies_on(item(weekdays="1111100"), SAT, "workday") is True
    # 仅周末生效的项在调休工作日不响
    assert applies_on(item(weekdays="0000011"), SAT, "workday") is False


def test_due_now_matches_within_grace_and_dedups():
    it = item()
    now = datetime(2026, 6, 8, 8, 0, 30)
    fired: set = set()
    assert due_now(now, [it], {}, False, fired) == [it]
    fired.add(("2026-06-08", 1))
    assert due_now(now, [it], {}, False, fired) == []
    late = datetime(2026, 6, 8, 8, 1, 20)  # 80 秒后仍在 grace 内
    assert due_now(late, [it], {}, False, set()) == [it]
    too_late = datetime(2026, 6, 8, 8, 2, 0)
    assert due_now(too_late, [it], {}, False, set()) == []


def test_due_now_suspended():
    now = datetime(2026, 6, 8, 8, 0, 0)
    assert due_now(now, [item()], {}, True, set()) == []


def test_next_bell_same_day_and_skip_holiday():
    items = [item(id=1, time="08:00"), item(id=2, time="10:00", label="下课")]
    now = datetime(2026, 6, 8, 9, 0, 0)
    dt, it = next_bell(now, items, {}, False)
    assert (dt.hour, it.id) == (10, 2)
    # 周二全天假 → 跳到周三 08:00
    now2 = datetime(2026, 6, 8, 11, 0, 0)
    dt2, it2 = next_bell(now2, items, {"2026-06-09": "holiday"}, False)
    assert dt2 == datetime(2026, 6, 10, 8, 0)


def test_next_bell_none_when_suspended_or_empty():
    assert next_bell(datetime(2026, 6, 8, 9, 0), [], {}, False) is None
    assert next_bell(datetime(2026, 6, 8, 9, 0), [item()], {}, True) is None
