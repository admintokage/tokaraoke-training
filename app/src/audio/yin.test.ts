import { describe, expect, it } from 'vitest';
import { Yin } from './yin';
import { freqToMidi } from './music';

const SR = 48000;

function makeYin() {
  return new Yin({ sampleRate: SR, minFreq: 70, maxFreq: 1100, windowSize: 1024, threshold: 0.15 });
}

/** 倍音を含む声に近い波形 (基音 + 2〜4倍音) */
function voiceLike(freq: number, length: number, noise = 0): Float32Array {
  const buf = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / SR;
    buf[i] =
      0.6 * Math.sin(2 * Math.PI * freq * t) +
      0.3 * Math.sin(2 * Math.PI * 2 * freq * t + 0.3) +
      0.15 * Math.sin(2 * Math.PI * 3 * freq * t + 1.1) +
      0.08 * Math.sin(2 * Math.PI * 4 * freq * t + 2.0) +
      noise * (Math.random() * 2 - 1);
  }
  return buf;
}

describe('Yin', () => {
  const yin = makeYin();

  it.each([82.41, 110, 196, 261.63, 440, 659.25, 987.77])('純音 %f Hz を ±5 セント以内で検出する', (f) => {
    const buf = new Float32Array(yin.requiredLength);
    for (let i = 0; i < buf.length; i++) buf[i] = Math.sin((2 * Math.PI * f * i) / SR);
    const r = yin.analyze(buf);
    expect(r.freq).not.toBeNull();
    expect(Math.abs(freqToMidi(r.freq!) - freqToMidi(f)) * 100).toBeLessThan(5);
  });

  it.each([98, 146.83, 220, 349.23, 523.25])('倍音とノイズを含む %f Hz をオクターブ誤りなく検出する', (f) => {
    const r = yin.analyze(voiceLike(f, yin.requiredLength, 0.05));
    expect(r.freq).not.toBeNull();
    expect(Math.abs(freqToMidi(r.freq!) - freqToMidi(f)) * 100).toBeLessThan(10);
  });

  it('ホワイトノイズは無声と判定する', () => {
    const buf = new Float32Array(yin.requiredLength);
    for (let i = 0; i < buf.length; i++) buf[i] = Math.random() * 2 - 1;
    expect(yin.analyze(buf).freq).toBeNull();
  });
});
