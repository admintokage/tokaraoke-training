"""練習パッケージ (.tkt = zip) の書き出し"""

from __future__ import annotations

import json
import re
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from . import __version__
from .audio import encode_m4a
from .notes import Note

FORMAT_VERSION = 1


def safe_filename(name: str) -> str:
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", name).strip(" .")
    return name[:120] or "untitled"


def write_tkt(
    out_path: Path,
    *,
    title: str,
    artist: str,
    duration: float,
    sample_rate: int,
    accompaniment: np.ndarray,
    vocals: np.ndarray,
    f0_midi: np.ndarray,
    hop: float,
    notes: list[Note],
    lyrics: list[dict],
    models: dict,
) -> Path:
    manifest = {
        "format": "tkt",
        "version": FORMAT_VERSION,
        "title": title,
        "artist": artist,
        "duration": round(duration, 3),
        "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "analyzer": {"version": __version__, **models},
        "files": {
            "accompaniment": "accompaniment.m4a",
            "vocal": "vocal.m4a",
            "pitch": "pitch.json",
            "lyrics": "lyrics.json",
        },
    }
    pitch = {
        "hop": hop,
        # 表示用の f0 曲線 (MIDI 小数, 無声は null)。サイズを抑えるため小数 2 桁
        "f0": [None if np.isnan(v) else round(float(v), 2) for v in f0_midi],
        "notes": [n.to_dict() for n in notes],
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        encode_m4a(accompaniment, sample_rate, tmp_dir / "accompaniment.m4a", "192k")
        encode_m4a(vocals, sample_rate, tmp_dir / "vocal.m4a", "128k")
        partial = out_path.with_suffix(".tkt.part")
        with zipfile.ZipFile(partial, "w") as z:
            z.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2), zipfile.ZIP_DEFLATED)
            z.writestr("pitch.json", json.dumps(pitch, separators=(",", ":")), zipfile.ZIP_DEFLATED)
            z.writestr("lyrics.json", json.dumps({"lines": lyrics}, ensure_ascii=False, indent=1), zipfile.ZIP_DEFLATED)
            # m4a は圧縮済みなので無圧縮で格納
            z.write(tmp_dir / "accompaniment.m4a", "accompaniment.m4a", zipfile.ZIP_STORED)
            z.write(tmp_dir / "vocal.m4a", "vocal.m4a", zipfile.ZIP_STORED)
        partial.replace(out_path)
    return out_path
