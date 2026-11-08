"""ffmpeg による音声の読み込み・書き出し (ffmpeg は imageio-ffmpeg 同梱のものを使う)"""

from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np
from imageio_ffmpeg import get_ffmpeg_exe

_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def _ffmpeg() -> str:
    return get_ffmpeg_exe()


def load_audio(path: str | Path, sample_rate: int, channels: int) -> np.ndarray:
    """音声ファイルを float32 の (channels, samples) 配列として読み込む"""
    cmd = [
        _ffmpeg(), "-nostdin", "-v", "error",
        "-i", str(path),
        "-vn", "-f", "f32le", "-acodec", "pcm_f32le",
        "-ac", str(channels), "-ar", str(sample_rate),
        "-",
    ]
    proc = subprocess.run(cmd, capture_output=True, creationflags=_NO_WINDOW)
    if proc.returncode != 0:
        msg = proc.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"音声ファイルを読み込めませんでした: {msg}")
    data = np.frombuffer(proc.stdout, dtype=np.float32)
    if data.size == 0:
        raise RuntimeError("音声ファイルに音声データがありません")
    return data.reshape(-1, channels).T.copy()


def resample_mono(audio: np.ndarray, src_rate: int, dst_rate: int) -> np.ndarray:
    """(channels, samples) → モノラル (samples,) に変換してリサンプリング (ffmpeg 経由)"""
    mono = audio.mean(axis=0).astype(np.float32) if audio.ndim == 2 else audio.astype(np.float32)
    if src_rate == dst_rate:
        return mono
    cmd = [
        _ffmpeg(), "-nostdin", "-v", "error",
        "-f", "f32le", "-ar", str(src_rate), "-ac", "1", "-i", "-",
        "-f", "f32le", "-ar", str(dst_rate), "-ac", "1", "-",
    ]
    proc = subprocess.run(cmd, input=mono.tobytes(), capture_output=True, creationflags=_NO_WINDOW)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.decode("utf-8", errors="replace"))
    return np.frombuffer(proc.stdout, dtype=np.float32).copy()


def encode_m4a(audio: np.ndarray, sample_rate: int, out_path: str | Path, bitrate: str = "192k") -> None:
    """(channels, samples) の float32 配列を AAC (.m4a) で保存する"""
    audio = np.clip(audio, -1.0, 1.0).astype(np.float32)
    channels = audio.shape[0]
    cmd = [
        _ffmpeg(), "-nostdin", "-v", "error", "-y",
        "-f", "f32le", "-ar", str(sample_rate), "-ac", str(channels), "-i", "-",
        "-c:a", "aac", "-b:a", bitrate, "-movflags", "+faststart",
        str(out_path),
    ]
    proc = subprocess.run(cmd, input=audio.T.tobytes(), capture_output=True, creationflags=_NO_WINDOW)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.decode("utf-8", errors="replace"))
