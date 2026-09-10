#!/usr/bin/env bash
set -euo pipefail

# ========================================================
#   Taris (SSH & Homelab Studio) - Linux & macOS Release Build
# ========================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

OUTPUT_DIR="$SCRIPT_DIR/output"

echo "========================================================"
echo "  Taris (SSH & Homelab Studio) - Release Build Script"
echo "========================================================"
echo

# 1. Detect Host OS
OS_NAME="$(uname -s)"
ARCH_NAME="$(uname -m)"
echo "[*] Detected Platform: $OS_NAME ($ARCH_NAME)"

# 2. Check for Cargo / Rust
if ! command -v cargo >/dev/null 2>&1; then
    echo "[ERROR] cargo not found. Please install Rust via https://rustup.rs"
    exit 1
fi
echo "    Found cargo: $(cargo --version)"

# 3. OS-Specific Dependency Check (Linux only)
if [ "$OS_NAME" = "Linux" ]; then
    echo "[*] Checking Linux build dependencies for Tauri v2..."
    MISSING_PKGS=()

    if ! command -v pkg-config >/dev/null 2>&1; then
        MISSING_PKGS+=("pkg-config")
    fi

    check_pkg() {
        if command -v pkg-config >/dev/null 2>&1; then
            if ! pkg-config --exists "$1" 2>/dev/null; then
                return 1
            fi
            return 0
        fi
        return 1
    }

    if ! check_pkg "webkit2gtk-4.1" && ! check_pkg "webkit2gtk-4.0"; then
        MISSING_PKGS+=("libwebkit2gtk-4.1-dev (or libwebkit2gtk-4.0-dev)")
    fi

    if ! check_pkg "gtk+-3.0"; then
        MISSING_PKGS+=("libgtk-3-dev")
    fi

    if ! check_pkg "libsoup-3.0" && ! check_pkg "libsoup-2.4"; then
        MISSING_PKGS+=("libsoup-3.0-dev (or libsoup2.4-dev)")
    fi

    if [ ${#MISSING_PKGS[@]} -gt 0 ]; then
        echo "[WARN] The following development libraries may be missing:"
        for pkg in "${MISSING_PKGS[@]}"; do
            echo "       - $pkg"
        done
        echo
        echo "If compilation fails, install prerequisites with:"
        echo "  Ubuntu/Debian: sudo apt update && sudo apt install -y libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev build-essential curl wget file libssl-dev libayatana-appindicator3-dev librsvg2-dev"
        echo "  Fedora:        sudo dnf install -y webkit2gtk4.1-devel gtk3-devel libsoup3-devel openssl-devel libappindicator-gtk3-devel"
        echo "  Arch Linux:    sudo pacman -S --needed webkit2gtk-4.1 gtk3 libsoup3 openssl"
        echo
    fi
elif [ "$OS_NAME" = "Darwin" ]; then
    echo "[*] Checking macOS build environment..."
    if ! command -v xcode-select >/dev/null 2>&1; then
        echo "[WARN] Xcode command line tools may be required (xcode-select --install)."
    fi
fi

# 4. Prepare output directory
mkdir -p "$OUTPUT_DIR"

# 5. Compile release binary
echo "[*] Compiling Taris in release mode (cargo build --release)..."
cargo build --release

# 6. Locate and copy binary
BINARY_SRC="$SCRIPT_DIR/target/release/taris"
if [ ! -f "$BINARY_SRC" ]; then
    echo "[ERROR] Release binary not found at $BINARY_SRC!"
    exit 1
fi

echo
echo "[*] Assembling release package in output/..."

cp "$BINARY_SRC" "$OUTPUT_DIR/taris"
chmod +x "$OUTPUT_DIR/taris"
echo "  [+] Copied and marked executable: output/taris"

# If macOS .app bundle exists, copy it as well
if [ "$OS_NAME" = "Darwin" ]; then
    for app_path in "$SCRIPT_DIR/target/release/bundle/osx/Taris.app" \
                    "$SCRIPT_DIR/target/release/bundle/macos/Taris.app"; do
        if [ -d "$app_path" ]; then
            cp -R "$app_path" "$OUTPUT_DIR/Taris.app"
            echo "  [+] Copied macOS App Bundle: output/Taris.app"
            break
        fi
    done
fi

# 7. Copy terminal themes
if [ -d "$SCRIPT_DIR/ui/themes" ]; then
    mkdir -p "$OUTPUT_DIR/themes"
    cp "$SCRIPT_DIR/ui/themes"/*.json "$OUTPUT_DIR/themes/" 2>/dev/null || true
    echo "  [+] Copied terminal theme palettes (themes/)"
fi

# 10. Ensure .ssh directory exists
mkdir -p "$OUTPUT_DIR/.ssh"
chmod 700 "$OUTPUT_DIR/.ssh" 2>/dev/null || true
echo "  [+] Initialized .ssh directory"

echo
echo "========================================================"
echo "  Build Successful! Output files in: $OUTPUT_DIR"
echo "========================================================"
ls -la "$OUTPUT_DIR"
echo
