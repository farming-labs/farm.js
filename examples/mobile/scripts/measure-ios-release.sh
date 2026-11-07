#!/usr/bin/env bash
# CI evidence for the iOS app as a phone gets it (RFC 0004): the size of the Release archive
# `xcodebuild archive` made for generic/platform=iOS, unsigned. Prints a Markdown summary.
#
#   measure-ios-release.sh <App.xcarchive> <label>
#
# - install: the .app's bytes on the device (arm64 only, no simulator slices).
# - download: the .app zipped as an IPA, which is roughly what the App Store sends.
# - download, encrypted binary: the App Store encrypts the main executable, which then no longer
#   compresses; this counts it uncompressed, the upper bound Apple's own estimate approaches.
set -euo pipefail

archive="$1"
label="$2"
app=$(find "$archive/Products/Applications" -maxdepth 1 -name '*.app' | head -1)
test -d "$app" || { echo "No .app in $archive" >&2; exit 1; }
name=$(basename "$app" .app)
work=$(mktemp -d)

# Bytes of the files under a path (du counts blocks, which overstates small files).
bytes() { find "$1" -type f -print0 | xargs -0 stat -f %z | awk '{ s += $1 } END { print s + 0 }'; }
mb() { awk -v b="$1" 'BEGIN { printf "%.1f MB", b / 1048576 }'; }

archs=$(lipo -archs "$app/$name")
install=$(bytes "$app")
binary=$(stat -f %z "$app/$name")
frameworks=0
[ -d "$app/Frameworks" ] && frameworks=$(bytes "$app/Frameworks")
bytecode=0
[ -f "$app/farm-native.hbc" ] && bytecode=$(stat -f %z "$app/farm-native.hbc")

mkdir -p "$work/Payload"
cp -R "$app" "$work/Payload/"
(cd "$work" && ditto -c -k --sequesterRsrc --keepParent Payload app.ipa)
download=$(stat -f %z "$work/app.ipa")
ditto -c -k "$app/$name" "$work/binary.zip"
binary_zipped=$(stat -f %z "$work/binary.zip")
encrypted=$((download - binary_zipped + binary))

echo "### iOS Release archive: $label"
echo
echo "| | |"
echo "| --- | --- |"
echo "| architectures of the executable | $archs |"
echo "| install size (.app on the device) | $(mb "$install") |"
echo "| download (.app zipped as an IPA) | $(mb "$download") |"
echo "| download, executable counted uncompressed (App Store encryption) | $(mb "$encrypted") |"
echo "| main executable | $(mb "$binary") |"
echo "| embedded frameworks | $(mb "$frameworks") |"
if [ -d "$app/Frameworks" ]; then
  for framework in "$app"/Frameworks/*.framework; do
    echo "| - $(basename "$framework") | $(mb "$(bytes "$framework")") |"
  done
fi
if [ "$bytecode" -gt 0 ]; then
  echo "| Hermes bytecode (farm-native.hbc) | $(mb "$bytecode") |"
fi
echo
# Machine-readable, for the RFC's table.
echo "<!-- install_bytes=$install download_bytes=$download encrypted_bytes=$encrypted binary_bytes=$binary frameworks_bytes=$frameworks bytecode_bytes=$bytecode -->"
rm -rf "$work"
