@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
cd /d "%ROOT%"

echo ========================================================
echo   Taris (SSH ^& Homelab Studio) - Windows Release Build
echo ========================================================
echo.

:: 1. Verify Cargo / Rust
where cargo >nul 2>&1
if errorlevel 1 (
    echo [ERROR] cargo was not found. Please install Rust from https://rustup.rs or run requirements.bat
    exit /b 1
)

:: 2. Prepare output directory
set "OUTPUT_DIR=%ROOT%\output"
if not exist "%OUTPUT_DIR%" (
    mkdir "%OUTPUT_DIR%" 2>nul
)

:: 3. Run Release Compilation
echo [*] Building Taris in release mode (cargo build --release)...
cargo build --release
if errorlevel 1 (
    echo.
    echo [ERROR] Release build failed!
    exit /b 1
)

:: 4. Verify compiled binary
if not exist "%ROOT%\target\release\taris.exe" (
    echo [ERROR] target\release\taris.exe was not found after compilation!
    exit /b 1
)

echo.
echo [*] Assembling release package in output\...

:: 5. Copy executable
copy /y "%ROOT%\target\release\taris.exe" "%OUTPUT_DIR%\taris.exe" >nul
if errorlevel 1 (
    echo [ERROR] Failed to copy taris.exe to %OUTPUT_DIR%
    exit /b 1
)
echo   [+] Copied taris.exe

:: 6. Copy terminal theme files
if exist "%ROOT%\ui\themes" (
    if not exist "%OUTPUT_DIR%\themes" mkdir "%OUTPUT_DIR%\themes" 2>nul
    xcopy /y /q /i "%ROOT%\ui\themes\*.json" "%OUTPUT_DIR%\themes\" >nul 2>&1
    echo   [+] Copied terminal theme palettes (themes\)
)

:: 8. Copy documentation
if exist "%ROOT%\README.md" (
    copy /y "%ROOT%\README.md" "%OUTPUT_DIR%\README.md" >nul
    echo   [+] Copied README.md
)

:: 9. Ensure .ssh directory exists
if not exist "%OUTPUT_DIR%\.ssh" (
    mkdir "%OUTPUT_DIR%\.ssh" 2>nul
    echo   [+] Initialized .ssh directory
)

:: 10. Create double-click launcher
(
    echo @echo off
    echo cd /d "%%~dp0"
    echo start "" "%%~dp0taris.exe"
) > "%OUTPUT_DIR%\run.bat"
echo   [+] Created run.bat launcher

echo.
echo ========================================================
echo   Build Successful! Output files in: %OUTPUT_DIR%
echo ========================================================
dir "%OUTPUT_DIR%"
echo.
