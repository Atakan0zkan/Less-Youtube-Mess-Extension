@echo off
cd /d "%~dp0"
echo [Less YouTube Mess] Running mandatory release checks...
call npm run test:release
if errorlevel 1 (
    echo [ERROR] Release checks failed. No new package was created.
    exit /b 1
)

echo [Less YouTube Mess] Packaging extension...

powershell.exe -NoProfile -NonInteractive -Command "$ErrorActionPreference = 'Stop'; Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Archive\Microsoft.PowerShell.Archive.psd1') -ErrorAction Stop; Compress-Archive -Path 'manifest.json', 'content.js', 'page-audio-bridge.js', 'styles.css', 'popup.html', 'popup.js', 'popup.css', 'shared', 'icons', '_locales' -DestinationPath 'extension.zip' -Force"

if %errorlevel% equ 0 (
    echo.
    echo [SUCCESS] extension.zip has been created successfully!
    echo You can now upload this file to the Chrome Web Store.
) else (
    echo.
    echo [ERROR] An error occurred while creating the package.
    exit /b 1
)

echo.
pause
