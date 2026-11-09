import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { parseTkt, TktError } from './tkt';

function makeTkt(overrides: Record<string, Uint8Array | null> = {}, manifestPatch: object = {}) {
  const manifest = {
    format: 'tkt',
    version: 1,
    title: 'テスト曲',
    artist: '歌手',
    duration: 12.5,
    createdAt: '2026-11-09T00:00:00+00:00',
    files: { accompaniment: 'accompaniment.m4a', vocal: 'vocal.m4a', pitch: 'pitch.json', lyrics: 'lyrics.json' },
    ...manifestPatch,
  };
  const files: Record<string, Uint8Array> = {
    'manifest.json': strToU8(JSON.stringify(manifest)),
    'pitch.json': strToU8(
      JSON.stringify({
        hop: 0.01,
        f0: [null, 60.1, 60.0],
        notes: [
          { start: 2, end: 2.5, midi: 62 },
          { start: 1, end: 1.5, midi: 60 },
          { start: 3, end: 3, midi: 64 }, // 長さ 0 は捨てる
        ],
      }),
    ),
    'lyrics.json': strToU8(JSON.stringify({ lines: [{ start: 1, end: 3, text: 'あいう' }] })),
    'accompaniment.m4a': new Uint8Array([1, 2, 3]),
    'vocal.m4a': new Uint8Array([4, 5]),
  };
  for (const [k, v] of Object.entries(overrides)) {
    if (v == null) delete files[k];
    else files[k] = v;
  }
  return zipSync(files);
}

describe('parseTkt', () => {
  it('reads a valid package', () => {
    const t = parseTkt(makeTkt());
    expect(t.manifest.title).toBe('テスト曲');
    expect(t.manifest.duration).toBe(12.5);
    expect(t.pitch.notes.map((n) => n.midi)).toEqual([60, 62]);
    expect(t.lyrics).toEqual([{ start: 1, end: 3, text: 'あいう' }]);
    expect(t.accompaniment.size).toBe(3);
    expect(t.vocal.size).toBe(2);
  });

  it('rejects non-zip data', () => {
    expect(() => parseTkt(new Uint8Array([1, 2, 3, 4]))).toThrow(TktError);
  });

  it('rejects other formats and versions', () => {
    expect(() => parseTkt(makeTkt({}, { format: 'other' }))).toThrow(/tokaraoke/);
    expect(() => parseTkt(makeTkt({}, { version: 2 }))).toThrow(/対応していません/);
  });

  it('reports a missing audio file', () => {
    expect(() => parseTkt(makeTkt({ 'vocal.m4a': null }))).toThrow(/vocal\.m4a/);
  });
});
