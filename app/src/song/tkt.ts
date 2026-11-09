import { unzipSync, strFromU8 } from 'fflate';
import type { LyricLine, PitchData, RefNote, TktManifest } from './types';

export interface ParsedTkt {
  manifest: TktManifest;
  pitch: PitchData;
  lyrics: LyricLine[];
  accompaniment: Blob;
  vocal: Blob;
}

export class TktError extends Error {}

/** .tkt (zip) を展開して中身を検証する */
export function parseTkt(data: Uint8Array): ParsedTkt {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch {
    throw new TktError('.tkt ファイルとして読み込めませんでした（壊れているか、別の種類のファイルです）');
  }

  const json = <T,>(name: string): T => {
    const f = files[name];
    if (!f) throw new TktError(`.tkt の中に ${name} がありません`);
    try {
      return JSON.parse(strFromU8(f)) as T;
    } catch {
      throw new TktError(`${name} を読み込めませんでした`);
    }
  };

  const manifest = json<TktManifest>('manifest.json');
  if (manifest.format !== 'tkt') throw new TktError('tokaraoke の .tkt ファイルではありません');
  if (manifest.version !== 1) {
    throw new TktError(`この .tkt（形式 ${manifest.version}）には対応していません。アプリを最新にしてください`);
  }
  const names = manifest.files;
  if (!names?.accompaniment || !names.vocal || !names.pitch || !names.lyrics) {
    throw new TktError('manifest.json の files が不完全です');
  }

  const pitch = json<PitchData>(names.pitch);
  if (!(pitch.hop > 0) || !Array.isArray(pitch.f0) || !Array.isArray(pitch.notes)) {
    throw new TktError('pitch.json の形式が正しくありません');
  }
  pitch.notes = pitch.notes.filter(isNote).sort((a, b) => a.start - b.start);

  const lyricsRaw = json<{ lines?: LyricLine[] }>(names.lyrics);
  const lyrics = (lyricsRaw.lines ?? []).filter(
    (l) => typeof l.text === 'string' && Number.isFinite(l.start) && Number.isFinite(l.end),
  );

  const audio = (name: string) => {
    const f = files[name];
    if (!f || f.length === 0) throw new TktError(`.tkt の中に ${name} がありません`);
    return new Blob([f as Uint8Array<ArrayBuffer>], { type: 'audio/mp4' });
  };

  return {
    manifest: {
      ...manifest,
      title: String(manifest.title || '無題'),
      artist: String(manifest.artist || ''),
      duration: Number(manifest.duration) || 0,
    },
    pitch,
    lyrics,
    accompaniment: audio(names.accompaniment),
    vocal: audio(names.vocal),
  };
}

function isNote(n: unknown): n is RefNote {
  const x = n as RefNote;
  return Number.isFinite(x?.start) && Number.isFinite(x?.end) && Number.isFinite(x?.midi) && x.end > x.start;
}
