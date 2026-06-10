"""调度判定纯逻辑 — 决定哪些铃声应在何时触发。

BellItem 先行放置以解除 db.py 的并行开发依赖。
"""
from dataclasses import dataclass
from datetime import date, datetime, timedelta


@dataclass(frozen=True)
class BellItem:
    id: int
    time: str          # "HH:MM"
    label: str
    weekdays: str      # 7 位掩码，index 0=周一，'1'=生效
    ringtone_id: int | None
    enabled: bool


def applies_on(item: BellItem, day: date, override: str | None) -> bool:
    if not item.enabled:
        return False
    if override == "holiday":
        return False
    if override == "workday":
        return "1" in item.weekdays[0:5]
    return item.weekdays[day.weekday()] == "1"


def _item_dt(item: BellItem, day: date) -> datetime:
    h, m = map(int, item.time.split(":"))
    return datetime(day.year, day.month, day.day, h, m)


def due_now(now, items, overrides, suspended, fired, grace: int = 90):
    if suspended:
        return []
    day = now.date()
    override = overrides.get(day.isoformat())
    out = []
    for it in items:
        if not applies_on(it, day, override):
            continue
        if (day.isoformat(), it.id) in fired:
            continue
        delta = (now - _item_dt(it, day)).total_seconds()
        if 0 <= delta <= grace:
            out.append(it)
    return out


def next_bell(now, items, overrides, suspended, days_ahead: int = 14):
    if suspended:
        return None
    for offset in range(days_ahead):
        day = now.date() + timedelta(days=offset)
        override = overrides.get(day.isoformat())
        candidates = [
            (_item_dt(it, day), it)
            for it in items
            if applies_on(it, day, override) and _item_dt(it, day) > now
        ]
        if candidates:
            return min(candidates, key=lambda c: c[0])
    return None
