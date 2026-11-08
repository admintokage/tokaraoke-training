"""歌詞テキストをボーカル音声に行単位でアライメントする (stable-ts / Whisper)"""

from __future__ import annotations

import re

import numpy as np

WHISPER_MODEL = "small"

_SPACE = re.compile(r"\s+")


def parse_lines(text: str) -> list[str]:
    """空行を除いた歌詞の行リスト"""
    return [line.strip() for line in text.splitlines() if line.strip()]


def _norm(s: str) -> str:
    return _SPACE.sub("", s)


MIN_LINE_SEC = 0.3  # これより短い行はアライメント失敗とみなす


def map_words_to_lines(
    words: list[tuple[str, float, float]],
    lines: list[str],
    duration: float | None = None,
    edge_gap: float = 1.0,
) -> list[dict]:
    """
    アライメント結果の単語列 (text, start, end) を、元の歌詞の行に割り当てる。
    - 単語の文字列を空白抜きで連結したものと、行を空白抜きで連結したものの文字位置で対応を取る。
      文字数が一致しない場合 (記号の欠落など) は比例配分で近似する。
    - 行頭・行末の文字が前後の行にくっついて誤配置されやすいので、行内で edge_gap 秒以上
      離れた端の文字は無視する。
    - 合わせられなかった行 (時間がほぼ 0) は、前後の行の間に均等に並べ、aligned=False を付ける。
    """
    chars: list[tuple[float, float]] = []
    for text, start, end in words:
        for _ in _norm(text):
            chars.append((start, end))
    norm_lines = [_norm(line) for line in lines]
    total = sum(len(s) for s in norm_lines)
    lines = [line for line, nl in zip(lines, norm_lines) if nl]
    norm_lines = [nl for nl in norm_lines if nl]

    spans: list[tuple[float, float] | None] = []
    m = len(chars)
    pos = 0
    for nl in norm_lines:
        a, b = pos, pos + len(nl)
        pos = b
        if m == 0:
            spans.append(None)
            continue
        ia = min(m - 1, round(a * m / total))
        ib = min(m, max(ia + 1, round(b * m / total)))
        spans.append(_robust_span(chars[ia:ib], edge_gap))

    # 前の行より前に始まらないよう単調にそろえ、短すぎる行は失敗扱い
    last_end = 0.0
    for i, sp in enumerate(spans):
        if sp is None:
            continue
        s, e = max(sp[0], last_end), sp[1]
        if e - s < MIN_LINE_SEC:
            spans[i] = None
            continue
        spans[i] = (s, e)
        last_end = e

    end_of_song = duration if duration is not None else max((c[1] for c in chars), default=0.0)
    result = []
    i = 0
    while i < len(lines):
        if spans[i] is not None:
            s, e = spans[i]
            result.append({"start": round(s, 3), "end": round(e, 3), "text": lines[i]})
            i += 1
            continue
        # 失敗した行が続く区間 [i, j) を、前後の行の間に均等配置
        j = i
        while j < len(lines) and spans[j] is None:
            j += 1
        lo = result[-1]["end"] if result else 0.0
        hi = spans[j][0] if j < len(lines) else max(end_of_song, lo)
        step = (hi - lo) / (j - i)
        for k in range(i, j):
            s = lo + (k - i) * step
            result.append({"start": round(s, 3), "end": round(s + step, 3), "text": lines[k], "aligned": False})
        i = j
    return result


def _robust_span(chars: list[tuple[float, float]], edge_gap: float) -> tuple[float, float] | None:
    """行内の文字の (start, end) 列から、端の外れ値を除いた行の開始・終了を求める"""
    cs = [c for c in chars if c[1] - c[0] > 0.001]
    while len(cs) >= 2 and cs[1][0] - cs[0][1] > edge_gap:
        cs = cs[1:]
    while len(cs) >= 2 and cs[-1][0] - cs[-2][1] > edge_gap:
        cs = cs[:-1]
    if not cs:
        return None
    return cs[0][0], cs[-1][1]


def load_model():
    import stable_whisper

    return stable_whisper.load_model(WHISPER_MODEL, device="cpu")


def align_lines(vocal_16k: np.ndarray, lines: list[str], language: str = "ja", model=None) -> list[dict]:
    """16kHz モノラルのボーカルに歌詞の各行を合わせ、[{start, end, text}] を返す"""
    if not lines:
        return []
    if model is None:
        model = load_model()
    result = model.align(vocal_16k.astype(np.float32), "\n".join(lines), language=language)
    words = [(w.word, float(w.start), float(w.end)) for seg in result.segments for w in seg.words]
    return map_words_to_lines(words, lines, duration=len(vocal_16k) / 16000)
