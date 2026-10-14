@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ===============================
echo   MiniEarth.html 빌드 시작
echo ===============================
echo.

set PY=python
if exist ".venv\Scripts\python.exe" set PY=.venv\Scripts\python.exe

rem 단일 HTML은 CDN 대신 vendor\ 에 받아 둔 라이브러리를 파일 안에 박아 넣는다.
rem (그래야 인터넷 없이도 열린다. 한 번만 받으면 다음 빌드부터는 건너뛴다.)
if not exist "vendor\three.min.js" (
    echo three.js 내려받는 중...
    if not exist "vendor" mkdir "vendor"
    curl -sS -L -o "vendor\three.min.js" https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js
)
if not exist "vendor\chart.umd.min.js" (
    echo Chart.js 내려받는 중...
    curl -sS -L -o "vendor\chart.umd.min.js" https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js
)

"%PY%" tools\build_single_html.py
if errorlevel 1 (
    echo.
    echo [실패] 빌드가 중단되었습니다.
    pause
    exit /b 1
)

echo.
echo ===============================
echo   빌드 완료: dist\MiniEarth.html
echo   이 파일 하나만 보내면 됩니다 (더블클릭하면 브라우저에서 열림).
echo   실시간 센서 측정만 server.py 가 필요합니다.
echo ===============================
pause
