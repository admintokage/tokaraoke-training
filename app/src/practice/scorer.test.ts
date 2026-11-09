import { describe, expect, it } from 'vitest';
import { pitchDiff, Scorer } from './scorer';

const notes = [
  { start: 1, end: 2, midi: 60 },
  { start: 2, end: 3, midi: 64 },
];

/** 10ms ごとに f(t) の音程で歌ったことにする */
function sing(s: Scorer, from: number, to: number, f: (t: number) => number | null) {
  for (let t = from; t < to; t += 0.01) s.add(t, f(t));
}

describe('pitchDiff', () => {
  it('folds octaves only when octaveFree', () => {
    expect(pitchDiff(48.2, 60, true)).toBeCloseTo(0.2);
    expect(pitchDiff(48.2, 60, false)).toBeCloseTo(-11.8);
    expect(pitchDiff(66.9, 60, true)).toBeCloseTo(-5.1);
  });
});

describe('Scorer', () => {
  it('gives 100 for singing exactly with the reference', () => {
    const s = new Scorer(notes, { octaveFree: true });
    sing(s, 0, 3.5, (t) => (t < 2 ? 60.1 : 63.8));
    expect(s.current()).toBe(100);
  });

  it('ignores samples outside notes and the onset grace period', () => {
    const s = new Scorer(notes, { octaveFree: true });
    expect(s.add(0.5, 70)).toBeNull(); // ノートの外
    expect(s.add(1.03, 70)).toBeNull(); // 出だしの猶予
    expect(s.add(1.2, 70)).toBe(false);
    expect(s.add(1.3, 60.4)).toBe(true);
  });

  it('forgives short voice dropouts (consonants, breaths)', () => {
    const s = new Scorer(notes, { octaveFree: true });
    // 6 割だけ声が出ていて、出ている所は全部合っている
    sing(s, 1, 2, (t) => (Math.floor(t * 100) % 10 < 6 ? 60 : null));
    expect(s.current()).toBe(100);
  });

  it('penalizes singing less than half of a note', () => {
    const s = new Scorer(notes, { octaveFree: true });
    // 声が出ているのは 2 割ほど → 約 2/5 = 40 点
    sing(s, 1, 2, (t) => (t < 1.27 ? 60 : null));
    expect(s.current()).toBeGreaterThan(35);
    expect(s.current()).toBeLessThan(45);
  });

  it('gives 0 when silent', () => {
    const s = new Scorer(notes, { octaveFree: true });
    sing(s, 1, 3, () => null);
    expect(s.current()).toBe(0);
  });

  it('treats an octave lower as correct only when octaveFree', () => {
    const free = new Scorer(notes, { octaveFree: true });
    const strict = new Scorer(notes, { octaveFree: false });
    for (const s of [free, strict]) sing(s, 1, 3, (t) => (t < 2 ? 48 : 52));
    expect(free.current()).toBe(100);
    expect(strict.current()).toBe(0);
  });

  it('scores each lyric line from the notes inside it', () => {
    const s = new Scorer(notes, { octaveFree: true });
    sing(s, 1, 3, (t) => (t < 2 ? 60 : 70));
    const r = s.result([
      { start: 0.5, end: 2, text: 'いち' },
      { start: 2, end: 3.2, text: 'に' },
      { start: 5, end: 6, text: 'さん' },
    ]);
    expect(r.lines.map((l) => l.score)).toEqual([100, 0, null]);
    expect(r.total).toBe(50);
    expect(r.notes).toBe(2);
  });

  it('restarts the search when time goes backwards (seek)', () => {
    const s = new Scorer(notes, { octaveFree: true });
    s.add(2.5, 64);
    expect(s.add(1.5, 60)).toBe(true);
  });
});
