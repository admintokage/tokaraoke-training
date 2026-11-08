"""f0 曲線を、カラオケの音程バーのようなノート列に変換する"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class Note:
    start: float
    end: float
    midi: int

    def to_dict(self) -> dict:
        return {"start": round(self.start, 3), "end": round(self.end, 3), "midi": self.midi}


def hz_to_midi(f0: np.ndarray) -> np.ndarray:
    with np.errstate(divide="ignore", invalid="ignore"):
        return 69 + 12 * np.log2(f0 / 440.0)


def nan_median_filter(x: np.ndarray, size: int) -> np.ndarray:
    """NaN (無声) を保ったまま、有声フレームだけで移動中央値を取る"""
    half = size // 2
    out = x.copy()
    for i in np.flatnonzero(~np.isnan(x)):
        win = x[max(0, i - half) : i + half + 1]
        out[i] = np.nanmedian(win)
    return out


def segment_notes(
    midi: np.ndarray,
    hop: float = 0.01,
    min_duration: float = 0.08,
    split_semitones: float = 0.7,
    split_frames: int = 4,
    merge_gap: float = 0.06,
    absorb_duration: float = 0.12,
) -> list[Note]:
    """
    midi: フレームごとの音程 (MIDI 小数, 無声は NaN)
    - 有声区間ごとに、音程が今のノートから split_semitones 以上・split_frames フレーム以上離れたら区切る
    - ノートの高さは区間の中央値を四捨五入
    - 短すぎるノートは捨て、同じ高さで隙間の小さいノートはつなぐ
    - ビブラートやしゃくりで出る半音ずれの細切れ (absorb_duration 未満) は隣のノートに吸収する
    """
    m = nan_median_filter(midi, 5)
    n = len(m)
    segments: list[tuple[int, int]] = []

    i = 0
    while i < n:
        if np.isnan(m[i]):
            i += 1
            continue
        run_end = i
        while run_end < n and not np.isnan(m[run_end]):
            run_end += 1
        # 有声区間 [i, run_end) の中で音程の変わり目を探す
        seg_start = i
        j = i
        while j < run_end:
            ref = np.median(m[seg_start : j + 1])
            if abs(m[j] - ref) > split_semitones:
                k = j
                while k < run_end and abs(m[k] - ref) > split_semitones and k - j < split_frames:
                    k += 1
                if k - j >= split_frames:
                    segments.append((seg_start, j))
                    seg_start = j
            j += 1
        segments.append((seg_start, run_end))
        i = run_end

    notes: list[Note] = []
    for s, e in segments:
        if (e - s) * hop < min_duration:
            continue
        notes.append(Note(start=s * hop, end=e * hop, midi=int(round(float(np.median(m[s:e]))))))

    notes = _absorb_blips(notes, absorb_duration, merge_gap)

    merged: list[Note] = []
    for note in notes:
        if merged and merged[-1].midi == note.midi and note.start - merged[-1].end <= merge_gap:
            merged[-1].end = note.end
        else:
            merged.append(note)
    return merged


def _absorb_blips(notes: list[Note], absorb_duration: float, gap: float) -> list[Note]:
    """短いノートで、隣接するノートとの差が 1 半音以内なら、長い方の隣に吸収する"""
    out = [Note(n.start, n.end, n.midi) for n in notes]
    changed = True
    while changed:
        changed = False
        for i, n in enumerate(out):
            if n.end - n.start >= absorb_duration:
                continue
            prev = out[i - 1] if i > 0 and n.start - out[i - 1].end <= gap and abs(out[i - 1].midi - n.midi) <= 1 else None
            nxt = out[i + 1] if i + 1 < len(out) and out[i + 1].start - n.end <= gap and abs(out[i + 1].midi - n.midi) <= 1 else None
            cands = [c for c in (prev, nxt) if c is not None and c.end - c.start > n.end - n.start]
            if not cands:
                continue
            host = max(cands, key=lambda c: c.end - c.start)
            if host is prev:
                prev.end = n.end
            else:
                nxt.start = n.start
            del out[i]
            changed = True
            break
    return out
