# Cave 3D View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A native OpenGL window inside CaveCAD that draws the surveyed passage in 3D -- centerline plus a shell lofted from LRUD ticks and splay tips -- with pan, zoom and rotate, rebuilding as the drawing changes.

**Architecture:** The C++ widget is a renderer that has never heard of caves: it takes vertex/index/colour buffers and a camera. Every cave fact stays in the JS Core library, in a new pure module `CsMesh3d.js` that turns a `Survey` plus resolved stations into plain arrays. The two are joined by one QObject exposed through `engine->newQObject`, which needs no binding regeneration.

**Tech Stack:** C++17 / Qt 6.11 (`QOpenGLWidget`, already linked), CaveCAD's ECMAScript engine, the existing `CsRebuild` / `CsNetwork` / `CsLrud` Core library, node-based headless test harness (`tests/js_unit.js`).

**User decisions (already made):**
- Native GL window inside CaveCAD, not a browser page and not an export to an existing viewer.
- Wall geometry is approach A: per-station radial cross-section from LRUD ticks + splay tips, lofted between stations.
- Live rebuild on drawing change (implemented as Refresh-is-the-guarantee + listener-arrives-earlier, per `CsBind.js` doctrine).
- A `lidar/` folder joins the standard cave folder structure now, even though project 1 writes nothing into it.
- glTF reading is a hard requirement -- for project 2, not this plan.
- First working test is the viewer alone, on the Pitfall Cave fixture.

Spec: `docs/superpowers/specs/2026-09-12-cave-3d-viewer-design.md`

---

## File Structure

**cavecad-tools (JS):**

| File | Responsibility |
|---|---|
| `scripts/CaveSurvey/Core/CsCave.js` | modify: add `LIDAR` to the standard subfolders |
| `scripts/CaveSurvey/PackageCave/PackageCave.js` | modify: `lidar/` folder group, opt-in like scans/images |
| `scripts/CaveSurvey/Core/CsMesh3d.js` | create: pure geometry. Survey + stations -> triangles, lines, bounds |
| `scripts/CaveSurvey/Core/CsAll.js` | modify: include CsMesh3d |
| `scripts/CaveSurvey/Cave3D/Cave3D.js` | create: the add-on tool, menu entry, Refresh |
| `scripts/CaveSurvey/Cave3D/Cave3DListener.js` | create: transaction listener, debounced rebuild |
| `tests/js_unit.js` | modify: load CsMesh3d, add its unit tests |
| `tests/cave3d_mesh_run.js` | create: mesh built from the Pitfall Cave fixture |

**cavecad-src (C++):**

| File | Responsibility |
|---|---|
| `src/gui/RCave3dView.h/.cpp` | `QOpenGLWidget`: buffers, shaders, orbit camera |
| `src/gui/RCave3dWindow.h/.cpp` | `QMainWindow` host, one per drawing, toolbar |
| `src/gui/RCave3dBridge.h/.cpp` | the `QObject` JS talks to |
| `src/gui/CMakeLists.txt` | modify: the three new sources |
| `qcadjsapi/RScriptHandlerJs.cpp` | modify: expose the bridge as a global |

---

### Task 1: The lidar folder joins the standard structure

**Goal:** A cave folder created or repaired by the suite has a `lidar/` folder, and a sanitized package leaves it out.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsCave.js:40-50`
- Modify: `scripts/CaveSurvey/PackageCave/PackageCave.js:214-223, 739-751`
- Test: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `CsCave.LIDAR === "lidar"` and it appears in `CsCave.SUBFOLDERS`
- [ ] `CsCave.lidarFolderOf(folder)` returns the folder as it exists, or null, matching case-insensitively the way `findSubfolder` already does
- [ ] `PackageCave` offers a `lidar` group; a sanitized package excludes it unless it is asked for by name
- [ ] The header comment's folder diagram lists `lidar/`

**Verify:** `node tests/js_unit.js` -> all pass

**Steps:**

- [ ] **Step 1: Write the failing tests**

In `tests/js_unit.js`, beside the existing CsCave tests:

```js
assertEqual(CsCave.LIDAR, "lidar", "CsCave.LIDAR");
assert(CsCave.SUBFOLDERS.indexOf(CsCave.LIDAR) >= 0,
    "lidar is one of the standard subfolders");
```

- [ ] **Step 2: Run, expect failure**

Run: `node tests/js_unit.js`
Expected: FAIL, `CsCave.LIDAR` is undefined.

- [ ] **Step 3: Add the constant and the accessor**

In `CsCave.js`, after `CsCave.BACKUP`:

```js
// LiDAR captures -- Polycam and the like. Called "captures", never
// "scans": a scan in this suite is a scanned notebook page, and the
// two would be indistinguishable in every sentence after this one.
//
// A CAPTURE IS LOCATION DATA. It is a metric record of a specific
// place, and the file may carry GPS and capture metadata besides, so
// it is treated exactly like scans/ and images/ when a project is
// packaged -- left out of a sanitized package unless somebody asks
// for it by name. See PackageCave.js.
CsCave.LIDAR = "lidar";

CsCave.SUBFOLDERS = [CsCave.SCANS, CsCave.PDF, CsCave.IMAGES,
                     CsCave.BACKUP, CsCave.LIDAR];

/** The lidar folder for a cave folder, as it exists, or null. */
CsCave.lidarFolderOf = function(folder) {
    return CsCave.findSubfolder(folder, CsCave.LIDAR);
};
```

Update the folder diagram in the file header to list `lidar/    LiDAR captures`.

- [ ] **Step 4: Run, expect pass**

Run: `node tests/js_unit.js`
Expected: PASS.

- [ ] **Step 5: Add the package group**

In `PackageCave.js`, after the image group near line 222:

```js
    var lidarFolder = CsCave.lidarFolderOf(record.folder);
    folderGroup("lidar", CsCave.LIDAR + "/",
        CsCave.captureFiles(record.folder), "capture",
        qsTr("LiDAR captures"), false);
```

and in the copy pass near line 749, mirroring the scans block:

```js
        var captureCount = PackageCave.copyInto(captures,
            staging + "/" + CsCave.LIDAR);
        if (captureCount > 0) {
            contents.push({ path: CsCave.LIDAR + "/ (" + captureCount + ")",
                note: qsTr("LiDAR captures") });
        }
```

Add `CsCave.captureFiles` beside `CsCave.imageFiles`, listing `*.glb`, `*.gltf`, `*.obj`, `*.ply`, `*.las`, `*.laz`, `*.e57`.

- [ ] **Step 6: Run the package test**

Run: `node tests/package_cave.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/CaveSurvey/Core/CsCave.js scripts/CaveSurvey/PackageCave/PackageCave.js tests/js_unit.js
git commit -m "feat: a cave folder keeps its lidar captures beside its scans"
```

---

### Task 2: CsMesh3d -- the per-station frame and ring

**Goal:** Given a station, its passage direction, its LRUD and its splays, produce the ordered ring of wall points that is that station's cross-section.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsMesh3d.js`
- Modify: `scripts/CaveSurvey/Core/CsAll.js` (include, after CsLrud)
- Modify: `tests/js_unit.js` (`CORE_FILES`, plus tests)

**Acceptance Criteria:**
- [ ] `CsMesh3d.frameAt(dir)` returns orthonormal `{right, up, forward}`, Z-up world, stable when the passage is vertical
- [ ] `CsMesh3d.ringAt(station, dir, lrud, splays, tapeMode)` returns points ordered by angle about the station in the frame plane
- [ ] An LRUD of 0 contributes a point AT the station, not nothing
- [ ] A station with no splays returns exactly the four LRUD points that were measured
- [ ] A splay endpoint appears in the ring at its projected angle
- [ ] No NaN in any returned coordinate
- [ ] `CsMesh3d.js` is in `CORE_FILES` in `tests/js_unit.js`

**Verify:** `node tests/js_unit.js` -> all pass

**Steps:**

- [ ] **Step 1: Add the file to CORE_FILES first**

In `tests/js_unit.js`, in `CORE_FILES`, immediately after the `CsLrud.js` entry:

```js
    "scripts/CaveSurvey/Core/CsMesh3d.js",
```

This goes FIRST because the harness loads Core by a hand-written list and a
missing file passes silently through deliberate catches -- a test suite that
never loaded the module would pass by vanishing.

- [ ] **Step 2: Write the failing tests**

```js
// --- CsMesh3d.frameAt ---
var fr = CsMesh3d.frameAt({ x: 1, y: 0, z: 0 });
assertClose(fr.forward.x, 1, 1e-9, "frameAt forward x");
assertClose(fr.right.x * fr.forward.x + fr.right.y * fr.forward.y +
            fr.right.z * fr.forward.z, 0, 1e-9, "right is perpendicular");
assertClose(fr.up.x * fr.forward.x + fr.up.y * fr.forward.y +
            fr.up.z * fr.forward.z, 0, 1e-9, "up is perpendicular");

// A vertical passage must not produce a degenerate frame.
var fv = CsMesh3d.frameAt({ x: 0, y: 0, z: 1 });
assert(isFinite(fv.right.x) && isFinite(fv.right.y) && isFinite(fv.right.z),
    "vertical passage frame is finite");
assertClose(Math.sqrt(fv.right.x * fv.right.x + fv.right.y * fv.right.y +
                      fv.right.z * fv.right.z), 1, 1e-9,
    "vertical passage right is unit length");

// --- CsMesh3d.ringAt ---
var st = { x: 0, y: 0, z: 0 };
var north = { x: 0, y: 1, z: 0 };
var ring = CsMesh3d.ringAt(st, north,
    { left: 2, right: 3, up: 4, down: 1 }, [], CsTraverse.SLOPE);
assertEqual(ring.length, 4, "four LRUD points, no splays");
for (var ri = 0; ri < ring.length; ri++) {
    assert(isFinite(ring[ri].x) && isFinite(ring[ri].y) &&
           isFinite(ring[ri].z), "ring point " + ri + " is finite");
}

// Zero is a measurement: the wall passes through the station.
var ringZero = CsMesh3d.ringAt(st, north,
    { left: 0, right: 3, up: 4, down: 1 }, [], CsTraverse.SLOPE);
assertEqual(ringZero.length, 4, "an LRUD of 0 still contributes a point");

// Not measured is not a point.
var ringNull = CsMesh3d.ringAt(st, north,
    { left: null, right: 3, up: 4, down: 1 }, [], CsTraverse.SLOPE);
assertEqual(ringNull.length, 3, "an unmeasured side contributes nothing");

// A splay joins the ring.
var splay = { from: "A", to: "", distance: 10, azimuth: 90,
    inclination: 0, splay: true };
var ringSplay = CsMesh3d.ringAt(st, north,
    { left: 2, right: 3, up: 4, down: 1 }, [splay], CsTraverse.SLOPE);
assertEqual(ringSplay.length, 5, "the splay tip joined the ring");
```

- [ ] **Step 3: Run, expect failure**

Run: `node tests/js_unit.js`
Expected: FAIL, `CsMesh3d is not defined`.

- [ ] **Step 4: Write CsMesh3d.js**

```js
// CsMesh3d.js -- the surveyed passage as a three-dimensional surface.
//
// Part of the Cave Survey Core library: pure functions, no document,
// no GUI, so the headless harness tests all of it. The GL window that
// draws the result (RCave3dView, C++) never sees a Survey -- it takes
// vertex and index buffers and knows nothing about caves. This file is
// the entire translation between the two.
//
// THE SHAPE OF THE SURFACE. At each station, the wall points that were
// actually measured -- the four LRUD ticks AND the tip of every splay
// shot from there -- are projected into the plane perpendicular to the
// passage and sorted by angle. That ordered ring is the station's
// cross-section. Consecutive rings are lofted with a triangle strip.
//
// A SPLAY IS A WALL POINT, which is CsLrud's argument in plan and is
// no less true in three dimensions: "a splay tip is a measured wall
// hit -- the same kind of fact an LRUD number is, just aimed where the
// caver pointed". A design that swept only the LRUD rectangle would
// render less than was measured -- a splay up into a dome would dent
// the tube instead of showing the void.
//
// AND NOTHING BETWEEN THE MEASURED POINTS. The ring is the hull of
// what was measured; the loft is straight strips between rings. No
// smoothing, no inferred curvature, for the reason CsLrud states: wall
// detail between stations that isn't in the data misrepresents the
// passage.
//
// JUNCTIONS END A RUN. Three or more non-splay shots meeting is a
// place where one ring cannot describe the passage, so the loft stops
// rather than guessing a surface across it -- the same rule CsLrud
// applies, reached through the same CsLrud.legCounts.
//
// Z IS NEVER DEFAULTED. A station without a resolved z is an error
// that refuses to build. The suite has closed five separate doors on
// a z quietly defaulting to 0 and rebasing an absolute-datum cave;
// this is the sixth, held shut on purpose.

include(includeBasePath + "/CsTraverse.js");
include(includeBasePath + "/CsLrud.js");

var CsMesh3d = {};

/** Vector helpers. Plain objects, because that is what the rest of the
 *  Core library passes around and RVector does not exist under node. */
CsMesh3d.sub = function(a, b) {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
};

CsMesh3d.cross = function(a, b) {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x
    };
};

CsMesh3d.dot = function(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
};

CsMesh3d.length = function(a) {
    return Math.sqrt(CsMesh3d.dot(a, a));
};

/** Unit vector, or null when there is no direction to normalize. */
CsMesh3d.normalize = function(a) {
    var len = CsMesh3d.length(a);
    if (!isFinite(len) || len < 1e-12) {
        return null;
    }
    return { x: a.x / len, y: a.y / len, z: a.z / len };
};

/**
 * An orthonormal frame for a passage heading in `dir`.
 *
 * World is Z-up. `right` is horizontal wherever the passage is not
 * vertical, so a cross-section drawn in this frame stands the way a
 * caver would draw it. In a vertical shaft that choice is degenerate
 * -- every horizontal direction is equally "right" -- so north is used
 * as the reference instead and the frame stays finite.
 *
 * \return {forward, right, up} unit vectors, or null when `dir` has no
 *         length at all.
 */
CsMesh3d.frameAt = function(dir) {
    var forward = CsMesh3d.normalize(dir);
    if (forward === null) {
        return null;
    }
    var worldUp = { x: 0, y: 0, z: 1 };
    var right = CsMesh3d.normalize(CsMesh3d.cross(forward, worldUp));
    if (right === null) {
        // Vertical passage: every horizontal direction is equally
        // perpendicular, so pick north and be consistent about it
        // rather than letting a near-zero cross product decide.
        right = CsMesh3d.normalize(
            CsMesh3d.cross(forward, { x: 0, y: 1, z: 0 }));
    }
    var up = CsMesh3d.normalize(CsMesh3d.cross(right, forward));
    return { forward: forward, right: right, up: up };
};

/**
 * One station's cross-section: the measured wall points around it,
 * ordered by angle in the frame perpendicular to `dir`.
 *
 * `lrud` is {left, right, up, down}; null means not measured and
 * contributes nothing, while 0 means the wall passes through the
 * station and contributes a point AT it -- the distinction CsLrud.
 * tickEnd already draws and that this must not re-break.
 *
 * \param splays shots from this station with splay === true
 * \return [{x, y, z}] in angular order, possibly empty
 */
CsMesh3d.ringAt = function(station, dir, lrud, splays, tapeMode) {
    var frame = CsMesh3d.frameAt(dir);
    if (frame === null) {
        return [];
    }
    if (tapeMode === undefined || tapeMode === null) {
        tapeMode = CsTraverse.SLOPE;
    }

    var points = [];

    var addLocal = function(u, v) {
        // u along right, v along up; the ring lives in that plane and
        // the station is its origin.
        if (!isFinite(u) || !isFinite(v)) {
            return;
        }
        points.push({
            u: u,
            v: v,
            angle: Math.atan2(v, u)
        });
    };

    var side = function(name, sign) {
        var d = lrud[name];
        if (d === null || d === undefined) {
            return;
        }
        addLocal(sign * d, 0);
    };
    side("right", 1);
    side("left", -1);

    var vertical = function(name, sign) {
        var d = lrud[name];
        if (d === null || d === undefined) {
            return;
        }
        addLocal(0, sign * d);
    };
    vertical("up", 1);
    vertical("down", -1);

    for (var i = 0; i < splays.length; i++) {
        var o = CsTraverse.offset(splays[i], tapeMode);
        if (o === null) {
            continue;
        }
        var vec = { x: o.dx, y: o.dy, z: o.dz };
        // Drop the along-passage component: the ring is a section, and
        // a splay's reach up or down the passage belongs to its
        // neighbours' rings, not to this one.
        var along = CsMesh3d.dot(vec, frame.forward);
        var u = CsMesh3d.dot(vec, frame.right) ;
        var v = CsMesh3d.dot(vec, frame.up);
        if (Math.abs(u) < 1e-9 && Math.abs(v) < 1e-9) {
            // Aimed straight along the passage: on the centerline, and
            // a wall point for neither side. CsLrud says the same.
            continue;
        }
        addLocal(u, v);
    }

    points.sort(function(a, b) { return a.angle - b.angle; });

    var out = [];
    for (var k = 0; k < points.length; k++) {
        out.push({
            x: station.x + points[k].u * frame.right.x +
               points[k].v * frame.up.x,
            y: station.y + points[k].u * frame.right.y +
               points[k].v * frame.up.y,
            z: station.z + points[k].u * frame.right.z +
               points[k].v * frame.up.z
        });
    }
    return out;
};
```

Add to `CsAll.js`, immediately after the `CsLrud.js` include:

```js
// The 3D passage surface, after CsTraverse/CsLrud whose offset and
// junction rules it reuses.
include(includeBasePath + "/CsMesh3d.js");
```

- [ ] **Step 5: Run, expect pass**

Run: `node tests/js_unit.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/CaveSurvey/Core/CsMesh3d.js scripts/CaveSurvey/Core/CsAll.js tests/js_unit.js
git commit -m "feat: a station's cross-section, from every wall point measured there"
```

---

### Task 3: CsMesh3d.build -- lofting the rings into a surface

**Goal:** Turn a whole Survey plus resolved stations into the triangle buffer, line buffer and bounds the GL window draws.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsMesh3d.js`
- Modify: `tests/js_unit.js`
- Create: `tests/cave3d_mesh_run.js`

**Acceptance Criteria:**
- [ ] `CsMesh3d.build(survey, resolved, opts)` returns `{triangles: {positions, normals, colors, indices}, lines: {positions, colors, indices}, bounds: {min, max}}`
- [ ] Every index is within range of its own position array
- [ ] No NaN anywhere in any returned array
- [ ] A junction station (3+ non-splay legs) ends a loft run
- [ ] `bounds` equals the extent of the emitted geometry
- [ ] A station with a resolved `z` of `undefined` throws rather than being treated as 0
- [ ] Colour by trip is the default; `opts.colorBy === "depth"` is honoured

**Verify:** `node tests/js_unit.js && node tests/cave3d_mesh_run.js` -> all pass

**Steps:**

- [ ] **Step 1: Write the failing unit tests**

```js
// A three-station straight passage with LRUD everywhere.
var mSurvey = {
    caveName: "Mesh", date: "", team: "", declination: 0,
    distanceUnit: "ft", fixed: {}, trips: [],
    shots: [
        { from: "A", to: "B", distance: 10, azimuth: 0, inclination: 0,
          left: 2, right: 2, up: 3, down: 1, splay: false, trip: 0 },
        { from: "B", to: "C", distance: 10, azimuth: 0, inclination: 0,
          left: 2, right: 2, up: 3, down: 1, splay: false, trip: 0 }
    ]
};
CsModel.ensureTrips(mSurvey);
var mResolved = CsNetwork.resolve(mSurvey);
var mesh = CsMesh3d.build(mSurvey, mResolved);

assert(mesh.triangles.indices.length > 0, "the loft produced triangles");
assert(mesh.lines.indices.length > 0, "the centerline produced lines");

var maxIdx = mesh.triangles.positions.length / 3;
for (var mi = 0; mi < mesh.triangles.indices.length; mi++) {
    assert(mesh.triangles.indices[mi] >= 0 &&
           mesh.triangles.indices[mi] < maxIdx,
        "triangle index " + mi + " is in range");
}
for (var mp = 0; mp < mesh.triangles.positions.length; mp++) {
    assert(isFinite(mesh.triangles.positions[mp]),
        "triangle position " + mp + " is finite");
}

// Bounds match what was emitted.
assertClose(mesh.bounds.min.z, -1, 1e-6, "bounds min z is the floor");
assertClose(mesh.bounds.max.z, 3, 1e-6, "bounds max z is the ceiling");

// A missing z is an error, never a silent 0.
var broken = CsNetwork.resolve(mSurvey);
delete broken.stations["B"].z;
var threw = false;
try { CsMesh3d.build(mSurvey, broken); } catch (e) { threw = true; }
assert(threw, "a station with no z refuses to build");
```

- [ ] **Step 2: Run, expect failure**

Run: `node tests/js_unit.js`
Expected: FAIL, `CsMesh3d.build is not a function`.

- [ ] **Step 3: Implement build**

Append to `CsMesh3d.js`:

```js
/** Colours a trip index cycles through. Deliberately few and
 *  distinguishable in both directions of a dark GL background. */
CsMesh3d.TRIP_COLORS = [
    [0.85, 0.85, 0.80], [0.90, 0.55, 0.30], [0.40, 0.70, 0.90],
    [0.60, 0.85, 0.45], [0.85, 0.45, 0.60], [0.75, 0.70, 0.35]
];

/** The direction the passage runs at a station: the mean of the
 *  incoming and outgoing legs, or the single leg at a run end. */
CsMesh3d.directionAt = function(name, legsByStation, resolved) {
    var legs = legsByStation[name] || [];
    var sum = { x: 0, y: 0, z: 0 };
    var n = 0;
    for (var i = 0; i < legs.length; i++) {
        var a = resolved.stations[legs[i].from];
        var b = resolved.stations[legs[i].to];
        if (a === undefined || b === undefined) {
            continue;
        }
        var v = CsMesh3d.normalize(CsMesh3d.sub(b, a));
        if (v === null) {
            continue;
        }
        sum.x += v.x; sum.y += v.y; sum.z += v.z;
        n += 1;
    }
    if (n === 0) {
        return null;
    }
    return CsMesh3d.normalize(sum);
};

/**
 * The whole passage surface.
 *
 * \param survey   a Survey (CsModel)
 * \param resolved CsNetwork.resolve(survey)
 * \param opts     {colorBy: "trip"|"depth", tapeMode}
 *
 * \return {triangles: {positions, normals, colors, indices},
 *          lines: {positions, colors, indices},
 *          bounds: {min: {x,y,z}, max: {x,y,z}}}
 *
 * Throws when a station on a plotted leg has no resolved z. That is
 * not defensive noise: a z silently defaulting to 0 rebases an
 * absolute-datum cave to sea level, and this suite has closed five
 * separate doors on exactly that.
 */
CsMesh3d.build = function(survey, resolved, opts) {
    opts = opts || {};
    var tapeMode = opts.tapeMode || CsTraverse.SLOPE;
    var colorBy = opts.colorBy || "trip";

    var counts = CsLrud.legCounts(resolved.legs);
    var splays = CsLrud.splaysByStation(survey);

    // Legs touching each station, for directionAt.
    var legsByStation = {};
    var push = function(name, leg) {
        if (!legsByStation.hasOwnProperty(name)) {
            legsByStation[name] = [];
        }
        legsByStation[name].push(leg);
    };
    for (var li = 0; li < resolved.legs.length; li++) {
        push(resolved.legs[li].from, resolved.legs[li]);
        push(resolved.legs[li].to, resolved.legs[li]);
    }

    var tri = { positions: [], normals: [], colors: [], indices: [] };
    var lin = { positions: [], colors: [], indices: [] };
    var min = { x: Infinity, y: Infinity, z: Infinity };
    var max = { x: -Infinity, y: -Infinity, z: -Infinity };

    var grow = function(p) {
        if (p.x < min.x) { min.x = p.x; }
        if (p.y < min.y) { min.y = p.y; }
        if (p.z < min.z) { min.z = p.z; }
        if (p.x > max.x) { max.x = p.x; }
        if (p.y > max.y) { max.y = p.y; }
        if (p.z > max.z) { max.z = p.z; }
    };

    var requireStation = function(name) {
        var st = resolved.stations[name];
        if (st === undefined) {
            return null;
        }
        if (typeof st.z !== "number" || !isFinite(st.z)) {
            throw new Error("CsMesh3d: station " + name +
                " has no resolved elevation. Refusing to build a mesh " +
                "that would place it at datum zero.");
        }
        return st;
    };

    var colorFor = function(leg) {
        if (colorBy === "depth") {
            return null;   // filled in below, once bounds are known
        }
        var t = leg.trip || 0;
        return CsMesh3d.TRIP_COLORS[t % CsMesh3d.TRIP_COLORS.length];
    };

    // --- centerline ---
    for (var ci = 0; ci < resolved.legs.length; ci++) {
        var leg = resolved.legs[ci];
        var a = requireStation(leg.from);
        var b = requireStation(leg.to);
        if (a === null || b === null) {
            continue;
        }
        var col = colorFor(leg) || [1, 1, 1];
        var base = lin.positions.length / 3;
        lin.positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
        lin.colors.push(col[0], col[1], col[2], col[0], col[1], col[2]);
        lin.indices.push(base, base + 1);
        grow(a);
        grow(b);
    }

    // --- rings, in run order, broken at junctions ---
    var order = CsStationOrder.walk(survey, resolved);
    var prevRing = null;
    var prevColor = null;

    var flush = function() {
        prevRing = null;
        prevColor = null;
    };

    for (var oi = 0; oi < order.length; oi++) {
        var name = order[oi];
        var st = requireStation(name);
        if (st === null) {
            flush();
            continue;
        }
        var dir = CsMesh3d.directionAt(name, legsByStation, resolved);
        if (dir === null) {
            flush();
            continue;
        }
        var lrud = CsMesh3d.lrudAt(name, survey);
        var ring = CsMesh3d.ringAt(st, dir, lrud,
            splays[name] || [], tapeMode);
        var color = CsMesh3d.TRIP_COLORS[
            CsMesh3d.tripAt(name, survey) % CsMesh3d.TRIP_COLORS.length];

        if (ring.length >= 3 && prevRing !== null &&
            prevRing.length >= 3) {
            CsMesh3d.loft(tri, prevRing, ring, prevColor, color);
        }
        for (var gi = 0; gi < ring.length; gi++) {
            grow(ring[gi]);
        }

        // A junction cannot be described by one ring, so the loft
        // stops here rather than guessing a surface across it. Same
        // rule, same source of truth, as CsLrud.wallRuns.
        if ((counts[name] || 0) >= 3) {
            flush();
        } else {
            prevRing = ring;
            prevColor = color;
        }
    }

    if (!isFinite(min.x)) {
        min = { x: 0, y: 0, z: 0 };
        max = { x: 0, y: 0, z: 0 };
    }
    return { triangles: tri, lines: lin, bounds: { min: min, max: max } };
};

/** Triangle strip between two rings, resampled to the longer one so
 *  rings of unequal length still loft. Flat normals: this is measured
 *  geometry and smoothing it would imply detail nobody recorded. */
CsMesh3d.loft = function(tri, ringA, ringB, colorA, colorB) {
    var n = Math.max(ringA.length, ringB.length);
    var at = function(ring, i) {
        return ring[Math.floor(i * ring.length / n) % ring.length];
    };
    for (var i = 0; i < n; i++) {
        var a0 = at(ringA, i), a1 = at(ringA, i + 1);
        var b0 = at(ringB, i), b1 = at(ringB, i + 1);
        CsMesh3d.quad(tri, a0, a1, b1, b0, colorA, colorB);
    }
};

/** One quad as two triangles, with a flat normal per triangle. */
CsMesh3d.quad = function(tri, p0, p1, p2, p3, colorA, colorB) {
    var emit = function(a, b, c, col) {
        var nrm = CsMesh3d.normalize(
            CsMesh3d.cross(CsMesh3d.sub(b, a), CsMesh3d.sub(c, a)));
        if (nrm === null) {
            return;   // degenerate triangle, nothing to draw
        }
        var base = tri.positions.length / 3;
        var pts = [a, b, c];
        for (var i = 0; i < 3; i++) {
            tri.positions.push(pts[i].x, pts[i].y, pts[i].z);
            tri.normals.push(nrm.x, nrm.y, nrm.z);
            tri.colors.push(col[0], col[1], col[2]);
        }
        tri.indices.push(base, base + 1, base + 2);
    };
    emit(p0, p1, p2, colorB);
    emit(p0, p2, p3, colorA);
};

/** The LRUD recorded AT a station -- it lives on the shot that arrived
 *  there, which is what CsLrud means by "LRUD at the TO station". */
CsMesh3d.lrudAt = function(name, survey) {
    for (var i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        if (!s.splay && s.to === name) {
            return { left: s.left, right: s.right,
                     up: s.up, down: s.down };
        }
    }
    return { left: null, right: null, up: null, down: null };
};

/** The trip a station belongs to: the trip of the shot that arrived
 *  there, or 0 for the very first station of a survey. */
CsMesh3d.tripAt = function(name, survey) {
    for (var i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        if (!s.splay && s.to === name) {
            return s.trip || 0;
        }
    }
    return 0;
};
```

**CORRECTION, found while implementing Task 2 -- do not use
`CsStationOrder`.** It exposes `walkOrder(survey)`, which is
first-appearance order over the legs and carries NO adjacency
guarantee: two consecutive names in it can be in different parts of the
cave, and lofting between their rings would stretch a surface across
open air.

Iterate `resolved.legs` instead. `CsNetwork.resolve` returns them in
resolution order tagged `kind` of `"new"` / `"closure"` / `"tie"`, and
the `"new"` legs ARE the spanning tree -- each one attaches a
newly-placed station to an already-placed one, so its two ends are
genuinely adjacent by construction. So:

- compute each station's ring once, lazily, and cache it by name
- for every leg with `kind === "new"`, loft `ring(leg.from)` to
  `ring(leg.to)`
- skip the loft when either end is a junction (`counts[name] >= 3`),
  which is how "a junction ends a run" expresses itself when the walk
  is per-leg rather than per-run

This drops the run/flush bookkeeping entirely and handles branching for
free. Closure and tie legs are drawn on the centerline but never
lofted: a closure leg joins two stations already placed by other
routes, and lofting it would put a second surface over passage the
spanning tree has already covered.

One thing still to settle in code: `directionAt` averages every leg at
a station, which at a junction means averaging branches that head
different ways. Since junctions are not lofted anyway, the junction
ring is only ever an endpoint -- but confirm the ring there still looks
sane before moving on.

- [ ] **Step 4: Run, expect pass**

Run: `node tests/js_unit.js`
Expected: PASS.

- [ ] **Step 5: Write the fixture test**

Create `tests/cave3d_mesh_run.js`, modelled on `tests/cross_section_run.js`
(copy its Core-loading preamble and its fixture parsing verbatim), then:

```js
var survey = loadPitfall();               // as cross_section_run.js does
var resolved = CsNetwork.resolve(survey);
var mesh = CsMesh3d.build(survey, resolved);

check(mesh.triangles.indices.length > 0, "Pitfall Cave produced a surface");
check(mesh.lines.indices.length > 0, "Pitfall Cave produced a centerline");

var bad = 0;
for (var i = 0; i < mesh.triangles.positions.length; i++) {
    if (!isFinite(mesh.triangles.positions[i])) { bad += 1; }
}
check(bad === 0, "no NaN in " + mesh.triangles.positions.length +
    " coordinates");

var maxIdx = mesh.triangles.positions.length / 3;
var oob = 0;
for (var j = 0; j < mesh.triangles.indices.length; j++) {
    if (mesh.triangles.indices[j] < 0 ||
        mesh.triangles.indices[j] >= maxIdx) { oob += 1; }
}
check(oob === 0, "every index is in range");

// THE DATUM ASSERTION. Pitfall Cave's stations sit at real elevation;
// a mesh whose bounds collapse toward zero means a z defaulted
// somewhere, which is the bug family this suite keeps finding.
var zs = [];
for (var n in resolved.stations) {
    if (resolved.stations.hasOwnProperty(n)) {
        zs.push(resolved.stations[n].z);
    }
}
var zMin = Math.min.apply(null, zs);
check(mesh.bounds.min.z > zMin - 100 && mesh.bounds.min.z < zMin + 100,
    "mesh bounds sit at the survey's own datum, not at zero");
```

- [ ] **Step 6: Run it**

Run: `node tests/cave3d_mesh_run.js`
Expected: every check PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/CaveSurvey/Core/CsMesh3d.js tests/js_unit.js tests/cave3d_mesh_run.js
git commit -m "feat: loft the station rings into a passage surface"
```

---

### Task 4: The GL widget

**Goal:** A `QOpenGLWidget` in cavecad-src that draws supplied triangle and line buffers with an orbit camera, verified against a hardcoded test mesh.

**Files:**
- Create: `src/gui/RCave3dView.h`, `src/gui/RCave3dView.cpp`
- Create: `src/gui/RCave3dWindow.h`, `src/gui/RCave3dWindow.cpp`
- Modify: `src/gui/CMakeLists.txt`

**Acceptance Criteria:**
- [ ] `ninja -j20` builds clean, no new warnings
- [ ] `setTriangles` / `setLines` / `setBounds` / `clear` upload to VBOs and repaint
- [ ] Left-drag rotates, middle-drag and shift+left-drag pan, wheel zooms
- [ ] `Home` reframes to the current bounds
- [ ] Plan (looking down) and profile (looking north) presets snap the camera exactly
- [ ] Z is up; a mesh whose max z is greater than its min z renders with that end upward
- [ ] Depth testing on, backface culling off (a passage is viewed from inside as often as outside)

**Verify:** build, then temporarily call `setTriangles` with a hardcoded unit cube from `RCave3dWindow`'s constructor and confirm all controls behave. Remove the hardcoded call before commit.

**Steps:**

- [ ] **Step 1: Write RCave3dView.h**

```cpp
#ifndef RCAVE3DVIEW_H
#define RCAVE3DVIEW_H

#include <QOpenGLWidget>
#include <QOpenGLFunctions>
#include <QOpenGLShaderProgram>
#include <QOpenGLBuffer>
#include <QVector3D>

/**
 * A renderer that has never heard of caves.
 *
 * It draws two buffers -- a lit triangle mesh and flat coloured lines
 * -- under an orbit camera, and that is the whole of it. Every cave
 * fact (stations, trips, LRUD, tags) stays in the Cave Survey script
 * library, which builds these buffers and hands them over. Teaching
 * this class about survey data would mean a second implementation of
 * tag parsing, in a second language, kept in step by hand.
 *
 * World is Z-up, matching the survey's own frame, so no axis
 * conversion is needed anywhere and none can be got wrong later when
 * LiDAR captures arrive.
 */
class RCave3dView : public QOpenGLWidget, protected QOpenGLFunctions {
    Q_OBJECT

public:
    RCave3dView(QWidget* parent = NULL);
    virtual ~RCave3dView();

    Q_INVOKABLE void setTriangles(const QVector<float>& positions,
                                  const QVector<float>& normals,
                                  const QVector<float>& colors,
                                  const QVector<int>& indices);
    Q_INVOKABLE void setLines(const QVector<float>& positions,
                              const QVector<float>& colors,
                              const QVector<int>& indices);
    Q_INVOKABLE void setBounds(const QVector3D& min, const QVector3D& max);
    Q_INVOKABLE void clear();

    Q_INVOKABLE void viewAll();
    Q_INVOKABLE void viewPlan();
    Q_INVOKABLE void viewProfile();

protected:
    void initializeGL();
    void paintGL();
    void resizeGL(int w, int h);
    void mousePressEvent(QMouseEvent* e);
    void mouseMoveEvent(QMouseEvent* e);
    void wheelEvent(QWheelEvent* e);
    void keyPressEvent(QKeyEvent* e);

private:
    // ... buffers, shader program, camera state (yaw, pitch, distance,
    // target), bounds
};

#endif
```

- [ ] **Step 2: Implement RCave3dView.cpp**

Two shader programs. Mesh vertex shader applies `mvp`; fragment shader
does one headlight term so passage shape reads:

```glsl
// fragment
varying vec3 vNormal;
varying vec3 vColor;
void main() {
    float lambert = abs(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0)));
    gl_FragColor = vec4(vColor * (0.35 + 0.65 * lambert), 1.0);
}
```

`abs` on the dot product, not `max(0.0, ...)`: a passage is viewed from
inside as often as outside, and a one-sided light makes the inside of
the tube go black.

Camera: spherical `(yaw, pitch, distance)` about a `target` point.

```cpp
void RCave3dView::viewAll() {
    QVector3D center = (boundsMin + boundsMax) * 0.5f;
    float radius = (boundsMax - boundsMin).length() * 0.5f;
    if (radius < 1e-6f) { radius = 1.0f; }
    target = center;
    distance = radius * 2.5f;
    update();
}

void RCave3dView::viewPlan() {
    yaw = 0.0f;
    pitch = 89.9f;      // not 90: a straight-down pole makes the up
                        // vector degenerate and the view roll at random
    viewAll();
}

void RCave3dView::viewProfile() {
    yaw = 0.0f;
    pitch = 0.0f;
    viewAll();
}
```

In `initializeGL`: `glEnable(GL_DEPTH_TEST)` and explicitly
`glDisable(GL_CULL_FACE)`.

- [ ] **Step 3: Implement RCave3dWindow**

A `QMainWindow` holding one `RCave3dView`, with a toolbar carrying
Refresh, Plan, Profile, View All, and toggles for centerline and splays.
Title is the drawing's name. It emits `refreshRequested()`.

- [ ] **Step 4: Add to CMakeLists.txt**

Append `RCave3dView.cpp RCave3dWindow.cpp` to the gui library sources
and the headers to the MOC list.

- [ ] **Step 5: Build**

Run: `ninja -j20`
Expected: builds clean.

- [ ] **Step 6: Verify controls with a hardcoded cube**

Temporarily feed a unit cube in the window constructor. Confirm rotate,
pan, zoom, Home, Plan, Profile. Then delete the temporary call.

- [ ] **Step 7: Commit**

```bash
git add src/gui/RCave3dView.h src/gui/RCave3dView.cpp src/gui/RCave3dWindow.h src/gui/RCave3dWindow.cpp src/gui/CMakeLists.txt
git commit -m "feat: a GL window that draws buffers and knows nothing else"
```

---

### Task 5: The bridge, and measuring the transfer

**Goal:** JS can open a window and push a mesh into it, by whichever transfer method measurement shows is fast enough.

**Files:**
- Create: `src/gui/RCave3dBridge.h`, `src/gui/RCave3dBridge.cpp`
- Modify: `qcadjsapi/RScriptHandlerJs.cpp:471` area
- Modify: `src/gui/CMakeLists.txt`

**Acceptance Criteria:**
- [ ] A global `cave3d` exists in the script engine
- [ ] `cave3d.open(title)` returns a handle; `cave3d.close(handle)`, `cave3d.isOpen(handle)` work
- [ ] `cave3d.setMesh(handle, obj)` accepts the exact object `CsMesh3d.build` returns
- [ ] A Pitfall-Cave-sized mesh transfers in under 250 ms, measured and recorded in the commit message
- [ ] A synthetic mesh of 200k triangles either transfers in under 2 s, or the binary-blob fallback is implemented and used

**Verify:** in CaveCAD's script console, `cave3d.open("test")` opens a window; a timing harness prints the transfer time for both mesh sizes.

**Steps:**

- [ ] **Step 1: Write the bridge**

```cpp
class RCave3dBridge : public QObject {
    Q_OBJECT
public:
    Q_INVOKABLE int open(const QString& title);
    Q_INVOKABLE void close(int handle);
    Q_INVOKABLE bool isOpen(int handle);
    Q_INVOKABLE void setMesh(int handle, const QVariantMap& mesh);
    Q_INVOKABLE void clear(int handle);
private:
    QHash<int, RCave3dWindow*> windows;
    int nextHandle;
};
```

`setMesh` reads `triangles`/`lines`/`bounds` out of the QVariantMap and
calls through to the view.

- [ ] **Step 2: Expose it**

In `RScriptHandlerJs.cpp`, beside the existing globals:

```cpp
    global.setProperty("cave3d", engine->newQObject(new RCave3dBridge()));
```

- [ ] **Step 3: Build and smoke-test**

Run: `ninja -j20`, launch CaveCAD, in the script console: `cave3d.open("test")`
Expected: an empty GL window opens.

- [ ] **Step 4: MEASURE the transfer**

This is the spike the spec calls for -- the decision is made from the
number, not guessed. Time `setMesh` with the Pitfall Cave mesh and with
a synthetic 200k-triangle mesh.

If the large case is too slow, implement the fallback: JS writes
`positions`/`normals`/`colors`/`indices` as a little-endian binary blob
into the scratch directory and calls `cave3d.setMeshFile(handle, path)`,
which reads it with `QFile` and `QDataStream`.

- [ ] **Step 5: Commit, with the measurement in the message**

```bash
git add src/gui/RCave3dBridge.h src/gui/RCave3dBridge.cpp src/gui/CMakeLists.txt
git commit -m "feat: one QObject is the whole bridge to the 3D window"
```

---

### Task 6: The Cave3D tool

**Goal:** `Cave Survey > 3D View` opens the window on the current drawing's survey, with a working Refresh.

**Files:**
- Create: `scripts/CaveSurvey/Cave3D/Cave3D.js`
- Create: `scripts/CaveSurvey/Cave3D/Cave3D.svg`, `Cave3D-inverse.svg`
- Test: manual, in CaveCAD

**Acceptance Criteria:**
- [ ] The menu entry and toolbar button appear under Cave Survey
- [ ] Default commands `cave3d` and `c3` work
- [ ] With no tagged survey in the drawing, it warns and does nothing
- [ ] Refresh rebuilds from the current drawing
- [ ] The window closes cleanly and reopens

**Verify:** open Pitfall Cave in CaveCAD, run the tool, see the passage.

**Steps:**

- [ ] **Step 1: Write Cave3D.js**

Follow the add-on wiring shape exactly -- it is fixed, and a tool that
deviates vanishes from the menu:

```js
include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

function Cave3D(guiAction) {
    EAction.call(this, guiAction);
}

Cave3D.prototype = new EAction();

Cave3D.handle = null;

Cave3D.rebuild = function() {
    var doc = getDocument();
    if (isNull(doc)) { return; }
    var survey = CsRebuild.rebuild(doc, getDocumentInterface());
    if (survey === null) { return; }
    var resolved = CsNetwork.resolve(survey);
    cave3d.setMesh(Cave3D.handle, CsMesh3d.build(survey, resolved));
};

function cave3dRun() {
    var doc = getDocument();
    var survey = CsRebuild.rebuild(doc, getDocumentInterface());
    if (survey === null || survey.shots.length === 0) {
        warning(qsTr("3D View: no tagged survey stations found.\n" +
            "Import a survey or type one into the Survey Notebook " +
            "first -- there is no passage to draw without shots."));
        return;
    }
    if (Cave3D.handle === null || !cave3d.isOpen(Cave3D.handle)) {
        Cave3D.handle = cave3d.open(CsCave.nameOf(doc.getFileName()));
    }
    Cave3D.rebuild();
}

Cave3D.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    cave3dRun();
    this.terminate();
};

Cave3D.init = function(basePath) {
    var action = new RGuiAction(qsTr("3D View"),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/Cave3D.js");
    action.setIcon(basePath + "/Cave3D.svg");
    action.setStatusTip(qsTr("Look at the surveyed passage in three " +
        "dimensions"));
    action.setDefaultCommands(["cave3d", "c3"]);
    action.setGroupSortOrder(451);
    action.setSortOrder(50);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
```

- [ ] **Step 2: Draw the two icons**

Match the existing tools' SVG dimensions and stroke weight; the
`-inverse` variant is for the dark theme.

- [ ] **Step 3: Publish and test live**

```bash
tools/publish.sh
```

Then restart CaveCAD -- genuinely restart it, because a quit blocked by
unsaved changes leaves the old add-on running and a live check can be
made against stale code without saying so.

- [ ] **Step 4: Commit**

```bash
git add scripts/CaveSurvey/Cave3D/
git commit -m "feat: look at the passage in three dimensions"
```

---

### Task 7: The listener

**Goal:** The window follows the drawing as it is edited, without anything depending on that happening.

**Files:**
- Create: `scripts/CaveSurvey/Cave3D/Cave3DListener.js`
- Modify: `scripts/CaveSurvey/Cave3D/Cave3D.js`

**Acceptance Criteria:**
- [ ] Editing a shot updates the window
- [ ] Rebuilds are debounced -- a multi-entity transaction rebuilds once
- [ ] With the listener disabled, Refresh still produces a correct window
- [ ] The listener is removed when the window closes
- [ ] No rebuild is attempted while no window is open

**Verify:** open Pitfall Cave with the 3D window, move a station, watch it follow. Then disable the listener and confirm Refresh alone is still correct.

**Steps:**

- [ ] **Step 1: Write the listener**

Model it on `ShapedLines/ShapedLinesListener.js` -- same adapter shape,
same `appWin.addTransactionListener(adapter)` registration.

```js
// Cave3DListener.js -- the 3D window follows the drawing.
//
// NOTHING DEPENDS ON THIS. The Refresh button is the guarantee; this
// listener is the same answer arrived at earlier. CsBind.js states why
// the distinction matters: the transaction signal "rests on a signal
// this bridge may not deliver", and a design that only listened would
// be silently wrong whenever it was not delivered.

var Cave3DListener = {};

Cave3DListener.pending = false;

Cave3DListener.transactionUpdated = function(doc, transaction) {
    if (Cave3D.handle === null || !cave3d.isOpen(Cave3D.handle)) {
        return;
    }
    if (Cave3DListener.pending) {
        return;
    }
    Cave3DListener.pending = true;
    // Coalesce: one transaction touching two hundred entities is one
    // rebuild, not two hundred.
    var timer = new QTimer();
    timer.singleShot = true;
    timer.timeout.connect(function() {
        Cave3DListener.pending = false;
        Cave3D.rebuild();
    });
    timer.start(150);
};
```

- [ ] **Step 2: Test live**

Restart CaveCAD, open the 3D window, move a station, confirm it follows
within a beat.

- [ ] **Step 3: Commit**

```bash
git add scripts/CaveSurvey/Cave3D/Cave3DListener.js scripts/CaveSurvey/Cave3D/Cave3D.js
git commit -m "feat: the 3D window follows the drawing as it is edited"
```

---

### Task 8: Verify live, and release

**Goal:** The whole thing works against Pitfall Cave in a genuinely restarted CaveCAD, and the version is stamped.

**Files:**
- Modify: `VERSION` (cavecad-tools) -> `0.9.117.0`
- Modify: `cavecad-src/VERSION`

**Acceptance Criteria:**
- [ ] Every headless test passes: `node tests/js_unit.js`, `node tests/cave3d_mesh_run.js`, `node tests/package_cave.js`
- [ ] `tests/test_addon.py` passes -- in particular `TestEngineTestsLoadEveryCoreFile`, which fails if `CsMesh3d.js` is in neither `CORE_FILES` nor the not-loaded list
- [ ] Pitfall Cave renders, coloured by trip, at its own datum
- [ ] Rotate, pan, zoom, Home, Plan, Profile all work
- [ ] Editing a shot updates the window; Refresh works with the listener off
- [ ] `lidar/` is created beside a cave drawing and is empty

**Verify:** the full list above, run against a CaveCAD quit and restarted cleanly.

**Steps:**

- [ ] **Step 1: Run every test**

```bash
node tests/js_unit.js && node tests/cave3d_mesh_run.js && node tests/package_cave.js && python3 -m pytest tests/test_addon.py -q
```

- [ ] **Step 2: Restart CaveCAD genuinely**

Quit. If the quit is blocked by unsaved changes, resolve them and quit
again -- a blocked quit leaves the old add-on running, and "verified
live" would mean verified against stale code.

- [ ] **Step 3: Walk the acceptance list**

Every box above, in order, on Pitfall Cave.

- [ ] **Step 4: Bump and commit**

```bash
echo 0.9.117.0 > VERSION
git add VERSION
git commit -m "release: 0.9.117.0 -- the passage in three dimensions"
```

---

## What this plan deliberately does not do

glTF parsing, capture import, registration, slicing, station picking in
3D, selection sync with the drawing, textures, lighting beyond the
single headlight term. Those are projects 2 through 4. `lidar/` is
created here and left empty on purpose, so that project 2 inherits a
convention instead of inventing one.
