#!/bin/bash
#
# Install the CsMcpBridge add-on into CaveCAD's per-user scripts folder and
# enable it (dev machines only -- the bridge evals arbitrary local script).
#
#   ./bridge/install.sh            install + enable
#   ./bridge/install.sh --disable  remove the flag file (add-on stays, inert)

set -eu
cd "$(dirname "${BASH_SOURCE[0]}")"

DEST="$HOME/Library/Application Support/QCAD/CaveCAD"

if [ "${1:-}" = "--disable" ]; then
    rm -f "$DEST/CsMcpBridge.enabled"
    echo "Bridge disabled (flag removed). Restart CaveCAD."
    exit 0
fi

mkdir -p "$DEST/scripts/CsMcpBridge"
cp CsMcpBridge/CsMcpBridge.js "$DEST/scripts/CsMcpBridge/"
touch "$DEST/CsMcpBridge.enabled"

echo "Installed CsMcpBridge into $DEST/scripts/CsMcpBridge"
echo "Flag file created: $DEST/CsMcpBridge.enabled"
echo "Restart CaveCAD (add-ons load at startup). Port file will appear at:"
echo "  $DEST/CsMcpBridge.port"
echo
echo "Register the MCP server with Claude Code once:"
echo "  claude mcp add --scope user cavecad -- uv run \"$PWD/mcp_server.py\""
