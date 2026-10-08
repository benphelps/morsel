#!/bin/zsh
# Builds the morsel menu bar app and installs it to ~/Applications.
# Permissions (Calendars, Music automation, Full Disk Access) stick to this installed copy.
#
# Set MORSEL_TEAM to your Apple team ID (here or in the repo's .env) to sign with it, so those
# permissions also survive rebuilds. Without it the app is signed for this Mac only, and macOS
# may ask for them again after a rebuild.
set -euo pipefail
cd "$(dirname "$0")"
if [[ -z "${MORSEL_TEAM:-}" && -f ../.env ]]; then
  MORSEL_TEAM=$(sed -n 's/^MORSEL_TEAM=//p' ../.env | tail -1)
fi
signing=()
[[ -n "${MORSEL_TEAM:-}" ]] && signing=(DEVELOPMENT_TEAM="$MORSEL_TEAM" CODE_SIGN_IDENTITY="Apple Development")
xcodegen generate --quiet
xcodebuild -project Morsel.xcodeproj -scheme Morsel -configuration Release -derivedDataPath build -quiet build "${signing[@]}"
mkdir -p ~/Applications
pkill -x morsel 2>/dev/null && sleep 1 || true
rm -rf ~/Applications/morsel.app
ditto build/Build/Products/Release/morsel.app ~/Applications/morsel.app
open ~/Applications/morsel.app
echo "Installed ~/Applications/morsel.app"
