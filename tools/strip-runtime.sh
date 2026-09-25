#!/bin/sh
# Removes what a CaveCAD user never needs from a staged runtime tree.
#
#   tools/strip-runtime.sh <dir holding scripts/ and ts/>
#
# Shared by every platform's packaging, so all three ship the same set.
#
#   scripts/**/Tests/          QCAD's own script test fixtures
#   scripts/**/doc/*_xx.*      tool help in languages other than English;
#                              AddOn.getDocHtmlUrl falls back to what is left
#   ts/*.ts                    translation SOURCES; the app loads the .qm

set -eu
ROOT="$1"
[ -d "$ROOT/scripts" ] || { echo "no scripts/ under $ROOT" >&2; exit 1; }

before=$(du -sk "$ROOT" | cut -f1)

find "$ROOT/scripts" -type d -name Tests -prune -exec rm -rf {} +

# Name_de.html, Name_desc_pt.mdx, Name_zh_CN.html, ... -- all but English.
find "$ROOT/scripts" -path '*/doc/*' -type f \
    \( -name '*_[a-z][a-z].html' -o -name '*_[a-z][a-z].mdx' \
       -o -name '*_[a-z][a-z]_[A-Z][A-Z].html' \
       -o -name '*_[a-z][a-z]_[A-Z][A-Z].mdx' \) \
    ! -name '*_en.html' ! -name '*_en.mdx' -delete

if [ -d "$ROOT/ts" ]; then
    find "$ROOT/ts" -type f -name '*.ts' -delete
fi

after=$(du -sk "$ROOT" | cut -f1)
echo "strip-runtime: $(( (before - after) / 1024 )) MB removed from $ROOT"
