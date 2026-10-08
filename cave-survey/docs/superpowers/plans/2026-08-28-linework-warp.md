# Linework Warp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hand-traced linework (Feature Trace polylines and anything else `CsBind` binds to survey stations) follows a non-rigid revision or least-squares re-adjustment by bending along its own length, instead of being left in place and reported when a single whole-entity rigid fit can't describe the move.

**Architecture:** New pure module `Core/CsWarp.js` implements per-point Moving Least Squares (MLS) similarity deformation — the same weighted-centroid math `CsRevise.similarityFit` already uses, but recomputed fresh at every query point with weights from that point's distance to each control station. `CsRevise.moveLinework` calls it once per vertex/control-point/center for the five real-vertex entity types (polyline, line, arc, circle, spline); every other linework-tagged entity type (blocks, text, anything the original binding design didn't specifically cover) keeps today's unchanged whole-entity rigid-fit-with-refusal path.

**Tech Stack:** QCAD/CaveCAD ECMAScript add-on (`scripts/CaveSurvey/`), pure-JS Core modules testable under node, engine-only integration tests run via `CaveCAD -no-gui -autostart`.

**User decisions (already made):**
- Method: per-vertex Moving Least Squares similarity deformation (not a global-affine fallback, not a full Delaunay-triangulated rubber sheet).
- Weighting: inverse-square distance from the query point to each control station's OLD position.
- Scope boundary discovered during planning, not in the original brainstorm: block/text/other entity types the original linework-binding spec didn't enumerate keep the existing rigid-fit-with-refusal behavior unchanged (`CsRevise.LINEWORK_RESIDUAL_FRACTION` stays, narrowed to only that fallback path) — extending MLS to those types would be new scope not covered by the approved design doc.

---

## File Structure

- **Create** `scripts/CaveSurvey/Core/CsWarp.js` — the one new piece of math. Pure `{x,y}` in/out, no `R*` types, mirrors `Core/CsTrace.js`'s shape so it's testable under node and the engine identically.
- **Create** `tests/linework_warp.js` — engine-only integration test (real `RDocument`/`RPolylineEntity`/etc.), mirrors `tests/profile_draw_roundtrip.js`'s harness pattern.
- **Modify** `scripts/CaveSurvey/Core/CsRevise.js` — `moveLinework`'s dispatch (per-vertex warp for the five types, unchanged rigid fallback for everything else), `lineworkSummary`'s new `warped` parameter and message, `CsRevise.apply`'s non-rigid branch threading the new count through its report object.
- **Modify** `scripts/CaveSurvey/Core/CsReport.js` — both `lineworkSummary` call sites pass the new count through.
- **Modify** `scripts/CaveSurvey/SurveyNotebook/SurveyNotebook.js` — its `lineworkSummary` call site, and the undo-step note that currently only checks `lw.moved > 0`.
- **Modify** `scripts/CaveSurvey/Core/CsProfileDraw.js` — its two `{moved, unmoved}` fallback literals gain `warped: 0` so the field is never undefined downstream (this file's own call into `moveLinework` needs no change — it already hands the whole return object through as `counts.linework`).
- **Modify** `tests/js_unit.js` — new IIFE test block for `CsWarp`, inserted right after the existing pure `CsTrace` block.
- **Modify** `tests/run_all.sh` — wire in `tests/linework_warp.js` as a new numbered step.

No existing test needs deleting: the `CsRevise.LINEWORK_RESIDUAL_FRACTION` / `similarityFit` block at `tests/js_unit.js:4227-4261` keeps testing exactly what it always tested (the constant and the rigid fit), because that fallback path is unchanged.

---

### Task 1: `Core/CsWarp.js` — MLS similarity deformation, pure and tested

**Goal:** A pure function that warps one point given a set of old→new control-point pairs, using inverse-square-distance-weighted Moving Least Squares similarity, with node-level tests proving it reproduces control points exactly, matches the existing rigid fit when the data truly is rigid, and blends smoothly across a genuinely non-rigid case.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsWarp.js`
- Test: `tests/js_unit.js` (new block, inserted after the existing pure `CsTrace` block that ends at line 13931 with `}());`, right before the `// CsTrace -- the point-to-frame region test` comment)

**Acceptance Criteria:**
- [ ] `CsWarp.mlsSimilarity(point, controlPairs)` returns `null` for 0 pairs, a pure translation for 1 pair, and `{x, y, angle, factor}` for 2+.
- [ ] A point placed exactly at a control pair's `old` position warps to within `1e-6` of that pair's `nu` position, for any number of other control pairs at any distance.
- [ ] When every control pair's `nu` is the SAME single rotation+scale+translation applied to its `old` (a truly rigid case), `mlsSimilarity` evaluated at an arbitrary non-control point matches `CsRevise.applyFit(CsRevise.similarityFit(controlPairs), point)` to within `1e-9`, for both a 2-pair and a 4-pair rigid set.
- [ ] A genuinely non-rigid case (one cluster of control pairs rotates, a separate cluster translates) produces DIFFERENT warped output at query points near each cluster, and a SMOOTH (monotonic-ish, no wild overshoot) transition at points between them.
- [ ] `node tests/js_unit.js` passes with the new assertions included in the total count.

**Verify:** `node tests/js_unit.js` → `### UNIT OK <N> assertions` where N is greater than the pre-Task-1 count.

**Steps:**

- [ ] **Step 1: Write `CsWarp.js`**

```js
// CsWarp.js -- per-point Moving Least Squares (MLS) similarity
// deformation: warps one point given a set of control stations' old and
// new positions, weighted by inverse-square distance from the query
// point to each control's OLD position.
//
// Pure: plain {x, y} in and out, no document, no R* type -- callable
// under node AND under the engine identically, same discipline as
// CsTrace.js. Named CsWarp and not Warp because QCAD's include() dedupes
// by BASENAME (see CsTrace.js's own header comment, and
// qcad-plugin-conventions).
//
// The math is CsRevise.similarityFit's own weighted-centroid formula
// (compare CsRevise.js:504), just weighted per control pair and
// recomputed FRESH at every query point instead of once globally. This
// is why a rigid dataset (every control pair explained by ONE global
// similarity transform) reproduces that same transform everywhere,
// regardless of the point-specific weights: a weighted least-squares
// fit to data that is EXACTLY explained by one linear model recovers
// that model's parameters no matter how the weights are chosen, as
// long as at least two non-coincident control points are in play.

var CsWarp = {};

/**
 * Guards the 1/distSq weight against a literal divide-by-zero when the
 * query point coincides with a control point's old position (the
 * common case for snapped tracing, where a wall's vertex sits exactly
 * on a station/LRUD/splay tip). Squared drawing units -- at 1e-9 it is
 * far below any real coincidence tolerance (a cave is surveyed in feet
 * or metres, never sub-micron), so it only ever matters at the exact
 * coincident point, where it makes that control pair's weight
 * effectively infinite without literally dividing by zero.
 */
CsWarp.EPS = 1e-9;

/**
 * Warps one point through inverse-square-distance-weighted MLS
 * similarity deformation.
 *
 * \param point         {x, y} the point to warp
 * \param controlPairs  [{old: {x, y}, nu: {x, y}}, ...] -- the SAME
 *                       pair shape CsRevise.similarityFit uses ("nu",
 *                       not "new": a reserved word as an object key
 *                       works in this engine, but the codebase already
 *                       settled on "nu" everywhere this shape appears,
 *                       see CsRevise.js:499 and 617)
 * \return null for 0 pairs; {x, y, angle: 0, factor: 1} (pure
 *         translation) for exactly 1 pair; otherwise {x, y, angle,
 *         factor} -- angle/factor are the LOCAL rotation and uniform
 *         scale this point's neighbourhood implies, needed by callers
 *         that warp a circle/arc's radius rather than a set of
 *         vertices.
 */
CsWarp.mlsSimilarity = function(point, controlPairs) {
    if (controlPairs === undefined || controlPairs === null ||
            controlPairs.length === 0) {
        return null;
    }
    if (controlPairs.length === 1) {
        var only = controlPairs[0];
        return {
            x: point.x + (only.nu.x - only.old.x),
            y: point.y + (only.nu.y - only.old.y),
            angle: 0.0,
            factor: 1.0
        };
    }

    var i, w, dx, dy, distSq;
    var sw = 0.0, px = 0.0, py = 0.0, qx = 0.0, qy = 0.0;
    var weights = [];
    for (i = 0; i < controlPairs.length; i++) {
        dx = point.x - controlPairs[i].old.x;
        dy = point.y - controlPairs[i].old.y;
        distSq = dx * dx + dy * dy;
        w = 1.0 / (distSq + CsWarp.EPS);
        weights.push(w);
        sw += w;
        px += w * controlPairs[i].old.x;
        py += w * controlPairs[i].old.y;
        qx += w * controlPairs[i].nu.x;
        qy += w * controlPairs[i].nu.y;
    }
    px /= sw;
    py /= sw;
    qx /= sw;
    qy /= sw;

    var a = 0.0, b = 0.0, s2 = 0.0;
    for (i = 0; i < controlPairs.length; i++) {
        var opx = controlPairs[i].old.x - px;
        var opy = controlPairs[i].old.y - py;
        var nqx = controlPairs[i].nu.x - qx;
        var nqy = controlPairs[i].nu.y - qy;
        w = weights[i];
        a += w * (opx * nqx + opy * nqy);
        b += w * (opx * nqy - opy * nqx);
        s2 += w * (opx * opx + opy * opy);
    }
    if (s2 <= 1e-20) {
        // every control pair's old position collapsed to the same
        // weighted centroid (all coincide): rotation/scale is
        // underdetermined, same degenerate call CsRevise.similarityFit
        // makes -- fall back to translation by the weighted centroid
        // delta.
        return { x: qx, y: qy, angle: 0.0, factor: 1.0 };
    }

    var theta = Math.atan2(b, a);
    var scale = Math.sqrt(a * a + b * b) / s2;
    var c = Math.cos(theta), s = Math.sin(theta);
    var rx = point.x - px, ry = point.y - py;

    return {
        x: qx + scale * (c * rx - s * ry),
        y: qy + scale * (s * rx + c * ry),
        angle: theta,
        factor: scale
    };
};
```

- [ ] **Step 2: Write the node tests**

Insert immediately after the existing block ending `tests/js_unit.js:13931` (`eqs(reduceSource.length, 3, ...); }());`), before the `// CsTrace -- the point-to-frame region test` comment:

```js
// ---------------------------------------------------------------------
// CsWarp -- per-point MLS similarity deformation
// ---------------------------------------------------------------------
(function() {
    loadRepoScript("scripts/CaveSurvey/Core/CsRevise.js");
    loadRepoScript("scripts/CaveSurvey/Core/CsWarp.js");

    function pt(x, y) { return { x: x, y: y }; }
    function pair(ox, oy, nx, ny) {
        return { old: pt(ox, oy), nu: pt(nx, ny) };
    }

    // -- degenerate counts -------------------------------------------
    eqs(CsWarp.mlsSimilarity(pt(0, 0), []), null,
        "CsWarp.mlsSimilarity: no control pairs -> null");

    var oneUp = CsWarp.mlsSimilarity(pt(5, 5),
        [pair(0, 0, 3, 4)]);
    near(oneUp.x, 8, 1e-9, "CsWarp.mlsSimilarity: one pair, x translated");
    near(oneUp.y, 9, 1e-9, "CsWarp.mlsSimilarity: one pair, y translated");
    eqs(oneUp.angle, 0, "CsWarp.mlsSimilarity: one pair, no rotation info");
    eqs(oneUp.factor, 1, "CsWarp.mlsSimilarity: one pair, no scale info");

    // -- exact reproduction at a control point, whatever else is near --
    var controls = [
        pair(0, 0, 0, 0),
        pair(100, 0, 100, 0),
        pair(0, 100, 5, 95)  // this one drags the fit off pure identity
    ];
    var atThird = CsWarp.mlsSimilarity(pt(0, 100), controls);
    near(atThird.x, 5, 1e-6,
        "CsWarp.mlsSimilarity: exact at its own control point (x)");
    near(atThird.y, 95, 1e-6,
        "CsWarp.mlsSimilarity: exact at its own control point (y)");

    // -- rigid-case regression: must match CsRevise.similarityFit -----
    function rigidPairs(n, thetaDeg, scale, tx, ty) {
        var th = thetaDeg * Math.PI / 180;
        var c = Math.cos(th), s = Math.sin(th);
        var out = [];
        for (var i = 0; i < n; i++) {
            var ox = i * 17.0, oy = (i % 2) * 9.0; // scattered, not collinear
            out.push(pair(ox, oy,
                scale * (c * ox - s * oy) + tx,
                scale * (s * ox + c * oy) + ty));
        }
        return out;
    }
    function checkRigidMatch(n, thetaDeg, scale, tx, ty, label) {
        var pairs = rigidPairs(n, thetaDeg, scale, tx, ty);
        var fit = CsRevise.similarityFit(pairs);
        var samplePoints = [pt(37, -12), pt(-5, 5), pt(200, 200)];
        for (var i = 0; i < samplePoints.length; i++) {
            var expected = CsRevise.applyFit(fit, samplePoints[i]);
            var got = CsWarp.mlsSimilarity(samplePoints[i], pairs);
            near(got.x, expected.x, 1e-6,
                label + ": matches similarityFit at sample " + i + " (x)");
            near(got.y, expected.y, 1e-6,
                label + ": matches similarityFit at sample " + i + " (y)");
        }
    }
    checkRigidMatch(2, 10, 1.0, 3, -2, "CsWarp.mlsSimilarity rigid/2pt");
    checkRigidMatch(4, 25, 1.4, -8, 6, "CsWarp.mlsSimilarity rigid/4pt");

    // -- genuinely non-rigid: two clusters disagree, blend between ----
    // Cluster A (near x=0) rotates 20 degrees about its own centroid;
    // cluster B (near x=1000) only translates. A real network can do
    // this: one sub-loop rotates under adjustment while a distant part
    // barely moves.
    var thA = 20 * Math.PI / 180;
    var clusterA = [
        pair(-5, -5, Math.cos(thA) * -5 - Math.sin(thA) * -5,
            Math.sin(thA) * -5 + Math.cos(thA) * -5),
        pair(5, -5, Math.cos(thA) * 5 - Math.sin(thA) * -5,
            Math.sin(thA) * 5 + Math.cos(thA) * -5),
        pair(0, 5, Math.cos(thA) * 0 - Math.sin(thA) * 5,
            Math.sin(thA) * 0 + Math.cos(thA) * 5)
    ];
    var clusterB = [
        pair(995, -5, 995 + 40, -5 + 2),
        pair(1005, -5, 1005 + 40, -5 + 2),
        pair(1000, 5, 1000 + 40, 5 + 2)
    ];
    var bothClusters = clusterA.concat(clusterB);

    var nearA = CsWarp.mlsSimilarity(pt(0, -4), bothClusters);
    var nearB = CsWarp.mlsSimilarity(pt(1000, -4), bothClusters);
    var mid = CsWarp.mlsSimilarity(pt(500, -4), bothClusters);

    // near A: dominated by A's rotation, barely any of B's +40
    // translation should leak in
    ok(nearA.x < 20,
        "CsWarp.mlsSimilarity: near cluster A, barely feels B's +40 shift, got " +
        nearA.x);
    // near B: dominated by B's +40 translation
    near(nearB.x, 1040, 5,
        "CsWarp.mlsSimilarity: near cluster B, follows its +40 shift");
    // midpoint: neither extreme -- strictly between the two influences,
    // proving a smooth blend rather than a hard snap to one side
    ok(mid.x > nearA.x && mid.x < nearB.x,
        "CsWarp.mlsSimilarity: midpoint blends strictly between the two " +
        "clusters' influence, got " + mid.x + " (A " + nearA.x + ", B " +
        nearB.x + ")");
}());
```

- [ ] **Step 3: Run and confirm**

Run: `node tests/js_unit.js`
Expected: `### UNIT OK <N> assertions` (no `FAIL` lines above it — if any print, fix `CsWarp.js` before continuing, not the test).

- [ ] **Step 4: Commit**

```bash
git add scripts/CaveSurvey/Core/CsWarp.js tests/js_unit.js
git commit -m "feat(CsWarp): per-point MLS similarity deformation, pure and tested"
```

---

### Task 2: `CsRevise.moveLinework` — per-vertex warp dispatch

**Goal:** Replace the whole-entity rigid-fit-or-refuse step with per-vertex MLS warping for polyline, line, arc, circle and spline entities; everything else keeps today's behavior unchanged.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsRevise.js:900-1065` (the `LINEWORK_RESIDUAL_FRACTION` comment, `moveLinework`'s own docblock, and its body)

**Acceptance Criteria:**
- [ ] `moveLinework` walks every vertex of a polyline via `getVertexAt`/`countVertices` and moves each one with `moveReferencePoint`, leaving bulges untouched.
- [ ] Same for a line's two endpoints and a spline's control points.
- [ ] An arc/circle's center warps via `CsWarp.mlsSimilarity`, and its radius scales by that call's local `factor`.
- [ ] Any OTHER entity type on a linework layer (block references, text, anything else `CsBind.isLineworkLayer`/`hasLineworkTags` would accept) still goes through the EXACT unchanged rigid-fit-with-refusal path — `CsRevise.LINEWORK_RESIDUAL_FRACTION` still exists and is still consulted, just only there.
- [ ] `result` gains a `warped` counter alongside `moved`/`unmoved`: an entity whose per-vertex `angle`/`factor` values disagree by more than a small tolerance counts as `warped`, not `moved`.
- [ ] 0 control points (nothing to warp against) is still the only case landing in `unmoved`.
- [ ] `node tests/js_unit.js` still passes unchanged (this function is QCAD-engine-only, invisible to node — the existing `LINEWORK_RESIDUAL_FRACTION`/`similarityFit` block at `tests/js_unit.js:4227-4261` must still pass as-is, proving the fallback path's math is untouched).

**Verify:** `node tests/js_unit.js` → `### UNIT OK <N> assertions`, same N as after Task 1 (this task adds no node-visible assertions of its own — Task 4 covers the engine-only behavior).

**Steps:**

- [ ] **Step 1: Update the constant's comment**

Replace the comment block at `CsRevise.js:900-922` (currently explaining `LINEWORK_RESIDUAL_FRACTION` as governing ALL linework moves) with:

```js
// How far a linework fit's worst station may miss before the move is
// refused, as a fraction of the drawing's extent (the same relative
// basis classifyChange uses -- a cave in feet and the same cave in
// metres must decide identically).
//
// SCOPE, NARROWED: this only gates the entity types that have no
// per-vertex structure to warp -- block references, text, anything
// else CsBind.isLineworkLayer/hasLineworkTags accepts that is not a
// polyline, line, arc, circle or spline. Those five types are warped
// per-vertex/per-center by CsWarp.mlsSimilarity instead (see
// moveLinework below), which always has a locally sensible answer and
// never refuses. For the remaining types, a residual of a tenth of a
// percent of the drawing diagonal is 0.5 mm on a 1:200 sheet of a
// 100 m cave -- thinner than the line itself. Above that, no single
// rigid move honestly describes what happened to a block/text
// reference's control points, and the entity is left alone and
// REPORTED rather than guessed at.
//
// A fit over exactly two stations always has residual 0 -- a plane
// similarity has four degrees of freedom and two points supply four
// equations -- so this threshold only ever bites at three or more.
// With two, the pair IS the definition of the rigid piece and the
// honest answer is to follow them.
CsRevise.LINEWORK_RESIDUAL_FRACTION = 1e-3;
```

- [ ] **Step 2: Update `moveLinework`'s own docblock**

Replace the docblock at `CsRevise.js:924-971` with:

```js
/**
 * Moves hand-traced linework so it follows the stations it was traced
 * against. QCAD context only.
 *
 * Called by every path that erases the survey marks and redraws them
 * from revised data -- CsRevise.apply's non-rigid branch, the Survey
 * Notebook's Draw when the page revises a trip already in the drawing,
 * and CsProfileDraw.render for the profile side -- and by NO path that
 * transforms the drawing whole. The rigid branch of apply already
 * carries every traced entity along in its single whole-drawing
 * operation, so running this there would move the same entity twice.
 *
 * Every entity on a linework layer (CsBind.isLineworkLayer is the one
 * gate; it consults WORLD_FIXED_LAYERS above, so sheet furniture is
 * excluded from here for free) carrying either linework tag gets a
 * control-point set: its own bound stations' old -> new positions, per
 * the order of preference below. What happens with that set depends on
 * the entity's type:
 *
 *   Polyline / Spline   every vertex / control point warps
 *                        INDIVIDUALLY through CsWarp.mlsSimilarity, so
 *                        one entity can bend along its length. Bulges
 *                        are left as-is -- a documented approximation
 *                        when the two vertices either side of a bulge
 *                        warp by slightly different local
 *                        rotation/scale, not expected to be visible at
 *                        normal trace density.
 *   Line                 both endpoints warp individually, same as a
 *                        two-vertex polyline.
 *   Arc / Circle          the center warps through CsWarp.mlsSimilarity;
 *                        the radius scales by that call's local
 *                        `factor`.
 *   anything else         (block references, text, ...) keeps the
 *                        ORIGINAL whole-entity rigid similarity fit,
 *                        residual-checked against
 *                        CsRevise.LINEWORK_RESIDUAL_FRACTION exactly as
 *                        before -- the approved design for this feature
 *                        covers the five types above explicitly and
 *                        does not extend to these, so their behavior is
 *                        unchanged rather than guessed at.
 *
 * Its control-point set, in order of preference, per the original
 * binding spec:
 *
 *   its listed stations   LineworkStations, those still resolvable in
 *                         both frames. One station gives a pure
 *                         translation (CsWarp.mlsSimilarity's 1-pair
 *                         case, or similarityFit's for the fallback
 *                         path).
 *   its trip's stations   nothing listed survived -- fit over every
 *                         station of its LineworkTrip instead, so the
 *                         entity at least follows the passage it
 *                         belongs to.
 *   neither               left exactly where it is and REPORTED.
 *                         Never guessed at silently.
 *
 * An UNTAGGED entity is not this function's problem: both callers run
 * CsBind.planAutoBind before their erase and CsBind.commitAutoBind
 * before calling here, so by now anything bindable is bound. What is
 * still untagged when this runs is untagged on purpose -- it binds to
 * no station, or the user switched automatic binding off -- and is
 * left alone for the same reason it always was: we cannot know what it
 * belongs to, and inventing an answer moves the wrong geometry.
 *
 * \param doc, di       document and its interface
 * \param oldPos        {name: {x, y}} station positions BEFORE the
 *                      revision -- the frame the tracing was drawn in
 * \param newPos        {name: {x, y}} station positions AFTER it
 * \param tripStations  {tripId: [names]} for the fallback
 * \param extent        drawing extent for the fallback path's residual
 *                      threshold
 * \return { moved, warped, unmoved } -- moved and warped are counts
 *         (an entity is one or the other, never both), unmoved a list
 *         of "LAYER #id" labels for the report
 */
```

- [ ] **Step 3: Rewrite the function body**

Replace `CsRevise.js:972-1065` (from `CsRevise.moveLinework = function(` through its closing `};`) with:

```js
CsRevise.moveLinework = function(doc, di, oldPos, newPos, tripStations,
        extent) {
    var result = { moved: 0, warped: 0, unmoved: [] };
    // Soft dependency, the mirror of CsBind's on this module: nothing
    // else in CsRevise needs CsBind, and a caller that loaded only
    // half the Core should get "no linework" rather than a throw.
    if (typeof CsBind === "undefined") {
        return result;
    }
    var ex = (typeof extent === "number" && isFinite(extent)) ? extent : 0;
    var tol = CsRevise.LINEWORK_RESIDUAL_FRACTION * Math.max(ex, 1);

    /** old -> new pairs for the names resolvable in BOTH frames. */
    var pairsFor = function(names) {
        var pairs = [];
        var seen = {};
        for (var i = 0; i < names.length; i++) {
            var nm = names[i];
            if (nm === undefined || nm === null || nm === "" ||
                    seen[nm] === true) {
                continue;
            }
            seen[nm] = true;
            if (!oldPos.hasOwnProperty(nm) || !newPos.hasOwnProperty(nm)) {
                continue;
            }
            pairs.push({ old: { x: oldPos[nm].x, y: oldPos[nm].y },
                nu: { x: newPos[nm].x, y: newPos[nm].y } });
        }
        return pairs;
    };

    /** Every vertex a warpable entity type exposes, as plain RVector --
     *  the identity moveReferencePoint needs to find and replace one.
     *  Polyline: real vertices only, NOT getReferencePoints() -- that
     *  also returns synthetic bulge-midpoint handles, and moving one of
     *  those reshapes the bulge instead of relocating a vertex (probed
     *  live: a 3-vertex polyline with one bulge answers 5 reference
     *  points). Line and Spline: getReferencePoints() IS exactly their
     *  real points (2 endpoints; every control point respectively), no
     *  synthetic extras, probed live the same way. */
    var warpableVertices = function(ent) {
        if (ent instanceof RPolylineEntity) {
            var pts = [];
            for (var i = 0; i < ent.countVertices(); i++) {
                var v = ent.getVertexAt(i);
                pts.push(new RVector(v.x, v.y));
            }
            return pts;
        }
        if (ent instanceof RSplineEntity) {
            var spts = [];
            for (var j = 0; j < ent.countControlPoints(); j++) {
                var cp = ent.getControlPointAt(j);
                spts.push(new RVector(cp.x, cp.y));
            }
            return spts;
        }
        if (ent instanceof RLineEntity) {
            return ent.getReferencePoints();
        }
        return null;
    };

    var origin = new RVector(0, 0);
    var op = new RModifyObjectsOperation();
    op.setText("Move traced linework");
    var anyMoved = false;
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var ent = doc.queryEntity(ids[i]);
        if (isNull(ent)) {
            continue;
        }
        var layer = CsBind.layerNameOf(doc, ent);
        if (!CsBind.isLineworkLayer(layer)) {
            continue;
        }
        // EITHER tag, not just the station list: an entity bound with
        // source "trip" snapped to nothing and so carries only
        // LineworkTrip. Keying on LineworkStations alone would skip
        // exactly the entities that need the trip fallback.
        if (!CsBind.hasLineworkTags(ent)) {
            continue;
        }
        // our own output, should it ever have picked up a linework tag:
        // the redraw just placed it, and moving it again would apply
        // the revision to it twice
        if (CsBind.isSuiteGeometry(ent)) {
            continue;
        }

        var label = layer + " #" + ent.getId();
        var pairs = pairsFor(CsBind.decodeStations(
            CsTags.get(ent, CsBind.STATIONS_TAG)));
        if (pairs.length === 0) {
            var trip = CsTags.getNumber(ent, CsBind.TRIP_TAG);
            trip = (trip === null) ? 0 : trip;
            if (tripStations !== undefined && tripStations !== null &&
                    tripStations.hasOwnProperty(trip)) {
                pairs = pairsFor(tripStations[trip]);
            }
        }
        if (pairs.length === 0) {
            result.unmoved.push(label);
            continue;
        }

        if (ent instanceof RArcEntity || ent instanceof RCircleEntity) {
            var oldCenter = ent.getCenter();
            var cw = CsWarp.mlsSimilarity(
                { x: oldCenter.x, y: oldCenter.y }, pairs);
            ent.move(new RVector(cw.x - oldCenter.x, cw.y - oldCenter.y));
            ent.setRadius(ent.getRadius() * cw.factor);
            op.addObject(ent, false);
            anyMoved = true;
            result.moved++; // a single point has nothing to disagree with
            continue;
        }

        var verts = warpableVertices(ent);
        if (verts !== null) {
            var angles = [], factors = [];
            for (var vi = 0; vi < verts.length; vi++) {
                var oldV = verts[vi];
                var vw = CsWarp.mlsSimilarity({ x: oldV.x, y: oldV.y },
                    pairs);
                ent.moveReferencePoint(oldV, new RVector(vw.x, vw.y));
                angles.push(vw.angle);
                factors.push(vw.factor);
            }
            op.addObject(ent, false);
            anyMoved = true;
            var minA = Math.min.apply(null, angles),
                maxA = Math.max.apply(null, angles);
            var minF = Math.min.apply(null, factors),
                maxF = Math.max.apply(null, factors);
            var bent = (maxA - minA > 1e-6) ||
                (Math.abs(maxF - minF) > 1e-6 * Math.max(1, maxF));
            if (bent) {
                result.warped++;
            } else {
                result.moved++;
            }
            continue;
        }

        // anything else (blocks, text, ...): unchanged whole-entity
        // rigid path, residual refusal included -- see this function's
        // docblock for why this boundary exists.
        var fit = CsRevise.similarityFit(pairs);
        // Infinity is similarityFit's honest answer when the old points
        // all coincide and the rotation is underdetermined -- exactly
        // the case where a fit must not be trusted.
        if (fit === null || !isFinite(fit.maxResidual) ||
                fit.maxResidual > tol) {
            result.unmoved.push(label);
            continue;
        }
        ent.rotate(fit.theta, origin);
        if (Math.abs(fit.scale - 1.0) > 1e-9) {
            ent.scale(fit.scale, origin);
        }
        ent.move(new RVector(fit.tx, fit.ty));
        op.addObject(ent, false);
        anyMoved = true;
        result.moved++;
    }
    if (anyMoved) {
        di.applyOperation(op);
    }
    return result;
};
```

- [ ] **Step 4: Add `CsWarp` to `CsAll.js`'s include list**

`moveLinework` now references the global `CsWarp`, and it is not yet pulled in anywhere (confirmed: `grep -n "CsTrace\.js\|CsRevise\.js\|CsWarp\.js" scripts/CaveSurvey/Core/CsAll.js` shows `CsTrace.js` at line 68 and `CsRevise.js` at line 89, no `CsWarp.js`). Add one line right before the `CsRevise.js` include at line 89 (moveLinework needs `CsWarp` defined by the time it runs, and keeping it textually before its first consumer matches the file's existing convention):

```js
include(includeBasePath + "/CsWarp.js");
```

- [ ] **Step 5: Run the structural + node tests**

Run: `node tests/js_unit.js`
Expected: `### UNIT OK <N> assertions`, same count as end of Task 1 (this task's own behavior is engine-only and covered in Task 4).

Run: `python3 -m unittest discover -s tests -p "test_addon.py" -v` (or however `tests/run_all.sh`'s step 1 invokes it — see that file's step "1/9" for the exact command)
Expected: all structural tests still pass (this task adds no new files the structural suite would need to know about yet -- that's Task 4).

- [ ] **Step 6: Commit**

```bash
git add scripts/CaveSurvey/Core/CsRevise.js scripts/CaveSurvey/Core/CsAll.js
git commit -m "feat(CsRevise): moveLinework warps polyline/line/arc/circle/spline per-vertex via CsWarp"
```

---

### Task 3: Reporting — thread the new `warped` count through

**Goal:** Every caller of `lineworkSummary` and every consumer of `moveLinework`'s return shape knows about `warped`, and the summary sentence says so.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsRevise.js` (`lineworkSummary` signature + message, `apply`'s report-building around lines 1840-1846 and 2170-2203)
- Modify: `scripts/CaveSurvey/Core/CsReport.js:323-324` and `:445-447`
- Modify: `scripts/CaveSurvey/SurveyNotebook/SurveyNotebook.js:1409-1411` and `:1498`
- Modify: `scripts/CaveSurvey/Core/CsProfileDraw.js:1402` and `:1450`

**Acceptance Criteria:**
- [ ] `CsRevise.lineworkSummary(moved, unmoved, bound, stationsMoved, warped)` accepts the new 5th parameter, defaulting to 0, and its first summary line mentions warped entities when `warped > 0`.
- [ ] `CsRevise.apply`'s report object gains `lineworkWarped`, sourced from `moveLinework`'s `.warped`.
- [ ] Both `CsReport.js` call sites pass the new count through to `lineworkSummary`.
- [ ] `SurveyNotebook.js`'s call site passes `lw.warped`, AND its "the linework move is a further [undo] step" note fires when EITHER `lw.moved > 0` OR `lw.warped > 0` (today it only checks `lw.moved > 0` -- a Draw that only warped entities, moved none rigidly, would otherwise silently under-report its own undo step count).
- [ ] `CsProfileDraw.js`'s two `{moved: 0, unmoved: [...]}` fallback literals both gain `warped: 0`.
- [ ] `node tests/js_unit.js` still passes (no node-visible behavior changed by this task, but a stale reference would throw at load time and fail the whole suite).

**Verify:** `node tests/js_unit.js` → `### UNIT OK <N> assertions`, unchanged from Task 2's count.

**Steps:**

- [ ] **Step 1: `lineworkSummary`'s signature and message**

In `CsRevise.js`, change the signature at line 1294 and the first `lines.push` at line 1300:

```js
CsRevise.lineworkSummary = function(moved, unmoved, bound, stationsMoved,
        warped) {
    var n = (moved === undefined || moved === null) ? 0 : moved;
    var w = (warped === undefined || warped === null) ? 0 : warped;
    var list = (unmoved === undefined || unmoved === null) ? [] : unmoved;
    var didStationsMove = (stationsMoved === undefined ||
        stationsMoved === null) ? true : !!stationsMoved;
    var lines = [];
    lines.push("Traced linework moved with its stations: " + n +
        (w > 0 ? " (" + w + " warped to follow a bend)" : ""));
```

(The rest of the function body is unchanged.)

Update the docblock above it (`CsRevise.js:1260-1293`) to add a `\param` line documenting `warped`, right after the existing `\param bound` block:

```js
 * \param warped        optional -- of `moved`'s entities, how many
 *                       actually bent (per-vertex disagreement) rather
 *                       than moving as one rigid piece. Defaults to 0.
```

- [ ] **Step 2: `CsRevise.apply`'s report threading**

At `CsRevise.js:1844-1846`, add the new tracking variable next to the existing ones:

```js
    var lineworkMoved = 0;
    var lineworkWarped = 0;
    var lineworkUnmoved = [];
    var lineworkBound = 0;
```

At `CsRevise.js:2171-2175`, capture it from `moveLinework`'s return:

```js
        withOffLayersOn(function() {
            var lw = CsRevise.moveLinework(doc, di, oldPos, newPos,
                tripNames, extent);
            lineworkMoved = lw.moved;
            lineworkWarped = lw.warped;
            lineworkUnmoved = lw.unmoved;
        });
```

At `CsRevise.js:2200-2202`, add it to the returned report object:

```js
        lineworkMoved: lineworkMoved,
        lineworkWarped: lineworkWarped,
        lineworkUnmoved: lineworkUnmoved,
        lineworkBound: lineworkBound
```

- [ ] **Step 3: `CsReport.js`'s two call sites**

At `CsReport.js:323-324`:

```js
        var linework = CsRevise.lineworkSummary(report.lineworkMoved,
            report.lineworkUnmoved, report.lineworkBound, undefined,
            report.lineworkWarped);
```

At `CsReport.js:445-447`:

```js
        var pLines = CsRevise.lineworkSummary(c.linework.moved,
            c.linework.unmoved, c.claimed ? c.claimed.tagged : 0,
            c.stationsMoved, c.linework.warped);
```

- [ ] **Step 4: `SurveyNotebook.js`'s call site and undo-step note**

At `SurveyNotebook.js:1409-1411`:

```js
    var lwLine = lw === null ? "" :
        ("\n\n" + CsRevise.lineworkSummary(lw.moved, lw.unmoved,
            lwBound, true, lw.warped).join("\n"));
```

At `SurveyNotebook.js:1498`, widen the undo-step note's condition:

```js
        (lw !== null && (lw.moved > 0 || lw.warped > 0) ?
            "; the linework move is a further one" : "") +
```

- [ ] **Step 5: `CsProfileDraw.js`'s fallback literals**

At `CsProfileDraw.js:1402`:

```js
    counts.linework = { moved: 0, warped: 0, unmoved: [] };
```

At `CsProfileDraw.js:1450`:

```js
        counts.linework = { moved: 0, warped: 0,
            unmoved: ["move failed: " + eMove] };
```

- [ ] **Step 6: Run the node tests**

Run: `node tests/js_unit.js`
Expected: `### UNIT OK <N> assertions`, same N as Task 2 (this task only changes engine-only code paths and default-parameter plumbing that node's tests don't exercise directly -- Task 4 proves the report text end to end).

- [ ] **Step 7: Commit**

```bash
git add scripts/CaveSurvey/Core/CsRevise.js scripts/CaveSurvey/Core/CsReport.js scripts/CaveSurvey/SurveyNotebook/SurveyNotebook.js scripts/CaveSurvey/Core/CsProfileDraw.js
git commit -m "feat(linework-warp): thread the warped count through every report path"
```

---

### Task 4: Engine-only integration test + `run_all.sh` wiring

**Goal:** Prove the whole pipeline against a REAL `RDocument`/`RPolylineEntity`/`RLineEntity`/`RArcEntity`/`RCircleEntity`/`RSplineEntity` inside the actual CaveCAD engine (node cannot construct any of these), and wire it into the test suite so it runs on every `tests/run_all.sh`.

**Files:**
- Create: `tests/linework_warp.js`
- Modify: `tests/run_all.sh` (new numbered step, renumber the existing 9 steps' `N/9` labels to `N/10`)

**Acceptance Criteria:**
- [ ] A polyline traced with 3 vertices near 3 stations, where those stations move NON-rigidly (one end rotates, the other translates) on redraw, ends up with each of its 3 vertices independently displaced to match `CsWarp.mlsSimilarity`'s own prediction for that vertex — not a single whole-entity transform.
- [ ] The same polyline's bulge (set on one segment) is numerically unchanged after the move.
- [ ] A line, an arc, a circle and a spline, each bound to the same moving stations, all move/warp without throwing, and an arc/circle's radius scales by a measurably different amount than a rigid move would have produced (proving the local `factor` was actually used, not just 1.0).
- [ ] A block reference (or, if constructing one is impractical in this harness, an `RTextEntity` -- whichever is simpler to build headlessly) bound the same way still goes through the OLD rigid-fit-with-refusal path: construct one whose bound stations move non-rigidly enough to exceed `CsRevise.LINEWORK_RESIDUAL_FRACTION`, and confirm it lands in `unmoved`, unchanged from today's behavior.
- [ ] `moveLinework`'s returned `{moved, warped, unmoved}` counts match what the test set up (e.g. exactly 1 `warped` for the bent polyline, N `moved` for the rigidly-following entities, 1 `unmoved` for the refused fallback-type entity).
- [ ] `CsRevise.lineworkSummary`'s output text, called with these exact counts, contains the "warped to follow a bend" phrase.
- [ ] `tests/run_all.sh` runs this file as a new step and fails the whole run if it fails.

**Verify:** `"$QCAD" -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/linework_warp.js "$PWD"` → `### LINEWORK WARP OK`, and `bash tests/run_all.sh` → `ALL TESTS PASSED...` including the new step.

**Steps:**

- [ ] **Step 1: Write `tests/linework_warp.js`**

```js
// linework_warp.js -- proves CsRevise.moveLinework's per-vertex MLS warp
// against REAL RPolylineEntity/RLineEntity/RArcEntity/RCircleEntity/
// RSplineEntity/RTextEntity objects. None of these construct under
// node, so this file only runs inside CaveCAD's own script engine:
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/linework_warp.js "$PWD"
//
// What it proves that tests/js_unit.js's node-run CsWarp block cannot:
//   1. moveLinework actually calls moveReferencePoint per vertex on a
//      real polyline, not just that the math function is correct in
//      isolation;
//   2. a bulge survives the move unchanged;
//   3. an arc/circle's radius scales by the LOCAL factor at its
//      center, not a whole-entity average;
//   4. an entity type the approved design doesn't cover (text, standing
//      in for "anything that still uses the old rigid path") still
//      refuses and reports exactly as it did before this feature.

if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) {
            return true;
        }
        try {
            if (typeof v.isNull === "function") {
                return v.isNull();
            }
        } catch (e) {
        }
        return false;
    };
}
if (typeof createSpatialIndex === "undefined") {
    createSpatialIndex = function() {
        return new RSpatialIndexNavel();
    };
}

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

function loadRepoScript(rel) {
    var file = new QFile(repoRoot + "/" + rel);
    if (!file.open(QIODevice.ReadOnly | QIODevice.Text)) {
        throw new Error("cannot open " + rel);
    }
    var stream = new QTextStream(file);
    var src = stream.readAll();
    file.close();
    (0, eval)(src);
}

var CORE = ["CsUnits", "CsLayers", "CsTags", "CsRevise", "CsWarp",
    "CsBind"];
for (var c = 0; c < CORE.length; c++) {
    loadRepoScript("scripts/CaveSurvey/Core/" + CORE[c] + ".js");
}

var failures = [];
function ok(cond, what) {
    if (!cond) { failures.push(what); }
}
function eqs(a, b, what) {
    ok(a === b, what + " (expected " + b + ", got " + a + ")");
}
function near(a, b, tol, what) {
    ok(Math.abs(a - b) <= tol,
        what + " (expected " + b + " +/- " + tol + ", got " + a + ")");
}

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);

// A minimal three-station network: S1/S2 rotate 15 degrees about
// (0,0), S3 only translates by (50, -5) -- genuinely non-rigid,
// exactly the case this feature exists for.
var oldPos = {
    S1: { x: 0, y: 0 },
    S2: { x: 10, y: 0 },
    S3: { x: 200, y: 0 }
};
var th = 15 * Math.PI / 180;
function rot(p) {
    return { x: Math.cos(th) * p.x - Math.sin(th) * p.y,
        y: Math.sin(th) * p.x + Math.cos(th) * p.y };
}
var newPos = {
    S1: rot(oldPos.S1),
    S2: rot(oldPos.S2),
    S3: { x: oldPos.S3.x + 50, y: oldPos.S3.y - 5 }
};

CsLayers.ensure(doc, di, "WALLS-SURVEYED");
var layerId = doc.getLayerId("WALLS-SURVEYED");

function addEntity(ent) {
    ent.setLayerId(layerId);
    var op = new RAddObjectsOperation();
    op.addObject(ent, false);
    di.applyOperation(op);
    return ent.getId();
}

function tagStations(id, names) {
    var e = doc.queryEntity(id);
    CsTags.set(e, CsBind.TRIP_TAG, 0);
    CsTags.set(e, CsBind.STATIONS_TAG, CsBind.encodeStations(names));
}

// -- the bending polyline: near S1, S2, S3 all at once -------------
var pdata = new RPolylineData();
pdata.appendVertex(new RVector(0, 2));
pdata.appendVertex(new RVector(10, 2), 0.3);
pdata.appendVertex(new RVector(200, 2));
var polyId = addEntity(new RPolylineEntity(doc, pdata));
tagStations(polyId, ["S1", "S2", "S3"]);
var bulgeBefore = doc.queryEntity(polyId).getBulgeAt(1);

// -- a line near S1/S2 only (should follow their rotation) ---------
var lineId = addEntity(new RLineEntity(doc,
    new RLineData(new RVector(1, 1), new RVector(9, 1))));
tagStations(lineId, ["S1", "S2"]);

// -- an arc and a circle, both near S1/S2 --------------------------
var arcId = addEntity(new RArcEntity(doc,
    new RArcData(new RVector(5, -3), 2, 0, Math.PI, false)));
tagStations(arcId, ["S1", "S2"]);
var circleId = addEntity(new RCircleEntity(doc,
    new RCircleData(new RVector(5, -6), 3)));
tagStations(circleId, ["S1", "S2"]);
var circleRadiusBefore = doc.queryEntity(circleId).getRadius();

// -- a spline near S1/S2 -------------------------------------------
var sdata = new RSplineData();
sdata.appendControlPoint(new RVector(0, 3));
sdata.appendControlPoint(new RVector(5, 4));
sdata.appendControlPoint(new RVector(10, 3));
sdata.setDegree(2);
sdata.update();
var splineId = addEntity(new RSplineEntity(doc, sdata));
tagStations(splineId, ["S1", "S2"]);

// -- a text entity: stands in for "a type the design doesn't cover",
// bound to stations that move FAR from rigid (S1 rotates, S3
// translates the opposite way) so the old residual check must refuse
// it, unchanged from before this feature -----------------------------
var textId = addEntity(new RTextEntity(doc,
    new RTextData(new RVector(3, 8), new RVector(3, 8), 1.0, 10,
        RS.HAlignLeft, RS.VAlignBottom, false, false, 0, "trace note",
        "standard", false)));
tagStations(textId, ["S1", "S3"]);

var extent = CsRevise.positionsExtent(newPos);
var lw = CsRevise.moveLinework(doc, di, oldPos, newPos, {}, extent);

// -- assertions: counts -----------------------------------------------
eqs(lw.warped, 1, "exactly the bending polyline counts as warped");
eqs(lw.moved, 4, "line, arc, circle and spline all count as moved");
eqs(lw.unmoved.length, 1, "the text entity was refused, unchanged behavior");
ok(lw.unmoved[0].indexOf("#" + textId) >= 0,
    "the refused entity is the text entity, got " + lw.unmoved[0]);

// -- assertions: the polyline actually bent, per-vertex -------------
var poly = doc.queryEntity(polyId);
var v0 = poly.getVertexAt(0), v1 = poly.getVertexAt(1),
    v2 = poly.getVertexAt(2);
var pairs = [
    { old: { x: 0, y: 0 }, nu: newPos.S1 },
    { old: { x: 10, y: 0 }, nu: newPos.S2 },
    { old: { x: 200, y: 0 }, nu: newPos.S3 }
];
var expect0 = CsWarp.mlsSimilarity({ x: 0, y: 2 }, pairs);
var expect1 = CsWarp.mlsSimilarity({ x: 10, y: 2 }, pairs);
var expect2 = CsWarp.mlsSimilarity({ x: 200, y: 2 }, pairs);
near(v0.x, expect0.x, 1e-6, "polyline vertex 0 matches CsWarp prediction (x)");
near(v0.y, expect0.y, 1e-6, "polyline vertex 0 matches CsWarp prediction (y)");
near(v1.x, expect1.x, 1e-6, "polyline vertex 1 matches CsWarp prediction (x)");
near(v2.x, expect2.x, 1e-6, "polyline vertex 2 matches CsWarp prediction (x)");
// and NOT a single whole-entity transform: vertex 0 and vertex 2 moved
// by very different amounts, since they sit near stations that moved
// completely differently
var d0 = Math.sqrt(Math.pow(v0.x - 0, 2) + Math.pow(v0.y - 2, 2));
var d2 = Math.sqrt(Math.pow(v2.x - 200, 2) + Math.pow(v2.y - 2, 2));
ok(Math.abs(d0 - d2) > 5,
    "the two ends of the polyline moved by clearly different amounts " +
    "(rotation near S1/S2 vs +50/-5 translation near S3), got d0=" +
    d0 + " d2=" + d2);
near(poly.getBulgeAt(1), bulgeBefore, 1e-12,
    "the bulge is untouched by the per-vertex move");

// -- assertions: circle radius used the LOCAL factor, not 1.0 -------
var circle = doc.queryEntity(circleId);
ok(Math.abs(circle.getRadius() - circleRadiusBefore) > 1e-9,
    "the circle's radius actually changed (local scale factor applied), " +
    "before=" + circleRadiusBefore + " after=" + circle.getRadius());

// -- assertions: the report sentence mentions the warp --------------
var summary = CsRevise.lineworkSummary(lw.moved, lw.unmoved, 0, true,
    lw.warped).join("\n");
ok(summary.indexOf("warped to follow a bend") >= 0,
    "lineworkSummary's text mentions the warped count, got:\n" + summary);

// -- report -------------------------------------------------------
if (failures.length === 0) {
    print("### LINEWORK WARP OK");
} else {
    for (var i = 0; i < failures.length; i++) {
        print("FAIL  " + failures[i]);
    }
    print("### LINEWORK WARP FAIL");
}
```

- [ ] **Step 2: Run it standalone against the installed CaveCAD**

Run: `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/linework_warp.js "$PWD"`
Expected: `### LINEWORK WARP OK` with no `FAIL` lines above it. If any assertion fails, fix the CODE from Tasks 2-3, not this test — the acceptance criteria above are the contract.

- [ ] **Step 3: Wire it into `tests/run_all.sh`**

Bump every existing `echo " N/9  ..."` label in `tests/run_all.sh` to `N/10` (9 lines, at the line numbers found in this repo today: 35, 43, 59, 80, 98, 116, 134, 151, 168 — confirm with `grep -n '^echo " [0-9]*/9 '  tests/run_all.sh` before editing, in case line numbers drifted).

Then insert a new step after the existing "9/9 Package Cave Project" block (after its closing `fi` at line 182, before the final `echo` / `if [ "$status" -eq 0 ]` summary block):

```bash
echo
echo "=============================================================="
echo " 10/10  Linework warp (inside CaveCAD's own script engine)"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/linework_warp.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### LINEWORK WARP OK"*) ;;
        *) echo "Linework warp test did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found -- this drives real polyline/arc/" \
         "circle/spline/text entities and cannot run under node."
fi
```

- [ ] **Step 4: Run the whole suite**

Run: `bash tests/run_all.sh`
Expected: `ALL TESTS PASSED...` with the new "10/10 Linework warp" section showing `### LINEWORK WARP OK` and no `FAIL` lines anywhere above the summary.

- [ ] **Step 5: Commit**

```bash
git add tests/linework_warp.js tests/run_all.sh
git commit -m "test(linework-warp): engine-only integration test, wired into run_all.sh"
```

---

## Self-Review

**Spec coverage:** `Core/CsWarp.js` (Task 1) ✓, `moveLinework` per-vertex dispatch for the five approved types (Task 2) ✓, moved/warped/unmoved reporting (Task 3) ✓, per-type test coverage matching the design's own testing section — exact reproduction, rigid-case regression, genuinely non-rigid blending (Task 1's node tests) plus real-entity proof (Task 4) ✓. The one deliberate deviation from the approved spec's literal wording ("the residual check is removed... for anything with at least one control point") is the block/text scope boundary discovered during planning — narrowed to only the five enumerated types, called out explicitly in the plan header's "User decisions" and in Task 2's docblock rewrite, not silently implemented.

**Placeholder scan:** no TBD/TODO; every code block is complete; every file:line reference was read directly from the current repo state before this plan was written.

**Type consistency:** `CsWarp.mlsSimilarity(point, controlPairs)` returns `{x, y, angle, factor}` everywhere it's called (Tasks 2 and 4 both destructure exactly those four fields). `CsRevise.moveLinework`'s return shape `{moved, warped, unmoved}` is used identically by `lineworkSummary` (Task 3) and the integration test (Task 4). The `pair`/`{old, nu}` shape matches `CsRevise.similarityFit`'s existing convention exactly (confirmed against `CsRevise.js:499-501` and its callers), not the `{old, new}` shape used loosely in the design doc's prose — the design doc will get a one-line note added when this plan is approved, since "nu" vs "new" is a naming detail the brainstorm didn't need to get right, not a decision that needs re-approval.
