@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Maniu Windows package (unsigned)
set "ROOT=%~dp0..\.."
set "DESKTOP=%ROOT%\packages\lcoder\desktop"
set "ARTIFACTS=%DESKTOP%\.desktop-build\artifacts"
set "START=%TIME%"
set "NOPAUSE="
set "SKIPBUILD="
set "USEPROXY="

:parse
if "%~1"=="" goto parsed
if /I "%~1"=="-NoPause" set "NOPAUSE=1"
if /I "%~1"=="-SkipBuild" set "SKIPBUILD=1"
if /I "%~1"=="-Proxy" set "USEPROXY=1"
shift
goto parse
:parsed

if defined USEPROXY (
  set "HTTP_PROXY=http://127.0.0.1:7890"
  set "HTTPS_PROXY=http://127.0.0.1:7890"
  echo [proxy] HTTP_PROXY/HTTPS_PROXY = http://127.0.0.1:7890
)

echo ============================================================
echo  Maniu Windows package (unsigned, no auto update)
echo  Root   : %ROOT%
echo  Started: %START%
echo  Stages : build desktop -^> build client -^> electron-builder -^> weigh
echo  Args   : -SkipBuild  skip both builds
echo           -Proxy      use http://127.0.0.1:7890 for downloads
echo           -NoPause    do not pause at the end
echo ============================================================

where node >nul 2>nul || goto missing_node
where pnpm >nul 2>nul || goto missing_pnpm
set "pnpm_config_verify_deps_before_run=false"

cd /d "%ROOT%" || goto fail_root
echo.
echo [1/4] Build desktop shell (%TIME%)
if not defined SKIPBUILD (
  call pnpm --filter @lcoder/desktop run build
  if errorlevel 1 goto fail_build_desktop
  echo [2/4] Build new client (%TIME%)
  call pnpm --filter @lcoder/client run build
  if errorlevel 1 goto fail_build_client
) else (
  echo       skipped by -SkipBuild
)

echo.
echo [3/4] Package with electron-builder (%TIME%)
call node "%DESKTOP%\scripts\package-win.mjs"
if errorlevel 1 goto fail_package

echo.
echo [4/4] Artifacts (%TIME%)
if exist "%ARTIFACTS%" (
  dir /b "%ARTIFACTS%"
  for %%F in ("%ARTIFACTS%\maniu-*-win-x64-unsigned.exe") do echo   installer: %%~nxF  %%~zF bytes
  for %%F in ("%ARTIFACTS%\win-unpacked\Maniu.exe") do echo   unpacked : %%~nxF  %%~zF bytes
) else (
  echo   [warn] artifacts directory not found: %ARTIFACTS%
)
if exist "%ROOT%\lcoder\logs\t197-package-weight.json" (
  echo   weight   : %ROOT%\lcoder\logs\t197-package-weight.json
)
echo.
echo DONE at %TIME% (started %START%)
if not defined NOPAUSE pause
exit /b 0

:missing_node
echo [FAILED] node not found in PATH
goto end_fail
:missing_pnpm
echo [FAILED] pnpm not found in PATH
goto end_fail
:fail_root
echo [FAILED] cannot cd to %ROOT%
goto end_fail
:fail_build_desktop
echo [FAILED] desktop build failed at %TIME%
goto end_fail
:fail_build_client
echo [FAILED] client build failed at %TIME%
goto end_fail
:fail_package
echo [FAILED] package-win.mjs failed at %TIME%
echo          Tip: rerun with -Proxy if a download stalled.
goto end_fail
:end_fail
if not defined NOPAUSE pause
exit /b 1
