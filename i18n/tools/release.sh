#!/bin/sh
#
# Compiles ts/ into build/CaveSurvey_<lang>.qm, one file per language.
#
#   ./tools/release.sh
#
# Unfinished entries are left out of the .qm, so CaveCAD shows the English
# source for them instead of a half-reviewed guess.

set -e
. "$(dirname "$0")/config.sh"
need lrelease

mkdir -p "$BUILD_DIR"
for lang in $LANGS; do
    inputs=""
    for f in "$TS_DIR/${MODULE}_$lang.ts" "$TS_DIR/Cave3D_$lang.ts"; do
        [ -f "$f" ] && inputs="$inputs $f"
    done
    [ -n "$inputs" ] || { echo "skip $lang: no catalog (run extract.sh)"; continue; }
    # shellcheck disable=SC2086
    lrelease -silent $inputs -qm "$BUILD_DIR/${MODULE}_$lang.qm"
    echo "$lang: $(python3 "$HERE/tools/stats.py" $inputs)"
done
