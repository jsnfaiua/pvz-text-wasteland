@echo off
cd /d "%~dp0"
cls
echo.
echo ======================================
echo   Plants vs Zombies - Text Edition
echo ======================================
echo.
echo [1/5] Selecting an available port...
set "PVZ_PORT="
for /f %%P in ('powershell.exe -NoProfile -Command "$candidate = $null; foreach ($number in 8000..8010) { if (-not (Get-NetTCPConnection -LocalPort $number -State Listen -ErrorAction SilentlyContinue)) { $candidate = $number; break } }; if ($null -ne $candidate) { Write-Output $candidate }"') do set "PVZ_PORT=%%P"
if not defined PVZ_PORT (
    echo ERROR: No available port found from 8000 through 8010.
    pause
    exit /b 1
)
echo [2/5] Allowing firewall (best-effort)...
netsh advfirewall firewall show rule name="PvZ Text %PVZ_PORT%" >nul 2>nul || netsh advfirewall firewall add rule name="PvZ Text %PVZ_PORT%" protocol=TCP dir=in localport=%PVZ_PORT% action=allow >nul 2>nul
echo [3/5] Starting server...
where node >nul 2>nul
if %errorlevel%==0 (
    start "PvZ Server" cmd /k "set PORT=%PVZ_PORT%&& node server.js"
) else (
    start "PvZ Server" powershell.exe -ExecutionPolicy Bypass -NoProfile -File ps-server.ps1 -Port %PVZ_PORT%
)
echo [4/5] Opening browser...
rem Wait for the server to bind the port before opening the browser
timeout /t 2 /nobreak >nul
start "" "http://localhost:%PVZ_PORT%"
echo [5/5] Ready!
echo.
echo ======================================
echo   Game URL: http://localhost:%PVZ_PORT%
echo   Server window: PvZ Server (Ctrl+C to stop)
echo ======================================
echo.
pause
