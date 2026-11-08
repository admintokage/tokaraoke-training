/// <reference lib="webworker" />
/**
 * マイク入力を受け取り、一定間隔 (HOP) ごとに YIN で音程を推定してメインスレッドへ送る AudioWorklet。
 */
import { Yin } from './yin';

// AudioWorkletGlobalScope の型 (TypeScript 標準の lib には含まれない)
declare const sampleRate: number;
declare const currentTime: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}

export interface PitchMessage {
  /** 解析窓の中心に相当する AudioContext 上の時刻 (秒) */
  time: number;
  /** 推定周波数 (Hz)。無声・無音なら null */
  freq: number | null;
  clarity: number;
  /** 入力レベル (RMS) */
  rms: number;
}

const MIN_FREQ = 70;
const MAX_FREQ = 1100;
/** 無音とみなす RMS の閾値 (およそ -50 dBFS) */
const SILENCE_RMS = 0.003;

class PitchProcessor extends AudioWorkletProcessor {
  private readonly yin: Yin;
  private readonly ring: Float32Array;
  private readonly frame: Float32Array;
  private writePos = 0;
  private filled = 0;
  private sinceLast = 0;
  private readonly hop: number;

  constructor() {
    super();
    // 48kHz で窓 1024 (約21ms)、約10ms ごとに推定
    const windowSize = Math.round(sampleRate * 0.0213);
    this.hop = Math.round(sampleRate * 0.0107);
    this.yin = new Yin({
      sampleRate,
      minFreq: MIN_FREQ,
      maxFreq: MAX_FREQ,
      windowSize,
      threshold: 0.15,
    });
    this.frame = new Float32Array(this.yin.requiredLength);
    this.ring = new Float32Array(this.yin.requiredLength);
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    if (!input) return true;

    const ring = this.ring;
    const n = ring.length;
    for (let i = 0; i < input.length; i++) {
      ring[this.writePos] = input[i];
      this.writePos = (this.writePos + 1) % n;
    }
    this.filled = Math.min(n, this.filled + input.length);
    this.sinceLast += input.length;

    if (this.filled === n && this.sinceLast >= this.hop) {
      this.sinceLast = 0;
      this.analyze();
    }
    return true;
  }

  private analyze(): void {
    const { ring, frame } = this;
    const n = ring.length;
    // リングバッファを時系列順に並べ替え
    const tail = n - this.writePos;
    frame.set(ring.subarray(this.writePos), 0);
    frame.set(ring.subarray(0, this.writePos), tail);

    let sumSq = 0;
    for (let i = 0; i < n; i++) sumSq += frame[i] * frame[i];
    const rms = Math.sqrt(sumSq / n);

    let freq: number | null = null;
    let clarity = 0;
    if (rms >= SILENCE_RMS) {
      const r = this.yin.analyze(frame);
      freq = r.freq;
      clarity = r.clarity;
    }

    const msg: PitchMessage = {
      time: currentTime - n / 2 / sampleRate,
      freq,
      clarity,
      rms,
    };
    this.port.postMessage(msg);
  }
}

registerProcessor('pitch-processor', PitchProcessor);
