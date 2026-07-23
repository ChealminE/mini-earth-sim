@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ===============================
echo   미니 지구 모델 - 최초 설치
echo ===============================
echo.

where python >nul 2>nul
if errorlevel 1 (
    echo [오류] python이 설치되어 있지 않거나 PATH에 없습니다.
    echo        https://www.python.org 에서 설치 후 다시 실행해주세요.
    pause
    exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
    echo 가상환경(.venv) 생성 중...
    python -m venv .venv
) else (
    echo 가상환경(.venv) 이미 있음, 건너뜀.
)

echo.
echo 필요한 패키지 설치 중... (fastapi, uvicorn, bleak 등)
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install -r requirements.txt

echo.
echo ===============================
echo   설치 완료!
echo   앞으로는 run_server.bat 을 더블클릭해서 실행하세요.
echo ===============================
pause
