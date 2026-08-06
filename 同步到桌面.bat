@echo off
REM sync workspace project to Desktop optimized copy
set SRC=C:\Users\24601\Documents\kimi\workspace\文字植物大战僵尸
set DST=C:\Users\24601\Desktop\文字植物大战僵尸-优化版
robocopy "%SRC%" "%DST%" /MIR /NFL /NDL /NJH /NJS /NP
if %ERRORLEVEL% LEQ 7 (echo SYNC_OK) else (echo SYNC_FAIL ERRORLEVEL=%ERRORLEVEL%)
