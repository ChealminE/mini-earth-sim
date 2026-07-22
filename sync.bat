@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ===============================
echo   GitHub 동기화 시작
echo ===============================
echo.

git add -A

git diff --cached --quiet
if %errorlevel%==0 (
    echo 변경된 내용이 없습니다. 동기화할 것이 없어요.
    pause
    exit /b
)

set /p msg="커밋 메시지 입력 (엔터만 누르면 자동 메시지): "
if "%msg%"=="" set msg=자동 동기화 %date% %time%

git commit -m "%msg%"
git push

echo.
echo ===============================
echo   동기화 완료!
echo ===============================
pause
