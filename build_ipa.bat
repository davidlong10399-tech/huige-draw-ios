@echo off
chcp 65001 >nul
cd /d F:\Lenovo\huige-draw-ios
echo.
echo ===== Huige Draw unsigned iOS IPA build =====
echo This triggers GitHub Actions on macOS and uploads huige-draw-unsigned.ipa.
echo.
gh auth status
if errorlevel 1 (
  echo.
  echo GitHub CLI is not logged in. Run: gh auth login
  pause
  exit /b 1
)
gh workflow run build-unsigned-ios.yml --ref main
timeout /t 5 /nobreak >nul
gh run list --workflow build-unsigned-ios.yml --limit 1
echo.
echo Open the run above, then download artifact: huige-draw-unsigned-ipa
pause
