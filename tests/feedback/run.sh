#!/bin/sh
# Runs every tests/feedback/*_test.js inside CaveCAD's own engine, headless.
# Shares tests/updater/harness.js (its result marker is "### UPDATER").
cd "$(dirname "$0")/../.." || exit 1
REPO="$PWD"
for c in "${CAVECAD:-}" debug/CaveCAD.app/Contents/MacOS/CaveCAD \
         /Applications/CaveCAD.app/Contents/MacOS/CaveCAD; do
    [ -n "$c" ] && [ -x "$c" ] && APP="$c" && break
done
[ -n "${APP:-}" ] || { echo "no CaveCAD binary found; set CAVECAD"; exit 2; }
status=0
for t in tests/feedback/*_test.js; do
    out=$("$APP" -no-dock-icon -no-gui -allow-multiple-instances \
          -autostart "$REPO/$t" "$REPO" 2>/dev/null | grep -A200 '### UPDATER' | grep -E '^(### UPDATER|  )')
    echo "${out:-### UPDATER FAIL no output ($t)}"
    case "$out" in *"UPDATER OK"*) ;; *) status=1 ;; esac
done
exit $status
