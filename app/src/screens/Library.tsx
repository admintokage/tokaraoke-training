import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteSong, importTkt, listSongs, type SongSummary } from '../song/db';
import { fmtTime } from '../ui/errors';

/** S1 曲ライブラリ: 曲一覧と .tkt の取り込み */
export function Library() {
  const [songs, setSongs] = useState<SongSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => setSongs(await listSongs()), []);
  useEffect(() => {
    reload().catch((e) => setMessage({ kind: 'error', text: `曲一覧を読み込めませんでした: ${String(e)}` }));
  }, [reload]);

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setMessage(null);
    const done: string[] = [];
    try {
      for (const f of Array.from(files)) {
        const song = await importTkt(f);
        done.push(song.title);
      }
      setMessage({ kind: 'ok', text: `取り込みました: ${done.join('、')}` });
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
      await reload();
    }
  };

  const remove = async (s: SongSummary) => {
    if (!window.confirm(`「${s.title}」をこの端末から削除しますか？\n（Google ドライブの .tkt は消えません）`)) return;
    await deleteSong(s.id);
    await reload();
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>tokaraoke-training</h1>
        <a className="badge link" href="#/mic">
          🎤 マイクテスト
        </a>
      </header>

      <main className="library">
        {songs && songs.length === 0 && (
          <div className="empty">
            <p className="empty-title">まだ曲がありません</p>
            <ol>
              <li>PC の解析ツールで曲を解析して .tkt を作る</li>
              <li>下の「.tkt を取り込む」を押す</li>
              <li>
                iPhone では「ブラウズ」› Google ドライブ › <b>tokaraoke</b> フォルダの .tkt を選ぶ
              </li>
            </ol>
          </div>
        )}
        <ul className="song-list">
          {songs?.map((s) => (
            <li key={s.id}>
              <a className="song" href={`#/song/${s.id}`}>
                <span className="song-title">{s.title}</span>
                <span className="song-sub">
                  {s.artist && <span>{s.artist}</span>}
                  <span>{fmtTime(s.duration)}</span>
                </span>
              </a>
              <span className="song-best" title="ベストスコア">
                {s.bestScore != null ? (
                  <>
                    <b>{Math.round(s.bestScore)}</b>点
                  </>
                ) : (
                  '—'
                )}
              </span>
              <button className="icon" aria-label={`${s.title} を削除`} onClick={() => remove(s)}>
                🗑
              </button>
            </li>
          ))}
        </ul>
      </main>

      {message && <p className={message.kind === 'error' ? 'error' : 'ok'}>{message.text}</p>}

      <footer className="controls">
        <button className="primary" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? '取り込み中…' : '＋ .tkt を取り込む'}
        </button>
        {/* iOS では独自拡張子を accept に書くと選べなくなるため指定しない */}
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => onFiles(e.target.files)} />
      </footer>
    </div>
  );
}
