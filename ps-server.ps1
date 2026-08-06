# PvZ Text Edition - Simple HTTP Server
# ALL ENGLISH - NO ENCODING ISSUES!

param([ValidateRange(1, 65535)][int]$Port = 8000)

$ErrorActionPreference = "Stop"
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptPath
$rootPath = [System.IO.Path]::GetFullPath($scriptPath).TrimEnd('\') + '\'
$publicRootFiles = @('index.html', 'style.css', 'game-init.js', 'net.js')
$publicDirectories = @('assets', 'source-code')

# MIME types
$mime = @{}
$mime['.html'] = 'text/html'
$mime['.js']   = 'text/javascript'
$mime['.css']  = 'text/css'
$mime['.json'] = 'application/json'
$mime['.png']  = 'image/png'
$mime['.jpg']  = 'image/jpeg'
$mime['.ico']  = 'image/x-icon'
$mime['.txt']  = 'text/plain'

# Start HTTP listener (prefer all interfaces for LAN play; fallback to localhost)
$lanIP = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.InterfaceAlias -notmatch 'Loopback' -and $_.IPAddress -notmatch '^169\.254\.' } |
    Select-Object -First 1).IPAddress
# Fallback: DNS lookup if Get-NetIPAddress unavailable/failed
if (-not $lanIP) {
    $lanIP = ([System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
        Where-Object { $_.AddressFamily -eq 'InterNetwork' -and $_.IPAddressToString -notmatch '^169\.254\.' } |
        Select-Object -First 1).IPAddressToString
}

$listener = New-Object System.Net.HttpListener
$lanOk = $false
try {
    $listener.Prefixes.Add("http://+:$Port/")
    $listener.Start()
    $lanOk = $true
} catch {
    # Binding to '+' needs a URL ACL; register once (admin), then retry
    try {
        netsh http add urlacl url="http://+:$Port/" user="$env:USERNAME" | Out-Null
        $listener = New-Object System.Net.HttpListener
        $listener.Prefixes.Add("http://+:$Port/")
        $listener.Start()
        $lanOk = $true
    } catch {
        $listener = New-Object System.Net.HttpListener
        $listener.Prefixes.Add("http://localhost:$Port/")
        $listener.Start()
    }
}

# Best-effort: open the selected inbound TCP port so LAN friends can reach the page
if ($lanOk) {
    try {
        $firewallName = "PvZ Text $Port"
        if (-not (Get-NetFirewallRule -DisplayName $firewallName -ErrorAction SilentlyContinue)) {
            New-NetFirewallRule -DisplayName $firewallName -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -ErrorAction Stop | Out-Null
            Write-Host "  Firewall rule added: TCP $Port inbound" -ForegroundColor DarkGray
        }
    } catch {
        Write-Host "  Firewall rule NOT added. If friends cannot open the link, run this script as admin once." -ForegroundColor DarkYellow
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  SERVER RUNNING" -ForegroundColor Green
Write-Host "  Play at: http://localhost:$Port" -ForegroundColor Cyan
if ($lanOk -and $lanIP) {
    Write-Host "  LAN play: http://${lanIP}:$Port" -ForegroundColor Yellow
} else {
    Write-Host "  LAN play unavailable (run as admin to allow)" -ForegroundColor DarkYellow
}
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# Serve requests
while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response

    $path = $request.Url.LocalPath
    
    # Silently handle favicon - NO 404!
    if ($path -eq '/favicon.ico') {
        $response.StatusCode = 204
        $response.OutputStream.Close()
        $response.Close()
        continue
    }

    # LAN IP endpoint for invite links
    if ($path -eq '/__localip') {
        $ipBytes = [System.Text.Encoding]::UTF8.GetBytes("$lanIP")
        $response.ContentType = 'text/plain'
        $response.ContentLength64 = $ipBytes.Length
        $response.OutputStream.Write($ipBytes, 0, $ipBytes.Length)
        $response.OutputStream.Close()
        $response.Close()
        continue
    }
    
    if ($path -eq '/') { $path = '/index.html' }
    $relativePath = $path.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
    $segments = $relativePath.Split([System.IO.Path]::DirectorySeparatorChar, [System.StringSplitOptions]::RemoveEmptyEntries)
    $isPublic = ($segments.Count -eq 1 -and $publicRootFiles -contains $segments[0]) -or
        ($segments.Count -gt 1 -and $publicDirectories -contains $segments[0])
    $fullPath = [System.IO.Path]::GetFullPath((Join-Path $scriptPath $relativePath))
    $isInsideRoot = $fullPath.StartsWith($rootPath, [System.StringComparison]::OrdinalIgnoreCase)

    if ($isPublic -and $isInsideRoot -and (Test-Path $fullPath -PathType Leaf)) {
        $ext = [System.IO.Path]::GetExtension($fullPath).ToLower()
        
        if ($mime[$ext]) {
            $response.ContentType = $mime[$ext]
        } else {
            $response.ContentType = 'application/octet-stream'
        }
        
        $bytes = [System.IO.File]::ReadAllBytes($fullPath)
        $response.ContentLength64 = $bytes.Length
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
        Write-Host "  200  $path" -ForegroundColor Gray
    } else {
        $response.StatusCode = 404
        $errText = "404 Not Found: " + $path
        $errBytes = [System.Text.Encoding]::UTF8.GetBytes($errText)
        $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
        Write-Host "  404  $path" -ForegroundColor Red
    }

    $response.OutputStream.Close()
    $response.Close()
}
