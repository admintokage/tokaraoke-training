import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PitchEngine } from '../audio/pitch-engine';
import { SongPlayer } from '../audio/player';
import { estimatedRoundTripLatency } from '../audio/context';
import { pitchDiff, Scorer, type ScoreResult } from '../practice/scorer';
import { getSong, getSongAudio, saveScore } from '../song/db';
import type { LyricLine, RefNote, SongRecord } from '../song/types';
import { PitchGraph, type TrackPoint } from '../ui/PitchGraph';
import { describeMicError, fmtTime } from '../ui/errors';

const OCTAVE_KEY = 'tokaraoke.octaveFree';
const VOCAL_ON = 0.8;
/** URL に ?selftest を付けると、マイクの代わりにお手本ボーカルで採点する (動作確認用) */
const SELF_TEST = new URLSearchParams(location.search).has('selftest');

type Load = { state: 'loading' } | { state: 'ready' } | { state: 'error'; message: string };

interface Session {
  scorer: Scorer;
  /** 歌い始めた曲の位置 */
  from: number;
}

/** S2 練習画面 */
export function Practice({ songId }: { songId: string }) {
  const player = useMemo(() => new SongPlayer(), []);
  const engine = useMemo(() => new PitchEngine(), []);
  const [song, setSong] = useState<SongRecord | null>(null);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [liveScore, setLiveScore] = useState<number | null>(null);
  const [vocalOn, setVocalOn] = useState(true);
  const [octaveFree, setOctaveFree] = useState(() => readBool(OCTAVE_KEY, true));
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(ScoreResult & { best: boolean; full: boolean }) | null>(null);

  const track = useRef<TrackPoint[]>([]).current;
  const session = useRef<Session | null>(null);
  const latency = useRef(0);
  const octaveRef = useRef(octaveFree);
  octaveRef.current = octaveFree;
  if (SELF_TEST) (window as unknown as Record<string, unknown>).__tk = { engine, player, track, session };

  // 曲データと音声の読み込み (デコードはタップ前に済ませておく)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await getSong(songId);
      if (!s) throw new Error('曲が見つかりません。曲一覧から選び直してください');
      if (cancelled) return;
      setSong(s);
      const audio = await getSongAudio(songId);
      await player.load(audio.accompaniment, audio.vocal);
      if (!cancelled) setLoad({ state: 'ready' });
    })().catch((e) => !cancelled && setLoad({ state: 'error', message: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
      player.dispose();
      void engine.stop();
    };
  }, [songId, player, engine]);

  const notes = song?.pitch.notes;
  const newSession = useCallback(
    (from: number) => {
      track.length = 0;
      session.current = notes ? { scorer: new Scorer(notes, { octaveFree: octaveRef.current }), from } : null;
      setLiveScore(null);
    },
    [notes, track],
  );

  // マイクの音程 → 曲の時刻に直して採点・表示
  useEffect(() => {
    if (!notes) return;
    return engine.onPitch((m) => {
      const s = session.current;
      if (!player.playing || !s) return;
      const t = player.songTimeAt(m.time - latency.current);
      if (t < s.from) return;
      const hit = s.scorer.add(t, m.midi);
      let midi = m.midi;
      // オクターブ違いを正解にする設定なら、表示もお手本と同じオクターブに寄せる
      if (midi != null && octaveRef.current) {
        const ref = s.scorer.noteAt(t) ?? nearestNote(notes, t);
        if (ref) midi = ref.midi + pitchDiff(midi, ref.midi, true);
      }
      track.push({ time: t, midi, hit });
    });
  }, [engine, player, notes, track]);

  // 再生位置・点数の表示更新 (10fps)
  useEffect(() => {
    const id = window.setInterval(() => {
      setPos(player.position());
      setPlaying(player.playing);
      setLiveScore(session.current?.scorer.current() ?? null);
    }, 100);
    return () => window.clearInterval(id);
  }, [player]);

  // 曲の最後まで歌ったら結果を出す
  useEffect(() => {
    if (!song) return;
    return player.onEnded(async () => {
      setPlaying(false);
      const s = session.current;
      if (!s) return;
      const r = s.scorer.result(song.lyrics);
      if (r.notes === 0) return;
      const full = s.from < 1;
      const best = full ? await saveScore(song.id, r.total) : false;
      if (best) setSong({ ...song, bestScore: r.total });
      setResult({ ...r, best, full });
    });
  }, [player, song]);

  /** マイクを開始する。使えなくても曲は再生する (採点なし) */
  const ensureMic = async () => {
    if (engine.running) return;
    try {
      if (SELF_TEST && player.vocalNode) {
        // 自己テスト: マイクの代わりにお手本ボーカルを解析する (遅延なし)
        await engine.start('node', player.vocalNode);
        latency.current = 0;
      } else {
        await engine.start('mic');
        latency.current = engine.ctx ? estimatedRoundTripLatency(engine.ctx) : 0;
      }
    } catch (e) {
      setError(`${describeMicError(e)}（伴奏だけ再生します）`);
    }
  };

  /** ▶ 歌う / ⏸ 一時停止 (タップのハンドラ内でマイクと再生を開始する) */
  const togglePlay = async () => {
    setError(null);
    if (player.playing) {
      player.pause();
      setPlaying(false);
      return;
    }
    await ensureMic();
    const from = player.position() >= player.duration - 0.1 ? 0 : player.position();
    if (!session.current || from === 0) newSession(from);
    await player.play(from);
    setPlaying(true);
  };

  const restart = async () => {
    setResult(null);
    setError(null);
    await ensureMic();
    newSession(0);
    await player.play(0);
    setPlaying(true);
  };

  const seek = (t: number) => {
    player.seek(t);
    newSession(t);
    setPos(t);
  };

  const toggleVocal = () => {
    const on = !vocalOn;
    setVocalOn(on);
    player.vocalVolume = on ? VOCAL_ON : 0;
  };

  const toggleOctave = () => {
    const v = !octaveFree;
    setOctaveFree(v);
    writeBool(OCTAVE_KEY, v);
    newSession(player.position());
  };

  const lyric = useMemo(() => currentLyrics(song?.lyrics ?? [], pos), [song, pos]);
  const duration = player.duration || song?.duration || 0;

  return (
    <div className="app practice">
      <header className="topbar">
        <a className="back" href="#/">
          ‹ 曲一覧
        </a>
        <div className="title-block">
          <span className="song-title">{song?.title ?? ''}</span>
          {song?.artist && <span className="song-sub">{song.artist}</span>}
        </div>
        <span className="live-score" aria-label="今の点数">
          {liveScore != null ? (
            <>
              <b>{Math.round(liveScore)}</b>点
            </>
          ) : song?.bestScore != null ? (
            <span className="dim">ベスト {Math.round(song.bestScore)}点</span>
          ) : (
            ''
          )}
        </span>
      </header>

      <main className="graph-wrap">
        <PitchGraph getNow={() => player.position()} track={track} notes={notes} seconds={6} nowX={0.3} />
        {load.state !== 'ready' && (
          <div className="overlay">
            {load.state === 'loading' ? <p>曲を準備しています…</p> : <p className="error">{load.message}</p>}
          </div>
        )}
        {load.state === 'ready' && !playing && pos === 0 && !result && (
          <div className="overlay soft">
            <p>「▶ 歌う」で伴奏が流れ、採点が始まります。</p>
            <p className="hint">🎧 有線イヤホン推奨（スピーカーだと伴奏の音を拾ってしまいます）</p>
          </div>
        )}
      </main>

      <section className="lyrics" aria-live="off">
        <p className={`lyric-line current ${lyric.current?.aligned === false ? 'rough' : ''}`}>
          {lyric.current?.text ?? ' '}
        </p>
        <p className="lyric-line next">{lyric.next?.text ?? ' '}</p>
      </section>

      <div className="seek">
        <span>{fmtTime(pos)}</span>
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.1}
          value={Math.min(pos, duration || 1)}
          disabled={load.state !== 'ready'}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="再生位置"
        />
        <span>{fmtTime(duration)}</span>
      </div>

      {error && <p className="error">{error}</p>}

      <footer className="controls">
        <button className="secondary" onClick={restart} disabled={load.state !== 'ready'} aria-label="最初から歌う">
          ⏮
        </button>
        <button className="primary" onClick={togglePlay} disabled={load.state !== 'ready'}>
          {playing ? '⏸ 一時停止' : '▶ 歌う'}
        </button>
        <button className={`secondary toggle ${vocalOn ? 'on' : ''}`} onClick={toggleVocal} aria-pressed={vocalOn}>
          お手本
          <br />
          {vocalOn ? 'あり' : 'なし'}
        </button>
      </footer>

      <label className="option">
        <input type="checkbox" checked={octaveFree} onChange={toggleOctave} />
        オクターブ違いも正解にする（男女で高さが違う曲向け）
      </label>

      {result && (
        <div className="modal" role="dialog" aria-label="採点結果">
          <div className="modal-body">
            <p className="result-label">{result.full ? '採点結果' : '採点結果（途中から）'}</p>
            <p className="result-score">
              <b>{Math.round(result.total)}</b>点
            </p>
            {result.best && <p className="result-best">🎉 ベスト更新！</p>}
            <ul className="line-scores">
              {result.lines
                .filter((l) => l.score != null)
                .map((l) => (
                  <li key={l.index}>
                    <span className="bar">
                      <span style={{ width: `${l.score}%` }} className={l.score! >= 80 ? 'good' : ''} />
                    </span>
                    <span className="num">{l.score}</span>
                    <span className="text">{l.text}</span>
                  </li>
                ))}
            </ul>
            <div className="modal-actions">
              <button className="secondary" onClick={() => setResult(null)}>
                閉じる
              </button>
              <button className="primary" onClick={restart}>
                もう一度
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 今歌う行と次の行。行の少し前 (0.3 秒) から表示を切り替える */
export function currentLyrics(lines: LyricLine[], pos: number): { current?: LyricLine; next?: LyricLine } {
  const t = pos + 0.3;
  let i = -1;
  for (let k = 0; k < lines.length; k++) {
    if (lines[k].start <= t) i = k;
    else break;
  }
  if (i < 0) return { next: lines[0] };
  // 行が終わって次の行まで間が空いているときは、次の行を先に見せる
  if (t > lines[i].end + 1 && lines[i + 1]) return { next: lines[i + 1] };
  return { current: lines[i], next: lines[i + 1] };
}

function nearestNote(notes: RefNote[], t: number): RefNote | null {
  let best: RefNote | null = null;
  let bestD = 1.0; // 1 秒以内のノートだけ
  for (const n of notes) {
    const d = t < n.start ? n.start - t : t > n.end ? t - n.end : 0;
    if (d < bestD) {
      bestD = d;
      best = n;
    }
    if (n.start > t + 1) break;
  }
  return best;
}

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

function writeBool(key: string, v: boolean) {
  try {
    localStorage.setItem(key, v ? '1' : '0');
  } catch {
    /* 保存できなくても動作は続ける */
  }
}
