#!/bin/bash
#
# Install the CsSaveProbe add-on and enable it (dev machines only).
#
#   ./probe/install.sh           install + enable
#   ./probe/install.sh --remove  uninstall completely
#
# Then RESTART CaveCAD -- add-ons load at startup -- open a drawing, and
# press Save once. ./probe/read.sh reports what happened.

set -eu
cd "$(dirname "${BASH_SOURCE[0]}")"

DEST="$HOME/Library/Application Support/QCAD/CaveCAD"

if [ "${1:-}" = "--remove" ]; then
    rm -rf "$DEST/scripts/CsSaveProbe"
    rm -f "$DEST/CsSaveProbe.enabled" "$DEST/CsSaveProbe.log"
    echo "Probe removed. Restart CaveCAD."
    exit 0
fi

mkdir -p "$DEST/scripts/CsSaveProbe"
cp CsSaveProbe/CsSaveProbe.js "$DEST/scripts/CsSaveProbe/"
touch "$DEST/CsSaveProbe.enabled"
rm -f "$DEST/CsSaveProbe.log"

echo "Installed CsSaveProbe into $DEST/scripts/CsSaveProbe"
echo
echo "Now:"
echo "  1. Restart CaveCAD (add-ons load at startup)"
echo "  2. Open any drawing and press Save once"
echo "  3. ./probe/read.sh"
