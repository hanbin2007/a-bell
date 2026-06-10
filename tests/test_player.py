import asyncio
import wave

import pytest

from abell.player import Player, PlayError, ensure_test_tone


def test_ensure_test_tone(tmp_path):
    p = ensure_test_tone(tmp_path / "tone.wav")
    assert p.exists()
    with wave.open(str(p)) as w:
        assert w.getframerate() == 44100
        assert 1.5 < w.getnframes() / w.getframerate() < 2.5
    # 幂等
    assert ensure_test_tone(p) == p


async def test_ring_retries_then_succeeds(monkeypatch):
    player = Player(lambda: {"backend": "pyatv", "device_id": "X"})
    attempts = []

    async def fake_play(path):
        attempts.append(path)
        if len(attempts) < 3:
            raise RuntimeError("offline")

    monkeypatch.setattr(player, "_play_once", fake_play)
    await player.ring("/tmp/a.mp3", retries=3, delay=0)
    assert len(attempts) == 3


async def test_ring_raises_playerror_after_all_retries(monkeypatch):
    player = Player(lambda: {"backend": "pyatv", "device_id": "X"})

    async def always_fail(path):
        raise RuntimeError("offline")

    monkeypatch.setattr(player, "_play_once", always_fail)
    with pytest.raises(PlayError):
        await player.ring("/tmp/a.mp3", retries=2, delay=0)


async def test_ring_serialized(monkeypatch):
    player = Player(lambda: {})
    order = []

    async def slow_play(path):
        order.append(f"start {path}")
        await asyncio.sleep(0.05)
        order.append(f"end {path}")

    monkeypatch.setattr(player, "_play_once", slow_play)
    await asyncio.gather(player.ring("a", delay=0), player.ring("b", delay=0))
    assert order in (["start a", "end a", "start b", "end b"],
                     ["start b", "end b", "start a", "end a"])


async def test_pyatv_requires_device_id():
    player = Player(lambda: {"backend": "pyatv", "device_id": ""})
    with pytest.raises(PlayError, match="设备"):
        await player.ring("/tmp/a.mp3", retries=1, delay=0)
