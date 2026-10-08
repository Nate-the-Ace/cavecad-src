#!/bin/sh
#
# Pulls every translatable string out of the source repos into ts/.
#
#   ./tools/extract.sh
#
# Two catalogs per language, because the strings have two owners:
#
#   ts/CaveSurvey_<lang>.ts   qsTr() in the add-on's JS (context = file basename)
#   ts/Cave3D_<lang>.ts       tr() in the fork's RCave3d* C++ (context = class)
#
# release.sh merges both into one CaveSurvey_<lang>.qm. That works because an
# installed QTranslator answers for every context, not just its own add-on's.
#
# Existing translations are kept. A string that disappeared from the source
# is marked vanished, not deleted, so a rename can be re-matched by hand.

set -e
. "$(dirname "$0")/config.sh"
need lupdate

[ -d "$TOOLS_SRC/scripts/CaveSurvey" ] || { echo "error: no add-on at $TOOLS_SRC" >&2; exit 1; }

LIST_JS="$(mktemp)"
LIST_CPP="$(mktemp)"
trap 'rm -f "$LIST_JS" "$LIST_CPP"' EXIT

find "$TOOLS_SRC/scripts/CaveSurvey" -name '*.js' | sort > "$LIST_JS"
find "$CAVECAD_SRC/src/gui" -name 'RCave3d*.cpp' -o -name 'RCave3d*.h' 2>/dev/null | sort > "$LIST_CPP"

mkdir -p "$TS_DIR"
for lang in $LANGS; do
    echo "== $lang"
    lupdate @"$LIST_JS" -locations relative -target-language "$lang" \
        -ts "$TS_DIR/${MODULE}_$lang.ts" | grep -E 'Found|error' || true
    if [ -s "$LIST_CPP" ]; then
        lupdate @"$LIST_CPP" -locations relative -target-language "$lang" \
            -ts "$TS_DIR/Cave3D_$lang.ts" | grep -E 'Found|error' || true
    fi
done
