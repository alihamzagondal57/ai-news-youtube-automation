@echo off
setlocal EnableExtensions
title AI News Pipeline - Launcher
cd /d "%~dp0"
set "ROOT=%~dp0"

echo ================================================================
echo   AI News Pipeline - Starting Everything
echo ================================================================
echo.

if not exist "%ROOT%.env" (
  echo [ERROR] Could not find .env in:
  echo   %ROOT%
  echo This file holds your API keys and must exist before starting.
  echo.
  pause
  exit /b 1
)

REM --- Read GITHUB_TOKEN and GITHUB_REPO out of .env for n8n ---
set "GITHUB_TOKEN="
set "GITHUB_REPO="
for /f "usebackq tokens=1,* delims==" %%A in (`findstr /b /c:"GITHUB_TOKEN=" "%ROOT%.env"`) do set "GITHUB_TOKEN=%%B"
for /f "usebackq tokens=1,* delims==" %%A in (`findstr /b /c:"GITHUB_REPO=" "%ROOT%.env"`) do set "GITHUB_REPO=%%B"

if "%GITHUB_TOKEN%"=="" (
  echo [WARNING] GITHUB_TOKEN not found in .env - pipeline steps that run
  echo           on GitHub Actions will fail until this is fixed.
  echo.
)
if "%GITHUB_REPO%"=="" (
  echo [WARNING] GITHUB_REPO not found in .env - same issue as above.
  echo.
)

REM --- n8n environment (everything discovered/required to make this project's
REM     n8n workflows work, baked in so nobody has to remember these again) ---
set NODES_EXCLUDE=["n8n-nodes-base.localFileTrigger"]
set N8N_BLOCK_ENV_ACCESS_IN_NODE=false
set N8N_DIAGNOSTICS_ENABLED=false
set N8N_VERSION_NOTIFICATIONS_ENABLED=false
set N8N_ONBOARDING_FLOW_DISABLED=true
set N8N_SECURE_COOKIE=false
set N8N_RUNNERS_TASK_TIMEOUT=13000
set "DOTENV_CONFIG_PATH=%ROOT%.env"

REM --- 1) n8n (the pipeline orchestrator) ---
call :PORT_OPEN 5678
if %errorlevel%==0 (
  echo [1/3] n8n is already running - skipping.
) else (
  echo [1/3] Starting n8n...
  start "AI News Pipeline - n8n" cmd /k n8n start
)

echo       Waiting for n8n to finish booting - this can take about 30 seconds...
set /a N8N_TRIES=0
:WAIT_N8N
call :PORT_OPEN 5678
if %errorlevel%==0 goto N8N_READY
set /a N8N_TRIES+=1
if %N8N_TRIES% GEQ 30 goto N8N_READY
ping -n 3 127.0.0.1 >nul
goto WAIT_N8N
:N8N_READY
echo       n8n is up.
echo.

REM --- 2) review-dashboard server (the backend / API) ---
call :PORT_OPEN 4000
if %errorlevel%==0 (
  echo [2/3] Dashboard server is already running - skipping.
) else (
  echo [2/3] Starting dashboard server...
  start "AI News Pipeline - Dashboard Server" /d "%ROOT%apps\review-dashboard\server" cmd /k npm run dev
)
ping -n 4 127.0.0.1 >nul
echo.

REM --- 3) review-dashboard frontend (the web page you actually use) ---
call :PORT_OPEN 5173
if %errorlevel%==0 (
  echo [3/3] Dashboard page is already running - skipping.
) else (
  echo [3/3] Starting dashboard page...
  start "AI News Pipeline - Dashboard Page" /d "%ROOT%apps\review-dashboard\frontend" cmd /k npm run dev
)

echo       Waiting for the dashboard page to finish booting...
set /a UI_TRIES=0
:WAIT_UI
call :PORT_OPEN 5173
if %errorlevel%==0 goto UI_READY
set /a UI_TRIES+=1
if %UI_TRIES% GEQ 20 goto UI_READY
ping -n 3 127.0.0.1 >nul
goto WAIT_UI
:UI_READY

echo.
echo ================================================================
echo   Everything is running. Opening the dashboard in your browser...
echo ================================================================
echo.
echo   Up to three black windows are running (new ones, or ones already
echo   open from before) - LEAVE THEM OPEN while you work. Minimizing
echo   them is fine. Closing any of them stops that part of the pipeline.
echo.
echo   Dashboard:  http://localhost:5173
echo   n8n:        http://localhost:5678
echo.
ping -n 3 127.0.0.1 >nul
start "" "http://localhost:5173/"

echo You can close THIS window now - it is only the launcher, not one
echo of the three services, so closing it does not stop anything.
echo.
pause
exit /b 0

REM --- Sets errorlevel 0 if something is listening on the given port, 1 if not. ---
:PORT_OPEN
powershell -NoProfile -Command "if (Test-NetConnection -ComputerName localhost -Port %1 -WarningAction SilentlyContinue -InformationLevel Quiet) { exit 0 } else { exit 1 }" >nul 2>&1
exit /b %errorlevel%
