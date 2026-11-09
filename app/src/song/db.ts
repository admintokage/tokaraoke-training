import Dexie, { type EntityTable } from 'dexie';
import type { SongAudio, SongRecord } from './types';
import { parseTkt } from './tkt';

/** 端末内の保存先 (IndexedDB)。音声は一覧の読み込みを軽くするため別テーブル */
class TokaraokeDB extends Dexie {
  songs!: EntityTable<SongRecord, 'id'>;
  audio!: EntityTable<SongAudio, 'key'>;

  constructor() {
    super('tokaraoke');
    this.version(1).stores({
      songs: 'id, importedAt',
      audio: 'key, songId',
    });
  }
}

export const db = new TokaraokeDB();

export type SongSummary = Pick<SongRecord, 'id' | 'title' | 'artist' | 'duration' | 'bestScore' | 'importedAt'>;

export async function listSongs(): Promise<SongSummary[]> {
  const all = await db.songs.orderBy('importedAt').reverse().toArray();
  return all.map(({ id, title, artist, duration, bestScore, importedAt }) => ({
    id,
    title,
    artist,
    duration,
    bestScore,
    importedAt,
  }));
}

/** .tkt を取り込む。同じ曲 (曲名・アーティスト・作成日時が同じ) は上書きし、ベストスコアは引き継ぐ */
export async function importTkt(file: Blob): Promise<SongRecord> {
  const t = parseTkt(new Uint8Array(await file.arrayBuffer()));
  const m = t.manifest;
  const same = await db.songs
    .filter((s) => s.title === m.title && s.artist === m.artist && s.createdAt === m.createdAt)
    .first();
  const song: SongRecord = {
    id: same?.id ?? crypto.randomUUID(),
    title: m.title,
    artist: m.artist,
    duration: m.duration,
    createdAt: m.createdAt,
    importedAt: Date.now(),
    bestScore: same?.bestScore ?? null,
    pitch: t.pitch,
    lyrics: t.lyrics,
  };
  await db.transaction('rw', db.songs, db.audio, async () => {
    await db.songs.put(song);
    await db.audio.bulkPut([
      { key: `${song.id}:accompaniment`, songId: song.id, blob: t.accompaniment },
      { key: `${song.id}:vocal`, songId: song.id, blob: t.vocal },
    ]);
  });
  void requestPersistence();
  return song;
}

export async function getSong(id: string): Promise<SongRecord | undefined> {
  return db.songs.get(id);
}

export async function getSongAudio(id: string): Promise<{ accompaniment: Blob; vocal: Blob }> {
  const [acc, voc] = await db.audio.bulkGet([`${id}:accompaniment`, `${id}:vocal`]);
  if (!acc || !voc) throw new Error('曲の音声データが見つかりません。もう一度取り込んでください');
  return { accompaniment: acc.blob, vocal: voc.blob };
}

export async function deleteSong(id: string): Promise<void> {
  await db.transaction('rw', db.songs, db.audio, async () => {
    await db.songs.delete(id);
    await db.audio.where('songId').equals(id).delete();
  });
}

/** ベストスコアを更新したら true */
export async function saveScore(id: string, score: number): Promise<boolean> {
  const song = await db.songs.get(id);
  if (!song) return false;
  if (song.bestScore != null && song.bestScore >= score) return false;
  await db.songs.update(id, { bestScore: score });
  return true;
}

/** iOS などでデータが自動で消されにくくなるよう、永続化を要求する */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
