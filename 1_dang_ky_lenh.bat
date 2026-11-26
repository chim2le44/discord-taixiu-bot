@echo off
chcp 65001 >nul
set "PATH=%LOCALAPPDATA%\Programs\nodejs;%ProgramFiles%\nodejs;%PATH%"
cd /d "%~dp0"
echo === Dang ky lenh / (/hd, /admin-kenh, /admin-xu) len Discord ===
call npm run deploy-commands
echo.
echo Xong! Neu thay dong "Registered ... commands", hay tat cua so nay va mo 2_chay_bot.bat.
pause
