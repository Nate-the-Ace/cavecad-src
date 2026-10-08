# Sketch Scans in the 3D View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drape the caver's own scanned sketches onto the passage in the 3D view — plan scans first, profile scans straight after.

**Architecture:** A new pure Core module `CsDrape` samples the survey for the coordinate a sketch does not carry (z for plan, x/y for profile) and emits textured triangles. The C++ side gains its first texture pipeline: upload, a luminance-keyed shader, and blending.

**Tech Stack:** CaveCAD's ECMAScript engine, existing `CsWarp` / `CsProfile` / `CsProfileBox` / `CsCave` Core modules, C++17 / Qt 6.11 (`QOpenGLTexture`, `QImage`).

**User decisions (already made):**
- "Plan drape is a fine place to start, but i really want to see the profiles working soon."
- Profile scans drape along the centerline, in strips, one per leg.
- Plan scans drape onto the passage, not flat below it.
- "Key out the paper, keep the ink."
- "the generated bands should also be nonexaggerated" — done in 0.9.123.0.

Spec: `docs/superpowers/specs/2026-09-12-cave-3d-scans-design.md`

---

## Facts established by probing, not to be re-derived

**A scan's file path is XDATA, not the entity's filename.** `getFileName()` returns empty and `getWidth()`/`getHeight()` return zero on Truitt's 28 real plan scans, via both the method and the property route. The path lives under the XDATA key `SketchScan`, relative to the cave's scans folder, resolved by `CsCave.resolveUnderScans`. Pixel dimensions come from the image file.

**`getInsertionPoint()`, `getUVector()`, `getVVector()` do work**, and u/v are PER-PIXEL, so the far corner is `origin + widthPx*u + heightPx*v`.

**There is no vertical exaggeration.** Removed in 0.9.123.0. A band's y is elevation.

**Scan layers:** `CsLayers.CTRL_SCAN` (plan), `CsLayers.CTRL_PROFILE_SCAN` (profile). `CsScanFrame.layerFor(kind)` maps them.

**BUILD NOTE:** any change to `RCave3dBridge.h` needs ninja in BOTH `cavecad-src` and `qcadjsapi`, or the two libraries disagree about the object's size — heap corruption with a backtrace pointing at QtQml.

---

### Task 1: CsDrape — elevation sampling and the plan grid

**Goal:** Sample a z for any point in plan, and turn a scan's quad into a subdivided grid draped onto that surface.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsDrape.js`
- Modify: `scripts/CaveSurvey/Core/CsAll.js`, `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `CsDrape.elevationAt(point, stations)` returns a station's own z at that station
- [ ] It interpolates between two stations by inverse-square distance
- [ ] Beyond `CsDrape.REACH` from every station it returns the nearest station's z FLAT, not an extrapolation
- [ ] `CsDrape.grid(quad, divisions, stations)` returns `{positions, uvs, indices}`
- [ ] Vertex count is `(divisions+1)^2`; index count is `divisions^2 * 6`
- [ ] No NaN in any output; an empty station set returns an empty grid
- [ ] `CsDrape.js` is in `CORE_FILES` in `tests/js_unit.js`

**Verify:** engine suite → `### UNIT OK`

**Steps:**

- [ ] **Step 1: Add to CORE_FILES first** — the harness loads Core by hand-written list and a missing file passes silently.

```js
    "scripts/CaveSurvey/Core/CsDrape.js",
```

- [ ] **Step 2: Write the failing tests**

```js
var dStations = { A: { x: 0, y: 0, z: 100 }, B: { x: 10, y: 0, z: 110 } };
nearly(CsDrape.elevationAt({ x: 0, y: 0 }, dStations), 100, 1e-6,
    "at a station, its own elevation");
nearly(CsDrape.elevationAt({ x: 10, y: 0 }, dStations), 110, 1e-6,
    "at the other, the other's");
var mid = CsDrape.elevationAt({ x: 5, y: 0 }, dStations);
ok(mid > 100 && mid < 110, "between two stations, between their elevations");

// BEYOND REACH IT GOES FLAT. Past the last station there is no trend to
// follow, and a plane is honest where a guessed slope is not.
var far = CsDrape.elevationAt({ x: 100000, y: 0 }, dStations);
ok(far === 100 || far === 110,
    "far away it takes a real station's elevation, not an extrapolation");

eqs(String(CsDrape.elevationAt({ x: 0, y: 0 }, {})), "null",
    "no stations, no elevation -- and no NaN");

var quad = { origin: { x: 0, y: 0 }, u: { x: 10, y: 0 }, v: { x: 0, y: 10 } };
var g = CsDrape.grid(quad, 4, dStations);
eqs(String(g.positions.length / 3), "25", "(4+1)^2 vertices");
eqs(String(g.indices.length), String(4 * 4 * 6), "two triangles per cell");
eqs(String(g.uvs.length / 2), "25", "one uv per vertex");
var dBad = 0;
for (var di2 = 0; di2 < g.positions.length; di2++) {
    if (!isFinite(g.positions[di2])) { dBad++; }
}
eqs(String(dBad), "0", "no NaN in a draped grid");
```

- [ ] **Step 3: Write CsDrape's pure half**

```js
// CsDrape.js -- a scanned sketch laid onto the passage it was drawn of.
//
// Part of the Cave Survey Core library. The half above the QCAD banner
// is PURE and is the half worth testing.
//
// THIS INTERPOLATES ELEVATION BETWEEN STATIONS, which is inventing data
// of the same class CsLrud refuses to invent when it will not guess wall
// detail between measured points. What makes it defensible here, and
// ONLY here, is that the 3D panel DRAWS NO ENTITY AND WRITES NO TAG. It
// has always been a view. Inventing a surface to look at is not
// inventing survey data, and NOTHING from this module may ever be
// written back into a drawing.
//
// Weighted by inverse square distance, the same weighting CsWarp uses
// for linework and guarded the same way against a query point sitting
// exactly on a station.

var CsDrape = {};

/** Guards 1/distSq against a literal divide by zero. Squared drawing
 *  units, matching CsWarp.MIN_DIST_SQ's reasoning. */
CsDrape.MIN_DIST_SQ = 1e-9;

/** Past this from every station, the drape goes FLAT. There is no trend
 *  to follow beyond the survey, and a plane is an honest answer where a
 *  guessed slope is not. Drawing units. */
CsDrape.REACH = 200;

/**
 * The elevation to drape a plan point at.
 *
 * \return z, or null when there are no stations to sample
 */
CsDrape.elevationAt = function(point, stations) {
    var sumW = 0, sumZ = 0;
    var nearest = null, nearestD2 = Infinity;
    for (var name in stations) {
        if (!stations.hasOwnProperty(name)) { continue; }
        var st = stations[name];
        if (typeof st.z !== "number" || !isFinite(st.z)) { continue; }
        var dx = point.x - st.x, dy = point.y - st.y;
        var d2 = dx * dx + dy * dy;
        if (d2 < nearestD2) { nearestD2 = d2; nearest = st; }
        if (d2 > CsDrape.REACH * CsDrape.REACH) { continue; }
        var w = 1.0 / Math.max(d2, CsDrape.MIN_DIST_SQ);
        sumW += w;
        sumZ += w * st.z;
    }
    if (sumW > 0) {
        return sumZ / sumW;
    }
    // Nothing within reach: the nearest station's own elevation, flat.
    return (nearest === null) ? null : nearest.z;
};

/**
 * A scan's quad as a draped grid.
 *
 * \param quad {origin, u, v} -- u and v span the WHOLE image
 * \return {positions, uvs, indices}
 */
CsDrape.grid = function(quad, divisions, stations) {
    var out = { positions: [], uvs: [], indices: [] };
    var n = Math.max(1, Math.floor(divisions));
    for (var j = 0; j <= n; j++) {
        for (var i = 0; i <= n; i++) {
            var s = i / n, t = j / n;
            var x = quad.origin.x + quad.u.x * s + quad.v.x * t;
            var y = quad.origin.y + quad.u.y * s + quad.v.y * t;
            var z = CsDrape.elevationAt({ x: x, y: y }, stations);
            if (z === null) { return { positions: [], uvs: [], indices: [] }; }
            out.positions.push(x, y, z);
            out.uvs.push(s, 1 - t);
        }
    }
    for (var jj = 0; jj < n; jj++) {
        for (var ii = 0; ii < n; ii++) {
            var a = jj * (n + 1) + ii;
            var b = a + 1;
            var c = a + (n + 1);
            var d = c + 1;
            out.indices.push(a, b, d, a, d, c);
        }
    }
    return out;
};
```

Add to `CsAll.js` after `CsWarp.js`.

- [ ] **Step 4: Run, expect pass. Step 5: Commit**

```bash
git commit -m "feat: the elevation to lay a sketch at"
```

---

### Task 2: CsDrape — reading scans out of a drawing

**Goal:** Find plan scan images, resolve their files, and give back their quads.

**Files:** Modify `scripts/CaveSurvey/Core/CsDrape.js`; create `tests/cave3d_drape_run.js`

**Acceptance Criteria:**
- [ ] `CsDrape.readScans(doc, kind)` returns `[{path, quad, widthPx, heightPx}]`
- [ ] Only images on the layer `CsScanFrame.layerFor(kind)` are returned
- [ ] The path comes from XDATA `SketchScan`, resolved by `CsCave.resolveUnderScans`
- [ ] Pixel size comes from the image FILE, since the entity reports zero
- [ ] A scan whose file is missing is skipped, not drawn blank
- [ ] Never throws

**Verify:** `CaveCAD -no-gui -autostart tests/cave3d_drape_run.js "$PWD"` → `### CAVE3D DRAPE OK`

**Steps:**

- [ ] **Step 1: The QCAD half**

```js
// =====================================================================
// QCAD context below this line.
// =====================================================================

/** The XDATA key a scan's path is stored under, relative to scans/. */
CsDrape.PATH_TAG = "SketchScan";

/**
 * Every scan of one kind, with its file and its quad.
 *
 * THE ENTITY DOES NOT KNOW ITS OWN FILE. Probed against Truitt's 28
 * plan scans: getFileName() is EMPTY and getWidth()/getHeight() are
 * ZERO, through both the method and the property route. The path is in
 * XDATA, relative to the cave's scans folder; the pixel size has to come
 * from the file.
 */
CsDrape.readScans = function(doc, kind) {
    var out = [];
    if (isNull(doc)) { return out; }
    var layerName = CsScanFrame.layerFor(kind);
    var scans = CsCave.scansDir(doc.getFileName());
    var ids;
    try { ids = doc.queryAllEntities(false, true); } catch (e) { return out; }
    for (var i = 0; i < ids.length; i++) {
        try {
            var e = doc.queryEntity(ids[i]);
            if (isNull(e) || e.getType() !== RS.EntityImage) { continue; }
            if (String(doc.getLayerName(e.getLayerId())) !== layerName) {
                continue;
            }
            var stored = CsTags.get(e, CsDrape.PATH_TAG);
            if (stored === "") { continue; }
            var path = CsCave.resolveUnderScans(scans, stored);
            if (path === null || !(new QFileInfo(path)).exists()) {
                // A scan whose file is gone is skipped: a blank quad
                // hanging over the passage says something false.
                continue;
            }
            var img = new QImage(path);
            if (img.isNull()) { continue; }
            var wpx = img.width(), hpx = img.height();
            var ip = e.getInsertionPoint();
            var u = e.getUVector();
            var v = e.getVVector();
            out.push({
                path: path,
                widthPx: wpx,
                heightPx: hpx,
                // u and v are PER PIXEL; the quad spans the whole image.
                quad: { origin: { x: ip.x, y: ip.y },
                        u: { x: u.x * wpx, y: u.y * wpx },
                        v: { x: v.x * hpx, y: v.y * hpx } }
            });
        } catch (eRead) {
            continue;
        }
    }
    return out;
};
```

- [ ] **Step 2: The document test** — modelled on `tests/cave3d_sections_run.js`'s preamble (its CsAll auto-loader, its `check`). Build a document, add an image on `CTRL-SCAN` with a `SketchScan` tag pointing at a real file written to a temp scans folder, and assert it reads back with the right pixel size and quad. Assert a missing file is skipped.

- [ ] **Step 3: Add a stage to `tests/run_all.sh`**, renumbering as the sections stage did.

- [ ] **Step 4: Commit**

---

### Task 3: The texture pipeline in C++

**Goal:** Upload an image as a GL texture and draw textured triangles with the paper keyed out.

**Files:** Create `src/gui/RCave3dTexture.{h,cpp}`; modify `RCave3dView.{h,cpp}`, `src/gui/CMakeLists.txt`

**Acceptance Criteria:**
- [ ] `setScans(positions, uvs, indices, imagePaths, runs)` uploads one texture per scan
- [ ] Images are downscaled so the long edge is at most `MAX_TEXTURE_PX`
- [ ] The fragment shader discards a fragment whose luminance exceeds `INK_MAX`
- [ ] Blending on, depth-WRITE off for the scan pass, drawn after the geometry
- [ ] Textures are rebuilt when the GL context is remade — a dock does that on every float
- [ ] `ninja -j20` clean in BOTH trees

**Verify:** build both trees

**Steps:**

- [ ] **Step 1:** `RCave3dTexture` owns a `QOpenGLTexture` built from a `QImage`, downscaled with `QImage::scaled` when its long edge exceeds the cap, and is destroyed with the context.

- [ ] **Step 2:** A second shader program:

```glsl
varying highp vec2 vUv;
uniform sampler2D uTex;
uniform highp float uInkMax;
void main() {
    lowp vec4 c = texture2D(uTex, vUv);
    // PAPER IS NOT INK. A scan is mostly white page; drawn opaque it is
    // a wall in front of the cave. Only what the pencil darkened
    // survives.
    highp float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
    if (lum > uInkMax) { discard; }
    gl_FragColor = vec4(c.rgb, 1.0);
}
```

- [ ] **Step 3:** Draw after the geometry with `glEnable(GL_BLEND)` and `glDepthMask(GL_FALSE)`, restoring both after, so overlapping sketches do not z-fight.

- [ ] **Step 4:** Rebuild textures in `initializeGL`, which already drops and recreates the shader programs for the same reason.

- [ ] **Step 5:** Build both trees. Commit.

---

### Task 4: Wire the plan drape through

**Goal:** `Plan scans` toggle showing draped sketches on the passage.

**Files:** `RCave3dBridge.{h,cpp}`, `RCave3dPanel.{h,cpp}`, `scripts/CaveSurvey/Cave3D/Cave3D.js`

**Acceptance Criteria:**
- [ ] `Cave3D.scansBuffer(doc, resolved, "plan")` returns `{positions, uvs, indices, paths, runs}`
- [ ] `runs` says how many indices belong to each scan, so each draws with its own texture
- [ ] `cave3d.setShowPlanScans(handle, on)` works and persists
- [ ] The toggle greys itself when the drawing holds no plan scans
- [ ] BOTH trees build

**Verify:** live on Truitt — 28 plan scans

**Steps:** Mirror the sections wiring exactly: buffer built in `Cave3D.js`, carried on the mesh object, unpacked in `setMesh`, one toggle on row two, persisted through `RSettings` under `Cave3D/ShowPlanScans`. Commit.

---

### Task 5: Verify the plan drape live, release 0.9.124.0

**Acceptance Criteria:**
- [ ] `bash tests/run_all.sh` → `ALL TESTS PASSED`
- [ ] Truitt's plan scans lie over the passage they were drawn of
- [ ] Paper keys out; pencil survives
- [ ] Floating and re-docking the panel does not lose the textures
- [ ] `VERSION` → `0.9.124.0`, `cavecad-src/VERSION` → `0.6.0.0`

---

### Task 6: CsDrape — the profile inverse mapping

**Goal:** Turn a band-local point into a real 3D position.

**Files:** Modify `scripts/CaveSurvey/Core/CsDrape.js`, `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `CsDrape.alongBand(band, x)` returns `{from, to, t}` for the leg spanning that x
- [ ] At a leg boundary it picks one leg, deterministically, not both
- [ ] Past either end it CLAMPS to the end leg rather than extrapolating
- [ ] `CsDrape.bandPointTo3d(band, resolved, x, y)` returns `{x, y, z}` with z taken straight from the band's y — no exaggeration to undo
- [ ] A band with no legs returns null rather than NaN

**Verify:** engine suite

**Steps:** `unrollBand` returns `legs: [{from, to, fromX, fromY, toX, toY}]`; find the leg whose `fromX..toX` contains x, `t = (x - fromX) / (toX - fromX)`, then lerp `resolved.stations[from]` to `[to]`. Tests build a real band through `CsProfile.unrollBand` rather than hand-writing one — the lesson from the section axis swap, where a hand-made fixture agreed with the bug.

---

### Task 7: Profile strips, verify live, release 0.9.125.0

**Goal:** Profile scans draped along the centerline, one strip per leg.

**Acceptance Criteria:**
- [ ] `CsDrape.profileStrips(scan, band, resolved)` returns one quad per leg the scan spans
- [ ] Each strip's uv range is the fraction of the scan that leg covers
- [ ] `CsProfileBox.at` picks the band a scan sits in; a scan in no band is skipped
- [ ] A profile scan follows the passage round a bend rather than cutting the corner
- [ ] Truitt's 17 profile scans render
- [ ] `VERSION` → `0.9.125.0`

**Steps:** For each leg the scan's x range overlaps, emit a quad standing on that leg: its two verticals at the leg's endpoints, its height from the scan's own y range mapped through `bandPointTo3d`. Strips because the interpolation is linear only within a leg — one quad across a bend cuts the corner. Verify live, record As-built, release.
