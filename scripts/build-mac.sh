#!/bin/zsh
# Builds "dist/Waking Up On Time.app": a universal (Apple Silicon + Intel) native macOS app that
# embeds the exported deck in a WKWebView. Recipients need nothing else installed.
# Usage: npm run mac            (set SKIP_EXPORT=1 to reuse an existing out/ folder)
set -euo pipefail
cd "$(dirname "$0")/.."

APP_NAME="Waking Up On Time"
EXEC_NAME="WakingUpOnTime"
BUNDLE_ID="com.github.zeusk.waking-up-on-time"
VERSION="$(node -p "require('./package.json').version" 2>/dev/null || echo 1.0.0)"
MIN_MACOS="12.3"
BUILD="build/mac"
APP="dist/$APP_NAME.app"
ZIP="dist/Waking-Up-On-Time-macOS.zip"

if [[ "${SKIP_EXPORT:-0}" != 1 ]]; then
  npm run export
fi
[[ -f out/index.html ]] || { echo "out/index.html missing: run npm run export first" >&2; exit 1; }

rm -rf "$BUILD" "$APP" "$ZIP"
mkdir -p "$BUILD" "$APP/Contents/MacOS" "$APP/Contents/Resources"

SDK="$(xcrun --sdk macosx --show-sdk-path)"
for arch in arm64 x86_64; do
  echo "Compiling $arch…"
  # The app uses no back-deployed Swift runtime features, so skip the compatibility libraries
  # (some Command Line Tools installs only ship them for arm64).
  xcrun swiftc -O -swift-version 5 -sdk "$SDK" -target "$arch-apple-macos$MIN_MACOS" \
    -runtime-compatibility-version none \
    macos/Shared/*.swift macos/App/*.swift -o "$BUILD/$EXEC_NAME-$arch"
done
lipo -create "$BUILD/$EXEC_NAME-arm64" "$BUILD/$EXEC_NAME-x86_64" -output "$APP/Contents/MacOS/$EXEC_NAME"

echo "Copying the deck…"
cp -R out "$APP/Contents/Resources/site"

echo "Making the icon…"
xcrun swift macos/make-icon.swift "$BUILD/icon-1024.png"
ICONSET="$BUILD/AppIcon.iconset"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$BUILD/icon-1024.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) "$BUILD/icon-1024.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleExecutable</key><string>$EXEC_NAME</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>$MIN_MACOS</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSHumanReadableCopyright</key><string>Shantanu Gupta</string>
</dict>
</plist>
PLIST

# Ad-hoc signature: enough to run locally and on Apple Silicon. For sharing without Gatekeeper
# warnings, sign with a Developer ID and notarize (see scripts/notarize-mac.sh).
codesign --force --deep --sign - "$APP"

ditto -c -k --keepParent "$APP" "$ZIP"
echo
echo "Built: $APP ($(du -sh "$APP" | cut -f1))"
echo "Zip:   $ZIP ($(du -sh "$ZIP" | cut -f1))"
