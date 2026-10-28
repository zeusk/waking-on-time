#!/bin/zsh
# Optional: sign the app with your Developer ID and notarize it so it opens on any Mac without
# Gatekeeper warnings. Requires an Apple Developer account. Run `npm run mac` first.
#
#   DEVELOPER_ID="Developer ID Application: Your Name (TEAMID)" \
#   NOTARY_PROFILE="your-notarytool-profile" \
#   zsh scripts/notarize-mac.sh
#
# Create the notary profile once with:
#   xcrun notarytool store-credentials your-notarytool-profile --apple-id <id> --team-id <TEAMID>
set -euo pipefail
cd "$(dirname "$0")/.."

APP="dist/Waking Up On Time.app"
ZIP="dist/Waking-Up-On-Time-macOS.zip"
: "${DEVELOPER_ID:?Set DEVELOPER_ID to your Developer ID Application identity}"
: "${NOTARY_PROFILE:?Set NOTARY_PROFILE to a notarytool keychain profile}"

codesign --force --deep --options runtime --timestamp --sign "$DEVELOPER_ID" "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"

rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"
xcrun notarytool submit "$ZIP" --keychain-profile "$NOTARY_PROFILE" --wait
xcrun stapler staple "$APP"

# Re-zip so the shared archive contains the stapled ticket.
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"
spctl --assess --type execute --verbose "$APP"
echo "Notarized: $ZIP"
