@echo off
chcp 65001 >nul
cd /d "%~dp0.."
node dev-tools\smoke-test.js > dev-tools\smoke-output.txt 2>&1
