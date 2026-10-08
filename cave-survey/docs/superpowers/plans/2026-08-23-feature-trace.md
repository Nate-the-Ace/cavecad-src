# Feature Trace — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A freehand tracing tool that drag-samples a cave feature, fits a reduced-control-point spline, and lands it on the correct plan-frame or profile-frame layer, driven from a docked panel.

**Architecture:** All math lives in `Core/CsTrace.js` as pure functions the headless harness calls directly — resample to one point per foot, Ramer–Douglas–Peucker reduce, spline fit, and the point→frame region test. The GUI is two `RGuiAction`s, each alone on its own script file: `FeatureTrace.js` owns the menu entry and the dock, `FeatureTraceRun.js` is the drag action derived from stock `LineFreehand`. Frame is never declared, only derived from `CsLayers.frameOf`; Feature Trace is the fifth consumer of that one frame test.

**Tech Stack:** QCAD/CaveCAD ECMAScript add-on. ES5 dialect only. Tests: `tests/js_unit.js` (runs under node AND `CaveCAD -no-gui`, reporting DIFFERENT totals), `tests/test_addon.py` (Python stdlib, structural), all via `tests/run_all.sh`.

**User decisions (already made):**
- Freehand drag-sample, not click-then-densify: "Freehand drag-sample".
- Output is a fitted spline with REDUCED control points, chosen over a literal fit point per foot.
- "can we put this into its own panel like the notebook so you can visually sperarate the buttons and have proper labels for them all?"
- Panel is the ONLY surface — "Panel only, no actions". Accepted losses: no command-line aliases per feature, no assignable keyboard shortcuts.
- Panel button labels are bare inside frame-labelled groups.
- A frame mismatch is REFUSED, never auto-corrected.
- `BREAKDOWN-BOUNDARY` keeps no profile twin: "Accept the asymmetry".

**Spec:** `docs/superpowers/specs/2026-08-23-feature-trace-design.md`

---

## Baseline before any work

```bash
./tests/run_all.sh --publish
```

Expect `ALL TESTS PASSED -- including publish checks`, 6 stages. Measured 2026-08-23 at HEAD `8035e8b`:

- node: **1639** assertions
- CaveCAD: **2702** assertions
- structural: **28** tests (3 skipped without `--publish`)

Compare each engine against its OWN baseline. They differ because some blocks are guarded by `if (!IS_NODE)`.

**Another session is committing to this repo.** HEAD moved twice while the spec was being written. Re-measure the baseline before starting rather than trusting the numbers above, and rebase before each commit.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `scripts/CaveSurvey/Core/CsTrace.js` | **NEW.** All the math: `resample`, `reduce`, `fitSpline`, `emit`, `profileRegion`, `frameAt`. The pure functions take no document. |
| `scripts/CaveSurvey/FeatureTrace/FeatureTrace.js` | **NEW.** The folder-named tool: the menu action, the dock, the row table, the armed-target state. |
| `scripts/CaveSurvey/FeatureTrace/FeatureTraceRun.js` | **NEW.** The interactive drag action. Registered by `FeatureTrace.init`, on no widget. |
| `scripts/CaveSurvey/FeatureTrace/FeatureTrace.svg` | **NEW.** Toolbar icon. Publish gate requires it and requires it to parse as SVG. |
| `scripts/CaveSurvey/FeatureTrace/FeatureTrace-inverse.svg` | **NEW.** Dark-theme twin, matching every other tool folder. |
| `tests/js_unit.js` | Gains the `CsTrace` suites. |
| `README.md` | Gains a tool-table row. A publish-gated test fails without it. |
| `scripts/CaveSurvey/Core/CsAll.js` | Gains the `CsTrace.js` include. Without it every tool's `include(.../CsAll.js)` leaves `CsTrace` undefined at runtime, and NO test currently catches that. |
| `tests/test_addon.py` | Gains a test pinning `CsAll.js` completeness, closing that whole class. |
| `scripts/CaveSurvey/Core/CsLayers.js` | **UNCHANGED.** Every target already exists with a `DEFAULTS` row. Verified at HEAD `8035e8b`. |

---

## Conventions every task must follow

Each was a real defect in this codebase. Not style preferences.

- **ES5 only.** `var`, `function`, string concatenation. No `let`/`const`, arrow functions, template literals, trailing commas.
- **`Cs` prefix on every Core file** matching its global. `include()` dedupes by BASENAME, so a `Trace.js` would be silently skipped. A structural test enforces it.
- **A RISING ASSERTION COUNT IS NOT COVERAGE.** For every acceptance criterion: DELETE the behaviour, run the suite, confirm a NAMED test fails, and report which mutation each test kills.
- **Mutation-test the GUI files under CaveCAD, not node.** node never loads them.
- **No bundled assertion with substring matching.** Exact strings, one claim each.
- **Off layers refuse adds, deletes AND modifies**, silently. Wrap in `CsLayers.withLayerOn`.
- **This engine's `Array.prototype.sort` is UNSTABLE.** A comparator returning 0 for two distinct items diverges between engines invisibly.
- **Never let a missing measurement become a number.** A fabricated coordinate is worse than a refusal.
- **Comments explain WHY. A false comment is worse than none.**

### The repo is NOT what CaveCAD runs

**Every GUI check in this plan requires `./tools/publish.sh` first, then a FULL restart of CaveCAD.** Add-ons load only at startup, and CaveCAD reads real files from
`~/Library/Application Support/QCAD/CaveCAD/scripts/CaveSurvey` — a plain copy that `publish.sh` replaces outright. Nothing is symlinked; editing the repo changes nothing the app can see.

This cost a round trip on Task 4: the tool was reported missing from the Cave Survey menu, and the cause was simply that the installed copy predated it. The headless suites (`run_all.sh`, `js_unit.js`) read the repo directly, so they can be fully green while the app still shows an old build. A green suite is NOT evidence that the app has your code.

### Three structural-test constraints discovered while planning

These are not obvious from reading the add-on, and getting any of them wrong fails `tests/test_addon.py` in a way whose message does not name the cause.

1. **The local variable MUST be called `action`.** `test_every_tool_declares_a_sort_order` asserts the literal substring `action.setSortOrder` in the folder-named file, case-sensitively. `panelAction.setSortOrder(...)` does NOT contain it and the test fails.
2. **The second action's variable must NOT be called `action`.** `test_sort_orders_are_unique` reads sort orders with `find_int(source, "action.setSortOrder")`, which takes one match from the file. Two `action.setSortOrder` calls in `FeatureTrace.js` makes which one it reads a coin flip. Name the run action's variable `runAction` and give it **no sort order at all** — it is on no widget, so a sort order would be meaningless anyway.
3. **`FeatureTraceRun.js` is invisible to QCAD's loader.** `AddOn.getAddOns` in `scripts/AddOn.js` only ever builds an add-on from `<dir>/<dir>.js`, so `FeatureTraceRun.init()` is never called by QCAD. `FeatureTrace.init()` must call it explicitly. The structural tests only read the folder-named file (`tool_source(name)`), so the second file is exempt from the menu, icon, status-tip and command-name requirements.

---

## Task 1: `CsTrace` resample and reduce

**Goal:** The two pure functions that turn a captured drag into the control points a spline needs, with no document and no GUI.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsTrace.js`
- Modify: `scripts/CaveSurvey/Core/CsAll.js`
- Modify: `tests/js_unit.js`
- Modify: `tests/test_addon.py`

**Acceptance Criteria:**
- [ ] `CsTrace.resample(points, spacing)` returns points at fixed arc-length `spacing` along the input polyline, always including the first and last input point
- [ ] A run whose length is NOT a whole number of intervals keeps its own endpoint — the case that makes the tail push load-bearing, and the assertion indexes from the END so the mutation fails cleanly instead of throwing before the report prints
- [ ] `resample` with fewer than 2 points returns a copy of the input, not null and not a throw
- [ ] `resample` with `spacing <= 0` returns a copy of the input rather than looping forever
- [ ] `resample` skips zero-length segments. NOT a divide-by-zero guard, despite reading like one: `walked` is `spacing - carried` and `carried` is strictly less than `spacing`, so `walked > 0` and the inner loop can never run when a segment is 0. Removing the guard is behaviour-preserving and NO test can kill it — verified by mutation, and the code comment says so
- [ ] `CsTrace.reduce(points, tolerance)` is Ramer–Douglas–Peucker: a straight run collapses to exactly its 2 endpoints, and every dropped point lies within `tolerance` of the kept polyline
- [ ] `reduce` with fewer than 3 points returns a copy of the input
- [ ] `reduce` NEVER drops the first or last point
- [ ] `CsTrace.spacingFor(unitName)` returns 1.0 for `"ft"` and 0.3048 for `"m"`, so one foot means one foot of cave and not one drawing unit
- [ ] Both functions treat their input as read-only — the caller's array is unmodified after either call
- [ ] Neither function references `RVector`, a document, or any `R*` type: they take and return `{x, y}` plain objects, so node runs them
- [ ] `CsAll.js` includes `CsTrace.js`, so a tool's single `include(.../CsAll.js)` is enough
- [ ] A new structural test asserts EVERY `Core/Cs*.js` file appears in `CsAll.js`, so the next Core file cannot be added without being wired in

**Verify:** `node tests/js_unit.js` → `### UNIT OK` above 1639

**Steps:**

- [ ] **Step 1: Write the failing tests.** Append to `tests/js_unit.js`:

```js
// ---------------------------------------------------------------------
// CsTrace -- resample and reduce
// ---------------------------------------------------------------------
(function() {
    loadRepoScript("scripts/CaveSurvey/Core/CsTrace.js");

    function pt(x, y) { return { x: x, y: y }; }

    // -- spacingFor -------------------------------------------------
    near(CsTrace.spacingFor("ft"), 1.0, 1e-9,
        "CsTrace.spacingFor: a foot drawing spaces at 1.0");
    near(CsTrace.spacingFor("m"), 0.3048, 1e-9,
        "CsTrace.spacingFor: a metre drawing spaces at 0.3048");

    // -- resample ---------------------------------------------------
    var line = [pt(0, 0), pt(10, 0)];
    var evenly = CsTrace.resample(line, 2.0);
    eqs(evenly.length, 6, "CsTrace.resample: 10 units at 2 gives 6 points");
    near(evenly[1].x, 2.0, 1e-9, "CsTrace.resample: second point at 2.0");
    near(evenly[5].x, 10.0, 1e-9, "CsTrace.resample: last input point kept");

    var short = CsTrace.resample([pt(3, 4)], 1.0);
    eqs(short.length, 1, "CsTrace.resample: a single point is returned as-is");

    var degenerate = CsTrace.resample(line, 0);
    eqs(degenerate.length, 2,
        "CsTrace.resample: spacing 0 returns the input, it does not hang");

    var withDupes = CsTrace.resample([pt(0, 0), pt(0, 0), pt(4, 0)], 2.0);
    eqs(withDupes.length, 3,
        "CsTrace.resample: a zero-length segment is skipped, not divided by");

    var source = [pt(0, 0), pt(10, 0)];
    CsTrace.resample(source, 2.0);
    eqs(source.length, 2, "CsTrace.resample: the caller's array is untouched");

    // -- reduce -----------------------------------------------------
    var straight = [pt(0, 0), pt(1, 0), pt(2, 0), pt(3, 0), pt(4, 0)];
    var thinned = CsTrace.reduce(straight, 0.01);
    eqs(thinned.length, 2,
        "CsTrace.reduce: a straight run collapses to its two endpoints");

    var corner = [pt(0, 0), pt(5, 0), pt(5, 5)];
    eqs(CsTrace.reduce(corner, 0.01).length, 3,
        "CsTrace.reduce: a real corner is kept");

    var bulge = [pt(0, 0), pt(2, 1), pt(4, 0)];
    eqs(CsTrace.reduce(bulge, 2.0).length, 2,
        "CsTrace.reduce: a bulge inside tolerance is dropped");
    eqs(CsTrace.reduce(bulge, 0.5).length, 3,
        "CsTrace.reduce: the same bulge outside tolerance is kept");

    var pair = [pt(0, 0), pt(9, 9)];
    eqs(CsTrace.reduce(pair, 100.0).length, 2,
        "CsTrace.reduce: endpoints survive any tolerance");

    var reduceSource = [pt(0, 0), pt(1, 0), pt(2, 0)];
    CsTrace.reduce(reduceSource, 0.01);
    eqs(reduceSource.length, 3, "CsTrace.reduce: the caller's array is untouched");
})();
```

- [ ] **Step 2: Run to verify it fails.**

Run: `node tests/js_unit.js`
Expected: FAIL — `cannot open .../Core/CsTrace.js`

- [ ] **Step 3: Write the implementation.** Create `scripts/CaveSurvey/Core/CsTrace.js`:

```js
// CsTrace.js -- the math behind Feature Trace.
//
// Part of the Cave Survey Core library. resample(), reduce() and
// spacingFor() are PURE: plain {x, y} objects in and out, no document,
// no R* type, so the headless harness calls them under node. The
// document-touching half of this file (profileRegion, frameAt,
// fitSpline, emit) is added by later tasks and is QCAD-only.
//
// Named CsTrace and not Trace because QCAD's include() dedupes by
// BASENAME: a Trace.js colliding with anything QCAD already loaded
// would be skipped in silence.

var CsTrace = {};

/**
 * Drawing-unit distance that means "one foot of cave".
 *
 * The trace samples one control point per foot, and a foot is a foot
 * whatever the drawing is in -- a metric cave must not get points a
 * metre apart just because its unit is bigger. Anything unrecognised
 * answers 1.0: treating an unknown unit as feet keeps the tool usable
 * and merely mis-spaces a curve, where refusing would block tracing
 * entirely.
 */
CsTrace.spacingFor = function(unitName) {
    if (unitName === CsUnits.METERS) {
        return CsUnits.convert(1.0, CsUnits.FEET, CsUnits.METERS);
    }
    return 1.0;
};

/** Plain 2D distance between two {x, y}. */
CsTrace.distance = function(a, b) {
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
};

/**
 * The captured drag, respaced to a point every `spacing` units of
 * arc length along it.
 *
 * The capture itself samples on a SCREEN-space threshold (see
 * FeatureTraceRun), which is what keeps the drag responsive at any
 * zoom -- but it also means the raw samples are spaced by whatever the
 * zoom happened to be. This is the step that makes the spacing mean
 * something in the cave rather than on the monitor.
 *
 * The last input point is always kept even when it lands less than
 * `spacing` past the previous one: the end of a wall is a place the
 * caver chose, and rounding it back to the last whole foot visibly
 * shortens the run.
 *
 * Degenerate input is returned as a copy rather than refused. A
 * one-point drag is a click, not an error, and a spacing of zero would
 * loop forever -- both are the caller's business to notice, and
 * neither is worth a throw mid-drag.
 */
CsTrace.resample = function(points, spacing) {
    if (isNull(points) || points.length < 2 || !(spacing > 0)) {
        return CsTrace.copyOf(points);
    }

    var out = [{ x: points[0].x, y: points[0].y }];
    var carried = 0;   // distance already walked past the last emitted point
    var i;

    for (i = 1; i < points.length; i++) {
        var from = points[i - 1];
        var to = points[i];
        var segment = CsTrace.distance(from, to);
        if (!(segment > 0)) {
            continue;   // a zero-length segment has no direction to walk
        }

        var walked = spacing - carried;
        while (walked <= segment) {
            var t = walked / segment;
            out.push({
                x: from.x + (to.x - from.x) * t,
                y: from.y + (to.y - from.y) * t
            });
            walked = walked + spacing;
        }
        carried = segment - (walked - spacing);
    }

    var last = points[points.length - 1];
    var tail = out[out.length - 1];
    if (CsTrace.distance(tail, last) > 0) {
        out.push({ x: last.x, y: last.y });
    }
    return out;
};

/** A shallow copy of a point list, so no caller's array is aliased. */
CsTrace.copyOf = function(points) {
    var out = [];
    if (isNull(points)) {
        return out;
    }
    for (var i = 0; i < points.length; i++) {
        out.push({ x: points[i].x, y: points[i].y });
    }
    return out;
};

/** Perpendicular distance from p to the infinite line through a and b. */
CsTrace.perpendicular = function(p, a, b) {
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (!(len > 0)) {
        return CsTrace.distance(p, a);   // a and b coincide: it is a point
    }
    return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
};

/**
 * Ramer-Douglas-Peucker: drop every point that lies within `tolerance`
 * of the polyline its neighbours already describe.
 *
 * This is what makes the output a spline rather than a polyline in a
 * costume. Fitting a spline through one point per foot gives a 400-fit-
 * point curve on a 400 ft passage: visually identical to the polyline,
 * slow to redraw, and unusable to hand-edit. After reduction a straight
 * passage carries a handful of points and a scalloped wall carries
 * many, which is the shape a cartographer would have clicked by hand.
 *
 * The first and last points are structurally never candidates -- the
 * recursion only ever examines the interior of a span.
 */
CsTrace.reduce = function(points, tolerance) {
    if (isNull(points) || points.length < 3) {
        return CsTrace.copyOf(points);
    }

    var keep = [];
    var i;
    for (i = 0; i < points.length; i++) {
        keep.push(false);
    }
    keep[0] = true;
    keep[points.length - 1] = true;

    CsTrace.reduceSpan(points, 0, points.length - 1, tolerance, keep);

    var out = [];
    for (i = 0; i < points.length; i++) {
        if (keep[i]) {
            out.push({ x: points[i].x, y: points[i].y });
        }
    }
    return out;
};

/**
 * Marks the one interior point of [first, last] furthest from the chord
 * when that distance exceeds tolerance, then recurses either side of it.
 * Recursive rather than iterative because the depth is bounded by the
 * number of KEPT points, not the number of samples.
 */
CsTrace.reduceSpan = function(points, first, last, tolerance, keep) {
    if (last <= first + 1) {
        return;
    }

    var worst = -1;
    var worstAt = -1;
    var i;
    for (i = first + 1; i < last; i++) {
        var d = CsTrace.perpendicular(points[i], points[first], points[last]);
        if (d > worst) {
            worst = d;
            worstAt = i;
        }
    }

    if (worstAt < 0 || !(worst > tolerance)) {
        return;   // every interior point is inside tolerance: drop them all
    }

    keep[worstAt] = true;
    CsTrace.reduceSpan(points, first, worstAt, tolerance, keep);
    CsTrace.reduceSpan(points, worstAt, last, tolerance, keep);
};
```

- [ ] **Step 4: Add the `CsUnits` dependency to the test.** `spacingFor` reads `CsUnits`, so the test block must load it before `CsTrace.js`. Insert above the `CsTrace.js` load in Step 1's block:

```js
    loadRepoScript("scripts/CaveSurvey/Core/CsUnits.js");
```

- [ ] **Step 5: Wire `CsTrace.js` into `CsAll.js`.** Tools include the Core through that one file, so a Core file missing from it is undefined at runtime with nothing to say so. Add after the `CsLayers.js` line:

```js
include(includeBasePath + "/CsTrace.js");
```

`CsTrace` references `CsUnits` and `CsLayers` only inside function BODIES, never at load time, so it could sit anywhere in the list — placing it after `CsLayers.js` keeps the reading order honest about what it leans on.

- [ ] **Step 6: Close the class, not just the instance.** Nothing in the suite currently notices a Core file missing from `CsAll.js`. Add to `tests/test_addon.py`:

```python
    def test_every_core_file_is_included_by_csall(self):
        # A Core file missing from CsAll.js is undefined at runtime in
        # every tool, and NOTHING else in this suite notices: the unit
        # tests load Core files individually with loadRepoScript, so
        # they pass either way. This is the only place that gap is seen.
        core = os.path.join(ADDON, "Core")
        listed = open(os.path.join(core, "CsAll.js")).read()
        missing = []
        for root, _dirs, files in os.walk(core):
            for name in sorted(files):
                if not name.startswith("Cs") or not name.endswith(".js"):
                    continue
                if name == "CsAll.js":
                    continue
                if '"/%s"' % name not in listed and \
                        '/%s"' % name not in listed:
                    missing.append(os.path.relpath(
                        os.path.join(root, name), core))
        self.assertEqual(sorted(missing), [],
                         "these Core files are not included by CsAll.js: "
                         "%s" % sorted(missing))
```

- [ ] **Step 7: Run the structural test and confirm it would have caught this.** Comment out the `CsTrace.js` include added in Step 5, run `python3 -m unittest tests.test_addon -k csall`, confirm it FAILS naming `CsTrace.js`, then restore the include and confirm it passes.

- [ ] **Step 8: Run to verify the unit tests pass.**

Run: `node tests/js_unit.js`
Expected: `### UNIT OK` with a count above 1639

- [ ] **Step 9: Mutation-check each criterion.** For each, make the edit, run `node tests/js_unit.js`, confirm a NAMED test fails, then revert:
  - Delete the `if (CsTrace.distance(tail, last) > 0)` tail push → `CsTrace.resample: last input point kept` fails.
  - Change `!(spacing > 0)` to `spacing < 0` → `CsTrace.resample: spacing 0 returns the input, it does not hang` hangs or fails.
  - Delete the `if (!(segment > 0)) { continue; }` guard → `CsTrace.resample: a zero-length segment is skipped, not divided by` fails.
  - Change `keep[0] = true` to `keep[0] = false` → `CsTrace.reduce: endpoints survive any tolerance` fails.
  - Change `!(worst > tolerance)` to `!(worst > 0)` → `CsTrace.reduce: a bulge inside tolerance is dropped` fails.
  - Make `copyOf` return `points` → `CsTrace.resample: the caller's array is untouched` still passes (it does not mutate), but `CsTrace.reduce: the caller's array is untouched` still passes too. **This mutation survives.** Report it: both functions build new arrays regardless, so `copyOf`'s copying is only load-bearing on the degenerate paths. Add one assertion that mutates the returned degenerate array and re-reads the source:

```js
    var aliasProbe = [pt(1, 1)];
    var aliasOut = CsTrace.resample(aliasProbe, 1.0);
    aliasOut[0].x = 99;
    near(aliasProbe[0].x, 1.0, 1e-9,
        "CsTrace.resample: the degenerate return does not alias the input");
```

- [ ] **Step 10: Commit.**

```bash
git add scripts/CaveSurvey/Core/CsTrace.js scripts/CaveSurvey/Core/CsAll.js \
        tests/js_unit.js tests/test_addon.py
git commit -m "feat(CsTrace): resample and reduce a captured drag"
```

---

## Task 2: `CsTrace.profileRegion` and `frameAt` — the point→frame test

**Goal:** Answer "which view does this POINT fall in", derived from the one frame test rather than restating it.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsTrace.js`
- Modify: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `CsTrace.profileRegion(doc)` returns `{minX, minY, maxX, maxY}` for the profile frame, or `null` when there are none. **DEVIATION FROM PLAN, implemented:** it delegates to a generalised `CsProfileDraw.frameExtents(doc, frame)` rather than carrying its own union. `planExtents` already was this function with `"plan"` written into the middle of it — including the try/catch around a bridge-refused layer or bounding box, and `Math.min(c1.x, c2.x)` rather than assuming `getCorner1()` holds the smaller coordinate, which the planned duplicate got wrong. `planExtents(doc)` survives as a thin alias so no existing caller changed
- [ ] `profileRegion` asks `CsLayers.frameOf` and does NOT test for a `PROFILE-` prefix itself — grepping this file for the string `"PROFILE"` finds nothing
- [ ] `CsTrace.frameIn(box, point)` is PURE — a box and a point in, a frame string out, no document — so node runs it and callers can CACHE the box
- [ ] `CsTrace.frameAt(doc, point)` is a thin wrapper over `frameIn(profileRegion(doc), point)` and returns `"profile"` inside the box, `"plan"` outside it
- [ ] `frameAt` returns `"plan"` for every point when the drawing holds no profile-frame geometry
- [ ] A point in the gutter between the plan and the region answers `"plan"`, matching `frameOf`'s own deliberate "unrecognised → plan" bias
- [ ] The region is derived from ENTITIES, not from `CsProfileDraw.regionOrigin`: a hand-traced spline on `PROFILE-CEILING` sitting below the generated band extends the region, and a point on that spline answers `"profile"`
- [ ] Plan and profile geometry placed at deliberately OVERLAPPING absolute coordinates resolve correctly in BOTH directions
- [ ] `CsTrace.pathFrame(box, points)` returns the single frame every point shares, or `null` if they disagree — the whole-path check `mouseReleaseEvent` needs. It takes the BOX, not the document: computing the region once per drag instead of once per point keeps it O(points) rather than O(points × entities)

**Verify:** `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/js_unit.js "$PWD"` → `### UNIT OK` above 2702

**Steps:**

- [ ] **Step 1: Write the failing tests.** Append to `tests/js_unit.js`, guarded because it needs a real document:

```js
// ---------------------------------------------------------------------
// CsTrace -- the point-to-frame region test (QCAD only: needs RDocument)
// ---------------------------------------------------------------------
if (!IS_NODE) {
    (function() {
        loadRepoScript("scripts/CaveSurvey/Core/CsLayers.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsTrace.js");

        function lineOn(doc, di, layerName, x1, y1, x2, y2) {
            CsLayers.ensure(doc, di, layerName);
            var e = new RLineEntity(doc, new RLineData(
                new RVector(x1, y1), new RVector(x2, y2)));
            e.setLayerId(doc.getLayerId(layerName));
            var op = new RAddObjectsOperation();
            op.addObject(e, false);
            di.applyOperation(op);
            return e;
        }

        // -- an empty drawing has no region at all -------------------
        var docA = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var diA = new RDocumentInterface(docA);
        ok(CsTrace.profileRegion(docA) === null,
            "CsTrace.profileRegion: a drawing with no profile geometry has no region");
        eqs(CsTrace.frameAt(docA, { x: 0, y: -500 }), "plan",
            "CsTrace.frameAt: with no region every point is plan");

        // -- plan above, profile below, as CsProfileDraw places them --
        var docB = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var diB = new RDocumentInterface(docB);
        lineOn(docB, diB, CsLayers.WALLS_SURVEYED, 0, 0, 100, 50);
        lineOn(docB, diB, CsLayers.PROFILE_TRACED_CEILING, 0, -200, 100, -180);

        var region = CsTrace.profileRegion(docB);
        ok(region !== null, "CsTrace.profileRegion: profile geometry makes a region");
        near(region.maxY, -180, 1e-6,
            "CsTrace.profileRegion: the region's top is the profile geometry's top");

        eqs(CsTrace.frameAt(docB, { x: 50, y: -190 }), "profile",
            "CsTrace.frameAt: a point inside the region is profile");
        eqs(CsTrace.frameAt(docB, { x: 50, y: 25 }), "plan",
            "CsTrace.frameAt: a point in the plan geometry is plan");
        eqs(CsTrace.frameAt(docB, { x: 50, y: -100 }), "plan",
            "CsTrace.frameAt: a point in the gutter is plan, not profile");

        // -- hand-traced linework grows the region -------------------
        lineOn(docB, diB, CsLayers.PROFILE_TRACED_FLOOR, 0, -400, 100, -390);
        eqs(CsTrace.frameAt(docB, { x: 50, y: -395 }), "profile",
            "CsTrace.frameAt: hand-traced profile linework extends the region");

        // -- OVERLAPPING coordinates, both directions ----------------
        // The real risk: one model space, two frames. A profile line at
        // the SAME absolute coordinates as plan geometry must still
        // answer profile, and the plan line must still answer plan.
        var docC = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var diC = new RDocumentInterface(docC);
        lineOn(docC, diC, CsLayers.PROFILE_TRACED_CEILING, 0, 0, 100, 10);
        eqs(CsTrace.frameAt(docC, { x: 50, y: 5 }), "profile",
            "CsTrace.frameAt: a profile region at the origin is still profile");

        var docD = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var diD = new RDocumentInterface(docD);
        lineOn(docD, diD, CsLayers.WALLS_SURVEYED, 0, 0, 100, 10);
        eqs(CsTrace.frameAt(docD, { x: 50, y: 5 }), "plan",
            "CsTrace.frameAt: the same coordinates with only plan geometry are plan");

        // -- the whole-path check -----------------------------------
        var boxB = CsTrace.profileRegion(docB);
        eqs(CsTrace.pathFrame(boxB, [{ x: 50, y: -190 }, { x: 60, y: -185 }]),
            "profile",
            "CsTrace.pathFrame: a path wholly inside the region is profile");
        ok(CsTrace.pathFrame(boxB, [{ x: 50, y: 25 }, { x: 50, y: -190 }]) === null,
            "CsTrace.pathFrame: a path crossing the gutter has no single frame");
        eqs(CsTrace.frameIn(null, { x: 0, y: 0 }), "plan",
            "CsTrace.frameIn: a null region makes every point plan");
    })();
}
```

- [ ] **Step 2: Run to verify it fails.**

Run: `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/js_unit.js "$PWD"`
Expected: FAIL — `CsTrace.profileRegion is not a function`

- [ ] **Step 3: Write the implementation.** Append to `scripts/CaveSurvey/Core/CsTrace.js`:

```js
// ---------------------------------------------------------------------
// The point-to-frame test. QCAD context only -- it reads a document.
// ---------------------------------------------------------------------

/**
 * The bounding box of everything drawn in the profile frame, as
 * {minX, minY, maxX, maxY}, or null when this drawing has no profile
 * geometry in it at all.
 *
 * Derived from ENTITIES, deliberately, rather than from
 * CsProfileDraw.regionOrigin(). Two reasons. The origin marker gives a
 * POINT and not an extent, so a region test built on it would have to
 * re-derive the band bounds from the survey model -- work this tool has
 * no reason to do. And the caver's own tracing legitimately grows the
 * region: a floor sketched below the generated band is profile-frame
 * geometry, and a region that stopped at the generator's output would
 * call the caver's own linework plan.
 *
 * The frame of each entity comes from CsLayers.frameOf and nowhere
 * else. This file must never learn to recognise a PROFILE- prefix
 * itself -- that second spelling is exactly what frameOf exists to
 * prevent, and the two would drift the first time the naming changed.
 */
CsTrace.profileRegion = function(doc) {
    var ids = doc.queryAllEntities(false, false);
    var box = null;
    var i;

    for (i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var layerName = doc.getLayerName(e.getLayerId());
        if (CsLayers.frameOf(layerName) !== "profile") {
            continue;
        }
        var bb = e.getBoundingBox();
        if (isNull(bb)) {
            continue;
        }
        var lo = bb.getCorner1();
        var hi = bb.getCorner2();
        if (box === null) {
            box = { minX: lo.x, minY: lo.y, maxX: hi.x, maxY: hi.y };
            continue;
        }
        box.minX = Math.min(box.minX, lo.x);
        box.minY = Math.min(box.minY, lo.y);
        box.maxX = Math.max(box.maxX, hi.x);
        box.maxY = Math.max(box.maxY, hi.y);
    }

    return box;
};

/**
 * Which view a POINT falls in: "profile" inside the profile region,
 * "plan" everywhere else.
 *
 * "plan" is the answer for anything outside the region, INCLUDING the
 * gutter between the two views, and including every point in a drawing
 * that has no elevation yet. That matches CsLayers.frameOf's own
 * deliberate default: the dangerous mistake is a profile-scoped
 * operation claiming ground it does not own, so unclaimed ground
 * belongs to the frame that owns the drawing's origin.
 */
CsTrace.frameIn = function(box, point) {
    if (box === null || isNull(box)) {
        return "plan";
    }
    if (point.x < box.minX || point.x > box.maxX ||
            point.y < box.minY || point.y > box.maxY) {
        return "plan";
    }
    return "profile";
};

/**
 * frameIn against the region this document happens to have right now.
 *
 * Convenience only, and NOT for use per mouse-move event: it walks
 * every entity in the drawing to find the region. Anything asking
 * repeatedly -- the cursor readout, the whole-path check -- must call
 * profileRegion ONCE, hold the box, and use frameIn.
 */
CsTrace.frameAt = function(doc, point) {
    return CsTrace.frameIn(CsTrace.profileRegion(doc), point);
};

/**
 * The one frame every point of a path shares, or null when they
 * disagree.
 *
 * null is what makes a cross-gutter drag refusable at release. A wall
 * that starts in the plan and ends in the elevation describes nothing
 * in either view, and letting it land would put linework into a
 * drawing whose whole binding model assumes frames do not mix.
 */
CsTrace.pathFrame = function(box, points) {
    if (isNull(points) || points.length === 0) {
        return null;
    }
    var first = CsTrace.frameIn(box, points[0]);
    for (var i = 1; i < points.length; i++) {
        if (CsTrace.frameIn(box, points[i]) !== first) {
            return null;
        }
    }
    return first;
};
```

- [ ] **Step 4: Run to verify it passes.**

Run: `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/js_unit.js "$PWD"`
Expected: `### UNIT OK` above 2702. Also run `node tests/js_unit.js` and confirm it still reports above 1639 — the new block is `if (!IS_NODE)` so node's count must be unchanged from Task 1.

- [ ] **Step 5: Prove the no-second-spelling criterion mechanically.**

```bash
grep -c PROFILE scripts/CaveSurvey/Core/CsTrace.js
```

Expected: `0`. A non-zero count means this file has learned to recognise the prefix itself — fix it by asking `CsLayers.frameOf` instead.

- [ ] **Step 6: Mutation-check.** For each, make the edit, run the CaveCAD suite, confirm a NAMED test fails, revert:
  - Change `!== "profile"` to `=== "plan"` in `profileRegion` → `CsTrace.profileRegion: profile geometry makes a region` fails.
  - Make `frameAt` return `"profile"` when `box === null` → `CsTrace.frameAt: with no region every point is plan` fails.
  - Drop the `point.y > box.maxY` term → `CsTrace.frameAt: a point in the gutter is plan, not profile` fails.
  - Make `frameIn` return `"profile"` for a null box → `CsTrace.frameIn: a null region makes every point plan` fails.
  - Make `pathFrame` return `first` unconditionally → `CsTrace.pathFrame: a path crossing the gutter has no single frame` fails.

- [ ] **Step 7: Commit.**

```bash
git add scripts/CaveSurvey/Core/CsTrace.js tests/js_unit.js
git commit -m "feat(CsTrace): answer which frame a point and a path fall in"
```

---

## Task 3: `CsTrace.fitSpline` and `CsTrace.emit`

**Goal:** Turn reduced points into an `RSpline` on the right layer, surviving a layer that is switched off.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsTrace.js`
- Modify: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `CsTrace.fitSpline(doc, points)` returns an `RSplineEntity` whose fit points are exactly the input points in order
- [ ] `fitSpline` calls no `setDegree`, matching stock `addSpline` in `simple_create.js`, and a test PINS that the result is cubic (`getDegree() === 3`) rather than assuming it
- [ ] `fitSpline` returns `null` for fewer than 2 points rather than an entity with nothing in it
- [ ] `CsTrace.emit(doc, di, layerName, points, spacing, tolerance)` runs resample → reduce → fit → add, and the added entity's layer is `layerName`
- [ ] `emit` calls `CsLayers.ensure`, so tracing onto a layer the drawing lacks creates it with its registry appearance rather than falling back to a default
- [ ] `emit` lands the spline even when the target layer is switched OFF, by wrapping the add in `CsLayers.withLayerOn`
- [ ] After an `emit` onto a layer that was off, the layer is off again
- [ ] `emit` returns `{added: true, sampled: N, kept: M}` so the panel can report the counts, and `{added: false}` when there was nothing to draw
- [ ] `emit` adds NOTHING when given fewer than 2 points — asserted by entity count, not by the return value alone
- [ ] `emit` sets no `CsBind` tag: binding is the existing `CsBind.tagEntities` sweep's job, and tagging here would double-bind

**Verify:** CaveCAD `tests/js_unit.js` → `### UNIT OK` above the Task 2 count

**Steps:**

- [ ] **Step 1: Write the failing tests.** Append inside a new `if (!IS_NODE)` block in `tests/js_unit.js`:

```js
// ---------------------------------------------------------------------
// CsTrace -- fitSpline and emit (QCAD only: RSpline and a document)
// ---------------------------------------------------------------------
if (!IS_NODE) {
    (function() {
        loadRepoScript("scripts/CaveSurvey/Core/CsLayers.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsBind.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsTrace.js");

        function pt(x, y) { return { x: x, y: y }; }

        // -- fitSpline ----------------------------------------------
        var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var di = new RDocumentInterface(doc);

        ok(CsTrace.fitSpline(doc, [pt(0, 0)]) === null,
            "CsTrace.fitSpline: one point is not a curve");

        var spline = CsTrace.fitSpline(doc, [pt(0, 0), pt(5, 1), pt(10, 0)]);
        ok(!isNull(spline), "CsTrace.fitSpline: three points make a spline");
        eqs(spline.getFitPoints().length, 3,
            "CsTrace.fitSpline: every input point becomes a fit point");

        // -- emit onto a normal layer -------------------------------
        var before = doc.queryAllEntities(false, false).length;
        var result = CsTrace.emit(doc, di, CsLayers.WALLS_SURVEYED,
            [pt(0, 0), pt(10, 0), pt(20, 0)], 1.0, 0.01);
        ok(result.added === true, "CsTrace.emit: a real path is added");
        eqs(doc.queryAllEntities(false, false).length, before + 1,
            "CsTrace.emit: exactly one entity lands");
        ok(result.sampled > result.kept,
            "CsTrace.emit: reduction dropped points from a straight run");

        var ids = doc.queryAllEntities(false, false);
        var landed = doc.queryEntity(ids[ids.length - 1]);
        eqs(doc.getLayerName(landed.getLayerId()), CsLayers.WALLS_SURVEYED,
            "CsTrace.emit: the spline lands on the named layer");

        // -- emit adds nothing for a degenerate path ----------------
        var beforeShort = doc.queryAllEntities(false, false).length;
        var shortResult = CsTrace.emit(doc, di, CsLayers.WALLS_SURVEYED,
            [pt(3, 3)], 1.0, 0.01);
        ok(shortResult.added === false,
            "CsTrace.emit: a one-point path reports nothing added");
        eqs(doc.queryAllEntities(false, false).length, beforeShort,
            "CsTrace.emit: a one-point path adds no entity");

        // -- emit onto an OFF layer ---------------------------------
        // This build drops adds on an off layer with NO error at all,
        // and switching the feature layer off to see the scan beneath
        // is the workflow this tool exists for.
        var doc2 = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var di2 = new RDocumentInterface(doc2);
        CsLayers.ensure(doc2, di2, CsLayers.PROFILE_TRACED_CEILING);
        var lay = doc2.queryLayer(CsLayers.PROFILE_TRACED_CEILING);
        lay.setOff(true);
        var opOff = new RModifyObjectsOperation();
        opOff.addObject(lay, false);
        di2.applyOperation(opOff);
        ok(doc2.queryLayer(CsLayers.PROFILE_TRACED_CEILING).isOff(),
            "CsTrace.emit fixture: the target layer starts off");

        var offBefore = doc2.queryAllEntities(false, false).length;
        CsTrace.emit(doc2, di2, CsLayers.PROFILE_TRACED_CEILING,
            [pt(0, -100), pt(10, -100), pt(20, -95)], 1.0, 0.01);
        eqs(doc2.queryAllEntities(false, false).length, offBefore + 1,
            "CsTrace.emit: the spline lands even though the layer is off");
        ok(doc2.queryLayer(CsLayers.PROFILE_TRACED_CEILING).isOff(),
            "CsTrace.emit: the layer is switched back off afterwards");

        // -- no binding tag ----------------------------------------
        var traced = doc2.queryEntity(
            doc2.queryAllEntities(false, false)[offBefore]);
        ok(!CsBind.hasLineworkTags(traced),
            "CsTrace.emit: leaves binding to the CsBind sweep, tags nothing");
    })();
}
```

- [ ] **Step 2: Run to verify it fails.**

Run: CaveCAD `tests/js_unit.js`
Expected: FAIL — `CsTrace.fitSpline is not a function`

- [ ] **Step 3: Write the implementation.** Append to `scripts/CaveSurvey/Core/CsTrace.js`:

```js
/**
 * A degree-3 spline through `points` as FIT points, or null when there
 * is no curve to make.
 *
 * Fit points and not control points: a fit-point spline passes through
 * the places the caver actually dragged over, and QCAD's own spline
 * editing then lets those points be nudged afterwards. Control points
 * would put the curve near the trace instead of on it.
 */
CsTrace.fitSpline = function(doc, points) {
    if (isNull(points) || points.length < 2) {
        return null;
    }
    var spline = new RSpline();
    spline.setDegree(3);
    for (var i = 0; i < points.length; i++) {
        spline.appendFitPoint(new RVector(points[i].x, points[i].y));
    }
    return new RSplineEntity(doc, new RSplineData(spline));
};

/**
 * The whole pipeline: resample the captured drag, reduce it, fit a
 * spline, and add it to `layerName`.
 *
 * Wrapped in CsLayers.withLayerOn because this build's
 * RAddObjectsOperation silently refuses an add to a layer that is off
 * -- no error, no exception, the entity simply never lands. Switching
 * the feature layer off to see the scanned sketch underneath is the
 * ordinary way to use this tool, so without the wrapper the tool would
 * appear to work and draw nothing.
 *
 * Deliberately does NOT tag the result for binding. The existing
 * CsBind.tagEntities sweep picks up new linework on a bindable layer
 * already; tagging here would bind it twice.
 *
 * \return {added: bool, sampled: int, kept: int}
 */
CsTrace.emit = function(doc, di, layerName, points, spacing, tolerance) {
    var spaced = CsTrace.resample(points, spacing);
    var kept = CsTrace.reduce(spaced, tolerance);
    var spline = CsTrace.fitSpline(doc, kept);
    if (spline === null) {
        return { added: false, sampled: spaced.length, kept: kept.length };
    }

    CsLayers.ensure(doc, di, layerName);
    spline.setLayerId(doc.getLayerId(layerName));

    CsLayers.withLayerOn(doc, di, layerName, function() {
        var op = new RAddObjectsOperation();
        op.addObject(spline, false);
        di.applyOperation(op);
    });

    return { added: true, sampled: spaced.length, kept: kept.length };
};
```

- [ ] **Step 4: Run to verify it passes.**

Run: CaveCAD `tests/js_unit.js`
Expected: `### UNIT OK` above the Task 2 count. `node tests/js_unit.js` unchanged from Task 1.

- [ ] **Step 5: Mutation-check.**
  - Remove the `CsLayers.withLayerOn` wrapper (apply the operation directly) → `CsTrace.emit: the spline lands even though the layer is off` fails.
  - Remove the `CsLayers.ensure` call → the `setLayerId` resolves to an invalid id and `CsTrace.emit: the spline lands on the named layer` fails.
  - Change `points.length < 2` to `points.length < 1` in `fitSpline` → `CsTrace.fitSpline: one point is not a curve` fails.
  - Add a `CsBind` tag inside `emit` → `CsTrace.emit: leaves binding to the CsBind sweep, tags nothing` fails.

- [ ] **Step 6: Commit.**

```bash
git add scripts/CaveSurvey/Core/CsTrace.js tests/js_unit.js
git commit -m "feat(CsTrace): fit a spline and emit it onto its feature layer"
```

---

## Task 4: `FeatureTraceRun` — the drag action, one hardcoded target

**USER-ORDERED GATE — NON-SKIPPABLE.** This task was requested by the user in the current conversation. It MUST NOT be closed by walking around it, by declaring it "verified inline", or by substituting a cheaper check. Close only after every item in the acceptance criteria has been re-validated independently, with output captured.

**Goal:** Prove drag capture, preview and emit work end-to-end inside CaveCAD, with the target hardcoded to `WALLS-SURVEYED` and no panel yet.

**Files:**
- Create: `scripts/CaveSurvey/FeatureTrace/FeatureTrace.js`
- Create: `scripts/CaveSurvey/FeatureTrace/FeatureTraceRun.js`
- Create: `scripts/CaveSurvey/FeatureTrace/FeatureTrace.svg`
- Create: `scripts/CaveSurvey/FeatureTrace/FeatureTrace-inverse.svg`

**Acceptance Criteria:**
- [ ] `./tests/run_all.sh --publish` passes, structural tests included — the three constraints in the Conventions section above are what this exercises
- [ ] **DEVIATION, implemented:** sort order is **45**, not the 75 this plan first proposed — 75 is Generate Profile's, and a clash leaves menu order down to load sequence. 45 puts Feature Trace beside Scatter Breakdown (40), the other drawing tool
- [ ] **DEVIATION, implemented:** `FeatureTraceRun.frameGuard` and the whole-path check landed HERE rather than in Task 6, because `mousePressEvent` cannot be written without them. Task 6 keeps only the panel-side indicators
- [ ] **DEVIATION, implemented:** Task 7 (the README row) was pulled forward, so the suite is green for the remaining tasks instead of hiding new breakage behind a known failure
- [ ] The Cave Survey menu and toolbar both show one new "Feature Trace" entry
- [ ] Holding the left button and dragging across the drawing area shows a live preview polyline following the cursor
- [ ] Releasing the button replaces the preview with ONE spline on `WALLS-SURVEYED`, and the spline has visibly fewer control points than the drag had samples
- [ ] The spline's fit points sit on the path that was dragged, within roughly a foot
- [ ] `Escape` before pressing the button ends the tool; `Escape` mid-drag abandons the run and adds nothing
- [ ] Dragging with `Ctrl` held does NOT trace (that modifier is reserved, as in stock `LineFreehand`)
- [ ] One trace is ONE undo step when the layer is on
- [ ] Zooming in and out changes the on-screen sample density hardly at all, because the capture threshold is screen-space
- [ ] Nothing lands on any layer other than `WALLS-SURVEYED`

**Verify:** `./tests/run_all.sh --publish` → `ALL TESTS PASSED -- including publish checks`, then `./tools/publish.sh` and a full CaveCAD restart, then the GUI observations above captured by hand with the drawing's layer list before and after

**Steps:**

- [ ] **Step 1: Create the icons.** Two minimal SVGs — a freehand curve. `FeatureTrace.svg` draws in `#000000`, `FeatureTrace-inverse.svg` is identical with `#ffffff`, matching every other tool folder. The publish gate parses both, so they must be well-formed XML with an `<svg>` root:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <path d="M3 22 C 8 8, 14 26, 19 12 S 27 18, 29 9"
        fill="none" stroke="#000000" stroke-width="2.2"
        stroke-linecap="round"/>
  <circle cx="3" cy="22" r="2.2" fill="#000000"/>
  <circle cx="29" cy="9" r="2.2" fill="#000000"/>
</svg>
```

- [ ] **Step 2: Write `FeatureTraceRun.js`.** Derived from `scripts/Draw/Line/LineFreehand/LineFreehand.js` (QCAD, GPLv3 — the same licence as this fork, attributed in the header):

```js
// FeatureTraceRun.js -- the interactive half of Feature Trace.
//
// Derived from QCAD's scripts/Draw/Line/LineFreehand/LineFreehand.js
// (Copyright 2011-2018 Andrew Mustun, GPLv3), which is where the
// press/drag/release shape and the Ctrl-modifier exclusion come from.
//
// NOT an add-on QCAD can find: AddOn.getAddOns only ever builds an
// add-on from <dir>/<dir>.js, so this file's init() is never called by
// QCAD and FeatureTrace.init() calls it instead. That is also why the
// structural tests, which read only the folder-named file, do not
// require a menu entry, icon or command name here.

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function FeatureTraceRun(guiAction) {
    EAction.call(this, guiAction);

    this.samples = [];      // {x, y} in drawing coordinates
    this.refused = false;   // this drag started in the wrong frame
}

FeatureTraceRun.prototype = new EAction();

FeatureTraceRun.State = {
    Idle: 0,
    Drawing: 1
};

/** Screen distance, in pixels, between kept samples.
 *
 *  Screen-space and not drawing-space on purpose. A fixed 1 ft drawing
 *  threshold is sub-pixel when zoomed out -- every mouse pixel would
 *  emit several samples -- and lags a foot behind the cursor when
 *  zoomed in. The 1 ft spacing the feature is named for is applied
 *  later, by CsTrace.resample, where it means a foot of cave. */
FeatureTraceRun.SAMPLE_PIXELS = 6;

FeatureTraceRun.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    this.setState(FeatureTraceRun.State.Idle);
};

FeatureTraceRun.prototype.setState = function(state) {
    EAction.prototype.setState.call(this, state);

    this.getDocumentInterface().setClickMode(RAction.PickCoordinate);
    this.setCrosshairCursor();

    switch (this.state) {
    case FeatureTraceRun.State.Idle:
        var trStart = qsTr("Press and drag to trace %1")
            .arg(FeatureTraceRun.targetLayer());
        this.setCommandPrompt(trStart);
        this.setLeftMouseTip(trStart);
        this.setRightMouseTip(EAction.trCancel);
        this.samples = [];
        this.refused = false;
        break;

    case FeatureTraceRun.State.Drawing:
        var trStop = qsTr("Release to finish the run");
        this.setCommandPrompt(trStop);
        this.setLeftMouseTip(trStop);
        this.setRightMouseTip("");
        break;
    }
};

/** The armed layer. Module state on FeatureTrace, set by the panel.
 *  Falls back to WALLS-SURVEYED so this action is usable before the
 *  panel exists (Task 4) and if the panel ever fails to build. */
FeatureTraceRun.targetLayer = function() {
    if (typeof FeatureTrace !== "undefined" &&
            !isNull(FeatureTrace.target)) {
        return FeatureTrace.target;
    }
    return CsLayers.WALLS_SURVEYED;
};

FeatureTraceRun.prototype.escapeEvent = function() {
    if (this.state === FeatureTraceRun.State.Drawing) {
        // Abandon the run. Nothing has been applied yet -- the add
        // happens on release -- so there is nothing to undo.
        this.setState(FeatureTraceRun.State.Idle);
        return;
    }
    EAction.prototype.escapeEvent.call(this);
};

FeatureTraceRun.prototype.mousePressEvent = function(event) {
    if (event.button() !== Qt.LeftButton) {
        return;
    }
    if (event.modifiers().valueOf() === Qt.ControlModifier.valueOf()) {
        return;   // reserved, as in LineFreehand
    }
    if (this.state !== FeatureTraceRun.State.Idle) {
        return;
    }

    this.setState(FeatureTraceRun.State.Drawing);
    var p = event.getModelPosition();
    this.samples = [{ x: p.x, y: p.y }];
};

FeatureTraceRun.prototype.mouseMoveEvent = function(event) {
    if (!(event.buttons().valueOf() & Qt.LeftButton.valueOf())) {
        return;
    }
    if (event.modifiers().valueOf() === Qt.ControlModifier.valueOf()) {
        return;
    }
    if (this.state !== FeatureTraceRun.State.Drawing) {
        return;
    }

    var p = event.getModelPosition();
    var last = this.samples[this.samples.length - 1];
    if (isNull(last) || CsTrace.distance(last, { x: p.x, y: p.y }) >=
            this.sampleThreshold()) {
        this.samples.push({ x: p.x, y: p.y });
        this.updatePreview();
    }
};

/** SAMPLE_PIXELS converted to drawing units at the current zoom.
 *  A view we cannot measure falls back to one drawing unit, which
 *  over-samples rather than under-samples: too many points is a slow
 *  trace, too few is a wrong one. */
FeatureTraceRun.prototype.sampleThreshold = function() {
    try {
        var view = this.getGraphicsView();
        if (!isNull(view)) {
            var factor = view.getFactor();
            if (factor > 0) {
                return FeatureTraceRun.SAMPLE_PIXELS / factor;
            }
        }
    } catch (e) {
        // no measurable view; fall through
    }
    return 1.0;
};

FeatureTraceRun.prototype.mouseReleaseEvent = function(event) {
    if (event.button() !== Qt.LeftButton) {
        return;
    }
    if (this.state !== FeatureTraceRun.State.Drawing) {
        return;
    }

    this.commit();
    this.setState(FeatureTraceRun.State.Idle);
};

/** Resample, reduce, fit and add. The frame guard lands in Task 6. */
FeatureTraceRun.prototype.commit = function() {
    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    if (isNull(doc) || isNull(di) || this.samples.length < 2) {
        return;
    }

    var unit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);
    var spacing = CsTrace.spacingFor(unit);
    var result = CsTrace.emit(doc, di, FeatureTraceRun.targetLayer(),
        this.samples, spacing, spacing / 2.0);

    if (result.added) {
        EAction.handleUserMessage(qsTr("%1: %2 sampled, %3 kept")
            .arg(FeatureTraceRun.targetLayer())
            .arg(result.sampled).arg(result.kept));
    }
};

/** The preview is the CAPTURED path, not the fitted spline.
 *  Re-running resample/reduce/fit on every sampled move buys nothing a
 *  caver can see mid-drag and makes the tool feel heavy. */
FeatureTraceRun.prototype.getOperation = function(preview) {
    if (this.samples.length < 2) {
        return undefined;
    }
    var op = new RAddObjectsOperation();
    op.setText(this.getToolTitle());
    op.setLimitPreview(false);
    for (var i = 0; i < this.samples.length - 1; i++) {
        op.addObject(new RLineEntity(this.getDocument(), new RLineData(
            new RVector(this.samples[i].x, this.samples[i].y),
            new RVector(this.samples[i + 1].x, this.samples[i + 1].y))),
            false);
    }
    return op;
};

FeatureTraceRun.init = function(basePath) {
    // No widget names, no sort order, no icon: this action is reached
    // from the Feature Trace panel and never from a menu. Its variable
    // is deliberately NOT called "action" -- test_sort_orders_are_unique
    // reads "action.setSortOrder" out of the folder-named file, and a
    // second match there would make which one it reads a coin flip.
    var runAction = new RGuiAction(qsTr("Trace Feature"),
        RMainWindowQt.getMainWindow());
    runAction.setRequiresDocument(true);
    runAction.setScriptFile(basePath + "/FeatureTraceRun.js");
};
```

- [ ] **Step 3: Write `FeatureTrace.js`, menu entry only.** The dock arrives in Task 5:

```js
// FeatureTrace.js -- Feature Trace: the menu entry, and (from Task 5)
// the docked panel that arms which feature the next drag traces.
//
// The interactive drag lives in FeatureTraceRun.js beside this file.
// QCAD cannot find that file on its own -- AddOn.getAddOns only builds
// an add-on from <dir>/<dir>.js -- so init() below registers it.

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");
include(includeBasePath + "/FeatureTraceRun.js");

function FeatureTrace(guiAction) {
    EAction.call(this, guiAction);
}

FeatureTrace.prototype = new EAction();

/** The armed target layer, read by FeatureTraceRun.targetLayer().
 *  Module state, which is only safe because the panel SHOWS which row
 *  is armed -- see Task 5. */
FeatureTrace.target = undefined;

FeatureTrace.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    // Task 5 replaces this with the dock toggle. Until then the menu
    // entry starts a trace directly, so Task 4 is testable on its own.
    var di = this.getDocumentInterface();
    var runAction = RGuiAction.getByScriptFile(
        FeatureTrace.basePath + "/FeatureTraceRun.js");
    di.setCurrentAction(new FeatureTraceRun(runAction));

    this.terminate();
};

FeatureTrace.init = function(basePath) {
    FeatureTrace.basePath = basePath;

    var action = new RGuiAction(qsTr("Feature Trace"),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/FeatureTrace.js");
    action.setIcon(basePath + "/FeatureTrace.svg");
    action.setStatusTip(qsTr("Trace cave walls and other features freehand: " +
        "drag along the sketch and a smooth line follows"));
    action.setDefaultCommands(["featuretrace", "ft"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(75);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);

    FeatureTraceRun.init(basePath);
};
```

- [ ] **Step 4: Check the sort order is free before trusting 75.**

```bash
grep -rn "setSortOrder" scripts/CaveSurvey/*/*.js
```

If `75` is taken with group 450, pick a free number and use it instead. `test_sort_orders_are_unique` catches a clash, but reading the list first is cheaper than a failing suite.

- [ ] **Step 5: Run the structural and full suites.**

```bash
./tests/run_all.sh --publish
```

Expected: `ALL TESTS PASSED -- including publish checks`. If `test_every_tool_declares_a_sort_order` fails, the local variable is not called `action`. If `test_every_tool_appears_in_the_readme_table` fails, that is Task 7's job — note it and continue.

- [ ] **Step 6: Publish, restart, then capture the GUI observations.** Run `./tools/publish.sh`, quit CaveCAD completely and reopen it — the repo is not what it runs; see the Conventions note above. Then open a drawing made from the plan template. For each acceptance criterion above, perform it and record the result. Capture, at minimum: the layer list before and after a trace, the undo history depth after one trace, and the control-point count of the resulting spline against the number of samples reported in the command line message.

- [ ] **Step 7: Commit.**

```bash
git add scripts/CaveSurvey/FeatureTrace
git commit -m "feat(FeatureTrace): freehand drag-trace onto a feature layer"
```

---

## Task 5: The docked panel

**Goal:** A `QDockWidget` with the ten rows in two frame-labelled groups, showing which row is armed.

**Files:**
- Modify: `scripts/CaveSurvey/FeatureTrace/FeatureTrace.js`
- Modify: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] The dock is CONSTRUCTED during `init()` and left hidden, so the main window's later `restoreState()` can place and re-show it — the `SurveyNotebook.js:3157` rule
- [ ] `dock.objectName` is `"CaveSurveyFeatureTraceDock"`, without which `restoreState` cannot identify it
- [ ] The menu entry toggles dock visibility rather than starting a trace
- [ ] Two `QGroupBox`es, `Plan` and `Profile`, hold five rows each, in the order and with the labels from the spec's §7
- [ ] Every row's layer comes from a `CsLayers` CONSTANT, never a string literal
- [ ] **PLAN GAP, now closed:** the Interval and Smoothing controls appeared in the spec's panel sketch but no task implemented them. The panel now owns both, and the drag reads them through `FeatureTraceRun.intervalFeet()` / `toleranceFraction()`, which fall back to 1 ft / Medium when there is no panel
- [ ] Interval is in FEET whatever the drawing's unit is (`spacingFor` converts), and the tolerance is a FRACTION of the spacing, so one smoothing setting means the same thing in a foot drawing and a metre one
- [ ] A blank, negative or non-numeric interval falls back to 1 ft rather than becoming a spacing of 0 — `resample` returns the raw drag unchanged at spacing 0
- [ ] `QGroupBox` and `QComboBox` are proven in this bridge (stock `PropertyEditor.js` uses both); the suite had used neither before
- [ ] A test asserts `CsBind.isLineworkLayer` is TRUE for every row's layer — false for any `CTRL-` name, so the `PROFILE_FLOOR`/`PROFILE_TRACED_FLOOR` slip becomes a named failure instead of work the next redraw eats
- [ ] A test asserts every row's `CsLayers.frameOf` matches the group it is built into, and that each group holds exactly 5 rows
- [ ] Clicking a row sets `FeatureTrace.target` and starts `FeatureTraceRun`
- [ ] The armed row is visibly checked and stays checked after the trace completes, and no two rows are ever checked at once
- [ ] Every widget construction and `connect` is wrapped; a bridge refusal collects into a `problems` list and the rest of the panel still works
- [ ] A failure to build the dock at all warns and leaves the menu entry harmless rather than throwing at startup
- [ ] `./tests/run_all.sh --publish` still passes

**Verify:** `./tests/run_all.sh --publish` → `ALL TESTS PASSED -- including publish checks`, then `./tools/publish.sh` and a full CaveCAD restart, then in CaveCAD: open the panel, arm each of the ten rows in turn, trace once per row, and confirm each spline landed on the layer its row names and that the armed row stayed checked

**Steps:**

- [ ] **Step 1: Write the row-table tests first.** These need no widgets — they read `FeatureTrace.ROWS`, so they run headless. Append to `tests/js_unit.js`:

```js
// ---------------------------------------------------------------------
// FeatureTrace.ROWS -- the table cannot name a generator-owned layer
// ---------------------------------------------------------------------
if (!IS_NODE) {
    (function() {
        loadRepoScript("scripts/CaveSurvey/Core/CsLayers.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsBind.js");
        loadRepoScript("scripts/CaveSurvey/FeatureTrace/FeatureTrace.js");

        eqs(FeatureTrace.ROWS.length, 10,
            "FeatureTrace.ROWS: ten traceable features");

        var planCount = 0, profileCount = 0, i;
        for (i = 0; i < FeatureTrace.ROWS.length; i++) {
            var row = FeatureTrace.ROWS[i];

            // The one-word slip this kills: CsLayers.PROFILE_FLOOR is the
            // GENERATED CTRL-PROFILE-FLOOR, which erase() owns and clears.
            // isLineworkLayer is false for anything CTRL-, so a row naming
            // the generated twin fails HERE instead of losing an hour of
            // tracing at the next redraw.
            ok(CsBind.isLineworkLayer(row.layer),
                "FeatureTrace.ROWS: " + row.layer +
                    " is a linework layer, not a generated CTRL- one");

            var frame = CsLayers.frameOf(row.layer);
            ok(frame === "plan" || frame === "profile",
                "FeatureTrace.ROWS: " + row.layer + " is in a view frame");
            if (frame === "plan") { planCount++; } else { profileCount++; }

            ok(!isNull(row.label) && row.label.length > 0,
                "FeatureTrace.ROWS: " + row.layer + " has a label");
        }
        eqs(planCount, 5, "FeatureTrace.ROWS: five plan rows");
        eqs(profileCount, 5, "FeatureTrace.ROWS: five profile rows");
    })();
}
```

Run CaveCAD `tests/js_unit.js`. Expected: FAIL — `FeatureTrace.ROWS is undefined`.

- [ ] **Step 2: Replace `FeatureTrace.js`'s `beginEvent` and add the dock.** The row table and the build, following `SurveyNotebook.buildDock`:

```js
/** The ten traceable features, plan frame first.
 *
 *  Layer CONSTANTS, never literals: CsLayers.PROFILE_FLOOR is the
 *  GENERATED CTRL-PROFILE-FLOOR and CsLayers.PROFILE_TRACED_FLOOR is
 *  the hand-traced PROFILE-FLOOR. They are one word apart and mean
 *  opposite things -- tracing onto the generated layer would look
 *  fine until the next redraw erased the work.
 *
 *  No `frame` field. The frame is DERIVED from CsLayers.frameOf, which
 *  is the only place that question is answered; a second spelling here
 *  is how the two start disagreeing. */
FeatureTrace.ROWS = [
    { label: "Surveyed Walls", layer: CsLayers.WALLS_SURVEYED },
    { label: "Inferred Walls", layer: CsLayers.WALLS_INFERRED },
    { label: "Breakdown", layer: CsLayers.BREAKDOWN },
    { label: "Breakdown Boundary", layer: CsLayers.BREAKDOWN_BOUNDARY },
    { label: "Entrance", layer: CsLayers.ENTRANCE },
    { label: "Ceiling", layer: CsLayers.PROFILE_TRACED_CEILING },
    { label: "Floor", layer: CsLayers.PROFILE_TRACED_FLOOR },
    { label: "Inferred Walls", layer: CsLayers.PROFILE_WALLS_INFERRED },
    { label: "Breakdown", layer: CsLayers.PROFILE_BREAKDOWN },
    { label: "Entrance", layer: CsLayers.PROFILE_ENTRANCE }
];

var csFeatureTraceDock;

FeatureTrace.buildDock = function(appWin) {
    var dock = new QDockWidget(qsTr("Feature Trace"), appWin);
    dock.objectName = "CaveSurveyFeatureTraceDock";

    var w = { problems: [], buttons: [] };
    var body = new QWidget(dock);
    var layout = new QVBoxLayout();

    layout.addWidget(FeatureTrace.buildGroup(w, "plan", qsTr("Plan")), 0, 0);
    layout.addWidget(FeatureTrace.buildGroup(w, "profile", qsTr("Profile")),
        0, 0);
    layout.addStretch(1);

    body.setLayout(layout);
    dock.setWidget(body);

    if (w.problems.length > 0) {
        warning("Feature Trace: bridge refused: " + w.problems.join("; ") +
            " -- those rows are inert; the rest of the panel works.");
    }

    FeatureTrace.widgets = w;
    return dock;
};

/** One QGroupBox holding every row whose layer belongs to `frame`.
 *  Rows are selected by asking CsLayers.frameOf, so the group a button
 *  sits in and the frame its layer belongs to cannot disagree. */
FeatureTrace.buildGroup = function(w, frame, title) {
    var box = new QGroupBox(title);
    var inner = new QVBoxLayout();

    for (var i = 0; i < FeatureTrace.ROWS.length; i++) {
        var row = FeatureTrace.ROWS[i];
        if (CsLayers.frameOf(row.layer) !== frame) {
            continue;
        }
        try {
            var button = new QPushButton(row.label);
            button.checkable = true;
            button.toolTip = row.layer;
            FeatureTrace.connectRow(w, button, row);
            inner.addWidget(button, 0, 0);
            w.buttons.push({ button: button, row: row });
        } catch (e) {
            w.problems.push(row.layer + " (" + e + ")");
        }
    }

    box.setLayout(inner);
    return box;
};

/** Arms the row and starts a trace. Separate function so the closure
 *  captures one row and not the loop variable. */
FeatureTrace.connectRow = function(w, button, row) {
    button.clicked.connect(function() {
        FeatureTrace.arm(row.layer);
        FeatureTrace.startRun();
    });
};

/** Sets the armed target and makes the panel show it.
 *
 *  The showing is not decoration. Panel-only means the target lives in
 *  module state, which is the invisible-mode failure that per-feature
 *  menu commands would have prevented; the panel answers that only
 *  while it displays which row is armed. */
FeatureTrace.arm = function(layerName) {
    FeatureTrace.target = layerName;
    var w = FeatureTrace.widgets;
    if (isNull(w)) {
        return;
    }
    for (var i = 0; i < w.buttons.length; i++) {
        try {
            w.buttons[i].button.checked =
                (w.buttons[i].row.layer === layerName);
        } catch (e) {
            // a button the bridge will not let us read back is still
            // armed correctly; only its display is wrong
        }
    }
};

FeatureTrace.startRun = function() {
    var di = EAction.getDocumentInterface();
    if (isNull(di)) {
        return;
    }
    var runAction = RGuiAction.getByScriptFile(
        FeatureTrace.basePath + "/FeatureTraceRun.js");
    di.setCurrentAction(new FeatureTraceRun(runAction));
};

/** Builds the dock and hands it to the main window. Idempotent. */
FeatureTrace.ensureDock = function() {
    if (csFeatureTraceDock !== undefined && csFeatureTraceDock !== null) {
        return csFeatureTraceDock;
    }
    var appWin = RMainWindowQt.getMainWindow();
    csFeatureTraceDock = FeatureTrace.buildDock(appWin);
    appWin.addDockWidget(Qt.RightDockWidgetArea, csFeatureTraceDock);
    return csFeatureTraceDock;
};
```

- [ ] **Step 3: Replace `beginEvent` with the toggle.**

```js
FeatureTrace.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    try {
        var existed = (csFeatureTraceDock !== undefined &&
            csFeatureTraceDock !== null);
        var dock = FeatureTrace.ensureDock();
        dock.visible = existed ? !dock.visible : true;
    } catch (e) {
        csFeatureTraceDock = undefined;
        warning("Feature Trace: this CaveCAD build refused the docked " +
            "panel (" + e + ") -- please report this.");
    }

    this.terminate();
};
```

- [ ] **Step 4: Build the dock during `init()`, hidden.** Append inside `FeatureTrace.init`, after `FeatureTraceRun.init(basePath)`:

```js
    // Build the dock NOW, during add-on init: the main window's
    // readSettings()/restoreState() runs after init and can only place
    // (and re-show) a dock that already exists. Created hidden; the
    // saved window state decides whether it opens, exactly like QCAD's
    // own docks. First-ever run: stays hidden until the action shows it.
    try {
        var dock = FeatureTrace.ensureDock();
        dock.visible = false;
    } catch (eInit) {
        csFeatureTraceDock = undefined;
        warning("Feature Trace: could not build the panel at startup (" +
            eInit + "); the menu entry will try again.");
    }
```

- [ ] **Step 5: Run the suite.**

```bash
./tests/run_all.sh --publish
```

Expected: `ALL TESTS PASSED -- including publish checks` (bar the README row, which is Task 7).

- [ ] **Step 6: Verify in CaveCAD.** Open the panel, arm each of the ten rows, trace once per row on a template drawing. For each: the spline is on the layer the row's tooltip names, and that row is the only one checked. Then close CaveCAD, reopen it, and confirm the panel returns to where it was left — that is what Step 3's ordering buys.

- [ ] **Step 7: Mutation-check the ordering claim.** Move the `ensureDock()` call out of `init()` and into `beginEvent` only, restart CaveCAD twice, and confirm the panel no longer restores its position. Revert. This one is a manual observation: no headless test can see it.

- [ ] **Step 8: Commit.**

```bash
git add scripts/CaveSurvey/FeatureTrace/FeatureTrace.js
git commit -m "feat(FeatureTrace): a docked panel arming one feature per row"
```

---

## Task 6: The frame guard, the layer-off marker, the cursor readout

**Goal:** Make the panel and the drag refuse and report the failures that are otherwise silent.

**Files:**
- Modify: `scripts/CaveSurvey/FeatureTrace/FeatureTraceRun.js`
- Modify: `scripts/CaveSurvey/FeatureTrace/FeatureTrace.js`
- Modify: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `FeatureTraceRun.frameGuard(box, layerName, point)` returns `null` when the point's frame matches the layer's, and a message string naming BOTH frames when it does not. It takes the cached region box, never the document
- [ ] The profile region is computed ONCE per trace action (in `beginEvent`) and recomputed after each committed trace, never per mouse-move event — `profileRegion` walks every entity in the drawing, and calling it per move would make the tool unusable on a real cave
- [ ] Pressing the button outside the armed row's frame refuses the run: nothing is captured, nothing is added, and the message says which frame the layer belongs to and which the cursor was in
- [ ] A drag that STARTS in frame but crosses the gutter is discarded on release via `CsTrace.pathFrame`, adding nothing
- [ ] After a refused press and after a discarded cross-frame drag, the drawing's entity count is unchanged — asserted, not assumed
- [ ] A row whose target layer is switched off shows it in the panel, and the marker updates when the layer is switched back on
- [ ] The Profile group is disabled, with the reason in its tooltip, when `CsTrace.profileRegion(doc)` is `null`
- [ ] The panel shows the frame the cursor is currently in
- [ ] The guard NEVER auto-corrects to the other frame's row: plan `Walls` has no unambiguous profile counterpart, and a guess would write real geometry
- [ ] **Elevation datum:** tracing on a band in a cave on an ABSOLUTE datum leaves the datum untouched. Traced picks carry z from the pick coordinate, and this suite has found several places where a defaulted z silently rebased a cave. Checked by reading `CsProfileBind`'s view of the band before and after a trace and confirming it is identical
- [ ] **Vertical exaggeration:** with exaggeration at 2x, the sample interval and the reduce tolerance are UNCHANGED — both are drawing-unit quantities governing curve smoothness on the sheet, not cave measurements. A comment in `CsTrace` says so, so nobody later 'fixes' it by dividing by the exaggeration and makes profile traces lumpy

**Verify:** CaveCAD `tests/js_unit.js` → `### UNIT OK` above the Task 3 count, then `./tests/run_all.sh --publish`

**Steps:**

- [ ] **Step 1: Write the failing tests for the guard.** Append to `tests/js_unit.js`:

```js
// ---------------------------------------------------------------------
// FeatureTraceRun.frameGuard -- refuse, never auto-correct
// ---------------------------------------------------------------------
if (!IS_NODE) {
    (function() {
        loadRepoScript("scripts/CaveSurvey/Core/CsLayers.js");
        loadRepoScript("scripts/CaveSurvey/Core/CsTrace.js");
        loadRepoScript("scripts/CaveSurvey/FeatureTrace/FeatureTraceRun.js");

        var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
        var di = new RDocumentInterface(doc);

        CsLayers.ensure(doc, di, CsLayers.PROFILE_TRACED_CEILING);
        var band = new RLineEntity(doc, new RLineData(
            new RVector(0, -200), new RVector(100, -180)));
        band.setLayerId(doc.getLayerId(CsLayers.PROFILE_TRACED_CEILING));
        var op = new RAddObjectsOperation();
        op.addObject(band, false);
        di.applyOperation(op);

        var box = CsTrace.profileRegion(doc);

        // in frame, both ways
        ok(FeatureTraceRun.frameGuard(box, CsLayers.PROFILE_TRACED_CEILING,
            { x: 50, y: -190 }) === null,
            "frameGuard: a profile layer traced inside the region is allowed");
        ok(FeatureTraceRun.frameGuard(box, CsLayers.WALLS_SURVEYED,
            { x: 50, y: 500 }) === null,
            "frameGuard: a plan layer traced outside the region is allowed");

        // out of frame, both ways
        var up = FeatureTraceRun.frameGuard(box,
            CsLayers.PROFILE_TRACED_CEILING, { x: 50, y: 500 });
        ok(up !== null,
            "frameGuard: a profile layer traced up in the plan is refused");
        ok(up.indexOf("profile") >= 0,
            "frameGuard: the refusal names the layer's frame");
        ok(up.indexOf("plan") >= 0,
            "frameGuard: the refusal names the frame the cursor was in");

        var down = FeatureTraceRun.frameGuard(box, CsLayers.WALLS_SURVEYED,
            { x: 50, y: -190 });
        ok(down !== null,
            "frameGuard: a plan layer traced down in the region is refused");
    })();
}
```

- [ ] **Step 2: Run to verify it fails.**

Run: CaveCAD `tests/js_unit.js`
Expected: FAIL — `FeatureTraceRun.frameGuard is not a function`

- [ ] **Step 3: Add the guard to `FeatureTraceRun.js`.**

```js
/**
 * null when `layerName` may be traced at `point`, otherwise the reason
 * it may not.
 *
 * Takes the cached region BOX, not the document: this runs on every
 * press and, via the cursor readout, every move -- and profileRegion
 * walks the whole drawing.
 *
 * REFUSES rather than correcting. There is no unambiguous counterpart
 * to correct to: plan WALLS-SURVEYED maps to the elevation's ceiling
 * or its floor depending on what the caver meant, and a guess would
 * write real geometry from an assumption. A refusal costs one re-arm.
 */
FeatureTraceRun.frameGuard = function(box, layerName, point) {
    var want = CsLayers.frameOf(layerName);
    var got = CsTrace.frameIn(box, point);
    if (want === got) {
        return null;
    }
    return qsTr("%1 belongs to the %2 frame, but the cursor is in the %3 " +
        "frame. Arm the %3 row instead, or move to the %2 view.")
        .arg(layerName).arg(want).arg(got);
};
```

- [ ] **Step 4: Cache the region, and feed the cursor readout from it.** Add to `FeatureTraceRun.js`:

```js
/** Recomputes the cached profile region.
 *
 *  Called once when the action starts and again after every committed
 *  trace -- a trace onto a profile layer GROWS the region, so a stale
 *  box would refuse the next stroke just past the previous one.
 *
 *  Cached at all because profileRegion walks EVERY entity in the
 *  drawing and the cursor readout below asks per mouse-move event. On
 *  a real cave that is thousands of entities per mouse move. */
FeatureTraceRun.prototype.refreshRegion = function() {
    var doc = this.getDocument();
    this.region = isNull(doc) ? null : CsTrace.profileRegion(doc);
};
```

Call it at the end of `beginEvent` and at the end of `commit()`. Then extend `mouseMoveEvent` — the readout updates while the button is UP, which is when it can still change the caver's mind:

```js
FeatureTraceRun.prototype.mouseMoveEvent = function(event) {
    var p = event.getModelPosition();
    var here = { x: p.x, y: p.y };

    if (!(event.buttons().valueOf() & Qt.LeftButton.valueOf())) {
        // Button up: report which view the cursor is over, from the
        // CACHED box (see refreshRegion). This is the readout's whole
        // point -- it can still change the caver's mind before the press.
        if (typeof FeatureTrace !== "undefined" &&
                !isNull(FeatureTrace.showCursorFrame)) {
            FeatureTrace.showCursorFrame(CsTrace.frameIn(this.region, here));
        }
        return;
    }
    if (event.modifiers().valueOf() === Qt.ControlModifier.valueOf()) {
        return;
    }
    if (this.state !== FeatureTraceRun.State.Drawing) {
        return;
    }

    var last = this.samples[this.samples.length - 1];
    if (isNull(last) ||
            CsTrace.distance(last, here) >= this.sampleThreshold()) {
        this.samples.push(here);
        this.updatePreview();
    }
};
```

This REPLACES the `mouseMoveEvent` written in Task 4 — same sampling logic, with the button-up branch added in front of it.

```js
```

And in `FeatureTrace.js`, the label it writes to:

```js
/** Writes the cursor's frame into the panel. Defensive and silent: a
 *  stale or missing readout must never stop a trace. */
FeatureTrace.showCursorFrame = function(frame) {
    var w = FeatureTrace.widgets;
    if (isNull(w) || isNull(w.frameLabel)) {
        return;
    }
    try {
        w.frameLabel.text = qsTr("Cursor frame:  %1").arg(frame.toUpperCase());
    } catch (e) {
        // panel gone, or the bridge refused the write; tracing is
        // unaffected, so say nothing
    }
};
```

Build `w.frameLabel` as a `QLabel` at the top of `buildDock`, above the two groups, inside the same try/catch discipline as the rows.

- [ ] **Step 5: Enforce the guard at press and at release.** In `mousePressEvent`, after the state check and before `setState`:

```js
    var doc = this.getDocument();
    var pressed = event.getModelPosition();
    var refusal = FeatureTraceRun.frameGuard(this.region,
        FeatureTraceRun.targetLayer(), { x: pressed.x, y: pressed.y });
    if (refusal !== null) {
        EAction.handleUserMessage(refusal);
        this.refused = true;
        return;   // nothing captured, nothing to undo
    }
```

And in `commit()`, before the `CsTrace.emit` call:

```js
    // The press was in frame; the RELEASE is what proves the whole path
    // was. A wall crossing the gutter describes nothing in either view.
    if (CsTrace.pathFrame(this.region, this.samples) === null) {
        EAction.handleUserMessage(qsTr("That run crossed between the plan " +
            "and the elevation. Nothing was drawn -- trace within one view."));
        return;
    }
```

- [ ] **Step 6: Add the panel's three indicators.** In `FeatureTrace.js`, a refresh the dock calls when it becomes visible and after each trace:

```js
/** Repaints what the panel knows about the drawing: which target
 *  layers are switched off, whether there is an elevation to trace on
 *  at all, and which frame the cursor is in.
 *
 *  Every one of these is a failure that is otherwise SILENT. An off
 *  layer refuses adds with no error, so an hour of tracing lands
 *  nowhere and nothing says so; a drawing with no elevation refuses
 *  every profile row for a reason no click can explain. */
FeatureTrace.refresh = function() {
    var w = FeatureTrace.widgets;
    if (isNull(w)) {
        return;
    }
    var doc = EAction.getDocument();

    for (var i = 0; i < w.buttons.length; i++) {
        var entry = w.buttons[i];
        try {
            var off = false;
            if (!isNull(doc) && doc.hasLayer(entry.row.layer)) {
                var lay = doc.queryLayer(entry.row.layer);
                off = !isNull(lay) && lay.isOff();
            }
            entry.button.text = off ?
                entry.row.label + "  ⚠ off" : entry.row.label;
            entry.button.toolTip = off ?
                entry.row.layer + " is switched OFF -- switch it on or " +
                    "the trace will not be visible" :
                entry.row.layer;
        } catch (e) {
            // an unreadable button is still armable; only its label is stale
        }
    }

    try {
        var hasRegion = !isNull(doc) &&
            CsTrace.profileRegion(doc) !== null;
        if (!isNull(w.profileGroup)) {
            w.profileGroup.enabled = hasRegion;
            w.profileGroup.toolTip = hasRegion ? "" :
                qsTr("This drawing has no elevation yet -- run Generate " +
                    "Profile first");
        }
    } catch (e2) {
        // leave the group as it is; a wrongly-enabled row still refuses
        // out-of-frame presses via frameGuard
    }
};
```

Store the profile group on `w` in `buildDock` so `refresh` can reach it:

```js
    w.profileGroup = FeatureTrace.buildGroup(w, "profile", qsTr("Profile"));
    layout.addWidget(w.profileGroup, 0, 0);
```

- [ ] **Step 7: Call `refresh` at the two moments it matters.** In `beginEvent`, after `dock.visible = ...`, and at the end of `FeatureTrace.arm`. Wrap both in try/catch — a stale label must never stop a trace.

- [ ] **Step 8: Run both suites.**

```bash
./tests/run_all.sh --publish
```

Expected: `ALL TESTS PASSED -- including publish checks` (bar the README row). CaveCAD unit count above Task 3's.

- [ ] **Step 9: Mutation-check.**
  - Make `frameGuard` always return `null` → `frameGuard: a profile layer traced up in the plan is refused` fails.
  - Drop the `.arg(got)` frame from the message → `frameGuard: the refusal names the frame the cursor was in` fails.
  - Remove the `pathFrame` check in `commit` → no unit test covers it; this is a GUI observation. Perform it: drag from the plan into the band and confirm nothing lands. Report that the headless suite does NOT cover this path.

- [ ] **Step 10: Verify the entity-count criterion in the app.** Note the entity count (Information → drawing statistics, or the layer list), attempt a refused press and a cross-gutter drag, and confirm the count is identical after both.

- [ ] **Step 11: Commit.**

```bash
git add scripts/CaveSurvey/FeatureTrace tests/js_unit.js
git commit -m "feat(FeatureTrace): refuse out-of-frame traces and show silent failures"
```

---

## Task 7: README row and the publish gate

**Goal:** Close the publish checks and document the tool where the other nine are documented.

**Files:**
- Modify: `README.md`

**Acceptance Criteria:**
- [ ] The README tool table gains a Feature Trace row whose command alias matches one of `setDefaultCommands(["featuretrace", "ft"])`
- [ ] `test_every_tool_appears_in_the_readme_table` passes
- [ ] `test_readme_table_advertises_no_tool_that_does_not_exist` still passes
- [ ] The row says what the tool does in one line a beginner can read, matching the register of the existing rows
- [ ] `./tests/run_all.sh --publish` passes with no exceptions noted

**Verify:** `CAVESURVEY_PUBLISH_CHECK=1 python3 -m unittest tests.test_addon` → `OK`, then `./tests/run_all.sh --publish` → `ALL TESTS PASSED -- including publish checks`

**Steps:**

- [ ] **Step 1: Read the existing table to match its shape.**

```bash
grep -n -B2 -A14 "surveynotebook\|snb" README.md | head -40
```

- [ ] **Step 2: Add the row**, in the table's existing column order and register. The alias in the table must be `ft` or `featuretrace` — any other spelling fails the test that reads aliases back out of `setDefaultCommands`.

- [ ] **Step 3: Run the publish gate.**

```bash
CAVESURVEY_PUBLISH_CHECK=1 python3 -m unittest tests.test_addon
```

Expected: `OK`, 28 tests, 0 skipped.

- [ ] **Step 4: Run everything.**

```bash
./tests/run_all.sh --publish
```

Expected: `ALL TESTS PASSED -- including publish checks`, 6 stages.

- [ ] **Step 5: Commit.**

```bash
git add README.md
git commit -m "docs: Feature Trace in the tool table"
```

---

## Task 8: Tie wall traces into nearby wall ends (no-gap walls)

**Goal:** A wall trace that starts or ends near an existing wall end joins it exactly, so a passage can be built from several strokes with no gaps.

**REVERSES a spec decision.** §12 said "Snapping trace ends to each other or to stations" was deliberately out, on the grounds that where two runs meet is a cartographer's judgement. The user has asked for it directly: "i also want the cave wall tools specifically to tie into any nearby existing or previewed splines and continue with them to make no-gap walls easy to do." Their call, and it is the right one for the actual job -- a wall drawn in three strokes with three near-misses is three gaps to hunt down later.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsTrace.js`
- Modify: `scripts/CaveSurvey/FeatureTrace/FeatureTraceRun.js`
- Modify: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `CsTrace.nearestEnd(doc, point, layerName, tolerance)` returns the closest start or end point of an existing curve ON THE SAME LAYER within `tolerance`, or null
- [ ] Same layer only. A wall must not weld itself to a breakdown boundary or to an elevation trace that happens to sit nearby
- [ ] The FIRST sampled point snaps to that end when one is in range, and the LAST likewise, so consecutive strokes share an exact coordinate
- [ ] Tolerance is derived from the sample interval (not a new hardcoded number) and scales with the drawing unit
- [ ] Ends already coincident are left alone -- snapping must be idempotent, so re-tracing a joined wall does not drift it
- [ ] A trace whose both ends land on the SAME existing curve's two ends does not silently close a loop the caver did not draw
- [ ] Only wall layers tie: `WALLS-SURVEYED`, `WALLS-INFERRED` and their profile twins. `ENTRANCE` and the breakdown layers are left alone unless asked for
- [ ] Snapping is visible in the preview, so the caver can see the join happen before releasing

**Verify:** CaveCAD `tests/js_unit.js` above the Task 6 count, then `./tools/publish.sh`, restart, and draw a passage as three strokes -- the joins are exact, checked by selecting the curves and reading their endpoint coordinates

**Open question for the user, to settle before building:** "previewed splines" -- whether a stroke should also tie to the run drawn immediately before it while that one is still the active preview, or only to curves already committed to the drawing. Committed-only is simpler and is what the criteria above describe.

## Task 9: Profile linework ownership (NEXT SESSION -- user's pick)

**Goal:** Settle who owns what on profile-frame layers, so regenerating the elevation can never eat, move or orphan linework a caver drew by hand.

**Why now.** Feature Trace has just started WRITING to profile-frame traceable layers (`PROFILE-CEILING`, `PROFILE-FLOOR`, `PROFILE-WALLS-INFERRED`), in the same drawing the generator rebuilds. Before this there was no hand-drawn profile linework to lose.

**What is already verified (do not re-derive):**
- `CsProfileDraw.erase()` requires **BOTH** a `Profile*` tag **AND** membership of `CsProfileDraw.LAYERS()`. Feature Trace writes NO tags, so its output is out of reach of erase() on that count alone.
- `CsProfileDraw.LAYERS()` is `CTRL-PROFILE-SHOTS`, `-STATIONS`, `-STATION-LABELS`, `-SPLAYS`, `-FLOOR`, `-CEILING`, plus **`PROFILE-TEXT-LABELS`**. Traced `PROFILE-CEILING` and `PROFILE-FLOOR` are NOT in it.
- `CsTrace.emit` adds no `CsBind` tag; the existing `CsBind.tagEntities` sweep is what binds new linework.

**The seam to look at first.** `CsProfileDraw.LAYERS()` claims `PROFILE-TEXT-LABELS` -- an **un-prefixed, bindable, caver-facing** layer -- while every other entry is `CTRL-`. So the generator both writes to and erases from a layer in the user's own namespace. Today the tag half of the gate saves an untagged hand-drawn label, but anything that ever *adopts* linework into a `Profile*` tag (the Notebook's adopt path, `CsRevise`) would make it erasable. Either the generator's labels move to `CTRL-PROFILE-TEXT-LABELS`, or that exception gets stated and tested as deliberate.

**Questions to answer:**
- [ ] Should generated band labels move to a `CTRL-` layer, leaving `PROFILE-TEXT-LABELS` wholly the caver's?
- [ ] Does `translateRegion` move hand-traced profile linework by exactly the origin delta, and is that asserted? A trace that does not travel with its band detaches from the geometry it described.
- [ ] Does `CsBind`'s sweep actually bind traced profile linework to PROFILE-frame stations, so a loop-closure adjustment carries traced ceilings and floors along?
- [ ] Should Feature Trace mark its output as user-owned explicitly, rather than relying on the ABSENCE of a generator tag? Absence is a weak claim -- any future sweep that tags broadly would silently transfer ownership.
- [ ] What happens to a traced ceiling when the survey it described is deleted or re-surveyed? Orphaned linework in the region is the profile-frame twin of the plan's revision problem.

**Verify:** trace on a band, regenerate the elevation, and assert the traced curve is still present, unmoved relative to its band, and still bound to the same station.

### Design question raised by the user: per-run profile layers?

> "would it be helpful to further segregate the profiles by run name? A survey's profile gets A added to the layers generated. Survey G gets G added to the layer names and so forth. it worked well enough to segregate the linework from the plan view, surely we can get more detailed and use it to define profile views as well."

**The goal is right; layers are the expensive way to get it.** Plan-vs-profile worked because it is a CLOSED set of two: enumerable in the template, pinned by `test_registry_layers_exist_in_plan_template`. Survey runs are an OPEN set, unbounded and unknown when the template is built.

Costs, all concrete:
- **This project already tried on-demand layers and reversed it.** That test's own docstring: the wall run layers "used to be exempted here as 'created on demand', and they were indeed created on demand -- which meant a fresh drawing's Layer list did not offer them until the first draw put walls on them."
- **Layer count.** ~7 traceable profile layers plus CTRL- twins is ~14 per run. Forty runs is ~560 layers, and an unusable Layer List is exactly what this would be trying to fix.
- **`CsLayers.DEFAULTS[name]` is an exact-key lookup**, so every `PROFILE-A-CEILING` silently takes the `["white","CONTINUOUS","Weight025"]` fallback -- the same wrong-lineweight trap that already bit `PROFILE-CEILING`.
- The registry-to-template test would have to be weakened from "every registry layer is in the template" to something looser.

**What is already built and does most of the job.** `CsProfileDraw` tags every band entity `ProfileRun = band.key`. Per-run ownership -- regenerate only run G, erase only run G, know which run a traced ceiling belongs to -- needs no new layers, and it is precisely the half this task is about.

**What tags cannot do:** drive the stock Layer List, i.e. switch run G's band off to see past it. That is the only real argument for layers, and it is a smaller feature ("Isolate Run") than a namespace restructure.

**Recommendation:** keep the fixed profile vocabulary, build ownership on `ProfileRun`, and treat per-run visibility as its own feature.

**The number that decides it:** how many survey runs a typical cave has. At ~10-15, per-run profile layers are viable and worth scoping properly -- with appearance resolved by PATTERN from the un-suffixed base layer, so the DEFAULTS trap is closed by construction rather than by discipline. At 50+, tags plus an isolate command wins outright.

**Check before either path:** is `band.key` legal in a DXF layer name? It contains a `CsProfile.PAIR_SEP`, and any sanitising has to round-trip back to the run it names. (`frameOf` is fine either way -- `PROFILE-A-CEILING` still starts with `PROFILE-`.)

## Task 10: Per-run profile layers, on demand

**Built already:** `Core/CsLayerVariants.js` -- the general mechanism. Variants are created on demand, inherit their base layer's appearance through `CsLayers.ensure`, keep their frame and binding eligibility by construction (token last), and parse back to (base, token) by testing the remainder against the registry. Composite tokens work with no extra machinery.

**Correction to an earlier claim in this plan:** on-demand variants do NOT weaken `test_registry_layers_exist_in_plan_template`. That test iterates the REGISTRY, and variants are never registry entries, so it needs no exemption and the invariant is untouched. The earlier note said otherwise and was wrong.

**Scope decided: PROFILE ONLY.** The plan view is not segregated by run. Enforced in code by `CsLayerVariants.ensureProfile`, which refuses a plan- or sheet-frame base, and which every profile-drawing caller uses instead of the general `ensure`. The reason is not symmetry: the plan is ONE CONTINUOUS MAP -- a caver reads a passage across survey boundaries and traces walls straight through them, so per-run plan layers would fragment one wall into several AND stop `CsTrace.nearestEnd` closing the joins, since it only ties within a layer. The elevation is already drawn one band per run, so there the division is real. The general `ensure` stays general for other tools.

**Remaining work:**
- [ ] `CsProfileDraw` calls `CsLayerVariants.ensureProfile` per band and draws that band to its variant layers, instead of all bands sharing one set
- [ ] `CsProfileDraw.erase()` scoped to one run's variants, so regenerating run G leaves run A alone -- the ownership win this was for
- [ ] Feature Trace gains a run selector, so a traced ceiling lands on the right run's layer
- [ ] An "Isolate Run" command built on `CsLayerVariants.layersForToken`
- [ ] A token POLICY function: one place decides what token a band gets, so run-only vs run+trip is a one-line change and not a rewrite

### Design question: segregate by trip as well?

> "should we segregate by survey run and trip as well, so we could have visual of something like 'Survey B from Trip 4' and we'd only see that."

Mechanically free -- `nameFor(base, "B-4")` gives `PROFILE-CEILING-B_4` and is tested. Two reasons not to make it the default:

1. **It breaks the no-gap tie-in.** `CsTrace.nearestEnd` ties only within the SAME layer, on purpose, so a surveyed wall cannot weld to an inferred one. Split run B's ceiling into `-B_3` and `-B_4` because it was continued on a later trip and the tie-in REFUSES to join them -- producing exactly the gap that feature exists to prevent, at every trip boundary.
2. **Trip is already on the entity.** `CsBind.TRIP_TAG` (`LineworkTrip`) carries it and the revision framework depends on it. Trip in the layer name too means two sources of trip truth -- the "second spelling" failure this codebase keeps hitting.

The cleaner division: a survey RUN is stable structure (the profile draws one band per run); a TRIP is provenance. Layers are good at structure, XDATA at provenance.

**Recommendation:** run in the layer, trip stays a tag. "Survey B from Trip 4" becomes an Isolate command combining the run's layers with the trip tag -- which also answers "everything from Trip 4 across all runs", something layer-per-run-per-trip cannot do in one pass. Keep the token policy switchable so run+trip can be tried on a real cave without a rewrite.

## Deferred decisions

Two things the spec's §12 leaves out on purpose, recorded here so a later reader does not mistake them for oversights:

- **Editing an existing trace.** Re-tracing replaces. QCAD's own spline editing already moves fit points on a finished curve, so a point-drag mode would be a second editor for the same geometry.
- **Snapping trace ends to each other or to stations.** Where two wall runs meet is a cartographer's judgement; guessing it welds linework that should stay open.

Neither is scheduled. If either turns out to matter in use, it comes back as its own spec.

## What this plan does NOT cover

- **Geometric write-back.** Dragging a traced ceiling does not change `U`. That is the profile-in-plan spec's own follow-on, unchanged by this work.
- **Automatic tracing from a raster.** Edge detection over a scan is a different feature with a different failure mode.
- **Layer registry work.** Verified unnecessary at HEAD `8035e8b`: all ten targets already carry `DEFAULTS` rows.
