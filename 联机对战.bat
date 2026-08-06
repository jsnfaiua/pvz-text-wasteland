@echo off
chcp 65001 >nul
cd /d "%~dp0"
cls
echo.
echo ======================================
echo   文字植物大战僵尸 - 一键联机双开
echo ======================================
echo.
echo [1/5] 选择可用端口...
set "PVZ_PORT="
for /f %%P in ('powershell.exe -NoProfile -Command "$candidate = $null; foreach ($number in 8000..8010) { if (-not (Get-NetTCPConnection -LocalPort $number -State Listen -ErrorAction SilentlyContinue)) { $candidate = $number; break } }; if ($null -ne $candidate) { Write-Output $candidate }"') do set "PVZ_PORT=%%P"
if not defined PVZ_PORT (
    echo 错误：8000-8010 端口全部被占用，请关闭旧服务器后重试。
    pause
    exit /b 1
)

echo [2/5] 检查 Node.js（联机服务器必需）...
where node >nul 2>nul
if errorlevel 1 (
    echo 错误：未检测到 Node.js。联机需要 node server.js 提供房间中继（PeerServer）。
    echo 请先安装 Node.js：https://nodejs.org/
    pause
    exit /b 1
)

echo [3/5] 启动游戏服务器（含联机房间中继）...
start "PvZ MP Server" cmd /k "set PORT=%PVZ_PORT%&& node server.js"
timeout /t 2 /nobreak >nul

echo [4/5] 查找浏览器（Chrome 优先，Edge 兜底）...
set "PVZ_BROWSER="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "PVZ_BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined PVZ_BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "PVZ_BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined PVZ_BROWSER if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "PVZ_BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined PVZ_BROWSER if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "PVZ_BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined PVZ_BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "PVZ_BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined PVZ_BROWSER (
    echo 警告：未找到 Chrome/Edge，改用系统默认浏览器打开两个标签页。
    echo 注意：同浏览器标签页共享登录状态，建议手动注册两个不同账号。
    start "" "http://localhost:%PVZ_PORT%"
    start "" "http://localhost:%PVZ_PORT%"
    goto :done
)

echo [5/5] 双开两个独立浏览器实例（各自独立账号/存档）...
rem 独立 --user-data-dir 使两个实例互不影响：可分别登录不同账号，联机测试开箱即用
start "PvZ Player 1" "%PVZ_BROWSER%" --user-data-dir="%TEMP%\pvz-mp-player1" --no-first-run --no-default-browser-check "http://localhost:%PVZ_PORT%"
start "PvZ Player 2" "%PVZ_BROWSER%" --user-data-dir="%TEMP%\pvz-mp-player2" --no-first-run --no-default-browser-check "http://localhost:%PVZ_PORT%"

:done
echo.
echo ======================================
echo   游戏地址: http://localhost:%PVZ_PORT%
echo   联机玩法:
echo     1) 两个窗口分别注册/登录不同账号
echo     2) 玩家 A：多人联机 → 创建房间 → 复制房间码
echo     3) 玩家 B：多人联机 → 加入房间 → 输入房间码
echo     4) 玩家 B 点「准备就绪」→ 玩家 A 选关开始
echo   断线会自动重连（约 38 秒内），无需重开房间
echo   服务器窗口：PvZ MP Server（关闭即停止）
echo ======================================
echo.
pause
