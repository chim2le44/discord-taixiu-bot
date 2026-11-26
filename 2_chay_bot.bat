@echo off
chcp 65001 >nul
set "PATH=%LOCALAPPDATA%\Programs\nodejs;%ProgramFiles%\nodejs;%PATH%"
cd /d "%~dp0"
echo === Dang khoi dong Bot Tai Xiu (giu cua so nay mo khi choi) ===
call npm run dev
pause
