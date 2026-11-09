"""PC 解析ツールの操作画面 (Gradio)。start.bat から起動する"""

from __future__ import annotations

import os
import traceback
from pathlib import Path

import gradio as gr

from . import __version__, pipeline, settings


def read_tags(path: str | None):
    """曲ファイルのタグから曲名・アーティストを取り出す (なければファイル名)"""
    if not path:
        return gr.update(), gr.update()
    title, artist = Path(path).stem, ""
    try:
        import mutagen

        f = mutagen.File(path, easy=True)
        if f and f.tags:
            title = (f.tags.get("title") or [title])[0]
            artist = (f.tags.get("artist") or [""])[0]
    except Exception:
        pass
    return title, artist


def analyze(audio_path, title, artist, lyrics_text, out_dir, progress=gr.Progress(track_tqdm=True)):
    if not audio_path:
        raise gr.Error("曲ファイルを選んでください")
    out_dir = (out_dir or "").strip() or settings.default_out_dir()
    settings.save(out_dir=out_dir)

    try:
        res = pipeline.run(
            audio_path,
            lyrics_text or "",
            title or "",
            artist or "",
            out_dir,
            progress=lambda frac, msg: progress(frac, desc=msg),
        )
    except Exception as e:
        traceback.print_exc()
        raise gr.Error(f"解析に失敗しました: {e}") from e

    total = sum(res.timings.values())
    mins, secs = divmod(int(total), 60)
    summary = (
        f"### ✅ 完了しました\n"
        f"- 保存先: `{res.path}`\n"
        f"- 曲の長さ: {int(res.duration // 60)}分{int(res.duration % 60):02d}秒 ／ "
        f"音程ノート: {res.note_count}個 ／ 歌詞: {res.line_count}行\n"
        f"- 処理時間: {mins}分{secs:02d}秒（"
        + "、".join(f"{k} {v:.0f}秒" for k, v in res.timings.items())
        + "）\n\n"
        "iPhone では、練習アプリの「＋ .tkt を取り込む」からこのファイルを選んでください。"
        "同じ曲名のファイルを取り込むと、前の分を置き換えます（ベストスコアは残ります）。"
    )
    rows = [
        [_fmt(l["start"]), _fmt(l["end"]), ("⚠ " if l.get("aligned") is False else "") + l["text"]]
        for l in res.lyrics
    ]
    if any(l.get("aligned") is False for l in res.lyrics):
        summary += "\n\n⚠ の付いた行はうまく合わせられなかったため、おおよその位置に並べています。"
    long_lines = [i + 1 for i, l in enumerate(res.lyrics) if l["end"] - l["start"] > LONG_LINE_SEC]
    if long_lines:
        rows = [
            [r[0], r[1], ("⏱ " if i + 1 in long_lines else "") + r[2]] for i, r in enumerate(rows)
        ]
        summary += (
            f"\n\n⏱ {', '.join(map(str, long_lines))} 行目が {LONG_LINE_SEC} 秒以上続いています。"
            "**歌詞が足りない可能性があります**（くり返しのサビを省略していないか確認してください）。"
            "歌われる順にすべての行を貼り付けて、もう一度解析してください。"
        )
    return summary, str(res.path), rows


LONG_LINE_SEC = 15  # 1 行がこれより長いと歌詞の抜けを疑う


def _fmt(sec: float) -> str:
    return f"{int(sec // 60)}:{sec % 60:05.2f}"


def open_folder(out_dir: str):
    path = Path((out_dir or "").strip() or settings.default_out_dir())
    path.mkdir(parents=True, exist_ok=True)
    os.startfile(path)  # type: ignore[attr-defined]


def build() -> gr.Blocks:
    with gr.Blocks(title="tokaraoke 解析ツール") as demo:
        gr.Markdown(
            f"# 🎤 tokaraoke 解析ツール <small>v{__version__}</small>\n"
            "曲ファイルと歌詞から、練習アプリ用のファイル（.tkt）を作ります。"
            "1曲あたり5〜15分ほどかかります。"
        )
        with gr.Row():
            with gr.Column():
                audio = gr.File(label="① 曲ファイル（mp3 / m4a / wav / flac）", file_types=["audio"], type="filepath")
                with gr.Row():
                    title = gr.Textbox(label="曲名")
                    artist = gr.Textbox(label="アーティスト")
                lyrics = gr.Textbox(
                    label="② 歌詞（1行ずつ、歌われる順にすべて。くり返しのサビも省略しない。空行は無視。なくても解析できます）",
                    lines=14,
                    placeholder="ここに歌詞を貼り付け",
                )
                with gr.Row():
                    out_dir = gr.Textbox(label="③ 保存先フォルダ", value=settings.out_dir(), scale=4)
                    open_btn = gr.Button("📂 開く", scale=1)
                run_btn = gr.Button("解析して .tkt を作る", variant="primary", size="lg")
            with gr.Column():
                summary = gr.Markdown()
                result_file = gr.File(label="できたファイル")
                lyric_table = gr.Dataframe(
                    headers=["開始", "終了", "歌詞"],
                    label="歌詞のタイミング（確認用）",
                    interactive=False,
                    wrap=True,
                )

        audio.change(read_tags, inputs=audio, outputs=[title, artist])
        open_btn.click(open_folder, inputs=out_dir)
        run_btn.click(
            analyze,
            inputs=[audio, title, artist, lyrics, out_dir],
            outputs=[summary, result_file, lyric_table],
        )
    return demo


def main() -> None:
    build().queue().launch(server_name="127.0.0.1", inbrowser=True)


if __name__ == "__main__":
    main()
