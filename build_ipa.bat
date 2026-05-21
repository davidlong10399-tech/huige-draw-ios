@echo off
chcp 65001 >nul
set PATH=C:\Program Files\AutoClaw\resources\node;%PATH%
set EAS_NO_VCS=1
set EAS_PROJECT_ROOT=F:\Lenovo\ai-studio-ios
cd /d F:\Lenovo\ai-studio-ios
echo.
echo ===== Huige Draw iOS IPA Build =====
echo Expo account should be: liudaye
echo If Apple ID / 2FA / certificates are requested, enter them in this window.
echo Do NOT paste passwords into chat.
echo.
npx eas-cli whoami
if errorlevel 1 (
  echo.
  echo Not logged in. Running login...
  npx eas-cli login
)
echo.
echo Starting iOS preview build...
npx eas-cli build --platform ios --profile preview
echo.
echo If build succeeds, EAS will print a download URL for the .ipa.
pause
