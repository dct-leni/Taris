@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
cd /d "%ROOT%"

echo ========================================================
echo   Taris (SSH ^& Homelab Studio) - Windows Requirements Setup
echo ========================================================
echo.

:: ── 1. Check / Install Rust Toolchain ──
echo [1/5] Checking Rust toolchain (cargo ^& rustc)...
where cargo >nul 2>&1
if errorlevel 1 (
  echo   Cargo not found in PATH. Checking winget...
  where winget >nul 2>&1
  if errorlevel 1 (
    echo   [ERROR] winget not found. Please install Rust manually from https://rustup.rs
    exit /b 1
  )
  echo   Installing Rustup via winget...
  winget install --id Rustlang.Rustup -e --silent --accept-source-agreements --accept-package-agreements
  if errorlevel 1 (
    echo   [ERROR] Rustup installation failed.
    exit /b 1
  )
  echo   Rustup installed. Please restart this terminal to load %%USERPROFILE%%\.cargo\bin
) else (
  for /f "tokens=*" %%v in ('cargo --version 2^>nul') do echo   Found Cargo: %%v
  for /f "tokens=*" %%v in ('rustc --version 2^>nul') do echo   Found rustc: %%v
)

:: ── 2. Check / Install MSVC C++ Build Tools ──
echo.
echo [2/5] Checking MSVC C++ Build Tools (cl.exe ^& link.exe)...
set "MSVC_OK=0"

where cl.exe >nul 2>&1
if not errorlevel 1 set "MSVC_OK=1"

if "%MSVC_OK%"=="0" (
  for %%P in ("%ProgramFiles%" "%ProgramFiles(x86)%") do (
    for %%E in (BuildTools Community Professional Enterprise) do (
      if exist "%%~P\Microsoft Visual Studio\2022\%%E\VC\Tools\MSVC" (
        for /d %%d in ("%%~P\Microsoft Visual Studio\2022\%%E\VC\Tools\MSVC\*") do (
          if exist "%%d\bin\Hostx64\x64\cl.exe" set "MSVC_OK=1"
        )
      )
      if exist "%%~P\Microsoft Visual Studio\2019\%%E\VC\Tools\MSVC" (
        for /d %%d in ("%%~P\Microsoft Visual Studio\2019\%%E\VC\Tools\MSVC\*") do (
          if exist "%%d\bin\Hostx64\x64\cl.exe" set "MSVC_OK=1"
        )
      )
    )
  )
)

if "%MSVC_OK%"=="0" (
  echo   MSVC Build Tools not found. Installing via winget...
  where winget >nul 2>&1
  if errorlevel 1 (
    echo   [ERROR] winget not found. Install Visual Studio Build Tools with C++ workload manually:
    echo   https://visualstudio.microsoft.com/visual-cpp-build-tools/
    exit /b 1
  )
  winget install --id Microsoft.VisualStudio.2022.BuildTools ^
    --silent --accept-source-agreements ^
    --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
  if errorlevel 1 (
    echo   [ERROR] MSVC installation failed.
    exit /b 1
  )
  echo   MSVC Build Tools installed.
) else (
  echo   MSVC C++ Build Tools found.
)

:: ── 3. Check / Install Git ──
echo.
echo [3/5] Checking Git...
where git >nul 2>&1
if errorlevel 1 (
  echo   Git not found. Installing Git via winget...
  winget install --id Git.Git -e --silent --accept-source-agreements --accept-package-agreements
  if errorlevel 1 (
    echo   [WARN] Git installation via winget failed.
  ) else (
    echo   Git installed successfully.
  )
) else (
  for /f "tokens=*" %%v in ('git --version 2^>nul') do echo   Found Git: %%v
)

:: ── 4. Check Microsoft Edge WebView2 Runtime ──
echo.
echo [4/5] Checking Microsoft Edge WebView2 Runtime (Tauri UI engine)...
set "WV2_FOUND=0"
reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv >nul 2>&1
if not errorlevel 1 set "WV2_FOUND=1"

reg query "HKCU\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv >nul 2>&1
if not errorlevel 1 set "WV2_FOUND=1"

if "%WV2_FOUND%"=="1" (
  echo   Microsoft Edge WebView2 Runtime is installed.
) else (
  echo   WebView2 Runtime not detected in standard registry. Attempting install via winget...
  where winget >nul 2>&1
  if not errorlevel 1 (
    winget install --id Microsoft.EdgeWebView2Runtime -e --silent --accept-source-agreements --accept-package-agreements
    if errorlevel 1 (
      echo   [WARN] Could not auto-install WebView2 Runtime. If the app fails to start, download from:
      echo          https://developer.microsoft.com/en-us/microsoft-edge/webview2/
    ) else (
      echo   WebView2 Runtime installed successfully.
    )
  ) else (
    echo   [WARN] Please verify Microsoft Edge WebView2 Runtime is installed.
  )
)

:: ── 5. Verify Bundled Typography & Icon Fonts ──
echo.
echo [5/5] Checking typography and icons (assets\fonts and ui\fonts)...
if not exist "%ROOT%\assets\fonts" mkdir "%ROOT%\assets\fonts" 2>nul
if not exist "%ROOT%\ui\fonts" mkdir "%ROOT%\ui\fonts" 2>nul

:: Cascadia Code
if not exist "%ROOT%\assets\fonts\CascadiaCode.ttf" (
  if exist "C:\Windows\Fonts\CascadiaCode.ttf" (
    copy /y "C:\Windows\Fonts\CascadiaCode.ttf" "%ROOT%\assets\fonts\CascadiaCode.ttf" >nul
    echo   Copied CascadiaCode.ttf from Windows Fonts.
  ) else (
    echo   Downloading CascadiaCode font...
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
      "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
      "Invoke-WebRequest -Uri 'https://github.com/microsoft/cascadia-code/releases/download/v2407.24/CascadiaCode-2407.24.zip' -OutFile '%TEMP%\cascadia.zip'; " ^
      "Expand-Archive -Path '%TEMP%\cascadia.zip' -DestinationPath '%TEMP%\cascadia' -Force; " ^
      "Copy-Item -Path '%TEMP%\cascadia\ttf\CascadiaCode.ttf' -Destination '%ROOT%\assets\fonts\CascadiaCode.ttf' -Force; " ^
      "Remove-Item -Path '%TEMP%\cascadia.zip', '%TEMP%\cascadia' -Recurse -Force"
  )
)
if exist "%ROOT%\assets\fonts\CascadiaCode.ttf" if not exist "%ROOT%\ui\fonts\CascadiaCode.ttf" (
  copy /y "%ROOT%\assets\fonts\CascadiaCode.ttf" "%ROOT%\ui\fonts\CascadiaCode.ttf" >nul
)
echo   Cascadia Code: OK

:: FontAwesome
if not exist "%ROOT%\assets\fonts\FontAwesome.ttf" (
  echo   Downloading FontAwesome 6 icon font...
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
    "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
    "Invoke-WebRequest -Uri 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/webfonts/fa-solid-900.ttf' -OutFile '%ROOT%\assets\fonts\FontAwesome.ttf'"
)
if exist "%ROOT%\assets\fonts\FontAwesome.ttf" if not exist "%ROOT%\ui\fonts\FontAwesome.ttf" (
  copy /y "%ROOT%\assets\fonts\FontAwesome.ttf" "%ROOT%\ui\fonts\FontAwesome.ttf" >nul
)
echo   FontAwesome:   OK

:: Fira Code
if not exist "%ROOT%\assets\fonts\FiraCode.ttf" (
  echo   Downloading Fira Code Medium font...
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
    "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
    "Invoke-WebRequest -Uri 'https://cdnjs.cloudflare.com/ajax/libs/firacode/6.2.0/ttf/FiraCode-Medium.ttf' -OutFile '%ROOT%\assets\fonts\FiraCode.ttf'"
)
if exist "%ROOT%\assets\fonts\FiraCode.ttf" if not exist "%ROOT%\ui\fonts\FiraCode.ttf" (
  copy /y "%ROOT%\assets\fonts\FiraCode.ttf" "%ROOT%\ui\fonts\FiraCode.ttf" >nul
)
echo   Fira Code:     OK

:: Segoe UI
if not exist "%ROOT%\assets\fonts\SegoeUI.ttf" (
  if exist "C:\Windows\Fonts\segoeui.ttf" (
    copy /y "C:\Windows\Fonts\segoeui.ttf" "%ROOT%\assets\fonts\SegoeUI.ttf" >nul
  )
)
if exist "%ROOT%\assets\fonts\SegoeUI.ttf" if not exist "%ROOT%\ui\fonts\SegoeUI.ttf" (
  copy /y "%ROOT%\assets\fonts\SegoeUI.ttf" "%ROOT%\ui\fonts\SegoeUI.ttf" >nul
)
echo   Segoe UI:      OK

echo.
echo ========================================================
echo   All Windows build requirements are satisfied!
echo   Run 'build.bat' to produce the standalone release.
echo ========================================================
exit /b 0
