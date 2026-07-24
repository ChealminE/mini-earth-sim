@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo [안내] 가상환경이 없습니다. setup.bat 을 먼저 실행해주세요.
    pause
    exit /b 1
)

echo ===============================
echo   MiniEarthModel.exe 빌드 시작
echo ===============================
echo.

".venv\Scripts\python.exe" -m pip show pyinstaller >nul 2>nul
if errorlevel 1 (
    echo pyinstaller 설치 중...
    ".venv\Scripts\python.exe" -m pip install pyinstaller
)

".venv\Scripts\python.exe" -m PyInstaller server.spec --noconfirm

echo.
echo ===============================
echo   빌드 완료: dist\MiniEarthModel.exe
echo   이 파일 하나를 학생에게 배포하면 됩니다 (GitHub Releases 업로드 권장).
echo ===============================
pause
