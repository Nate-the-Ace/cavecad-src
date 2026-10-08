#!/bin/bash
#
# Report what the save probe saw, and say what it means.

set -eu
LOG="$HOME/Library/Application Support/QCAD/CaveCAD/CsSaveProbe.log"

if [ ! -f "$LOG" ]; then
    echo "No probe log at:"
    echo "  $LOG"
    echo
    echo "Either the probe is not installed (./probe/install.sh), CaveCAD"
    echo "has not been restarted since installing it, or the add-on never"
    echo "loaded at all -- which would itself be the answer."
    exit 1
fi

echo "=== log ==="
cat "$LOG"
echo
echo "=== verdict ==="

if ! grep -q "READY" "$LOG"; then
    echo "The probe did not finish starting. The add-on loader did not run"
    echo "it, so nothing below can be concluded about save hooks."
    exit 0
fi

SAVES=$(grep -c "^.*  SAVE     " "$LOG" || true)
if [ "${SAVES:-0}" -gt 0 ]; then
    echo "$SAVES save(s) recorded through the real save path (patch 0006)."
    echo
    echo "Backups:"
    grep "  SAVE     " "$LOG" | sed 's/^/  /' | tail -20
    echo
    echo "After-save work:"
    grep "  AFTER    " "$LOG" | sed 's/^/  /' | tail -20
    echo
    echo "A \"backup=already current\" line means the drawing was byte-"
    echo "identical to the newest backup, so no generation was spent."
    echo "\"did=(nothing)\" means the cave is outside every drive root --"
    echo "project folders and the shelf only apply under one."
    echo
fi

if grep -q "FIRED    Save.prototype.save" "$LOG"; then
    if grep -q "FIRED    Save.prototype.save.*identity=same-prototype" "$LOG"; then
        echo "The wrapper FIRED, on the same prototype it was installed on."
        echo "An add-on CAN hook the GUI save path. CsBackup's note that"
        echo "such a wrapper 'never runs' does not hold in this build, and"
        echo "CsCave.installSaveHook is live rather than inert."
    else
        echo "The wrapper fired, but the prototype had been replaced since"
        echo "install -- something else wrapped it afterwards. Order matters;"
        echo "look at the INSTALL lines above."
    fi
elif grep -q "FIRED    RDocumentInterface.exportFile" "$LOG"; then
    echo "The save reached RDocumentInterface.exportFile through JS, but the"
    echo "Save.prototype wrapper never ran. That is CsBackup's finding"
    echo "confirmed: the action uses a prototype the add-on cannot reach, so"
    echo "anything that must run on save belongs in a fork patch to"
    echo "scripts/File/Save/Save.js (the shape patch 0005 already uses)."
elif [ "${SAVES:-0}" -gt 0 ]; then
    echo "The Save.prototype wrapper did not fire, which is EXPECTED now:"
    echo "patch 0006 puts its calls INSIDE Save.prototype.save rather than"
    echo "wrapping it, so the add-on-installed wrapper is still bypassed."
    echo "The SAVE/AFTER lines above are the real signal."
else
    echo "Nothing recorded. Either no save happened since the restart, or"
    echo "the add-on is not being reached at all -- check that"
    echo "CaveSurvey/AddOnPath is set and the bundle's Save.js carries"
    echo "patch 0006."
fi
