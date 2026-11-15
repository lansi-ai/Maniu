@echo off
rem LCoder one-shot smoke. English-only wrapper; notes live in lcoder/scripts/smoke.mjs.
rem Exercises the LEGACY desktop shell (pnpm run start:desktop). The new client's acceptance
rem probes are t187-s1 / t189-m2 / t190-m3 / t195-approval; start-desktop.cmd -Smoke needs -Legacy.
chcp 65001 >nul
node "%~dp0smoke.mjs" %*
exit /b %ERRORLEVEL%
