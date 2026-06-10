import asyncio
import math
import struct
import wave
from pathlib import Path
from typing import Callable


class PlayError(Exception):
    pass


class Player:
    """串行化的铃声播放器。settings_getter() 返回 settings 键值 dict。"""

    def __init__(self, settings_getter: Callable[[], dict]):
        self._get = settings_getter
        self._lock = asyncio.Lock()

    async def ring(self, file_path: str, retries: int = 3, delay: float = 5.0) -> None:
        async with self._lock:
            last: Exception | None = None
            for attempt in range(retries):
                try:
                    await self._play_once(str(file_path))
                    return
                except Exception as e:  # noqa: BLE001 — 任何失败都重试
                    last = e
                    if attempt < retries - 1:
                        await asyncio.sleep(delay)
            raise PlayError(f"播放失败（重试 {retries} 次）：{last}")

    async def _play_once(self, file_path: str) -> None:
        settings = self._get()
        if settings.get("backend") == "afplay":
            proc = await asyncio.create_subprocess_exec("afplay", file_path)
            if await proc.wait() != 0:
                raise PlayError("afplay 退出码非 0")
            return
        await self._play_pyatv(file_path, settings)

    async def _play_pyatv(self, file_path: str, settings: dict) -> None:
        import pyatv
        from pyatv.const import Protocol

        device_id = settings.get("device_id") or ""
        if not device_id:
            raise PlayError("未配置 HomePod 设备，请在「设备」页扫描并选择")
        loop = asyncio.get_running_loop()
        confs = await pyatv.scan(loop, identifier=device_id, timeout=8)
        if not confs:
            raise PlayError(f"局域网未发现设备 {device_id}（HomePod 是否在线？）")
        conf = confs[0]
        password = settings.get("airplay_password") or ""
        if password:
            for proto in (Protocol.RAOP, Protocol.AirPlay):
                service = conf.get_service(proto)
                if service is not None:
                    service.password = password
        atv = await pyatv.connect(conf, loop)
        try:
            volume = settings.get("volume") or ""
            if volume:
                try:
                    await atv.audio.set_volume(float(volume))
                except Exception:  # noqa: BLE001 — 音量失败不阻断打铃
                    pass
            await atv.stream.stream_file(file_path)
        finally:
            atv.close()


async def scan_devices(timeout: int = 8) -> list[dict]:
    import pyatv

    loop = asyncio.get_running_loop()
    confs = await pyatv.scan(loop, timeout=timeout)
    return [
        {
            "name": c.name,
            "identifier": c.identifier,
            "address": str(c.address),
            "model": str(c.device_info.model_str),
        }
        for c in confs
    ]


def ensure_test_tone(path: Path) -> Path:
    path = Path(path)
    if path.exists():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    rate, seconds, freq = 44100, 2.0, 880.0
    frames = bytearray()
    total = int(rate * seconds)
    for n in range(total):
        t = n / rate
        envelope = min(1.0, t * 20, (seconds - t) * 20)
        sample = int(12000 * envelope * math.sin(2 * math.pi * freq * t))
        frames += struct.pack("<h", sample)
    with wave.open(str(path), "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(frames))
    return path
