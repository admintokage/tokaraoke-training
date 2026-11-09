import { useEffect, useRef } from 'react';
import { isBlackKey, midiToName } from '../audio/music';
import type { RefNote } from '../song/types';

/** グラフに描く声の音程 1 点 */
export interface TrackPoint {
  time: number;
  /** 表示する高さ (MIDI 小数)。無声は null */
  midi: number | null;
  /** お手本と合っていれば true、外れていれば false、採点対象外は null/undefined */
  hit?: boolean | null;
}

interface Props {
  /** 「今」の時刻 (track・notes と同じ時間軸) */
  getNow: () => number;
  /** 声の音程の列 (時刻順)。毎フレーム読み直すので、同じ配列に追記していけばよい */
  track: readonly TrackPoint[];
  /** お手本のノート (時刻順) */
  notes?: readonly RefNote[];
  /** 横軸に表示する秒数 */
  seconds?: number;
  /** 「今」の縦線の位置 (左からの割合) */
  nowX?: number;
}

/** 声の線を途切れさせる時間の空き (秒) */
const GAP_SEC = 0.06;
/** これより大きい跳躍 (半音) は線をつながない */
const JUMP_SEMITONES = 2.5;

/**
 * 横スクロールの音程グラフ。縦軸は半音ごとの帯、横軸は時間。
 * お手本ノートがあればバーで描き、表示範囲はお手本 (なければ声) の高さにゆっくり追従する。
 */
export function PitchGraph({ getNow, track, notes, seconds = 6, nowX = 0.75 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // 毎フレーム最新の props を読む (描画ループを作り直さないため)
  const props = useRef({ getNow, track, notes, seconds, nowX });
  props.current = { getNow, track, notes, seconds, nowX };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx2d = canvas.getContext('2d')!;
    let raf = 0;
    let centerMidi = 62; // 初期表示の中心 (D4)
    let centerReady = false;
    let size = { w: 0, h: 0, dpr: 1 };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      size = { w: rect.width, h: rect.height, dpr };
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const css = getComputedStyle(document.documentElement);
    const color = (name: string) => css.getPropertyValue(name).trim();
    const C = {
      bg: color('--graph-bg'),
      black: color('--graph-black-key'),
      line: color('--graph-line'),
      lineC: color('--graph-line-c'),
      label: color('--text-dim'),
      now: color('--graph-now'),
      voice: color('--accent'),
      good: color('--good'),
      voiceDim: color('--voice-dim'),
      bar: color('--ref-bar'),
      barActive: color('--ref-bar-active'),
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const { w, h, dpr } = size;
      if (w === 0 || h === 0) return;
      const { getNow, track, notes, seconds, nowX } = props.current;
      const g = ctx2d;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);

      const now = getNow();
      const span = h < 300 ? 14 : h < 480 ? 18 : 24; // 表示する半音数
      const t0 = now - seconds * nowX;
      const t1 = t0 + seconds;

      // 表示の中心: 画面内のお手本ノートの中央値。なければ直近 1.5 秒の声の中央値
      const target = medianTarget(notes, track, t0, t1, now);
      if (target != null) {
        if (!centerReady) {
          centerMidi = target;
          centerReady = true;
        } else if (Math.abs(target - centerMidi) > span * 0.25) {
          centerMidi += (target - centerMidi) * 0.04;
        }
      }
      const lo = centerMidi - span / 2;
      const rowH = h / span;
      const yOf = (midi: number) => h - (midi - lo) * rowH;
      const xOf = (t: number) => ((t - t0) / seconds) * w;

      // 背景と半音の帯
      g.fillStyle = C.bg;
      g.fillRect(0, 0, w, h);
      for (let m = Math.floor(lo); m <= lo + span + 1; m++) {
        const yTop = yOf(m + 0.5);
        if (isBlackKey(m)) {
          g.fillStyle = C.black;
          g.fillRect(0, yTop, w, rowH);
        }
        const isC = ((m % 12) + 12) % 12 === 0;
        g.strokeStyle = isC ? C.lineC : C.line;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(0, Math.round(yTop) + 0.5);
        g.lineTo(w, Math.round(yTop) + 0.5);
        g.stroke();
      }

      // お手本ノートのバー
      if (notes) {
        const barH = Math.max(6, rowH * 0.7);
        for (let i = lowerBound(notes, t0 - 10); i < notes.length; i++) {
          const n = notes[i];
          if (n.start > t1) break;
          if (n.end < t0) continue;
          const x0 = xOf(n.start);
          const x1 = xOf(n.end);
          const active = n.start <= now && now < n.end;
          g.fillStyle = active ? C.barActive : C.bar;
          roundRect(g, x0, yOf(n.midi) - barH / 2, Math.max(2, x1 - x0 - 1), barH, Math.min(4, barH / 2));
          g.fill();
        }
      }

      // 音名ラベル (バーより手前)
      for (let m = Math.floor(lo); m <= lo + span + 1; m++) {
        if (isBlackKey(m)) continue;
        const isC = ((m % 12) + 12) % 12 === 0;
        g.fillStyle = C.label;
        g.font = `${isC ? 600 : 400} ${Math.min(12, rowH * 0.8)}px system-ui, sans-serif`;
        g.textBaseline = 'middle';
        g.fillText(midiToName(m), 6, yOf(m));
      }

      // 現在位置の縦線
      const nx = w * nowX;
      g.strokeStyle = C.now;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(nx, 0);
      g.lineTo(nx, h);
      g.stroke();

      // 声の音程の線 (合っている所は緑)
      g.lineWidth = 3;
      g.lineJoin = 'round';
      g.lineCap = 'round';
      let prev: { x: number; y: number; t: number } | null = null;
      let curColor = '';
      let last: { x: number; y: number; color: string } | null = null;
      g.beginPath();
      for (let i = lowerBound(track, t0 - 0.1); i < track.length; i++) {
        const p = track[i];
        if (p.time > now + 0.05) break;
        if (p.midi == null) {
          prev = null;
          continue;
        }
        const x = xOf(p.time);
        const y = yOf(p.midi);
        const col = p.hit === true ? C.good : p.hit === false ? C.voice : notes ? C.voiceDim : C.voice;
        if (col !== curColor) {
          g.stroke();
          g.beginPath();
          g.strokeStyle = curColor = col;
          if (prev) g.moveTo(prev.x, prev.y);
          else g.moveTo(x, y);
        }
        // 時間が空いたときや大きく跳んだとき (オクターブの折り返しなど) は線をつながない
        if (!prev || p.time - prev.t > GAP_SEC || Math.abs(y - prev.y) > rowH * JUMP_SEMITONES) g.moveTo(x, y);
        else g.lineTo(x, y);
        prev = { x, y, t: p.time };
        last = { x, y, color: col };
      }
      g.stroke();

      // 最新の点 (声が出ている間だけ)
      const latest = track[track.length - 1];
      if (last && latest?.midi != null && now - latest.time < 0.2) {
        g.fillStyle = last.color;
        g.beginPath();
        g.arc(last.x, last.y, 6, 0, Math.PI * 2);
        g.fill();
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="pitch-graph" aria-label="音程グラフ" />;
}

/** time が t 以上の最初の要素 (start/time で二分探索) */
function lowerBound(arr: readonly (RefNote | TrackPoint)[], t: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const v = arr[mid];
    const key = 'start' in v ? v.end : v.time;
    if (key < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function medianTarget(
  notes: readonly RefNote[] | undefined,
  track: readonly TrackPoint[],
  t0: number,
  t1: number,
  now: number,
): number | null {
  const vals: number[] = [];
  if (notes) {
    for (let i = lowerBound(notes, t0); i < notes.length && notes[i].start <= t1; i++) vals.push(notes[i].midi);
  }
  if (vals.length === 0) {
    for (let i = track.length - 1; i >= 0 && track[i].time > now - 1.5; i--) {
      const m = track[i].midi;
      if (m != null) vals.push(m);
    }
    if (vals.length <= 5) return null;
  }
  vals.sort((a, b) => a - b);
  return vals[vals.length >> 1];
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
