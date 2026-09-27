#!/usr/bin/env bash
# Installs Qt with aqtinstall, retrying across mirrors.
#
#   tools/install-qt.sh <python> <host> <version> <arch> <outdir>
#
# Qt's download network sometimes serves a corrupt or truncated archive
# (seen 2026-09-26/27 as "Bad7zFile: Specified path is bad" on Windows,
# with unchanged aqt/py7zr versions), which failed whole builds before any
# of our code compiled. Each attempt starts clean; the first mirror is
# aqt's own default choice.
set -u
PY=$1 HOST=$2 VERSION=$3 ARCH=$4 OUT=$5
MIRRORS=("" "https://download.qt.io/" "https://qt.mirror.constant.com/" \
         "https://mirrors.ocf.berkeley.edu/qt/")
for base in "${MIRRORS[@]}"; do
    rm -rf "${OUT:?}/$VERSION"
    echo "::group::aqt install-qt ${base:-(default mirror)}"
    if "$PY" -m aqt install-qt ${base:+--base "$base"} "$HOST" desktop "$VERSION" "$ARCH" \
            -m qt5compat qtimageformats -O "$OUT"; then
        echo "::endgroup::"
        exit 0
    fi
    echo "::endgroup::"
    echo "::warning::Qt install from ${base:-the default mirror} failed; trying the next"
done
echo "::error::Qt $VERSION ($HOST $ARCH) could not be installed from any mirror"
exit 1
