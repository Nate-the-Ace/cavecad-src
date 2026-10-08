#!/bin/sh
#
# Installs the Cave Survey tools into CaveCAD, for macOS and Linux.
#
#   ./install.sh              install, or upgrade over an older copy
#   ./install.sh --uninstall  remove them again
#
# This copies the CaveSurvey folder into CaveCAD's per-user scripts folder.
# That location needs no administrator rights and survives a CaveCAD update.
# Everything it does can be done by hand instead -- see INSTALL.txt.

set -e

HERE=$(cd "$(dirname "$0")" && pwd)
SOURCE="$HERE/CaveSurvey"

case "$(uname -s)" in
    Darwin) SCRIPTS="$HOME/Library/Application Support/QCAD/CaveCAD/scripts" ;;
    *)      SCRIPTS="${XDG_DATA_HOME:-$HOME/.local/share}/QCAD/CaveCAD/scripts" ;;
esac
DEST="$SCRIPTS/CaveSurvey"

if [ "$1" = "--uninstall" ]; then
    if [ -e "$DEST" ]; then
        rm -rf "$DEST"
        echo "Removed $DEST"
        echo "Restart CaveCAD; the Cave Survey menu will be gone."
    else
        echo "Nothing to remove -- not installed at $DEST"
    fi
    exit 0
fi

if [ -n "$1" ]; then
    echo "usage: $0 [--uninstall]" >&2
    exit 2
fi

if [ ! -f "$SOURCE/CaveSurvey.js" ]; then
    echo "Can't find CaveSurvey/CaveSurvey.js next to this script." >&2
    echo "Run install.sh from inside the unpacked package folder." >&2
    exit 1
fi

# A previous install is replaced outright rather than merged, so that a tool
# dropped from a later release doesn't linger in the menu.
if [ -e "$DEST" ]; then
    echo "Replacing the existing install at:"
    echo "  $DEST"
    rm -rf "$DEST"
fi

mkdir -p "$SCRIPTS"
cp -R "$SOURCE" "$DEST"

echo
echo "Installed into:"
echo "  $DEST"
echo
echo "Tools installed:"
for tool in "$DEST"/*/; do
    [ -d "$tool" ] || continue
    echo "  $(basename "$tool")"
done
echo
echo "Now quit CaveCAD completely and start it again -- it only looks for"
echo "add-ons at startup. Look for 'Cave Survey' in the menu bar."
