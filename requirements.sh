#!/usr/bin/env bash
set -euo pipefail

# ========================================================
#   Taris (SSH & Homelab Studio) - Linux Requirements Setup
# ========================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "========================================================"
echo "  Taris (SSH & Homelab Studio) - Linux Requirements Setup"
echo "========================================================"
echo

# 1. Detect Linux Distribution
if [ -f /etc/os-release ]; then
    . /etc/os-release
    DISTRO_ID="${ID:-unknown}"
    DISTRO_LIKE="${ID_LIKE:-}"
else
    DISTRO_ID="unknown"
    DISTRO_LIKE=""
fi

echo "[*] Detected Linux Distribution: $DISTRO_ID ($DISTRO_LIKE)"

# Helper for sudo execution
SUDO=""
if [ "${EUID:-$(id -u)}" -ne 0 ]; then
    if command -v sudo >/dev/null 2>&1; then
        SUDO="sudo"
    else
        echo "[WARN] Script is not running as root and 'sudo' is not installed."
        echo "       Please run this script as root or install sudo."
    fi
fi

# 2. Install System Dependencies via Native Package Manager
echo "[*] Installing native C/C++, GTK3, WebKitGTK and development libraries..."

case "$DISTRO_ID" in
    ubuntu|debian|pop|mint|kali|elementary|raspbian)
        echo "    Using apt-get..."
        $SUDO apt-get update -y
        # Try WebKitGTK 4.1 first (standard for modern Ubuntu/Debian)
        if ! $SUDO apt-get install -y \
            build-essential \
            curl \
            wget \
            file \
            pkg-config \
            libssl-dev \
            libgtk-3-dev \
            libwebkit2gtk-4.1-dev \
            libsoup-3.0-dev \
            libjavascriptcoregtk-4.1-dev \
            libayatana-appindicator3-dev \
            librsvg2-dev; then
            echo "    [i] Falling back to WebKitGTK 4.0 for older releases..."
            $SUDO apt-get install -y \
                libwebkit2gtk-4.0-dev \
                libsoup2.4-dev \
                libjavascriptcoregtk-4.0-dev \
                libappindicator3-dev
        fi
        ;;

    fedora|rhel|centos|rocky|almalinux)
        echo "    Using dnf..."
        $SUDO dnf install -y \
            gcc \
            gcc-c++ \
            make \
            curl \
            wget \
            file \
            pkgconf-pkg-config \
            openssl-devel \
            gtk3-devel \
            webkit2gtk4.1-devel \
            libsoup3-devel \
            javascriptcoregtk4.1-devel \
            libappindicator-gtk3-devel \
            librsvg2-devel
        ;;

    arch|manjaro|endeavouros|garuda)
        echo "    Using pacman..."
        $SUDO pacman -S --needed --noconfirm \
            base-devel \
            curl \
            wget \
            file \
            pkgconf \
            openssl \
            gtk3 \
            webkit2gtk-4.1 \
            libsoup3 \
            libappindicator-gtk3 \
            librsvg
        ;;

    opensuse*|suse)
        echo "    Using zypper..."
        $SUDO zypper install -y \
            patterns-devel-base-devel_basis \
            curl \
            wget \
            file \
            pkg-config \
            libopenssl-devel \
            gtk3-devel \
            webkit2gtk3-devel \
            libsoup-devel
        ;;

    alpine)
        echo "    Using apk..."
        $SUDO apk add --no-cache \
            build-base \
            curl \
            wget \
            file \
            pkgconf \
            openssl-dev \
            gtk+3.0-dev \
            webkit2gtk-dev \
            libsoup3-dev
        ;;

    *)
        echo "    [WARN] Unrecognized distribution '$DISTRO_ID'."
        echo "    Please manually ensure the following packages are installed:"
        echo "      - WebKitGTK 4.1 development headers (or 4.0)"
        echo "      - GTK3 development headers"
        echo "      - libsoup 3.0 (or 2.4)"
        echo "      - OpenSSL / libssl development headers"
        echo "      - C/C++ compiler (gcc/g++ or clang), make, pkg-config"
        ;;
esac

# 3. Check / Install Rust & Cargo Toolchain
echo
echo "[*] Checking Rust toolchain (cargo & rustc)..."
if ! command -v cargo >/dev/null 2>&1; then
    echo "    Cargo not found. Installing Rust via rustup.rs..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    # Source environment for current shell session
    if [ -f "$HOME/.cargo/env" ]; then
        . "$HOME/.cargo/env"
    fi
    echo "    Rust installed successfully: $(cargo --version)"
else
    echo "    Found cargo: $(cargo --version)"
    echo "    Found rustc: $(rustc --version)"
fi

# 4. Verify Fonts in ui/fonts
echo
echo "[*] Checking typography and icons in ui/fonts/..."
mkdir -p "$SCRIPT_DIR/ui/fonts" "$SCRIPT_DIR/assets/fonts"

if [ ! -f "$SCRIPT_DIR/ui/fonts/CascadiaCode.ttf" ]; then
    if [ -f "$SCRIPT_DIR/assets/fonts/CascadiaCode.ttf" ]; then
        cp "$SCRIPT_DIR/assets/fonts/CascadiaCode.ttf" "$SCRIPT_DIR/ui/fonts/CascadiaCode.ttf"
    else
        echo "    Downloading CascadiaCode.ttf..."
        curl -fsSL -o "$SCRIPT_DIR/ui/fonts/CascadiaCode.ttf" \
            "https://raw.githubusercontent.com/microsoft/cascadia-code/main/fonts/static/CascadiaCode-Regular.ttf" || true
    fi
fi

if [ ! -f "$SCRIPT_DIR/ui/fonts/FontAwesome.ttf" ]; then
    if [ -f "$SCRIPT_DIR/assets/fonts/FontAwesome.ttf" ]; then
        cp "$SCRIPT_DIR/assets/fonts/FontAwesome.ttf" "$SCRIPT_DIR/ui/fonts/FontAwesome.ttf"
    else
        echo "    Downloading FontAwesome.ttf..."
        curl -fsSL -o "$SCRIPT_DIR/ui/fonts/FontAwesome.ttf" \
            "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/webfonts/fa-solid-900.ttf" || true
    fi
fi
echo "    Typography & icons: OK"

echo
echo "========================================================"
echo "  All Linux build requirements are satisfied!"
echo "  You can now run: ./build.sh"
echo "========================================================"
