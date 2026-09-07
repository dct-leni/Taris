@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

echo ===================================================
echo   Taris (SSH ^& Homelab Manager) - Requirements Setup
echo ===================================================
echo.

:: ── 1. Check / Install Rust & Cargo ──
echo [1/4] Checking Rust toolchain (cargo ^& rustc)...
where cargo >nul 2>&1
if errorlevel 1 (
  echo Rust/Cargo not found. Installing Rustup via winget...
  where winget >nul 2>&1
  if errorlevel 1 (
    echo ERROR: winget not found. Please install Rustup manually from https://rustup.rs
    exit /b 1
  )
  winget install --id Rustlang.Rustup -e --silent --accept-source-agreements --accept-package-agreements
  if errorlevel 1 (
    echo Rustup installation failed.
    exit /b 1
  )
  echo Rustup installed. Please restart this terminal or ensure PATH contains %%USERPROFILE%%\.cargo\bin
) else (
  for /f "tokens=*" %%v in ('cargo --version 2^>nul') do echo   Found: %%v
)

:: ── 2. Check / Install MSVC Build Tools ──
echo.
echo [2/4] Checking MSVC C++ Build Tools (cl.exe)...
set "MSVC_OK=0"

for %%P in ("%ProgramFiles%" "%ProgramFiles(x86)%") do (
  for %%E in (BuildTools Community Professional Enterprise) do (
    if exist "%%~P\Microsoft Visual Studio\2022\%%E\VC\Tools\MSVC" (
      for /d %%d in ("%%~P\Microsoft Visual Studio\2022\%%E\VC\Tools\MSVC\*") do (
        if exist "%%d\bin\Hostx64\x64\cl.exe" set "MSVC_OK=1"
      )
    )
  )
)

if "%MSVC_OK%"=="0" (
  echo MSVC Build Tools not found. Installing via winget...
  where winget >nul 2>&1
  if errorlevel 1 (
    echo ERROR: winget not found. Install Visual Studio Build Tools with C++ workload manually.
    exit /b 1
  )
  winget install --id Microsoft.VisualStudio.2022.BuildTools ^
    --silent --accept-source-agreements ^
    --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
  if errorlevel 1 (
    echo MSVC installation failed.
    exit /b 1
  )
  echo MSVC Build Tools installed.
) else (
  echo   MSVC Build Tools found.
)

:: ── 3. Check / Install Git ──
echo.
echo [3/4] Checking Git...
where git >nul 2>&1
if errorlevel 1 (
  echo Git not found. Installing Git via winget...
  winget install --id Git.Git -e --silent --accept-source-agreements --accept-package-agreements
  if errorlevel 1 (
    echo Git installation failed.
  )
) else (
  for /f "tokens=*" %%v in ('git --version 2^>nul') do echo   Found: %%v
)

:: ── 4. Verify Bundled Typography & Icons ──
echo.
echo [4/4] Checking bundled typography & icons (CascadiaCode.ttf, FontAwesome.ttf)...
if not exist "%ROOT%\assets\fonts\CascadiaCode.ttf" (
  echo Downloading Cascadia Code font...
  if not exist "%ROOT%\assets\fonts" mkdir "%ROOT%\assets\fonts"
  if exist "C:\Windows\Fonts\CascadiaCode.ttf" (
    copy /y "C:\Windows\Fonts\CascadiaCode.ttf" "%ROOT%\assets\fonts\CascadiaCode.ttf" >nul
    echo   Copied CascadiaCode.ttf from Windows Fonts.
  ) else (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
      "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
      "Invoke-WebRequest -Uri 'https://github.com/microsoft/cascadia-code/releases/download/v2407.24/CascadiaCode-2407.24.zip' -OutFile '%TEMP%\cascadia.zip'; " ^
      "Expand-Archive -Path '%TEMP%\cascadia.zip' -DestinationPath '%TEMP%\cascadia' -Force; " ^
      "Copy-Item -Path '%TEMP%\cascadia\ttf\CascadiaCode.ttf' -Destination '%ROOT%\assets\fonts\CascadiaCode.ttf' -Force; " ^
      "Remove-Item -Path '%TEMP%\cascadia.zip', '%TEMP%\cascadia' -Recurse -Force"
    echo   Downloaded CascadiaCode.ttf to assets\fonts\
  )
) else (
  echo   Cascadia Code font found: %ROOT%\assets\fonts\CascadiaCode.ttf
)

if not exist "%ROOT%\assets\fonts\FontAwesome.ttf" (
  echo Downloading FontAwesome 6 icon font...
  if not exist "%ROOT%\assets\fonts" mkdir "%ROOT%\assets\fonts"
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
    "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
    "Invoke-WebRequest -Uri 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/webfonts/fa-solid-900.ttf' -OutFile '%ROOT%\assets\fonts\FontAwesome.ttf'"
  echo   Downloaded FontAwesome.ttf to assets\fonts\
) else (
  echo   FontAwesome icon font found: %ROOT%\assets\fonts\FontAwesome.ttf
)

if not exist "%ROOT%\assets\fonts\FiraCode.ttf" (
  echo Downloading Fira Code Medium font...
  if not exist "%ROOT%\assets\fonts" mkdir "%ROOT%\assets\fonts"
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
    "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
    "Invoke-WebRequest -Uri 'https://cdnjs.cloudflare.com/ajax/libs/firacode/6.2.0/ttf/FiraCode-Medium.ttf' -OutFile '%ROOT%\assets\fonts\FiraCode.ttf'"
  echo   Downloaded FiraCode.ttf to assets\fonts\
) else (
  echo   Fira Code Medium font found: %ROOT%\assets\fonts\FiraCode.ttf
)

if not exist "%ROOT%\assets\fonts\SegoeUI.ttf" (
  if exist "C:\Windows\Fonts\segoeui.ttf" (
    copy /y "C:\Windows\Fonts\segoeui.ttf" "%ROOT%\assets\fonts\SegoeUI.ttf" >nul
    echo   Copied SegoeUI.ttf from Windows Fonts.
  )
) else (
  echo   Segoe UI font found: %ROOT%\assets\fonts\SegoeUI.ttf
)

echo.
echo ===================================================
echo   All requirements ready!
echo   Run 'cargo run' to start Taris.
echo ===================================================
exit /b 0
