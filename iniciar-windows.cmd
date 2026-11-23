@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Instale o Node.js LTS em https://nodejs.org/ e abra este arquivo de novo.
  start "" "https://nodejs.org/"
  pause
  exit /b 1
)
node iniciar.mjs
if errorlevel 1 pause
