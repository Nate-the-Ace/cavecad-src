# Frame-aware Scan Shelf Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Scan Shelf insert and align PROFILE sketches as well as plan sketches, and make every redraw re-anchor aligned scans to the stations they were fitted to.

**Architecture:** A frame dropdown on the Scan Shelf writes a `ScanFrame` tag on the inserted image. Align Image reads that tag off the entity and asks a new Core module, `CsScanFrame`, for the matching station table (`Station` for plan, `ProfileStation` for the one band the image sits in) instead of calling `CsTags.collectStations` directly. On apply it records each matched station's position in image-local normalised coordinates (`ScanAnchors`), which survives every later move, rotate, resize and warp. A redraw pass then re-solves those anchors against the regenerated station points and re-places the scan, inside the redraw's own transaction.

**Tech Stack:** QCAD/CaveCAD ECMAScript add-on (QCAD 3.33 fork), Qt 6 script bridge, `tests/run_all.sh` (Python unittest + drivers inside CaveCAD's headless engine), node for the pure Core tests.

**User decisions (already made):**
- "let's just have a check box that is off by default that says 'Profile Sketch?'" — superseded in the same conversation by: "with a crosssection, maybe we make that a drop down list of 'Plan, Profile, Cross Section' and make that the decider on where it goes." One dropdown, default Plan.
- "We do not prectice vertical exageration in cave carto that i do." — exaggeration gets a warning, not a design.
- "place them in a grid pattern underneath all the profiles" — section frames, answering open question 2 of the cross-section spec. Out of scope here; recorded so Task 3's `section` frame answer matches it.
- "on a redraw, we need to make sure all the redraws can also move and readjust the surveyscans that are tied to stations properly." — Tasks 7 and 8.
- "no, the separate drawing was dropped a while ago" — the elevation is a region of the plan drawing. One document, one coordinate space.

**Spec:** `docs/superpowers/specs/2026-08-29-frame-aware-scan-shelf-design.md`

**Scope note:** This plan implements steps 1–3 of the spec's sequencing. Cross Section mode ships as a DISABLED combo entry and a `section` answer from `CsLayers.frameOf`; the section provider returns an empty station table until C5 (`docs/superpowers/specs/2026-08-29-cross-section-design.md`) builds section frames. Everything here is shippable without it.

**Before starting:** the working tree has uncommitted 0.9.20.0 work in `scripts/CaveSurvey/AlignImage/AlignImage.js` and `tests/align_image_frame.js` (the Align Image station box). Task 1 rewrites that same file. Commit or stash it first, or the extraction is happening under a moving target.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/CaveSurvey/Core/CsScanFit.js` | **New.** The similarity and affine solvers, residuals, and anchor encode/decode. Plain `{x, y}` objects, no QCAD symbols, so it runs under node. |
| `scripts/CaveSurvey/Core/CsScanFrame.js` | **New.** "What frame is this, what box does it offer, what stations does it know?" Plan and profile providers; a section stub. |
| `scripts/CaveSurvey/Core/CsScanReanchor.js` | **New.** The document-side redraw pass: find anchored scans, re-solve, re-place, report. |
| `scripts/CaveSurvey/Core/CsLayers.js` | Two new scan layers, `section` frame classification. |
| `scripts/CaveSurvey/AlignImage/AlignImage.js` | Delegates its maths to `CsScanFit`, its station table to `CsScanFrame`, writes `ScanAnchors`. |
| `scripts/CaveSurvey/SketchScans/SketchScans.js` | Frame combo, mode-aware insert box, layer and `ScanFrame` tag. |
| `scripts/CaveSurvey/Core/CsProfileDraw.js` | Calls the re-anchor pass after render. |
| `scripts/CaveSurvey/Core/CsDraw.js` | Calls the re-anchor pass on the plan pass; surfaces its counts. |
| `tests/js_unit.js` | Node-side tests for `CsScanFit` and the pure half of `CsScanFrame`. |
| `tests/scan_reanchor_run.js` | **New.** Headless CaveCAD driver for the redraw pass. |
| `tests/align_image_frame.js` | Extended: a plan warp must not reach a profile-frame scan. |
| `tests/test_addon.py` | Pins the new layer constants and their `DEFAULTS` rows. |

---

## Task 1: CsScanFit — the solvers, out of the tool

**Goal:** Move Align Image's fitting maths into a Core module that runs under node, with the tool delegating to it and behaving identically.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsScanFit.js`
- Modify: `scripts/CaveSurvey/Core/CsAll.js` (include the new file)
- Modify: `scripts/CaveSurvey/AlignImage/AlignImage.js:321-513` (`getCentroids`, `computeSimilarityFit`, `computeAffineFit`, `applyAffine`, `getResiduals`)
- Modify: `tests/js_unit.js` (add to `CORE_FILES`, add the test block)

**Acceptance Criteria:**
- [ ] `CsScanFit.similarityFit`, `CsScanFit.affineFit`, `CsScanFit.applyAffine` and `CsScanFit.residuals` take and return plain `{x, y}` objects and reference no QCAD symbol.
- [ ] `AlignImage.computeSimilarityFit`, `computeAffineFit`, `applyAffine` and `getResiduals` still exist with their current signatures and return `RVector`s where they did before; each is now a thin adapter over `CsScanFit`.
- [ ] `scripts/CaveSurvey/Core/CsScanFit.js` is in `CORE_FILES` in `tests/js_unit.js`.
- [ ] Node unit tests cover: a known three-point affine; a two-point similarity preserving its rotation; a collinear three-point set returning null from `affineFit`.

**Verify:** `node tests/js_unit.js` → prints `### UNIT OK <n> assertions` with n larger than before

**Steps:**

- [ ] **Step 1: Read the code being moved**

Read `scripts/CaveSurvey/AlignImage/AlignImage.js:321-513`. The four functions to move are `getCentroids`, `computeSimilarityFit`, `computeAffineFit`, `applyAffine` and `getResiduals`. They construct `RVector` and call `.operator_subtract`, `.getAngle`, `.getMagnitude`, `.getDistanceTo`. Every one of those has a plain-arithmetic equivalent; that substitution is the whole job.

- [ ] **Step 2: Write the failing test in `tests/js_unit.js`**

Add near the `CsScanTree` block (search for `// CsScanTree --`), following the same IIFE idiom:

```javascript
// ---------------------------------------------------------------------
// CsScanFit -- the fitting maths behind Align Image and the redraw
// re-anchor pass. Plain {x, y}, so it runs under node.
// ---------------------------------------------------------------------

(function() {
    // A known affine: scale 2 across, 3 down, then move by (10, 5).
    var pairs = [
        { source: { x: 0, y: 0 }, dest: { x: 10, y: 5 } },
        { source: { x: 1, y: 0 }, dest: { x: 12, y: 5 } },
        { source: { x: 0, y: 1 }, dest: { x: 10, y: 8 } }
    ];
    var m = CsScanFit.affineFit(pairs);
    ok(m !== null, "CsScanFit.affineFit: three points give a fit");
    near(m.a, 2, 1e-9, "CsScanFit.affineFit: x scale");
    near(m.e, 3, 1e-9, "CsScanFit.affineFit: y scale");
    near(m.b, 0, 1e-9, "CsScanFit.affineFit: no x shear");
    near(m.d, 0, 1e-9, "CsScanFit.affineFit: no y shear");
    var p = CsScanFit.applyAffine(m, { x: 1, y: 1 });
    near(p.x, 12, 1e-9, "CsScanFit.applyAffine: x");
    near(p.y, 8, 1e-9, "CsScanFit.applyAffine: y");

    // Collinear sources say nothing about the direction across the line.
    var line = [
        { source: { x: 0, y: 0 }, dest: { x: 0, y: 0 } },
        { source: { x: 1, y: 0 }, dest: { x: 1, y: 0 } },
        { source: { x: 2, y: 0 }, dest: { x: 2, y: 0 } }
    ];
    ok(CsScanFit.affineFit(line) === null,
        "CsScanFit.affineFit: collinear sources give no fit");

    // Two pairs: a quarter turn and a doubling.
    var sim = CsScanFit.similarityFit([
        { source: { x: 0, y: 0 }, dest: { x: 0, y: 0 } },
        { source: { x: 1, y: 0 }, dest: { x: 0, y: 2 } }
    ]);
    ok(sim !== null, "CsScanFit.similarityFit: two points give a fit");
    near(sim.factor, 2, 1e-9, "CsScanFit.similarityFit: factor");
    near(sim.angle, Math.PI / 2, 1e-9, "CsScanFit.similarityFit: angle");

    var res = CsScanFit.residuals(pairs, function(pt) {
        return CsScanFit.applyAffine(m, pt);
    });
    near(res.average, 0, 1e-9, "CsScanFit.residuals: exact fit averages zero");
    near(res.worst, 0, 1e-9, "CsScanFit.residuals: exact fit worst is zero");
})();
```

- [ ] **Step 3: Run it and watch it fail**

Run: `node tests/js_unit.js`
Expected: FAIL — `CsScanFit is not defined`.

- [ ] **Step 4: Write `scripts/CaveSurvey/Core/CsScanFit.js`**

```javascript
// CsScanFit.js -- the fitting maths shared by Align Image and the
// redraw re-anchor pass.
//
// Part of the Cave Survey Core library. PLAIN {x, y} OBJECTS ONLY --
// no RVector, no document, nothing from QCAD -- because the redraw
// pass and the interactive tool must not carry two copies of this, and
// because everything here is testable under node.
//
// Align Image keeps thin RVector-shaped adapters over these functions;
// see its own header. The one rule when editing: a change here changes
// what a REDRAW does to every already-aligned scan, not just what the
// next click does.

var CsScanFit = {};

/** Two points closer than this are the same point. */
CsScanFit.TOLERANCE = 1.0e-9;

/** Below this, three source points are in a straight line and no
 *  affine can be worked out from them. Compared against the fit
 *  matrix's determinant, scaled by the spread of the sources. */
CsScanFit.COLLINEAR_TOLERANCE = 1.0e-8;

/** \return {source: {x, y}, dest: {x, y}} -- the averages. */
CsScanFit.centroids = function(pairs) {
    var sx = 0, sy = 0, dx = 0, dy = 0;
    for (var i = 0; i < pairs.length; i++) {
        sx += pairs[i].source.x;
        sy += pairs[i].source.y;
        dx += pairs[i].dest.x;
        dy += pairs[i].dest.y;
    }
    var n = pairs.length;
    return { source: { x: sx / n, y: sy / n },
             dest: { x: dx / n, y: dy / n } };
};

/**
 * The move / rotate / uniform-resize fitting the pairs as closely as
 * possible (least squares). Exact for two pairs.
 *
 * \param pairs [{source, dest}], at least two
 * \param scale false to force factor 1 (rotate and move only)
 * \return {center, offset, angle, factor} -- rotate and scale about
 *         `center`, then move by `offset` -- or null if degenerate.
 */
CsScanFit.similarityFit = function(pairs, scale) {
    if (pairs === undefined || pairs === null || pairs.length < 2) {
        return null;
    }
    var c = CsScanFit.centroids(pairs);
    // Sums of the centred coordinates: num/den give the rotation, and
    // the ratio of the spreads gives the scale.
    var num = 0, den = 0, i, sx, sy, dxv, dyv;
    for (i = 0; i < pairs.length; i++) {
        sx = pairs[i].source.x - c.source.x;
        sy = pairs[i].source.y - c.source.y;
        dxv = pairs[i].dest.x - c.dest.x;
        dyv = pairs[i].dest.y - c.dest.y;
        num += sx * dyv - sy * dxv;   // cross
        den += sx * dxv + sy * dyv;   // dot
    }
    if (Math.abs(num) < CsScanFit.TOLERANCE &&
            Math.abs(den) < CsScanFit.TOLERANCE) {
        return null;              // every source is the centroid
    }
    var angle = Math.atan2(num, den);
    var factor = 1.0;
    if (scale !== false) {
        var sourceSpread = 0, destSpread = 0;
        for (i = 0; i < pairs.length; i++) {
            sx = pairs[i].source.x - c.source.x;
            sy = pairs[i].source.y - c.source.y;
            dxv = pairs[i].dest.x - c.dest.x;
            dyv = pairs[i].dest.y - c.dest.y;
            sourceSpread += sx * sx + sy * sy;
            destSpread += dxv * dxv + dyv * dyv;
        }
        if (sourceSpread < CsScanFit.TOLERANCE) {
            return null;
        }
        factor = Math.sqrt(destSpread / sourceSpread);
    }
    // The centroid rotated and scaled about itself does not move, so
    // the offset is simply centroid-to-centroid.
    return {
        center: { x: c.source.x, y: c.source.y },
        offset: { x: c.dest.x - c.source.x, y: c.dest.y - c.source.y },
        angle: angle,
        factor: factor
    };
};

/**
 * The affine that fits the pairs as closely as possible: move, rotate,
 * stretch by different amounts across and down, and skew. Exact with
 * three pairs; least squares with more.
 *
 * \return {a, b, c, d, e, f} meaning
 *         x' = a*x + b*y + c ;  y' = d*x + e*y + f
 *         or null when the sources are collinear (no affine exists).
 */
CsScanFit.affineFit = function(pairs) {
    if (pairs === undefined || pairs === null || pairs.length < 3) {
        return null;
    }
    // Normal equations for [a b c] and [d e f] share the same 3x3
    // matrix of source moments; only the right-hand sides differ.
    var sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, n = pairs.length;
    var tx = 0, txx = 0, txy = 0, ty = 0, tyx = 0, tyy = 0;
    var i, px, py, qx, qy;
    for (i = 0; i < n; i++) {
        px = pairs[i].source.x; py = pairs[i].source.y;
        qx = pairs[i].dest.x;   qy = pairs[i].dest.y;
        sxx += px * px; sxy += px * py; syy += py * py;
        sx += px; sy += py;
        txx += qx * px; txy += qx * py; tx += qx;
        tyx += qy * px; tyy += qy * py; ty += qy;
    }
    var m = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
    var det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
              m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
              m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    // Scale the determinant by the spread, so the test means the same
    // thing on a drawing in feet as on one in metres.
    var spread = Math.max(sxx + syy, CsScanFit.TOLERANCE);
    if (Math.abs(det) < CsScanFit.COLLINEAR_TOLERANCE * spread * spread) {
        return null;
    }
    var solve = function(r0, r1, r2) {
        // Cramer's rule against the same m
        var d0 = r0 * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
                 m[0][1] * (r1 * m[2][2] - m[1][2] * r2) +
                 m[0][2] * (r1 * m[2][1] - m[1][1] * r2);
        var d1 = m[0][0] * (r1 * m[2][2] - m[1][2] * r2) -
                 r0 * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
                 m[0][2] * (m[1][0] * r2 - r1 * m[2][0]);
        var d2 = m[0][0] * (m[1][1] * r2 - r1 * m[2][1]) -
                 m[0][1] * (m[1][0] * r2 - r1 * m[2][0]) +
                 r0 * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
        return [d0 / det, d1 / det, d2 / det];
    };
    var row1 = solve(txx, txy, tx);
    var row2 = solve(tyx, tyy, ty);
    return { a: row1[0], b: row1[1], c: row1[2],
             d: row2[0], e: row2[1], f: row2[2] };
};

/** One point through an affine from affineFit. \return {x, y} */
CsScanFit.applyAffine = function(m, point) {
    return { x: m.a * point.x + m.b * point.y + m.c,
             y: m.d * point.x + m.e * point.y + m.f };
};

/**
 * How far each pair's mapped source misses its destination.
 * \param mapPoint function({x,y}) -> {x,y}
 * \return {average, worst, worstStation} -- worstStation counted from
 *         1, for people rather than for arrays.
 */
CsScanFit.residuals = function(pairs, mapPoint) {
    var total = 0, worst = 0, worstStation = 0;
    for (var i = 0; i < pairs.length; i++) {
        var got = mapPoint(pairs[i].source);
        var dx = got.x - pairs[i].dest.x;
        var dy = got.y - pairs[i].dest.y;
        var miss = Math.sqrt(dx * dx + dy * dy);
        total += miss;
        if (miss > worst) {
            worst = miss;
            worstStation = i + 1;
        }
    }
    return { average: pairs.length === 0 ? 0 : total / pairs.length,
             worst: worst, worstStation: worstStation };
};
```

- [ ] **Step 5: Add it to `CORE_FILES` in `tests/js_unit.js`**

The list is hand-written and a missing file passes SILENTLY through the harness's deliberate catches — so this line is the test's own load-bearing part. Insert after the `CsScanTree` line:

```javascript
    "scripts/CaveSurvey/Core/CsScanTree.js",
    "scripts/CaveSurvey/Core/CsScanFit.js",
```

- [ ] **Step 6: Run the test — it must pass**

Run: `node tests/js_unit.js`
Expected: `### UNIT OK <n> assertions`, no `### UNIT FAIL`.

- [ ] **Step 7: Add the include to `Core/CsAll.js`**

Match the existing idiom in that file exactly (one `include(...)` line per Core module, in dependency order). `CsScanFit` depends on nothing, so it can sit beside `CsScanTree`.

- [ ] **Step 8: Make Align Image delegate**

In `scripts/CaveSurvey/AlignImage/AlignImage.js`, replace the bodies of the moved functions with adapters, keeping every existing caller working:

```javascript
/** \see CsScanFit.centroids -- RVector shaped, for this tool's callers. */
AlignImage.getCentroids = function(pairs) {
    var c = CsScanFit.centroids(pairs);
    return { source: new RVector(c.source.x, c.source.y),
             dest: new RVector(c.dest.x, c.dest.y) };
};

/** \see CsScanFit.similarityFit */
AlignImage.computeSimilarityFit = function(pairs) {
    var fit = CsScanFit.similarityFit(pairs, true);
    if (fit === null) {
        return undefined;      // this tool's callers test with isNull
    }
    return { center: new RVector(fit.center.x, fit.center.y),
             offset: new RVector(fit.offset.x, fit.offset.y),
             angle: fit.angle, factor: fit.factor };
};

/** \see CsScanFit.affineFit */
AlignImage.computeAffineFit = function(pairs) {
    var m = CsScanFit.affineFit(pairs);
    return m === null ? undefined : m;
};

/** \see CsScanFit.applyAffine */
AlignImage.applyAffine = function(m, point) {
    var p = CsScanFit.applyAffine(m, point);
    return new RVector(p.x, p.y);
};

/** \see CsScanFit.residuals */
AlignImage.getResiduals = function(pairs, mapPoint) {
    return CsScanFit.residuals(pairs, function(pt) {
        return mapPoint(new RVector(pt.x, pt.y));
    });
};
```

`AlignImage.js` already includes `Core/CsAll.js`; confirm that line is present near the top and add it if not.

- [ ] **Step 9: Run the full suite**

Run: `./tests/run_all.sh`
Expected: sections 1/10 through 10/10 with no `did not pass` line. `CaveCAD not found` skips are acceptable only if CaveCAD is genuinely not installed at `/Applications/CaveCAD.app`; if it is installed, sections 2–10 must actually run.

- [ ] **Step 10: Commit**

```bash
git add scripts/CaveSurvey/Core/CsScanFit.js scripts/CaveSurvey/Core/CsAll.js scripts/CaveSurvey/AlignImage/AlignImage.js tests/js_unit.js && git commit -m "refactor(CsScanFit): the align solvers move to Core, plain {x,y}

The redraw re-anchor pass needs the same maths the interactive tool
uses, and two copies would drift. Align Image keeps RVector-shaped
adapters so every existing caller is untouched.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: CsScanFit anchors — where a station sits on the paper

**Goal:** Record and read back a station's position in image-local normalised coordinates, and decide whether an image is still where its anchors say it should be.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsScanFit.js`
- Modify: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `CsScanFit.serializeAnchors` / `parseAnchors` round trip `[{name, u, v}]` through the string form `NAME@u,v;NAME@u,v`.
- [ ] `parseAnchors` returns `[]` for `""`, for malformed entries, and for entries with non-numeric coordinates — never throws.
- [ ] `CsScanFit.toLocal(frame, point)` and `CsScanFit.toWorld(frame, uv)` are exact inverses for a rotated, skewed frame.
- [ ] `CsScanFit.placementMatches(frame, anchors, plotted, tolerance)` is true when the image is where the anchors predict and false after a nudge larger than the tolerance.

**Verify:** `node tests/js_unit.js` → `### UNIT OK <n> assertions`

**Steps:**

- [ ] **Step 1: Write the failing tests in `tests/js_unit.js`**

Append inside the same `CsScanFit` area added in Task 1, as its own IIFE:

```javascript
(function() {
    // A frame rotated a quarter turn: across runs north, down runs east.
    var frame = { origin: { x: 100, y: 200 },
                  across: { x: 0, y: 10 },
                  down: { x: 4, y: 0 } };

    var uv = CsScanFit.toLocal(frame, { x: 104, y: 205 });
    near(uv.u, 0.5, 1e-9, "CsScanFit.toLocal: u");
    near(uv.v, 1.0, 1e-9, "CsScanFit.toLocal: v");
    var back = CsScanFit.toWorld(frame, uv);
    near(back.x, 104, 1e-9, "CsScanFit.toWorld: x round trips");
    near(back.y, 205, 1e-9, "CsScanFit.toWorld: y round trips");

    var text = CsScanFit.serializeAnchors([
        { name: "A1", u: 0.25, v: 0.5 },
        { name: "A2", u: 0.75, v: 0.5 }
    ]);
    var read = CsScanFit.parseAnchors(text);
    eqs(read.length, 2, "CsScanFit.parseAnchors: count");
    eqs(read[0].name, "A1", "CsScanFit.parseAnchors: name");
    near(read[1].u, 0.75, 1e-9, "CsScanFit.parseAnchors: u");

    eqs(CsScanFit.parseAnchors("").length, 0,
        "CsScanFit.parseAnchors: empty string");
    eqs(CsScanFit.parseAnchors("A1@nonsense;@0.1,0.2;B2@0.3").length, 0,
        "CsScanFit.parseAnchors: malformed entries are dropped");

    // Where the anchors say the stations are, they are.
    var anchors = [{ name: "A1", u: 0.5, v: 1.0 }];
    var plotted = { A1: { x: 104, y: 205 } };
    ok(CsScanFit.placementMatches(frame, anchors, plotted, 0.5) === true,
        "CsScanFit.placementMatches: untouched image matches");
    plotted.A1 = { x: 104, y: 215 };
    ok(CsScanFit.placementMatches(frame, anchors, plotted, 0.5) === false,
        "CsScanFit.placementMatches: a moved image does not match");
})();
```

- [ ] **Step 2: Run and watch it fail**

Run: `node tests/js_unit.js`
Expected: FAIL — `CsScanFit.toLocal is not a function`.

- [ ] **Step 3: Append to `scripts/CaveSurvey/Core/CsScanFit.js`**

```javascript
// ---------------------------------------------------------------------
// ANCHORS -- where a station sits ON THE PAPER.
//
// A frame is {origin, across, down}: the image's insertion point and
// its two EDGE vectors (the full width and the full height, not the
// per-pixel steps QCAD stores). A point in that frame is (u, v), both
// nominally 0..1 -- and that pair is invariant under every later move,
// rotate, resize and warp of the image entity, which is the whole
// reason the redraw pass can re-fit a scan it has never seen placed.
// ---------------------------------------------------------------------

/** A world point as (u, v) in the frame, or null if the frame is
 *  degenerate (zero-area image). */
CsScanFit.toLocal = function(frame, point) {
    var ax = frame.across.x, ay = frame.across.y;
    var bx = frame.down.x, by = frame.down.y;
    var det = ax * by - ay * bx;
    if (Math.abs(det) < CsScanFit.TOLERANCE) {
        return null;
    }
    var px = point.x - frame.origin.x;
    var py = point.y - frame.origin.y;
    return { u: (px * by - py * bx) / det,
             v: (ax * py - ay * px) / det };
};

/** The inverse of toLocal. \return {x, y} */
CsScanFit.toWorld = function(frame, uv) {
    return {
        x: frame.origin.x + uv.u * frame.across.x + uv.v * frame.down.x,
        y: frame.origin.y + uv.u * frame.across.y + uv.v * frame.down.y
    };
};

/** [{name, u, v}] -> "NAME@u,v;NAME@u,v". Six decimals: an anchor is a
 *  fraction of a sheet, so that is well under a pixel on any scan. */
CsScanFit.serializeAnchors = function(anchors) {
    var out = [];
    for (var i = 0; i < anchors.length; i++) {
        out.push(anchors[i].name + "@" +
            anchors[i].u.toFixed(6) + "," + anchors[i].v.toFixed(6));
    }
    return out.join(";");
};

/** The inverse. Malformed entries are DROPPED, never thrown: this text
 *  comes off a drawing a user can edit. */
CsScanFit.parseAnchors = function(text) {
    var out = [];
    if (text === undefined || text === null) {
        return out;
    }
    var parts = String(text).split(";");
    for (var i = 0; i < parts.length; i++) {
        var part = parts[i].replace(/^\s+|\s+$/g, "");
        if (part.length === 0) {
            continue;
        }
        var at = part.lastIndexOf("@");
        if (at <= 0) {
            continue;                       // no name, or no coordinates
        }
        var name = part.substring(0, at);
        var coords = part.substring(at + 1).split(",");
        if (coords.length !== 2) {
            continue;
        }
        var u = parseFloat(coords[0]);
        var v = parseFloat(coords[1]);
        if (isNaN(u) || isNaN(v)) {
            continue;
        }
        out.push({ name: name, u: u, v: v });
    }
    return out;
};

/** The anchors as fit pairs: source = the anchor's CURRENT world point
 *  in the frame, dest = where that station is plotted now. Anchors
 *  naming a station that is not in `plotted` are left out. */
CsScanFit.anchorPairs = function(frame, anchors, plotted) {
    var pairs = [];
    for (var i = 0; i < anchors.length; i++) {
        var dest = plotted[anchors[i].name];
        if (dest === undefined || dest === null) {
            continue;
        }
        pairs.push({ source: CsScanFit.toWorld(frame, anchors[i]),
                     dest: { x: dest.x, y: dest.y },
                     name: anchors[i].name });
    }
    return pairs;
};

/**
 * Is the image still where its anchors predict? True when EVERY
 * resolvable anchor lands within `tolerance` drawing units of its
 * plotted station.
 *
 * This is what keeps a redraw from stomping a scan the caver dragged
 * by hand: a placement that still matches is the tool's own work and
 * may be re-fitted; one that does not is somebody's decision.
 */
CsScanFit.placementMatches = function(frame, anchors, plotted, tolerance) {
    var pairs = CsScanFit.anchorPairs(frame, anchors, plotted);
    if (pairs.length === 0) {
        return false;
    }
    for (var i = 0; i < pairs.length; i++) {
        var dx = pairs[i].source.x - pairs[i].dest.x;
        var dy = pairs[i].source.y - pairs[i].dest.y;
        if (Math.sqrt(dx * dx + dy * dy) > tolerance) {
            return false;
        }
    }
    return true;
};
```

- [ ] **Step 4: Run the test — it must pass**

Run: `node tests/js_unit.js`
Expected: `### UNIT OK <n> assertions`.

- [ ] **Step 5: Commit**

```bash
git add scripts/CaveSurvey/Core/CsScanFit.js tests/js_unit.js && git commit -m "feat(CsScanFit): station anchors in image-local coordinates

Where a station sits on the paper is invariant under every later move,
rotate, resize and warp of the image -- which is what lets a redraw
re-fit a scan without the caver clicking anything again.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Layers — a scan layer per frame, and a section frame

**Goal:** Give profile and section scans their own layers so `CsLayers.frameOf` classifies them correctly, and teach `frameOf` the `section` answer.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsLayers.js:37` (constants), `:180` (`DEFAULTS`), `:268-285` (`frameOf`)
- Modify: `templates/NSS_Cave_Template_PLAN.dxf` (via `tools/sync_template_layers.js`)
- Modify: `tests/test_addon.py`

**Acceptance Criteria:**
- [ ] `CsLayers.PROFILE_SCAN === "CTRL-PROFILE-SCAN"` and `CsLayers.SECTION_SCAN === "CTRL-SECTION-SCAN"`, both with `DEFAULTS` rows matching `CTRL-SCAN`'s (`["gray", "CONTINUOUS", "Weight000"]`).
- [ ] `CsLayers.frameOf("CTRL-PROFILE-SCAN") === "profile"` (it already would, by prefix — assert it anyway, it is the property the whole design leans on).
- [ ] `CsLayers.frameOf("CTRL-SECTION-SCAN") === "section"` and `frameOf("SECTION-WALLS") === "section"`.
- [ ] `frameOf` still answers `"plan"` for an unrecognised layer.
- [ ] Both new layers are present in the plan template, so `test_registry_layers_exist_in_plan_template` passes.

**Verify:** `python3 -m unittest discover -s tests -v` → OK, and `node tests/js_unit.js` → `### UNIT OK`

**Steps:**

- [ ] **Step 1: Write the failing assertions in `tests/js_unit.js`**

Find the existing `CsLayers.frameOf` block (search `frameOf`) and add:

```javascript
    eqs(CsLayers.frameOf("CTRL-PROFILE-SCAN"), "profile",
        "CsLayers.frameOf: a profile scan is profile-framed");
    eqs(CsLayers.frameOf("CTRL-SECTION-SCAN"), "section",
        "CsLayers.frameOf: a section scan is section-framed");
    eqs(CsLayers.frameOf("SECTION-WALLS"), "section",
        "CsLayers.frameOf: hand-traced section linework is section-framed");
    eqs(CsLayers.frameOf("CTRL-SCAN"), "plan",
        "CsLayers.frameOf: a plain scan is plan-framed");
    eqs(CsLayers.frameOf("SOMEBODYS-OWN-LAYER"), "plan",
        "CsLayers.frameOf: an unknown layer still defaults to plan");
```

- [ ] **Step 2: Run and watch it fail**

Run: `node tests/js_unit.js`
Expected: FAIL on `CsLayers.frameOf: a section scan is section-framed` — it currently answers `plan`.

- [ ] **Step 3: Add the constants in `scripts/CaveSurvey/Core/CsLayers.js`**

Beside `CsLayers.SCAN = "CTRL-SCAN";` (line 37):

```javascript
// One scan layer per frame. CsLayers.frameOf classifies by PREFIX, so a
// profile sketch left on CTRL-SCAN reads as PLAN content -- which means
// a plan-wide warp would drag it (AlignImage.appliesTo) and it would
// swell the plan data window (CsDraw). The twin-layer split is the same
// one the PROFILE-* tracing layers already use.
CsLayers.PROFILE_SCAN = "CTRL-PROFILE-SCAN";
CsLayers.SECTION_SCAN = "CTRL-SECTION-SCAN";
```

- [ ] **Step 4: Add the `DEFAULTS` rows**

Beside `"CTRL-SCAN": ["gray", "CONTINUOUS", "Weight000"],` (line 180):

```javascript
    "CTRL-PROFILE-SCAN": ["gray", "CONTINUOUS", "Weight000"],
    "CTRL-SECTION-SCAN": ["gray", "CONTINUOUS", "Weight000"],
```

- [ ] **Step 5: Teach `frameOf` the section frame**

In `CsLayers.frameOf`, immediately after the profile check:

```javascript
    if (name.indexOf("CTRL-PROFILE-") === 0 || name.indexOf("PROFILE-") === 0) {
        return "profile";
    }
    // The section frame, both spellings, the same way. Sections do not
    // exist yet (see the cross-section design); classifying them now is
    // what lets a section scan be inserted onto a layer no plan-scoped
    // sweep will touch the moment those frames land.
    if (name.indexOf("CTRL-SECTION-") === 0 || name.indexOf("SECTION-") === 0) {
        return "section";
    }
```

Note the ordering trap: `CROSS-SECTION-MARKERS` must NOT become section-framed — it is the mark IN THE PLAN saying where a section was cut. It does not start with `SECTION-`, so the prefix test above already leaves it as plan. Add that as an assertion:

```javascript
    eqs(CsLayers.frameOf("CROSS-SECTION-MARKERS"), "plan",
        "CsLayers.frameOf: the plan's own section marks stay plan-framed");
```

- [ ] **Step 6: Put both layers in the plan template**

Run: `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tools/sync_template_layers.js "$PWD"`

Read `tools/sync_template_layers.js`'s own header first for its exact invocation and confirm it reports both new layers added. Expected: the tool prints the layers it added to `templates/NSS_Cave_Template_PLAN.dxf`.

- [ ] **Step 7: Pin the constants in `tests/test_addon.py`**

Follow `test_registry_defines_profile_control_layers` exactly (it exists because deleting a constant shrinks BOTH sides of the registry-vs-template comparison and passes):

```python
    def test_registry_defines_scan_layers_per_frame(self):
        """Same mutation gap as the profile control layers: the registry
        comparison never asserts a constant exists, so deleting one is
        invisible. A profile scan landing back on CTRL-SCAN is exactly
        the bug the twin layers exist to prevent -- it reads as plan
        content to CsLayers.frameOf, so a plan warp drags it.
        """
        with open(os.path.join(ADDON, "Core", "CsLayers.js")) as fh:
            source = fh.read()
        self.assertIn('CsLayers.PROFILE_SCAN = "CTRL-PROFILE-SCAN";', source)
        self.assertIn('CsLayers.SECTION_SCAN = "CTRL-SECTION-SCAN";', source)
        self.assertIn('"CTRL-PROFILE-SCAN": ["gray", "CONTINUOUS", "Weight000"],',
                      source)
        self.assertIn('"CTRL-SECTION-SCAN": ["gray", "CONTINUOUS", "Weight000"],',
                      source)
```

- [ ] **Step 8: Run both suites**

Run: `python3 -m unittest discover -s tests -v`
Expected: OK, including `test_registry_layers_exist_in_plan_template`.

Run: `node tests/js_unit.js`
Expected: `### UNIT OK <n> assertions`.

- [ ] **Step 9: Commit**

```bash
git add scripts/CaveSurvey/Core/CsLayers.js templates/NSS_Cave_Template_PLAN.dxf tests/test_addon.py tests/js_unit.js && git commit -m "feat(CsLayers): a scan layer per frame, and a section frame

CTRL-SCAN has no PROFILE- prefix, so frameOf read every scan as plan
content -- a plan warp would drag a profile sketch and the sketch would
swell the plan data window. CROSS-SECTION-MARKERS deliberately stays
plan-framed: it is the mark in the plan, not the section.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: CsScanFrame — what frame is this, and what does it offer

**Goal:** One module answering, for any frame: where an insert should land, and which stations can be aligned to.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsScanFrame.js`
- Modify: `scripts/CaveSurvey/Core/CsAll.js`
- Modify: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `CsScanFrame.KINDS` is `["plan", "profile", "section"]` and `CsScanFrame.layerFor(kind)` returns the matching scan layer.
- [ ] `CsScanFrame.stationsFor(doc, kind, key)` returns `{name: {x, y}}` — from `Station` tags for `plan`, from `ProfileStation` tags of the named run for `profile`, and `{}` for `section`.
- [ ] `CsScanFrame.keyAt(doc, kind, point)` returns the run key whose `ProfileBox` contains the point for `profile`, `null` for `plan`.
- [ ] `CsScanFrame.boxFor(doc, kind, point)` returns `{minX, minY, maxX, maxY}` — the plan data window, the containing `ProfileBox`, or null when a profile frame is asked about a point in no band.
- [ ] The pure helpers (`layerFor`, `KINDS`, `normaliseKind`) are tested under node; the document-reading ones are exercised by Task 8's driver.

**Verify:** `node tests/js_unit.js` → `### UNIT OK <n> assertions`

**Steps:**

- [ ] **Step 1: Write the failing test in `tests/js_unit.js`**

```javascript
// ---------------------------------------------------------------------
// CsScanFrame -- the pure half. The document-reading half is driven by
// tests/scan_reanchor_run.js inside CaveCAD.
// ---------------------------------------------------------------------

(function() {
    eqs(CsScanFrame.KINDS.length, 3, "CsScanFrame.KINDS: three frames");
    eqs(CsScanFrame.layerFor("plan"), "CTRL-SCAN",
        "CsScanFrame.layerFor: plan");
    eqs(CsScanFrame.layerFor("profile"), "CTRL-PROFILE-SCAN",
        "CsScanFrame.layerFor: profile");
    eqs(CsScanFrame.layerFor("section"), "CTRL-SECTION-SCAN",
        "CsScanFrame.layerFor: section");
    eqs(CsScanFrame.normaliseKind(""), "plan",
        "CsScanFrame.normaliseKind: empty means plan");
    eqs(CsScanFrame.normaliseKind("PROFILE"), "profile",
        "CsScanFrame.normaliseKind: case folded");
    eqs(CsScanFrame.normaliseKind("nonsense"), "plan",
        "CsScanFrame.normaliseKind: an unknown frame is plan, never a throw");
    eqs(CsScanFrame.stationTagFor("profile"), "ProfileStation",
        "CsScanFrame.stationTagFor: profile");
    eqs(CsScanFrame.stationTagFor("plan"), "Station",
        "CsScanFrame.stationTagFor: plan");
})();
```

- [ ] **Step 2: Run and watch it fail**

Run: `node tests/js_unit.js`
Expected: FAIL — `CsScanFrame is not defined`.

- [ ] **Step 3: Write `scripts/CaveSurvey/Core/CsScanFrame.js`**

```javascript
// CsScanFrame.js -- what frame a scan belongs to, and what that frame
// offers it.
//
// Part of the Cave Survey Core library. The pure helpers at the top run
// anywhere; everything taking a `doc` is QCAD-only and takes the
// document EXPLICITLY, the rule CsProfileDraw already follows.
//
// The three frames all live in ONE drawing: the elevation is a region
// of the plan drawing (the sibling -PROFILE.dxf was dropped), and the
// section grid will sit below the elevation. So the frame is a CHOICE
// the caver makes on the Scan Shelf, recorded on the image as
// ScanFrame, and not something derivable from which file is open.
//
// WHY THE STATION TABLE IS SCOPED. Plan stations carry Station;
// elevation stations carry ProfileStation, a deliberately separate
// namespace. Within the elevation a station appears once per band it
// ties into, so a name is unique only AFTER the band is chosen -- which
// is why stationsFor takes a key and profile callers resolve it by
// location through CsProfileBox.

var CsScanFrame = {};

CsScanFrame.KINDS = ["plan", "profile", "section"];

/** The tag an inserted scan carries to say which frame it belongs to. */
CsScanFrame.TAG = "ScanFrame";
/** The tag carrying its station anchors (CsScanFit.serializeAnchors). */
CsScanFrame.ANCHOR_TAG = "ScanAnchors";
/** The tag carrying its frame key -- a HINT, never trusted over the
 *  anchor names: a renamed run must not strand a scan. */
CsScanFrame.KEY_TAG = "ScanFrameKey";

/** A frame name from a tag or a combo, defaulting to plan. Never
 *  throws: this value comes off a drawing a user can edit. */
CsScanFrame.normaliseKind = function(kind) {
    if (kind === undefined || kind === null) {
        return "plan";
    }
    var name = String(kind).toLowerCase().replace(/^\s+|\s+$/g, "");
    for (var i = 0; i < CsScanFrame.KINDS.length; i++) {
        if (CsScanFrame.KINDS[i] === name) {
            return name;
        }
    }
    return "plan";
};

/** The scan layer for a frame. */
CsScanFrame.layerFor = function(kind) {
    switch (CsScanFrame.normaliseKind(kind)) {
    case "profile": return CsLayers.PROFILE_SCAN;
    case "section": return CsLayers.SECTION_SCAN;
    default:        return CsLayers.SCAN;
    }
};

/** The station tag a frame's points carry. */
CsScanFrame.stationTagFor = function(kind) {
    switch (CsScanFrame.normaliseKind(kind)) {
    case "profile": return "ProfileStation";
    case "section": return "SectionStation";
    default:        return "Station";
    }
};

/**
 * The frame key owning a point, or null.
 *
 * Profile: the band whose ProfileBox contains it (CsProfileBox), the
 * same "(by location)" rule Feature Trace's run combo defaults to.
 * Plan: null -- the plan is one frame with no key. QCAD only.
 */
CsScanFrame.keyAt = function(doc, kind, point) {
    if (CsScanFrame.normaliseKind(kind) !== "profile") {
        return null;
    }
    try {
        return CsProfileBox.at(CsProfileBox.boxes(doc), point);
    } catch (e) {
        return null;
    }
};

/**
 * Every station a scan in this frame may be aligned to:
 * {name: {x, y}}. QCAD only.
 *
 * \param key the run for a profile frame; ignored for plan; sections
 *            answer {} until the cross-section frames exist.
 */
CsScanFrame.stationsFor = function(doc, kind, key) {
    var out = {};
    var frame = CsScanFrame.normaliseKind(kind);
    if (isNull(doc)) {
        return out;
    }
    if (frame === "section") {
        return out;         // C5 has not built section frames yet
    }
    if (frame === "plan") {
        var stations = CsTags.collectStations(doc);
        for (var s = 0; s < stations.length; s++) {
            out[stations[s].name] = stations[s].pos;
        }
        return out;
    }
    // profile: ProfileStation points, scoped to ONE run. Without the
    // scoping a junction station would appear once per band and the
    // last one read would silently win.
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || typeof e.getPosition !== "function") {
            continue;
        }
        var name = CsTags.get(e, "ProfileStation");
        if (name === "") {
            continue;
        }
        if (key !== null && key !== undefined &&
                CsTags.get(e, "ProfileRun") !== key) {
            continue;
        }
        out[name] = e.getPosition();
    }
    return out;
};

/**
 * Where an inserted scan should land: {minX, minY, maxX, maxY}, or
 * null when there is no such box (a profile frame asked about a point
 * in no band, an empty drawing).
 *
 * Plan: the PLAN-FRAME extent only. The whole-document extent spans the
 * elevation region too, which is what made every plan scan insert
 * oversized once the elevation moved into this drawing. QCAD only.
 */
CsScanFrame.boxFor = function(doc, kind, point) {
    var frame = CsScanFrame.normaliseKind(kind);
    if (isNull(doc)) {
        return null;
    }
    if (frame === "profile" || frame === "section") {
        var key = CsScanFrame.keyAt(doc, frame, point);
        if (key === null) {
            return null;
        }
        var boxes = CsProfileBox.boxes(doc);
        for (var b = 0; b < boxes.length; b++) {
            if (boxes[b].key === key) {
                return { minX: boxes[b].minX, minY: boxes[b].minY,
                         maxX: boxes[b].maxX, maxY: boxes[b].maxY };
            }
        }
        return null;
    }
    return CsScanFrame.planBox(doc);
};

/** The extent of the PLAN-frame entities alone. QCAD only. */
CsScanFrame.planBox = function(doc) {
    var minX = null, minY = null, maxX = null, maxY = null;
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var layer = doc.getLayerName(e.getLayerId());
        if (CsLayers.frameOf(layer) !== "plan") {
            continue;
        }
        try {
            var bb = e.getBoundingBox();
            var lo = bb.getMinimum(), hi = bb.getMaximum();
            if (minX === null || lo.x < minX) { minX = lo.x; }
            if (minY === null || lo.y < minY) { minY = lo.y; }
            if (maxX === null || hi.x > maxX) { maxX = hi.x; }
            if (maxY === null || hi.y > maxY) { maxY = hi.y; }
        } catch (eBox) {
            // an unreadable entity contributes nothing rather than
            // poisoning the whole window
        }
    }
    if (minX === null || maxX <= minX) {
        return null;
    }
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
};
```

- [ ] **Step 4: Add to `CORE_FILES` and `CsAll.js`**

In `tests/js_unit.js`, after the `CsScanFit.js` line added in Task 1:

```javascript
    "scripts/CaveSurvey/Core/CsScanFrame.js",
```

`CsScanFrame` references `CsLayers`, `CsTags` and `CsProfileBox` only INSIDE function bodies, so load order does not matter for definition — but put its `include(...)` in `Core/CsAll.js` after `CsProfileBox`'s anyway, matching how that file orders the rest.

Note: `tests/js_unit.js` loads `CsLayers.js` in some blocks and not others (see lines 2708 and 5131). `CsScanFrame.layerFor` reads `CsLayers` constants at CALL time, and the Step 1 test calls it — so confirm `CsLayers.js` is either in `CORE_FILES` or loaded before this block runs. If it is not, add `loadRepoScript("scripts/CaveSurvey/Core/CsLayers.js");` as the first line of the test IIFE.

- [ ] **Step 5: Run — it must pass**

Run: `node tests/js_unit.js`
Expected: `### UNIT OK <n> assertions`.

- [ ] **Step 6: Commit**

```bash
git add scripts/CaveSurvey/Core/CsScanFrame.js scripts/CaveSurvey/Core/CsAll.js tests/js_unit.js && git commit -m "feat(CsScanFrame): one answer to what frame a scan belongs to

The insert box, the station table and the scan layer, per frame. The
profile station table is scoped to ONE run because a junction station
appears in every band it ties into -- unscoped, the last one read wins.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Scan Shelf — the frame dropdown

**Goal:** A Plan / Profile / Cross Section combo on the dock that decides where an inserted scan lands, which layer it goes on, and what `ScanFrame` tag it carries.

**Files:**
- Modify: `scripts/CaveSurvey/SketchScans/SketchScans.js` (`buildDock`, `insert`, `chooseInsert`)

**Acceptance Criteria:**
- [ ] The dock shows a combo with `Plan`, `Profile` and `Cross Section`, defaulting to `Plan`, remembered per session in `RSettings` under `CaveSurvey/SketchScansFrame`.
- [ ] `Cross Section` is present but DISABLED, with a tool tip saying section frames do not exist yet.
- [ ] An inserted scan lands on `CsScanFrame.layerFor(kind)` and carries `ScanFrame=<kind>` beside its existing `SketchScan=<rel>`.
- [ ] Insert sizes and centres on `CsScanFrame.boxFor(...)`, not on the whole-document extent.
- [ ] Choosing `Profile` with the view centred outside every band explains that and inserts nothing.
- [ ] A drawing whose `ProfileExaggerationStamp` is not 1 warns once on a profile insert.

**Verify:** `./tests/run_all.sh` → sections 1/10 and 2/10 pass (`### SYNTAX OK`), then a manual GUI check per the steps below.

**Steps:**

- [ ] **Step 1: Add the combo to `buildDock`**

In `scripts/CaveSurvey/SketchScans/SketchScans.js`, in the `buttons` row built just after the splitter, before `w.refreshButton`:

```javascript
    w.frame = new QComboBox();
    w.frame.addItem(qsTr("Plan"), "plan");
    w.frame.addItem(qsTr("Profile"), "profile");
    w.frame.addItem(qsTr("Cross Section"), "section");
    w.frame.toolTip = qsTr("Which view this sketch belongs to. It " +
        "decides where the scan lands, what layer it goes on, and " +
        "which stations Align Image offers.");
    try {
        // Cross Section is real as a frame (CsLayers.frameOf answers
        // "section") but nothing generates section frames yet, so
        // there is nowhere to put the scan and no station to align to.
        w.frame.model().item(2).setEnabled(false);
    } catch (eDisable) {
        // a bridge without model().item(): the entry stays selectable
        // and insert() refuses it with the same explanation
    }
    buttons.addWidget(w.frame, 0, 0);
```

Restore and remember the choice, beside the splitter-size restore already in that function:

```javascript
    try {
        var savedFrame = RSettings.getStringValue(
            SketchScans.SETTING_FRAME, "plan");
        var frameIdx = w.frame.findData(
            CsScanFrame.normaliseKind(savedFrame));
        if (frameIdx >= 0) {
            w.frame.currentIndex = frameIdx;
        }
        w.frame.currentIndexChanged.connect(function() {
            try {
                RSettings.setValue(SketchScans.SETTING_FRAME,
                    String(w.frame.itemData(w.frame.currentIndex)));
            } catch (eSaveFrame) {
            }
        });
    } catch (eFrame) {
        // a bridge without RSettings just forgets the choice
    }
```

And the setting key, beside `SETTING_SPLIT`:

```javascript
SketchScans.SETTING_FRAME = "CaveSurvey/SketchScansFrame";
```

- [ ] **Step 2: Pass the frame through `chooseInsert`**

In `chooseInsert`, after the `scansNow !== w.scans` guard, read the combo and hand it to `insert`:

```javascript
        var kind = "plan";
        try {
            kind = CsScanFrame.normaliseKind(
                w.frame.itemData(w.frame.currentIndex));
        } catch (eKind) {
        }
        var placed = SketchScans.insert(doc, di, w.scans + "/" + rel,
            rel, kind);
```

- [ ] **Step 3: Make `insert` frame-aware**

Replace the box-and-centre block at the top of `SketchScans.insert` (currently `doc.getBoundingBox(true, true)` and the `targetW` calculation) with:

```javascript
SketchScans.insert = function(doc, di, path, name, kind) {
    var frame = CsScanFrame.normaliseKind(kind);
    if (frame === "section") {
        warning("Sketch Scans: cross sections do not exist in this " +
            "drawing yet, so there is nowhere to put a section sketch. " +
            "Draw the sections first.");
        return null;
    }
    var image = new QImage(path);
    if (image.isNull()) {
        warning("Sketch Scans: " + name + " could not be read as an " +
            "image.");
        return null;
    }
    var pxW = image.width(), pxH = image.height();
    if (pxW < 1 || pxH < 1) {
        warning("Sketch Scans: " + name + " has no size.");
        return null;
    }

    // WHERE it lands is the frame's business, not the document's. The
    // whole-document extent spans the elevation region too, so sizing
    // a plan scan by it made every plan insert oversized and centred in
    // the gap between the two views.
    var box = CsScanFrame.boxFor(doc, frame, SketchScans.viewCenter(di));
    var centerX = 0, centerY = 0, targetW = 150;
    if (box === null) {
        if (frame === "profile") {
            warning("Sketch Scans: point the view at the elevation " +
                "band this sketch belongs to first -- a profile sketch " +
                "is fitted to one band, and the view centre is in none " +
                "of them.");
            return null;
        }
        // an empty plan: the 150-unit default below stands
    } else {
        centerX = (box.minX + box.maxX) / 2.0;
        centerY = (box.minY + box.maxY) / 2.0;
        targetW = Math.max(box.maxX - box.minX, 50);
    }
    if (frame === "profile") {
        SketchScans.warnIfExaggerated(doc);
    }
    var unitsPerPixel = targetW / pxW;
```

The rest of `insert` continues unchanged as far as the layer and tag writes, which become:

```javascript
    var layer = CsScanFrame.layerFor(frame);
    CsLayers.ensure(doc, di, layer);
    // Layer, tag and draw order BEFORE adding -- post-add writes fail
    // silently in this bridge (see CsDraw.js's header).
    entity.setLayerId(doc.getLayerId(layer));
    CsTags.set(entity, "SketchScan", name);
    CsTags.set(entity, CsScanFrame.TAG, frame);
```

and the two later references to `CsLayers.SCAN` in the same function's messages become `layer`.

- [ ] **Step 4: Add the two helpers `insert` now calls**

```javascript
/**
 * The middle of what the user is looking at, which is how a profile
 * insert picks its band. Falls back to the origin on a bridge without
 * a view -- boxFor then answers null and the caller explains itself.
 */
SketchScans.viewCenter = function(di) {
    try {
        var view = di.getLastKnownViewWithFocus();
        if (!isNull(view)) {
            var box = view.getBox();
            var lo = box.getMinimum(), hi = box.getMaximum();
            return new RVector((lo.x + hi.x) / 2.0, (lo.y + hi.y) / 2.0);
        }
    } catch (e) {
    }
    return new RVector(0, 0);
};

// Nathan does not practise vertical exaggeration, so this is a guard
// rather than a feature: an exaggerated band is stretched in Y while a
// 1:1 hand sketch is not, and a two-station similarity fit then cannot
// match it at all. Said once, at insert, rather than designed around.
SketchScans.warnIfExaggerated = function(doc) {
    try {
        var exag = CsProfileDraw.exaggerationOf(doc);
        if (exag !== null && Math.abs(exag - 1.0) > 1e-9) {
            EAction.handleUserWarning("Sketch Scans: this elevation is " +
                "drawn with vertical exaggeration " + exag + ", so a " +
                "1:1 sketch cannot be fitted to it with two stations. " +
                "Use three or more.");
        }
    } catch (e) {
        // no stamp readable: nothing to warn about
    }
};
```

Read `scripts/CaveSurvey/Core/CsProfileDraw.js:700-740` first and use whatever the existing reader for the exaggeration stamp is actually called; if there is no document-side reader (only `exaggerationText`), add one there in this task:

```javascript
/** The exaggeration the drawing's own stamp records, or null. */
CsProfileDraw.exaggerationOf = function(doc) {
    if (isNull(doc)) {
        return null;
    }
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var v = CsTags.get(e, "ProfileExaggerationStamp");
        if (v !== "") {
            var n = parseFloat(v);
            return isNaN(n) ? null : n;
        }
    }
    return null;
};
```

- [ ] **Step 5: Syntax check**

Run: `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/js_syntax.js "$PWD"`
Expected: `### SYNTAX OK`.

- [ ] **Step 6: Check it live**

Open CaveCAD on a cave with an elevation, open Sketch Scans, and confirm: the combo shows three entries with Cross Section greyed; a Plan insert lands over the plan at plan size (NOT spanning down into the elevation); a Profile insert with the view over a band lands inside that band's box; a Profile insert with the view over the plan refuses with the "point the view at the elevation band" message.

The MCP bridge (`mcp__cavecad__cavecad_eval`, `cavecad_screenshot`) is the fastest way to drive this without leaving the session — it is dev-only and flag-gated; see the bridge's own docs for enabling it.

- [ ] **Step 7: Commit**

```bash
git add scripts/CaveSurvey/SketchScans/SketchScans.js scripts/CaveSurvey/Core/CsProfileDraw.js && git commit -m "feat(SketchScans): a frame dropdown decides where a scan lands

Plan / Profile / Cross Section, defaulting to Plan and remembered.
Insert now sizes on the frame's own box: the whole-document extent
spans the elevation region, which had been making every plan scan
oversized and centring it in the gap between the two views.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Align Image — frame-aware targets, and anchors on apply

**Goal:** Align Image reads the frame off the image, offers that frame's stations, and records where each matched station sits on the paper.

**Files:**
- Modify: `scripts/CaveSurvey/AlignImage/AlignImage.js:591-637` (`stationContext`), `:1426-1446` (`appliesTo`), `:1496-1537` (`applyAlign`, `recordAssignedStations`)
- Modify: `tests/align_image_frame.js`

**Acceptance Criteria:**
- [ ] `stationContext()` reads `ScanFrame` off the selected image and builds its `plotted` map from `CsScanFrame.stationsFor(doc, kind, key)`; with no image selected, or no tag, it behaves exactly as today (plan).
- [ ] For a profile scan, the run key is resolved from the image's own centre through `CsScanFrame.keyAt` and recorded on the image as `ScanFrameKey`.
- [ ] On apply, the image carries `ScanAnchors` listing every station matched this run, in image-local normalised coordinates.
- [ ] `AlignImage.appliesTo` refuses entities whose layer frame differs from the frame being aligned — a plan align does not touch profile-frame entities, and a profile align does not touch plan-frame ones.
- [ ] `tests/align_image_frame.js` covers a plan warp leaving a `CTRL-PROFILE-SCAN` image alone.

**Verify:** `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/align_image_frame.js "$PWD"` → `### ALIGN IMAGE FRAME OK`

**Steps:**

- [ ] **Step 1: Extend `tests/align_image_frame.js`**

Read the file first — it loads `AlignImage.js` under a stub `Transform` and calls `AlignImage.prototype.transform` per entity, which is the only hook this repo owns. Add a case in the same idiom as the existing plan-vs-elevation one:

```javascript
// A plan warp must not reach a PROFILE SKETCH either. CTRL-SCAN has no
// PROFILE- prefix, so before the twin scan layers existed every scan
// read as plan content and a plan-wide warp dragged the elevation's
// own sketches across the sheet.
check("a plan align skips a scan on CTRL-PROFILE-SCAN",
    AlignImage.appliesTo(doc, profileScanEntity) === false);
check("a plan align still reaches a scan on CTRL-SCAN",
    AlignImage.appliesTo(doc, planScanEntity) === true);
```

Build `profileScanEntity` and `planScanEntity` the same way the existing test builds its entities — read the file's own fixture block and follow it exactly rather than inventing a second way to make an image.

- [ ] **Step 2: Run and watch it fail**

Run: `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/align_image_frame.js "$PWD"`
Expected: `### ALIGN IMAGE FRAME FAIL` naming the new check.

- [ ] **Step 3: Make `appliesTo` frame-aware**

Currently:

```javascript
    return CsLayers.frameOf(layerName) !== "profile";
```

becomes:

```javascript
    // The frame being aligned, from the image the user selected -- not
    // a constant. A profile align must leave the plan alone for exactly
    // the reason a plan align must leave the elevation alone: the
    // elevation's X axis is distance along the passage, and the two
    // frames share one drawing.
    return CsLayers.frameOf(layerName) === AlignImage.activeFrame;
```

with `AlignImage.activeFrame` set in `beginEvent` and defaulted:

```javascript
/** Which frame this run is aligning: set from the selected image's
 *  ScanFrame tag, "plan" when there is no tag to read. */
AlignImage.activeFrame = "plan";
```

In `AlignImage.prototype.beginEvent`, after the existing setup:

```javascript
    var startImage = this.getSingleImage();
    AlignImage.activeFrame = isNull(startImage) ? "plan" :
        CsScanFrame.normaliseKind(
            CsTags.get(startImage, CsScanFrame.TAG));
```

- [ ] **Step 4: Make `stationContext` ask `CsScanFrame`**

Replace the `plotted` construction (currently `CsTags.collectStations(doc)` into a map) with:

```javascript
        var image = this.getSingleImage();
        var kind = isNull(image) ? "plan" :
            CsScanFrame.normaliseKind(CsTags.get(image, CsScanFrame.TAG));
        var key = null;
        if (kind === "profile" && !isNull(image)) {
            // by location, from the image's own centre -- the same rule
            // Feature Trace's run combo defaults to
            key = CsScanFrame.keyAt(doc, kind, AlignImage.centreOf(image));
        }
        var plotted = CsScanFrame.stationsFor(doc, kind, key);
        var plottedCount = 0;
        for (var pName in plotted) {
            if (plotted.hasOwnProperty(pName)) { plottedCount++; }
        }
        if (plottedCount === 0) {
            return null;    // no table to offer: the tool asks for clicks
        }
```

and add the helper:

```javascript
/** The middle of an image entity, in world coordinates. */
AlignImage.centreOf = function(image) {
    var o = image.getInsertionPoint();
    var u = image.getUVector();
    var v = image.getVVector();
    var across = u.getMagnitude() < AlignImage.Tolerance ? 0 :
        image.getWidth() / u.getMagnitude();
    var down = v.getMagnitude() < AlignImage.Tolerance ? 0 :
        image.getHeight() / v.getMagnitude();
    return new RVector(
        o.x + (u.x * across + v.x * down) / 2.0,
        o.y + (u.y * across + v.y * down) / 2.0);
};
```

`getWidth()` and `getHeight()` return the image's size in DRAWING UNITS (`RImageData.cpp:412` — `uVector.getMagnitude2D() * image.width()`), not in pixels. So `image.getWidth() / u.getMagnitude()` is the pixel count across, and multiplying `u` by it gives the full edge vector. That relationship is what the anchor frame below is built on.

The walk order (`CsStationOrder.walkOrder(CsRevise.resolveAsDrawn(doc).survey)`) is UNCHANGED for every frame: the elevation's stations are the same survey in the same order, so the "next station in survey order" assumption still holds. Only the station-to-point table is frame-scoped.

- [ ] **Step 5: Record the anchors on apply**

In `recordAssignedStations`, alongside the existing `AlignedStations` write and inside the same `RModifyObjectsOperation`, add:

```javascript
        // Where each station sits ON THE PAPER, so a redraw can re-fit
        // this scan without anyone clicking again. Image-local and
        // normalised, which is what survives the transform that is
        // about to be -- and every later one.
        var frame = {
            origin: image.getInsertionPoint(),
            across: null, down: null
        };
        var uVec = image.getUVector(), vVec = image.getVVector();
        var acrossPx = uVec.getMagnitude() < AlignImage.Tolerance ? 0 :
            image.getWidth() / uVec.getMagnitude();
        var downPx = vVec.getMagnitude() < AlignImage.Tolerance ? 0 :
            image.getHeight() / vVec.getMagnitude();
        frame.across = { x: uVec.x * acrossPx, y: uVec.y * acrossPx };
        frame.down = { x: vVec.x * downPx, y: vVec.y * downPx };

        var anchors = CsScanFit.parseAnchors(
            CsTags.get(image, CsScanFrame.ANCHOR_TAG));
        var haveAnchor = {};
        for (i = 0; i < anchors.length; i++) {
            haveAnchor[anchors[i].name] = true;
        }
        for (i = 0; i < this.pairs.length; i++) {
            var pairName = this.pairs[i].name;
            if (pairName === undefined || pairName === null ||
                    haveAnchor[pairName] === true) {
                continue;       // an unnamed click has nothing to anchor
            }
            var local = CsScanFit.toLocal(frame, this.pairs[i].dest);
            if (local === null) {
                continue;       // zero-area image: no frame to speak of
            }
            haveAnchor[pairName] = true;
            anchors.push({ name: pairName, u: local.u, v: local.v });
        }
        CsTags.set(image, CsScanFrame.ANCHOR_TAG,
            CsScanFit.serializeAnchors(anchors));
        if (AlignImage.activeFrame === "profile") {
            var runKey = CsScanFrame.keyAt(this.getDocument(), "profile",
                AlignImage.centreOf(image));
            if (runKey !== null) {
                CsTags.set(image, CsScanFrame.KEY_TAG, runKey);
            }
        }
```

Anchors are taken from `pairs[i].dest` — the station's plotted point — AFTER the transform has applied, when the image is already sitting where the fit put it. That is the moment at which the station's world point and its position on the paper are the same thing.

This needs the station's name on the pair. In `acceptStation`, change:

```javascript
    this.pairs.push({ source: this.pendingSource, dest: pos });
```

to:

```javascript
    this.pairs.push({ source: this.pendingSource, dest: pos, name: name });
```

Pairs completed by a raw click in the drawing keep no `name`, and contribute no anchor — correct: an unnamed point is not a station and cannot be looked up again on a redraw.

- [ ] **Step 6: Run the frame test — it must pass**

Run: `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/align_image_frame.js "$PWD"`
Expected: `### ALIGN IMAGE FRAME OK`.

- [ ] **Step 7: Run the full suite**

Run: `./tests/run_all.sh`
Expected: no `did not pass` line in any section.

- [ ] **Step 8: Commit**

```bash
git add scripts/CaveSurvey/AlignImage/AlignImage.js tests/align_image_frame.js && git commit -m "feat(AlignImage): the frame comes off the image, and anchors are recorded

Align Image asks CsScanFrame for the station table matching the scan's
own ScanFrame tag -- ProfileStation, scoped to the one band the image
sits in, for a profile sketch. On apply it records where each matched
station sits on the paper, which is what the redraw pass re-fits from.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: The redraw re-anchors every scan

**Goal:** After a redraw moves generated geometry, every aligned scan follows its own stations — unless the caver moved it by hand.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsScanReanchor.js`
- Modify: `scripts/CaveSurvey/Core/CsAll.js`
- Modify: `scripts/CaveSurvey/Core/CsProfileDraw.js` (call it at the end of `render`)
- Modify: `scripts/CaveSurvey/Core/CsDraw.js` (call it on the plan pass; surface its counts beside `profile:` in the return value)

**Acceptance Criteria:**
- [ ] `CsScanReanchor.run(doc, di, frame)` walks every image carrying `ScanAnchors` whose layer frame matches, re-solves and re-places it.
- [ ] 3+ resolvable anchors give an affine; 2 give a similarity; 1 translates; 0 leaves the image alone.
- [ ] An image whose current placement does not match its anchors within `CsScanReanchor.TOLERANCE` is left alone and counted as `handMoved`.
- [ ] The re-place happens through the operation the caller passes in, so it lands in the redraw's own transaction — Ctrl+Z puts geometry and scans back together.
- [ ] `run` returns `{fitted, translated, stale, handMoved, missing}` and `CsDraw.survey`'s return value carries it, so `GenerateProfile`'s report can print it.

**Verify:** `./tests/run_all.sh` → all sections pass (Task 8 adds the driver that proves the behaviour)

**Steps:**

- [ ] **Step 1: Write `scripts/CaveSurvey/Core/CsScanReanchor.js`**

```javascript
// CsScanReanchor.js -- putting aligned scans back where their stations
// went.
//
// Part of the Cave Survey Core library. QCAD context: takes the
// document and interface explicitly.
//
// THE PROBLEM THIS EXISTS FOR. A redraw moves generated geometry --
// bands re-stack, a run grows, loop closure re-runs and every plotted
// station shifts. An aligned scan does not move with it, so a sketch
// that was traced against A3 and A4 quietly stops sitting over them.
// This already bit the PLAN side long before the elevation moved into
// the plan drawing: re-running CsAdjust orphaned every aligned scan.
//
// WHAT MAKES IT POSSIBLE. Align Image records each matched station as a
// point in the image's own normalised coordinates (CsScanFit anchors).
// That pair says where the station sits ON THE PAPER, which no later
// move, rotate, resize or warp can change -- so the scan can be re-fitted
// from the drawing alone, with no memory of how it was placed before.
//
// WHAT IT WILL NOT DO. A scan the caver dragged by hand is left exactly
// where they put it: before re-fitting, this pass predicts where the
// anchors say the image should currently be, and a placement that no
// longer matches is somebody's decision, not the tool's leftovers.

var CsScanReanchor = {};

/** How far an anchor may sit from its station before the scan counts as
 *  hand-moved. Generous: a fit with four or more stations misses by a
 *  little everywhere by construction (see AlignImage's residual
 *  report), and that must not read as a hand move. */
CsScanReanchor.TOLERANCE = 2.0;

/** The image's frame: origin and the two EDGE vectors. */
CsScanReanchor.frameOfImage = function(image) {
    var o = image.getInsertionPoint();
    var u = image.getUVector();
    var v = image.getVVector();
    var uMag = u.getMagnitude(), vMag = v.getMagnitude();
    if (uMag < 1e-12 || vMag < 1e-12) {
        return null;
    }
    var acrossPx = image.getWidth() / uMag;
    var downPx = image.getHeight() / vMag;
    return {
        origin: { x: o.x, y: o.y },
        across: { x: u.x * acrossPx, y: u.y * acrossPx },
        down: { x: v.x * downPx, y: v.y * downPx }
    };
};

/**
 * Re-places every anchored scan in one frame.
 *
 * \param doc, di   the document and its interface
 * \param frame     "plan" | "profile" | "section"
 * \param op        an operation to add the modified images to. The
 *                  CALLER owns it and applies it, which is what puts
 *                  this inside the redraw's own transaction -- a scan
 *                  moving in a transaction of its own would leave
 *                  Ctrl+Z separating the geometry from its sketches.
 * \return {fitted, translated, stale, handMoved, missing}
 */
CsScanReanchor.run = function(doc, di, frame, op) {
    var out = { fitted: 0, translated: 0, stale: 0, handMoved: 0,
                missing: [] };
    if (isNull(doc)) {
        return out;
    }
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var image = doc.queryEntity(ids[i]);
        if (isNull(image) || !isImageEntity(image)) {
            continue;
        }
        if (CsLayers.frameOf(doc.getLayerName(image.getLayerId())) !== frame) {
            continue;
        }
        var anchors = CsScanFit.parseAnchors(
            CsTags.get(image, CsScanFrame.ANCHOR_TAG));
        if (anchors.length === 0) {
            continue;             // never aligned: nothing to follow
        }
        CsScanReanchor.one(doc, image, frame, anchors, op, out);
    }
    return out;
};

/** One scan. Counted into `out`; adds to `op` when it moves. */
CsScanReanchor.one = function(doc, image, frame, anchors, op, out) {
    var imageFrame = CsScanReanchor.frameOfImage(image);
    if (imageFrame === null) {
        out.stale++;
        return;
    }
    // The key is a HINT: a renamed run must not strand a scan, so the
    // names are tried against the whole frame when the key finds
    // nothing.
    var key = CsTags.get(image, CsScanFrame.KEY_TAG);
    var plotted = CsScanFrame.stationsFor(doc, frame,
        key === "" ? null : key);
    var pairs = CsScanFit.anchorPairs(imageFrame, anchors, plotted);
    if (pairs.length === 0 && key !== "") {
        plotted = CsScanFrame.stationsFor(doc, frame, null);
        pairs = CsScanFit.anchorPairs(imageFrame, anchors, plotted);
    }
    if (pairs.length === 0) {
        out.stale++;
        for (var m = 0; m < anchors.length; m++) {
            out.missing.push(anchors[m].name);
        }
        return;
    }
    if (CsScanFit.placementMatches(imageFrame, anchors, plotted,
            CsScanReanchor.TOLERANCE)) {
        return;                   // already where it belongs
    }
    // Does the CURRENT placement look like this tool's own work? If the
    // anchors predicted the old geometry, yes. If they predicted
    // nothing recognisable, the caver moved it.
    if (!CsScanReanchor.looksPlaced(imageFrame, anchors, pairs)) {
        out.handMoved++;
        return;
    }
    if (pairs.length >= 3) {
        var affine = CsScanFit.affineFit(pairs);
        if (affine !== null) {
            CsScanReanchor.placeAffine(image, affine);
            op.addObject(image, false);
            out.fitted++;
            return;
        }
        // collinear: fall through to the similarity below
    }
    if (pairs.length >= 2) {
        var sim = CsScanFit.similarityFit(pairs, true);
        if (sim !== null) {
            CsScanReanchor.placeSimilarity(image, sim);
            op.addObject(image, false);
            out.fitted++;
            return;
        }
    }
    // one anchor: move it, do not guess a rotation or a size
    var dx = pairs[0].dest.x - pairs[0].source.x;
    var dy = pairs[0].dest.y - pairs[0].source.y;
    image.move(new RVector(dx, dy));
    op.addObject(image, false);
    out.translated++;
};

/**
 * Is the image where a fit -- rather than a hand -- put it?
 *
 * The anchors are a rigid pattern on the paper. If the image still
 * carries them in something close to the shape the stations make, the
 * placement is the tool's and re-fitting continues its work. A caver
 * who dragged the scan somewhere else broke that correspondence, and
 * gets left alone.
 *
 * Measured as: the best similarity through the pairs, applied back to
 * the anchor points, misses by less than a whole image width. Loose on
 * purpose -- this is a "did somebody take this somewhere else" test,
 * not an accuracy test.
 */
CsScanReanchor.looksPlaced = function(imageFrame, anchors, pairs) {
    if (pairs.length < 2) {
        return true;      // one anchor says nothing either way
    }
    var sim = CsScanFit.similarityFit(pairs, true);
    if (sim === null) {
        return true;
    }
    var width = Math.sqrt(imageFrame.across.x * imageFrame.across.x +
                          imageFrame.across.y * imageFrame.across.y);
    var res = CsScanFit.residuals(pairs, function(pt) {
        var vx = pt.x - sim.center.x, vy = pt.y - sim.center.y;
        var a = Math.atan2(vy, vx) + sim.angle;
        var mag = Math.sqrt(vx * vx + vy * vy) * sim.factor;
        return { x: sim.center.x + Math.cos(a) * mag + sim.offset.x,
                 y: sim.center.y + Math.sin(a) * mag + sim.offset.y };
    });
    return res.worst < width;
};

/** Re-places an image so the whole picture goes through the affine:
 *  the insertion point maps, and the two direction vectors carry the
 *  linear part -- the same trick AlignImage.applyAffineToImage uses. */
CsScanReanchor.placeAffine = function(image, m) {
    var o = image.getInsertionPoint();
    var u = image.getUVector();
    var v = image.getVVector();
    var mapped = CsScanFit.applyAffine(m, { x: o.x, y: o.y });
    // Vectors take the linear part ONLY -- c and f are the move, and
    // adding them to a direction would move the picture twice.
    image.setInsertionPoint(new RVector(mapped.x, mapped.y));
    image.setUVector(new RVector(m.a * u.x + m.b * u.y,
                                 m.d * u.x + m.e * u.y));
    image.setVVector(new RVector(m.a * v.x + m.b * v.y,
                                 m.d * v.x + m.e * v.y));
};

/** Re-places an image by a similarity: rotate and scale about the
 *  fit's centre, then move. */
CsScanReanchor.placeSimilarity = function(image, sim) {
    var center = new RVector(sim.center.x, sim.center.y);
    image.rotate(sim.angle, center);
    image.scale(sim.factor, center);
    image.move(new RVector(sim.offset.x, sim.offset.y));
};
```

Before relying on `image.rotate` / `scale` / `move` / `setUVector`, read `AlignImage.applyAffineToImage` (`AlignImage.js:545-565`) and `AlignImage.prototype.transform` (`:1447-1474`) and use exactly the calls those already make against a real `RImageEntity` in this build. If they differ from the above, follow them — they are the probed truth and this file is the copy.

- [ ] **Step 2: Add to `CsAll.js` and `CORE_FILES`**

`CsScanReanchor` uses QCAD symbols throughout, so it is NOT node-safe: add its `include(...)` to `Core/CsAll.js`, and do NOT add it to `CORE_FILES` in `tests/js_unit.js`. Task 8's driver is its test.

- [ ] **Step 3: Call it from the profile render**

At the end of `CsProfileDraw.render`, where the render's own operation is still open, add the pass over the profile frame and fold its counts into the returned counts object. Read the tail of `render` first and follow whatever operation variable it already holds; the shape is:

```javascript
    counts.reanchored = CsScanReanchor.run(doc, di, "profile", op);
```

If `render` applies its operation before returning, the re-anchor must be added BEFORE that apply. The whole point is one transaction.

- [ ] **Step 4: Call it from the plan pass**

In `CsDraw.survey`, after the adjustment and the plan geometry are drawn and before the operation is applied, add the same call with `"plan"`, and carry the result in the return value beside `profile:`:

```javascript
        scans: scanOutcome,
```

documented in the same style as the `profile:` key ("A NEW key on an object every existing caller...").

**This is the suite's own recurring failure mode** — a value computed and never surfaced. Four separate instances are on record in the profile work. So this task is not done until a reader prints it: add the counts to `GenerateProfile`'s report, in the existing report-line idiom, worded like:

```
3 scan(s) re-anchored, 1 left where you moved it, 1 stale (A7, A8 no longer in the drawing)
```

- [ ] **Step 5: Syntax check and full suite**

Run: `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/js_syntax.js "$PWD"`
Expected: `### SYNTAX OK`.

Run: `./tests/run_all.sh`
Expected: no `did not pass` line.

- [ ] **Step 6: Commit**

```bash
git add scripts/CaveSurvey/Core/CsScanReanchor.js scripts/CaveSurvey/Core/CsAll.js scripts/CaveSurvey/Core/CsProfileDraw.js scripts/CaveSurvey/Core/CsDraw.js scripts/CaveSurvey/GenerateProfile/GenerateProfile.js && git commit -m "feat(CsScanReanchor): a redraw takes the aligned scans with it

Bands re-stack, a run grows, loop closure re-runs -- and until now
every aligned scan stayed where it was and quietly stopped matching.
The anchors Align Image records make the re-fit possible without any
memory of how the scan was placed. A scan the caver dragged by hand is
left alone, and the counts are printed rather than computed and
dropped.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Prove the redraw re-anchors, headlessly

**Goal:** USER-ORDERED GATE — NON-SKIPPABLE. This task was requested by the user in the current conversation. It MUST NOT be closed by walking around it, by declaring it "verified inline", or by substituting a cheaper check. Close only after every item in the acceptance criteria has been re-validated independently, with output captured.

A driver that draws a survey, aligns a profile scan to it, regenerates with the stations moved, and asserts the scan followed — then nudges it by hand and asserts the next regeneration left it alone.

**Files:**
- Create: `tests/scan_reanchor_run.js`
- Modify: `tests/run_all.sh` (an 11th section)
- Modify: `tests/README.md`
- Modify: `VERSION` (0.9.20.0 → 0.9.21.0)
- Modify: `README.md` (the tool's row, if the frame combo changes what it claims)

**Acceptance Criteria:**
- [ ] `tests/scan_reanchor_run.js` prints `### SCAN REANCHOR OK` on success and `### SCAN REANCHOR FAIL` plus the failed assertions otherwise.
- [ ] It asserts: a profile scan with 3 anchors follows a band that moved, landing within 0.01 units of where its anchors predict.
- [ ] It asserts: the same scan, dragged 50 units by hand, is NOT moved by the next regeneration, and is counted as `handMoved`.
- [ ] It asserts: a scan whose anchored stations are gone from the drawing is left alone and counted as `stale`, with the missing names reported.
- [ ] It asserts: a scan with exactly 1 resolvable anchor is translated, not rotated (its U vector's angle is unchanged).
- [ ] `./tests/run_all.sh` runs it and fails the run when it fails.

**Verify:** `./tests/run_all.sh` → prints `### SCAN REANCHOR OK` in the new section and exits with no `did not pass` line

**Steps:**

- [ ] **Step 1: Read the two drivers this one follows**

Read `tests/generate_profile_run.js` and `tests/profile_draw_roundtrip.js` in full. They establish the shape: build an off-screen `RDocument` with a `RDocumentInterface`, draw a fixture survey, call the real entry point, read the entities back. Copy that structure exactly rather than inventing a third way to stand up a document.

- [ ] **Step 2: Write the driver**

The fixture: a short survey with two runs so the elevation has two bands; an `RImageEntity` on `CTRL-PROFILE-SCAN` tagged `ScanFrame=profile` and `ScanAnchors` naming three stations of one band, placed so its anchors sit exactly on those stations.

The four assertions, in the file's own `check(name, condition)` idiom:

```javascript
// 1. a moved band takes its scan with it
moveBandBy(doc, di, "A", new RVector(0, -25));
var out = CsScanReanchor.run(doc, di, "profile", op);
di.applyOperation(op);
check("three anchors re-fit the scan", out.fitted === 1);
checkClose("the scan followed its band",
    anchorMiss(doc, imageId), 0, 0.01);

// 2. a hand-moved scan is left alone
dragImage(doc, di, imageId, new RVector(50, 0));
var out2 = CsScanReanchor.run(doc, di, "profile", newOp());
check("a hand-moved scan is not re-fitted", out2.fitted === 0);
check("a hand-moved scan is counted", out2.handMoved === 1);

// 3. anchored stations gone: stale, and named
eraseStations(doc, di, ["A1", "A2", "A3"]);
var out3 = CsScanReanchor.run(doc, di, "profile", newOp());
check("a scan whose stations are gone is stale", out3.stale === 1);
check("the missing stations are named", out3.missing.length === 3);

// 4. one anchor translates, and does not rotate
var angleBefore = imageOf(doc, oneAnchorId).getUVector().getAngle();
var out4 = CsScanReanchor.run(doc, di, "profile", newOp());
check("one anchor translates", out4.translated === 1);
checkClose("one anchor does not rotate",
    imageOf(doc, oneAnchorId).getUVector().getAngle(), angleBefore, 1e-9);
```

Write `moveBandBy`, `dragImage`, `eraseStations`, `anchorMiss`, `imageOf` and `newOp` as real helpers in the file — `anchorMiss` re-reads the image's frame with `CsScanReanchor.frameOfImage`, maps each anchor to world with `CsScanFit.toWorld`, and returns the worst distance to that station's current plotted point.

- [ ] **Step 3: Run it and watch it fail first**

Before Task 7's code is trusted, comment out the `CsScanReanchor.run` body's re-place calls, run the driver, and confirm assertion 1 FAILS. Put them back and confirm it passes. A test that has never failed has proved nothing — this suite's own history is explicit that a rising assertion count is not coverage.

Run: `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/scan_reanchor_run.js "$PWD"`
Expected, with the body restored: `### SCAN REANCHOR OK`.

- [ ] **Step 4: Add the section to `tests/run_all.sh`**

Follow the existing sections exactly (they are identical in shape); renumber the headers from `1/10` to `1/11` through `11/11`:

```bash
echo
echo "=============================================================="
echo " 11/11 Scans follow a redraw (inside CaveCAD's own script engine)"
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
    echo "SKIP: CaveCAD not found -- this drives a real RDocument with" \
         "real image entities and cannot run under node."
fi
```

- [ ] **Step 5: Document it in `tests/README.md`**

Add its row in that file's existing table/list idiom, saying what it proves and why it needs the real engine.

- [ ] **Step 6: Bump the version**

```bash
printf '0.9.21.0\n' > VERSION
```

Hold at 0.9.X: this is not a public release, and the version stays in that series until Nathan says otherwise.

- [ ] **Step 7: Run the whole suite, publish checks included**

Run: `./tests/run_all.sh --publish`
Expected: every section 1/11 through 11/11 reports OK; no `did not pass`.

Capture the output. This is the gate's evidence — the acceptance criteria above are re-validated by this run, not by inspection.

- [ ] **Step 8: Commit**

```bash
git add tests/scan_reanchor_run.js tests/run_all.sh tests/README.md VERSION README.md && git commit -m "test: prove a redraw re-anchors the scans it should and leaves the rest

Four assertions against a real document: three anchors follow a moved
band, a hand-dragged scan is left where the caver put it, a scan whose
stations are gone is reported stale by name, and a single anchor
translates without inventing a rotation.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Notes carried forward

- **Cross Section mode stays disabled** until `docs/superpowers/specs/2026-08-29-cross-section-design.md` is approved and built. When it is, the work here needs: `CsScanFrame.stationsFor` returning `SectionStation` points, `boxFor` reading `SectionBox` cells, and the combo entry enabled. The section frame answer from `CsLayers.frameOf` and the `CTRL-SECTION-SCAN` layer already exist after Task 3.
- **A section frame has one station**, so a two-point align has no second point. That is open question 4 of the cross-section spec, and it now has a second consumer — see the spec's closing section.
- **Stale docblocks** still say the elevation lives in a sibling file: `CsProfileDraw.js:5`, `CsDraw.js:988`, `CsDraw.js:1094`. Not this plan's job, but whoever touches those files next should fix the line they are looking at.
