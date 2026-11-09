import type { LyricLine, RefNote } from '../song/types';

/** 合格とみなすずれ (半音)。±50 セント */
export const TOLERANCE = 0.5;
/** ノートの出だしは声の立ち上がりを待つため採点しない (秒) */
export const ONSET_GRACE = 0.08;
/**
 * 子音や息継ぎで声が途切れるのは減点しないよう、ノートの長さのこの割合までは
 * 「声が出ていないサンプル」を採点から除く。全く歌わなければ 0 点になる。
 */
export const VOICED_REQUIRED = 0.5;

export interface ScoreOptions {
  /** オクターブ違いを同じ音として扱う */
  octaveFree: boolean;
}

/** お手本との音程差 (半音)。octaveFree なら最も近いオクターブに折り返す */
export function pitchDiff(userMidi: number, refMidi: number, octaveFree: boolean): number {
  let d = userMidi - refMidi;
  if (octaveFree) d = d - 12 * Math.round(d / 12);
  return d;
}

interface NoteTally {
  /** 採点対象のサンプル数 */
  total: number;
  /** 声が出ていたサンプル数 */
  voiced: number;
  /** ±50 セント以内のサンプル数 */
  hit: number;
}

/** ノートの点数の分母: 声が出ていたサンプル数。ただしノートの VOICED_REQUIRED 未満なら不足分も外れ扱い */
function denom(t: NoteTally): number {
  return Math.max(t.voiced, Math.ceil(t.total * VOICED_REQUIRED));
}

export interface LineScore {
  index: number;
  text: string;
  start: number;
  end: number;
  /** 0〜100。採点対象のノートがなければ null */
  score: number | null;
}

export interface ScoreResult {
  /** 0〜100 */
  total: number;
  /** 採点したノート数 */
  notes: number;
  lines: LineScore[];
}

/**
 * 歌唱中の音程サンプル (曲の時刻, MIDI) を受け取り、お手本ノートごとに当たり判定を数える。
 * 点数 = 全ノートの 当たりサンプル数の合計 / 分母 (denom) の合計 × 100。
 * サンプルはほぼ等間隔なので、ノートの長さで重み付けした平均になる。
 */
export class Scorer {
  private tallies: NoteTally[];
  private readonly search = { cursor: 0, lastTime: -Infinity };

  constructor(
    private readonly notes: RefNote[],
    private readonly opts: ScoreOptions,
  ) {
    this.tallies = notes.map(() => ({ total: 0, voiced: 0, hit: 0 }));
  }

  /** 今の時刻にあるお手本ノート (なければ null) */
  noteAt(time: number): RefNote | null {
    const i = this.indexAt(time);
    return i >= 0 ? this.notes[i] : null;
  }

  /**
   * サンプルを 1 つ追加する。時刻は単調増加を想定 (戻った場合は探索をやり直す)。
   * 戻り値: そのサンプルが当たりなら true、外れなら false、採点対象外なら null
   */
  add(time: number, midi: number | null): boolean | null {
    const i = this.indexAt(time);
    if (i < 0) return null;
    const note = this.notes[i];
    if (time < note.start + Math.min(ONSET_GRACE, (note.end - note.start) / 3)) return null;
    const t = this.tallies[i];
    t.total++;
    if (midi == null) return false;
    t.voiced++;
    const ok = Math.abs(pitchDiff(midi, note.midi, this.opts.octaveFree)) <= TOLERANCE;
    if (ok) t.hit++;
    return ok;
  }

  /** ここまでの点数 (採点したノートだけで計算) */
  current(): number | null {
    return ratio(this.tallies);
  }

  result(lyrics: LyricLine[]): ScoreResult {
    const lines: LineScore[] = lyrics.map((l, index) => {
      const inLine = this.tallies.filter((_, i) => {
        const mid = (this.notes[i].start + this.notes[i].end) / 2;
        return mid >= l.start && mid < l.end;
      });
      const r = ratio(inLine);
      return { index, text: l.text, start: l.start, end: l.end, score: r == null ? null : Math.round(r) };
    });
    return {
      total: this.current() ?? 0,
      notes: this.tallies.filter((t) => t.total > 0).length,
      lines,
    };
  }

  private indexAt(time: number): number {
    return findNote(this.notes, time, this.search);
  }
}

/** 0〜100 (小数 1 桁)。採点したサンプルがなければ null */
function ratio(tallies: NoteTally[]): number | null {
  let d = 0;
  let hit = 0;
  for (const t of tallies) {
    if (t.total === 0) continue;
    d += denom(t);
    hit += t.hit;
  }
  return d > 0 ? Math.round((hit / d) * 1000) / 10 : null;
}

/** 時刻順の探索を速くするためのカーソル付き検索 (時刻が戻ったら先頭から探し直す) */
function findNote(notes: RefNote[], time: number, c: { cursor: number; lastTime: number }): number {
  if (time < c.lastTime) c.cursor = 0;
  c.lastTime = time;
  while (c.cursor < notes.length && notes[c.cursor].end <= time) c.cursor++;
  const n = notes[c.cursor];
  return n && n.start <= time ? c.cursor : -1;
}
