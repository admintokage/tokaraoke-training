# tokaraoke-training

手持ちの曲からお手本ボーカルの音程を解析し、自分の歌声と比べて練習する個人用 Web アプリ。
要件は [docs/requirements.md](docs/requirements.md) を参照。

## 構成

| フォルダ | 内容 |
|---|---|
| `app/` | 練習アプリ（React + Vite, PWA）。GitHub Pages で配信 |
| `analyzer/` | PC 解析ツール（Python, Gradio） |
| `docs/` | 要件定義など |

## 練習アプリの開発

```bash
cd app
npm install
npm run dev        # PC で http://localhost:5173
npm run dev:lan    # 同じ Wi-Fi の iPhone から https://<PCのIP>:5173 で開く（証明書の警告は「詳細を表示 › このWebサイトを閲覧」で進む）
npm test           # 単体テスト
npm run build      # 本番ビルド（app/dist）
```

## PC 解析ツール

1. 初回だけ `analyzer\setup.bat` をダブルクリック（ライブラリと AI モデル 約2.5GB をダウンロード）
2. `analyzer\start.bat` をダブルクリック → ブラウザで解析画面が開く
3. 曲ファイルと歌詞を入れて「解析して .tkt を作る」→ 保存先（既定: `G:\マイドライブ\tokaraoke`）に `.tkt` ができる

開発用: `cd analyzer` → `uv run pytest`（単体テスト）／ `uv run python -m tokaraoke_analyzer.cli 曲.mp3 --lyrics 歌詞.txt`

## デプロイ

`main` ブランチに push すると GitHub Actions が GitHub Pages へ自動デプロイする
（リポジトリの Settings › Pages › Source を「GitHub Actions」にしておくこと）。
