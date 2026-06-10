# 调度判定纯逻辑。BellItem 先行放置以解除 db.py 的并行开发依赖，
# 其余函数由 Task 2 实现。
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
