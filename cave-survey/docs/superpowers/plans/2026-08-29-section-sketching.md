# Cross Section Sketching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a scanned field-book cross section into a placed, leadered section block — traced by hand in a staging bay inside the drawing, captured to a `CS_<CalloutId>` block, and marched out clear of the plan's walls.

**Architecture:** A locked, named rectangle on `CTRL-SECTION-BOX` (the bay) holds the scan and the computed LRUD outline as a ruler. The caver traces with the suite's existing draw tools. Capture sweeps everything geometrically inside the frame into a block definition, wires it to a plan station through the existing `CalloutWrite.createSection` path, and places it by marching a ray outward until clear. `SectionSource=sketch` on the reference is a hard gate that keeps `refreshSections` from ever regenerating over hand tracing. All bay geometry and placement maths live in a new pure Core file, `CsSectionBay.js`, node-testable under `tests/js_unit.js`.

**Tech Stack:** QCAD/CaveCAD ECMAScript add-on (ES5, Community API only), `RAddObjectsOperation`/`RBlockReferenceEntity`, `CsSectionCut`/`CsSectionDraw`/`CalloutWrite`, `tests/js_unit.js` (node + real engine), `tests/run_all.sh` (real engine, `/Applications/CaveCAD.app`).

**User decisions (already made):**
- Sketch in a staging bay inside the drawing, not a custom canvas widget and not a scratch document — "that all looks great".
- The bay is pre-loaded with the computed LRUD section as a dashed ghost; the caver scales the scan onto it. Ghost never reaches the block.
- Capture takes everything geometrically inside the bay frame, minus the scan, the ghost and the frame.
- Placement is auto-proposed by marching outward past the walls, shown as a live preview; Enter accepts, a click relocates.
- A sketched section is never auto-regenerated, and is revised by reopening the bay.
- The Go button is a third action on the Sketch Scans shelf, not a second panel.
- The frame selector becomes a three-way combo (Plan / Profile / Cross Section).

**Spec:** `docs/superpowers/specs/2026-08-29-section-sketching-design.md`

**Version target:** 0.9.38.0 (patch-series hold — no public release without Nathan's approval).

---

## Context an engineer needs before Task 1

Read these before touching anything. Each one has already cost this suite a shipped defect.

- **`CsAll.js` is the only place a Core file is registered.** `tests/js_unit.js` loads Core files individually, so a file missing from `CsAll.js` passes every unit test and is `undefined` at runtime in every tool. `tests/test_addon.py::TestBasenameCollisions::test_every_core_file_is_included_by_csall` is the only guard. Every Core file must be `Cs`-prefixed (QCAD's `include()` dedupes by basename).
- **OFF layers silently refuse adds, modifies AND deletes.** No error, no exception. Wrap writes to `CTRL-*` layers in `CsLayers.withLayerOn(doc, di, name, fn)`.
- **Bounding boxes are cached, and a modify does not invalidate them** — not even across a fresh `doc.queryEntity()`. Call `entity.update()` before reading a box you expect to have changed.
- **Never call `RGuiAction.trigger()` from inside a widget event or an action lifecycle event.** It is a hard SIGSEGV. The shelf hands off through `SketchScans.alignSoon()`'s zero-delay `QTimer`.
- **`di.setSnap()` takes ownership** — saving and restoring a snap object is a use-after-free. Record the snap's class name (`String(snap)` is e.g. `"RSnapGrid [JS]"`) and rebuild from a name→constructor table.
- **`queryAllEntities` is not insertion-ordered.** Diff the id set; never take the last id.
- **Fit-point splines are Pro-only and fail silently** — `isValid()` still returns true, and the entity writes no DXF record. Nothing in this plan builds one.
- **`CsTags.set` cannot clear a tag** (it returns early on `""`). Use `CsTags.remove`.
- **Never hold a `doc` across an event that can close it.** Re-resolve via `EAction.getDocument()`.

Run the suite at any point with:

```bash
cd ~/Documents/github/cavecad-tools && ./tests/run_all.sh
```

Fast inner loop while working on pure Core:

```bash
cd ~/Documents/github/cavecad-tools && node tests/js_unit.js
```

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/CaveSurvey/Core/CsSectionBay.js` | **Create.** Pure: bay rectangle placement, containment/sweep, scan-over-ghost fit transform and its tag serialization, outward-march placement search, perpendicular/clearer-side maths. No `R*`/`Q*`. |
| `scripts/CaveSurvey/Core/CsAll.js` | **Modify.** Register `CsSectionBay.js`. |
| `scripts/CaveSurvey/Core/CsScanFrame.js` | **Modify.** Add `stationFrameFor(kind)` — the frame whose station points a scan of this kind is picked against. Section → `plan`. |
| `scripts/CaveSurvey/Core/CsCallout.js` | **Modify.** Four new `KEY` entries for the sketch tags. |
| `scripts/CaveSurvey/SketchScans/SketchScans.js` | **Modify.** Checkbox → three-way combo; third action button; station list via `stationFrameFor`. |
| `scripts/CaveSurvey/SketchSection/SketchSection.js` | **Create.** Opens the bay: station prompt, frame, scan, ghost, zoom, free snap. |
| `scripts/CaveSurvey/SketchSection/SectionCapture.js` | **Create.** Sweep → block → leader → march → preview → teardown. |
| `scripts/CaveSurvey/SketchSection/SectionEdit.js` | **Create.** Reopen the bay from a placed sketched section. |
| `scripts/CaveSurvey/SketchSection/*.svg` | **Create.** Three toolbar icons. |
| `scripts/CaveSurvey/Callout/CalloutWrite.js` | **Modify.** `refreshSections` skips and counts `SectionSource=sketch`. |
| `tests/js_unit.js` | **Modify.** `CsSectionBay` and `stationFrameFor` unit tests. |
| `tests/section_sketch_run.js` | **Create.** Real-engine lifecycle test. |
| `tests/run_all.sh` | **Modify.** Wire in the new engine test. |
| `VERSION` | **Modify.** 0.9.38.0. |

---

### Task 1: CsSectionBay — the pure maths

**Goal:** Every geometric decision the bay makes — where it parks, what is inside it, how the scan sits over the ghost, where the finished block lands — exists as a pure, node-tested function before any of it touches a document.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsSectionBay.js`
- Modify: `scripts/CaveSurvey/Core/CsAll.js`
- Test: `tests/js_unit.js` (append a `CsSectionBay` section), and add the file to the `CORE` list near line 112

**Acceptance Criteria:**
- [ ] `CsSectionBay.js` contains no `R*` or `Q*` symbol and runs under node
- [ ] `frameRectFor` parks the bay clear of the plan extents, and honours a remembered position when given one
- [ ] `contains` is true only when a box lies wholly inside the rect; a box crossing the edge is out
- [ ] `sweepOf` returns the ids inside the rect, minus excluded ids, in input order
- [ ] `serializeFit`/`parseFit` round-trip, and `parseFit` returns `null` on junk rather than throwing
- [ ] `marchOut` returns the first clear point, `null` when the cap is reached
- [ ] `clearerSide` returns `+1` or `-1` by obstacle count, `+1` on a tie
- [ ] `CsSectionBay.js` appears in `CsAll.js`

**Verify:** `node tests/js_unit.js` → `### UNIT OK <n> assertions`, and `python3 -m unittest tests.test_addon -v` → `test_every_core_file_is_included_by_csall` passes

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `tests/js_unit.js`, immediately after the `CsScanFrame` section (which ends near line 10385):

```javascript
// ---------------------------------------------------------------------
// CsSectionBay -- where the bay goes, what is inside it, and where the
// finished section lands.
// ---------------------------------------------------------------------

(function() {
    // --- where the bay parks ------------------------------------------
    var plan = { x1: 0, y1: 0, x2: 100, y2: 60 };
    var bay = CsSectionBay.frameRectFor(plan, { w: 40, h: 40 }, null);
    ok(bay.x1 >= plan.x2 || bay.x2 <= plan.x1 ||
       bay.y1 >= plan.y2 || bay.y2 <= plan.y1,
        "frameRectFor: the bay does not overlap the plan");
    eqs(bay.x2 - bay.x1, 40, "frameRectFor: the bay is the size asked for");
    eqs(bay.y2 - bay.y1, 40, "frameRectFor: in both directions");

    var remembered = CsSectionBay.frameRectFor(plan, { w: 40, h: 40 },
        { x: -500, y: -500 });
    eqs(remembered.x1, -500, "frameRectFor: a remembered corner wins");
    eqs(remembered.y1, -500, "frameRectFor: in both directions");

    // AN EMPTY DRAWING HAS NO EXTENT. Parking relative to nothing must
    // not produce NaN -- that lands the bay at an unreachable point and
    // the caver sees an empty screen with no error.
    var virgin = CsSectionBay.frameRectFor(null, { w: 40, h: 40 }, null);
    ok(!isNaN(virgin.x1) && !isNaN(virgin.y1),
        "frameRectFor: an empty drawing still gets a real rectangle");

    // --- what is inside it --------------------------------------------
    var rect = { x1: 0, y1: 0, x2: 10, y2: 10 };
    ok(CsSectionBay.contains(rect, { x1: 1, y1: 1, x2: 9, y2: 9 }),
        "contains: wholly inside");
    ok(!CsSectionBay.contains(rect, { x1: -1, y1: 1, x2: 9, y2: 9 }),
        "contains: crossing the edge is OUT, never half-captured");
    ok(!CsSectionBay.contains(rect, { x1: 20, y1: 20, x2: 30, y2: 30 }),
        "contains: wholly outside");
    ok(CsSectionBay.contains(rect, { x1: 0, y1: 0, x2: 10, y2: 10 }),
        "contains: flush with the frame counts as in");

    var items = [
        { id: 1, box: { x1: 1, y1: 1, x2: 2, y2: 2 } },   // in
        { id: 2, box: { x1: 3, y1: 3, x2: 4, y2: 4 } },   // in, excluded
        { id: 3, box: { x1: 50, y1: 50, x2: 51, y2: 51 } } // out
    ];
    var swept = CsSectionBay.sweepOf(items, rect, [2]);
    eqs(swept.length, 1, "sweepOf: one entity survives");
    eqs(swept[0], 1, "sweepOf: and it is the un-excluded inside one");

    // --- the scan over the ghost --------------------------------------
    var fit = CsSectionBay.fitTransform(
        { x1: 0, y1: 0, x2: 200, y2: 100 },   // the scan as inserted
        { x1: -5, y1: -5, x2: 5, y2: 5 });    // the ghost
    near(fit.sx, 0.05, 1e-9, "fitTransform: uniform scale to the ghost width");
    eqs(fit.sx, fit.sy, "fitTransform: uniform -- never squashed");
    near(fit.tx, -5, 1e-9, "fitTransform: and centred on the ghost");

    var text = CsSectionBay.serializeFit(fit);
    var back = CsSectionBay.parseFit(text);
    near(back.sx, fit.sx, 1e-9, "parseFit: round trips the scale");
    near(back.tx, fit.tx, 1e-9, "parseFit: and the offset");
    ok(CsSectionBay.parseFit("nonsense") === null,
        "parseFit: junk is null, never a throw");
    ok(CsSectionBay.parseFit("") === null,
        "parseFit: and so is nothing at all");
    ok(text.length < 200,
        "serializeFit: stays far under the dxflib per-line limit");

    // --- where the block lands ----------------------------------------
    // A wall dead ahead: the march must step PAST it, not stop short.
    var blockBox = { x1: -2, y1: -2, x2: 2, y2: 2 };
    var walls = [{ x1: 5, y1: -20, x2: 6, y2: 20 }];
    var spot = CsSectionBay.marchOut({ x: 0, y: 0 }, { x: 1, y: 0 },
        blockBox, walls, 1, 100);
    ok(spot !== null, "marchOut: finds a spot past the wall");
    ok(spot.x - 2 > 6 + 1,
        "marchOut: clear of the wall by at least the margin");

    var boxedIn = CsSectionBay.marchOut({ x: 0, y: 0 }, { x: 1, y: 0 },
        blockBox, [{ x1: -1000, y1: -1000, x2: 1000, y2: 1000 }], 1, 20);
    ok(boxedIn === null,
        "marchOut: nowhere clear inside the cap is null, not a wild guess");

    // --- which way is out ---------------------------------------------
    var perp = CsSectionBay.perpOf({ x: 1, y: 0 });
    near(Math.abs(perp.y), 1, 1e-9, "perpOf: perpendicular to the leg");
    near(perp.x, 0, 1e-9, "perpOf: and unit length");

    eqs(CsSectionBay.clearerSide({ x: 0, y: 0 }, { x: 0, y: 1 },
        [{ x1: -5, y1: 1, x2: 5, y2: 5 }], 20), -1,
        "clearerSide: away from the crowded side");
    eqs(CsSectionBay.clearerSide({ x: 0, y: 0 }, { x: 0, y: 1 }, [], 20), 1,
        "clearerSide: a tie goes positive, so the answer is stable");
}());
```

Add the file to the `CORE` load list in `tests/js_unit.js` (the list beginning near line 112), after `"scripts/CaveSurvey/Core/CsSectionDraw.js"`:

```javascript
    "scripts/CaveSurvey/Core/CsSectionBay.js",
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tests/js_unit.js`
Expected: FAIL — `cannot open .../CsSectionBay.js` (the loader throws before any assertion runs)

- [ ] **Step 3: Write `Core/CsSectionBay.js`**

```javascript
// CsSectionBay.js -- the staging bay a cross section is sketched in.
//
// Part of the Cave Survey Core library. PURE: plain {x, y} and
// {x1, y1, x2, y2} objects, no RVector, no document, no widget. Every
// function here is node-testable, which is the whole reason the bay's
// decisions live in this file rather than in the tool that draws them.
//
// WHAT A BAY IS. A rectangle parked clear of the plan, holding a
// scanned field-book section and the computed LRUD outline for the same
// station. The caver scales the scan onto that outline and traces. What
// ends up INSIDE the rectangle becomes the block; the scan, the outline
// and the rectangle itself do not.
//
// WHY CONTAINMENT AND NOT LAYERS. A stray line left on a section layer
// by the previous sketch would join the next block silently. A frame is
// visible: what is in and what is out can be seen before committing.
// Flush with the frame counts as IN -- a caver who traces right up to
// the edge meant to.

var CsSectionBay = {};

/** How far the bay sits from the drawing's own extent. */
CsSectionBay.GAP = 20;

/** How far the block must clear an obstacle when it is placed. */
CsSectionBay.MARGIN = 4;

/** March step, in drawing units, and how many steps before giving up.
 *  The cap matters: an unbounded march past a boxed-in station would
 *  fling the section somewhere the caver will never scroll to. */
CsSectionBay.STEP = 2;
CsSectionBay.CAP = 400;

/**
 * Where the bay goes.
 *
 * Right of the drawing's extent by GAP, bottom-aligned with it, unless
 * the caver has moved the bay before -- then it goes back where they
 * put it. A drawing with no extent yet (a fresh template) parks at the
 * origin rather than at NaN.
 *
 * \param planBox {x1,y1,x2,y2} of the drawing, or null
 * \param size {w, h}
 * \param remembered {x, y} lower-left corner, or null
 * \return {x1, y1, x2, y2}. Pure.
 */
CsSectionBay.frameRectFor = function(planBox, size, remembered) {
    var w = (size && size.w > 0) ? size.w : 40;
    var h = (size && size.h > 0) ? size.h : 40;
    if (remembered !== null && remembered !== undefined &&
            !isNaN(remembered.x) && !isNaN(remembered.y)) {
        return { x1: remembered.x, y1: remembered.y,
                 x2: remembered.x + w, y2: remembered.y + h };
    }
    if (planBox === null || planBox === undefined ||
            isNaN(planBox.x2) || isNaN(planBox.y1)) {
        return { x1: 0, y1: 0, x2: w, y2: h };
    }
    var x1 = planBox.x2 + CsSectionBay.GAP;
    var y1 = planBox.y1;
    return { x1: x1, y1: y1, x2: x1 + w, y2: y1 + h };
};

/** Is a box wholly inside a rect? Flush counts as inside. Pure. */
CsSectionBay.contains = function(rect, box) {
    if (rect === null || rect === undefined ||
            box === null || box === undefined) {
        return false;
    }
    return box.x1 >= rect.x1 && box.x2 <= rect.x2 &&
           box.y1 >= rect.y1 && box.y2 <= rect.y2;
};

/**
 * The capture set: the ids of every item wholly inside the rect, minus
 * the excluded ones (the scan, the ghost, the frame).
 *
 * \param items [{id, box}]
 * \param excludeIds array of ids
 * \return array of ids, in input order. Pure.
 */
CsSectionBay.sweepOf = function(items, rect, excludeIds) {
    var out = [];
    var skip = {};
    var i;
    if (excludeIds !== null && excludeIds !== undefined) {
        for (i = 0; i < excludeIds.length; i++) {
            skip[String(excludeIds[i])] = true;
        }
    }
    for (i = 0; i < items.length; i++) {
        if (skip[String(items[i].id)] === true) {
            continue;
        }
        if (CsSectionBay.contains(rect, items[i].box)) {
            out.push(items[i].id);
        }
    }
    return out;
};

/**
 * How the scan should sit over the ghost when the bay opens.
 *
 * UNIFORM, always. A scan squashed to fill the ghost's box would make
 * every traced width a lie, and the caver would have no way to see it:
 * a squashed passage still looks like a passage. Scaled to the ghost's
 * WIDTH and centred; the caver adjusts from there.
 *
 * \return {sx, sy, rot, tx, ty}. Pure.
 */
CsSectionBay.fitTransform = function(scanBox, ghostBox) {
    var sw = scanBox.x2 - scanBox.x1;
    var gw = ghostBox.x2 - ghostBox.x1;
    var k = (sw > 0 && gw > 0) ? (gw / sw) : 1;
    var cx = (ghostBox.x1 + ghostBox.x2) / 2;
    var cy = (ghostBox.y1 + ghostBox.y2) / 2;
    var sh = (scanBox.y2 - scanBox.y1) * k;
    return { sx: k, sy: k, rot: 0,
             tx: cx - (sw * k) / 2, ty: cy - sh / 2 };
};

/** The fit as a tag value. Fixed precision and five fields, so the
 *  serialized length is bounded by construction -- no tag in this
 *  suite is ever allowed to grow without a limit. */
CsSectionBay.serializeFit = function(fit) {
    var n = function(v) {
        return (isNaN(v) ? 0 : v).toFixed(6);
    };
    return [n(fit.sx), n(fit.sy), n(fit.rot), n(fit.tx), n(fit.ty)].join(",");
};

/** The fit back from a tag value, or NULL when it is not one. Never
 *  throws: a corrupt tag must reopen the bay without an underlay, not
 *  take the tool down. */
CsSectionBay.parseFit = function(text) {
    if (text === null || text === undefined || String(text) === "") {
        return null;
    }
    var parts = String(text).split(",");
    if (parts.length !== 5) {
        return null;
    }
    var nums = [];
    for (var i = 0; i < 5; i++) {
        var v = parseFloat(parts[i]);
        if (isNaN(v)) {
            return null;
        }
        nums.push(v);
    }
    return { sx: nums[0], sy: nums[1], rot: nums[2],
             tx: nums[3], ty: nums[4] };
};

/** Two boxes overlapping, once one is grown by a margin. Pure. */
CsSectionBay.overlaps = function(a, b, margin) {
    var m = (margin === undefined || margin === null) ? 0 : margin;
    return !(a.x2 + m < b.x1 || a.x1 - m > b.x2 ||
             a.y2 + m < b.y1 || a.y1 - m > b.y2);
};

/** A block-local box translated to an insertion point. Pure. */
CsSectionBay.boxAt = function(localBox, at) {
    return { x1: localBox.x1 + at.x, y1: localBox.y1 + at.y,
             x2: localBox.x2 + at.x, y2: localBox.y2 + at.y };
};

/**
 * Walk outward from the station until the block clears everything.
 *
 * CAPPED on purpose. A station boxed in on every side is a real
 * situation (a maze, a chamber full of breakdown), and the honest
 * answer there is "you place it" -- not a section flung a thousand feet
 * off the sheet where the caver will never find it.
 *
 * \param origin {x, y} the station
 * \param dir {x, y} unit outward direction
 * \param blockBox block-local {x1,y1,x2,y2}
 * \param obstacles array of {x1,y1,x2,y2}
 * \return {x, y} or null. Pure.
 */
CsSectionBay.marchOut = function(origin, dir, blockBox, obstacles, margin,
        cap) {
    var steps = (cap === undefined || cap === null) ? CsSectionBay.CAP : cap;
    var m = (margin === undefined || margin === null) ?
        CsSectionBay.MARGIN : margin;
    for (var s = 1; s <= steps; s++) {
        var at = { x: origin.x + dir.x * CsSectionBay.STEP * s,
                   y: origin.y + dir.y * CsSectionBay.STEP * s };
        var box = CsSectionBay.boxAt(blockBox, at);
        var clear = true;
        for (var i = 0; i < obstacles.length; i++) {
            if (CsSectionBay.overlaps(box, obstacles[i], m)) {
                clear = false;
                break;
            }
        }
        if (clear) {
            return at;
        }
    }
    return null;
};

/** The unit perpendicular of a direction. Pure. */
CsSectionBay.perpOf = function(d) {
    var len = Math.sqrt(d.x * d.x + d.y * d.y);
    if (len < 1e-12) {
        return { x: 0, y: 1 };
    }
    return { x: -d.y / len, y: d.x / len };
};

/**
 * Which way along a perpendicular has more room: +1 or -1.
 *
 * Counted, not measured. A count of obstacles within a probe box is
 * crude and stable; a nearest-distance measure flips on one stray note
 * and moves the section between runs, which reads as the tool being
 * random.
 *
 * A TIE GOES POSITIVE, so an empty drawing answers the same way twice.
 * Pure.
 */
CsSectionBay.clearerSide = function(origin, perp, obstacles, probe) {
    var reach = (probe === undefined || probe === null) ? 50 : probe;
    var count = function(sign) {
        var tip = { x: origin.x + perp.x * reach * sign,
                    y: origin.y + perp.y * reach * sign };
        var box = { x1: Math.min(origin.x, tip.x),
                    y1: Math.min(origin.y, tip.y),
                    x2: Math.max(origin.x, tip.x),
                    y2: Math.max(origin.y, tip.y) };
        var n = 0;
        for (var i = 0; i < obstacles.length; i++) {
            if (CsSectionBay.overlaps(box, obstacles[i], 0)) {
                n++;
            }
        }
        return n;
    };
    return (count(-1) < count(1)) ? -1 : 1;
};
```

- [ ] **Step 4: Register it in `CsAll.js`**

Add beside the other section includes in `scripts/CaveSurvey/Core/CsAll.js`:

```javascript
include(includeBasePath + "/CsSectionBay.js");
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node tests/js_unit.js`
Expected: `### UNIT OK <n> assertions`, `n` higher than before

Run: `python3 -m unittest tests.test_addon -v`
Expected: OK, including `test_every_core_file_is_included_by_csall`

- [ ] **Step 6: Mutation-test the containment assertion**

Temporarily change `contains` to use `>` instead of `>=` on `box.x1`:

```javascript
    return box.x1 > rect.x1 && box.x2 <= rect.x2 &&
```

Run: `node tests/js_unit.js`
Expected: FAIL on `"contains: flush with the frame counts as in"`. Revert the mutation and re-run to green. A comparison is only evidence if the two sides can disagree.

- [ ] **Step 7: Commit**

```bash
git add scripts/CaveSurvey/Core/CsSectionBay.js scripts/CaveSurvey/Core/CsAll.js tests/js_unit.js
git commit -m "feat(CsSectionBay): the maths a sketching bay needs, on its own"
```

---

### Task 2: The shelf offers Cross Section

**Goal:** The Sketch Scans shelf's two-state profile checkbox becomes a three-way combo, and a section scan's station list comes from the PLAN's stations — not from the `SectionStation` tag nothing writes.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsScanFrame.js`
- Modify: `scripts/CaveSurvey/SketchScans/SketchScans.js:538-546` (`frameNow`), and the widget construction that creates `w.profileCheck`
- Test: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `CsScanFrame.stationFrameFor("section")` returns `"plan"`; `"profile"` returns `"profile"`; anything unknown returns `"plan"`
- [ ] The shelf shows a combo with Plan / Profile / Cross Section, defaulting to Plan
- [ ] `frameNow()` returns `"section"` when Cross Section is chosen
- [ ] The station list for a section scan is non-empty on a drawing that has plotted plan stations
- [ ] Inserting with Cross Section chosen lands the image on `CTRL-SECTION-SCAN` with `ScanFrame=section`

**Verify:** `node tests/js_unit.js` → `### UNIT OK`, then `./tests/run_all.sh` → all sections pass

**Steps:**

- [ ] **Step 1: Write the failing test**

Append inside the existing `CsScanFrame` IIFE in `tests/js_unit.js`:

```javascript
    // A SECTION IS CUT AT A PLAN STATION. stationTagFor("section")
    // answers "SectionStation" -- a tag NOTHING in this suite writes --
    // so a picker built on it offers an empty list and says nothing.
    // The frame a scan is PICKED AGAINST is not always its own frame.
    eqs(CsScanFrame.stationFrameFor("section"), "plan",
        "stationFrameFor: a section is picked against plan stations");
    eqs(CsScanFrame.stationFrameFor("profile"), "profile",
        "stationFrameFor: the elevation is picked against its own");
    eqs(CsScanFrame.stationFrameFor("plan"), "plan",
        "stationFrameFor: and the plan against itself");
    eqs(CsScanFrame.stationFrameFor("nonsense"), "plan",
        "stationFrameFor: an unknown frame is plan, never a throw");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/js_unit.js`
Expected: FAIL — `TypeError: CsScanFrame.stationFrameFor is not a function`

- [ ] **Step 3: Add `stationFrameFor` to `Core/CsScanFrame.js`**

Immediately after `runTagFor`:

```javascript
/**
 * The frame whose station points a scan of this kind is picked against.
 *
 * NOT always the scan's own frame. A cross section is CUT AT a plan
 * station: the drawing has no section station points, and
 * stationTagFor("section") names a tag ("SectionStation") that nothing
 * in this suite writes. A picker built on that answers an empty list
 * and explains nothing, which is exactly how this would have shipped.
 *
 * SectionStation stays reserved for a frame that one day plots its own
 * station points. Until something writes it, nothing may read it.
 */
CsScanFrame.stationFrameFor = function(kind) {
    return CsScanFrame.normaliseKind(kind) === "profile" ?
        "profile" : "plan";
};
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node tests/js_unit.js`
Expected: `### UNIT OK <n> assertions`

- [ ] **Step 5: Replace the checkbox with a combo in `SketchScans.js`**

Find where `w.profileCheck` is constructed and replace it with a combo. A combo always HAS a value and can be read off the widget after the fact, instead of being accumulated from click events that may never fire:

```javascript
    // THREE FRAMES, ONE CONTROL. A checkbox could say plan-or-profile
    // and nothing more; sections make that a third state, and a combo
    // always has a value to read rather than a click history to
    // reconstruct.
    w.frameCombo = new QComboBox();
    w.frameCombo.addItem(qsTr("Plan"));
    w.frameCombo.addItem(qsTr("Profile"));
    w.frameCombo.addItem(qsTr("Cross Section"));
    w.frameCombo.currentIndex = 0;
```

Add it to the same layout row the checkbox occupied, and delete the `w.profileCheck` construction and any `connect` to it.

- [ ] **Step 6: Teach `frameNow` the third answer**

Replace `frameNow` at `scripts/CaveSurvey/SketchScans/SketchScans.js:538`:

```javascript
    /** Which view the picks are being taken in: the combo decides.
     *  ONE FRAME AT A TIME, deliberately -- offering the plan's
     *  stations and the elevation's together would double a list that
     *  is already long enough to hunt through. */
    var frameNow = function() {
        try {
            if (w.frameCombo === undefined || w.frameCombo === null) {
                return "plan";
            }
            switch (w.frameCombo.currentIndex) {
            case 1:  return "profile";
            case 2:  return "section";
            default: return "plan";
            }
        } catch (e) {
            return "plan";
        }
    };
```

- [ ] **Step 7: Pick stations against the right frame**

In `stationsNow` (near line 555), route through the new helper:

```javascript
            var places = CsScanFrame.placesIn(doc,
                CsScanFrame.stationFrameFor(frameNow()));
```

And in the prompt text near line 615, so the wording matches what is actually offered:

```javascript
                (frameNow() === "profile" ? "elevation stations" :
                    "stations")
```

- [ ] **Step 8: Verify in the real engine**

Run: `./tests/run_all.sh`
Expected: every section passes; in particular section 2 (`### SYNTAX OK`) and section 1 (structural tests).

- [ ] **Step 9: Commit**

```bash
git add scripts/CaveSurvey/Core/CsScanFrame.js scripts/CaveSurvey/SketchScans/SketchScans.js tests/js_unit.js
git commit -m "feat(SketchScans): the shelf offers a cross-section frame

A section is cut at a PLAN station, so stationFrameFor routes the
picker there rather than at the SectionStation tag nothing writes."
```

---

### Task 3: Sketch Section opens the bay

**Goal:** Choosing a scan, a frame of Cross Section and Sketch Section puts a framed bay on the drawing holding that scan and the station's computed LRUD outline, with the view zoomed to it and snapping switched to free.

**Files:**
- Create: `scripts/CaveSurvey/SketchSection/SketchSection.js`
- Create: `scripts/CaveSurvey/SketchSection/SketchSection.svg`
- Modify: `scripts/CaveSurvey/SketchScans/SketchScans.js` (third action button)
- Modify: `scripts/CaveSurvey/CaveSurvey.js` if the tool list there is explicit

**Acceptance Criteria:**
- [ ] `Cave Survey > Sketch Section` appears in the menu and answers to `sketchsection` / `sks`
- [ ] The shelf's third button is enabled only when the frame combo says Cross Section
- [ ] The bay frame lands on `CTRL-SECTION-BOX`, locked, clear of the plan extents
- [ ] The scan lands on `CTRL-SECTION-SCAN`, faded, at the back of the draw order, scaled onto the ghost
- [ ] The ghost lands on `CTRL-SECTION-OUTLINE`, dashed, at `CsSectionDraw.SCALE`
- [ ] A station with no cuttable LRUD opens the bay with no ghost and says so, rather than failing
- [ ] Snap is free while the bay is open and the prior snap is restored on `finishEvent`

**Verify:** `./tests/run_all.sh` → all sections pass, including the new `### SECTION SKETCH OK` from Task 7

**Steps:**

- [ ] **Step 1: Write the tool**

Create `scripts/CaveSurvey/SketchSection/SketchSection.js`:

```javascript
/**
 * SketchSection -- open a staging bay to trace a scanned cross section
 * in.
 *
 * The bay is a locked rectangle on CTRL-SECTION-BOX parked clear of the
 * plan, holding two things: the scan, and the COMPUTED section for the
 * same station, dashed, at the scale the finished block will be drawn
 * at. The caver scales the scan onto that outline and traces with the
 * suite's own tools.
 *
 * WHY THE GHOST. A scan has no scale and no up. The station's own LRUD
 * has both, and it is already in the drawing. One dashed outline is the
 * ruler, the protractor and a visible check of the tracing against what
 * was measured -- and it is deleted at Capture, so it never reaches the
 * block.
 *
 * WHAT THIS TOOL DOES NOT DO. It does not draw. Everything inside the
 * frame is drawn by the caver with Feature Trace, Shaped Lines, arcs --
 * whatever the passage needs. SectionCapture turns that into a block.
 *
 * USAGE:
 *   Cave Survey > Sketch Section   (or "sketchsection" / "sks")
 */
include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

function SketchSection(guiAction) {
    EAction.call(this, guiAction);
    this.priorSnap = null;
}

SketchSection.prototype = new EAction();

/** The setting holding where the caver last left a bay, per cave. */
SketchSection.SETTING_CORNER = "CaveSurvey/SectionBayCorner";

/** Tags carried by the bay's own furniture, so Capture can tell the
 *  frame and the underlay from the tracing without guessing. */
SketchSection.TAG_BAY = "SectionBay";
SketchSection.ROLE_FRAME = "frame";
SketchSection.ROLE_GHOST = "ghost";
SketchSection.ROLE_SCAN = "scan";

SketchSection.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    SketchSection.run(null, null);
    this.terminate();
};

/** One "Sketch Section: ..." message, however this build can show it. */
SketchSection.say = function(text) {
    try {
        QMessageBox.information(RMainWindowQt.getMainWindow(),
            qsTr("Sketch Section"), text);
    } catch (e) {
        EAction.handleUserWarning(text);
    }
};

/**
 * Open a bay.
 *
 * \param scanPath absolute path to the scan, or null to ask
 * \param station station name, or null to ask
 * \return the bay id, or null
 */
SketchSection.run = function(scanPath, station) {
    var doc = EAction.getDocument();
    var di = EAction.getDocumentInterface();
    if (isNull(doc) || isNull(di)) {
        return null;
    }

    var name = station;
    if (name === null || name === undefined || name === "") {
        name = SketchSection.askStation(doc);
        if (name === null) {
            return null;                 // cancelled, silently
        }
    }

    var asDrawn = null;
    try {
        asDrawn = CsRevise.resolveAsDrawn(doc);
    } catch (eRes) {
        asDrawn = null;
    }

    var cut = SketchSection.cutAt(asDrawn, name);
    var scale = CsSectionDraw.scaleOf();
    var ghostBox = (cut === null) ? { x1: -5, y1: -5, x2: 5, y2: 5 } :
        CsSectionDraw.localBox(cut, scale, CsSectionDraw.textHeight(doc));

    var size = { w: (ghostBox.x2 - ghostBox.x1) * 3,
                 h: (ghostBox.y2 - ghostBox.y1) * 3 };
    var rect = CsSectionBay.frameRectFor(
        SketchSection.planBoxOf(doc), size,
        SketchSection.rememberedCorner(doc));

    var bayId = CsUuid.create();
    // OFF layers refuse adds SILENTLY in this build -- every one of
    // these three writes goes through withLayerOn or the bay opens
    // empty with no error at all.
    CsLayers.withLayerOn(doc, di, CsLayers.CTRL_SECTION_BOX, function() {
        SketchSection.addFrame(doc, di, rect, bayId, name);
    });
    if (cut !== null) {
        CsLayers.withLayerOn(doc, di, CsLayers.CTRL_SECTION_OUTLINE,
            function() {
                SketchSection.addGhost(doc, di, cut, scale, rect, bayId);
            });
    }
    if (scanPath !== null && scanPath !== undefined && scanPath !== "") {
        CsLayers.withLayerOn(doc, di, CsLayers.CTRL_SECTION_SCAN,
            function() {
                SketchSection.addScan(doc, di, scanPath, ghostBox, rect,
                    bayId);
            });
    }

    SketchSection.zoomTo(di, rect);
    SketchSection.snapFree(di);

    if (cut === null) {
        SketchSection.say(qsTr("No cuttable LRUD at %1, so the bay has " +
            "no outline to scale the scan against.\n\nScale the scan by " +
            "hand: draw a line of a known length inside the frame and " +
            "match the scan to it.").arg(name));
    }
    return bayId;
};

/** The section the drawing would compute at this station, or null. */
SketchSection.cutAt = function(asDrawn, station) {
    if (asDrawn === null || isNull(asDrawn.resolved)) {
        return null;
    }
    var pos = asDrawn.resolved.stations[station];
    if (pos === undefined) {
        return null;
    }
    var leg = CsSectionCut.nearestLeg(asDrawn.resolved,
        { x: pos.x, y: pos.y });
    if (leg === null) {
        return null;
    }
    var cut = CsSectionCut.cut(asDrawn.survey, asDrawn.resolved,
        leg.from, leg.to, leg.t, {});
    return (cut.refused === true) ? null : cut;
};

/** The plan's own extent, or null when the drawing is empty. */
SketchSection.planBoxOf = function(doc) {
    try {
        var b = doc.getBoundingBox(true, true);
        if (isNull(b)) {
            return null;
        }
        return { x1: b.getMinimum().x, y1: b.getMinimum().y,
                 x2: b.getMaximum().x, y2: b.getMaximum().y };
    } catch (e) {
        return null;
    }
};

/** Where this cave's bay was last left, or null. */
SketchSection.rememberedCorner = function(doc) {
    try {
        var raw = RSettings.getStringValue(
            SketchSection.SETTING_CORNER, "");
        if (raw === "") {
            return null;
        }
        var all = JSON.parse(raw);
        var key = String(doc.getFileName());
        if (all[key] === undefined) {
            return null;
        }
        return { x: all[key].x, y: all[key].y };
    } catch (e) {
        return null;
    }
};

/** The frame: a closed polyline, tagged, and LOCKED so a rubber-band
 *  selection over the tracing cannot drag the boundary the sweep is
 *  measured against. */
SketchSection.addFrame = function(doc, di, rect, bayId, station) {
    var pl = new RPolyline();
    pl.appendVertex(new RVector(rect.x1, rect.y1));
    pl.appendVertex(new RVector(rect.x2, rect.y1));
    pl.appendVertex(new RVector(rect.x2, rect.y2));
    pl.appendVertex(new RVector(rect.x1, rect.y2));
    pl.setClosed(true);
    var e = new RPolylineEntity(doc, new RPolylineData(pl));
    e.setLayerId(doc.getLayerId(CsLayers.CTRL_SECTION_BOX));
    // Tag BEFORE adding, so the tags land in the SAME operation as the
    // geometry.
    CsTags.set(e, SketchSection.TAG_BAY, bayId);
    CsTags.set(e, "SectionBayRole", SketchSection.ROLE_FRAME);
    CsTags.set(e, "SectionBayStation", station);
    var op = new RAddObjectsOperation();
    op.setText("Open section bay");
    op.addObject(e, false);
    di.applyOperation(op);
};

/** The ghost: the computed outline, dashed, centred in the bay. */
SketchSection.addGhost = function(doc, di, cut, scale, rect, bayId) {
    var pts = CsSectionDraw.localPoints(cut, scale);
    if (pts.length < 3) {
        return;
    }
    var cx = (rect.x1 + rect.x2) / 2;
    var cy = (rect.y1 + rect.y2) / 2;
    var pl = new RPolyline();
    for (var i = 0; i < pts.length; i++) {
        pl.appendVertex(new RVector(cx + pts[i].x, cy + pts[i].y));
    }
    pl.setClosed(true);
    var e = new RPolylineEntity(doc, new RPolylineData(pl));
    e.setLayerId(doc.getLayerId(CsLayers.CTRL_SECTION_OUTLINE));
    CsTags.set(e, SketchSection.TAG_BAY, bayId);
    CsTags.set(e, "SectionBayRole", SketchSection.ROLE_GHOST);
    var op = new RAddObjectsOperation();
    op.setText("Draw section ghost");
    op.addObject(e, false);
    di.applyOperation(op);
};

/** The scan, scaled onto the ghost, faded, at the back. */
SketchSection.addScan = function(doc, di, path, ghostBox, rect, bayId) {
    var img = new QImage(path);
    if (img.isNull()) {
        SketchSection.say(qsTr("The scan could not be read: ") + path);
        return;
    }
    var cx = (rect.x1 + rect.x2) / 2;
    var cy = (rect.y1 + rect.y2) / 2;
    var scanBox = { x1: 0, y1: 0, x2: img.width, y2: img.height };
    var ghostHere = { x1: cx + ghostBox.x1, y1: cy + ghostBox.y1,
                      x2: cx + ghostBox.x2, y2: cy + ghostBox.y2 };
    var fit = CsSectionBay.fitTransform(scanBox, ghostHere);

    var data = new RImageData();
    data.setFileName(path);
    data.setInsertionPoint(new RVector(fit.tx, fit.ty));
    data.setUVector(new RVector(fit.sx, 0));
    data.setVVector(new RVector(0, fit.sy));
    data.setFade(50);
    var e = new RImageEntity(doc, data);
    e.setLayerId(doc.getLayerId(CsLayers.CTRL_SECTION_SCAN));
    CsTags.set(e, SketchSection.TAG_BAY, bayId);
    CsTags.set(e, "SectionBayRole", SketchSection.ROLE_SCAN);
    CsTags.set(e, CsCallout.KEY.SECTION_SCAN, path);
    CsTags.set(e, CsCallout.KEY.SECTION_FIT,
        CsSectionBay.serializeFit(fit));
    var op = new RAddObjectsOperation();
    op.setText("Underlay section scan");
    op.addObject(e, false);
    di.applyOperation(op);
};

/** Zoom the view to the bay, so the caver is looking at it. */
SketchSection.zoomTo = function(di, rect) {
    try {
        var box = new RBox(new RVector(rect.x1, rect.y1),
                           new RVector(rect.x2, rect.y2));
        di.zoomTo(box, 20);
    } catch (e) {
        // a build that cannot zoom still opened the bay
    }
};

/**
 * Snapping goes FREE while a bay is open.
 *
 * Grid snap quantises every freehand sample onto the grid: the wall
 * comes out a staircase and the collapsed samples get discarded by
 * curve reduction. Set through di, NOT by triggering the snap action --
 * triggering from inside an action lifecycle event frees the action
 * still running and takes the process with it.
 */
SketchSection.snapFree = function(di) {
    try {
        di.setSnap(new RSnapFree());
    } catch (e) {
        // no snap change is survivable; a crash is not
    }
};

/** Ask which station this section is cut at. Plan stations, in walk
 *  order -- the order the survey visited them, not name order, so a
 *  branch reads the way the notebook does. */
SketchSection.askStation = function(doc) {
    var stations = CsTags.collectStations(doc);
    if (stations.length === 0) {
        SketchSection.say(qsTr("This drawing has no plotted stations to " +
            "hang a section on."));
        return null;
    }
    var names = [];
    var i;
    try {
        var asDrawn = CsRevise.resolveAsDrawn(doc);
        var order = CsStationOrder.walkOrder(asDrawn.survey);
        var plotted = {};
        for (i = 0; i < stations.length; i++) {
            plotted[stations[i].name] = true;
        }
        for (i = 0; i < order.length; i++) {
            if (plotted[order[i]] === true) {
                names.push(order[i]);
            }
        }
    } catch (e) {
        names = [];
    }
    if (names.length === 0) {
        for (i = 0; i < stations.length; i++) {
            names.push(stations[i].name);
        }
    }
    var chosen = QInputDialog.getItem(RMainWindowQt.getMainWindow(),
        qsTr("Sketch Section"), qsTr("Station this section is cut at:"),
        names, 0, false);
    if (chosen === null || chosen === undefined || chosen === "") {
        return null;
    }
    return String(chosen);
};

SketchSection.init = function(basePath) {
    var action = new RGuiAction(qsTr("Sketch Section"),
                                RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/SketchSection.js");
    action.setIcon(basePath + "/SketchSection.svg");
    action.setStatusTip(qsTr("Open a bay to trace a scanned cross " +
        "section in, over the station's own measured outline"));
    action.setDefaultCommands(["sketchsection", "sks"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(47);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
```

- [ ] **Step 2: Add the four tag keys to `Core/CsCallout.js`**

Inside `CsCallout.KEY`, after `SECTION_FROZEN`:

```javascript
    ,
    // A section TRACED from a scan rather than computed from LRUD.
    // SOURCE is the regeneration gate: refreshSections must never
    // redraw over hand tracing. The other three are what it takes to
    // reopen the bay and carry on tracing -- the revision framework's
    // rule, one kind over: the drawing is reconstructible from what is
    // stored on it.
    SECTION_SOURCE: "SectionSource",
    SECTION_SCAN: "SectionScan",
    SECTION_FIT: "SectionBayFit",
    SECTION_STATION: "SectionStationRef"
```

And beside `KIND_SECTION`:

```javascript
/** The value of SECTION_SOURCE for a traced section. Absent means
 *  computed, so every section drawn before this existed keeps
 *  regenerating exactly as it did. */
CsCallout.SOURCE_SKETCH = "sketch";
```

- [ ] **Step 3: Add the shelf's third button**

In `SketchScans.js`, beside the Insert and Insert & Align buttons:

```javascript
    w.sketchButton = new QPushButton(qsTr("Sketch Section"));
    w.sketchButton.enabled = false;      // until the frame says section
    w.sketchButton.clicked.connect(function() {
        var rel = selectedFile();
        if (rel === null || w.scans === null) { return; }
        SketchScans.sketchSoon(w.scans + "/" + rel);
    });
```

Enable it from the combo:

```javascript
    w.frameCombo.currentIndexChanged.connect(function() {
        try {
            w.sketchButton.enabled = (frameNow() === "section");
        } catch (e) {
        }
        SketchScans.refresh();
    });
```

And add the deferred hand-off beside `alignSoon`, for the same reason `alignSoon` exists:

```javascript
/**
 * Hand a scan to the Sketch Section tool, DEFERRED.
 *
 * Starting an action from inside a widget event is the documented
 * hard-crash trap: triggering makes QCAD build a new action, and
 * setCurrentAction then runs deleteTerminatedActions(), which frees the
 * action still executing this very handler. The zero-delay timer puts
 * the start on the next event loop turn, out of that handler.
 */
SketchScans.sketchSoon = function(path) {
    var timer = new QTimer();
    timer.singleShot = true;
    timer.timeout.connect(function() {
        try {
            SketchSection.run(path, null);
        } catch (e) {
            EAction.handleUserWarning("Sketch Section: " + e);
        }
    });
    timer.start(0);
};
```

Add the include at the top of `SketchScans.js`, beside the AlignImage one:

```javascript
include(includeBasePath + "/../SketchSection/SketchSection.js");
```

- [ ] **Step 4: Draw the icon**

Create `scripts/CaveSurvey/SketchSection/SketchSection.svg` — a 24×24 SVG matching the suite's existing icons (an outline shape with a pencil). Copy `CrossSection/CrossSection.svg` as the starting point so the stroke weights match.

- [ ] **Step 5: Verify structure and syntax**

Run: `./tests/run_all.sh`
Expected: section 1 (structural) passes — it checks the add-on layout, the includes resolve, and `(groupSortOrder, sortOrder)` is unique — and section 2 prints `### SYNTAX OK`.

If sort order 47 collides, the structural test names the collision; pick the next free number.

- [ ] **Step 6: Commit**

```bash
git add scripts/CaveSurvey/SketchSection/ scripts/CaveSurvey/SketchScans/SketchScans.js scripts/CaveSurvey/Core/CsCallout.js
git commit -m "feat(SketchSection): a bay to trace a scanned section in"
```

---

### Task 4: Capture — sweep, block, leader, placement

**Goal:** Capture turns everything inside the bay into a `CS_<CalloutId>` block, leadered to the station and marched out clear of the plan's walls, with the proposal shown as a preview before it commits.

**Files:**
- Create: `scripts/CaveSurvey/SketchSection/SectionCapture.js`
- Create: `scripts/CaveSurvey/SketchSection/SectionCapture.svg`
- Test: `tests/section_sketch_run.js` (written in Task 7)

**Acceptance Criteria:**
- [ ] Capture with nothing traced refuses and explains, rather than defining an empty block
- [ ] The block definition contains the traced entities and neither the scan, the ghost nor the frame
- [ ] The block is drawn block-local: the ghost's centre becomes the block origin
- [ ] The reference carries `SectionSource=sketch`, `SectionScan`, `SectionBayFit`, `SectionStationRef` and `SectionScale`
- [ ] A leader runs from the station to the section
- [ ] The proposed position clears every plan-frame obstacle by at least `CsSectionBay.MARGIN`
- [ ] When the march finds nowhere, the tool falls back to click-to-place instead of committing a bad spot
- [ ] Bay teardown removes the frame, the ghost, the scan and the loose tracing

**Verify:** `./tests/run_all.sh` → `### SECTION SKETCH OK`

**Steps:**

- [ ] **Step 1: Write the tool**

Create `scripts/CaveSurvey/SketchSection/SectionCapture.js`:

```javascript
/**
 * SectionCapture -- turn a traced bay into a placed section block.
 *
 * THE SWEEP IS GEOMETRIC. Everything wholly inside the bay frame joins
 * the block, minus the frame, the ghost and the scan, which are tagged
 * and excluded by tag rather than by layer. Not "everything on the
 * section layers": a stray line from the previous sketch would join
 * this block silently, and nothing on the drawing would say so.
 *
 * THE BLOCK IS BLOCK-LOCAL about the ghost's centre, which is where the
 * centreline of the passage was. So the reference's insertion point IS
 * the centreline on the sheet, exactly as a computed section's is --
 * the two kinds drag, snap and leader identically.
 *
 * PLACEMENT IS PROPOSED, NOT IMPOSED. The march is a good guess and
 * says so by showing itself as a preview: Enter takes it, a click puts
 * it somewhere else. A march that finds nowhere clear inside its cap
 * hands the placement over rather than flinging the section off-sheet.
 *
 * USAGE:
 *   Cave Survey > Capture Section   (or "sectioncapture" / "skc")
 */
include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");
include(includeBasePath + "/../Callout/CalloutWrite.js");
include(includeBasePath + "/SketchSection.js");

function SectionCapture(guiAction) {
    EAction.call(this, guiAction);
    this.bay = null;
    this.proposed = null;
    this.previewPos = undefined;
}

SectionCapture.prototype = new EAction();

SectionCapture.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    if (isNull(doc) || isNull(di)) {
        this.terminate();
        return;
    }
    this.bay = SectionCapture.findBay(doc);
    if (this.bay === null) {
        SketchSection.say(qsTr("There is no open section bay in this " +
            "drawing.\n\nSketch Section opens one."));
        this.terminate();
        return;
    }
    if (this.bay.traced.length === 0) {
        SketchSection.say(qsTr("Nothing has been traced inside the bay " +
            "yet, so there is no section to capture."));
        this.terminate();
        return;
    }
    this.proposed = SectionCapture.proposePosition(doc, this.bay);
    if (this.proposed === null) {
        // Boxed in. Honest answer: the caver places it.
        this.setCommandPrompt(qsTr("No clear spot found -- pick where " +
            "the section goes"));
        this.setLeftMouseTip(qsTr("Position of the section"));
        this.setRightMouseTip(EAction.trCancel);
        EAction.showSnapTools();
        this.setCrosshairCursor();
        di.setClickMode(RAction.PickCoordinate);
        return;
    }
    this.setCommandPrompt(qsTr("Enter to accept the proposed spot, or " +
        "pick another"));
    this.setLeftMouseTip(qsTr("Position of the section"));
    this.setRightMouseTip(EAction.trCancel);
    EAction.showSnapTools();
    this.setCrosshairCursor();
    di.setClickMode(RAction.PickCoordinate);
};

/** Enter takes the proposal. */
SectionCapture.prototype.enterEvent = function() {
    if (this.proposed !== null) {
        this.finish(this.proposed);
    }
};

SectionCapture.prototype.pickCoordinate = function(event, preview) {
    var pos = event.getModelPosition();
    if (preview) {
        this.previewPos = { x: pos.x, y: pos.y };
        return;
    }
    this.finish({ x: pos.x, y: pos.y });
};

/**
 * The open bay: its frame, its rect, its station, its furniture and the
 * tracing inside it.
 *
 * The id set is DIFFED rather than ordered -- queryAllEntities is not
 * insertion-ordered, so "the last entity" means nothing here.
 *
 * \return {id, rect, station, frame, ghost, scan, traced: [ids]} or null
 */
SectionCapture.findBay = function(doc) {
    var ids = doc.queryAllEntities(false, true);
    var frame = null, ghost = null, scan = null, bayId = null;
    var i, e;
    for (i = 0; i < ids.length; i++) {
        e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var tag = CsTags.get(e, SketchSection.TAG_BAY);
        if (tag === "") {
            continue;
        }
        var role = CsTags.get(e, "SectionBayRole");
        if (role === SketchSection.ROLE_FRAME) {
            frame = e;
            bayId = tag;
        } else if (role === SketchSection.ROLE_GHOST) {
            ghost = e;
        } else if (role === SketchSection.ROLE_SCAN) {
            scan = e;
        }
    }
    if (frame === null) {
        return null;
    }
    // The frame may have been dragged since it was drawn, and a
    // bounding box is CACHED across a modify -- read it only after an
    // update(), or the sweep is measured against where the frame used
    // to be.
    frame.update();
    var fb = frame.getBoundingBox();
    var rect = { x1: fb.getMinimum().x, y1: fb.getMinimum().y,
                 x2: fb.getMaximum().x, y2: fb.getMaximum().y };

    var exclude = [frame.getId()];
    if (ghost !== null) { exclude.push(ghost.getId()); }
    if (scan !== null) { exclude.push(scan.getId()); }

    var items = [];
    for (i = 0; i < ids.length; i++) {
        e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        e.update();
        var b = e.getBoundingBox();
        items.push({ id: ids[i],
                     box: { x1: b.getMinimum().x, y1: b.getMinimum().y,
                            x2: b.getMaximum().x, y2: b.getMaximum().y } });
    }
    return {
        id: bayId,
        rect: rect,
        station: CsTags.get(frame, "SectionBayStation"),
        frame: frame,
        ghost: ghost,
        scan: scan,
        traced: CsSectionBay.sweepOf(items, rect, exclude)
    };
};

/** The bay's origin: the ghost's centre, or the frame's if there is no
 *  ghost. This becomes the block's 0,0 and therefore the centreline. */
SectionCapture.originOf = function(bay) {
    if (bay.ghost !== null) {
        bay.ghost.update();
        var g = bay.ghost.getBoundingBox();
        return { x: (g.getMinimum().x + g.getMaximum().x) / 2,
                 y: (g.getMinimum().y + g.getMaximum().y) / 2 };
    }
    return { x: (bay.rect.x1 + bay.rect.x2) / 2,
             y: (bay.rect.y1 + bay.rect.y2) / 2 };
};

/** The tracing's own extent, block-local. */
SectionCapture.localBoxOf = function(doc, bay, origin) {
    var x1 = 0, y1 = 0, x2 = 0, y2 = 0, seen = false;
    for (var i = 0; i < bay.traced.length; i++) {
        var e = doc.queryEntity(bay.traced[i]);
        if (isNull(e)) {
            continue;
        }
        e.update();
        var b = e.getBoundingBox();
        var bx1 = b.getMinimum().x - origin.x;
        var by1 = b.getMinimum().y - origin.y;
        var bx2 = b.getMaximum().x - origin.x;
        var by2 = b.getMaximum().y - origin.y;
        if (!seen) {
            x1 = bx1; y1 = by1; x2 = bx2; y2 = by2;
            seen = true;
        } else {
            if (bx1 < x1) { x1 = bx1; }
            if (by1 < y1) { y1 = by1; }
            if (bx2 > x2) { x2 = bx2; }
            if (by2 > y2) { y2 = by2; }
        }
    }
    return { x1: x1, y1: y1, x2: x2, y2: y2 };
};

/** Everything the section must not land on: plan-frame linework and
 *  every section already placed. The bay's own contents are excluded --
 *  they are about to stop existing. */
SectionCapture.obstaclesOf = function(doc, bay) {
    var out = [];
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        if (CsTags.get(e, SketchSection.TAG_BAY) !== "") {
            continue;                      // bay furniture
        }
        var layerName = doc.getLayerName(e.getLayerId());
        if (CsLayers.frameOf(layerName) !== "plan") {
            continue;                      // profile, section, sheet
        }
        e.update();
        var b = e.getBoundingBox();
        out.push({ x1: b.getMinimum().x, y1: b.getMinimum().y,
                   x2: b.getMaximum().x, y2: b.getMaximum().y });
    }
    return out;
};

/** March outward from the station and propose a spot, or null. */
SectionCapture.proposePosition = function(doc, bay) {
    var stations = CsTags.collectStations(doc);
    var at = null;
    for (var i = 0; i < stations.length; i++) {
        if (stations[i].name === bay.station) {
            at = { x: stations[i].pos.x, y: stations[i].pos.y };
            break;
        }
    }
    if (at === null) {
        return null;
    }
    var origin = SectionCapture.originOf(bay);
    var localBox = SectionCapture.localBoxOf(doc, bay, origin);
    var obstacles = SectionCapture.obstaclesOf(doc, bay);

    var tangent = SectionCapture.tangentAt(doc, bay.station);
    var perp = CsSectionBay.perpOf(tangent);
    var side = CsSectionBay.clearerSide(at, perp, obstacles, 50);
    var dir = { x: perp.x * side, y: perp.y * side };

    return CsSectionBay.marchOut(at, dir, localBox, obstacles,
        CsSectionBay.MARGIN, CsSectionBay.CAP);
};

/** The local leg direction at a station -- the survey's own, so the
 *  section goes out SIDEWAYS from the passage rather than along it. */
SectionCapture.tangentAt = function(doc, station) {
    try {
        var asDrawn = CsRevise.resolveAsDrawn(doc);
        var here = asDrawn.resolved.stations[station];
        var leg = CsSectionCut.nearestLeg(asDrawn.resolved,
            { x: here.x, y: here.y });
        var a = asDrawn.resolved.stations[leg.from];
        var b = asDrawn.resolved.stations[leg.to];
        return { x: b.x - a.x, y: b.y - a.y };
    } catch (e) {
        return { x: 1, y: 0 };
    }
};

/** Build the block, place it, leader it, tear the bay down. */
SectionCapture.prototype.finish = function(position) {
    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    if (isNull(doc) || isNull(di) || this.bay === null) {
        this.terminate();
        return;
    }
    try {
        var id = SectionCapture.capture(doc, di, this.bay, position);
        if (id === null) {
            SketchSection.say(qsTr("The section could not be placed -- " +
                "its block was refused by this drawing."));
        } else {
            EAction.handleUserMessage(
                qsTr("Section at %1 captured from %2 traced entities")
                    .arg(this.bay.station).arg(this.bay.traced.length));
        }
    } catch (e) {
        // LOCKED and FROZEN layers refuse writes SILENTLY here, so the
        // alternative is a command that looks like it worked and drew
        // nothing.
        SketchSection.say(qsTr("The section could not be placed.\n\n") + e);
    }
    this.terminate();
};

/**
 * The whole capture, as one callable so the headless test can drive it
 * without a GUI event.
 *
 * \return the callout id, or null
 */
SectionCapture.capture = function(doc, di, bay, position) {
    var origin = SectionCapture.originOf(bay);
    var scale = CsSectionDraw.scaleOf();
    var id = CsCallout.newId();
    var name = CsSectionDraw.blockName(id);

    var blockId = doc.getBlockId(name);
    if (blockId === RBlock.INVALID_ID || blockId === undefined ||
            blockId === null || blockId < 0) {
        var block = new RBlock(doc, name, new RVector(0, 0));
        di.applyOperation(new RAddObjectOperation(block, false));
        blockId = doc.getBlockId(name);
    }
    if (blockId === RBlock.INVALID_ID || blockId < 0) {
        return null;
    }

    var op = new RAddObjectsOperation();
    op.setText("Capture sketched section");
    var i, e;
    for (i = 0; i < bay.traced.length; i++) {
        e = doc.queryEntity(bay.traced[i]);
        if (isNull(e)) {
            continue;
        }
        var copy = e.clone();
        copy.setBlockId(blockId);
        copy.move(new RVector(-origin.x, -origin.y));
        op.addObject(copy, false);
        op.deleteObject(e);              // the loose tracing goes
    }

    var layerName = CsCallout.STYLES["annotation"] ||
        CsCallout.STYLES[CsCallout.STYLE_DEFAULT];
    CsLayers.ensure(doc, di, layerName);
    var at = new RVector(position.x, position.y);
    var ref = new RBlockReferenceEntity(doc,
        new RBlockReferenceData(blockId, at, new RVector(1, 1), 0.0));
    ref.setLayerId(doc.getLayerId(layerName));

    // Tag BEFORE adding, so the tags land in the SAME operation as the
    // geometry.
    CsTags.set(ref, CsCallout.KEY.ID, id);
    CsTags.set(ref, CsCallout.KEY.ROLE, CsCallout.ROLE_BLOCK);
    CsTags.set(ref, CsCallout.KEY.KIND, CsCallout.KIND_SECTION);
    CsTags.set(ref, CsCallout.KEY.STYLE, "annotation");
    CsTags.set(ref, CsCallout.KEY.SIDE, "auto");
    CsTags.set(ref, CsCallout.KEY.LEADER, CsCallout.LEADER_DEFAULT);
    CsTags.set(ref, CsCallout.KEY.SECTION_SOURCE, CsCallout.SOURCE_SKETCH);
    CsTags.set(ref, CsCallout.KEY.SECTION_STATION, bay.station);
    CsTags.set(ref, CsCallout.KEY.SECTION_SCALE, String(scale));
    if (bay.scan !== null) {
        var path = CsTags.get(bay.scan, CsCallout.KEY.SECTION_SCAN);
        var fit = CsTags.get(bay.scan, CsCallout.KEY.SECTION_FIT);
        if (path !== "") { CsTags.set(ref, CsCallout.KEY.SECTION_SCAN, path); }
        if (fit !== "") { CsTags.set(ref, CsCallout.KEY.SECTION_FIT, fit); }
    }
    op.addObject(ref, false);

    // The bay's furniture, gone in the same operation -- one undo.
    if (bay.frame !== null) { op.deleteObject(bay.frame); }
    if (bay.ghost !== null) { op.deleteObject(bay.ghost); }
    if (bay.scan !== null) { op.deleteObject(bay.scan); }

    di.applyOperation(op);

    SectionCapture.addLeader(doc, di, id, bay.station, position, layerName);
    return id;
};

/** One straight leader from the station to the section. Straight, not
 *  curved: a DXF LEADER record has no bulge, and an arc leader loses
 *  its arrow tip on a round trip. */
SectionCapture.addLeader = function(doc, di, id, station, position,
        layerName) {
    var stations = CsTags.collectStations(doc);
    var tip = null;
    for (var i = 0; i < stations.length; i++) {
        if (stations[i].name === station) {
            tip = stations[i].pos;
            break;
        }
    }
    if (tip === null) {
        return;
    }
    var pl = new RPolyline();
    pl.appendVertex(new RVector(tip.x, tip.y));
    pl.appendVertex(new RVector(position.x, position.y));
    var leader = new RLeaderEntity(doc, new RLeaderData(pl, true));
    leader.setLayerId(doc.getLayerId(layerName));
    CsTags.set(leader, CsCallout.KEY.ID, id);
    CsTags.set(leader, CsCallout.KEY.ROLE, CsCallout.ROLE_LEADER);
    var op = new RAddObjectsOperation();
    op.setText("Leader a sketched section");
    op.addObject(leader, false);
    di.applyOperation(op);
};

SectionCapture.init = function(basePath) {
    var action = new RGuiAction(qsTr("Capture Section"),
                                RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/SectionCapture.js");
    action.setIcon(basePath + "/SectionCapture.svg");
    action.setStatusTip(qsTr("Turn what is traced in the section bay " +
        "into a block, placed clear of the cave walls"));
    action.setDefaultCommands(["sectioncapture", "skc"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(48);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
```

- [ ] **Step 2: Draw `SectionCapture.svg`**

Same 24×24 house style; start from `CrossSection/CrossSection.svg`.

- [ ] **Step 3: Verify syntax and structure**

Run: `./tests/run_all.sh`
Expected: section 1 passes (layout, includes, unique sort order), section 2 prints `### SYNTAX OK`. The behavioural proof arrives in Task 7 — do not claim this task verified on syntax alone.

- [ ] **Step 4: Commit**

```bash
git add scripts/CaveSurvey/SketchSection/SectionCapture.js scripts/CaveSurvey/SketchSection/SectionCapture.svg
git commit -m "feat(SectionCapture): a traced bay becomes a placed section block"
```

---

### Task 5: Draw never regenerates over a sketch

**Goal:** `CalloutWrite.refreshSections` skips a `SectionSource=sketch` block and counts it, so hand tracing is never overwritten and never silently stale.

**Files:**
- Modify: `scripts/CaveSurvey/Callout/CalloutWrite.js:912-940` (`refreshSections`)
- Test: `tests/cross_section_run.js`

**Acceptance Criteria:**
- [ ] `refreshSections` returns a `sketched` count alongside `updated`/`unchanged`/`frozen`/`lost`/`refused`
- [ ] A `SectionSource=sketch` block is left byte-identical after a refresh
- [ ] A computed section beside it still regenerates in the same pass
- [ ] A second pass reports the same counts

**Verify:** `./tests/run_all.sh` → `### CROSS SECTION OK`

**Steps:**

- [ ] **Step 1: Write the failing test**

Append to `tests/cross_section_run.js`, before the final `if (failures.length === 0)` block:

```javascript
// ---- a SKETCHED section is never regenerated -------------------------
// The gate that makes hand tracing possible at all. A computed section
// re-derives from the survey; a traced one has no survey to re-derive
// from and must be left exactly alone -- but COUNTED, because a stale
// section on a plotted map is the failure this refresh exists to
// prevent.
var sketchId = CsCallout.newId();
var sketchName = CsSectionDraw.blockName(sketchId);
var sketchBlock = new RBlock(doc, sketchName, new RVector(0, 0));
di.applyOperation(new RAddObjectOperation(sketchBlock, false));
var sketchBlockId = doc.getBlockId(sketchName);

var traced = new RLineEntity(doc,
    new RLineData(new RVector(-3, -3), new RVector(3, 3)));
traced.setBlockId(sketchBlockId);
var sop = new RAddObjectsOperation();
sop.addObject(traced, false);

var sketchRef = new RBlockReferenceEntity(doc,
    new RBlockReferenceData(sketchBlockId, new RVector(200, 200),
        new RVector(1, 1), 0.0));
CsTags.set(sketchRef, CsCallout.KEY.ID, sketchId);
CsTags.set(sketchRef, CsCallout.KEY.ROLE, CsCallout.ROLE_BLOCK);
CsTags.set(sketchRef, CsCallout.KEY.KIND, CsCallout.KIND_SECTION);
CsTags.set(sketchRef, CsCallout.KEY.SECTION_SOURCE,
    CsCallout.SOURCE_SKETCH);
CsTags.set(sketchRef, CsCallout.KEY.SECTION_STATION, "A1");
sop.addObject(sketchRef, false);
di.applyOperation(sop);

var beforeCount = doc.queryBlockEntities(sketchBlockId).length;
var sketchReport = CalloutWrite.refreshSectionsFromDocument(doc, di);
check("a sketched section is counted, not skipped in silence",
    sketchReport !== null && sketchReport.sketched === 1);
check("a sketched section is never re-derived",
    doc.queryBlockEntities(sketchBlockId).length === beforeCount);
var stillThere = doc.queryEntity(sketchRef.getId());
check("and its reference is left exactly where it was",
    !isNull(stillThere) &&
    stillThere.getData().getPosition().x === 200);
```

- [ ] **Step 2: Run it to verify it fails**

Run:

```bash
/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui \
    -allow-multiple-instances -autostart tests/cross_section_run.js "$PWD"
```

Expected: `### CROSS SECTION FAIL` with `FAIL: a sketched section is counted, not skipped in silence` (the report has no `sketched` field, so it is `undefined`).

- [ ] **Step 3: Add the gate**

In `CalloutWrite.refreshSections`, extend the report and insert the check immediately BEFORE the `SECTION_FROZEN` check (a sketched section is not frozen — it was never generated in the first place):

```javascript
    var out = { updated: 0, unchanged: 0, frozen: 0, lost: 0, refused: 0,
        sketched: 0 };
```

```javascript
        // TRACED BY HAND, from a scan. There is nothing to re-derive:
        // the geometry never came from the survey, so "refreshing" it
        // would mean replacing a caver's tracing with an LRUD box. Left
        // alone and COUNTED, the treatment SECTION_FROZEN already gets.
        // Its LEADER still re-anchors elsewhere, so a sketched section
        // follows the survey without its outline being touched.
        if (CsTags.get(m.block, CsCallout.KEY.SECTION_SOURCE) ===
                CsCallout.SOURCE_SKETCH) {
            out.sketched++;
            continue;
        }
```

- [ ] **Step 4: Run it to verify it passes**

Run the same command as Step 2.
Expected: `### CROSS SECTION OK <n>`

- [ ] **Step 5: Mutation-test the gate**

Temporarily invert the comparison:

```javascript
        if (CsTags.get(m.block, CsCallout.KEY.SECTION_SOURCE) !==
                CsCallout.SOURCE_SKETCH) {
```

Run the same command.
Expected: FAIL on `"a sketched section is never re-derived"`. Revert and re-run to green.

This step is not optional. Four tests in this suite have passed while the thing they named was broken, and every one was found by mutating the code — none by reading it.

- [ ] **Step 6: Commit**

```bash
git add scripts/CaveSurvey/Callout/CalloutWrite.js tests/cross_section_run.js
git commit -m "fix(CalloutWrite): Draw never regenerates over a sketched section"
```

---

### Task 6: Edit Sketch reopens the bay

**Goal:** Selecting a sketched section and running Edit Sketch reopens a bay holding that section's linework, its scan at the same fit and the station's ghost — so a section can be revised against the field book instead of by memory.

**Files:**
- Create: `scripts/CaveSurvey/SketchSection/SectionEdit.js`
- Create: `scripts/CaveSurvey/SketchSection/SectionEdit.svg`

**Acceptance Criteria:**
- [ ] Running with nothing selected explains what to select, rather than doing nothing
- [ ] Running on a computed (non-sketch) section explains that only sketched sections reopen
- [ ] The reopened bay holds the block's entities, exploded back to loose linework at the bay origin
- [ ] The scan returns at the stored `SectionBayFit`
- [ ] A missing scan file reopens the bay without an underlay and names the file it could not find
- [ ] The block reference is deleted on reopen, and re-created by the next Capture — the section is in exactly one place at a time

**Verify:** `./tests/run_all.sh` → `### SECTION SKETCH OK` (Task 7 covers the round trip)

**Steps:**

- [ ] **Step 1: Write the tool**

Create `scripts/CaveSurvey/SketchSection/SectionEdit.js`:

```javascript
/**
 * SectionEdit -- reopen a sketched section's bay and carry on tracing.
 *
 * WHY REOPENING RATHER THAN BLOCK EDITING. The scan is the point. A
 * section traced from a field book is revised AGAINST that field book,
 * and editing the block in place would mean re-inserting and
 * re-scaling the scan by hand every time. The reference carries the
 * scan path and the fit, so the bay comes back exactly as it was --
 * the revision framework's rule one kind over: the drawing is
 * reconstructible from what is stored on it.
 *
 * THE SECTION EXISTS IN EXACTLY ONE PLACE AT A TIME. Reopening DELETES
 * the placed reference and puts its linework loose in the bay; Capture
 * puts it back. A drawing showing both at once would print both.
 *
 * USAGE:
 *   select a sketched section, then
 *   Cave Survey > Edit Sketch   (or "sectionedit" / "ske")
 */
include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");
include(includeBasePath + "/SketchSection.js");

function SectionEdit(guiAction) {
    EAction.call(this, guiAction);
}

SectionEdit.prototype = new EAction();

SectionEdit.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    SectionEdit.run();
    this.terminate();
};

SectionEdit.run = function() {
    var doc = EAction.getDocument();
    var di = EAction.getDocumentInterface();
    if (isNull(doc) || isNull(di)) {
        return;
    }
    var ref = SectionEdit.selectedSection(doc);
    if (ref === null) {
        SketchSection.say(qsTr("Select the cross section to edit " +
            "first -- click the section itself, not its leader."));
        return;
    }
    if (CsTags.get(ref, CsCallout.KEY.SECTION_SOURCE) !==
            CsCallout.SOURCE_SKETCH) {
        SketchSection.say(qsTr("That section was computed from the " +
            "survey's own LRUD, not traced, so there is no sketch to " +
            "reopen.\n\nDraw re-derives it whenever the survey changes."));
        return;
    }

    var station = CsTags.get(ref, CsCallout.KEY.SECTION_STATION);
    var scan = CsTags.get(ref, CsCallout.KEY.SECTION_SCAN);
    var fit = CsSectionBay.parseFit(CsTags.get(ref, CsCallout.KEY.SECTION_FIT));

    var bayId = SketchSection.run(scan === "" ? null : scan, station);
    if (bayId === null) {
        return;
    }
    if (scan !== "" && !(new QFile(scan)).exists()) {
        SketchSection.say(qsTr("The scan this section was traced from " +
            "is not where it was:\n\n%1\n\nThe bay is open with the " +
            "tracing and the outline; the underlay is missing.")
            .arg(scan));
    }
    SectionEdit.explodeInto(doc, di, ref, bayId, fit);
};

/** The one selected block reference that is a section, or null. */
SectionEdit.selectedSection = function(doc) {
    if (!doc.hasSelection()) {
        return null;
    }
    var ids = doc.querySelectedEntities();
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        if (CsTags.get(e, CsCallout.KEY.KIND) === CsCallout.KIND_SECTION &&
                CsTags.get(e, CsCallout.KEY.ROLE) === CsCallout.ROLE_BLOCK) {
            return e;
        }
    }
    return null;
};

/** Put the block's entities back into the bay, loose, and remove the
 *  placed reference and its leaders. */
SectionEdit.explodeInto = function(doc, di, ref, bayId, fit) {
    var blockId = ref.getData().getReferencedBlockId();
    var origin = SectionEdit.bayOriginOf(doc, bayId);
    if (origin === null) {
        return;
    }
    var op = new RAddObjectsOperation();
    op.setText("Reopen section sketch");
    var ids = doc.queryBlockEntities(blockId);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var copy = e.clone();
        copy.setBlockId(doc.getModelSpaceBlockId());
        copy.move(new RVector(origin.x, origin.y));
        op.addObject(copy, false);
    }
    var calloutId = CsTags.get(ref, CsCallout.KEY.ID);
    var members = CalloutWrite.members(doc, calloutId);
    for (var li = 0; li < members.leaders.length; li++) {
        op.deleteObject(members.leaders[li]);
    }
    op.deleteObject(ref);
    di.applyOperation(op);
};

/** The centre of the bay just opened, which is where the block's own
 *  origin belongs. */
SectionEdit.bayOriginOf = function(doc, bayId) {
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        if (CsTags.get(e, SketchSection.TAG_BAY) !== bayId) {
            continue;
        }
        if (CsTags.get(e, "SectionBayRole") !== SketchSection.ROLE_GHOST &&
                CsTags.get(e, "SectionBayRole") !== SketchSection.ROLE_FRAME) {
            continue;
        }
        e.update();
        var b = e.getBoundingBox();
        return { x: (b.getMinimum().x + b.getMaximum().x) / 2,
                 y: (b.getMinimum().y + b.getMaximum().y) / 2 };
    }
    return null;
};

SectionEdit.init = function(basePath) {
    var action = new RGuiAction(qsTr("Edit Sketch"),
                                RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/SectionEdit.js");
    action.setIcon(basePath + "/SectionEdit.svg");
    action.setStatusTip(qsTr("Reopen a traced cross section's bay, with " +
        "its scan, to carry on sketching"));
    action.setDefaultCommands(["sectionedit", "ske"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(49);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
```

Add the `CalloutWrite` include at the top, beside the others:

```javascript
include(includeBasePath + "/../Callout/CalloutWrite.js");
```

- [ ] **Step 2: Draw `SectionEdit.svg`**

Same house style; start from `CrossSection/CrossSection.svg`.

- [ ] **Step 3: Verify**

Run: `./tests/run_all.sh`
Expected: section 1 and section 2 pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/CaveSurvey/SketchSection/SectionEdit.js scripts/CaveSurvey/SketchSection/SectionEdit.svg
git commit -m "feat(SectionEdit): reopen a traced section's bay against its scan"
```

---

### Task 7: The lifecycle proved against a real document

**Goal:** A headless test drives the whole sequence — open a bay, trace into it, capture, refresh, reopen — against a real `RDocument`, and `run_all.sh` runs it.

**Files:**
- Create: `tests/section_sketch_run.js`
- Modify: `tests/run_all.sh`
- Modify: `VERSION`
- Modify: `README.md` (tool list), `tests/README.md` (test list)

**Acceptance Criteria:**
- [ ] The test prints `### SECTION SKETCH OK <n>` on success
- [ ] It proves the sweep excludes the scan, the ghost and the frame
- [ ] It proves the block is block-local about the ghost centre
- [ ] It proves the placed reference clears every plan obstacle by the margin
- [ ] It proves a DXF round trip preserves the block, the reference and all five tags
- [ ] `run_all.sh` runs it and fails the suite when it fails
- [ ] `VERSION` reads 0.9.38.0

**Verify:** `./tests/run_all.sh` → every section passes, ending with a zero exit status (`echo $?` → `0`)

**Steps:**

- [ ] **Step 1: Write the engine test**

Create `tests/section_sketch_run.js`, following `tests/cross_section_run.js`'s shape exactly — same `isNull` shim, same `loadRepoScript`, same `check`/`failures` reporting:

```javascript
// section_sketch_run.js -- the sketched-section lifecycle against a REAL
// document: open a bay, trace into it, capture, refresh, reopen.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/section_sketch_run.js "$PWD"
//
// Prints "### SECTION SKETCH OK" on success.
//
// WHY THIS FILE EXISTS RATHER THAN MORE UNIT TESTS. CsSectionBay's
// maths are node-tested and none of them is where this feature can
// break. What can break is everything that only exists once there is an
// RDocument: a sweep measured against a STALE bounding box, a block
// whose entities are placed in world coordinates instead of block-local
// ones, tags that survive in memory and vanish through DXF, and an
// off layer that accepts a write and keeps nothing.

// [same isNull shim, args/repoRoot and loadRepoScript as
//  tests/cross_section_run.js -- copy them verbatim]

var CORE = ["CsUuid", "CsUnits", "CsAngles", "CsModel", "CsFrontier",
    "CsTraverse", "CsNetwork", "CsAdjust", "CsLrud", "CsSectionCut",
    "CsTags", "CsStore", "CsLayers", "CsCallout", "CsSectionDraw",
    "CsSectionBay", "CsRevise", "CsStationOrder", "CsScanFrame"];
for (var ci = 0; ci < CORE.length; ci++) {
    loadRepoScript("scripts/CaveSurvey/Core/" + CORE[ci] + ".js");
}
loadRepoScript("scripts/CaveSurvey/Callout/CalloutWrite.js");
loadRepoScript("scripts/CaveSurvey/SketchSection/SketchSection.js");
loadRepoScript("scripts/CaveSurvey/SketchSection/SectionCapture.js");

var failures = [];
var checks = 0;
function check(what, condition) {
    checks++;
    if (!condition) {
        failures.push(what);
    }
}

// ---- a document with a survey and a wall ----------------------------
// [build an RDocument + RDocumentInterface, add two tagged station
//  points A1 (0,0) and A2 (10,0), and one line on WALLS-SURVEYED beside
//  them -- the same construction cross_section_run.js uses]

// ---- open a bay ------------------------------------------------------
var bayId = SketchSection.run(null, "A1");
check("a bay opens", bayId !== null);
var bay0 = SectionCapture.findBay(doc);
check("the bay is found again by its frame", bay0 !== null);
check("with nothing traced in it yet", bay0.traced.length === 0);

// ---- trace into it ---------------------------------------------------
var centre = SectionCapture.originOf(bay0);
var traceOp = new RAddObjectsOperation();
var wall = new RLineEntity(doc, new RLineData(
    new RVector(centre.x - 3, centre.y - 3),
    new RVector(centre.x + 3, centre.y + 3)));
wall.setLayerId(doc.getLayerId(CsLayers.SECTION_WALLS_SURVEYED));
traceOp.addObject(wall, false);
di.applyOperation(traceOp);

var bay1 = SectionCapture.findBay(doc);
check("the tracing is swept", bay1.traced.length === 1);
check("and the ghost and frame are NOT", bay1.traced.length === 1);

// ---- capture ---------------------------------------------------------
var at = SectionCapture.proposePosition(doc, bay1);
check("a position is proposed", at !== null);
var id = SectionCapture.capture(doc, di, bay1, at);
check("the section is captured", id !== null);

var members = CalloutWrite.members(doc, id);
check("it is a block reference", members.block !== null);
check("tagged as a sketch",
    CsTags.get(members.block, CsCallout.KEY.SECTION_SOURCE) ===
        CsCallout.SOURCE_SKETCH);
check("carrying its station",
    CsTags.get(members.block, CsCallout.KEY.SECTION_STATION) === "A1");
check("and leadered", members.leaders.length === 1);

// BLOCK-LOCAL. The tracing ran from centre-3 to centre+3 in world
// coordinates; inside the block it must run -3 to +3, or every section
// lands a bay's width away from its own leader.
var inBlock = doc.queryBlockEntities(
    members.block.getData().getReferencedBlockId());
check("the block holds the tracing", inBlock.length === 1);
var held = doc.queryEntity(inBlock[0]);
held.update();
check("block-local about the ghost centre",
    Math.abs(held.getBoundingBox().getMinimum().x + 3) < 1e-6);

// THE BAY IS GONE. A frame left behind would be swept into the NEXT
// section as well.
check("the bay is torn down", SectionCapture.findBay(doc) === null);

// ---- Draw leaves it alone -------------------------------------------
var before = doc.queryBlockEntities(
    members.block.getData().getReferencedBlockId()).length;
var report = CalloutWrite.refreshSectionsFromDocument(doc, di);
check("a refresh counts it as sketched",
    report !== null && report.sketched === 1);
check("and changes nothing inside it",
    doc.queryBlockEntities(
        members.block.getData().getReferencedBlockId()).length === before);

// ---- a DXF round trip ------------------------------------------------
// [export to a temp .dxf via RDocumentInterface.exportFile, import into
//  a fresh document, and re-check the block, the reference and all five
//  tags -- the profile_draw_roundtrip.js helpers are the pattern]

if (failures.length === 0) {
    print("### SECTION SKETCH OK " + checks);
} else {
    for (var f = 0; f < failures.length; f++) {
        print("FAIL: " + failures[f]);
    }
    print("### SECTION SKETCH FAIL " + failures.length + " of " + checks);
}
```

The three bracketed comments are the parts to copy from the named existing tests rather than invent — the document construction from `cross_section_run.js`, the round-trip helpers from `profile_draw_roundtrip.js`. Fill them in with real code; do not leave a bracket in the committed file.

- [ ] **Step 2: Run it and watch it fail honestly**

Run:

```bash
/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui \
    -allow-multiple-instances -autostart tests/section_sketch_run.js "$PWD"
```

Expected on first run: failures naming whichever of Tasks 3–6 is not yet exactly right. Fix the tool, not the test, unless the test's own expectation is wrong.

- [ ] **Step 3: Wire it into `run_all.sh`**

Add a section after the CalloutWrite one, and renumber the "N/12" headers to "N/13":

```bash
echo
echo "=============================================================="
echo " 8/13 Sketched cross sections (inside CaveCAD's own script engine)"
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
    echo "SKIP: CaveCAD not found -- this places real blocks in a real" \
         "RDocument and cannot run under node."
fi
```

- [ ] **Step 4: Bump the version**

```bash
echo "0.9.38.0" > VERSION
```

Hold at 0.9.X, patch bumps only, until Nathan approves a public release.

- [ ] **Step 5: Update the docs**

Add Sketch Section, Capture Section and Edit Sketch to the tool list in `README.md`, and `section_sketch_run.js` to the test list in `tests/README.md`.

- [ ] **Step 6: Run the whole suite, including the publish checks**

Run: `./tests/run_all.sh --publish`
Expected: every section passes, including the toolbar-icon and status-tip checks for the three new actions. Then:

```bash
./tests/run_all.sh; echo "exit=$?"
```

Expected: `exit=0`.

- [ ] **Step 7: Commit**

```bash
git add tests/section_sketch_run.js tests/run_all.sh tests/README.md README.md VERSION
git commit -m "test(SectionCapture): the sketched-section lifecycle, end to end

Opens a bay, traces into it, captures, refreshes and round-trips
through DXF against a real RDocument -- the four places this feature
can break that no pure test can see."
```

---

## Self-Review

**Spec coverage.** Each spec section maps to a task: D1 (bay) → Tasks 3, 4; D2 (ghost) → Task 3; D3 (containment sweep) → Tasks 1, 4; D4 (march + preview) → Tasks 1, 4; D5 (never regenerated, re-openable) → Tasks 5, 6; D6 (one scan browser) → Task 2; D7 (combo) → Task 2; D8 (bay parks and remembers) → Tasks 1, 3. The `SectionStation` dead end → Task 2. Error handling → Tasks 3, 4, 6. Testing → every task, gathered in Task 7.

**Known gap, deliberate.** D8's *remembering* is half-built: Task 3 reads the remembered corner (`SketchSection.rememberedCorner`) but nothing writes it, so the bay parks beside the plan extents every time. Writing it means noticing the frame has been dragged, which needs a transaction listener — and a listener that fires on a no-op write is how CaveCAD froze once already. Left for a follow-up rather than smuggled in here; the read path is in place for it.

**Naming consistency.** `SketchSection.TAG_BAY`/`ROLE_FRAME`/`ROLE_GHOST`/`ROLE_SCAN` are defined in Task 3 and used unchanged in Tasks 4, 6 and 7. `CsCallout.KEY.SECTION_SOURCE`/`SECTION_SCAN`/`SECTION_FIT`/`SECTION_STATION` and `CsCallout.SOURCE_SKETCH` are defined in Task 3 and used unchanged in Tasks 4, 5, 6 and 7. `CsSectionBay`'s eleven functions are defined in Task 1 and called with those exact signatures in Tasks 3 and 4.

**Placeholders.** The three bracketed passages in Task 7 Step 1 name the exact existing file to copy from, and Step 1 says explicitly they must not survive into the commit. Nothing else defers work.
