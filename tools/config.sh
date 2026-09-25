# Shared settings for every tool in this repo. Sourced, never run.
#
# The two source repos are only ever READ. Nothing here writes into them
# except tools/ship.sh, and only when it is given a destination by hand.

HERE="$(cd "$(dirname "$0")/.." && pwd)"

# The Cave Survey add-on (JS) and the CaveCAD fork (C++ 3D view).
TOOLS_SRC="${TOOLS_SRC:-$HERE/../cavecad-tools}"
CAVECAD_SRC="${CAVECAD_SRC:-$HERE/../cavecad-src}"

# The running app, for the headless smoke test.
CAVECAD_BIN="${CAVECAD_BIN:-/Applications/CaveCAD.app/Contents/MacOS/CaveCAD}"

# One code per line in languages.txt, Qt style: de, es, pt_BR, zh_CN.
LANGS="${LANGS:-$(grep -v '^#' "$HERE/languages.txt" | grep -v '^[[:space:]]*$')}"

TS_DIR="${TS_DIR:-$HERE/ts}"
BUILD_DIR="${BUILD_DIR:-$HERE/build}"

# The add-on's autostart loader installs <ClassName>_<locale>.qm from the
# add-on's own ts/ folder, and the add-on class is CaveSurvey.
MODULE="CaveSurvey"

need() {
    command -v "$1" >/dev/null 2>&1 || {
        echo "error: $1 not found (brew install qt)" >&2
        exit 1
    }
}
