#!/bin/sh
#
# Builds a release and installs it into CaveCAD's per-user scripts folder,
# so a build can be tested exactly the way it will be shipped.
#
#   ./tools/publish.sh                  build, install into CaveCAD, archive the zip
#   ./tools/publish.sh --version 1.1.0
#   ./tools/publish.sh --uninstall      remove the add-on from CaveCAD again
#
# CaveCAD has no setting for where add-ons live -- it looks in its own
# application folder and in the per-user folder below, and nowhere else. So the
# add-on goes straight into the per-user one, as real files, which is also what
# a user's install.sh run produces. Nothing is symlinked and nothing is left
# for CaveCAD to resolve at startup.
#
#   ~/Library/Application Support/QCAD/CaveCAD/scripts/CaveSurvey   (macOS)
#   ~/.local/share/QCAD/CaveCAD/scripts/CaveSurvey                  (Linux)
#
# (The QCAD path segment is the vendor folder the base build uses; the
# CaveCAD segment is the application's own.)
#
# The rest of the release -- the zip, templates, examples, install notes -- goes
# to the Cave folder instead of into the scripts folder, because CaveCAD scans
# that folder looking for add-ons and anything else there is just clutter in the
# way.
#
#   CAVE=~/elsewhere ./tools/publish.sh       archive somewhere else
#   SCRIPTS=/path/to/scripts ./tools/publish.sh   install somewhere else
#
# The counterpart is install_for_testing.sh in the AlignImage project, which
# links the app straight at the working copies for edit-and-restart iteration.
# This script goes through a real verified build instead, so what you test is
# what a release contains -- including AlignImage, which only ever meets the
# other five tools in a build.

set -e

cd "$(dirname "$0")/.." || exit 1
REPO="$PWD"

CAVE=${CAVE:-"$HOME/Documents/Cave"}

# The suite targets CaveCAD only -- it depends on CaveCAD's native XDATA
# persistence for survey data -- so CaveCAD's folder is the only install
# target.
if [ -z "${SCRIPTS:-}" ]; then
    case "$(uname -s)" in
        Darwin) QCAD_BASE="$HOME/Library/Application Support/QCAD" ;;
        *)      QCAD_BASE="${XDG_DATA_HOME:-$HOME/.local/share}/QCAD" ;;
    esac
    SCRIPTS_DIRS="$QCAD_BASE/CaveCAD/scripts
"
else
    SCRIPTS_DIRS="$SCRIPTS
"
fi

# CaveCAD reads add-ons once, at startup. A publish while it is running looks
# like it did nothing, which is worth saying out loud rather than leaving to be
# rediscovered.
running() {
    pgrep -f "CaveCAD.app/Contents/MacOS/CaveCAD" >/dev/null 2>&1 || pgrep -x cavecad >/dev/null 2>&1
}

# ----------------------------------------------------------------- uninstall
if [ "$1" = "--uninstall" ]; then
    echo "$SCRIPTS_DIRS" | while IFS= read -r sdir; do
        [ -z "$sdir" ] && continue
        DEST="$sdir/CaveSurvey"
        if [ -e "$DEST" ] || [ -L "$DEST" ]; then
            rm -rf "$DEST"
            echo "Removed $DEST"
        fi
    done
    echo "Restart CaveCAD; the Cave Survey menu will be gone."
    exit 0
fi

VERSION=$(cat VERSION)
while [ $# -gt 0 ]; do
    case "$1" in
        --version) VERSION="${2:-}"; shift 2 || exit 2 ;;
        *) echo "usage: $0 [--version X.Y.Z] [--uninstall]" >&2; exit 2 ;;
    esac
done

# --------------------------------------------------------------------- build
# Every structural check, plus a parse of each script in CaveCAD's own engine.
# Nothing is installed if it fails, so a broken build can't replace a working
# install with one that silently drops out of the menu.
"$REPO/tools/make_package.sh" --version "$VERSION"

NAME="CaveSurveyTools-$VERSION"
STAGE="$REPO/dist/$NAME"
ZIP="$REPO/dist/$NAME.zip"

for f in "$STAGE/CaveSurvey/CaveSurvey.js" "$ZIP"; do
    if [ ! -e "$f" ]; then
        echo "Build reported success but $f isn't there -- nothing published." >&2
        exit 1
    fi
done

# --------------------------------------------------- install into CaveCAD
# Replaced outright rather than merged: a tool dropped from this release must
# not linger in CaveCAD's copy and go on appearing in the menu.
INSTALLED_TO=""
echo "$SCRIPTS_DIRS" | while IFS= read -r sdir; do
    [ -z "$sdir" ] && continue
    DEST="$sdir/CaveSurvey"
    if [ -e "$DEST" ] || [ -L "$DEST" ]; then
        echo "Replacing the existing install at $DEST"
    fi
    rm -rf "$DEST"
    mkdir -p "$sdir"
    cp -R "$STAGE/CaveSurvey" "$DEST"
    echo "Installed: $DEST"
done
# for the report below:
DEST=$(echo "$SCRIPTS_DIRS" | head -n1)/CaveSurvey

# ------------------------------------------------------- archive the release
# Kept out of CaveCAD's scripts folder on purpose -- see the note at the top.
mkdir -p "$CAVE/releases"
cp "$ZIP" "$CAVE/releases/$NAME.zip"

# THE TEMPLATE IS SOMETHING A CAVER EDITS. Symbol Palette writes their
# own symbols INTO NSS_Cave_Template_PLAN.dxf (Nathan's call,
# 2026-09-06), and the loop below deletes templates/ outright before
# copying the shipped one over it.
#
# Losing those symbols on an upgrade was accepted as a known cost that
# day. It cost a real symbol -- a mud slope, drawn and saved -- within
# hours, because a development machine publishes many times an evening
# and every publish took the template with it. So the old template is
# set aside AND its custom symbols are carried into the new one.
PREV_TEMPLATE=""
if [ -f "$CAVE/templates/NSS_Cave_Template_PLAN.dxf" ]; then
    mkdir -p "$CAVE/templates_previous"
    PREV_TEMPLATE="$CAVE/templates_previous/NSS_Cave_Template_PLAN-$(date -u "+%Y%m%d-%H%M%S").dxf"
    cp "$CAVE/templates/NSS_Cave_Template_PLAN.dxf" "$PREV_TEMPLATE"
fi

for extra in templates examples docs INSTALL.txt README.txt LICENSE install.sh install.cmd; do
    rm -rf "$CAVE/$extra"
    [ -e "$STAGE/$extra" ] && cp -R "$STAGE/$extra" "$CAVE/$extra"
done

# ---- carry the caver's own symbols into the new template -------------
# Only blocks the shipped catalogue has never heard of come across; the
# 28 that ship are code, and the new file's copies are the current ones.
if [ -n "$PREV_TEMPLATE" ] && [ -f "$CAVE/templates/NSS_Cave_Template_PLAN.dxf" ]; then
    QCAD_APP="/Applications/CaveCAD.app/Contents/MacOS/CaveCAD"
    if [ -e "$QCAD_APP" ]; then
        MERGE_OUT=$("$QCAD_APP" -no-dock-icon -no-gui -allow-multiple-instances \
            -autostart "$REPO/tools/merge_custom_symbols.js" "$REPO" \
            "$CAVE/templates/NSS_Cave_Template_PLAN.dxf" "$PREV_TEMPLATE" \
            2>/dev/null | grep "### MERGE" || true)
        case "$MERGE_OUT" in
            *"MERGE OK 0"*) ;;
            *"MERGE OK"*)
                echo "note: carried your own symbols into the new template:"
                echo "      $(echo "$MERGE_OUT" | sed 's/^#* *MERGE OK [0-9]* *//')"
                ;;
            *)
                echo "WARNING: could not carry your own symbols into the new"
                echo "         template ($MERGE_OUT). The previous one is at"
                echo "         $PREV_TEMPLATE"
                ;;
        esac
    else
        echo "WARNING: CaveCAD not found, so any symbols you drew yourself were"
        echo "         NOT carried into the new template. They are still in"
        echo "         $PREV_TEMPLATE"
    fi
fi

COMMIT=$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo "an untracked working copy")
git -C "$REPO" diff --quiet HEAD 2>/dev/null || COMMIT="$COMMIT (with uncommitted changes)"

cat > "$CAVE/PUBLISHED.txt" <<NOTE
Cave Survey tools $VERSION
published $(date -u "+%Y-%m-%d %H:%M UTC") from $COMMIT
built by cavecad-tools/tools/publish.sh

Installed into CaveCAD at:
  $DEST

CaveCAD has no setting for that location -- it is one of the two folders it
looks in, so the add-on is installed there directly.

Past builds are in releases/. To go back to one, unzip it and run its
install.sh. Restart CaveCAD after any change; add-ons load only at startup.
NOTE

# ---------------------------------------------------------------- and report
echo
echo "Published $NAME"
echo "  into CaveCAD:  $DEST"
echo "  archived:      $CAVE/releases/$NAME.zip"
echo
echo "Tools installed:"
for tool in "$DEST"/*/; do
    [ -d "$tool" ] && echo "  $(basename "$tool")"
done
echo
if running; then
    echo "CaveCAD is running right now, and it only reads add-ons at startup --"
    echo "this publish will not show up until you quit it completely and"
    echo "start it again."
else
    echo "Start CaveCAD and look for 'Cave Survey' in the menu bar."
fi
