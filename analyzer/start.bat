@echo off
chcp 65001 > nul
cd /d "%~dp0"
where uv > nul 2> nul
if errorlevel 1 (
  echo uv が見つかりません。先に setup.bat を実行してください。
  pause
  exit /b 1
)
echo tokaraoke 解析ツールを起動しています。ブラウザが自動で開きます。
echo 終了するときはこの画面を閉じてください。
uv run --no-dev python -m tokaraoke_analyzer.app
pause
