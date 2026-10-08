# Cave 3D Visualization Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the 3D panel seven colour modes, three overlays and a build animation, all over data the Core library already derives.

**Architecture:** All colour and legend logic stays in `Core/CsMesh3d.js`, which is pure and tested under node; it returns buffers plus a legend descriptor, and the C++ view paints the legend it is handed rather than computing one. The animation costs two integers per frame because `build` emits geometry leg by leg and also returns a cumulative vertex count per leg, so revealing the cave is clamping a `glDrawArrays` count.

**Tech Stack:** CaveCAD's ECMAScript engine, C++17 / Qt 6.11 (`QOpenGLWidget`, `QPainter` overlay, `QComboBox`, `QSlider`), the existing `CsNetwork` / `CsAdjust` / `CsClosure` / `CsFrontier` Core modules, node-based headless harness.

**User decisions (already made):**
- All seven colour modes, plus leads, plus data quality, plus size and distance.
- "can we have a loop closure visualization as well, add it as a faint grey ghost" — the pre-adjustment network drawn faint, not just a colour mode.
- "For Dates, just do trip dates, and trips that are on the same date, just order them by survey order."
- "Passage size can be clamped, that's fine."
- Legend is drawn on the 3D canvas itself, not as a separate widget.
- Animation: one leg per tick at a fixed rate; play/pause plus a scrub slider.

Spec: `docs/superpowers/specs/2026-09-12-cave-3d-visualization-design.md`

---

## File Structure

**cavecad-tools (JS):**

| File | Responsibility |
|---|---|
| `scripts/CaveSurvey/Core/CsMesh3d.js` | modify: one-pass build, step table, seven colour modes, legend descriptor, ghost and lead buffers |
| `scripts/CaveSurvey/Cave3D/Cave3D.js` | modify: mode and overlay state, persistence, status text |
| `tests/js_unit.js` | modify: unit tests for every mode and the step table |
| `tests/cave3d_mesh_run.js` | modify: every mode against the Pitfall Cave fixture |

**cavecad-src (C++):**

| File | Responsibility |
|---|---|
| `src/gui/RCave3dView.h/.cpp` | modify: ghost and lead buffers, progress clamp, QPainter legend |
| `src/gui/RCave3dPanel.h/.cpp` | modify: two-row toolbar, mode combo, overlay toggles, play and slider |
| `src/gui/RCave3dBridge.h/.cpp` | modify: pass ghost/leads/legend/steps through, expose mode and progress |
| `qcadjsapi/RScriptHandlerJs.cpp` | untouched — but see the build note below |

**BUILD NOTE, non-negotiable:** `qcadjsapi` has its own ninja tree and is NOT built by building `cavecad-src`, yet it includes `RCave3dBridge.h`. Any task that changes that header MUST run ninja in BOTH trees. Rebuilding one leaves the two libraries disagreeing about the object's size, which is heap corruption surfacing as an `EXC_BREAKPOINT` inside `malloc` during `QJSEngine` setup, with a backtrace full of QtQml frames and nothing pointing at the cause.

---

### Task 1: One pass over the legs, and a step table

**Goal:** `CsMesh3d.build` emits the centerline and the shell in one walk of the legs, and returns a cumulative vertex count per leg.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsMesh3d.js`
- Test: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `build` walks `resolved.legs` exactly once
- [ ] Each leg contributes its centerline segment, and its shell when `kind === "new"`, before the next leg contributes anything
- [ ] `build` returns `steps: [{triangleVertices, lineVertices, station, trip}]`, one entry per leg
- [ ] `steps` is monotonic non-decreasing in both counts
- [ ] The last entry's counts equal `triangles.positions.length / 3` and `lines.positions.length / 3`
- [ ] Triangle and line counts are unchanged from before this task on the Pitfall Cave fixture

**Verify:** `node tests/cave3d_mesh_run.js` → `### CAVE3D MESH OK`, still 530 triangles and 75 segments

**Steps:**

- [ ] **Step 1: Write the failing test**

In `tests/js_unit.js`, after the existing `m3empty` assertions:

```js
// The step table is what the build animation clamps against.
var m3steps = m3.steps;
ok(m3steps !== undefined && m3steps.length === m3resolved.legs.length,
    "one step per leg");
var mono = true;
for (var st = 1; st < m3steps.length; st++) {
    if (m3steps[st].triangleVertices < m3steps[st - 1].triangleVertices ||
            m3steps[st].lineVertices < m3steps[st - 1].lineVertices) {
        mono = false;
    }
}
ok(mono, "the step table never goes backwards");
eqs(String(m3steps[m3steps.length - 1].triangleVertices),
    String(m3.triangles.positions.length / 3),
    "the last step reveals every triangle vertex");
eqs(String(m3steps[m3steps.length - 1].lineVertices),
    String(m3.lines.positions.length / 3),
    "the last step reveals every line vertex");
ok(typeof m3steps[0].station === "string" && m3steps[0].station !== "",
    "each step names the station it arrived at");
```

- [ ] **Step 2: Run, expect failure**

Run: `node tests/cave3d_mesh_run.js` then the engine suite:
`/Applications/CaveCAD.app/Contents/MacOS/cavecad -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/js_unit.js "$PWD"`
Expected: FAIL, `m3.steps` is undefined.

- [ ] **Step 3: Merge the two passes**

In `CsMesh3d.build`, delete the separate `--- the centerline ---` loop and the separate `--- the surface ---` loop, and replace both with ONE loop. The ring cache, `ringFor`, `colorAt`, `requireStation` and `grow` all stay exactly as they are; only the iteration changes:

```js
    var steps = [];

    for (li = 0; li < resolved.legs.length; li++) {
        var leg = resolved.legs[li];
        var a = requireStation(leg.from);
        var b = requireStation(leg.to);
        if (a === null || b === null) {
            // Still a step, so the table stays aligned with the legs and
            // the slider's position means the same thing as the leg
            // index it came from.
            steps.push({
                triangleVertices: tri.positions.length / 3,
                lineVertices: lin.positions.length / 3,
                station: leg.to,
                trip: CsMesh3d.tripAt(leg.to, survey)
            });
            continue;
        }

        // --- this leg's centerline ---
        var colA = colorAt(leg.from, a);
        var colB = colorAt(leg.to, b);
        var lbase = lin.positions.length / 3;
        lin.positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
        lin.colors.push(colA[0], colA[1], colA[2],
                        colB[0], colB[1], colB[2]);
        lin.indices.push(lbase, lbase + 1);
        grow(a);
        grow(b);

        // --- this leg's shell, when it is a spanning-tree leg ---
        if (leg.kind === "new") {
            var along = CsMesh3d.normalize(CsMesh3d.sub(b, a));
            if (along !== null) {
                var dirA = ((counts[leg.from] || 0) >= 3)
                    ? along
                    : CsMesh3d.directionAt(leg.from, legsByStation, resolved);
                var dirB = ((counts[leg.to] || 0) >= 3)
                    ? along
                    : CsMesh3d.directionAt(leg.to, legsByStation, resolved);
                if (dirA === null) { dirA = along; }
                if (dirB === null) { dirB = along; }

                var ringA = ringFor(leg.from, a, dirA);
                var ringB = ringFor(leg.to, b, dirB);
                if (ringA.length >= 3 && ringB.length >= 3) {
                    CsMesh3d.loft(tri, ringA, ringB, colA, colB);
                    var gi;
                    for (gi = 0; gi < ringA.length; gi++) { grow(ringA[gi]); }
                    for (gi = 0; gi < ringB.length; gi++) { grow(ringB[gi]); }
                }
            }
        }

        steps.push({
            triangleVertices: tri.positions.length / 3,
            lineVertices: lin.positions.length / 3,
            station: leg.to,
            trip: CsMesh3d.tripAt(leg.to, survey)
        });
    }
```

Add `steps: steps` to the returned object, and to the empty-survey early return add `steps: []`.

Update the `\return` docblock to name `steps`, and add to the WALKS THE SPANNING TREE paragraph:

```
 * ONE PASS, NOT TWO. The centerline and the shell are emitted together,
 * leg by leg, so both buffers share an ordering -- which is what lets
 * the build animation reveal them in lockstep by clamping a vertex
 * count instead of rebuilding anything.
```

- [ ] **Step 4: Run, expect pass**

Run both suites above.
Expected: PASS, and `node tests/cave3d_mesh_run.js` still reports 530 triangles, 75 centerline segments.

- [ ] **Step 5: Commit**

```bash
git add scripts/CaveSurvey/Core/CsMesh3d.js tests/js_unit.js
git commit -m "refactor: emit the centerline and the shell in one walk of the legs"
```

---

### Task 2: The legend descriptor, over trip and depth

**Goal:** `build` returns a legend describing the colouring it just did, for the two modes that already exist.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsMesh3d.js`
- Test: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `build` returns `legend: {title, kind, note, stops}`
- [ ] Trip mode returns `kind: "swatches"`, one stop per trip, labelled with the trip name or its date, or `"Trip 1"` when it has neither
- [ ] Depth mode returns `kind: "ramp"` with three stops: lowest, middle, highest, each labelled with a rounded value and the survey's distance unit
- [ ] An unknown `colorBy` falls back to trip and the legend says `Trip`
- [ ] A survey with one trip still returns one swatch, not an empty legend

**Verify:** engine suite → `### UNIT OK`

**Steps:**

- [ ] **Step 1: Write the failing tests**

```js
var legTrip = CsMesh3d.build(m3survey, m3resolved, { colorBy: "trip" }).legend;
eqs(legTrip.kind, "swatches", "trip colouring legends as swatches");
eqs(legTrip.title, "Trip", "the trip legend says what it is");
ok(legTrip.stops.length >= 1, "one swatch per trip, at least one");

var legDepth = CsMesh3d.build(m3survey, m3resolved, { colorBy: "depth" }).legend;
eqs(legDepth.kind, "ramp", "depth colouring legends as a ramp");
eqs(String(legDepth.stops.length), "3", "a ramp is labelled at both ends and the middle");
ok(legDepth.stops[0].label.indexOf("ft") >= 0,
    "a depth label carries its unit");

var legJunk = CsMesh3d.build(m3survey, m3resolved, { colorBy: "nonsense" }).legend;
eqs(legJunk.title, "Trip",
    "an unknown mode falls back to trip rather than throwing");
```

- [ ] **Step 2: Run, expect failure**

Expected: FAIL, `legend` is undefined.

- [ ] **Step 3: Implement**

Add above `CsMesh3d.build`:

```js
/** A distance formatted for a legend label: no more precision than a
 *  reader can use, with the unit attached because a bare number on a
 *  colour bar is ambiguous between feet and metres. */
CsMesh3d.legendLength = function(value, unit) {
    var u = (unit === "m") ? "m" : "ft";
    return (Math.round(value * 10) / 10) + " " + u;
};

/** The name to show for a trip: what it calls itself, else its date,
 *  else its position. A trip with neither is still a real trip and
 *  still needs a row. */
CsMesh3d.tripLabel = function(survey, index) {
    var trips = survey.trips || [];
    var t = trips[index];
    if (t !== undefined && t !== null) {
        if (typeof t.name === "string" && t.name !== "") { return t.name; }
        if (typeof t.date === "string" && t.date !== "") { return t.date; }
    }
    return "Trip " + (index + 1);
};
```

In `build`, after `zSpan` is computed, build the legend alongside `colorAt`:

```js
    var legend = { title: "Trip", kind: "swatches", note: "", stops: [] };

    if (colorBy === "depth") {
        legend.title = "Depth";
        legend.kind = "ramp";
        var unit = survey.distanceUnit === "m" ? "m" : "ft";
        legend.stops = [
            { color: CsMesh3d.depthColor(0),
              label: CsMesh3d.legendLength(zLow, unit) },
            { color: CsMesh3d.depthColor(0.5),
              label: CsMesh3d.legendLength(zLow + zSpan / 2, unit) },
            { color: CsMesh3d.depthColor(1),
              label: CsMesh3d.legendLength(zHigh, unit) }
        ];
    } else {
        // Trip, and the fallback for anything unrecognised: an unknown
        // mode is a caller's bug, and a mesh that refused to build over
        // a spelling would take the panel down with it.
        colorBy = "trip";
        var tripCount = Math.max(1, (survey.trips || []).length);
        for (var ti = 0; ti < tripCount; ti++) {
            legend.stops.push({
                color: CsMesh3d.TRIP_COLORS[ti % CsMesh3d.TRIP_COLORS.length],
                label: CsMesh3d.tripLabel(survey, ti)
            });
        }
    }
```

Note the `colorBy = "trip"` reassignment: it must happen BEFORE `colorAt` is called, so the fallback colours and the fallback legend agree. Add `legend: legend` to the return, and a bare `legend: {title: "Trip", kind: "swatches", note: "", stops: []}` to the empty-survey early return.

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add scripts/CaveSurvey/Core/CsMesh3d.js tests/js_unit.js
git commit -m "feat: a mesh says how it was coloured"
```

---

### Task 3: Distance from entrance, passage size, and survey date

**Goal:** Three more ramp modes, with size clamped to the 5th–95th percentile.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsMesh3d.js`
- Test: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `colorBy: "distance"` ramps over traverse distance from the anchor, measured along legs, not straight-line
- [ ] `colorBy: "size"` ramps over each station's ring area
- [ ] Size clamps to the 5th–95th percentile and sets `legend.note` to `"5th-95th percentile"`
- [ ] `colorBy: "date"` ramps over trips sorted by date, with same-date trips ordered by survey order
- [ ] A survey with one trip does not divide by zero in date mode
- [ ] A survey with no LRUD anywhere does not divide by zero in size mode
- [ ] No NaN in any emitted colour in any of the three

**Verify:** engine suite → `### UNIT OK`, and `node tests/cave3d_mesh_run.js`

**Steps:**

- [ ] **Step 1: Write the failing tests**

```js
["distance", "size", "date"].forEach(function(mode) {
    var m = CsMesh3d.build(m3survey, m3resolved, { colorBy: mode });
    var bad = 0;
    for (var i = 0; i < m.triangles.colors.length; i++) {
        if (!isFinite(m.triangles.colors[i])) { bad += 1; }
    }
    eqs(String(bad), "0", mode + " emits finite colours");
    ok(m.legend.stops.length > 0, mode + " returns a legend with stops");
});

var legSize = CsMesh3d.build(m3survey, m3resolved, { colorBy: "size" }).legend;
ok(legSize.note.indexOf("percentile") >= 0,
    "the size legend admits that it is clamped");

// Trip order within a date. Two trips on one day, the second surveyed
// second, must come out in that order.
var dsurvey = CsModel.newSurvey();
dsurvey.distanceUnit = "ft";
dsurvey.trips = [
    { name: "B", date: "2025-03-08" },
    { name: "A", date: "2025-03-08" },
    { name: "C", date: "2024-01-01" }
];
eqs(CsMesh3d.tripOrder(dsurvey).join(","), "2,0,1",
    "earlier date first, then survey order within the same date");

// One trip must not divide by zero.
var onesurvey = mesh3dSurvey();
var oneMesh = CsMesh3d.build(onesurvey, CsNetwork.resolve(onesurvey),
    { colorBy: "date" });
var oneBad = 0;
for (var ob = 0; ob < oneMesh.triangles.colors.length; ob++) {
    if (!isFinite(oneMesh.triangles.colors[ob])) { oneBad += 1; }
}
eqs(String(oneBad), "0", "a single-trip cave still colours by date");
```

- [ ] **Step 2: Run, expect failure**

Expected: FAIL, `CsMesh3d.tripOrder` is not a function.

- [ ] **Step 3: Implement the three**

```js
/** Trip indices in chronological order.
 *
 *  Sorted by date, and trips SHARING a date by their position in the
 *  survey -- which is the order they were walked. Sorting on date alone
 *  would leave two trips on the same Saturday in an arbitrary order,
 *  and the ramp would then put them in an arbitrary order too.
 *
 *  A trip with no date sorts as if it had none of the others' dates:
 *  they all fall back to survey order together, which is still a real
 *  progression. */
CsMesh3d.tripOrder = function(survey) {
    var trips = survey.trips || [];
    var idx = [];
    for (var i = 0; i < trips.length; i++) { idx.push(i); }
    idx.sort(function(a, b) {
        var da = (trips[a] && typeof trips[a].date === "string") ? trips[a].date : "";
        var db = (trips[b] && typeof trips[b].date === "string") ? trips[b].date : "";
        if (da !== db) {
            if (da === "") { return 1; }
            if (db === "") { return -1; }
            return da < db ? -1 : 1;
        }
        return a - b;
    });
    return idx;
};

/** Traverse distance from `anchorName` to every station, walked along
 *  the legs. NOT straight-line distance: "how far in am I" is a
 *  question about the passage, and a station fifty feet from the
 *  entrance through six hundred feet of crawl is six hundred feet in. */
CsMesh3d.distancesFrom = function(anchorName, resolved) {
    var adj = {};
    var add = function(from, to) {
        if (!adj.hasOwnProperty(from)) { adj[from] = []; }
        adj[from].push(to);
    };
    for (var i = 0; i < resolved.legs.length; i++) {
        add(resolved.legs[i].from, resolved.legs[i].to);
        add(resolved.legs[i].to, resolved.legs[i].from);
    }
    var out = {};
    var start = anchorName;
    if (start === undefined || start === null ||
            resolved.stations[start] === undefined) {
        for (var n in resolved.stations) {
            if (resolved.stations.hasOwnProperty(n)) { start = n; break; }
        }
    }
    if (start === undefined || resolved.stations[start] === undefined) {
        return out;
    }
    out[start] = 0;
    var queue = [start];
    while (queue.length > 0) {
        var here = queue.shift();
        var hs = resolved.stations[here];
        var next = adj[here] || [];
        for (var k = 0; k < next.length; k++) {
            var name = next[k];
            if (out.hasOwnProperty(name)) { continue; }
            var ns = resolved.stations[name];
            if (ns === undefined) { continue; }
            out[name] = out[here] + CsMesh3d.norm(CsMesh3d.sub(ns, hs));
            queue.push(name);
        }
    }
    return out;
};

/** The area a ring encloses, by the vector formula for a 3D polygon:
 *  half the length of the summed cross products of consecutive edge
 *  vectors about the first vertex. */
CsMesh3d.ringArea = function(ring) {
    if (ring.length < 3) { return 0; }
    var sum = { x: 0, y: 0, z: 0 };
    for (var i = 1; i + 1 < ring.length; i++) {
        var c = CsMesh3d.cross(CsMesh3d.sub(ring[i], ring[0]),
                               CsMesh3d.sub(ring[i + 1], ring[0]));
        sum.x += c.x; sum.y += c.y; sum.z += c.z;
    }
    return CsMesh3d.norm(sum) / 2;
};

/** The value at a percentile of a sorted-able list of numbers. */
CsMesh3d.percentile = function(values, p) {
    if (values.length === 0) { return 0; }
    var sorted = values.slice().sort(function(a, b) { return a - b; });
    var i = Math.floor((sorted.length - 1) * p);
    if (i < 0) { i = 0; }
    if (i >= sorted.length) { i = sorted.length - 1; }
    return sorted[i];
};

/** A generic ramp colour, warm at the top of the range and cool at the
 *  bottom, distinct from the depth ramp so two modes never look alike. */
CsMesh3d.rampColor = function(t) {
    if (!isFinite(t)) { t = 0.5; }
    if (t < 0) { t = 0; }
    if (t > 1) { t = 1; }
    return [0.30 + 0.62 * t, 0.72 - 0.34 * t, 0.85 - 0.55 * t];
};
```

Then in `build`, extend the mode selection. The pattern is the same for all three: compute a per-station numeric value, find its low and high, and colour by the normalised position. Add before the `colorAt` definition:

```js
    // Per-station value and range for whichever ramp mode is in force.
    var rampValue = null;   // {name: number} or null
    var rampLow = 0, rampHigh = 1;
    var unitName = survey.distanceUnit === "m" ? "m" : "ft";

    if (colorBy === "distance") {
        rampValue = CsMesh3d.distancesFrom(opts.anchorName, resolved);
    } else if (colorBy === "size") {
        rampValue = {};
        for (name in resolved.stations) {
            if (!resolved.stations.hasOwnProperty(name)) { continue; }
            var sdir = CsMesh3d.directionAt(name, legsByStation, resolved);
            if (sdir === null) { rampValue[name] = 0; continue; }
            rampValue[name] = CsMesh3d.ringArea(CsMesh3d.ringAt(
                resolved.stations[name], sdir, CsMesh3d.lrudAt(name, survey),
                splays[name] || [], tapeMode));
        }
    } else if (colorBy === "date") {
        var order = CsMesh3d.tripOrder(survey);
        var rank = {};
        for (var oi = 0; oi < order.length; oi++) { rank[order[oi]] = oi; }
        rampValue = {};
        for (name in resolved.stations) {
            if (resolved.stations.hasOwnProperty(name)) {
                rampValue[name] = rank[CsMesh3d.tripAt(name, survey)] || 0;
            }
        }
    }

    if (rampValue !== null) {
        var vals = [];
        for (name in rampValue) {
            if (rampValue.hasOwnProperty(name) && isFinite(rampValue[name])) {
                vals.push(rampValue[name]);
            }
        }
        if (vals.length === 0) {
            rampLow = 0; rampHigh = 1;
        } else if (colorBy === "size") {
            // CLAMPED. One big room otherwise puts every crawl at the
            // bottom of a linear ramp, and the legend says so.
            rampLow = CsMesh3d.percentile(vals, 0.05);
            rampHigh = CsMesh3d.percentile(vals, 0.95);
        } else {
            rampLow = Math.min.apply(null, vals);
            rampHigh = Math.max.apply(null, vals);
        }
        if (!(rampHigh - rampLow > 1e-9)) {
            // One trip, one station, or a cave of uniform size. Every
            // value sits mid-ramp rather than dividing by zero.
            rampHigh = rampLow + 1;
        }
    }
```

`colorAt` gains, before its trip fallback:

```js
        if (rampValue !== null) {
            var v = rampValue[stationName];
            if (!isFinite(v)) { v = rampLow; }
            var t = (v - rampLow) / (rampHigh - rampLow);
            if (t < 0) { t = 0; }
            if (t > 1) { t = 1; }
            return CsMesh3d.rampColor(t);
        }
```

And the legend for each, replacing the `else` branch's condition chain:

```js
    } else if (colorBy === "distance") {
        legend.title = "Distance in";
        legend.kind = "ramp";
        legend.stops = [
            { color: CsMesh3d.rampColor(0),
              label: CsMesh3d.legendLength(rampLow, unitName) },
            { color: CsMesh3d.rampColor(0.5),
              label: CsMesh3d.legendLength((rampLow + rampHigh) / 2, unitName) },
            { color: CsMesh3d.rampColor(1),
              label: CsMesh3d.legendLength(rampHigh, unitName) }
        ];
    } else if (colorBy === "size") {
        legend.title = "Passage size";
        legend.kind = "ramp";
        legend.note = "5th-95th percentile";
        legend.stops = [
            { color: CsMesh3d.rampColor(0),
              label: Math.round(rampLow) + " sq " + unitName },
            { color: CsMesh3d.rampColor(0.5),
              label: Math.round((rampLow + rampHigh) / 2) + " sq " + unitName },
            { color: CsMesh3d.rampColor(1),
              label: Math.round(rampHigh) + " sq " + unitName }
        ];
    } else if (colorBy === "date") {
        legend.title = "Survey date";
        legend.kind = "ramp";
        var dOrder = CsMesh3d.tripOrder(survey);
        var firstTrip = dOrder.length > 0 ? dOrder[0] : 0;
        var lastTrip = dOrder.length > 0 ? dOrder[dOrder.length - 1] : 0;
        legend.stops = [
            { color: CsMesh3d.rampColor(0),
              label: CsMesh3d.tripLabel(survey, firstTrip) },
            { color: CsMesh3d.rampColor(1),
              label: CsMesh3d.tripLabel(survey, lastTrip) }
        ];
    } else {
```

`build` must accept `opts.anchorName` — add it to the docblock as "the station distance is measured from; the drawing's anchor, or the first station when absent".

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add scripts/CaveSurvey/Core/CsMesh3d.js tests/js_unit.js
git commit -m "feat: colour the passage by how far in, how big, and how long ago"
```

---

### Task 4: Closure shift and splay coverage

**Goal:** Two banded modes that say which parts of the survey to trust less.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsMesh3d.js`
- Test: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `colorBy: "closure"` colours each station by `CsClosure.bandFor(shift)` using `resolved.shifts`
- [ ] With no `shifts` (adjustment off), every station falls in the first band and `legend.note` says adjustment is off
- [ ] `colorBy: "splay"` gives three states: has splays, LRUD only, nothing measured
- [ ] Both return `kind: "swatches"` with one stop per band, labelled with the band's own words
- [ ] No NaN in either

**Verify:** engine suite → `### UNIT OK`

**Steps:**

- [ ] **Step 1: Write the failing tests**

```js
var legClosure = CsMesh3d.build(m3survey, m3resolved, { colorBy: "closure" }).legend;
eqs(legClosure.kind, "swatches", "closure bands legend as swatches");
eqs(String(legClosure.stops.length), String(CsClosure.BANDS.length),
    "one swatch per closure band");
ok(legClosure.stops[0].label.indexOf("tape read") >= 0,
    "a closure swatch is labelled with the band's own words");
ok(legClosure.note.indexOf("adjustment") >= 0,
    "with no adjustment the legend says so rather than implying all is well");

var legSplay = CsMesh3d.build(m3survey, m3resolved, { colorBy: "splay" }).legend;
eqs(legSplay.kind, "swatches", "splay coverage legends as swatches");
eqs(String(legSplay.stops.length), "3", "splays, LRUD only, nothing");
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement**

Add near `TRIP_COLORS`:

```js
// The closure bands rendered. CsClosure names colours in words because
// it draws into a CAD drawing where colour is a layer property; here
// they have to be actual light, so the words are mapped once.
CsMesh3d.BAND_COLORS = {
    green:  [0.45, 0.80, 0.45],
    yellow: [0.90, 0.85, 0.35],
    orange: [0.92, 0.60, 0.25],
    red:    [0.90, 0.32, 0.30]
};

// Splay coverage, worst to best, so the legend reads as a scale.
CsMesh3d.COVERAGE = [
    { key: "none",  color: [0.45, 0.45, 0.48], says: "nothing measured" },
    { key: "lrud",  color: [0.70, 0.68, 0.60], says: "LRUD only" },
    { key: "splay", color: [0.55, 0.82, 0.90], says: "splays measured" }
];
```

In `build`, alongside the ramp setup:

```js
    // Banded modes: a per-station key into a fixed list of swatches.
    var bandOf = null;

    if (colorBy === "closure") {
        var shifts = resolved.shifts || {};
        bandOf = function(stationName) {
            var s = shifts[stationName];
            var d = (s === undefined || s === null) ? 0 : s.distance;
            var band = CsClosure.bandFor(d);
            return CsMesh3d.BAND_COLORS[band.colour] ||
                   CsMesh3d.BAND_COLORS.green;
        };
    } else if (colorBy === "splay") {
        bandOf = function(stationName) {
            var list = splays[stationName] || [];
            if (list.length > 0) { return CsMesh3d.COVERAGE[2].color; }
            var lr = CsMesh3d.lrudAt(stationName, survey);
            if (lr.left !== null || lr.right !== null ||
                    lr.up !== null || lr.down !== null) {
                return CsMesh3d.COVERAGE[1].color;
            }
            return CsMesh3d.COVERAGE[0].color;
        };
    }
```

`colorAt` gains, before the ramp branch:

```js
        if (bandOf !== null) {
            return bandOf(stationName);
        }
```

And the legend branches:

```js
    } else if (colorBy === "closure") {
        legend.title = "Closure shift";
        legend.kind = "swatches";
        // An unadjusted survey has no shifts at all, and every station
        // would land in the "within a good tape read" band -- which
        // looks like a clean survey and is actually no information.
        legend.note = (resolved.shifts === undefined ||
                       resolved.shifts === null)
            ? "adjustment is off -- nothing has moved"
            : "";
        for (var bi = 0; bi < CsClosure.BANDS.length; bi++) {
            var band = CsClosure.BANDS[bi];
            legend.stops.push({
                color: CsMesh3d.BAND_COLORS[band.colour],
                label: band.says
            });
        }
    } else if (colorBy === "splay") {
        legend.title = "Splay coverage";
        legend.kind = "swatches";
        for (var ci = 0; ci < CsMesh3d.COVERAGE.length; ci++) {
            legend.stops.push({ color: CsMesh3d.COVERAGE[ci].color,
                                label: CsMesh3d.COVERAGE[ci].says });
        }
    } else {
```

Add `include(includeBasePath + "/CsClosure.js");` to the top of `CsMesh3d.js`, and add `CsClosure.js` to `CORE_FILES` in `tests/js_unit.js` if it is not already there (check first — it may be loaded already).

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add scripts/CaveSurvey/Core/CsMesh3d.js tests/js_unit.js
git commit -m "feat: colour by what the survey does not know"
```

---

### Task 5: The raw ghost and the lead markers

**Goal:** Two more buffers — the pre-adjustment network, and markers at the cave's open ends.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsMesh3d.js`
- Test: `tests/js_unit.js`, `tests/cave3d_mesh_run.js`

**Acceptance Criteria:**
- [ ] `build` returns `ghost: {positions, colors, indices}`
- [ ] The ghost is empty when `resolved.raw` is null or absent
- [ ] The ghost draws the same legs from `resolved.raw.stations` when present
- [ ] `build` returns `leads: {positions, colors, indices}`, a three-axis cross at each `CsFrontier.openEnds` station
- [ ] Lead crosses are sized from the cave's own extent, not a fixed number, so they are visible on any size of cave
- [ ] No NaN in either buffer

**Verify:** engine suite → `### UNIT OK`, and `node tests/cave3d_mesh_run.js`

**Steps:**

- [ ] **Step 1: Write the failing tests**

```js
// No raw means no ghost -- adjustment off, or a solve that did not
// converge, and the drawn geometry then already IS the as-surveyed one.
var noRaw = CsMesh3d.build(m3survey, m3resolved);
eqs(String(noRaw.ghost.indices.length), "0",
    "a survey with no raw network draws no ghost");

var fakeRaw = CsNetwork.resolve(mesh3dSurvey());
var withRawResolved = CsNetwork.resolve(mesh3dSurvey());
withRawResolved.raw = fakeRaw;
var withRaw = CsMesh3d.build(m3survey, withRawResolved);
ok(withRaw.ghost.indices.length > 0, "a raw network draws a ghost");
var ghostBad = 0;
for (var gb = 0; gb < withRaw.ghost.positions.length; gb++) {
    if (!isFinite(withRaw.ghost.positions[gb])) { ghostBad += 1; }
}
eqs(String(ghostBad), "0", "no NaN in the ghost");

// Leads: the three-station straight passage ends at C, which is a lead.
ok(noRaw.leads.indices.length > 0, "an unfinished passage marks its lead");
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement**

Add `include(includeBasePath + "/CsFrontier.js");` at the top of `CsMesh3d.js`.

In `build`, after the main leg loop:

```js
    // --- the as-surveyed ghost ---
    //
    // NO RAW MEANS NO GHOST, and that is not a degenerate case: it is
    // adjustment switched off, or a solve that did not converge, and in
    // both the drawn geometry already IS the as-surveyed geometry. A
    // ghost lying exactly on top of it would be noise. Same rule, same
    // words, as CsDraw's CTRL-RAW ghost.
    var ghost = { positions: [], colors: [], indices: [] };
    var raw = resolved.raw;
    if (raw !== undefined && raw !== null && raw.stations !== undefined) {
        for (li = 0; li < resolved.legs.length; li++) {
            var gl = resolved.legs[li];
            var ga = raw.stations[gl.from];
            var gb2 = raw.stations[gl.to];
            if (ga === undefined || gb2 === undefined) { continue; }
            if (typeof ga.z !== "number" || typeof gb2.z !== "number") {
                continue;
            }
            var gbase = ghost.positions.length / 3;
            ghost.positions.push(ga.x, ga.y, ga.z, gb2.x, gb2.y, gb2.z);
            ghost.colors.push(0.45, 0.45, 0.45, 0.45, 0.45, 0.45);
            ghost.indices.push(gbase, gbase + 1);
        }
    }

    // --- lead markers ---
    //
    // A three-axis cross rather than a dot: a dot at this scale is one
    // pixel and disappears into the passage behind it, and a cross reads
    // as a mark ON the cave rather than a speck of it.
    var leads = { positions: [], colors: [], indices: [] };
    var ends = CsFrontier.openEnds(survey);
    // Sized from the cave, because a fixed length is invisible on a
    // mile of passage and enormous in one room.
    var extent = Math.max(max.x - min.x, max.y - min.y, max.z - min.z);
    if (!isFinite(extent) || extent <= 0) { extent = 1; }
    var arm = extent * 0.01;
    for (var ei = 0; ei < ends.length; ei++) {
        var est = resolved.stations[ends[ei].station];
        if (est === undefined || typeof est.z !== "number") { continue; }
        var axes = [[arm, 0, 0], [0, arm, 0], [0, 0, arm]];
        for (var ai = 0; ai < axes.length; ai++) {
            var d3 = axes[ai];
            var lbase2 = leads.positions.length / 3;
            leads.positions.push(est.x - d3[0], est.y - d3[1], est.z - d3[2],
                                 est.x + d3[0], est.y + d3[1], est.z + d3[2]);
            leads.colors.push(1.0, 0.85, 0.25, 1.0, 0.85, 0.25);
            leads.indices.push(lbase2, lbase2 + 1);
        }
    }
```

This block must come AFTER the `grow` calls have run (so `min`/`max` are real) and BEFORE the `if (!isFinite(min.x))` fallback. Add `ghost: ghost, leads: leads` to the return, and empty versions to the empty-survey early return.

Add `CsFrontier.js` to `CORE_FILES` in `tests/js_unit.js` and to the `loadCore` list in `tests/cave3d_mesh_run.js` if absent.

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add scripts/CaveSurvey/Core/ tests/
git commit -m "feat: the as-surveyed ghost, and a mark on every lead"
```

---

### Task 6: The view draws the new buffers, clamps progress, and paints the legend

**Goal:** `RCave3dView` renders ghost and leads, reveals only up to a step, and paints a legend over the GL.

**Files:**
- Modify: `src/gui/RCave3dView.h`, `src/gui/RCave3dView.cpp`

**Acceptance Criteria:**
- [ ] `setGhost` and `setLeads` upload their buffers; both have their own visibility flag
- [ ] `setProgress(triangleVertices, lineVertices)` clamps what is drawn; a negative or absent progress draws everything
- [ ] `setLegend` takes a title, note, kind and a list of (colour, label) stops
- [ ] The legend paints bottom-left in `QPainter` after the GL pass: a gradient bar with labels for `"ramp"`, a stack of swatch rows for `"swatches"`
- [ ] The legend is not painted when it has no stops
- [ ] `ninja -j20` is clean in BOTH trees

**Verify:** `ninja -j20` in `cavecad-src` and in `qcadjsapi`, both clean

**Steps:**

- [ ] **Step 1: Extend the header**

Add to `RCave3dView`:

```cpp
    struct LegendStop {
        QColor color;
        QString label;
    };

    void setGhost(const QVector<float>& positions,
                  const QVector<float>& colors);
    void setLeads(const QVector<float>& positions,
                  const QVector<float>& colors);
    void setLegend(const QString& title, const QString& note,
                   const QString& kind, const QVector<LegendStop>& stops);
    void setProgress(int triangleVertices, int lineVertices);
    void setShowGhost(bool on);
    void setShowLeads(bool on);
```

with members `ghostPositions`, `ghostColors`, `leadPositions`, `leadColors`, `showGhost`, `showLeads`, `legendTitle`, `legendNote`, `legendKind`, `legendStops`, `progressTriangles`, `progressLines`. Initialise `showGhost(false)`, `showLeads(false)`, `progressTriangles(-1)`, `progressLines(-1)`.

- [ ] **Step 2: Draw the new buffers**

In `paintGL`, the triangle draw becomes:

```cpp
        int triVerts = trianglePositions.size() / 3;
        if (progressTriangles >= 0 && progressTriangles < triVerts) {
            triVerts = progressTriangles;
        }
        glDrawArrays(GL_TRIANGLES, 0, triVerts);
```

and the line draw the same with `progressLines`. Then ghost and leads each draw through `lineProgram`, exactly as the centerline does, guarded by their visibility flags. The ghost is NOT clamped by progress: it is the survey as recorded, not the survey being built, and clipping it would imply the raw network grows too.

- [ ] **Step 3: Paint the legend**

At the end of `paintGL`:

```cpp
    if (legendStops.isEmpty()) {
        return;
    }

    // QOpenGLWidget is a QPaintDevice, so the legend is ordinary Qt text
    // and needs no GL text machinery at all. Qt saves and restores the
    // GL state around the painter.
    QPainter painter(this);
    painter.setRenderHint(QPainter::Antialiasing, true);

    const int pad = 10;
    const int swatch = 12;
    const int lineH = 16;
    int y = height() - pad;

    QFont f = painter.font();
    f.setPointSizeF(f.pointSizeF() - 1.0);
    painter.setFont(f);
    painter.setPen(QColor(230, 230, 230));

    if (!legendNote.isEmpty()) {
        painter.drawText(pad, y, legendNote);
        y -= lineH;
    }

    if (legendKind == "ramp") {
        // Bottom label, bar, top label -- read upward, the way a depth
        // scale is read.
        QLinearGradient g(0, 0, 0, 1);
        g.setCoordinateMode(QGradient::ObjectBoundingMode);
        for (int i = 0; i < legendStops.size(); i++) {
            qreal at = legendStops.size() == 1
                ? 0.0
                : 1.0 - qreal(i) / qreal(legendStops.size() - 1);
            g.setColorAt(at, legendStops.at(i).color);
        }
        int barH = lineH * legendStops.size();
        QRect bar(pad, y - barH, swatch, barH);
        painter.fillRect(bar, QBrush(g));
        painter.setPen(QColor(90, 90, 90));
        painter.drawRect(bar);
        painter.setPen(QColor(230, 230, 230));
        for (int i = 0; i < legendStops.size(); i++) {
            int ly = bar.bottom() - (barH * i) / qMax(1, legendStops.size() - 1);
            painter.drawText(pad + swatch + 6, ly + 4, legendStops.at(i).label);
        }
        y -= barH + 4;
    } else {
        for (int i = legendStops.size() - 1; i >= 0; i--) {
            painter.fillRect(QRect(pad, y - swatch, swatch, swatch),
                             legendStops.at(i).color);
            painter.setPen(QColor(90, 90, 90));
            painter.drawRect(QRect(pad, y - swatch, swatch, swatch));
            painter.setPen(QColor(230, 230, 230));
            painter.drawText(pad + swatch + 6, y - 1, legendStops.at(i).label);
            y -= lineH;
        }
    }

    QFont bold = painter.font();
    bold.setBold(true);
    painter.setFont(bold);
    painter.drawText(pad, y - 2, legendTitle);
```

Add `#include <QPainter>` and `#include <QLinearGradient>`.

- [ ] **Step 4: Build BOTH trees**

```bash
cd ~/Documents/github/cavecad-src && ninja -j20
cd ~/Documents/github/qcadjsapi && ninja -j20
```
Expected: both clean. The header changed, so the second is not optional.

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/github/cavecad-src
git add src/gui/RCave3dView.h src/gui/RCave3dView.cpp
git commit -m "feat: ghost, leads, a revealed prefix, and a legend over the GL"
```

---

### Task 7: The panel's controls, and the bridge that carries them

**Goal:** A two-row toolbar with a mode dropdown, four overlay toggles, play/pause and a scrub slider, all reachable from script.

**Files:**
- Modify: `src/gui/RCave3dPanel.h`, `src/gui/RCave3dPanel.cpp`
- Modify: `src/gui/RCave3dBridge.h`, `src/gui/RCave3dBridge.cpp`

**Acceptance Criteria:**
- [ ] Row 1: Refresh | All Plan Profile | colour-mode `QComboBox`
- [ ] Row 2: Passage Centerline Ghost Leads | Play, `QSlider`
- [ ] Changing the combo emits `modeChanged(QString)` carrying the mode key
- [ ] The bridge relays it as a `colorModeChanged(int handle, QString mode)` signal
- [ ] `cave3d.setMesh` accepts `ghost`, `leads`, `legend` and `steps` and passes them on
- [ ] `cave3d.setColorModes(handle, keys, labels, current)` fills the combo without firing the signal
- [ ] Play steps one leg per 40 ms; the slider tracks it and can be dragged; reaching the end shows the whole cave
- [ ] The Ghost toggle is disabled when the mesh carried an empty ghost
- [ ] `ninja -j20` clean in BOTH trees

**Verify:** build both trees, then in a restarted CaveCAD the panel shows two rows and the combo lists seven modes

**Steps:**

- [ ] **Step 1: Panel — two toolbars and the new controls**

In `RCave3dPanel.cpp`, replace the single `QToolBar` with two, stacked in the existing `QVBoxLayout` above the view. Row one keeps Refresh, All, Plan, Profile and gains:

```cpp
    modeCombo = new QComboBox(this);
    modeCombo->setObjectName("Cave3dModeCombo");
    modeCombo->setToolTip(tr("What the colours mean"));
    connect(modeCombo, SIGNAL(currentIndexChanged(int)),
            this, SLOT(onModeChanged(int)));
    row1->addWidget(modeCombo);
```

Row two holds the four toggles (Passage and Centerline move here from row one) plus:

```cpp
    playAction = row2->addAction(tr("Play"));
    playAction->setCheckable(true);
    connect(playAction, SIGNAL(toggled(bool)), this, SLOT(onPlayToggled(bool)));

    progressSlider = new QSlider(Qt::Horizontal, this);
    progressSlider->setObjectName("Cave3dProgressSlider");
    progressSlider->setRange(0, 0);
    connect(progressSlider, SIGNAL(valueChanged(int)),
            this, SLOT(onProgressChanged(int)));
    row2->addWidget(progressSlider);
```

`onModeChanged` guards against the fill: a `bool fillingCombo` member set while `setColorModes` populates it, so programmatic filling does not look like a user choice and does not trigger a rebuild.

- [ ] **Step 2: Panel — the animation**

```cpp
void RCave3dPanel::setSteps(const QVector<QPair<int, int> >& s) {
    steps = s;
    progressSlider->blockSignals(true);
    progressSlider->setRange(0, qMax(0, steps.size() - 1));
    progressSlider->setValue(qMax(0, steps.size() - 1));
    progressSlider->blockSignals(false);
    // A new mesh shows the whole cave. The animation is a thing you do,
    // not a state the panel sits in.
    if (view != NULL) {
        view->setProgress(-1, -1);
    }
    playAction->setChecked(false);
}

void RCave3dPanel::onPlayToggled(bool on) {
    if (!on) {
        playTimer->stop();
        return;
    }
    if (steps.isEmpty()) {
        playAction->setChecked(false);
        return;
    }
    // Starting from the end would show one frame and stop.
    if (progressSlider->value() >= progressSlider->maximum()) {
        progressSlider->setValue(0);
    }
    playTimer->start(40);
}

void RCave3dPanel::onPlayTick() {
    int next = progressSlider->value() + 1;
    if (next >= steps.size()) {
        playTimer->stop();
        playAction->setChecked(false);
        // Ending on the whole cave, never on a partial one.
        if (view != NULL) {
            view->setProgress(-1, -1);
        }
        return;
    }
    progressSlider->setValue(next);
}

void RCave3dPanel::onProgressChanged(int value) {
    if (view == NULL || steps.isEmpty()) {
        return;
    }
    if (value >= steps.size() - 1) {
        view->setProgress(-1, -1);       // the whole cave
        return;
    }
    view->setProgress(steps.at(value).first, steps.at(value).second);
}
```

`playTimer` is a `QTimer*` created in the constructor with `connect(playTimer, SIGNAL(timeout()), this, SLOT(onPlayTick()))`.

- [ ] **Step 3: Bridge — carry the new fields**

`setMesh` gains, after the existing lines and reusing the same `toFloats`:

```cpp
    QVariantMap ghost = mesh.value("ghost").toMap();
    view->setGhost(toFloats(ghost.value("positions")),
                   toFloats(ghost.value("colors")));
    p->setGhostAvailable(!ghost.value("positions").toList().isEmpty());

    QVariantMap leads = mesh.value("leads").toMap();
    view->setLeads(toFloats(leads.value("positions")),
                   toFloats(leads.value("colors")));

    QVariantMap legend = mesh.value("legend").toMap();
    QVector<RCave3dView::LegendStop> stops;
    QVariantList stopList = legend.value("stops").toList();
    for (int i = 0; i < stopList.size(); i++) {
        QVariantMap s = stopList.at(i).toMap();
        QVariantList c = s.value("color").toList();
        RCave3dView::LegendStop stop;
        stop.color = QColor::fromRgbF(
            c.value(0).toDouble(), c.value(1).toDouble(),
            c.value(2).toDouble());
        stop.label = s.value("label").toString();
        stops.append(stop);
    }
    view->setLegend(legend.value("title").toString(),
                    legend.value("note").toString(),
                    legend.value("kind").toString(), stops);

    QVector<QPair<int, int> > steps;
    QVariantList stepList = mesh.value("steps").toList();
    for (int i = 0; i < stepList.size(); i++) {
        QVariantMap s = stepList.at(i).toMap();
        steps.append(QPair<int, int>(s.value("triangleVertices").toInt(),
                                     s.value("lineVertices").toInt()));
    }
    p->setSteps(steps);
```

Add invokables `setColorModes(int handle, const QStringList& keys, const QStringList& labels, const QString& current)`, `setShowGhost(int, bool)`, `setShowLeads(int, bool)`, and the signal `colorModeChanged(int handle, const QString& mode)` wired from the panel's `modeChanged`.

- [ ] **Step 4: Build BOTH trees**

```bash
cd ~/Documents/github/cavecad-src && ninja -j20
cd ~/Documents/github/qcadjsapi && ninja -j20
```

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/github/cavecad-src
git add src/gui/
git commit -m "feat: a mode to pick, four overlays to toggle, and a cave that builds itself"
```

---

### Task 8: Wire it from script, and remember the choice

**Goal:** `Cave3D.js` fills the mode list, rebuilds on a mode change, toggles overlays, and persists both.

**Files:**
- Modify: `scripts/CaveSurvey/Cave3D/Cave3D.js`

**Acceptance Criteria:**
- [ ] The combo lists all seven modes with readable labels
- [ ] Choosing a mode rebuilds the mesh with that `colorBy` and nothing else changes
- [ ] Mode and the four overlay states are written to `RSettings` under `Cave3D/` and restored on open
- [ ] `Cave3D.read` passes the drawing's anchor name through as `opts.anchorName`
- [ ] The status line names the active mode and, when the ghost is unavailable, says which reason applies
- [ ] `python3 -m unittest tests.test_addon` passes

**Verify:** `python3 -m unittest tests.test_addon` → OK, then live in CaveCAD

**Steps:**

- [ ] **Step 1: The mode table**

```js
/** The colour modes, in the order they appear in the panel. Keys match
 *  CsMesh3d's colorBy exactly -- one list, so a mode cannot be offered
 *  that the mesh does not implement. */
Cave3D.MODES = [
    { key: "trip",     label: qsTr("Trip") },
    { key: "depth",    label: qsTr("Depth") },
    { key: "distance", label: qsTr("Distance in") },
    { key: "size",     label: qsTr("Passage size") },
    { key: "date",     label: qsTr("Survey date") },
    { key: "closure",  label: qsTr("Closure shift") },
    { key: "splay",    label: qsTr("Splay coverage") }
];

Cave3D.SETTING_MODE = "Cave3D/ColorMode";
Cave3D.SETTING_PREFIX = "Cave3D/Show";

Cave3D.mode = null;

Cave3D.currentMode = function() {
    if (Cave3D.mode === null) {
        var saved = RSettings.getStringValue(Cave3D.SETTING_MODE, "trip");
        Cave3D.mode = Cave3D.isKnownMode(saved) ? saved : "trip";
    }
    return Cave3D.mode;
};

Cave3D.isKnownMode = function(key) {
    for (var i = 0; i < Cave3D.MODES.length; i++) {
        if (Cave3D.MODES[i].key === key) { return true; }
    }
    return false;
};
```

- [ ] **Step 2: Pass the mode and the anchor into build**

`Cave3D.read` returns `anchorName` alongside `survey`/`resolved`/`anchored`, taken from `recon.anchorName`. `Cave3D.refresh` becomes:

```js
    mesh = CsMesh3d.build(read.survey, read.resolved, {
        colorBy: Cave3D.currentMode(),
        anchorName: read.anchorName
    });
```

- [ ] **Step 3: Fill the combo and connect the change**

In `cave3dRun`, after the panel is open and before the first refresh:

```js
    var keys = [], labels = [];
    for (var mi = 0; mi < Cave3D.MODES.length; mi++) {
        keys.push(Cave3D.MODES[mi].key);
        labels.push(Cave3D.MODES[mi].label);
    }
    cave3d.setColorModes(Cave3D.handle, keys, labels, Cave3D.currentMode());

    if (!Cave3D.connected) {
        cave3d.refreshRequested.connect(function(handle) {
            if (handle === Cave3D.handle) { Cave3D.refresh(); }
        });
        cave3d.colorModeChanged.connect(function(handle, mode) {
            if (handle !== Cave3D.handle) { return; }
            if (!Cave3D.isKnownMode(mode)) { return; }
            Cave3D.mode = mode;
            RSettings.setValue(Cave3D.SETTING_MODE, mode);
            Cave3D.refresh();
        });
        Cave3D.connected = true;
    }
```

- [ ] **Step 4: Status text names the mode and explains a missing ghost**

```js
Cave3D.statusText = function(read, mesh) {
    var triangles = mesh.triangles.indices.length / 3;
    var unit = read.survey.distanceUnit === "m" ? "m" : "ft";
    var depth = mesh.bounds.max.z - mesh.bounds.min.z;
    var text = qsTr("%1  --  %2 triangles, %3 %4 of relief")
        .arg(mesh.legend.title).arg(triangles)
        .arg(depth.toFixed(1)).arg(unit);
    if (mesh.ghost.indices.length === 0) {
        // Saying WHICH reason matters: one is a setting the caver can
        // change, the other is a solve that failed and wants looking at.
        text += read.adjusted === true
            ? qsTr("  --  no ghost: the adjustment did not converge")
            : qsTr("  --  no ghost: adjustment is off");
    }
    if (read.anchored !== true) {
        text += qsTr("  --  no anchor station");
    }
    return text;
};
```

`Cave3D.read` must also return `adjusted: resolved.adjusted === true` for this to be able to tell the two apart.

- [ ] **Step 5: Test and commit**

```bash
python3 -m unittest tests.test_addon
tools/publish.sh
git add scripts/CaveSurvey/Cave3D/Cave3D.js
git commit -m "feat: pick how the cave is coloured, and keep the choice"
```

---

### Task 9: Verify live, and release

**Goal:** Every mode, overlay and the animation work on Pitfall Cave in a genuinely restarted CaveCAD.

**Files:**
- Modify: `VERSION` (cavecad-tools) → `0.9.120.0`
- Modify: `cavecad-src/VERSION` → `0.4.0.0`
- Modify: `README.md`, `docs/superpowers/specs/2026-09-12-cave-3d-visualization-design.md` (As-built)

**Acceptance Criteria:**
- [ ] `bash tests/run_all.sh` → `ALL TESTS PASSED`
- [ ] Each of the seven modes renders with a legible legend
- [ ] The ghost appears with adjustment on and the toggle explains itself when off
- [ ] Lead markers land on the stations `CsFrontier.openEnds` reports
- [ ] Play builds the cave and leaves it whole; the slider scrubs both ways
- [ ] The chosen mode survives a restart
- [ ] The README row for 3D View covers the modes

**Verify:** `bash tests/run_all.sh`, then the live walkthrough above

**Steps:**

- [ ] **Step 1: Run everything**

```bash
cd ~/Documents/github/cavecad-tools && bash tests/run_all.sh
```
Expected: `ALL TESTS PASSED`.

- [ ] **Step 2: Restart genuinely and walk the list**

Quit CaveCAD completely — a quit blocked by unsaved changes leaves the old add-on running, and the walkthrough would then be against stale code. Open Pitfall Cave, open the 3D panel, and step through every mode, both overlays and the animation.

- [ ] **Step 3: Record and release**

Append an As-built section to the spec covering what diverged, bump both VERSION files, update the README row, and commit:

```bash
git add -A
git commit -m "release: 0.9.120.0 -- seven ways to look at the same cave"
```
