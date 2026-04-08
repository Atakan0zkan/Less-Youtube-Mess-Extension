@echo off
echo [Less YouTube Mess] Packaging extension...

powershell -Command "Compress-Archive -Path 'manifest.json', 'content.js', 'styles.css', 'popup.html', 'popup.js', 'popup.css', 'shared', 'icons' -DestinationPath 'extension.zip' -Force"

if %errorlevel% equ 0 (
    echo.
    echo [SUCCESS] extension.zip has been created successfully!
    echo You can now upload this file to the Chrome Web Store.
) else (
    echo.
    echo [ERROR] An error occurred while creating the package.
)

echo.
pause
