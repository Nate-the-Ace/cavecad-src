#!/bin/bash
#
# Bridge protocol test: headless CaveCAD serves via harness_serve.js while
# test_protocol.py exercises the wire protocol with exact-value assertions.
#
#   ./bridge/tests/test_protocol.sh

set -u
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 1

QCAD="/Applications/CaveCAD.app/Contents/MacOS/CaveCAD"
if [ ! -e "$QCAD" ]; then
    echo "SKIP: CaveCAD not found at $QCAD"
    exit 0
fi

# harness_serve.js uses QDir.tempPath(), which follows TMPDIR on macOS.
DIR="${TMPDIR%/}/csmcp-test"
rm -rf "$DIR"
mkdir -p "$DIR"

"$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
    -autostart bridge/tests/harness_serve.js "$PWD" >"$DIR/harness.log" 2>&1 &
QPID=$!

python3 bridge/tests/test_protocol.py "$DIR"
status=$?

touch "$DIR/stop"
wait "$QPID" 2>/dev/null

if [ $status -ne 0 ]; then
    echo "--- harness log ---"
    cat "$DIR/harness.log"
fi
exit $status
