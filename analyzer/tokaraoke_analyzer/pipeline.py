"""曲ファイル + 歌詞 → .tkt の一連の処理"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from . import lyrics as lyrics_mod
from . import notes as notes_mod
from . import pitch as pitch_mod
from . import separate as separate_mod
from .audio import load_audio, resample_mono
from .package import safe_filename, write_tkt

Progress = Callable[[float, str], None]


@dataclass
class Result:
    path: Path
    duration: float
    note_count: int
    line_count: int
    timings: dict[str, float] = field(default_factory=dict)
    lyrics: list[dict] = field(default_factory=list)


def _noop(_: float, __: str) -> None:
    pass


def run(
    input_path: str | Path,
    lyrics_text: str,
    title: str,
    artist: str,
    out_dir: str | Path,
    progress: Progress = _noop,
) -> Result:
    timings: dict[str, float] = {}
    t = time.perf_counter()

    def lap(name: str) -> None:
        nonlocal t
        now = time.perf_counter()
        timings[name] = round(now - t, 1)
        t = now

    sr = separate_mod.SAMPLE_RATE
    progress(0.02, "曲を読み込んでいます")
    mix = load_audio(input_path, sr, 2)
    duration = mix.shape[1] / sr
    lap("読み込み")

    progress(0.05, "ボーカルと伴奏を分離しています（いちばん時間がかかります）")
    vocals, accompaniment = separate_mod.separate(mix)
    del mix
    lap("ボーカル分離")

    progress(0.55, "お手本の音程を解析しています")
    vocal_16k = resample_mono(vocals, sr, pitch_mod.SAMPLE_RATE)
    f0 = pitch_mod.extract_f0(vocal_16k)
    f0_midi = notes_mod.hz_to_midi(f0)
    notes = notes_mod.segment_notes(f0_midi, hop=pitch_mod.HOP_SEC)
    lap("音程解析")

    lines = lyrics_mod.parse_lines(lyrics_text or "")
    lyric_lines: list[dict] = []
    if lines:
        progress(0.75, "歌詞のタイミングを合わせています")
        lyric_lines = lyrics_mod.align_lines(vocal_16k, lines)
        lap("歌詞合わせ")

    progress(0.92, "練習パッケージを書き出しています")
    title = title.strip() or Path(input_path).stem
    artist = artist.strip()
    name = safe_filename(f"{artist} - {title}" if artist else title)
    out_path = write_tkt(
        Path(out_dir) / f"{name}.tkt",
        title=title,
        artist=artist,
        duration=duration,
        sample_rate=sr,
        accompaniment=accompaniment,
        vocals=vocals,
        f0_midi=f0_midi,
        hop=pitch_mod.HOP_SEC,
        notes=notes,
        lyrics=lyric_lines,
        models={
            "separation": separate_mod.MODEL_NAME,
            "pitch": f"torchcrepe-{pitch_mod.MODEL}",
            "lyrics": f"whisper-{lyrics_mod.WHISPER_MODEL}" if lines else None,
        },
    )
    lap("書き出し")
    progress(1.0, "完了")
    return Result(
        path=out_path,
        duration=duration,
        note_count=len(notes),
        line_count=len(lyric_lines),
        timings=timings,
        lyrics=lyric_lines,
    )
