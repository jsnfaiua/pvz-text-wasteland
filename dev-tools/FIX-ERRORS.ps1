# ========================================
# AUTO-FIX ALL IMPORT ERRORS
# ========================================

$ErrorActionPreference = "Stop"
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptPath
Set-Location $repoRoot

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  AUTO-FIXING IMPORT ERRORS" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# ========================================
# FIX 1: screens.js importing saveData from wrong place
# ========================================
Write-Host "[1/2] Fixing source-code/ui/screens.js..." -ForegroundColor Yellow
$screensPath = Join-Path $repoRoot "source-code\ui\screens.js"
$screensContent = Get-Content $screensPath -Raw -Encoding UTF8

# Find and replace bad saveData import
if ($screensContent -match "from.*main.*saveData") {
    Write-Host "  Found bad main.js import in screens.js" -ForegroundColor Red
    $screensContent = $screensContent -replace "import.*saveData.*from.*main\.js.*", "// saveData is passed as parameter from game-init.js"
    Set-Content $screensPath -Value $screensContent -Encoding UTF8 -NoNewline
    Write-Host "  FIXED!" -ForegroundColor Green
} else {
    Write-Host "  screens.js looks OK!" -ForegroundColor Green
}

# ========================================
# FIX 2: hud.js - check for similar issues
# ========================================
Write-Host "[2/2] Checking source-code/ui/hud.js..." -ForegroundColor Yellow
$hudPath = Join-Path $repoRoot "source-code\ui\hud.js"
$hudContent = Get-Content $hudPath -Raw -Encoding UTF8

if ($hudContent -match "from.*main") {
    Write-Host "  Found bad main.js import in hud.js" -ForegroundColor Red
    $hudContent = $hudContent -replace "import.*saveData.*from.*main\.js.*", "// saveData managed in game-init.js"
    Set-Content $hudPath -Value $hudContent -Encoding UTF8 -NoNewline
    Write-Host "  FIXED!" -ForegroundColor Green
} else {
    Write-Host "  hud.js looks OK!" -ForegroundColor Green
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  ALL FIXES APPLIED!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Now:" -ForegroundColor Cyan
Write-Host "  1. Press Ctrl+C to stop old server"
Write-Host "  2. Run RUN.bat again"
Write-Host "  3. Refresh browser (F5)"
Write-Host ""
Start-Sleep -Seconds 3
