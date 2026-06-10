import argparse
from pathlib import Path

import uvicorn

from abell import db
from abell.api import create_app
from abell.player import Player

DEFAULT_DATA = Path(__file__).resolve().parent.parent / "data"


def build_app(data_dir: Path):
    data_dir.mkdir(parents=True, exist_ok=True)
    conn = db.connect(data_dir / "bell.db")

    def settings_getter() -> dict:
        return {
            "device_id": db.get_setting(conn, "device_id"),
            "airplay_password": db.get_setting(conn, "airplay_password"),
            "volume": db.get_setting(conn, "volume"),
            "backend": db.get_setting(conn, "backend", "pyatv"),
        }

    player = Player(settings_getter)
    return create_app(data_dir, player, run_scheduler=True)


def main():
    ap = argparse.ArgumentParser(description="a-bell 学校打铃系统")
    ap.add_argument("--port", type=int, default=8333)
    ap.add_argument("--data", type=Path, default=DEFAULT_DATA)
    args = ap.parse_args()
    uvicorn.run(build_app(args.data), host="0.0.0.0", port=args.port)


if __name__ == "__main__":
    main()
