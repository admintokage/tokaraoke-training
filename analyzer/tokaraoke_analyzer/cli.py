"""コマンドラインから解析する (開発・テスト用)

例: uv run python -m tokaraoke_analyzer.cli song.mp3 --lyrics lyrics.txt --out out_dir
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from . import pipeline, settings


def main() -> None:
    p = argparse.ArgumentParser(description="曲ファイルから練習パッケージ (.tkt) を作る")
    p.add_argument("input")
    p.add_argument("--lyrics", help="歌詞テキストファイル (UTF-8)")
    p.add_argument("--title", default="")
    p.add_argument("--artist", default="")
    p.add_argument("--out", default=None)
    a = p.parse_args()

    lyrics = Path(a.lyrics).read_text(encoding="utf-8") if a.lyrics else ""
    res = pipeline.run(
        a.input,
        lyrics,
        a.title,
        a.artist,
        a.out or settings.out_dir(),
        progress=lambda f, msg: print(f"[{f * 100:5.1f}%] {msg}", flush=True),
    )
    print(json.dumps(
        {
            "path": str(res.path),
            "duration": round(res.duration, 1),
            "notes": res.note_count,
            "lines": res.line_count,
            "timings_sec": res.timings,
            "lyrics": res.lyrics,
        },
        ensure_ascii=False,
        indent=2,
    ))


if __name__ == "__main__":
    main()
