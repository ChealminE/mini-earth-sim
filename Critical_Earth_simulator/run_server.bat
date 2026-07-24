@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo [안내] 가상환경이 없습니다. setup.bat 을 먼저 실행해주세요.
    pause
    exit /b 1
)

echo ===============================
echo   미니 지구 모델 서버 시작
echo   (창을 닫으면 서버가 종료됩니다. 끄려면 Ctrl+C)
echo ===============================
echo.

".venv\Scripts\python.exe" server.py

echo.
echo 서버가 종료되었습니다.
pause
