import processorUrl from './pitch-processor.ts?worker&url';

/**
 * アプリ全体で 1 つの AudioContext を共有する (曲の再生とマイク解析の時刻をそろえるため)。
 * resume=true (既定) のときは必ずユーザー操作 (タップ) のイベントハンドラ内から呼ぶこと。
 * resume=false なら停止状態のまま返す (音声のデコードを先にしておく用途)。
 */
let ctxPromise: Promise<AudioContext> | null = null;

export function getAudioContext(resume = true): Promise<AudioContext> {
  if (!ctxPromise) {
    ctxPromise = (async () => {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      await ctx.audioWorklet.addModule(processorUrl);
      return ctx;
    })();
    ctxPromise.catch(() => (ctxPromise = null));
  }
  return ctxPromise.then(async (ctx) => {
    if (resume && ctx.state !== 'running') await ctx.resume();
    return ctx;
  });
}

/** iOS: マナーモードでも音を出し、マイクと再生を同時に使えるようにする (Safari 16.4+) */
export function setAudioSession(type: 'playback' | 'play-and-record'): void {
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  if (!nav.audioSession) return;
  try {
    nav.audioSession.type = type;
  } catch {
    /* 未対応なら無視 */
  }
}

/** 出力 (スピーカー/イヤホン) と入力 (マイク) の遅延の合計の目安 (秒) */
export function estimatedRoundTripLatency(ctx: AudioContext): number {
  const out = (ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0;
  return (Number.isFinite(out) ? out : 0) + (ctx.baseLatency ?? 0);
}
