# ========================================
# CHECK ALL MODULE IMPORTS
# ========================================

$ErrorActionPreference = "Stop"
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptPath
Set-Location $repoRoot

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  CHECKING ALL MODULE IMPORTS" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

$allGood = $true
$modules = @(
    "source-code\core\constants.js",
    "source-code\core\state.js",
    "source-code\core\render.js",
    "source-code\core\utils.js",
    "source-code\entities\player.js",
    "source-code\systems\combat.js",
    "source-code\systems\spawner.js",
    "source-code\systems\audio.js",
    "source-code\persistence\storage.js",
    "source-code\ui\hud.js",
    "source-code\ui\screens.js",
    "source-code\ui\levelSelect.js",
    "source-code\ui\shop.js",
    "source-code\ui\almanacUI.js",
    "source-code\ui\settings.js",
    "source-code\multiplayer\multiplayerUI.js",
    "source-code\multiplayer\mpGame.js",
    "game-init.js"
)

foreach ($mod in $modules) {
    Write-Host "  Checking: $mod" -ForegroundColor Cyan
    
    if (-not (Test-Path $mod)) {
        Write-Host "    MISSING!" -ForegroundColor Red
        $allGood = $false
        continue
    }
    
    $content = Get-Content $mod -Raw -Encoding UTF8
    
    # Check for bad imports
    if ($content -match "from.*main\.js") {
        Write-Host "    ERROR: Still importing from main.js!" -ForegroundColor Red
        $allGood = $false
    }
    
    # Check for duplicate declarations in the same module (state.js owns one of each).
    foreach ($name in @("saveData", "inputFocused")) {
        $count = [regex]::Matches($content, "\b(?:let|const|var)\s+$name\b").Count
        if ($count -gt 1) {
            Write-Host "    ERROR: '$name' is declared $count times!" -ForegroundColor Red
            $allGood = $false
        }
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
if ($allGood) {
    Write-Host "  ALL MODULES OK!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  No 'main.js' imports found!" -ForegroundColor Green
    Write-Host "  No duplicate declarations found!" -ForegroundColor Green
} else {
    Write-Host "  THERE ARE ERRORS TO FIX!" -ForegroundColor Red
}
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Now press Ctrl+C to stop old server, run RUN.bat, refresh browser!" -ForegroundColor Cyan
Write-Host ""
Start-Sleep -Seconds 2
