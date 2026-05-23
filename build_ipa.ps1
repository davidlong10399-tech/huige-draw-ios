$ErrorActionPreference = 'Stop'
$env:Path = 'C:\Program Files\AutoClaw\resources\node;' + $env:Path
$env:EAS_NO_VCS = '1'
$env:EAS_PROJECT_ROOT = 'F:\\openclaw-autoclaw\\ai-studio-ios'
Set-Location 'F:\\openclaw-autoclaw\\ai-studio-ios'
Write-Host '== Expo/EAS account ==' -ForegroundColor Cyan
npx eas-cli whoami
Write-Host '== Start iOS preview .ipa build ==' -ForegroundColor Cyan
Write-Host 'If EAS asks for Apple ID / 2FA / certificates, enter them here. Do NOT send passwords to chat.' -ForegroundColor Yellow
npx eas-cli build --platform ios --profile preview

