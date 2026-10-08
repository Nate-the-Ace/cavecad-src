#!/bin/sh
#
# End-to-end check of this repo's tools against a fixture add-on.
#
#   ./tests/run.sh
#
# Never touches cave-survey or cavecad-src: every path is pointed at the
# fixture and a temp dir. Needs lupdate/lrelease and an installed CaveCAD.

set -e
cd "$(dirname "$0")/.."
HERE="$PWD"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export TOOLS_SRC="$HERE/tests/fixture"
export CAVECAD_SRC="$TMP/no-such-src"
export TS_DIR="$TMP/ts" BUILD_DIR="$TMP/build" LANGS="de"
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: got '$2' want '$3'"; fail=1; fi; }

# 1. audit finds exactly the planted problems, and --fail trips on them.
totals="$(python3 tools/audit.py | tail -1)"
check "audit totals" "$totals" "UNWRAPPED=2  DYNAMIC=1  CONCAT=1  NUMBER=1"
if python3 tools/audit.py --fail >/dev/null; then check "audit --fail" "exit 0" "exit 1"; else check "audit --fail" "exit 1" "exit 1"; fi

# 2. extract sees every literal qsTr, contexts named for the file.
./tools/extract.sh >/dev/null
n="$(grep -c '<message' "$TS_DIR/CaveSurvey_de.ts")"
check "extract message count" "$n" "4"
check "extract context" "$(grep -o '<name>Probe</name>' "$TS_DIR/CaveSurvey_de.ts")" "<name>Probe</name>"

# 3. translate one entry, release, and CaveCAD must return it.
python3 - "$TS_DIR/CaveSurvey_de.ts" <<'EOF'
import sys, xml.etree.ElementTree as ET
p = sys.argv[1]; t = ET.parse(p)
for m in t.iter("message"):
    if m.findtext("source") == "Hello probe":
        tr = m.find("translation"); tr.text = "Hallo Sonde"; tr.attrib.pop("type", None)
t.write(p, encoding="utf-8", xml_declaration=True)
EOF
./tools/release.sh >/dev/null
check "release built" "$(ls "$BUILD_DIR")" "CaveSurvey_de.qm"
if python3 tools/smoke.py "$BUILD_DIR/CaveSurvey_de.qm" "$TS_DIR/CaveSurvey_de.ts" > "$TMP/smoke.out"; then r=pass; else r=fail; fi
check "smoke in CaveCAD" "$r $(tail -1 "$TMP/smoke.out")" "pass smoke: 1 checked, 0 wrong"

# 4. a wrong translation in the catalog must be caught.
sed -i '' 's/Hallo Sonde/Hallo Falsch/' "$TS_DIR/CaveSurvey_de.ts"
if python3 tools/smoke.py "$BUILD_DIR/CaveSurvey_de.qm" "$TS_DIR/CaveSurvey_de.ts" >/dev/null; then r=pass; else r=fail; fi
check "smoke catches mismatch" "$r" "fail"

# 5. ship refuses a folder that is not the add-on, accepts one that is.
if ./tools/ship.sh "$TMP" >/dev/null 2>&1; then r=accepted; else r=refused; fi
check "ship refuses non-add-on" "$r" "refused"
cp -R tests/fixture/scripts/CaveSurvey "$TMP/addon"
./tools/ship.sh "$TMP/addon" >/dev/null
check "ship copies qm" "$(ls "$TMP/addon/ts")" "CaveSurvey_de.qm"

exit $fail
