$ErrorActionPreference = 'Stop'
Set-Location 'F:\Lenovo\huige-draw-ios'

Write-Host '== Huige Draw unsigned iOS IPA build ==' -ForegroundColor Cyan
Write-Host 'This triggers GitHub Actions on macOS and uploads huige-draw-unsigned.ipa as an artifact.' -ForegroundColor Yellow

gh auth status
gh workflow run build-unsigned-ios.yml --ref main
Start-Sleep -Seconds 5
gh run list --workflow build-unsigned-ios.yml --limit 1
