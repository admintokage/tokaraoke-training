import { getAudioContext } from './context';

/**
 * 伴奏とお手本ボーカルを同時に再生するプレーヤー。
 * 時刻は AudioContext の時計を基準にするので、マイク解析の時刻と正確に対応づけられる。
 */
export class SongPlayer {
  private ctx: AudioContext | null = null;
  private acc: AudioBuffer | null = null;
  private voc: AudioBuffer | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private accGain: GainNode | null = null;
  private vocGain: GainNode | null = null;
  /** 再生開始時の AudioContext 時刻と曲の位置 */
  private startCtxTime = 0;
  private startOffset = 0;
  private pausedAt = 0;
  private _playing = false;
  private _vocalVolume = 0.8;
  private endListeners = new Set<() => void>();

  duration = 0;

  /** お手本ボーカルの出力 (自己テストで解析に回す) */
  get vocalNode(): AudioNode | null {
    return this.vocGain;
  }

  get loaded(): boolean {
    return this.acc != null;
  }

  get playing(): boolean {
    return this._playing;
  }

  /** 音声を読み込んでデコードする (タップ前でもよい。再生は play() をタップ内で呼ぶ) */
  async load(accompaniment: Blob, vocal: Blob): Promise<void> {
    const ctx = (this.ctx = await getAudioContext(false));
    const [acc, voc] = await Promise.all([decode(ctx, accompaniment), decode(ctx, vocal)]);
    this.acc = acc;
    // お手本ボーカルはモノラルにしてメモリを節約する
    this.voc = toMono(ctx, voc);
    this.duration = Math.max(acc.duration, voc.duration);

    this.accGain = ctx.createGain();
    this.vocGain = ctx.createGain();
    this.vocGain.gain.value = this._vocalVolume;
    this.accGain.connect(ctx.destination);
    this.vocGain.connect(ctx.destination);
  }

  /** 今の曲の位置 (秒) */
  position(): number {
    if (!this._playing || !this.ctx) return this.pausedAt;
    return Math.min(this.duration, this.startOffset + (this.ctx.currentTime - this.startCtxTime));
  }

  /** AudioContext の時刻 → 曲の位置 (再生中のみ意味がある) */
  songTimeAt(ctxTime: number): number {
    return this.startOffset + (ctxTime - this.startCtxTime);
  }

  async play(from = this.position()): Promise<void> {
    if (!this.ctx || !this.acc || !this.voc) return;
    this.stopSources();
    const ctx = this.ctx;
    if (ctx.state !== 'running') await ctx.resume();
    const at = ctx.currentTime + 0.05;
    from = Math.max(0, Math.min(from, this.duration - 0.05));

    const accSrc = ctx.createBufferSource();
    accSrc.buffer = this.acc;
    accSrc.connect(this.accGain!);
    const vocSrc = ctx.createBufferSource();
    vocSrc.buffer = this.voc;
    vocSrc.connect(this.vocGain!);
    accSrc.start(at, from);
    vocSrc.start(at, from);
    accSrc.onended = () => {
      if (this.sources[0] === accSrc) {
        this._playing = false;
        this.pausedAt = this.duration;
        this.sources = [];
        for (const fn of this.endListeners) fn();
      }
    };
    this.sources = [accSrc, vocSrc];
    this.startCtxTime = at;
    this.startOffset = from;
    this._playing = true;
  }

  pause(): void {
    if (!this._playing) return;
    this.pausedAt = this.position();
    this._playing = false;
    this.stopSources();
  }

  seek(time: number): void {
    const t = Math.max(0, Math.min(time, this.duration));
    if (this._playing) void this.play(t);
    else this.pausedAt = t;
  }

  /** お手本ボーカルの音量 0〜1 */
  set vocalVolume(v: number) {
    this._vocalVolume = v;
    if (this.vocGain && this.ctx) this.vocGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  get vocalVolume(): number {
    return this._vocalVolume;
  }

  onEnded(fn: () => void): () => void {
    this.endListeners.add(fn);
    return () => this.endListeners.delete(fn);
  }

  dispose(): void {
    this.stopSources();
    this._playing = false;
    this.accGain?.disconnect();
    this.vocGain?.disconnect();
    this.acc = this.voc = null;
    this.endListeners.clear();
  }

  private stopSources() {
    const old = this.sources;
    this.sources = [];
    for (const s of old) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* 未開始・停止済み */
      }
      s.disconnect();
    }
  }
}

async function decode(ctx: AudioContext, blob: Blob): Promise<AudioBuffer> {
  try {
    return await ctx.decodeAudioData(await blob.arrayBuffer());
  } catch {
    throw new Error('音声を読み込めませんでした（このブラウザで再生できない形式の可能性があります）');
  }
}

function toMono(ctx: AudioContext, buf: AudioBuffer): AudioBuffer {
  if (buf.numberOfChannels === 1) return buf;
  const out = ctx.createBuffer(1, buf.length, buf.sampleRate);
  const dst = out.getChannelData(0);
  const n = buf.numberOfChannels;
  for (let c = 0; c < n; c++) {
    const src = buf.getChannelData(c);
    for (let i = 0; i < src.length; i++) dst[i] += src[i] / n;
  }
  return out;
}
