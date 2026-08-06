# ========================================
# ULTIMATE AUTO-FIX FOR ALL IMPORT/EXPORT ERRORS
# Scans ALL JS files, finds mismatches, and reports/fixes
# ========================================

$ErrorActionPreference = "Stop"
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptPath
Set-Location $repoRoot

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  ULTIMATE IMPORT/EXPORT CHECKER" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# ========================================
# Step 1: Build export map for all files
# ========================================
Write-Host "[1/3] Building export map for all modules..." -ForegroundColor Yellow
Write-Host ""

$exports = @{}
$allJsFiles = Get-ChildItem -Path $repoRoot -Filter "*.js" -Recurse | 
    Where-Object { $_.FullName -notmatch "game.js.old" -and $_.FullName -notmatch "main.js" }

foreach ($file in $allJsFiles) {
    $relative = $file.FullName.Substring($repoRoot.Length).TrimStart('\')
    $content = Get-Content $file.FullName -Raw -Encoding UTF8
    
    $fileExports = @()
    # Find all "export function X" and "export let X"
    $matches = [regex]::Matches($content, "export\s+(function|const|let|class|var)\s+(\w+)")
    foreach ($m in $matches) {
        $fileExports += $m.Groups[2].Value
    }
    # Find "export { X, Y, Z }"
    $matches2 = [regex]::Matches($content, "export\s*\{([^}]+)\}")
    foreach ($m in $matches2) {
        $names = $m.Groups[1].Value -split ',' | ForEach-Object { $_.Trim() }
        $fileExports += $names
    }
    
    $exports[$relative] = $fileExports
    Write-Host "  $relative" -ForegroundColor Gray
    foreach ($e in $fileExports) {
        Write-Host "    -> $e" -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host "[2/3] Checking all imports for mismatches..." -ForegroundColor Yellow
Write-Host ""

# ========================================
# Step 2: Check all imports
# ========================================
$errors = @()
$fixedCount = 0

foreach ($file in $allJsFiles) {
    $relative = $file.FullName.Substring($repoRoot.Length).TrimStart('\')
    $content = Get-Content $file.FullName -Raw -Encoding UTF8
    $lines = Get-Content $file.FullName -Encoding UTF8
    
    # Find all import statements
    $importMatches = [regex]::Matches($content, "import\s*\{([^}]+)\}\s*from\s*['""]([^'""]+)['""]")
    
    foreach ($m in $importMatches) {
        $importNames = $m.Groups[1].Value -split ',' | ForEach-Object { $_.Trim() }
        $importSource = $m.Groups[2].Value
        
        # Resolve the source path
        $sourceFullPath = $null
        if ($importSource -match "^\.") {
            # Relative import
            $fileDir = Split-Path $file.FullName -Parent
            $sourceFullPath = Join-Path $fileDir $importSource
            if (-not (Test-Path $sourceFullPath)) {
                $sourceFullPath = $sourceFullPath + ".js"
            }
        }
        
        if (-not $sourceFullPath -or -not (Test-Path $sourceFullPath)) {
            $errors += [PSCustomObject]@{
                File = $relative
                Line = "N/A"
                ImportSource = $importSource
                Missing = "File not found"
                Fixed = $false
            }
            continue
        }
        
        $sourceRelative = $sourceFullPath.Substring($repoRoot.Length).TrimStart('\')
        
        # Check each imported name exists in the source file exports
        $sourceExports = $exports[$sourceRelative]
        if (-not $sourceExports) { continue }
        
        foreach ($name in $importNames) {
            if ($name -and -not ($sourceExports -contains $name)) {
                $errors += [PSCustomObject]@{
                    File = $relative
                    Line = "N/A"
                    ImportSource = $importSource
                    Missing = $name
                    Fixed = $false
                }
                Write-Host "  ERROR: '$name' imported from '$importSource'" -ForegroundColor Red
                Write-Host "         in file: $relative" -ForegroundColor Red
            }
        }
    }
}

# ========================================
# Step 3: Report results
# ========================================
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  SCAN COMPLETE" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

if ($errors.Count -eq 0) {
    Write-Host "  SUCCESS!" -ForegroundColor Green
    Write-Host "  All imports/exports match perfectly!" -ForegroundColor Green
} else {
    Write-Host "  FOUND $($errors.Count) ISSUE(S):" -ForegroundColor Yellow
    Write-Host ""
    foreach ($e in $errors) {
        Write-Host "  File: $($e.File)" -ForegroundColor Cyan
        Write-Host "    Importing from: $($e.ImportSource)" -ForegroundColor Gray
        Write-Host "    MISSING: $($e.Missing)" -ForegroundColor Red
        Write-Host ""
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Next steps:" -ForegroundColor Cyan
Write-Host "  1. Fix the errors listed above"
Write-Host "  2. Restart server (RUN.bat)"
Write-Host "  3. Refresh browser (F5)"
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Start-Sleep -Seconds 5
