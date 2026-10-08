# Cross Sections in the 3D View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand every captured cross section on its own plane in the 3D view, offset clear of the passage, with a leader back to its station.

**Architecture:** A new pure Core module `CsSection3d` maps a section's block-local geometry into world space using `CsSectionCut`'s existing frame and the block's own XDATA. The C++ side gains one more flat-line buffer and a toggle — no new shader, no textures.

**Tech Stack:** CaveCAD's ECMAScript engine, existing `CsSectionCut` / `CsArea` / `CsCallout` Core modules, C++17 / Qt 6.11.

**User decisions (already made):**
- "Can you read the locations of the section blocks and use that to place section scans adjacent to the 3d cave?"
- Sections as geometry first, no textures — the traced block already holds real lines.
- Offset to the side, with a leader, mirroring the 2D callout.

Spec: `docs/superpowers/specs/2026-09-12-cave-3d-sections-design.md`

---

## Two things settled by research, not to be re-litigated

**`CsArea.vertsOf` is the flattener.** It already encodes the spline proxy trap: `getPointCloud()` on an RSpline delegates to a proxy plugin a `-no-gui -autostart` run never loads, so it measures EMPTY headlessly and returns real points in the GUI. A second flattener here produces sections that look right live and vanish from the test suite. Do not write one.

**`CsSectionCut.frameForLeg` is the frame.** It carries theta from leg to leg so sections do not spin, and reports `reseeded: true` when a run opens on a pitch. A second derivation would first disagree exactly at a pitch. Do not write one.

## File Structure

| File | Responsibility |
|---|---|
| `scripts/CaveSurvey/Core/CsSection3d.js` | create: pure mapping + side choice + leader; QCAD half reads blocks |
| `scripts/CaveSurvey/Core/CsAll.js` | modify: include it after CsSectionCut and CsArea |
| `scripts/CaveSurvey/Cave3D/Cave3D.js` | modify: build the sections buffer, pass it through |
| `tests/js_unit.js` | modify: CORE_FILES entry + pure tests |
| `tests/cave3d_sections_run.js` | create: real document, real captured section, real mapping |
| `src/gui/RCave3dView.{h,cpp}` | modify: a sections line buffer and its flag |
| `src/gui/RCave3dBridge.{h,cpp}` | modify: carry `sections`, expose `setShowSections` |
| `src/gui/RCave3dPanel.{h,cpp}` | modify: a "Sections" toggle |

**BUILD NOTE:** `RCave3dBridge.h` changes in Task 4, and `qcadjsapi` has its own ninja tree that includes it. Build BOTH or the two libraries disagree about the object's size — heap corruption surfacing as a malloc trap inside QJSEngine with a backtrace pointing at QtQml and nothing at the cause.

---

### Task 1: CsSection3d — the pure mapping

**Goal:** Turn block-local section geometry plus a frame, station, scale and offset into world-space segments and a leader.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsSection3d.js`
- Modify: `scripts/CaveSurvey/Core/CsAll.js`
- Test: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `CsSection3d.sideFor(blockPos, stationPos, frame)` returns `+r` or `-r`, whichever side the block sits on in plan
- [ ] Beyond `CsSection3d.FAR_FACTOR` passage widths it returns `+r` regardless
- [ ] `CsSection3d.place(polylines, opts)` maps block-local `{x,y}` to world `{x,y,z}`
- [ ] Scale is a DIVISION: scale 2 halves the section, scale 0.5 doubles it
- [ ] `CsSection3d.leaderFor(opts)` returns the two endpoints, section centre to station
- [ ] No NaN on any input above; a null frame returns empty rather than throwing
- [ ] `CsSection3d.js` is in `CORE_FILES` in `tests/js_unit.js`

**Verify:** engine suite → `### UNIT OK`

**Steps:**

- [ ] **Step 1: Add to CORE_FILES first**

In `tests/js_unit.js`, in `CORE_FILES`, immediately after the `CsMesh3d.js` entry:

```js
    "scripts/CaveSurvey/Core/CsSection3d.js",
```

This goes first because the harness loads Core by a hand-written list and a missing file passes silently through deliberate catches.

- [ ] **Step 2: Write the failing tests**

```js
// --- CsSection3d ------------------------------------------------------

var s3frame = { d: { x: 0, y: 1, z: 0 },      // passage heading north
                r: { x: 1, y: 0, z: 0 },      // right is east
                s: { x: 0, y: 0, z: 1 } };    // up is up
var s3station = { x: 100, y: 200, z: 50 };

// A block placed EAST of its station picks +r; west picks -r.
var sideE = CsSection3d.sideFor({ x: 130, y: 200 }, s3station, s3frame, 10);
nearly(sideE.x, 1, 1e-9, "a block east of its station hangs east");
var sideW = CsSection3d.sideFor({ x: 70, y: 200 }, s3station, s3frame, 10);
nearly(sideW.x, -1, 1e-9, "a block west of its station hangs west");

// Absurdly far away, the direction means nothing -- a bay, or a sheet.
var sideFar = CsSection3d.sideFor({ x: -9000, y: 200 }, s3station,
    s3frame, 10);
nearly(sideFar.x, 1, 1e-9,
    "a block parked far away falls back to +r rather than aiming at it");

// A unit square, scale 1, no offset: lands on the frame plane.
var square = [[{ x: -1, y: -1 }, { x: 1, y: -1 },
               { x: 1, y: 1 }, { x: -1, y: 1 }]];
var placed = CsSection3d.place(square, {
    station: s3station, frame: s3frame, scale: 1,
    side: { x: 1, y: 0, z: 0 }, offset: 0
});
eqs(String(placed.length), "1", "one polyline in, one out");
eqs(String(placed[0].length), "4", "four points in, four out");
nearly(placed[0][0].x, 99, 1e-9, "block -1 east of a station at 100 is 99");
nearly(placed[0][0].z, 49, 1e-9, "block -1 up from z 50 is 49");
nearly(placed[0][0].y, 200, 1e-9,
    "nothing moves along the passage: a section is a section");

// SCALE IS A DIVISION. This is the failure this design most expects.
var half = CsSection3d.place(square, {
    station: s3station, frame: s3frame, scale: 2,
    side: { x: 1, y: 0, z: 0 }, offset: 0
});
nearly(half[0][0].x, 99.5, 1e-9,
    "scale 2 means two drawing units per foot, so the section is HALF");
var dbl = CsSection3d.place(square, {
    station: s3station, frame: s3frame, scale: 0.5,
    side: { x: 1, y: 0, z: 0 }, offset: 0
});
nearly(dbl[0][0].x, 98, 1e-9, "scale 0.5 doubles it");

// The offset pushes it clear along the chosen side.
var off = CsSection3d.place(square, {
    station: s3station, frame: s3frame, scale: 1,
    side: { x: 1, y: 0, z: 0 }, offset: 20
});
nearly(off[0][0].x, 119, 1e-9, "offset 20 moves the whole section east");

// The leader runs from the section's centre home to the station.
var lead = CsSection3d.leaderFor({
    station: s3station, side: { x: 1, y: 0, z: 0 }, offset: 20
});
eqs(String(lead.length), "2", "a leader has two ends");
nearly(lead[1].x, 100, 1e-9, "the leader comes home to the station");
nearly(lead[0].x, 120, 1e-9, "and starts at the section");

// A degenerate frame refuses rather than producing NaN.
eqs(String(CsSection3d.place(square, {
    station: s3station, frame: null, scale: 1,
    side: { x: 1, y: 0, z: 0 }, offset: 0 }).length), "0",
    "no frame, no section -- and no exception either");
```

- [ ] **Step 3: Run, expect failure**

Run: `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/js_unit.js "$PWD"`
Expected: FAIL, `CsSection3d is not defined`.

- [ ] **Step 4: Write the pure half**

```js
// CsSection3d.js -- a captured cross section, standing in the 3D view.
//
// Part of the Cave Survey Core library. The half above the QCAD banner
// is PURE -- plain {x, y, z}, no RVector, no document -- and is the half
// worth testing. The half below reads block references out of a
// document and is QCAD-only, the same split CsBind and CsScanTrim use.
//
// WHAT A SECTION KNOWS ABOUT ITSELF. Its block reference carries the
// station it belongs to, the scale it was drawn at, and (for a sketched
// one) the scan it was traced from. And the block is BLOCK-LOCAL about
// the ghost's centre, which is where the centreline of the passage was
// -- so block-local (0,0) IS the station, and nothing has to be
// registered.
//
// THE FRAME IS NOT DERIVED HERE. CsSectionCut.frameForLeg already
// answers "which way is up and right at this station", and it carries
// theta from leg to leg so sections do not spin as you walk the
// passage. Deriving a second frame here would be a second answer to a
// settled question, and the first place the two would disagree is a
// pitch -- which is exactly where a spinning section is most obvious
// and least forgivable.
//
// WHY OFFSET AND NOT IN PLACE. A section drawn through the passage
// hides the passage. In 2D it is a callout parked to one side with a
// leader home, and that is a decision the caver already made by
// dragging it; this reads that decision back rather than making a new
// one.

include(includeBasePath + "/CsSectionCut.js");

var CsSection3d = {};

/** Beyond this many passage widths from its station, a block's
 *  direction says nothing about which side the caver meant -- it is
 *  parked in a bay, or laid out on a sheet. */
CsSection3d.FAR_FACTOR = 12;

/** How far clear of the passage wall a section stands, as a fraction of
 *  the passage width at that station. */
CsSection3d.CLEARANCE = 0.6;

/**
 * Which side of the passage a section hangs on, as a unit vector.
 *
 * The caver already chose: SectionCapture marches the block to a spot
 * near its station and the caver may then have dragged it, so the plan
 * vector from station to block carries the answer. Only its SIGN along
 * the frame's r axis is used -- a section stands square to the passage
 * whichever way the block drifted.
 *
 * \param width the passage width at that station, for the far test
 * \return {x,y,z} unit vector, +r or -r
 */
CsSection3d.sideFor = function(blockPos, stationPos, frame, width) {
    var r = frame.r;
    var dx = blockPos.x - stationPos.x;
    var dy = blockPos.y - stationPos.y;
    var far = Math.max(width, 1) * CsSection3d.FAR_FACTOR;
    if (Math.sqrt(dx * dx + dy * dy) > far) {
        return { x: r.x, y: r.y, z: r.z };
    }
    var along = dx * r.x + dy * r.y;
    if (along < 0) {
        return { x: -r.x, y: -r.y, z: -r.z };
    }
    return { x: r.x, y: r.y, z: r.z };
};

/**
 * Block-local polylines placed into the world.
 *
 * \param polylines [[{x,y}, ...], ...] block-local, origin at the
 *                  passage centreline
 * \param opts      {station, frame, scale, side, offset}
 *
 * SCALE IS DRAWING UNITS PER REAL UNIT, so it DIVIDES. A section drawn
 * at two units to the foot is half the size of its own numbers, not
 * twice; inverted, every section comes out microscopic or the size of
 * the cave.
 *
 * \return [[{x,y,z}, ...], ...], empty when there is no usable frame
 */
CsSection3d.place = function(polylines, opts) {
    var out = [];
    if (polylines === undefined || polylines === null) {
        return out;
    }
    var frame = opts.frame;
    if (frame === null || frame === undefined ||
            frame.r === undefined || frame.s === undefined) {
        return out;
    }
    var scale = opts.scale;
    if (typeof scale !== "number" || !isFinite(scale) ||
            Math.abs(scale) < 1e-9) {
        scale = 1;
    }
    var st = opts.station;
    var side = opts.side;
    var offset = (typeof opts.offset === "number" && isFinite(opts.offset))
        ? opts.offset : 0;

    var ox = st.x + side.x * offset;
    var oy = st.y + side.y * offset;
    var oz = st.z + side.z * offset;

    for (var i = 0; i < polylines.length; i++) {
        var line = polylines[i];
        var made = [];
        for (var j = 0; j < line.length; j++) {
            var u = line[j].x / scale;
            var v = line[j].y / scale;
            if (!isFinite(u) || !isFinite(v)) {
                continue;
            }
            made.push({
                x: ox + frame.r.x * u + frame.s.x * v,
                y: oy + frame.r.y * u + frame.s.y * v,
                z: oz + frame.r.z * u + frame.s.z * v
            });
        }
        if (made.length >= 2) {
            out.push(made);
        }
    }
    return out;
};

/** The leader: from where the section stands, home to its station. */
CsSection3d.leaderFor = function(opts) {
    var st = opts.station;
    var side = opts.side;
    var offset = (typeof opts.offset === "number" && isFinite(opts.offset))
        ? opts.offset : 0;
    return [
        { x: st.x + side.x * offset,
          y: st.y + side.y * offset,
          z: st.z + side.z * offset },
        { x: st.x, y: st.y, z: st.z }
    ];
};
```

Add to `CsAll.js`, after the `CsSectionCut.js` include:

```js
// A captured cross section, standing in the 3D view. After
// CsSectionCut, whose frame it reuses rather than deriving again.
include(includeBasePath + "/CsSection3d.js");
```

- [ ] **Step 5: Run, expect pass**

- [ ] **Step 6: Commit**

```bash
git add scripts/CaveSurvey/Core/CsSection3d.js scripts/CaveSurvey/Core/CsAll.js tests/js_unit.js
git commit -m "feat: where a cross section stands in three dimensions"
```

---

### Task 2: CsSection3d — reading the blocks out of a drawing

**Goal:** Find every section block reference, read its station, scale and geometry, and hand back what Task 1 needs.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsSection3d.js`
- Create: `tests/cave3d_sections_run.js`

**Acceptance Criteria:**
- [ ] `CsSection3d.readAll(doc)` returns `[{station, scale, blockPos, polylines}]`
- [ ] Only entities tagged `KIND_SECTION` + `ROLE_BLOCK` are returned
- [ ] Geometry comes through `CsArea.vertsOf` — no second flattener exists in this file
- [ ] A block whose station tag is empty is skipped, not guessed at
- [ ] The block reference's 2D ROTATION is ignored, and the code says why
- [ ] Never throws: an unreadable block yields no section

**Verify:** `CaveCAD -no-gui -autostart tests/cave3d_sections_run.js "$PWD"` → `### CAVE3D SECTIONS OK`

**Steps:**

- [ ] **Step 1: Write the document half**

Below a QCAD banner in `CsSection3d.js`:

```js
// =====================================================================
// QCAD context below this line. Everything above runs under node.
// =====================================================================

/**
 * Every captured section in a drawing.
 *
 * THE BLOCK REFERENCE'S 2D ROTATION IS IGNORED ON PURPOSE. It is a
 * sheet-layout choice -- which way the section was turned to fit beside
 * the plan -- and carries no information about the passage. In three
 * dimensions the section is squared to the passage by its frame, so
 * honouring the sheet rotation would tilt it off the passage for the
 * sake of a decision about paper.
 *
 * NEVER THROWS. A block this bridge cannot read yields no section, the
 * same discipline as CsBind.pointsOf: one unreadable block must not
 * take the whole 3D view down with it.
 *
 * \return [{station, scale, blockPos: {x,y}, polylines}]
 */
CsSection3d.readAll = function(doc) {
    var out = [];
    if (isNull(doc)) {
        return out;
    }
    var ids;
    try {
        ids = doc.queryAllEntities(false, true);
    } catch (e) {
        return out;
    }
    for (var i = 0; i < ids.length; i++) {
        var ref;
        try {
            ref = doc.queryEntity(ids[i]);
        } catch (eq) {
            continue;
        }
        if (isNull(ref)) { continue; }
        try {
            if (CsTags.get(ref, CsCallout.KEY.KIND) !==
                    CsCallout.KIND_SECTION) {
                continue;
            }
            if (CsTags.get(ref, CsCallout.KEY.ROLE) !==
                    CsCallout.ROLE_BLOCK) {
                continue;
            }
            var station = CsTags.get(ref, CsCallout.KEY.SECTION_STATION);
            if (typeof station !== "string" || station === "") {
                // A section that does not say which station it belongs
                // to cannot be placed, and guessing the nearest one
                // would put somebody's drawing somewhere they did not
                // draw it.
                continue;
            }
            var scale = parseFloat(
                CsTags.get(ref, CsCallout.KEY.SECTION_SCALE));
            if (!isFinite(scale) || Math.abs(scale) < 1e-9) {
                scale = 1;
            }
            var pos = ref.getPosition();
            var polylines = CsSection3d.blockGeometry(doc, ref);
            if (polylines.length === 0) { continue; }
            out.push({ station: station, scale: scale,
                       blockPos: { x: pos.x, y: pos.y },
                       polylines: polylines });
        } catch (eRead) {
            continue;
        }
    }
    return out;
};

/**
 * A block reference's own geometry, block-local, as polylines.
 *
 * THROUGH CsArea.vertsOf, WHICH IS NOT AN ARBITRARY CHOICE. That
 * function already encodes the spline proxy trap: getPointCloud() on an
 * RSpline delegates to a proxy plugin a `-no-gui -autostart` run never
 * loads, so it measures EMPTY headlessly while returning real points in
 * the GUI. A flattener written fresh here would give sections that
 * looked right live and vanished from the test suite.
 */
CsSection3d.blockGeometry = function(doc, ref) {
    var out = [];
    var blockId;
    try {
        blockId = ref.getReferencedBlockId();
    } catch (e) {
        return out;
    }
    if (isNull(blockId) || blockId === RBlock.INVALID_ID) {
        return out;
    }
    var ids;
    try {
        ids = doc.queryBlockEntities(blockId);
    } catch (eq) {
        return out;
    }
    for (var i = 0; i < ids.length; i++) {
        try {
            var e = doc.queryEntity(ids[i]);
            if (isNull(e)) { continue; }
            var verts = CsArea.vertsOf(e);
            if (verts.length >= 2) {
                out.push(verts);
            }
        } catch (eEnt) {
            continue;
        }
    }
    return out;
};
```

Add `include(includeBasePath + "/CsArea.js");` and `include(includeBasePath + "/CsTags.js");` and `include(includeBasePath + "/CsCallout.js");` at the top of `CsSection3d.js` if not already pulled in by CsAll's ordering — check `CsAll.js` first and only add what is missing.

- [ ] **Step 2: Write the document test**

Create `tests/cave3d_sections_run.js`. Copy the preamble of `tests/section_sketch_run.js` verbatim — its `loadRepoScript`, its Core auto-loading regex at line 105, its `check`/`checkClose`, its `putStation`, and its `sketchOne(station, label)` helper. Then:

```js
// Build a cave, sketch a section on B2, and place it in 3D.
buildSurvey();                       // as section_sketch_run.js does
sketchOne("B2", "X1");

var found = CsSection3d.readAll(doc);
check("one captured section is found", found.length === 1);
check("it names its station", found[0].station === "B2");
check("it has geometry", found[0].polylines.length > 0);
check("its scale is a real number", isFinite(found[0].scale) &&
    found[0].scale > 0);

var survey = CsRevise.surveyFromDocument(doc).survey;
var resolved = CsNetwork.resolve(survey);
var leg = CsSectionCut.nearestLeg(resolved,
    resolved.stations[found[0].station], 1e9);
check("the section's station sits on a leg", leg !== null);

var frame = CsSectionCut.frameForLeg(resolved, leg.from, leg.to);
check("that leg yields a frame", frame !== null && frame.frame !== null);

var side = CsSection3d.sideFor(found[0].blockPos,
    resolved.stations[found[0].station], frame.frame, 10);
var placed = CsSection3d.place(found[0].polylines, {
    station: resolved.stations[found[0].station],
    frame: frame.frame, scale: found[0].scale,
    side: side, offset: 15
});
check("the section places into the world", placed.length > 0);

var bad = 0;
for (var pi = 0; pi < placed.length; pi++) {
    for (var pj = 0; pj < placed[pi].length; pj++) {
        var p = placed[pi][pj];
        if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z)) { bad++; }
    }
}
check("no NaN in the placed section", bad === 0);

// THE SPLINE TRAP, ASSERTED. This test runs headless, which is exactly
// where a fresh flattener would have returned nothing.
var pts = 0;
for (var qi = 0; qi < found[0].polylines.length; qi++) {
    pts += found[0].polylines[qi].length;
}
check("the traced geometry came back with real points (" + pts + ")",
    pts >= 4);
```

End with the same OK/FAIL reporting shape as `section_sketch_run.js`, printing `### CAVE3D SECTIONS OK <n>`.

- [ ] **Step 3: Run it**

Run: `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/cave3d_sections_run.js "$PWD"`
Expected: `### CAVE3D SECTIONS OK`

- [ ] **Step 4: Add it to run_all.sh**

Insert a stage after the Cave3D mesh stage, renumbering the stages after it and the `/N` total, exactly as the 3D mesh stage was inserted:

```bash
echo
echo "=============================================================="
echo " 22/37 Cross sections placed into the 3D view"
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
    echo "SKIP: CaveCAD not found -- this places a real captured section" \
         "into a real document and cannot run under node."
fi
```

- [ ] **Step 5: Commit**

```bash
git add scripts/CaveSurvey/Core/CsSection3d.js tests/cave3d_sections_run.js tests/run_all.sh
git commit -m "feat: read every captured section out of a drawing"
```

---

### Task 3: Cave3D builds the sections buffer

**Goal:** Turn the read sections into a line buffer the view can draw.

**Files:**
- Modify: `scripts/CaveSurvey/Cave3D/Cave3D.js`

**Acceptance Criteria:**
- [ ] `Cave3D.sectionsBuffer(doc, survey, resolved)` returns `{positions, colors, indices}`
- [ ] Each section contributes its own polylines plus one leader
- [ ] The offset is the station's ring radius times `CsSection3d.CLEARANCE`, plus the section's own half-width
- [ ] Sections are coloured one fixed colour, NOT by the active colour mode
- [ ] A drawing with no sections yields an empty buffer and no error
- [ ] The buffer is passed to `cave3d.setMesh` as `sections`

**Verify:** `python3 -m unittest tests.test_addon` → OK, then live

**Steps:**

- [ ] **Step 1: Build the buffer**

In `Cave3D.js`:

```js
/** The colour every section is drawn in.
 *
 *  ONE COLOUR, AND NOT THE ACTIVE COLOUR MODE. A section is annotation
 *  -- somebody's drawing of a place -- not another way of reading the
 *  survey. Colouring it by depth or by trip would say something about
 *  it that is not true. */
Cave3D.SECTION_COLOR = [0.95, 0.80, 0.45];

/** Dimmer, so the leader reads as a tether and not as passage. */
Cave3D.LEADER_COLOR = [0.55, 0.47, 0.28];

/**
 * Every captured section, placed into the world as line segments.
 *
 * \return {positions, colors, indices}
 */
Cave3D.sectionsBuffer = function(doc, survey, resolved) {
    var buf = { positions: [], colors: [], indices: [] };
    var found;
    try {
        found = CsSection3d.readAll(doc);
    } catch (e) {
        return buf;
    }
    if (found.length === 0) {
        return buf;
    }

    var splays = CsLrud.splaysByStation(survey);
    var legsByStation = {};
    var note = function(name, leg) {
        if (!legsByStation.hasOwnProperty(name)) { legsByStation[name] = []; }
        legsByStation[name].push(leg);
    };
    var li;
    for (li = 0; li < resolved.legs.length; li++) {
        note(resolved.legs[li].from, resolved.legs[li]);
        note(resolved.legs[li].to, resolved.legs[li]);
    }

    var push = function(a, b, col) {
        var base = buf.positions.length / 3;
        buf.positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
        buf.colors.push(col[0], col[1], col[2], col[0], col[1], col[2]);
        buf.indices.push(base, base + 1);
    };

    for (var i = 0; i < found.length; i++) {
        var sec = found[i];
        var st = resolved.stations[sec.station];
        if (st === undefined || typeof st.z !== "number") {
            continue;
        }
        var leg = CsSectionCut.nearestLeg(resolved, st, 1e9);
        if (leg === null) { continue; }
        var got = CsSectionCut.frameForLeg(resolved, leg.from, leg.to);
        if (got === null || got.frame === null) { continue; }
        var frame = got.frame;

        // The passage's own size at that station, so the section clears
        // the passage it belongs to rather than a guess at its width.
        var dir = CsMesh3d.directionAt(sec.station, legsByStation, resolved);
        var width = 0;
        if (dir !== null) {
            var ring = CsMesh3d.ringAt(st, dir,
                CsMesh3d.lrudAt(sec.station, survey),
                splays[sec.station] || [], CsTraverse.SLOPE);
            for (var ri = 0; ri < ring.length; ri++) {
                var d = CsMesh3d.norm(CsMesh3d.sub(ring[ri], st));
                if (d > width) { width = d; }
            }
        }
        if (!(width > 0)) { width = 5; }

        // Plus the section's own reach, or it would straddle the
        // passage it was meant to stand clear of.
        var reach = 0;
        for (var pi = 0; pi < sec.polylines.length; pi++) {
            for (var pj = 0; pj < sec.polylines[pi].length; pj++) {
                var q = sec.polylines[pi][pj];
                var rr = Math.sqrt(q.x * q.x + q.y * q.y) / sec.scale;
                if (rr > reach) { reach = rr; }
            }
        }

        var side = CsSection3d.sideFor(sec.blockPos, st, frame, width);
        var offset = width * (1 + CsSection3d.CLEARANCE) + reach;

        var placed = CsSection3d.place(sec.polylines, {
            station: st, frame: frame, scale: sec.scale,
            side: side, offset: offset
        });
        for (var k = 0; k < placed.length; k++) {
            for (var m = 0; m + 1 < placed[k].length; m++) {
                push(placed[k][m], placed[k][m + 1], Cave3D.SECTION_COLOR);
            }
        }

        var lead = CsSection3d.leaderFor({ station: st, side: side,
            offset: offset });
        push(lead[0], lead[1], Cave3D.LEADER_COLOR);
    }
    return buf;
};
```

- [ ] **Step 2: Pass it through**

In `Cave3D.refresh`, after `mesh` is built:

```js
    mesh.sections = Cave3D.sectionsBuffer(getDocument(), read.survey,
        read.resolved);
```

The mesh object is handed to `cave3d.setMesh` unchanged, so attaching the buffer here is all that is needed on this side.

- [ ] **Step 3: Test and commit**

```bash
python3 -m unittest tests.test_addon
git add scripts/CaveSurvey/Cave3D/Cave3D.js
git commit -m "feat: every section, placed and tethered"
```

---

### Task 4: The view draws them, the panel toggles them

**Goal:** A sections line buffer in the renderer and a toggle in the panel.

**Files:**
- Modify: `src/gui/RCave3dView.{h,cpp}`, `src/gui/RCave3dBridge.{h,cpp}`, `src/gui/RCave3dPanel.{h,cpp}`

**Acceptance Criteria:**
- [ ] `RCave3dView::setSections(positions, colors)` and `setShowSections(bool)`
- [ ] Drawn through the existing `drawFlatLines`, NOT clamped by animation progress
- [ ] `cave3d.setShowSections(handle, on)` works from script
- [ ] A "Sections" toggle sits on the panel's second row, off by default
- [ ] The toggle greys itself when the mesh carried no sections
- [ ] BOTH ninja trees build clean

**Verify:** `ninja -j20` in `cavecad-src` AND in `qcadjsapi`, both clean

**Steps:**

- [ ] **Step 1: View**

Add `sectionPositions` / `sectionColors` / `showSections` members mirroring the ghost exactly, a `setSections` mirroring `setGhost`, and in `paintGL` after the leads line:

```cpp
    drawFlatLines(mvp, sectionPositions, sectionColors, showSections);
```

NOT clamped by progress: a section is a fact about the finished cave, like a lead, not part of the survey being walked.

Clear them in `clearGeometry` alongside the others.

- [ ] **Step 2: Bridge**

In `setMesh`, mirroring the ghost block:

```cpp
    QVariantMap sections = mesh.value("sections").toMap();
    QVector<float> sectionPos = toFloats(sections.value("positions"));
    view->setSections(sectionPos, toFloats(sections.value("colors")));
    p->setSectionsAvailable(!sectionPos.isEmpty());
```

Plus `Q_INVOKABLE void setShowSections(int handle, bool on)` forwarding to the panel, exactly as `setShowLeads` does.

- [ ] **Step 3: Panel**

A `sectionsAction` on `row2` beside Leads, checkable, unchecked by default, with `setSectionsAvailable(bool)` mirroring `setGhostAvailable`:

```cpp
    sectionsAction = row2->addAction(tr("Sections"));
    sectionsAction->setCheckable(true);
    sectionsAction->setStatusTip(tr("Stand every captured cross section "
                                    "beside the passage it was drawn of"));
    connect(sectionsAction, &QAction::toggled, [this](bool on) {
        view->setShowSections(on);
        emit overlayToggled(QString("sections"), on);
    });
```

- [ ] **Step 4: Build BOTH trees**

```bash
cd ~/Documents/github/cavecad-src && ninja -j20
cd ~/Documents/github/qcadjsapi && ninja -j20
```

`RCave3dBridge.h` changed, so the second is mandatory.

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/github/cavecad-src
git add src/gui/
git commit -m "feat: sections stand beside the cave, on a switch"
```

---

### Task 5: Wire the toggle's memory, verify live, release

**Goal:** The Sections toggle persists, and the whole thing works on a drawing with real sections.

**Files:**
- Modify: `scripts/CaveSurvey/Cave3D/Cave3D.js`, `README.md`, `VERSION`, `cavecad-src/VERSION`
- Modify: `docs/superpowers/specs/2026-09-12-cave-3d-sections-design.md` (As-built)

**Acceptance Criteria:**
- [ ] `Cave3D.SETTING_SECTIONS` persists the toggle through `RSettings`
- [ ] `bash tests/run_all.sh` → `ALL TESTS PASSED`
- [ ] On a drawing with captured sections, each stands at its own station
- [ ] Each sits on the side the caver placed it on in 2D
- [ ] A section on a PITCH does not spin relative to its neighbours
- [ ] The leader reaches its station
- [ ] Versions bumped: tools `0.9.122.0`, src `0.5.0.0`

**Verify:** `bash tests/run_all.sh`, then the live walkthrough

**Steps:**

- [ ] **Step 1: Persist the toggle**

Add `Cave3D.SETTING_SECTIONS = "Cave3D/ShowSections";`, restore it in `cave3dRun` beside the leads restore, and extend the `overlayToggled` handler's key mapping:

```js
        cave3d.overlayToggled.connect(function(handle, which, on) {
            if (handle !== Cave3D.handle) { return; }
            var key = Cave3D.SETTING_LEADS;
            if (which === "ghost") { key = Cave3D.SETTING_GHOST; }
            else if (which === "sections") { key = Cave3D.SETTING_SECTIONS; }
            RSettings.setValue(key, on);
        });
```

- [ ] **Step 2: Make a drawing that has sections**

Truitt Cave has none. Open Pitfall Cave, use Cross Section to capture two sections — one on a horizontal run, one on the pitch — and save it as a scratch copy. The pitch one is the case that matters: it is where a re-derived frame would spin and `CsSectionCut`'s carried one will not.

- [ ] **Step 3: Run everything**

```bash
cd ~/Documents/github/cavecad-tools && bash tests/run_all.sh
```
Expected: `ALL TESTS PASSED`.

- [ ] **Step 4: Walk the live list**

Quit CaveCAD completely first — a quit blocked by unsaved changes leaves the old add-on running and the walkthrough is then against stale code. Then check every acceptance criterion above.

- [ ] **Step 5: Record and release**

Append an As-built section to the spec, add the Sections overlay to the README's 3D View row, bump both VERSION files, and:

```bash
git add -A
git commit -m "release: 0.9.122.0 -- sections stand beside the cave"
```
