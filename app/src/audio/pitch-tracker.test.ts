import { describe, expect, it } from 'vitest';
import { PitchTracker } from './pitch-tracker';
import { midiToFreq } from './music';

const frame = (i: number, midi: number | null, clarity = 0.95) => ({
  time: i * 0.01,
  freq: midi == null ? null : midiToFreq(midi),
  clarity,
  rms: 0.1,
});

function run(midis: (number | null)[], clarity = 0.95) {
  const t = new PitchTracker();
  return midis.map((m, i) => t.push(frame(i, m, clarity)));
}

describe('PitchTracker', () => {
  it('音名の境目 (±50セント付近) で揺れても表示音名は切り替わらない', () => {
    // A4 (69) の +45〜+55 セントを行き来する
    const input = Array.from({ length: 200 }, (_, i) => 69.5 + 0.05 * Math.sin(i / 3));
    const notes = new Set(run(input).slice(20).map((p) => p.note));
    expect(notes.size).toBe(1);
  });

  it('ビブラート (±30セント, 5.5Hz) でも表示音名は 1 つのまま', () => {
    const input = Array.from({ length: 300 }, (_, i) => 64 + 0.3 * Math.sin((2 * Math.PI * 5.5 * i) / 100));
    const out = run(input).slice(20);
    expect(new Set(out.map((p) => p.note))).toEqual(new Set([64]));
  });

  it('単発のオクターブ誤りはメディアンフィルタで除かれる', () => {
    const input: number[] = Array(60).fill(60);
    input[30] = 72;
    input[31] = 48;
    const out = run(input);
    for (const p of out.slice(10)) expect(p.midi).toBeCloseTo(60, 5);
  });

  it('音程をはっきり変えたら表示音名も追従する', () => {
    const input = [...Array(50).fill(60), ...Array(50).fill(62)];
    const out = run(input);
    expect(out[45].note).toBe(60);
    expect(out[99].note).toBe(62);
  });

  it('子音などの短い有声区間は無視する', () => {
    const input = [null, null, 65, 65, null, null, null, null, null];
    expect(run(input).every((p) => p.midi == null)).toBe(true);
  });

  it('確からしさが低い推定は無声扱い', () => {
    expect(run(Array(30).fill(60), 0.5).every((p) => p.midi == null)).toBe(true);
  });
});
