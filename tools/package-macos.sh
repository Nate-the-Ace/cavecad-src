#!/bin/sh
# Build a distributable, self-contained CaveCAD.app and a .dmg from it.
#
#   tools/package-macos.sh <build-dir> <macdeployqt> <out-dir>
#
# <build-dir> is release/ (CI) or debug/ (local). Unlike deploy-macos.sh,
# which links the machine's own Homebrew Qt, this bundles Qt into the app
# with macdeployqt, so the result runs on a Mac with no Qt installed.
#
# The bundle is ad-hoc signed only. Gatekeeper will refuse a downloaded
# copy until it is signed with a Developer ID and notarized.

set -eu

SRC="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$(cd "$1" && pwd)"
MACDEPLOYQT="$2"
OUT="$3"

APP="$OUT/CaveCAD.app"
rm -rf "$APP"
mkdir -p "$OUT"
ditto "$BUILD/CaveCAD.app" "$APP"

mkdir -p "$APP/Contents/Frameworks" "$APP/Contents/PlugIns/designer"
cp "$BUILD"/libcavecad*.dylib \
   "$BUILD"/libspatialindexnavel.dylib \
   "$BUILD"/libopennurbs.dylib \
   "$BUILD"/libqtjsapi.dylib \
   "$APP/Contents/Frameworks/"
cp "$SRC"/plugins/libcavecad*.dylib "$APP/Contents/PlugIns/"
# QFormBuilder needs the custom widget plugin, or the command line widget
# breaks and autostart aborts before the main window appears.
cp "$SRC"/plugins/designer/libcavecadcustomwidgets.dylib \
   "$APP/Contents/PlugIns/designer/"

for d in scripts patterns linetypes fonts ts themes libraries defaults; do
    ditto "$SRC/$d" "$APP/Contents/Resources/$d"
done
"$SRC/tools/strip-runtime.sh" "$APP/Contents/Resources"

BIN="$APP/Contents/MacOS/CaveCAD"
install_name_tool -add_rpath @executable_path/../Frameworks "$BIN"
# drop build-tree rpaths so the app never loads libraries from a checkout
otool -l "$BIN" | awk '/cmd LC_RPATH/{getline; getline; print $2}' | \
while read -r rp; do
    case "$rp" in
        @*) ;;
        *) install_name_tool -delete_rpath "$rp" "$BIN" ;;
    esac
done

# Pass every plugin as an extra executable so macdeployqt deploys the Qt
# modules they use (the JS API plugin alone pulls in QtQml) and rewrites
# their Qt references to the bundled frameworks.
set --
for p in "$APP"/Contents/PlugIns/*.dylib "$APP"/Contents/PlugIns/designer/*.dylib; do
    set -- "$@" "-executable=$p"
done
"$MACDEPLOYQT" "$APP" -verbose=1 "$@" \
    -libpath="$APP/Contents/Frameworks"

# Qt's database drivers for servers CaveCAD never talks to link client
# libraries from wherever Qt was built (Postgres.app, Homebrew,
# /usr/local), which no user's Mac has. Only SQLite is kept.
rm -f "$APP"/Contents/PlugIns/sqldrivers/libqsqlpsql.dylib \
      "$APP"/Contents/PlugIns/sqldrivers/libqsqlodbc.dylib \
      "$APP"/Contents/PlugIns/sqldrivers/libqsqlmimer.dylib

# macdeployqt re-signs what it touched; sign the whole bundle once more so
# the seal covers the resources and plugins copied in above.
codesign --force --deep -s - "$APP"
codesign --verify --deep --strict "$APP"

rm -f "$OUT/CaveCAD.dmg"
hdiutil create -quiet -volname CaveCAD -srcfolder "$APP" -ov -format UDZO \
    "$OUT/CaveCAD.dmg"
echo "Packaged $APP and $OUT/CaveCAD.dmg"
