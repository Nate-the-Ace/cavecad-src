# Aerial Basemap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Cave Survey tool that fetches USGS NAIP aerial imagery for the survey's ground extent and places it under the linework, georeferenced from the drawing's entrance anchor.

**Architecture:** All projection and request math goes into a new pure-JS Core file `Core/CsGeoProject.js` so `tests/js_unit.js` can test it in both engines; the tool file `AerialBasemap/AerialBasemap.js` is a thin one-shot `EAction` that touches the document, the dialogs and `QProcess` only. Imagery is requested in EPSG:3857 Web Mercator (square ground pixels), fetched with `curl` via `QProcess`, and inserted as an `RImageEntity` on a new `CTRL-AERIAL` layer, tagged so a re-run replaces rather than stacks.

**Tech Stack:** QCAD/CaveCAD ECMAScript add-on API (`EAction`, `RImageEntity`, `RImageData`, `RVector`), Qt bridge (`QProcess`, `QFileInfo`, `QImage`), USGS NAIP ArcGIS ImageServer `exportImage` REST endpoint, `curl`, Python `unittest` for structural tests.

**Spec:** `docs/superpowers/specs/2026-08-20-aerial-basemap-design.md`

**Branch:** `v2` of `~/Documents/github/cavecad-tools` (note: that branch already carries unrelated uncommitted edits to `Declination.js`, `GeoReference.js` and a plan `.tasks.json` — leave them alone and never `git add -A`; every commit below stages explicit paths).

**User decisions (already made):**
- Imagery source is USGS NAIP, not Google Earth or Esri World Imagery (Google has no lawful programmatic export; NAIP is public domain, keyless, no attribution obligation).
- Extent is computed automatically from the survey plus a margin, not asked for and not preset.
- With no georeference anchor present, the tool acquires one in place rather than refusing.
- Every cave entrance is station **A1**, so A1 is the default anchor target and no selection step is needed.

**Verified live before planning (do not re-litigate):**
- NAIP `exportImage` returns PNG; `maxImageWidth`/`maxImageHeight` = 4000; native pixel 0.3 m; service SR is EPSG:3857.
- `QProcess` + `/usr/bin/curl -o` works inside CaveCAD's headless engine: `waitForFinished` true, `exitCode` 0, 395 781-byte PNG, `QImage` 600×600 non-null.
- `RImageData`, `RImageEntity`, `QFileInfo`, `QImage` are all available in that engine.
- The bridge stringifies `readAllStandardOutput()` as `"QByteArray [JS]"`, so diagnostics must use exit codes and file checks, not curl stdout.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/CaveSurvey/Core/CsGeoProject.js` | **New.** Pure math: Mercator conversion, ground extent, Mercator bbox, pixel sizing, drawing scale, NAIP URL, coverage extent. No document, no GUI, no network. |
| `scripts/CaveSurvey/Core/CsAll.js` | Modified. Include the new Core file in dependency order. |
| `scripts/CaveSurvey/Core/CsLayers.js` | Modified. Add `CsLayers.AERIAL = "CTRL-AERIAL"` and its `DEFAULTS` row. |
| `templates/NSS_Cave_Template_PLAN.dxf` | Modified. Add the `CTRL-AERIAL` layer, or the registry-vs-template structural test fails. |
| `tests/js_unit.js` | Modified. Load `CsGeoProject.js`; add the assertion block. |
| `scripts/CaveSurvey/AerialBasemap/AerialBasemap.js` | **New.** The tool: anchor resolution, extent from the document, fetch via `QProcess`, image insert, replace-on-rerun, all user-facing messages. |
| `scripts/CaveSurvey/AerialBasemap/AerialBasemap.svg` | **New.** Toolbar/menu icon (required by the publish checks). |

Task order follows the dependency chain: Core math and its tests first (Task 1), then the layer plumbing (Task 2), then the tool (Task 3), then the icon and publish gate (Task 4), then live GUI verification (Task 5).

---

### Task 1: Core projection math (`CsGeoProject`) with unit tests

**Goal:** A pure-JS Core library that converts between lat/lon and Web Mercator, sizes the request, and builds the NAIP URL — fully covered by `js_unit.js` in both engines.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsGeoProject.js`
- Modify: `scripts/CaveSurvey/Core/CsAll.js` (include list)
- Modify: `tests/js_unit.js` (`CORE_FILES` array, plus a new assertion block)

**Acceptance Criteria:**
- [ ] `CsGeoProject.toMercator` / `fromMercator` round-trip to within 1e-6 degrees
- [ ] `toMercator(0, 0)` is `{x: 0, y: 0}`; `toMercator(0, 180).x` is ~20037508.34
- [ ] Requested pixel aspect matches the Mercator bbox aspect to within 1 part in 100 (the squareness invariant)
- [ ] `pixelSize` never exceeds 4000 or falls below 256 on either axis
- [ ] `groundExtent` applies the 150 m floor for a degenerate (single-station) extent
- [ ] `groundExtent` converts a feet-unit drawing correctly (100 ft → 30.48 m before margin)
- [ ] `naipUrl` contains `bboxSR=3857`, `imageSR=3857`, `format=png`, `f=image`
- [ ] `insideCoverage` returns false for a European coordinate, true for an Indiana one
- [ ] `js_unit.js` passes under both node and CaveCAD, assertion count higher than before

**Verify:** `node tests/js_unit.js` → `### UNIT OK <n> assertions` where `<n>` exceeds the pre-change count; then `./tests/run_all.sh` → `ALL TESTS PASSED`

**Steps:**

- [ ] **Step 1: Record the current assertion count** (so the increase is provable, not assumed)

```bash
cd ~/Documents/github/cavecad-tools
node tests/js_unit.js | tail -1
```

Expected: a line like `### UNIT OK 429 assertions`. Note the number.

- [ ] **Step 2: Write the failing tests**

Add to `tests/js_unit.js`. Insert the new Core file into the `CORE_FILES` array first — it depends only on `CsUnits`, so it goes immediately after `"scripts/CaveSurvey/Core/CsUnits.js"`:

```js
var CORE_FILES = [
    "scripts/CaveSurvey/Core/CsUnits.js",
    "scripts/CaveSurvey/Core/CsGeoProject.js",
    "scripts/CaveSurvey/Core/CsAngles.js",
```

Then append this block just before the `// Report.` divider near the end of the file:

```js
// ---------------------------------------------------------------------
// CsGeoProject -- projection and request math for the aerial basemap.
// ---------------------------------------------------------------------
{
    // Mercator anchors. The equator maps to y=0; 180 degrees of
    // longitude is half the Mercator world width.
    var m0 = CsGeoProject.toMercator(0, 0);
    near(m0.x, 0, 1e-6, "mercator: lon 0 -> x 0");
    near(m0.y, 0, 1e-6, "mercator: lat 0 -> y 0");
    near(CsGeoProject.toMercator(0, 180).x, 20037508.342789244, 1e-3,
        "mercator: lon 180 -> half world width");

    // Round-trip through both directions, at a cave-country latitude.
    var rt = CsGeoProject.fromMercator(
        CsGeoProject.toMercator(40.5042, -90.2583).x,
        CsGeoProject.toMercator(40.5042, -90.2583).y);
    near(rt.lat, 40.5042, 1e-6, "mercator round-trip: latitude");
    near(rt.lon, -90.2583, 1e-6, "mercator round-trip: longitude");

    // Ground extent: a 100 ft square drawing is 30.48 m before margin,
    // and a 25% margin makes it 38.1 m.
    var extFt = CsGeoProject.groundExtent(
        { width: 100, height: 100 }, CsUnits.FEET, 0.25, 10);
    near(extFt.width, 38.1, 1e-6, "groundExtent: feet converted + margin");
    near(extFt.height, 38.1, 1e-6, "groundExtent: feet height");

    // A metre drawing needs no conversion.
    var extM = CsGeoProject.groundExtent(
        { width: 400, height: 200 }, CsUnits.METERS, 0.25, 150);
    near(extM.width, 500, 1e-6, "groundExtent: metres + margin");
    near(extM.height, 250, 1e-6, "groundExtent: metres height");

    // Degenerate extent (a single station) floors, per axis.
    var extFloor = CsGeoProject.groundExtent(
        { width: 0, height: 0 }, CsUnits.METERS, 0.25, 150);
    near(extFloor.width, 150, 1e-6, "groundExtent: degenerate floors width");
    near(extFloor.height, 150, 1e-6, "groundExtent: degenerate floors height");

    // THE SQUARENESS INVARIANT. A lat/lon request stretches the image
    // because a degree of longitude is shorter than a degree of
    // latitude; working in Mercator and matching the pixel aspect to
    // the bbox aspect keeps ground pixels square. This is the assertion
    // that would have caught the original 4326 design.
    var bbox = CsGeoProject.mercatorBbox(40.5042, -90.2583,
        { width: 800, height: 400 }, { x: 0, y: 0 });
    var size = CsGeoProject.pixelSize(bbox, 0.3, 4000, 256);
    var bboxAspect = (bbox.xmax - bbox.xmin) / (bbox.ymax - bbox.ymin);
    var pixAspect = size.w / size.h;
    near(pixAspect / bboxAspect, 1.0, 0.01,
        "pixelSize: pixel aspect matches bbox aspect (square ground pixels)");
    near(bboxAspect, 2.0, 1e-6, "mercatorBbox: 800x400 ground is 2:1 in Mercator");

    // Mercator inflates ground distance by 1/cos(lat), so the bbox is
    // WIDER in Mercator metres than the ground extent it represents.
    var mercWidth = bbox.xmax - bbox.xmin;
    ok(mercWidth > 800, "mercatorBbox: Mercator metres exceed ground metres");
    near(mercWidth * Math.cos(40.5042 * Math.PI / 180), 800, 1.0,
        "mercatorBbox: de-inflating by cos(lat) recovers ground width");

    // Resolution clamps. A tiny extent must not ask for fewer than the
    // floor; a huge one must not exceed the service's 4000 limit.
    var tiny = CsGeoProject.pixelSize(
        CsGeoProject.mercatorBbox(40.5042, -90.2583,
            { width: 10, height: 10 }, { x: 0, y: 0 }), 0.3, 4000, 256);
    ok(tiny.w >= 256 && tiny.h >= 256, "pixelSize: floors at 256 px");
    var huge = CsGeoProject.pixelSize(
        CsGeoProject.mercatorBbox(40.5042, -90.2583,
            { width: 50000, height: 50000 }, { x: 0, y: 0 }), 0.3, 4000, 256);
    ok(huge.w <= 4000 && huge.h <= 4000, "pixelSize: clamps at the 4000 px service limit");

    // Drawing scale: units per pixel, in the drawing's own units.
    var uppM = CsGeoProject.drawingUnitsPerPixel(bbox, size.w, 40.5042,
        CsUnits.METERS);
    near(uppM * size.w, 800, 1.0, "drawingUnitsPerPixel: metres span the ground width");
    var uppFt = CsGeoProject.drawingUnitsPerPixel(bbox, size.w, 40.5042,
        CsUnits.FEET);
    near(uppFt / uppM, CsUnits.FEET_PER_METER, 1e-6,
        "drawingUnitsPerPixel: feet drawing scales by feet-per-metre");

    // The anchor offset shifts the window without resizing it.
    var off = CsGeoProject.mercatorBbox(40.5042, -90.2583,
        { width: 800, height: 400 }, { x: 100, y: -50 });
    near((off.xmax - off.xmin), (bbox.xmax - bbox.xmin), 1e-6,
        "mercatorBbox: offset preserves width");
    ok(off.xmin > bbox.xmin, "mercatorBbox: positive x offset moves the window east");
    ok(off.ymin < bbox.ymin, "mercatorBbox: negative y offset moves the window south");

    // URL construction.
    var url = CsGeoProject.naipUrl(bbox, size);
    ok(url.indexOf("bboxSR=3857") >= 0, "naipUrl: bbox spatial reference");
    ok(url.indexOf("imageSR=3857") >= 0, "naipUrl: image spatial reference");
    ok(url.indexOf("format=png") >= 0, "naipUrl: PNG format");
    ok(url.indexOf("f=image") >= 0, "naipUrl: image response");
    ok(url.indexOf("USGSNAIPImagery") >= 0, "naipUrl: NAIP service");
    ok(url.indexOf("size=" + size.w + "," + size.h) >= 0, "naipUrl: requested size");
    ok(url.indexOf(" ") < 0, "naipUrl: no unescaped spaces");

    // Coverage. NAIP is US-only; a European request must be refused
    // before it wastes a round trip.
    ok(CsGeoProject.insideCoverage(
        CsGeoProject.mercatorBbox(40.5042, -90.2583,
            { width: 800, height: 400 }, { x: 0, y: 0 })) === true,
        "insideCoverage: Indiana is inside NAIP");
    ok(CsGeoProject.insideCoverage(
        CsGeoProject.mercatorBbox(47.5, 11.0,
            { width: 800, height: 400 }, { x: 0, y: 0 })) === false,
        "insideCoverage: the Alps are outside NAIP");
}
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
node tests/js_unit.js 2>&1 | tail -5
```

Expected: failure — `CsGeoProject is not defined` (thrown while loading `CORE_FILES`, before the assertion block runs). That is the correct red state.

- [ ] **Step 4: Write the implementation**

Create `scripts/CaveSurvey/Core/CsGeoProject.js`:

```js
// CsGeoProject.js -- projection and imagery-request math.
//
// Part of the Cave Survey Core library: pure ECMAScript, no document,
// no GUI, no network, so the headless harness can test all of it.
//
// WHY WEB MERCATOR. The obvious way to ask an ArcGIS ImageServer for a
// picture is to hand it a lat/lon bbox (EPSG:4326). That produces a
// STRETCHED image: a degree of longitude is cos(latitude) shorter than
// a degree of latitude, so ground metres per pixel differ between the
// axes. Measured against USGS NAIP at latitude 39.16: 1.08 m/px across
// versus 1.39 m/px down. A CAD image entity carries one uniform scale,
// so such an image can never be placed correctly. Working in EPSG:3857
// throughout -- and matching the requested pixel aspect to the bbox
// aspect -- keeps ground pixels square, at the cost of one cos(lat)
// factor when converting between ground metres and Mercator metres.
//
// Mercator inflates distance by 1/cos(lat). Over a cave-sized area that
// factor is effectively constant, so a single anchor latitude is enough.
//
// The 'Cs' prefix is mandatory: CaveCAD's include() dedupes by
// basename, and the global must match the file name.

include(includeBasePath + "/CsUnits.js");

function CsGeoProject() {}

// Semi-major axis of the WGS84 ellipsoid, which spherical Web Mercator
// uses as the sphere radius.
CsGeoProject.EARTH_RADIUS = 6378137.0;

// Half the Mercator world, i.e. toMercator(0, 180).x.
CsGeoProject.WORLD_HALF = Math.PI * CsGeoProject.EARTH_RADIUS;

// The USGS NAIP ImageServer's own reported extent, in EPSG:3857
// (from the service's ?f=json, 2026-08-20). Used to refuse a request
// before it costs a round trip.
CsGeoProject.NAIP_EXTENT_3857 = {
    xmin: -13896162.899973024,
    ymin: 2812730.7000011485,
    xmax: -7441890.599985033,
    ymax: 6372359.699994525
};

CsGeoProject.NAIP_URL =
    "https://imagery.nationalmap.gov/arcgis/rest/services/" +
    "USGSNAIPImagery/ImageServer/exportImage";

// Native NAIP resolution in metres per pixel, and the service's
// documented maximum image dimension.
CsGeoProject.NATIVE_RES_M = 0.3;
CsGeoProject.MAX_PX = 4000;
CsGeoProject.MIN_PX = 256;

// Fraction added around the survey's own extent.
CsGeoProject.MARGIN = 0.25;

// Smallest sensible window, in metres, for a drawing with one station
// or no extent at all.
CsGeoProject.FLOOR_M = 150;

/**
 * Latitude/longitude in degrees -> EPSG:3857 metres.
 */
CsGeoProject.toMercator = function(lat, lon) {
    var x = CsGeoProject.EARTH_RADIUS * (lon * Math.PI / 180.0);
    var latRad = lat * Math.PI / 180.0;
    var y = CsGeoProject.EARTH_RADIUS *
        Math.log(Math.tan(Math.PI / 4.0 + latRad / 2.0));
    return { x: x, y: y };
};

/**
 * EPSG:3857 metres -> latitude/longitude in degrees.
 */
CsGeoProject.fromMercator = function(x, y) {
    var lon = (x / CsGeoProject.EARTH_RADIUS) * 180.0 / Math.PI;
    var lat = (2.0 * Math.atan(Math.exp(y / CsGeoProject.EARTH_RADIUS)) -
        Math.PI / 2.0) * 180.0 / Math.PI;
    return { lat: lat, lon: lon };
};

/**
 * The ground window to fetch, in metres.
 *
 * \param drawingBox {width, height} in the drawing's own units.
 * \param unitName   CsUnits.FEET or CsUnits.METERS.
 * \param marginFrac fraction to add around the survey (0.25 = 25%).
 * \param floorM     smallest window per axis, in metres.
 */
CsGeoProject.groundExtent = function(drawingBox, unitName, marginFrac, floorM) {
    if (marginFrac === undefined || marginFrac === null) {
        marginFrac = CsGeoProject.MARGIN;
    }
    if (floorM === undefined || floorM === null) {
        floorM = CsGeoProject.FLOOR_M;
    }
    var w = CsUnits.convert(Math.abs(drawingBox.width), unitName,
        CsUnits.METERS) * (1.0 + marginFrac);
    var h = CsUnits.convert(Math.abs(drawingBox.height), unitName,
        CsUnits.METERS) * (1.0 + marginFrac);
    return {
        width: Math.max(w, floorM),
        height: Math.max(h, floorM)
    };
};

/**
 * The request bbox in EPSG:3857, centred on the anchor and then shifted
 * by anchorOffsetM.
 *
 * \param groundExtent {width, height} in ground metres.
 * \param anchorOffsetM {x, y} ground metres from the anchor to the
 *        centre of the window (the survey rarely centres on its
 *        entrance). East and north positive.
 */
CsGeoProject.mercatorBbox = function(anchorLat, anchorLon, groundExtent,
                                    anchorOffsetM) {
    if (anchorOffsetM === undefined || anchorOffsetM === null) {
        anchorOffsetM = { x: 0, y: 0 };
    }
    // Mercator stretches ground distance by 1/cos(lat).
    var inflate = 1.0 / Math.cos(anchorLat * Math.PI / 180.0);
    var center = CsGeoProject.toMercator(anchorLat, anchorLon);
    var cx = center.x + anchorOffsetM.x * inflate;
    var cy = center.y + anchorOffsetM.y * inflate;
    var halfW = (groundExtent.width * inflate) / 2.0;
    var halfH = (groundExtent.height * inflate) / 2.0;
    return {
        xmin: cx - halfW,
        ymin: cy - halfH,
        xmax: cx + halfW,
        ymax: cy + halfH
    };
};

/**
 * Pixel dimensions for a bbox: native resolution where it fits, capped
 * at the service limit, floored so a tiny window still yields a usable
 * picture. Aspect always matches the bbox, which is what keeps ground
 * pixels square.
 */
CsGeoProject.pixelSize = function(bbox, nativeResM, maxPx, minPx) {
    if (nativeResM === undefined || nativeResM === null) {
        nativeResM = CsGeoProject.NATIVE_RES_M;
    }
    if (maxPx === undefined || maxPx === null) {
        maxPx = CsGeoProject.MAX_PX;
    }
    if (minPx === undefined || minPx === null) {
        minPx = CsGeoProject.MIN_PX;
    }
    var mw = bbox.xmax - bbox.xmin;
    var mh = bbox.ymax - bbox.ymin;
    var aspect = mw / mh;

    var w = Math.round(mw / nativeResM);
    var h = Math.round(mh / nativeResM);

    // Scale down to the cap, preserving aspect.
    var over = Math.max(w / maxPx, h / maxPx);
    if (over > 1.0) {
        w = Math.round(w / over);
        h = Math.round(h / over);
    }
    // Scale up to the floor, preserving aspect.
    var under = Math.max(minPx / Math.max(w, 1), minPx / Math.max(h, 1));
    if (under > 1.0) {
        w = Math.round(w * under);
        h = Math.round(h * under);
    }
    // Re-impose the aspect after rounding, on the longer axis, so the
    // squareness invariant survives integer pixels.
    if (aspect >= 1.0) {
        w = Math.max(minPx, Math.min(maxPx, Math.round(h * aspect)));
    } else {
        h = Math.max(minPx, Math.min(maxPx, Math.round(w / aspect)));
    }
    return { w: w, h: h };
};

/**
 * Drawing units per image pixel, i.e. the image entity's scale.
 *
 * The bbox is in Mercator metres, so multiplying by cos(lat) brings it
 * back to ground metres before the unit conversion.
 */
CsGeoProject.drawingUnitsPerPixel = function(bbox, pixelW, anchorLat, unitName) {
    var mercPerPx = (bbox.xmax - bbox.xmin) / pixelW;
    var groundPerPx = mercPerPx * Math.cos(anchorLat * Math.PI / 180.0);
    return CsUnits.convert(groundPerPx, CsUnits.METERS, unitName);
};

/**
 * True when the whole bbox falls inside NAIP's published coverage.
 */
CsGeoProject.insideCoverage = function(bbox) {
    var e = CsGeoProject.NAIP_EXTENT_3857;
    return bbox.xmin >= e.xmin && bbox.xmax <= e.xmax &&
        bbox.ymin >= e.ymin && bbox.ymax <= e.ymax;
};

/**
 * The exportImage request for a bbox and pixel size.
 */
CsGeoProject.naipUrl = function(bbox, size) {
    return CsGeoProject.NAIP_URL +
        "?bbox=" + bbox.xmin.toFixed(3) + "," + bbox.ymin.toFixed(3) + "," +
        bbox.xmax.toFixed(3) + "," + bbox.ymax.toFixed(3) +
        "&bboxSR=3857" +
        "&imageSR=3857" +
        "&size=" + size.w + "," + size.h +
        "&format=png" +
        "&f=image";
};
```

- [ ] **Step 5: Add it to the Core include list**

In `scripts/CaveSurvey/Core/CsAll.js`, add the include immediately after `CsUnits.js` (its only dependency):

```js
include(includeBasePath + "/CsUnits.js");
include(includeBasePath + "/CsGeoProject.js");
include(includeBasePath + "/CsAngles.js");
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
node tests/js_unit.js | tail -1
```

Expected: `### UNIT OK <n> assertions`, with `<n>` about 30 higher than the number recorded in Step 1.

Then the authoritative engine plus the structural suite:

```bash
./tests/run_all.sh
```

Expected: `ALL TESTS PASSED (publish checks not run; use --publish)`

- [ ] **Step 7: Commit**

```bash
git add scripts/CaveSurvey/Core/CsGeoProject.js scripts/CaveSurvey/Core/CsAll.js tests/js_unit.js
git commit -m "feat: CsGeoProject -- Web Mercator projection and NAIP request math"
```

---

### Task 2: `CTRL-AERIAL` layer in the registry and the PLAN template

**Goal:** The layer the basemap lives on exists in the registry, has sane defaults, is created by `ensureSurveyLayers`, and is present in the plan template so the registry-vs-template structural test stays green.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsLayers.js` (constant, `DEFAULTS` row, `ensureSurveyLayers`)
- Modify: `templates/NSS_Cave_Template_PLAN.dxf` (LAYER table)

**Acceptance Criteria:**
- [ ] `CsLayers.AERIAL === "CTRL-AERIAL"`
- [ ] `CsLayers.DEFAULTS["CTRL-AERIAL"]` exists and is a 3-element array
- [ ] `CTRL-AERIAL` is NOT in `CsLayers.OFF` (the basemap is meant to be visible)
- [ ] `ensureSurveyLayers` creates it
- [ ] `TestLayerVocabulary.test_registry_layers_exist_in_plan_template` passes
- [ ] The template still opens in CaveCAD without a repair warning

**Verify:** `python3 -m unittest tests.test_addon -v 2>&1 | grep -E "test_registry_layers|OK|FAILED"` → the layer test passes and the run reports `OK`

**Steps:**

- [ ] **Step 1: Confirm the structural test fails first**

Add only the registry constant, so the test has something to catch. In `scripts/CaveSurvey/Core/CsLayers.js`, after the `CsLayers.GRID` line:

```js
CsLayers.GRID = "CTRL-GRID";
CsLayers.AERIAL = "CTRL-AERIAL";
```

Then:

```bash
python3 -m unittest tests.test_addon.TestLayerVocabulary -v
```

Expected: FAIL — `layers in Core/Layers.js but not the plan template: ['CTRL-AERIAL']`. That failure is the point: it proves the test really does pin the template.

- [ ] **Step 2: Add the defaults row**

In the `CsLayers.DEFAULTS` table in the same file, alongside the other `CTRL-` rows:

```js
    "CTRL-LRUD-WALL-RIGHT": ["gray", "DASHED", "Weight000"],
    "CTRL-AERIAL": ["gray", "CONTINUOUS", "Weight000"],
```

Do not add it to `CsLayers.OFF` — unlike `CTRL-DATA` and `CTRL-HIDDEN`, this layer is supposed to plot.

- [ ] **Step 3: Make sure `ensureSurveyLayers` creates it**

Read `CsLayers.ensureSurveyLayers` (around line 151). If it iterates a list of layer names, add `CsLayers.AERIAL` to that list; if it iterates `CsLayers.DEFAULTS`, Step 2 already covered it and no edit is needed. Do not guess — open the function and match what is there.

- [ ] **Step 4: Add the layer to the plan template**

The template is a DXF; the layer must be inserted into its `LAYER` table the same way `CTRL-SPLAYS` was. Find the pattern first:

```bash
grep -n "CTRL-SPLAYS" templates/NSS_Cave_Template_PLAN.dxf | head
```

Then write a small script that clones the `CTRL-SPLAYS` layer record, renames it to `CTRL-AERIAL`, and inserts it into the same table. Use the repo's venv if it has one, since that is where `ezdxf` lives:

```bash
ls .venv/bin/python 2>/dev/null && .venv/bin/python -c "import ezdxf; print(ezdxf.__version__)"
```

If `ezdxf` is available, prefer it (it rewrites a valid DXF rather than splicing text):

```python
import ezdxf
doc = ezdxf.readfile("templates/NSS_Cave_Template_PLAN.dxf")
if "CTRL-AERIAL" not in doc.layers:
    src = doc.layers.get("CTRL-SPLAYS")
    lay = doc.layers.new("CTRL-AERIAL")
    lay.dxf.color = src.dxf.color
    lay.dxf.linetype = src.dxf.linetype
    if src.dxf.hasattr("lineweight"):
        lay.dxf.lineweight = src.dxf.lineweight
    doc.saveas("templates/NSS_Cave_Template_PLAN.dxf")
print(sorted(l.dxf.name for l in doc.layers))
```

If `ezdxf` is not available, splice the text: copy the 10-or-so lines of the `CTRL-SPLAYS` `LAYER` record inside the `TABLE`/`ENDTAB` block, change the name field (`  2\nCTRL-SPLAYS` → `  2\nCTRL-AERIAL`), and leave the `5`/handle field unique by bumping its last hex digit to a value not already present in the file. Verify the handle is unique with `grep -c` before saving.

**Caution for any future ezdxf edit of a template** (learned here, 2026-08-20): `saveas()` overwrites `$TDCREATE` with the current time, discarding the file's true creation date. Nothing in the codebase reads it, so it was left as-is rather than rewriting the DXF a second time — but a future edit should capture `doc.header["$TDCREATE"]` before saving and write it back. `saveas()` also regenerates `$VERSIONGUID` and advances `$HANDSEED` further than the new objects require; both are harmless as long as the seed still exceeds every handle present, which is worth confirming after any such edit.

- [ ] **Step 5: Verify the test now passes and the template still loads**

```bash
python3 -m unittest tests.test_addon -v 2>&1 | tail -5
```

Expected: `OK`

```bash
grep -c "CTRL-AERIAL" templates/NSS_Cave_Template_PLAN.dxf
```

Expected: at least `1`

Then confirm CaveCAD itself still parses the template — a hand-spliced DXF that the test accepts can still upset the real importer:

```bash
/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui \
  -allow-multiple-instances -autostart /dev/stdin <<'EOF' 2>&1 | grep -v "Debug:"
var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
var imp = RFileImporterRegistry.getFileImporter(doc,
    "templates/NSS_Cave_Template_PLAN.dxf");
print("IMPORTED: " + (imp !== null && imp.importFile(
    "templates/NSS_Cave_Template_PLAN.dxf", "")));
print("HAS LAYER: " + doc.hasLayer("CTRL-AERIAL"));
EOF
```

Expected: `IMPORTED: true` and `HAS LAYER: true`. If the importer API differs in this build, fall back to opening the template in the CaveCAD GUI once and confirming `CTRL-AERIAL` appears in the layer list with no repair dialog.

- [ ] **Step 6: Commit**

```bash
git add scripts/CaveSurvey/Core/CsLayers.js templates/NSS_Cave_Template_PLAN.dxf
git commit -m "feat: CTRL-AERIAL layer for the aerial basemap"
```

---

### Task 3: The `AerialBasemap` tool

**Goal:** A working menu tool that resolves the anchor (existing georeference, else station A1, else a single selection), computes the extent, fetches the NAIP PNG, and inserts it as a correctly scaled, correctly placed, replaceable image on `CTRL-AERIAL`.

**Files:**
- Create: `scripts/CaveSurvey/AerialBasemap/AerialBasemap.js`
- Modify: `tests/js_unit.js` (assertions for the one pure helper this task adds)

**Acceptance Criteria:**
- [ ] `./tests/run_all.sh` stays green (syntax check loads the new tool file)
- [ ] The tool appears in the Cave Survey menu with command `aerialbasemap` / `ab`
- [ ] Anchor precedence is: tagged georeference → station `A1` → single selected point → refuse with an explanatory message
- [ ] A drawing with no path is refused before any fetch, telling the user to save
- [ ] A bbox outside NAIP coverage is refused before any fetch
- [ ] A failed fetch (non-zero curl exit, missing file, unreadable PNG) leaves the drawing untouched and reports one actionable line
- [ ] The inserted image is on `CTRL-AERIAL`, tagged `AerialBasemap=1`, and a second run replaces it instead of stacking
- [ ] The anchor station's drawing position lands on that station's real-world pixel

**Verify:** `./tests/run_all.sh` → `ALL TESTS PASSED`; and inside the headless engine, `AerialBasemap.imagePathFor("/tmp/Cave.dxf")` returns `/tmp/Cave-aerial.png`

**Steps:**

- [ ] **Step 1: Write the failing test for the one pure helper**

The rest of the tool is document-and-network work verified live in Task 5; the filename rule is pure, so it gets a unit test. Since `js_unit.js` cannot load a tool file, the helper lives on `CsGeoProject` with the other pure code. Append to the `CsGeoProject` block in `tests/js_unit.js`:

```js
    // The basemap PNG sits beside the drawing under a neutral name --
    // no coordinates, no cave name beyond what the DXF already carries.
    ok(CsGeoProject.imagePathFor("/tmp/Cave.dxf") === "/tmp/Cave-aerial.png",
        "imagePathFor: dxf -> -aerial.png beside it");
    ok(CsGeoProject.imagePathFor("/a/b/Deep River Cave.DXF") ===
        "/a/b/Deep River Cave-aerial.png",
        "imagePathFor: spaces and uppercase extension");
    ok(CsGeoProject.imagePathFor("") === null,
        "imagePathFor: unsaved drawing has no image path");
```

- [ ] **Step 2: Run to verify it fails**

```bash
node tests/js_unit.js 2>&1 | tail -5
```

Expected: `### UNIT FAIL` naming the three `imagePathFor` assertions.

- [ ] **Step 3: Implement the helper**

Append to `scripts/CaveSurvey/Core/CsGeoProject.js`:

```js
/**
 * Where the basemap image for a drawing belongs: beside it, under a
 * neutral name. Deliberately carries no coordinates -- see the project's
 * entrance-location rule. Returns null for an unsaved drawing, which
 * has nowhere stable to put it.
 */
CsGeoProject.imagePathFor = function(documentPath) {
    if (documentPath === undefined || documentPath === null ||
        documentPath === "") {
        return null;
    }
    var cut = documentPath.lastIndexOf(".");
    var slash = Math.max(documentPath.lastIndexOf("/"),
        documentPath.lastIndexOf("\\"));
    if (cut > slash) {
        return documentPath.substring(0, cut) + "-aerial.png";
    }
    return documentPath + "-aerial.png";
};
```

- [ ] **Step 4: Run to verify it passes**

```bash
node tests/js_unit.js | tail -1
```

Expected: `### UNIT OK <n> assertions`, three higher than Task 1's total.

- [ ] **Step 5: Write the tool**

Create `scripts/CaveSurvey/AerialBasemap/AerialBasemap.js`:

```js
// AerialBasemap.js
//
// QCAD add-on tool: fetch a USGS NAIP aerial photograph covering the
// survey and place it underneath the linework, georeferenced from the
// drawing's entrance anchor.
//
// WHY NAIP AND NOT GOOGLE EARTH. Google publishes no export or tile API
// for Earth imagery, and its terms forbid extracting imagery for
// offline reuse -- which is exactly what an image embedded in a DXF is.
// USGS NAIP is federal public domain: keyless, quota-free, no
// attribution obligation, 0.3 m native. US-only coverage, which is
// where this project's caves are.
//
// The projection and request math is in Core/CsGeoProject.js, where the
// headless harness can test it. This file is only the document work,
// the dialogs and the fetch.
//
// USAGE:
//   Cave Survey > Aerial Basemap   (or type "aerialbasemap" / "ab")
//
// The drawing must be saved (the image is written beside it). If no
// georeference anchor exists yet, the tool asks for the entrance
// coordinate and stores it on station A1 -- by project convention every
// cave entrance is A1 -- so one run does the whole job.
//
// Re-running replaces the previous basemap: the image entity is tagged,
// and a new run erases the tagged one first. Grow the survey, run
// again, get a wider photograph.

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

// Seconds allowed for the whole fetch. NAIP at 4000 px can take a
// while; the tool has nothing to do meanwhile, which is why this is a
// blocking QProcess rather than async network plumbing.
AerialBasemap_TIMEOUT_S = 60;

function aerialBasemapRun() {
    var doc = getDocument();
    var di = getDocumentInterface();
    if (doc === undefined || doc === null) {
        warning("Aerial Basemap: no active drawing document.");
        return;
    }

    // 1. The image is written beside the drawing, so the drawing needs
    //    a home first.
    var docPath = doc.getFileName();
    var imagePath = CsGeoProject.imagePathFor(docPath);
    if (imagePath === null) {
        warning("Aerial Basemap: save the drawing first.\n" +
            "The aerial photograph is written beside the drawing file, " +
            "so the drawing needs a name before it can be fetched.");
        return;
    }

    // 2. Resolve the anchor: an existing georeference wins, then the
    //    entrance convention (A1), then a single selected station.
    var anchor = AerialBasemap.findAnchor(doc);
    if (anchor === null) {
        return;                     // findAnchor already explained why
    }
    if (anchor.lat === null) {
        // A station to anchor to, but no coordinate yet -- ask, then
        // store it exactly as Geo Reference would.
        var coord = CsLocationPick.ask("Aerial Basemap", "");
        if (coord === null) {
            return;                 // cancelled
        }
        CsTags.commit(di, anchor.entity, {
            GeoLat: coord.lat,
            GeoLon: coord.lon,
            GeoStation: anchor.name !== "" ? anchor.name : "anchor"
        });
        CsLocationPick.remember(coord);
        anchor.lat = coord.lat;
        anchor.lon = coord.lon;
    }

    // 3. Ground window: the drawing's extent plus a margin, floored so
    //    a one-station drawing still gets a usable photograph.
    var unit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);
    var box = AerialBasemap.surveyBox(doc, anchor.pos);
    var extent = CsGeoProject.groundExtent(
        { width: box.width, height: box.height }, unit,
        CsGeoProject.MARGIN, CsGeoProject.FLOOR_M);

    // The survey rarely centres on its entrance, so the window is
    // offset from the anchor by however far the extent's centre is.
    var offset = {
        x: CsUnits.convert(box.centerX - anchor.pos.x, unit, CsUnits.METERS),
        y: CsUnits.convert(box.centerY - anchor.pos.y, unit, CsUnits.METERS)
    };

    var bbox = CsGeoProject.mercatorBbox(anchor.lat, anchor.lon,
        extent, offset);
    if (!CsGeoProject.insideCoverage(bbox)) {
        warning("Aerial Basemap: that location is outside USGS NAIP " +
            "coverage.\nNAIP covers the United States only.");
        return;
    }
    var size = CsGeoProject.pixelSize(bbox, CsGeoProject.NATIVE_RES_M,
        CsGeoProject.MAX_PX, CsGeoProject.MIN_PX);

    // 4. Fetch.
    var fetched = AerialBasemap.fetch(CsGeoProject.naipUrl(bbox, size),
        imagePath);
    if (fetched !== true) {
        warning("Aerial Basemap: the imagery fetch failed.\n" + fetched);
        return;
    }

    // 5. Place it, replacing any previous basemap.
    var unitsPerPixel = CsGeoProject.drawingUnitsPerPixel(bbox, size.w,
        anchor.lat, unit);
    var placed = AerialBasemap.place(doc, di, imagePath, bbox, size,
        unitsPerPixel, anchor, unit);
    if (placed !== true) {
        warning("Aerial Basemap: the photograph was downloaded to\n" +
            imagePath + "\nbut could not be placed in the drawing.\n" +
            placed);
        return;
    }

    var groundW = extent.width;
    information("Aerial Basemap: placed a " + size.w + " x " + size.h +
        " USGS NAIP photograph covering about " +
        Math.round(groundW) + " m across, anchored on station " +
        (anchor.name !== "" ? anchor.name : "the anchor point") + ".\n" +
        "Image file: " + imagePath);
}

/**
 * Resolves the anchor station and, if it already carries one, its
 * coordinate.
 *
 * Precedence: a station already carrying GeoLat/GeoLon; else the
 * station named A1 (every cave entrance in this project is A1); else a
 * single selected station point.
 *
 * \return {entity, name, pos, lat, lon} with lat/lon null when a
 *         coordinate still has to be asked for, or null when there is
 *         nothing to anchor to (a message has already been shown).
 */
AerialBasemap.findAnchor = function(doc) {
    var stations = CsTags.collectStations(doc);
    var i;

    // An existing georeference wins outright.
    for (i = 0; i < stations.length; i++) {
        var lat = CsTags.getNumber(stations[i].entity, "GeoLat");
        var lon = CsTags.getNumber(stations[i].entity, "GeoLon");
        if (lat !== null && lon !== null) {
            return {
                entity: stations[i].entity,
                name: stations[i].name,
                pos: stations[i].pos,
                lat: lat,
                lon: lon
            };
        }
    }

    // The entrance convention.
    for (i = 0; i < stations.length; i++) {
        if (stations[i].name === "A1") {
            return {
                entity: stations[i].entity,
                name: "A1",
                pos: stations[i].pos,
                lat: null,
                lon: null
            };
        }
    }

    // Last resort: whatever single station point is selected.
    var selected = CsPick.singleSelected(doc, "Aerial Basemap");
    if (selected !== null && typeof selected.getPosition === "function") {
        return {
            entity: selected,
            name: CsTags.get(selected, "Station"),
            pos: selected.getPosition(),
            lat: null,
            lon: null
        };
    }

    warning("Aerial Basemap: nothing to anchor the photograph to.\n" +
        "This tool needs either a station named A1 (the entrance, by " +
        "convention) or exactly one selected station point.");
    return null;
};

/**
 * The drawing's extent, in drawing units, as {width, height, centerX,
 * centerY}. Falls back to a zero-size box at the anchor when the
 * document has no usable extent -- groundExtent's floor then decides
 * the window.
 */
AerialBasemap.surveyBox = function(doc, anchorPos) {
    var min = null;
    var max = null;
    try {
        min = doc.getBoundingBox(true, true).getMinimum();
        max = doc.getBoundingBox(true, true).getMaximum();
    } catch (e) {
        min = null;
    }
    if (min === null || max === null || !isNumber(min.x) || !isNumber(max.x) ||
        max.x < min.x || max.y < min.y) {
        return {
            width: 0, height: 0,
            centerX: anchorPos.x, centerY: anchorPos.y
        };
    }
    return {
        width: max.x - min.x,
        height: max.y - min.y,
        centerX: (min.x + max.x) / 2.0,
        centerY: (min.y + max.y) / 2.0
    };
};

/**
 * Downloads url to path with curl, blocking.
 *
 * curl rather than QNetworkAccessManager: the async event-loop path
 * through this bridge is untested and the tool has nothing to do while
 * waiting. Note that the bridge stringifies readAllStandardOutput() as
 * "QByteArray [JS]", so the diagnosis has to come from the exit code
 * and from inspecting the file.
 *
 * \return true, or a one-line explanation of what went wrong.
 */
AerialBasemap.fetch = function(url, path) {
    var existing = new QFileInfo(path);
    if (existing.exists()) {
        QFile.remove(path);         // never leave a stale photo behind
    }

    var process = new QProcess();
    process.start("/usr/bin/curl", ["-s", "--fail",
        "--max-time", String(AerialBasemap_TIMEOUT_S), "-o", path, url]);
    if (!process.waitForFinished((AerialBasemap_TIMEOUT_S + 10) * 1000)) {
        process.kill();
        return "The download did not finish within " +
            AerialBasemap_TIMEOUT_S + " seconds. Check the network " +
            "connection and try again.";
    }
    if (process.exitCode() !== 0) {
        return "curl exited with code " + process.exitCode() +
            ". The National Map service may be down, or the network " +
            "unavailable.";
    }

    var info = new QFileInfo(path);
    if (!info.exists() || info.size() === 0) {
        return "No image was written to " + path + ".";
    }
    var image = new QImage(path);
    if (image.isNull()) {
        // A service error arrives as a JSON body with a 200 status.
        QFile.remove(path);
        return "The service returned something that is not an image " +
            "(usually an error message). Try again, or a smaller area.";
    }
    return true;
};

/**
 * Inserts the image on CTRL-AERIAL, tagged so a later run can replace
 * it, positioned so the anchor station's drawing coordinate sits on its
 * own real-world pixel.
 *
 * \return true, or a one-line explanation.
 */
AerialBasemap.place = function(doc, di, path, bbox, size, unitsPerPixel,
                              anchor, unit) {
    if (typeof RImageData === "undefined" || typeof RImageEntity === "undefined") {
        return "This build's script engine has no image support " +
            "(RImageData). The CaveCAD fork is the supported platform.";
    }

    AerialBasemap.eraseExisting(doc, di);
    CsLayers.ensure(doc, di, CsLayers.AERIAL);

    // The image's insertion point is its lower-left corner. Work out
    // where that corner falls in drawing coordinates by stepping back
    // from the anchor by the anchor's own offset within the image.
    var anchorMerc = CsGeoProject.toMercator(anchor.lat, anchor.lon);
    var pxFromLeft = (anchorMerc.x - bbox.xmin) /
        ((bbox.xmax - bbox.xmin) / size.w);
    var pxFromBottom = (anchorMerc.y - bbox.ymin) /
        ((bbox.ymax - bbox.ymin) / size.h);
    var originX = anchor.pos.x - pxFromLeft * unitsPerPixel;
    var originY = anchor.pos.y - pxFromBottom * unitsPerPixel;

    var entity;
    try {
        entity = new RImageEntity(doc, new RImageData(
            path,
            new RVector(originX, originY),
            new RVector(unitsPerPixel, 0),     // u: one pixel across
            new RVector(0, unitsPerPixel),     // v: one pixel up
            size.w, size.h, 0));
    } catch (e) {
        return "Creating the image entity failed: " + e;
    }
    entity.setLayerId(doc.getLayerId(CsLayers.AERIAL));

    var op = new RAddObjectOperation(entity, false);
    di.applyOperation(op);

    // Tagging has to follow the insert: property writes inside the same
    // transaction fail silently in this bridge (the same reason Geo
    // Reference tags an already-inserted entity).
    var added = AerialBasemap.findBasemapCandidates(doc, path);
    for (var i = 0; i < added.length; i++) {
        CsTags.commit(di, added[i], { AerialBasemap: "1" });
    }

    // Linework must read over the photograph.
    try {
        di.setCurrentLayer(CsLayers.AERIAL);
    } catch (e) {
        // not fatal -- the layer is set on the entity itself
    }
    return true;
};

/**
 * Image entities that look like our basemap: tagged, or (for one just
 * inserted, before tagging) matching the basemap path.
 */
AerialBasemap.findBasemapCandidates = function(doc, path) {
    var out = [];
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        if (typeof RImageEntity !== "undefined" &&
            !isOfType(e, RImageEntity)) {
            continue;
        }
        if (CsTags.get(e, "AerialBasemap") === "1") {
            out.push(e);
            continue;
        }
        if (path !== undefined && path !== null) {
            try {
                if (e.getData().getFileName() === path) {
                    out.push(e);
                }
            } catch (err) {
                // no file name available -- not ours
            }
        }
    }
    return out;
};

/**
 * Deletes a previous basemap so a re-run replaces rather than stacks --
 * the same pattern CsDraw.eraseStations uses for redrawn survey work.
 */
AerialBasemap.eraseExisting = function(doc, di) {
    var existing = AerialBasemap.findBasemapCandidates(doc, null);
    for (var i = 0; i < existing.length; i++) {
        var op = new RDeleteObjectOperation(existing[i].clone(), false);
        di.applyOperation(op);
    }
    return existing.length;
};

function AerialBasemap(guiAction) {
    EAction.call(this, guiAction);
}

AerialBasemap.prototype = new EAction();

AerialBasemap.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    aerialBasemapRun();
    this.terminate();
};

AerialBasemap.init = function(basePath) {
    var action = new RGuiAction(qsTr("Aerial Basemap"),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/AerialBasemap.js");
    action.setIcon(basePath + "/AerialBasemap.svg");
    action.setStatusTip(qsTr("Put an aerial photograph of the surface " +
        "underneath the survey"));
    action.setDefaultCommands(["aerialbasemap", "ab"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(52);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
```

Note the function-declaration ordering: `AerialBasemap.findAnchor` and friends are assigned before `function AerialBasemap(...)` appears in the text, which is fine because function declarations hoist — this is the same shape the other tools in the suite use.

- [ ] **Step 6: Check it against the real engine**

The syntax check in `run_all.sh` loads every tool file inside CaveCAD's own engine, which is what catches a missing global or a bad API name:

```bash
./tests/run_all.sh
```

Expected: `ALL TESTS PASSED (publish checks not run; use --publish)` — including `### SYNTAX OK`.

If the syntax stage reports an unknown symbol (`RAddObjectOperation`, `RDeleteObjectOperation`, `isOfType`, `isNumber`, `information`, `RS`), find what the suite actually uses for the same job and match it:

```bash
grep -rn "RAddObjectOperation\|RDeleteObjectOperation\|isOfType" scripts/CaveSurvey/Core/CsDraw.js | head
grep -rn "fromDrawingUnit" scripts/CaveSurvey --include=*.js | head
```

Fix by following the existing call sites rather than inventing an API.

- [ ] **Step 7: Confirm the helper behaves in the authoritative engine**

```bash
/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui \
  -allow-multiple-instances -autostart tests/js_unit.js "$PWD" 2>/dev/null | tail -1
```

Expected: `### UNIT OK <n> assertions`, matching the node run.

- [ ] **Step 8: Commit**

```bash
git add scripts/CaveSurvey/AerialBasemap/AerialBasemap.js \
        scripts/CaveSurvey/Core/CsGeoProject.js tests/js_unit.js
git commit -m "feat: Aerial Basemap tool -- NAIP imagery under the survey"
```

---

### Task 4: Icon and publish gate

**Goal:** The tool ships: it has a parseable SVG icon and a status tip, so `run_all.sh --publish` passes and the toolbar button is not blank.

**Files:**
- Create: `scripts/CaveSurvey/AerialBasemap/AerialBasemap.svg`

**Acceptance Criteria:**
- [ ] `TestPublishReadiness.test_every_tool_has_an_icon` passes
- [ ] `TestPublishReadiness.test_every_icon_is_parseable_svg` passes
- [ ] `TestPublishReadiness.test_every_tool_has_a_status_tip` passes
- [ ] `./tests/run_all.sh --publish` reports `ALL TESTS PASSED -- including publish checks`

**Steps:**

- [ ] **Step 1: Confirm the publish gate fails without an icon**

```bash
./tests/run_all.sh --publish 2>&1 | grep -A3 "test_every_tool_has_an_icon"
```

Expected: a failure naming `AerialBasemap`.

- [ ] **Step 2: Match the existing icons' conventions**

```bash
head -5 scripts/CaveSurvey/GeoReference/GeoReference.svg
```

Note the viewBox size and whether the existing icons use a stroke colour or `currentColor`, and follow it in Step 3.

- [ ] **Step 3: Draw the icon**

Create `scripts/CaveSurvey/AerialBasemap/AerialBasemap.svg` — a photograph frame with a survey line over it, which is what the tool does. Adjust the `viewBox` and colours to match what Step 2 found:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <!-- the aerial photograph -->
  <rect x="6" y="10" width="52" height="44" fill="none" stroke="#888888" stroke-width="3"/>
  <path d="M6 42 L22 28 L34 38 L44 30 L58 42" fill="none" stroke="#888888" stroke-width="2"/>
  <circle cx="46" cy="20" r="4" fill="none" stroke="#888888" stroke-width="2"/>
  <!-- the survey traverse on top of it -->
  <path d="M14 48 L26 40 L38 46 L50 36" fill="none" stroke="#cc2222" stroke-width="3"/>
  <circle cx="14" cy="48" r="3" fill="#cc2222"/>
  <circle cx="50" cy="36" r="3" fill="#cc2222"/>
</svg>
```

- [ ] **Step 4: Verify the publish gate passes**

```bash
./tests/run_all.sh --publish 2>&1 | tail -3
```

Expected: `ALL TESTS PASSED -- including publish checks`

- [ ] **Step 5: Commit**

```bash
git add scripts/CaveSurvey/AerialBasemap/AerialBasemap.svg
git commit -m "feat: Aerial Basemap toolbar icon"
```

---

### Task 5: Live GUI verification

**Goal:** Prove the tool works in the real application on a real drawing — the network fetch and the image placement are deliberately untested by the automated suite, so this is where they are checked.

**USER-ORDERED GATE — NON-SKIPPABLE.** This task was requested by the user in the current conversation. It MUST NOT be closed by walking around it, by declaring it "verified inline", or by substituting a cheaper check. Close only after every item in `acceptanceCriteria` has been re-validated independently, with output captured.

**Files:**
- Modify: none expected. Any fix this task requires belongs in `AerialBasemap.js` or `CsGeoProject.js`, with a unit test if the fault was in the math.

**Acceptance Criteria:**
- [ ] Publishing succeeds and the tool appears in CaveCAD's Cave Survey menu as "Aerial Basemap"
- [ ] Typing `ab` on the command line starts the tool
- [ ] On a saved drawing with a station A1 and no georeference, the tool asks for the coordinate, stores it, and completes without a warning dialog
- [ ] A `<drawing>-aerial.png` file appears beside the drawing and opens as a valid image
- [ ] The photograph appears under the survey linework, on layer `CTRL-AERIAL`, north-up
- [ ] Station A1 sits on its real-world position in the photograph — verified by eye against a recognisable surface feature, or by checking the distance from A1 to a second known point against the photo's scale
- [ ] Scale is right: a feature of known size on the ground (a road width, a building) measures its true size with QCAD's distance tool, within about 10%
- [ ] Running the tool a second time REPLACES the image — one image entity in the drawing afterwards, not two
- [ ] Saving and reopening the drawing keeps the image linked and placed
- [ ] With the network off, the tool reports the failure and leaves the drawing unchanged

**Verify:** publish, then run the tool in the GUI and walk the criteria above; capture the resulting screenshot and the output of the entity count check below.

**Steps:**

- [ ] **Step 1: Publish to CaveCAD**

```bash
cd ~/Documents/github/cavecad-tools && ./tools/publish.sh
```

Expected: it reports installing into CaveCAD's per-user scripts folder. If `publish.sh` runs the test suite as a gate, it must pass first.

- [ ] **Step 2: Launch CaveCAD and open a test drawing**

```bash
open ~/Applications/CaveCAD.app
```

Use a real saved survey with a station A1. If there is not one handy, make one: `New Cave Map` (`ncm`), draw a short traverse with the Survey Notebook so A1 exists, and save it somewhere inside the project.

- [ ] **Step 3: Run the tool and walk the criteria**

Menu: Cave Survey > Aerial Basemap. Paste a coordinate when asked (the browser map picker is fine). Then check each acceptance criterion above in the GUI. Note anything that looks wrong before fixing anything, so the diagnosis is not confounded.

- [ ] **Step 4: Prove the replace-on-rerun behaviour with a count, not by eye**

Run the tool a second time in the same drawing, save, then count image entities in the saved file:

```bash
/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui \
  -allow-multiple-instances -autostart /dev/stdin <<'EOF' 2>&1 | grep -v "Debug:"
var args = RSettings.getOriginalArguments();
var path = args[args.length - 1];
var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
var imp = RFileImporterRegistry.getFileImporter(doc, path);
imp.importFile(path, "");
var ids = doc.queryAllEntities(false, false);
var images = 0;
for (var i = 0; i < ids.length; i++) {
    if (isOfType(doc.queryEntity(ids[i]), RImageEntity)) {
        images++;
    }
}
print("IMAGE ENTITIES: " + images);
EOF
```

Pass this the saved drawing's path as the final argument. Expected: `IMAGE ENTITIES: 1` after two runs. If it reports 2, `eraseExisting` is not matching — check whether the tag survived the insert, and fall back to matching on the file name.

- [ ] **Step 5: Check the failure path**

Turn off networking (or temporarily point `CsGeoProject.NAIP_URL` at an unreachable host in the installed copy), run the tool, and confirm it reports the failure and inserts nothing. Restore the URL afterwards.

- [ ] **Step 6: Record the result**

Update `docs/superpowers/specs/2026-08-20-aerial-basemap-design.md` with a short "GUI-verified <date>" line stating what was checked, matching how the other tools' verification state is recorded in the project's memory notes. If anything needed fixing, commit the fix separately with its unit test.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-08-20-aerial-basemap-design.md
git commit -m "docs: record Aerial Basemap GUI verification"
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: imagery source and projection → Task 1; the `CTRL-AERIAL` layer → Task 2; the flow, anchor precedence, fetch mechanics, insertion, replace-on-rerun and the whole error table → Task 3; the icon and publish readiness → Task 4; the "GUI-verified live only" testing clause → Task 5. The spec's "out of scope" list (non-US imagery, historical vintages, 3DEP, auto-refetch, tiling) has no tasks by design.

**Placeholders.** None. Every code step carries the actual code; every verify step carries the actual command and its expected output. The two places that say "look at what exists first" (Task 2 Step 3 on `ensureSurveyLayers`, Task 3 Step 6 on unknown API symbols) are deliberate instructions to match existing call sites rather than guesses to be filled in later, and both name the exact command to run.

**Type consistency.** Checked across tasks: `CsGeoProject.toMercator/fromMercator/groundExtent/mercatorBbox/pixelSize/drawingUnitsPerPixel/insideCoverage/naipUrl/imagePathFor` are spelled identically in the tests, the implementation and the tool. `groundExtent` takes `{width, height}` and returns `{width, height}`; `mercatorBbox` returns `{xmin, ymin, xmax, ymax}`; `pixelSize` returns `{w, h}` and is consumed as `size.w`/`size.h` everywhere. `CsLayers.AERIAL`, the `AerialBasemap` custom-property key, and the `52` sort order each appear once per meaning. `findAnchor` returns `{entity, name, pos, lat, lon}` and every consumer uses exactly those fields.
