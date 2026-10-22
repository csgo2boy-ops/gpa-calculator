@echo off
cd /d "%~dp0"
echo ============================================
echo   GPA Tracker - One-Click Update
echo   (commit + push to GitHub + deploy)
echo ============================================
echo.

echo [1/3] Staging all changes...
git add -A

echo [2/3] Committing...
git commit -m "update: %date% %time%"
if errorlevel 1 echo   (nothing new to commit - continuing)

echo [3/3] Pushing to GitHub...
git push origin main
if errorlevel 1 goto :error

echo.
echo Deploying to Cloudflare...
call npx --yes wrangler deploy
if errorlevel 1 goto :error

echo.
echo ============================================
echo   DONE! Your site is updated.
echo ============================================
pause
exit /b 0

:error
echo.
echo ERROR: something failed. Check the message above.
pause
exit /b 1
