/**
 * YIN 法による基本周波数 (f0) 推定。
 * de Cheveigné & Kawahara (2002) "YIN, a fundamental frequency estimator for speech and music"
 *
 * AudioWorklet 内で毎フレーム呼ぶため、作業用バッファを使い回してメモリ確保を避ける。
 */

export interface YinOptions {
  sampleRate: number;
  /** 検出する最低周波数 (Hz) */
  minFreq: number;
  /** 検出する最高周波数 (Hz) */
  maxFreq: number;
  /** 差分関数を積分する窓長 (サンプル数) */
  windowSize: number;
  /** 累積平均正規化差分関数の閾値。小さいほど厳しい */
  threshold: number;
}

export interface YinResult {
  /** 推定周波数 (Hz)。無声と判定した場合は null */
  freq: number | null;
  /** 推定の確からしさ 0..1 (1 - CMNDF の最小値) */
  clarity: number;
}

export class Yin {
  readonly opts: YinOptions;
  readonly tauMin: number;
  readonly tauMax: number;
  /** analyze() に渡すバッファに必要な長さ */
  readonly requiredLength: number;
  private readonly diff: Float32Array;

  constructor(opts: YinOptions) {
    this.opts = opts;
    this.tauMin = Math.max(2, Math.floor(opts.sampleRate / opts.maxFreq));
    this.tauMax = Math.ceil(opts.sampleRate / opts.minFreq);
    this.requiredLength = opts.windowSize + this.tauMax + 1;
    this.diff = new Float32Array(this.tauMax + 2);
  }

  /** buf の先頭 requiredLength サンプルを解析する */
  analyze(buf: Float32Array): YinResult {
    const { windowSize: W, threshold, sampleRate } = this.opts;
    const { tauMin, tauMax, diff: d } = this;
    if (buf.length < this.requiredLength) {
      throw new Error(`buffer too short: ${buf.length} < ${this.requiredLength}`);
    }

    // 1. 差分関数 d(tau)
    d[0] = 0;
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      let sum = 0;
      for (let j = 0; j < W; j++) {
        const delta = buf[j] - buf[j + tau];
        sum += delta * delta;
      }
      d[tau] = sum;
    }

    // 2. 累積平均正規化差分関数 (CMNDF) を d に上書き
    d[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      running += d[tau];
      d[tau] = running > 0 ? (d[tau] * tau) / running : 1;
    }

    // 3. 絶対閾値: 閾値を下回った最初の谷を採用。なければ全体の最小値
    let tauEst = -1;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (d[tau] < threshold) {
        while (tau + 1 <= tauMax && d[tau + 1] < d[tau]) tau++;
        tauEst = tau;
        break;
      }
    }
    if (tauEst === -1) {
      let minVal = Infinity;
      for (let tau = tauMin; tau <= tauMax; tau++) {
        if (d[tau] < minVal) {
          minVal = d[tau];
          tauEst = tau;
        }
      }
      // 閾値を大きく超える場合は無声とみなす
      const clarity = Math.max(0, 1 - minVal);
      if (minVal > 0.35) return { freq: null, clarity };
    }

    // 4. 放物線補間でサブサンプル精度に
    const x0 = d[tauEst - 1];
    const x1 = d[tauEst];
    const x2 = d[tauEst + 1];
    const denom = x0 - 2 * x1 + x2;
    const shift = denom !== 0 ? (0.5 * (x0 - x2)) / denom : 0;
    const betterTau = tauEst + Math.max(-1, Math.min(1, shift));

    return {
      freq: sampleRate / betterTau,
      clarity: Math.max(0, Math.min(1, 1 - x1)),
    };
  }
}
