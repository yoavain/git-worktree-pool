@echo off
rem wtp-launcher 2
rem Written by "worktree-pool setup". It runs worktree-pool, then moves this cmd session to
rem the folder that worktree-pool picked. "worktree-pool setup --remove" deletes this file.
setlocal
where /q worktree-pool || goto :missing
if defined WTP_CWD_FILE (
  call worktree-pool %*
  exit /b
)
set "WTP_CWD_FILE=%TEMP%\wtp-cwd-%RANDOM%%RANDOM%.txt"
call worktree-pool %*
set "WTP_RC=%ERRORLEVEL%"
set "WTP_DIR="
if not exist "%WTP_CWD_FILE%" (endlocal & exit /b %WTP_RC%)
rem worktree-pool writes UTF-8. Read it under code page 65001, then restore the user's code page.
rem These lines must stay outside a ( ) block: inside one, a non-ASCII path fails.
for /f "tokens=2 delims=:." %%c in ('chcp') do set /a "WTP_CP=%%c"
chcp 65001 >nul
set /p WTP_DIR=<"%WTP_CWD_FILE%"
chcp %WTP_CP% >nul
del "%WTP_CWD_FILE%" >nul 2>&1
if not defined WTP_DIR (endlocal & exit /b %WTP_RC%)
endlocal & cd /d "%WTP_DIR%" & exit /b %WTP_RC%

:missing
>&2 echo wtp: worktree-pool is not installed. Reinstall git-worktree-pool, or delete "%~f0".
exit /b 9009
