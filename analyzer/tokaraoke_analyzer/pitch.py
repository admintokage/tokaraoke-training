"""CREPE による分離ボーカルの音程 (f0) 推定"""

from __future__ import annotations

import numpy as np
import torch

SAMPLE_RATE = 16000
HOP_SEC = 0.01
HOP = int(SAMPLE_RATE * HOP_SEC)  # 160 サンプル = 10ms
FMIN = 65.0
FMAX = 1100.0
MODEL = "full"


def extract_f0(vocal_16k: np.ndarray, **voicing_options) -> np.ndarray:
    """16kHz モノラルのボーカルから 10ms ごとの f0 (Hz) を返す。無声フレームは NaN。"""
    f0, periodicity = predict(vocal_16k)
    loud_db = frame_db(vocal_16k, len(f0))
    voiced = voicing(f0, periodicity, loud_db, **voicing_options)
    f0 = f0.copy()
    f0[~voiced] = np.nan
    return f0


def predict(vocal_16k: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """CREPE の生の出力 (f0 Hz, periodicity 0〜1) をフレームごとに返す"""
    import torchcrepe

    audio = torch.from_numpy(vocal_16k.astype(np.float32))[None]
    with torch.inference_mode():
        f0, periodicity = torchcrepe.predict(
            audio,
            SAMPLE_RATE,
            HOP,
            FMIN,
            FMAX,
            model=MODEL,
            decoder=torchcrepe.decode.viterbi,
            return_periodicity=True,
            batch_size=1024,
            device="cpu",
            pad=True,
        )
    return f0[0].numpy().astype(np.float64), periodicity[0].numpy().astype(np.float64)


def voicing(
    f0: np.ndarray,
    periodicity: np.ndarray,
    loud_db: np.ndarray,
    high: float = 0.5,
    low: float = 0.2,
    silence_db: float = -40.0,
    max_gap: int = 8,
) -> np.ndarray:
    """
    有声フレームの判定。分離ボーカルに残る伴奏の漏れを避けつつ、歌声の途切れを減らす。
    - 音量が曲中の最大から silence_db 以内のフレームだけを候補にする
    - 確からしさが high 以上のフレームを含む、low 以上の連続区間を有声とする (ヒステリシス)
    - 有声区間の間の短い隙間 (max_gap フレーム以下) は、前後の音程が近ければつなぐ
    """
    n = len(f0)
    per = _median(periodicity, 5)
    loud = loud_db >= loud_db.max() + silence_db
    cand = loud & (per >= low)
    core = loud & (per >= high)

    voiced = np.zeros(n, bool)
    i = 0
    while i < n:
        if not cand[i]:
            i += 1
            continue
        j = i
        while j < n and cand[j]:
            j += 1
        if core[i:j].any():
            voiced[i:j] = True
        i = j

    midi = 12 * np.log2(np.maximum(f0, 1e-6) / 440.0)
    idx = np.flatnonzero(voiced)
    for a, b in zip(idx[:-1], idx[1:]):
        gap = b - a - 1
        if 0 < gap <= max_gap and abs(midi[a] - midi[b]) < 1.0 and loud[a + 1 : b].all():
            voiced[a + 1 : b] = True
    return voiced


def _median(x: np.ndarray, size: int) -> np.ndarray:
    half = size // 2
    padded = np.pad(x, half, mode="edge")
    return np.median(np.lib.stride_tricks.sliding_window_view(padded, size), axis=1)


def frame_db(audio: np.ndarray, n_frames: int) -> np.ndarray:
    """10ms フレームごとの RMS (dB)。CREPE と同じく各フレームの中心を基準にする"""
    win = 1024
    padded = np.pad(audio, (win // 2, win // 2))
    out = np.empty(n_frames)
    for i in range(n_frames):
        seg = padded[i * HOP : i * HOP + win]
        out[i] = 10 * np.log10(np.mean(seg * seg) + 1e-12) if seg.size else -120.0
    return out
