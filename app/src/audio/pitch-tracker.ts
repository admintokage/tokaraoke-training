import type { PitchMessage } from './pitch-processor';
import { freqToMidi } from './music';

/** 平滑化済みの音程 1 フレーム分 */
export interface TrackedPitch {
  time: number;
  /** メディアンフィルタ後の音程 (MIDI 小数)。グラフ描画・採点用。無声なら null */
  midi: number | null;
  /** さらに指数平滑化した音程。数値表示用 */
  smoothMidi: number | null;
  /** 表示する音名 (MIDI 整数)。ヒステリシス付きなので境目でバタつかない */
  note: number | null;
  clarity: number;
  rms: number;
}

export interface TrackerOptions {
  /** メディアンフィルタの長さ (フレーム数, 約10ms/フレーム) */
  medianSize: number;
  /** これ未満の確からしさの推定は捨てる */
  minClarity: number;
  /** 有声とみなすのに必要な連続フレーム数 (子音・息の一瞬の誤検出を除く) */
  minVoicedRun: number;
  /** 表示音名を切り替えるのに必要なずれ (半音)。0.5 より大きくして境目のバタつきを防ぐ */
  noteHysteresis: number;
  /** 数値表示用の指数平滑化係数 (0..1, 大きいほど追従が速い) */
  smoothing: number;
}

export const DEFAULT_TRACKER_OPTIONS: TrackerOptions = {
  medianSize: 7,
  minClarity: 0.8,
  minVoicedRun: 3,
  noteHysteresis: 0.7,
  smoothing: 0.25,
};

/**
 * YIN の生の推定値を、人が見て安定した表示になるよう後処理する。
 *  1. 確からしさの低い推定を捨てる
 *  2. 短い有声区間 (子音・ノイズ) を捨てる
 *  3. メディアンフィルタで単発の外れ値 (オクターブ誤りなど) を除く
 *  4. 表示用に指数平滑化し、音名の切り替えにヒステリシスをかける
 */
export class PitchTracker {
  private readonly opts: TrackerOptions;
  private window: (number | null)[] = [];
  private voicedRun = 0;
  private smooth: number | null = null;
  private note: number | null = null;

  constructor(opts: Partial<TrackerOptions> = {}) {
    this.opts = { ...DEFAULT_TRACKER_OPTIONS, ...opts };
  }

  reset(): void {
    this.window = [];
    this.voicedRun = 0;
    this.smooth = null;
    this.note = null;
  }

  push(m: PitchMessage): TrackedPitch {
    const o = this.opts;
    const raw = m.freq != null && m.clarity >= o.minClarity ? freqToMidi(m.freq) : null;

    this.voicedRun = raw != null ? this.voicedRun + 1 : 0;
    this.window.push(this.voicedRun >= o.minVoicedRun || (raw != null && this.smooth != null) ? raw : null);
    if (this.window.length > o.medianSize) this.window.shift();

    const voiced = this.window.filter((v): v is number => v != null);
    let midi: number | null = null;
    if (voiced.length > this.window.length / 2) {
      voiced.sort((a, b) => a - b);
      // 偶数個のときも平均は取らない (音程の跳躍時に存在しない中間の音が出るため)
      midi = voiced[voiced.length >> 1];
    }

    if (midi == null) {
      this.smooth = null;
      this.note = null;
    } else {
      // 1 半音以上の跳躍はすぐ追従し、細かい揺れだけをならす
      if (this.smooth == null || Math.abs(midi - this.smooth) > 1) this.smooth = midi;
      else this.smooth += (midi - this.smooth) * o.smoothing;

      if (this.note == null || Math.abs(this.smooth - this.note) > o.noteHysteresis) {
        this.note = Math.round(this.smooth);
      }
    }

    return { time: m.time, midi, smoothMidi: this.smooth, note: this.note, clarity: m.clarity, rms: m.rms };
  }
}
