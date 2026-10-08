#!/bin/bash
#
# Builds CaveCAD -- QCAD Community rebranded and extended as a dedicated
# cave mapping application -- from pinned upstream sources plus the
# patches in this folder.
#
#   ./cavecad/build.sh              clone/patch/build into ../cavecad-build
#   BUILD_DIR=~/src ./cavecad/build.sh
#
# What it produces:
#   $BUILD_DIR/qcad/debug/QCAD.app  the CaveCAD application
#   ~/Applications/CaveCAD.app      convenience symlink
#
# Requirements (macOS): Xcode CLT, Homebrew qt (Qt6), cmake, ninja.
#   brew install qt cmake ninja
#
# The Cave Survey add-on itself is NOT built here -- it is the scripts
# in this repository, installed by tools/publish.sh into CaveCAD's
# per-user scripts folder (~/Library/Application Support/QCAD/CaveCAD).

set -e
cd "$(dirname "$0")" || exit 1
HERE="$PWD"
REPO="$(dirname "$HERE")"

BUILD_DIR=${BUILD_DIR:-"$REPO/../cavecad-build"}
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

# ---- pinned upstream sources -------------------------------------------
# (SHAs recorded in cavecad/UPSTREAM_PINS; patches were generated
# against exactly these)
QCAD_SHA=$(awk '{print $6}' "$HERE/UPSTREAM_PINS")
QTJSAPI_SHA=$(awk '{print $2}' "$HERE/UPSTREAM_PINS")
QCADJSAPI_SHA=$(awk '{print $4}' "$HERE/UPSTREAM_PINS")

clone_at() { # name url sha
    if [ ! -d "$1" ]; then
        git clone "$2" "$1"
    fi
    git -C "$1" fetch --quiet origin
    git -C "$1" checkout --quiet "$3"
}

clone_at qcad      https://github.com/qcad/qcad.git      "$QCAD_SHA"
clone_at qtjsapi   https://github.com/qcad/qtjsapi.git   "$QTJSAPI_SHA"
clone_at qcadjsapi https://github.com/qcad/qcadjsapi.git "$QCADJSAPI_SHA"

# ---- apply the CaveCAD patches ------------------------------------------
cd qcad
if ! git rev-parse --verify cavecad >/dev/null 2>&1; then
    git checkout -b cavecad "$QCAD_SHA"
    git am "$HERE"/patches/*.patch
else
    git checkout cavecad
fi
cd ..

# ---- build ----------------------------------------------------------------
QT_PREFIX=${QT_PREFIX:-/opt/homebrew/opt/qt}

cd qcad
CMAKE_PREFIX_PATH="$QT_PREFIX" cmake -DBUILD_QT6=ON -G Ninja . >/dev/null
ninja -j"$(sysctl -n hw.ncpu 2>/dev/null || echo 4)"
cd ..

# the script engine plugin (built against ../qcad by relative path)
for lib in qtjsapi qcadjsapi; do
    cd "$lib"
    CMAKE_PREFIX_PATH="$QT_PREFIX" cmake -G Ninja . >/dev/null
    ninja -j"$(sysctl -n hw.ncpu 2>/dev/null || echo 4)"
    cd ..
done

# ---- convenience link -------------------------------------------------------
mkdir -p ~/Applications
ln -sfn "$BUILD_DIR/qcad/debug/QCAD.app" ~/Applications/CaveCAD.app

echo
echo "CaveCAD built: $BUILD_DIR/qcad/debug/QCAD.app"
echo "Launcher:      ~/Applications/CaveCAD.app"
echo
echo "Install the Cave Survey suite into it with:  ./tools/publish.sh"
