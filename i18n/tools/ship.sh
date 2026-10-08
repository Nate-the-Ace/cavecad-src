#!/bin/sh
#
# Copies built .qm files into a Cave Survey add-on folder's ts/.
#
#   ./tools/ship.sh ../cave-survey/scripts/CaveSurvey
#
# The ONLY tool here that writes outside this repo, and only to the folder
# named on the command line -- run it on a cave-survey branch made for the
# purpose. CaveCAD's autostart loads <addon>/ts/CaveSurvey_<locale>.qm, and
# make_package.sh copies the whole add-on folder, so nothing else is needed
# for the files to ship.

set -e
. "$(dirname "$0")/config.sh"

DEST="$1"
[ -n "$DEST" ] || { echo "usage: $0 <path to scripts/CaveSurvey>" >&2; exit 2; }
[ -f "$DEST/CaveSurvey.js" ] || { echo "error: $DEST is not the add-on folder (no CaveSurvey.js)" >&2; exit 1; }
ls "$BUILD_DIR"/"$MODULE"_*.qm >/dev/null 2>&1 || { echo "error: nothing built (run release.sh)" >&2; exit 1; }

mkdir -p "$DEST/ts"
cp "$BUILD_DIR"/"$MODULE"_*.qm "$DEST/ts/"
ls "$DEST/ts"
