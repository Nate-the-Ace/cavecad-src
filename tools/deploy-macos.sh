#!/bin/sh
# Assemble a self-contained CaveCAD.app from the build tree and install it
# into /Applications (or the directory given as $1).
#
# The build produces a bare bundle (binary + Info.plist + icns); resources
# and libraries live in the source tree. RSettings::isDeployed() switches
# to bundle mode when Contents/Resources/scripts exists, and
# RSettings::getPluginPath() then resolves Contents/PlugIns.
# QFormBuilder loads custom widgets (RTextEdit, RCommandLine, ...) from
# PlugIns/designer — without that plugin the command line widget breaks
# and autostart aborts before the main window appears.
#
# Qt itself is NOT bundled: the binary links the Homebrew Qt in
# /opt/homebrew/opt/qt. This install is for the local machine only; for a
# distributable bundle run macdeployqt on the result.

set -eu

SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-/Applications}"
STAGE="$(mktemp -d)/CaveCAD.app"

if [ ! -d "$SRC/debug/CaveCAD.app" ]; then
    echo "debug/CaveCAD.app not found; build first (ninja)" >&2
    exit 1
fi

ditto "$SRC/debug/CaveCAD.app" "$STAGE"

mkdir -p "$STAGE/Contents/Frameworks" "$STAGE/Contents/PlugIns/designer" \
         "$STAGE/Contents/PlugIns/imageformats"
cp "$SRC"/debug/libcavecad*.dylib \
   "$SRC"/debug/libspatialindexnavel.dylib \
   "$SRC"/debug/libopennurbs.dylib \
   "$SRC"/debug/libqtjsapi.dylib \
   "$STAGE/Contents/Frameworks/"
cp "$SRC"/plugins/libcavecad*.dylib "$STAGE/Contents/PlugIns/"
cp "$SRC"/plugins/designer/libcavecadcustomwidgets.dylib \
   "$STAGE/Contents/PlugIns/designer/"

# Qt's own image format plugins. Without these the application can read
# only the formats built into QtGui (PNG, BMP, PPM...) -- no JPEG at all,
# which is the format survey sketches are scanned to and photographs are
# taken in. A cave's scans/ folder would insert as nothing.
#
# The FULL qt formula, not qtbase: qtbase carries only gif/ico/jpeg,
# while qt adds the qtimageformats set -- TIFF (scanned notes), HEIC
# (iPhone photographs), WebP, SVG. Both are the same Qt version, so the
# plugins are ABI-compatible with the qtbase the binary links.
QT_PLUGINS="$(brew --prefix qt 2>/dev/null)/share/qt/plugins"
if [ ! -d "$QT_PLUGINS/imageformats" ]; then
    QT_PLUGINS="$(brew --prefix qtbase 2>/dev/null)/share/qt/plugins"
fi
if [ -d "$QT_PLUGINS/imageformats" ]; then
    cp "$QT_PLUGINS"/imageformats/*.dylib \
       "$STAGE/Contents/PlugIns/imageformats/" 2>/dev/null || true
else
    echo "warning: Qt image format plugins not found; JPEG will not load" >&2
fi

for d in scripts patterns linetypes fonts ts themes libraries defaults; do
    ditto "$SRC/$d" "$STAGE/Contents/Resources/$d"
done

BIN="$STAGE/Contents/MacOS/CaveCAD"
install_name_tool -add_rpath @executable_path/../Frameworks "$BIN"
# strip build-tree rpaths so the installed app never loads repo libraries
otool -l "$BIN" | awk '/cmd LC_RPATH/{getline; getline; print $2}' | \
while read -r rp; do
    case "$rp" in
        "$SRC"*) install_name_tool -delete_rpath "$rp" "$BIN" ;;
    esac
done
codesign --force -s - "$BIN"

rm -rf "$DEST/CaveCAD.app"
ditto "$STAGE" "$DEST/CaveCAD.app"
rm -rf "$(dirname "$STAGE")"

echo "Installed $DEST/CaveCAD.app"
