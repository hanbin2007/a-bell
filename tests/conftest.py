from pathlib import Path

import pytest


@pytest.fixture
def data_dir(tmp_path: Path) -> Path:
    (tmp_path / "ringtones").mkdir()
    return tmp_path


class FakePlayer:
    """记录调用、可注入失败的假播放器。"""

    def __init__(self):
        self.played: list[str] = []
        self.fail_times = 0

    async def ring(self, file_path: str, retries: int = 3, delay: float = 5.0):
        if self.fail_times > 0:
            self.fail_times -= 1
            from abell.player import PlayError

            raise PlayError("fake failure")
        self.played.append(file_path)


@pytest.fixture
def fake_player():
    return FakePlayer()
