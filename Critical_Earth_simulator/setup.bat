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
echo 바탕화면에 바로가기 만드는 중...
REM 아래 -EncodedCommand는 한글이 포함된 PowerShell 명령을 cmd에서 안전하게 넘기기 위한 Base64(UTF-16LE) 인코딩임
REM (원본: $s=(New-Object -COM WScript.Shell).CreateShortcut("$env:USERPROFILE\Desktop\미니 지구 모델 실행.lnk");$s.TargetPath=(Join-Path $args[0] "run_server.bat");$s.WorkingDirectory=$args[0];$s.IconLocation="$env:SystemRoot\System32\SHELL32.dll,13";$s.Save()  )
powershell -NoProfile -EncodedCommand JABzAD0AKABOAGUAdwAtAE8AYgBqAGUAYwB0ACAALQBDAE8ATQAgAFcAUwBjAHIAaQBwAHQALgBTAGgAZQBsAGwAKQAuAEMAcgBlAGEAdABlAFMAaABvAHIAdABjAHUAdAAoACIAJABlAG4AdgA6AFUAUwBFAFIAUABSAE8ARgBJAEwARQBcAEQAZQBzAGsAdABvAHAAXAD4u8iyIADAyWytIACounizIADkwonVLgBsAG4AawAiACkAOwAkAHMALgBUAGEAcgBnAGUAdABQAGEAdABoAD0AKABKAG8AaQBuAC0AUABhAHQAaAAgACQAYQByAGcAcwBbADAAXQAgACIAcgB1AG4AXwBzAGUAcgB2AGUAcgAuAGIAYQB0ACIAKQA7ACQAcwAuAFcAbwByAGsAaQBuAGcARABpAHIAZQBjAHQAbwByAHkAPQAkAGEAcgBnAHMAWwAwAF0AOwAkAHMALgBJAGMAbwBuAEwAbwBjAGEAdABpAG8AbgA9ACIAJABlAG4AdgA6AFMAeQBzAHQAZQBtAFIAbwBvAHQAXABTAHkAcwB0AGUAbQAzADIAXABTAEgARQBMAEwAMwAyAC4AZABsAGwALAAxADMAIgA7ACQAcwAuAFMAYQB2AGUAKAApAA== "%~dp0" >nul 2>nul

echo.
echo ===============================
echo   설치 완료!
echo   앞으로는 바탕화면의 "미니 지구 모델 실행" 아이콘을 더블클릭해서 실행하세요.
echo   (바로가기가 안 만들어졌다면 이 폴더의 run_server.bat 을 직접 더블클릭)
echo ===============================
pause
