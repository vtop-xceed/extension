#!/bin/bash
# VTOP Captcha Solver - Extension Packager
# Produces a Chrome .crx, Chrome .zip, and a Firefox .zip

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
EXT_DIR="$SCRIPT_DIR/extension"
ROOT_DIR="$SCRIPT_DIR"

# Version from argument or manifest
V_ARG="${1#v}"
VERSION="${V_ARG:-$(grep '"version"' "$EXT_DIR/manifest.json" | head -1 | sed 's/.*: *"\(.*\)".*/\1/')}"
PEM_FILE="${2:-$ROOT_DIR/captop-chrome.pem}"

CHROME_DIR="$ROOT_DIR/captop-chrome"
CHROME_CRX="$ROOT_DIR/captop-chrome.crx"
CHROME_ZIP="$ROOT_DIR/captop-chrome-v$VERSION.zip"
FIREFOX_ZIP="$ROOT_DIR/captop-firefox-v$VERSION.zip"

# Clean up
echo "🧹 Cleaning up old outputs..."
rm -rf "$CHROME_DIR" "$CHROME_CRX"
rm -f "$ROOT_DIR"/captop-chrome-v*.zip
rm -f "$ROOT_DIR"/captop-firefox-v*.zip

# 1. Chrome
echo "🌐 Packaging Chrome extension v$VERSION..."
mkdir -p "$CHROME_DIR"
rsync -a --exclude="firefox-manifest.json" --exclude="manifest.json.chrome" --exclude=".*" "$EXT_DIR/" "$CHROME_DIR/"

# Build .crx
if [ -f "$PEM_FILE" ]; then
    npx -y crx pack "$CHROME_DIR" -o "$CHROME_CRX" -p "$PEM_FILE"
    echo "✅ Chrome .crx ready at $CHROME_CRX"
else
    echo "⚠️  Chrome .pem key not found, skipping .crx"
fi

# Build Chrome .zip (for Load Unpacked install)
cd "$CHROME_DIR"
zip -r "$CHROME_ZIP" . -x ".*" > /dev/null
cd "$ROOT_DIR"
echo "✅ Chrome .zip ready at $CHROME_ZIP"

# Clean up temp folder
rm -rf "$CHROME_DIR"

# 2. Firefox
echo "🦊 Packaging Firefox extension v$VERSION..."
cd "$EXT_DIR"
if [ -f "firefox-manifest.json" ]; then
    mv manifest.json manifest.json.chrome
    cp firefox-manifest.json manifest.json

    zip -r "$FIREFOX_ZIP" . -x "manifest.json.chrome" "firefox-manifest.json" "*.zip" ".*" > /dev/null

    mv manifest.json.chrome manifest.json
    echo "✅ Firefox .zip ready at $FIREFOX_ZIP"
else
    echo "❌ Error: firefox-manifest.json not found!"
    exit 1
fi

cd "$ROOT_DIR"
echo "🎉 Done! Outputs:"
[ -f "$CHROME_CRX" ] && ls -lh "$CHROME_CRX"
ls -lh "$CHROME_ZIP" "$FIREFOX_ZIP"
