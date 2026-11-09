import { useEffect, useMemo, useRef, useState } from 'react';
import { PitchEngine, type EngineInfo, type SourceKind, type TrackedPitch } from '../audio/pitch-engine';
import { midiToFreq, midiToName, midiToNameJa } from '../audio/music';
import { PitchGraph } from '../ui/PitchGraph';
import { describeMicError } from '../ui/errors';

type Status = 'idle' | 'starting' | 'running' | 'error';

/** マイクの音程だけを表示する画面 (M1 の音程モニター) */
export function MicTest() {
  const engine = useMemo(() => new PitchEngine(), []);
  const [status, setStatus] = useState<Status>('idle');
  const [source, setSource] = useState<SourceKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<EngineInfo | null>(null);
  const [reading, setReading] = useState<TrackedPitch | null>(null);
  const latest = useRef<TrackedPitch | null>(null);

  // 数値表示は 15fps 程度に間引いて更新する
  useEffect(() => {
    const off = engine.onPitch((m) => (latest.current = m));
    const id = window.setInterval(() => setReading(latest.current), 66);
    return () => {
      off();
      window.clearInterval(id);
    };
  }, [engine]);

  useEffect(() => () => void engine.stop(), [engine]);

  const start = async (kind: SourceKind) => {
    setError(null);
    setStatus('starting');
    try {
      setInfo(await engine.start(kind));
      setSource(kind);
      setStatus('running');
    } catch (e) {
      setStatus('error');
      setSource(null);
      setError(describeMicError(e));
    }
  };

  const stop = async () => {
    await engine.stop();
    setSource(null);
    setStatus('idle');
  };

  const voiced = reading?.note != null && reading.smoothMidi != null && engine.now() - reading.time < 0.25;
  const midi = voiced ? reading!.note : null;
  const smoothMidi = voiced ? reading!.smoothMidi! : null;
  const cents =
    midi != null && smoothMidi != null ? Math.max(-50, Math.min(50, Math.round((smoothMidi - midi) * 100))) : 0;
  const levelDb = reading ? 20 * Math.log10(Math.max(reading.rms, 1e-5)) : -100;

  return (
    <div className="app">
      <header className="topbar">
        <a className="back" href="#/">
          ‹ 曲一覧
        </a>
        <span className="badge">マイクテスト</span>
      </header>

      <section className="readout" aria-live="off">
        <div className="note">
          <span className="note-name">{midi != null ? midiToName(midi) : '—'}</span>
          <span className="note-ja">{midi != null ? midiToNameJa(midi) : ''}</span>
        </div>
        <div className="cents">
          <div className="cents-track">
            <div className="cents-center" />
            {midi != null && (
              <div
                className={`cents-marker ${Math.abs(cents) <= 15 ? 'good' : ''}`}
                style={{ left: `${50 + cents}%` }}
              />
            )}
          </div>
          <div className="cents-labels">
            <span>♭ 低い</span>
            <span>{midi != null ? `${cents > 0 ? '+' : ''}${cents} セント` : ''}</span>
            <span>高い ♯</span>
          </div>
        </div>
        <div className="meta">
          <span>{smoothMidi != null ? `${midiToFreq(smoothMidi).toFixed(1)} Hz` : '— Hz'}</span>
          <span className="level">
            <span className="level-bar" style={{ width: `${Math.max(0, Math.min(100, (levelDb + 60) * (100 / 60)))}%` }} />
          </span>
        </div>
      </section>

      <main className="graph-wrap">
        <PitchGraph getNow={() => engine.now()} track={engine.history} />
        {status !== 'running' && (
          <div className="overlay">
            <p>
              「マイク開始」を押して声を出すと、
              <br />
              音程がグラフに表示されます。
            </p>
            <p className="hint">🎧 イヤホンを使い、静かな場所で試してください</p>
          </div>
        )}
      </main>

      {error && <p className="error">{error}</p>}

      <footer className="controls">
        {status === 'running' ? (
          <button className="primary" onClick={stop}>
            ■ 停止{source === 'test' ? '（テスト信号）' : ''}
          </button>
        ) : (
          <button className="primary" onClick={() => start('mic')} disabled={status === 'starting'}>
            🎤 マイク開始
          </button>
        )}
        <button className="secondary" onClick={() => start('test')} disabled={status === 'starting'}>
          テスト信号
        </button>
      </footer>

      {info && (
        <details className="debug">
          <summary>技術情報</summary>
          <dl>
            <dt>サンプルレート</dt>
            <dd>{info.sampleRate} Hz</dd>
            <dt>入力遅延 (baseLatency)</dt>
            <dd>{fmtMs(info.baseLatency)}</dd>
            <dt>出力遅延 (outputLatency)</dt>
            <dd>{fmtMs(info.outputLatency)}</dd>
            {info.micSettings && (
              <>
                <dt>エコー除去 / ノイズ抑制 / 自動音量</dt>
                <dd>
                  {onOff(info.micSettings.echoCancellation)} / {onOff(info.micSettings.noiseSuppression)} /{' '}
                  {onOff(info.micSettings.autoGainControl)}
                </dd>
              </>
            )}
          </dl>
        </details>
      )}
    </div>
  );
}

function fmtMs(sec: number | null) {
  return sec == null ? '不明' : `${(sec * 1000).toFixed(1)} ms`;
}

function onOff(v: boolean | string | undefined) {
  if (v == null) return '不明';
  if (typeof v === 'string') return v;
  return v ? 'ON' : 'OFF';
}
