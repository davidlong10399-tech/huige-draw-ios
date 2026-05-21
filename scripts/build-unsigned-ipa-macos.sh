#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "== Huige Draw unsigned iOS build =="
echo "This script must run on macOS with Xcode installed."
echo "It builds an unsigned device .ipa for jailbroken/self-signing workflows."

echo "== Install JS deps =="
npm install

echo "== Generate native iOS project =="
npx expo prebuild --platform ios --clean

echo "== Install CocoaPods =="
cd ios
pod install

WORKSPACE="$(ls *.xcworkspace | head -n 1)"
SCHEME="$(basename "$WORKSPACE" .xcworkspace)"
ARCHIVE_PATH="$(pwd)/build/$SCHEME.xcarchive"
EXPORT_DIR="$(pwd)/build/unsigned-export"

mkdir -p build

echo "== Archive without code signing =="
xcodebuild archive \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$ARCHIVE_PATH" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  DEVELOPMENT_TEAM="" \
  SKIP_INSTALL=NO \
  BUILD_LIBRARY_FOR_DISTRIBUTION=NO

APP_PATH="$ARCHIVE_PATH/Products/Applications/$SCHEME.app"
if [ ! -d "$APP_PATH" ]; then
  echo "App not found at $APP_PATH"
  find "$ARCHIVE_PATH" -maxdepth 5 -type d -name "*.app"
  exit 1
fi

echo "== Package unsigned IPA =="
rm -rf "$EXPORT_DIR"
mkdir -p "$EXPORT_DIR/Payload"
cp -R "$APP_PATH" "$EXPORT_DIR/Payload/"
cd "$EXPORT_DIR"
zip -qry "../../${SCHEME}-unsigned.ipa" Payload

echo "Done: ios/build/${SCHEME}-unsigned.ipa"
echo "Now sign it with your jailbreak/self-signing tool."
