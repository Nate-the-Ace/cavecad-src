#!/bin/bash
#
# Runs every automated test in this repo. See tests/README.md.
#
# Uses .venv/bin/python if a venv exists (so the ezdxf-dependent DXF tests
# run), otherwise falls back to system python3 and skips those.
#
#   ./tests/run_all.sh             what has to pass while developing
#   ./tests/run_all.sh --publish   also what has to pass before releasing
#                                  (toolbar icons, status tips)

set -u
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

# Icons aren't needed to develop a tool, only to ship it -- so those checks are
# opt-in rather than a standing failure. See TestPublishReadiness.
case "${1:-}" in
    --publish)
        export CAVESURVEY_PUBLISH_CHECK=1
        echo "Publish checks ENABLED (toolbar icons, status tips)."
        echo
        ;;
    "") ;;
    *)
        echo "usage: $0 [--publish]" >&2
        exit 2
        ;;
esac

PY="python3"

status=0

echo "=============================================================="
echo " 1/55 Structural tests (add-on layout, includes, layers)"
echo "=============================================================="
"$PY" -m unittest discover -s tests -v || status=1

QCAD="${CAVECAD_BIN:-/Applications/CaveCAD.app/Contents/MacOS/CaveCAD}"

# 26 of the 27 suites need the real engine and print SKIP without it --
# which used to leave "ALL TESTS PASSED" standing on a machine where
# only the structural tests actually ran. Skipping is fine while
# developing without CaveCAD installed; it is not fine as release
# evidence, so --publish turns a missing engine into a failure, and an
# ordinary run says plainly what the pass does and does not cover.
engine=1
if [ ! -e "$QCAD" ]; then
    engine=0
    echo
    if [ -n "${CAVESURVEY_PUBLISH_CHECK:-}" ]; then
        echo "FAIL: CaveCAD not found at $QCAD -- publish checks are"
        echo "      release evidence and the structural tests alone"
        echo "      cannot give it."
        status=1
    else
        echo "NOTE: CaveCAD not found at $QCAD -- the 25 engine suites"
        echo "      below will SKIP."
    fi
fi

echo
echo "=============================================================="
echo " 2/55 Add-on syntax check (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/js_syntax.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### SYNTAX OK"*) ;;
        *) echo "Add-on syntax check did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found at $QCAD"
fi

echo
echo "=============================================================="
echo " 3/55 Core unit tests (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/js_unit.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### UNIT OK"*) ;;
        *) echo "Core unit tests did not pass."; status=1 ;;
    esac
else
    echo "NOTE: CaveCAD not found -- running the same tests under node instead."
    if command -v node >/dev/null 2>&1; then
        node tests/js_unit.js || status=1
    else
        echo "SKIP: neither CaveCAD nor node available."
    fi
fi

echo
echo "=============================================================="
echo " 4/55 Profile draw round trip & linework regression (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/profile_draw_roundtrip.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### PROFILE DRAW OK"*) ;;
        *) echo "Profile draw round trip did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- the round trip needs the real engine" \
         "(RDocument, RDocumentInterface, real file I/O) and cannot run" \
         "under node."
fi

echo
echo "=============================================================="
echo " 5/55 Generate Profile tool, driven headlessly (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/generate_profile_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### GENERATE PROFILE RUN OK"*) ;;
        *) echo "Generate Profile headless run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this drives the tool's own run()" \
         "function against a real RDocument/RDocumentInterface and" \
         "cannot run under node."
fi

echo
echo "=============================================================="
echo " 6/55 AlignImage stays in the plan frame (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/align_image_frame.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### ALIGN IMAGE FRAME OK"*) ;;
        *) echo "AlignImage frame test did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this calls the tool's own" \
         "per-entity transform() against a real RDocument and cannot" \
         "run under node."
fi

echo
echo "=============================================================="
echo " 7/55 CalloutWrite (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/callout_write.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### CALLOUT-WRITE OK"*) ;;
        *) echo "CalloutWrite test did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this drives CalloutWrite against a" \
         "real RDocument/RDocumentInterface and cannot run under node."
fi

echo
echo "=============================================================="
echo " 8/55 CalloutSync (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/callout_sync.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### CALLOUT-SYNC OK"*) ;;
        *) echo "CalloutSync test did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this drives CalloutSync against a" \
         "real RDocument/RDocumentInterface and cannot run under node."
fi

echo
echo "=============================================================="
echo " 9/55 Callout's elevation mode (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/callout_elev_mode.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### CALLOUT ELEV MODE OK"*) ;;
        *) echo "Callout elevation mode test did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this drives Callout's elevation " \
         "mode against a real RDocument/RDocumentInterface and cannot " \
         "run under node."
fi

echo
echo "=============================================================="
echo " 10/55 Repair Drawing (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/repair_drawing_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### REPAIR DRAWING OK"*) ;;
        *) echo "Repair Drawing test did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this drives CsRepair against a" \
         "real RDocument/RDocumentInterface and cannot run under node."
fi

echo
echo "=============================================================="
echo " 11/55 Reset Drawing empties a cave drawing (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/reset_drawing_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### RESET DRAWING OK"*) ;;
        *) echo "Reset Drawing test did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- the rules are unit-tested in" \
         "js_unit.js; this stage proves a real document comes back" \
         "empty, images and georeference intact, and cannot run under node."
fi

echo
echo "=============================================================="
echo " 12/55 Package Cave Project (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/package_cave.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### PACKAGE CAVE OK"*) ;;
        *) echo "Package Cave Project test did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this writes a real DXF, strips it," \
         "and shells out to the platform's zip program; none of that" \
         "can run under node."
fi

echo
echo "=============================================================="
echo " 13/55 Export Cave Survey, driven headlessly (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/export_cave_survey_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### EXPORT CAVE SURVEY OK"*) ;;
        *) echo "Export Cave Survey headless run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this drives the tool's own entry" \
         "point against a real RDocument, writes real files and greps" \
         "them, and cannot run under node."
fi

echo
echo "=============================================================="
echo " 14/55 Cross sections (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/cross_section_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### CROSS SECTION OK"*) ;;
        *) echo "Cross section test did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this places real block references" \
         "and reads them back, and cannot run under node."
fi

echo
echo "=============================================================="
echo " 15/55 Sketched cross sections (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/section_sketch_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### SECTION SKETCH OK"*) ;;
        *) echo "Sketched cross section run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this opens a real bay, moves real" \
         "entities into a real block definition and round-trips it" \
         "through DXF, and cannot run under node."
fi

echo
echo "=============================================================="
echo " 16/55 Aligned scans follow the survey (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/scan_reanchor_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### SCAN REANCHOR OK"*) ;;
        *) echo "Scan re-anchor test did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this places real image entities and" \
         "reads QCAD's own image mapping back, and cannot run under node."
fi

echo
echo "=============================================================="
echo " 17/55 Trimming a scanned page (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/scan_trim_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### SCAN TRIM OK"*) ;;
        *) echo "Scan trim tests did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found at $QCAD"
fi

echo
echo "=============================================================="
echo " 18/55 Rotating a scanned page on disk (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/scan_rotate_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### SCAN ROTATE OK"*) ;;
        *) echo "Scan rotate tests did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found at $QCAD"
fi

echo
echo "=============================================================="
echo " 19/55 A sketch placed through ONE station (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/scan_one_station_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### ONE STATION OK"*) ;;
        *) echo "One-station placement tests did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found at $QCAD"
fi

echo
echo "=============================================================="
echo " 20/55 The template pour (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/cave_template_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### CAVE TEMPLATE OK"*) ;;
        *) echo "Template pour test did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this pours the real template DXF" \
         "into a real document and cannot run under node."
fi

echo
echo "=============================================================="
echo " 21/55 Pitfall Cave audit (the fixture manifest, executed)"
echo "=============================================================="
if command -v node >/dev/null 2>&1; then
    node tests/pitfall_audit.js || status=1
else
    echo "SKIP: node not available -- this audit is pure ECMAScript and" \
         "does not need the engine, only an interpreter."
fi

echo
echo "=============================================================="
echo " 22/55 Plumbline Pit audit (the VERTICAL fixture, executed)"
echo "=============================================================="
if command -v node >/dev/null 2>&1; then
    node tests/plumbline_audit.js || status=1
else
    echo "SKIP: node not available -- this audit is pure ECMAScript and" \
         "does not need the engine, only an interpreter."
fi

echo
echo "=============================================================="
echo " 23/55 Plumbline Pit pipeline (every pass, over a vertical cave)"
echo "=============================================================="
if command -v node >/dev/null 2>&1; then
    node tests/plumbline_pipeline.js || status=1
else
    echo "SKIP: node not available -- this stage is pure ECMAScript and" \
         "does not need the engine, only an interpreter."
fi

echo
echo "=============================================================="
echo " 24/55 The 3D passage mesh, built from Pitfall Cave"
echo "=============================================================="
if command -v node >/dev/null 2>&1; then
    node tests/cave3d_mesh_run.js || status=1
else
    echo "SKIP: node not available -- CsMesh3d is pure ECMAScript and" \
         "needs only an interpreter, not the engine."
fi

echo
echo "=============================================================="
echo " 25/55 Cross sections read out of a drawing and placed in 3D"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/cave3d_sections_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### CAVE3D SECTIONS OK"*) ;;
        *) echo "Cross sections in 3D did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this builds a real block reference" \
         "in a real document and cannot run under node."
fi

echo
echo "=============================================================="
echo " 26/55 Sketch scans read out of a drawing and draped"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/cave3d_drape_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### CAVE3D DRAPE OK"*) ;;
        *) echo "Sketch scan drape did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this writes a real image into a real" \
         "cave folder and places it in a real document."
fi

echo
echo "=============================================================="
echo " 27/55 Scatter Breakdown picks its view by location (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/scatter_breakdown_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### SCATTER BREAKDOWN OK"*) ;;
        *) echo "Scatter Breakdown run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this drives the real tool against a" \
         "real RDocument with real band boxes, and cannot run under node."
fi

echo
echo "=============================================================="
echo " 28/55 Edit Trip retags a trip without forking it (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/edit_trip_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### EDIT TRIP OK"*) ;;
        *) echo "Edit Trip run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this retags a real drawing and reads" \
         "it back through CsRevise.surveyFromDocument, which needs the" \
         "real engine."
fi

echo
echo "=============================================================="
echo " 29/55 Incremental Notebook Draw matches a full redraw (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/notebook_partial_draw_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### PARTIAL DRAW OK"*) ;;
        *) echo "Incremental Notebook Draw did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this draws the same page into two" \
         "real drawings, one path each, and compares them."
fi

echo
echo "=============================================================="
echo " 30/55 Surface Data (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/surface_data_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### SURFACE DATA OK"*) ;;
        *) echo "Surface Data test did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this drives CsSurfaceData against a" \
         "real RDocument/RDocumentInterface and cannot run under node."
fi

echo
echo "=============================================================="
echo " 31/55 The geometry behind ScanAlign (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/test_align_math.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### ALIGN MATH OK"*) ;;
        *) echo "ScanAlign geometry tests did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- these fit real RVector geometry and" \
         "warp a real RImageEntity, and cannot run under node."
fi

echo
echo "=============================================================="
echo " 32/55 Symbol Palette: symbols survive a file, and land in the"
echo "       view they were dropped in (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/symbol_palette_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### SYMBOL PALETTE OK"*) ;;
        *) echo "Symbol Palette run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this writes a real DXF template and" \
         "reads its XDATA back, and cannot run under node."
fi

echo
echo "=============================================================="
echo " 33/55 Traced and shaped lines grow instead of piling up (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/feature_trace_extend.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### FEATURE TRACE EXTEND OK"*) ;;
        *) echo "Feature Trace extend run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this grows a real spline in place and" \
         "reads its XDATA back, and cannot run under node."
fi

echo
echo "=============================================================="
echo " 34/55 Traced linework says which trip drew it (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/trip_stamp_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### TRIP STAMP OK"*) ;;
        *) echo "Trip stamp run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this draws a real two-trip survey and" \
         "reads XDATA back off traced linework, and cannot run under node."
fi

echo
echo "=============================================================="
echo " 35/55 Check Map reads a real drawing (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/check_map_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### CHECK MAP OK"*) ;;
        *) echo "Check Map run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- the checks are unit-tested over" \
         "literal scans in js_unit.js; this stage proves the DOCUMENT" \
         "half and needs a real one."
fi

echo
echo "=============================================================="
echo " 36/55 Build Legend explains the lines too (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/build_legend_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### BUILD LEGEND OK"*) ;;
        *) echo "Build Legend run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- the row logic is unit-tested over" \
         "literal usage objects in js_unit.js; this stage proves the" \
         "scan and the drawn samples, and needs a real document."
fi

echo
echo "=============================================================="
echo " 38/55 Loop Errors draws the closure where it happened (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/loop_errors_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### LOOP ERRORS OK"*) ;;
        *) echo "Loop Errors run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- the exaggeration and the bands are" \
         "unit-tested in js_unit.js; this stage needs a real survey in a" \
         "real document."
fi

echo
echo "=============================================================="
echo " 39/55 One Complete mark, two panels (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/scan_marks_sync.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### SCAN MARKS OK"*) ;;
        *) echo "Scan marks sync did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this round-trips through the real" \
         "RSettings and cannot run under node."
fi

echo
echo "=============================================================="
echo " 40/55 The teaching cave hands out a sanitized copy (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/teaching_cave_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### TEACHING CAVE OK"*) ;;
        *) echo "Teaching Cave run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- the paths and the plans are" \
         "unit-tested in js_unit.js; this stage moves real files and" \
         "reads the sanitized drawing back off disk."
fi

echo
echo "=============================================================="
echo " 41/55 Area Fill builds and clears a fill in a real drawing (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/area_fill_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### AREA FILL OK"*) ;;
        *) echo "Area Fill run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this drives RHatchData and" \
         "RBlockReferenceEntity against a real RDocument and cannot" \
         "run under node."
fi

echo
echo "=============================================================="
echo " 42/55 Our own spline maths: a curve through the traced points (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/spline_fit_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### SPLINE FIT OK"*) ;;
        *) echo "Spline fit run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this builds real RSpline entities" \
         "and round-trips one through DXF, which is the assertion the" \
         "vanished-on-save failure would trip."
fi

echo
echo "=============================================================="
echo " 43/55 Wall Edging: stone glyphs outside the walls, on a switch (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/wall_edging_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### WALL EDGING OK"*) ;;
        *) echo "Wall Edging run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this drives the switch against a"
         "real survey, which is the only place the side rule is"
         "answered by actual stations."
fi

echo
echo "=============================================================="
echo " 44/55 A DXF value line longer than the read buffer (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/dxf_long_line_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### DXF LONG LINE OK"*) ;;
        *) echo "DXF long line run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this reads a drawing through the real" \
         "DXF importer, which is the only place the reader can lose step" \
         "on an over-long line."
fi

echo
echo "=============================================================="
echo " 45/55 Relinking a scan puts back the box, not the page (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/scan_relink_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### SCAN RELINK OK"*) ;;
        *) echo "Scan relink run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this cuts a real derivative with" \
         "QImage and relinks real image entities, which is the only" \
         "place the trim box can be dropped."
fi

echo
echo "=============================================================="
echo " 46/55 Trimming a scan to a traced outline (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/scan_outline_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### SCAN OUTLINE OK"*) ;;
        *) echo "Scan outline run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this masks a real QImage to a" \
         "concave outline and relinks it, which is the only place the" \
         "mask can come back as the whole box."
fi

echo
echo "=============================================================="
echo " 47/55 A Therion sketch becomes real map ink (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/sketch_import_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### SKETCH IMPORT OK"*) ;;
        *) echo "Sketch import run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- the parser, the mapping and the" \
         "placement are unit-tested in js_unit.js; this stage writes" \
         "real entities through CsSymbols.insert, CsShapeLine.dress and" \
         "CsArea.create and cannot run under node."
fi

echo
echo "=============================================================="
echo " 48/55 The cave slides onto its entrance (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/entrance_location_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### ENTRANCE LOCATION OK"*) ;;
        *) echo "Entrance location run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this places real block references" \
         "and translates a real document, which is the whole point:" \
         "the bug it guards moved block DEFINITIONS, and no headless" \
         "test has blocks to move."
fi

echo
echo "=============================================================="
echo " 49/55 The shelf's trip table edits the cave (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/shelf_edit_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### SHELF EDIT OK"*) ;;
        *) echo "Shelf edit run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- the routing and the one-cell" \
         "conversion are unit-tested in js_unit.js; this stage writes" \
         "tags into a real drawing and reads them back."
fi

echo
echo "=============================================================="
echo " 50/55 A caver's own column arrangement (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/column_arrange_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### COLUMN ARRANGE OK"*) ;;
        *) echo "Column arrange run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- the sanitising and the move" \
         "planning are unit-tested in js_unit.js; this stage drives a" \
         "REAL QTableWidget header and round-trips through RSettings."
fi

echo
echo "=============================================================="
echo " 51/55 One draggable box per chunk in Sheet Setup's preview"
echo "=============================================================="
if command -v node >/dev/null 2>&1; then
    node tests/sheet_setup_chunks.js || status=1
else
    echo "SKIP: node not available -- CsSheetSetup's drag/offset/preview" \
         "arithmetic is pure ECMAScript and needs only an interpreter."
fi

echo
echo "=============================================================="
echo " 52/55 Complex linetypes survive the DXF reader and writer"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/linetype_roundtrip_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### LINETYPE ROUNDTRIP OK"*) ;;
        *) echo "Linetype round trip did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found at $QCAD"
fi

echo
echo "=============================================================="
echo " 53/55 Linetype Maker's library and drawing store"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/linetype_maker_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### LINETYPE MAKER OK"*) ;;
        *) echo "Linetype Maker store did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found at $QCAD"
fi

echo
echo "=============================================================="
echo " 54/55 Therion input and equate follow a split project on disk"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/therion_input_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### THERION INPUT OK"*) ;;
        *) echo "Therion input run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found at $QCAD"
fi

echo
echo "=============================================================="
echo " 55/55 Symbols and notes follow a non-rigid revision (warp anchors)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/warp_anchors_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### WARP ANCHORS OK"*) ;;
        *) echo "Warp anchors run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found at $QCAD"
fi

echo
echo "=============================================================="
echo " 56/56 Viewport layouts survive a DXF round trip"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/viewport_layout_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### VIEWPORT LAYOUT OK"*) ;;
        *) echo "Viewport layout run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found at $QCAD"
fi

echo
echo "=============================================================="
echo " 57/57 Layouts API (create, list, rename, move, paper, undo)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/layouts_api_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### LAYOUTS API OK"*) ;;
        *) echo "Layouts API run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found at $QCAD"
fi

echo
echo "=============================================================="
echo " 58/58 Layout PDF plot (one file, mixed paper sizes)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/layout_plot_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### LAYOUT PLOT OK"*) ;;
        *) echo "Layout plot run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found at $QCAD"
fi

echo
echo "=============================================================="
echo " 59/59 Layout tabs load"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/layout_tabs_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### LAYOUT TABS LOAD OK"*) ;;
        *) echo "Layout tabs load run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found at $QCAD"
fi

echo
echo "=============================================================="
echo " 60/60 Sheets as layouts (CsLayoutGen: viewport, furniture, auto/manual, tiles)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/layout_gen_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### LAYOUT GEN OK"*) ;;
        *) echo "Layout gen run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found at $QCAD"
fi

echo
echo "=============================================================="
echo " 61/61 A plotted layout carries no raster (privacy)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/layout_raster_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### LAYOUT RASTER OK"*) ;;
        *) echo "Layout raster run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found at $QCAD"
fi

echo
echo "=============================================================="
echo " 62/62 Sheet Setup against layouts (model-only measuring, title text round trip)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/sheet_setup_layouts_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### SHEET SETUP LAYOUTS OK"*) ;;
        *) echo "Sheet setup layouts run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found at $QCAD"
fi

echo
echo "=============================================================="
echo " 63/63 A sheet's scale bar follows its viewport (listener logic, undo, reload)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/scale_bar_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### SCALE BAR OK"*) ;;
        *) echo "Scale bar run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found at $QCAD"
fi

echo
echo "=============================================================="
echo " 64/64 New Viewport (two corners -> a viewport that fits the cave)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/new_viewport_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### NEW VIEWPORT OK"*) ;;
        *) echo "New Viewport run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found at $QCAD"
fi

echo
echo "=============================================================="
echo " 65/65 Custom grips library and Rotate Viewport (registry, snaps, live turn, one undo step)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/custom_grips_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### CUSTOM GRIPS OK"*) ;;
        *) echo "Custom grips run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found at $QCAD"
fi

echo
echo "=============================================================="
echo " 66/66 North arrows follow their viewport's rotation (generated and placed)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/north_arrow_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### NORTH ARROW OK"*) ;;
        *) echo "North arrow run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found at $QCAD"
fi

echo
echo "=============================================================="
echo " 67/67 Polygon viewports and trimming (shape API, hit test, DXF round trip)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/viewport_shape_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### VIEWPORT SHAPE OK"*) ;;
        *) echo "Viewport shape run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found at $QCAD"
fi

echo
echo "=============================================================="
echo " 68/68 Layout templates (apply, capture, files, shapes)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/layout_template_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### LAYOUT TEMPLATE OK"*) ;;
        *) echo "Layout template run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found at $QCAD"
fi

echo
echo "=============================================================="
echo " 69/69 Add Border, Add Legend and the plot checks"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/layout_extras_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### LAYOUT EXTRAS OK"*) ;;
        *) echo "Layout extras run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found at $QCAD"
fi

echo
echo "=============================================================="
echo " 70/70 Moving a corner of a turned viewport leaves the map on the same pixels"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/viewport_vertex_render_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### VIEWPORT VERTEX RENDER OK"*) ;;
        *) echo "Viewport vertex render run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found at $QCAD"
fi

echo
echo "=============================================================="
echo " 71/71 Moving a corner of a rectangular viewport leaves the map on the same pixels"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/viewport_rect_vertex_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### VIEWPORT RECT VERTEX OK"*) ;;
        *) echo "Viewport rect vertex run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found at $QCAD"
fi

echo
echo "=============================================================="
echo " Theme engine (palettes, custom colour, application style sheet)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/theme_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### THEME OK"*) ;;
        *) echo "Theme run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found at $QCAD"
fi

echo
echo "=============================================================="
echo " Sheet settings tab (paper, margins, print colour)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/sheet_settings_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### SHEET SETTINGS OK"*) ;;
        *) echo "Sheet settings run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found at $QCAD"
fi

echo
echo "=============================================================="
echo " Sheet number = Layout tab name, both ways (renamed sheets keep their identity)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/sheet_names_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### SHEET NAMES OK"*) ;;
        *) echo "Sheet names run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found at $QCAD"
fi

echo
echo "=============================================================="
echo " Title block is one block with fields; linked fields follow the notebook"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/title_block_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### TITLE BLOCK OK"*) ;;
        *) echo "Title block run did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found at $QCAD"
fi

echo
if [ "$status" -eq 0 ]; then
    if [ "$engine" -eq 0 ]; then
        echo "STRUCTURAL TESTS PASSED -- the 43 engine suites were SKIPPED"
        echo "(CaveCAD not installed). This is NOT a full pass."
    elif [ -n "${CAVESURVEY_PUBLISH_CHECK:-}" ]; then
        echo "ALL TESTS PASSED -- including publish checks"
    else
        echo "ALL TESTS PASSED (publish checks not run; use --publish)"
    fi
else
    echo "FAILURES ABOVE"
fi
exit "$status"
