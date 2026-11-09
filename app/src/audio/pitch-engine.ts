import type { PitchMessage } from './pitch-processor';
import { PitchTracker, type TrackedPitch } from './pitch-tracker';
import { getAudioContext, setAudioSession } from './context';

export type { PitchMessage, TrackedPitch };

/** mic: マイク / test: テスト信号 / node: 任意の音声ノード (お手本ボーカルでの自己テスト用) */
export type SourceKind = 'mic' | 'test' | 'node';

export interface EngineInfo {
  sampleRate: number;
  baseLatency: number | null;
  outputLatency: number | null;
  micSettings: MediaTrackSettings | null;
}

/** 解析結果の履歴を保持する時間 (秒) */
const HISTORY_SEC = 30;

/**
 * マイク (またはテスト信号) → AudioWorklet で音程推定 → history に蓄積する。
 * 描画側は history と now() を毎フレーム参照する。
 */
export class PitchEngine {
  ctx: AudioContext | null = null;
  readonly history: TrackedPitch[] = [];
  private readonly tracker = new PitchTracker();
  private node: AudioWorkletNode | null = null;
  private stream: MediaStream | null = null;
  private sourceNodes: AudioNode[] = [];
  private listeners = new Set<(m: TrackedPitch) => void>();

  /** 現在の AudioContext 時刻 (秒) */
  now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  get running(): boolean {
    return this.node != null;
  }

  onPitch(fn: (m: TrackedPitch) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 必ずユーザー操作 (タップ) のイベントハンドラ内から呼ぶこと */
  async start(kind: SourceKind, input?: AudioNode): Promise<EngineInfo> {
    await this.stop();
    this.tracker.reset();
    this.history.length = 0;

    setAudioSession(kind === 'mic' ? 'play-and-record' : 'playback');
    const ctx = (this.ctx = await getAudioContext());

    this.node = new AudioWorkletNode(ctx, 'pitch-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: 'explicit',
    });
    this.node.port.onmessage = (e: MessageEvent<PitchMessage>) => this.push(e.data);

    let micSettings: MediaTrackSettings | null = null;
    if (kind === 'mic') {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('このブラウザではマイクを使えません（HTTPS で開いているか確認してください）');
      }
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            // 音程検出の邪魔になる自動処理はすべて切る
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 1,
          },
        });
      } catch (e) {
        await this.stop();
        throw e;
      }
      micSettings = this.stream.getAudioTracks()[0]?.getSettings() ?? null;
      const src = ctx.createMediaStreamSource(this.stream);
      src.connect(this.node);
      this.sourceNodes.push(src);
    } else if (kind === 'node') {
      if (!input) throw new Error('入力ノードがありません');
      input.connect(this.node);
      const node = this.node;
      // stop() で切断するのは解析ノードへの接続だけ (input 自体は他でも使われている)
      const detach = () => {
        try {
          input.disconnect(node);
        } catch {
          /* 先に input 側が切断済み */
        }
      };
      this.sourceNodes.push({ disconnect: detach } as unknown as AudioNode);
    } else {
      this.startTestSignal(ctx, this.node);
    }

    return {
      sampleRate: ctx.sampleRate,
      baseLatency: ctx.baseLatency ?? null,
      outputLatency: (ctx as AudioContext & { outputLatency?: number }).outputLatency ?? null,
      micSettings,
    };
  }

  async stop(): Promise<void> {
    for (const n of this.sourceNodes) {
      if (n instanceof OscillatorNode) {
        try {
          n.stop();
        } catch {
          /* 停止済み */
        }
      }
      n.disconnect();
    }
    this.sourceNodes = [];
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.disconnect();
      this.node = null;
    }
  }

  /** 「ドレミファソファミレド」をビブラート付きで鳴らすテスト信号 (スピーカーにも小さく出す) */
  private startTestSignal(ctx: AudioContext, dest: AudioNode) {
    const t0 = ctx.currentTime + 0.05;
    const notes = [60, 62, 64, 65, 67, 65, 64, 62, 60];
    const dur = 0.6;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.5;
    const vibDepth = ctx.createGain();
    vibDepth.gain.value = 4; // Hz
    vib.connect(vibDepth).connect(osc.frequency);

    const env = ctx.createGain();
    env.gain.value = 0;
    notes.forEach((m, i) => {
      const t = t0 + i * dur;
      osc.frequency.setValueAtTime(440 * Math.pow(2, (m - 69) / 12), t);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.5, t + 0.03);
      env.gain.setValueAtTime(0.5, t + dur - 0.12);
      env.gain.linearRampToValueAtTime(0, t + dur - 0.05);
    });

    const monitor = ctx.createGain();
    monitor.gain.value = 0.15;

    osc.connect(lp).connect(env);
    env.connect(dest);
    env.connect(monitor).connect(ctx.destination);
    const end = t0 + notes.length * dur;
    osc.start(t0);
    vib.start(t0);
    osc.stop(end);
    vib.stop(end);
    this.sourceNodes.push(osc, vib, vibDepth, lp, env, monitor);
  }

  private push(raw: PitchMessage) {
    const m = this.tracker.push(raw);
    this.history.push(m);
    const cutoff = m.time - HISTORY_SEC;
    let drop = 0;
    while (drop < this.history.length && this.history[drop].time < cutoff) drop++;
    if (drop > 0) this.history.splice(0, drop);
    for (const fn of this.listeners) fn(m);
  }
}
