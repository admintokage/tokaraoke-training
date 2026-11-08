import { useEffect, useRef } from 'react';
import type { PitchEngine } from '../audio/pitch-engine';
import { isBlackKey, midiToName } from '../audio/music';

interface Props {
  engine: PitchEngine;
  /** 横軸に表示する秒数 */
  seconds?: number;
}

/** 「現在」の縦線の位置 (左からの割合)。右側は将来お手本ノートの先読み表示に使う */
const NOW_X = 0.75;
/** 声の線を途切れさせる時間の空き (秒) */
const GAP_SEC = 0.06;

/**
 * 横スクロールの音程グラフ。縦軸は半音ごとの帯、横軸は時間。
 * 表示範囲は歌っている高さに合わせてゆっくり追従する。
 */
export function PitchGraph({ engine, seconds = 6 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx2d = canvas.getContext('2d')!;
    let raf = 0;
    let centerMidi = 62; // 初期表示の中心 (D4)
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
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const { w, h, dpr } = size;
      if (w === 0 || h === 0) return;
      const g = ctx2d;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);

      const now = engine.now();
      const hist = engine.history;
      const span = h < 360 ? 14 : h < 520 ? 18 : 24; // 表示する半音数

      // 直近 1.5 秒の声の高さの中央値に、表示の中心をゆっくり寄せる
      const recent: number[] = [];
      for (let i = hist.length - 1; i >= 0 && hist[i].time > now - 1.5; i--) {
        const m = hist[i].midi;
        if (m != null) recent.push(m);
      }
      if (recent.length > 5) {
        recent.sort((a, b) => a - b);
        const median = recent[Math.floor(recent.length / 2)];
        if (Math.abs(median - centerMidi) > span * 0.3) {
          centerMidi += (median - centerMidi) * 0.04;
        }
      }
      const lo = centerMidi - span / 2;
      const rowH = h / span;
      const yOf = (midi: number) => h - (midi - lo) * rowH;
      const t0 = now - seconds * NOW_X;
      const xOf = (t: number) => ((t - t0) / seconds) * w;

      // 背景と半音の帯
      g.fillStyle = C.bg;
      g.fillRect(0, 0, w, h);
      const firstRow = Math.floor(lo);
      for (let m = firstRow; m <= lo + span + 1; m++) {
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
        if (!isBlackKey(m)) {
          g.fillStyle = C.label;
          g.font = `${isC ? 600 : 400} ${Math.min(12, rowH * 0.8)}px system-ui, sans-serif`;
          g.textBaseline = 'middle';
          g.fillText(midiToName(m), 6, yOf(m));
        }
      }

      // 現在位置の縦線
      const nowX = w * NOW_X;
      g.strokeStyle = C.now;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(nowX, 0);
      g.lineTo(nowX, h);
      g.stroke();

      // 声の音程の線
      g.strokeStyle = C.voice;
      g.lineWidth = 3;
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.beginPath();
      let prevT = -Infinity;
      let drawing = false;
      let last: { x: number; y: number } | null = null;
      for (let i = 0; i < hist.length; i++) {
        const p = hist[i];
        if (p.time < t0 - 0.1) continue;
        if (p.midi == null) {
          drawing = false;
          continue;
        }
        const x = xOf(p.time);
        const y = yOf(p.midi);
        if (!drawing || p.time - prevT > GAP_SEC) g.moveTo(x, y);
        else g.lineTo(x, y);
        drawing = true;
        prevT = p.time;
        last = { x, y };
      }
      g.stroke();

      // 最新の点 (声が出ている間だけ)
      const latest = hist[hist.length - 1];
      if (last && latest?.midi != null && now - latest.time < 0.2) {
        g.fillStyle = C.voice;
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
  }, [engine, seconds]);

  return <canvas ref={canvasRef} className="pitch-graph" aria-label="音程グラフ" />;
}
