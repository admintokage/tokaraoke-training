/** 周波数・MIDI ノート番号・音名の変換 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_NAMES_JA = ['ド', 'ド#', 'レ', 'レ#', 'ミ', 'ファ', 'ファ#', 'ソ', 'ソ#', 'ラ', 'ラ#', 'シ'];

/** 周波数 (Hz) → MIDI ノート番号 (小数あり。A4 = 69 = 440Hz) */
export function freqToMidi(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440);
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** 例: 60 → "C4" */
export function midiToName(midi: number): string {
  const m = Math.round(midi);
  return `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

export function midiToNameJa(midi: number): string {
  const m = Math.round(midi);
  return NOTE_NAMES_JA[((m % 12) + 12) % 12];
}

export function isBlackKey(midi: number): boolean {
  return [1, 3, 6, 8, 10].includes(((Math.round(midi) % 12) + 12) % 12);
}

/** 最も近い半音からのずれ (セント, -50..+50) */
export function centsOff(midi: number): number {
  return Math.round((midi - Math.round(midi)) * 100);
}
