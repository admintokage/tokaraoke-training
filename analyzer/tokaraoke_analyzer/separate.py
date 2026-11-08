"""Demucs によるボーカル分離"""

from __future__ import annotations

import numpy as np
import torch

MODEL_NAME = "htdemucs"
SAMPLE_RATE = 44100


def load_model():
    from demucs.pretrained import get_model

    model = get_model(MODEL_NAME)
    model.eval()
    return model


def separate(mix: np.ndarray, model=None) -> tuple[np.ndarray, np.ndarray]:
    """
    ステレオ 44.1kHz の (2, samples) 配列をボーカルと伴奏に分ける。
    戻り値: (vocals, accompaniment) いずれも (2, samples) float32
    """
    from demucs.apply import apply_model

    if model is None:
        model = load_model()
    if mix.shape[0] == 1:
        mix = np.repeat(mix, 2, axis=0)

    wav = torch.from_numpy(mix.astype(np.float32))
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    wav = (wav - mean) / std

    with torch.inference_mode():
        # progress=True の tqdm を Gradio が拾って進捗表示する
        sources = apply_model(
            model, wav[None], device="cpu", shifts=0, split=True, overlap=0.25, progress=True, num_workers=0
        )[0]
    sources = sources * std + mean

    names = list(model.sources)
    vi = names.index("vocals")
    vocals = sources[vi]
    accompaniment = sum(sources[i] for i in range(len(names)) if i != vi)
    return vocals.numpy().astype(np.float32), accompaniment.numpy().astype(np.float32)
