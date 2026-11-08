"""前回使った出力先などを analyzer/settings.json に保存する"""

from __future__ import annotations

import json
from pathlib import Path

SETTINGS_PATH = Path(__file__).resolve().parent.parent / "settings.json"


def default_out_dir() -> str:
    drive = Path("G:/マイドライブ")
    if drive.exists():
        return str(drive / "tokaraoke")
    return str(Path.home() / "Documents" / "tokaraoke")


def load() -> dict:
    try:
        return json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save(**values) -> None:
    data = load()
    data.update(values)
    SETTINGS_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def out_dir() -> str:
    return load().get("out_dir") or default_out_dir()
