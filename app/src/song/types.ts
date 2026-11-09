/** 練習パッケージ (.tkt) と保存データの型 */

export interface RefNote {
  /** 開始 (秒) */
  start: number;
  /** 終了 (秒) */
  end: number;
  /** MIDI ノート番号 (整数) */
  midi: number;
}

export interface PitchData {
  /** f0 のフレーム間隔 (秒) */
  hop: number;
  /** お手本の f0 曲線 (MIDI 小数, 無声は null) */
  f0: (number | null)[];
  notes: RefNote[];
}

export interface LyricLine {
  start: number;
  end: number;
  text: string;
  /** 自動で合わせられず、おおよその位置に置いた行 */
  aligned?: boolean;
}

export interface TktManifest {
  format: 'tkt';
  version: number;
  title: string;
  artist: string;
  duration: number;
  createdAt: string;
  analyzer?: Record<string, unknown>;
  files: { accompaniment: string; vocal: string; pitch: string; lyrics: string };
}

/** 曲一覧に出す情報 + 練習に必要な軽いデータ (音声は別テーブル) */
export interface SongRecord {
  id: string;
  title: string;
  artist: string;
  duration: number;
  createdAt: string;
  importedAt: number;
  bestScore: number | null;
  pitch: PitchData;
  lyrics: LyricLine[];
}

export interface SongAudio {
  /** `${songId}:accompaniment` / `${songId}:vocal` */
  key: string;
  songId: string;
  blob: Blob;
}
