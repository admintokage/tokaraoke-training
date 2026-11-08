@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo ============================================
echo  tokaraoke 解析ツール 初回セットアップ
echo  （ライブラリとAIモデル 約2.5GB をダウンロードします）
echo ============================================
echo.

where uv > nul 2> nul
if errorlevel 1 (
  echo [1/3] uv をインストールしています...
  winget install --id astral-sh.uv -e --accept-source-agreements --accept-package-agreements
  if errorlevel 1 goto :error
  set "PATH=%LOCALAPPDATA%\Microsoft\WinGet\Links;%USERPROFILE%\.local\bin;%PATH%"
) else (
  echo [1/3] uv はインストール済みです
)

echo [2/3] Python とライブラリをインストールしています（数分かかります）...
uv sync --no-dev
if errorlevel 1 goto :error

echo [3/3] AI モデルをダウンロードしています...
uv run --no-dev python -m tokaraoke_analyzer.prefetch
if errorlevel 1 goto :error

echo.
echo セットアップが完了しました。以降は start.bat をダブルクリックして使えます。
pause
exit /b 0

:error
echo.
echo セットアップに失敗しました。上のメッセージを確認してください。
pause
exit /b 1
