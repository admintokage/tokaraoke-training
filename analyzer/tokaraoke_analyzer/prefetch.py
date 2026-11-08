"""AI モデルを事前にダウンロードしておく (setup.bat から呼ぶ)"""

from __future__ import annotations

import hashlib
import os
import time
import urllib.request
from pathlib import Path


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download_resumable(url: str, dest: Path, sha256: str | None = None, retries: int = 30) -> None:
    """途中で止まっても続きから再開するダウンロード (回線が不安定でも完走させる)"""
    if dest.exists() and sha256 and _sha256(dest) == sha256:
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    # 以前の途中ファイル (dest そのもの) があれば続きに使う
    if dest.exists() and not part.exists():
        os.replace(dest, part)
    for attempt in range(1, retries + 1):
        done = part.stat().st_size if part.exists() else 0
        req = urllib.request.Request(url, headers={"Range": f"bytes={done}-"} if done else {})
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                if done and res.status != 206:  # 再開に対応していない場合は最初から
                    done = 0
                total = done + int(res.headers.get("Content-Length", 0))
                with open(part, "ab" if done else "wb") as f:
                    last = time.time()
                    while chunk := res.read(1 << 20):
                        f.write(chunk)
                        done += len(chunk)
                        if time.time() - last > 5:
                            print(f"  {done / 1e6:.0f} / {total / 1e6:.0f} MB", flush=True)
                            last = time.time()
            break
        except OSError as e:
            print(f"  通信が途切れました。再接続します ({attempt}/{retries}): {e}", flush=True)
            time.sleep(min(30, 2 * attempt))
    else:
        raise RuntimeError(f"ダウンロードに失敗しました: {url}")
    if sha256 and _sha256(part) != sha256:
        part.unlink()
        raise RuntimeError("ダウンロードしたファイルが壊れています。もう一度 setup.bat を実行してください。")
    os.replace(part, dest)


def fetch_whisper(name: str) -> None:
    import whisper

    url = whisper._MODELS[name]
    sha = url.split("/")[-2]
    root = Path(os.getenv("XDG_CACHE_HOME", Path.home() / ".cache")) / "whisper"
    download_resumable(url, root / os.path.basename(url), sha)


def main() -> None:
    print("ボーカル分離モデル (Demucs) を準備しています...", flush=True)
    from . import separate

    separate.load_model()

    print("音程推定モデル (CREPE) を準備しています...", flush=True)
    import torchcrepe

    torchcrepe.load.model("cpu", "full")

    print("歌詞合わせモデル (Whisper) を準備しています...", flush=True)
    from . import lyrics

    fetch_whisper(lyrics.WHISPER_MODEL)
    lyrics.load_model()
    print("すべてのモデルの準備ができました。", flush=True)


if __name__ == "__main__":
    main()
