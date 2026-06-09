@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-and-run.ps1" %*
set EXITCODE=%ERRORLEVEL%

if %EXITCODE% neq 0 (
    echo.
    pause
    exit /b %EXITCODE%
)

if /i "%~1"=="-Background" goto :done
if /i "%~1"=="/Background" goto :done
if /i "%~2"=="-Background" goto :done

exit /b 0

:done
exit /b 0
