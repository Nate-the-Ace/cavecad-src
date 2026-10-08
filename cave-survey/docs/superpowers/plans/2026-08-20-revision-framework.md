# Survey Revision Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every suite-drawn drawing entirely reconstructible from its XDATA tags, and add revisions (per-trip declination fix, georeference move, shot edits via Notebook) that adjust the drawing around new information.

**Architecture:** Tag schema v3 puts shot data on leg lines (1 shot = 1 entity), per-trip metadata on trip-anchor station points, and no-geometry shots in serialized anchor tags. New Core module `CsRevise.js` reconstructs the exact model from tags, applies revisions, detects rigid changes numerically (similarity fit) to transform the whole drawing in one op, and falls back to erase+redraw with a moved-station report. Revisions surface inside the existing Declination / GeoReference / SurveyNotebook tools.

**Tech Stack:** QCAD ECMAScript (QJS bridge), pure-JS Core library, tests via `tests/js_unit.js` (node + CaveCAD `-no-gui`) and `tests/test_addon.py` (structural).

**Spec:** `docs/superpowers/specs/2026-08-20-revision-framework-design.md`

**User decisions (already made):**
- General revision framework, not declination-only.
- Per-trip sections NOW; trip identity fingerprint = `date|declination|team` (multiple teams same day stay separately revisable).
- Rigid changes transform the whole drawing (sketches ride); non-rigid changes redraw tagged geometry + report moved stations.
- Revisions live in existing tools; no new menu entry.
- Full fidelity: XDATA alone reconstructs the drawing entirely.
- Repo: `~/Documents/github/cavecad-tools`, branch `v2`. CaveCAD fork is the target platform (stock free QCAD drops XDATA on save — accepted).

**Conventions the engineer MUST follow** (violations break the suite silently):
- Every Core file is `Cs`-prefixed, defines a matching global, and lives in `scripts/CaveSurvey/Core/`. Enforced by structural test.
- Suite includes are `includeBasePath`-relative in tools; Core files include with `scripts/`-rooted paths; `tests/js_unit.js` strips include lines and loads files explicitly via its `CORE_FILES` list / `loadRepoScript`.
- Entity writes: construct, `setLayerId` + `CsTags.set` BEFORE `op.addObject(entity, false)` — the `false` is load-bearing. Never simple.js layer/property calls (silent failures in the QJS bridge).
- Tags via `CsTags.set/get` only (newline escaping lives there). `CsTags.set` skips null/""/undefined — "tag absent" is the null encoding.
- Run `./tests/run_all.sh` from repo root; unit assertions print `### UNIT OK <n> assertions`. Node-only quick loop: `node tests/js_unit.js`.

---

### Task 1: CsModel trips, fingerprint, serialization helpers

**Goal:** Model layer knows trips (records, fingerprints, match-or-append) and can serialize the round-trip text forms (Flags, StartLrud, excluded/unplaced shot rows).

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsModel.js`
- Test: `tests/js_unit.js` (node-safe section, after the existing Model tests)

**Acceptance Criteria:**
- [ ] `CsModel.newTrip()` returns `{name:"", date:"", team:"", declination:0.0, declinationSource:"", distanceUnit:"ft", startNote:"", startLrud:null}`.
- [ ] `CsModel.ensureTrips(survey)`: no `trips` → creates `trips[0]` mirroring top-level fields and sets `shot.trip=0` where missing; `trips` present → copies `trips[0]` outward to top-level. Idempotent.
- [ ] `CsModel.tripFingerprint(trip)` = `trip.date + "|" + declination.toFixed(4) + "|" + trip.team`.
- [ ] `CsModel.tripIdFor(survey, tripRecord)` returns the index of the existing trip with equal fingerprint, else pushes and returns the new index.
- [ ] `CsModel.flagsText(shot)` / `CsModel.parseFlags(text, shot)` round-trip the four booleans as letters `P`,`X`,`L`,`C` (order-insensitive parse, "" = all false).
- [ ] `CsModel.startLrudText(lrud)` / `CsModel.parseStartLrud(text)` round-trip `{left,right,up,down,leftAll,...}` as `L,R,U,D` with `-` for null and `/`-joined multi-readings (reuse `CsModel.lrudEntryText` / `CsModel.parseLrudEntry` per side).
- [ ] `CsModel.shotRowText(shot)` / `CsModel.parseShotRow(text)` round-trip one shot as tab-separated `from,to,distance,azimuth,inclination,backAzimuth,backInclination,L,R,U,D,flags,note` ("" = null); every Shot field in `CsModel.newShot` except `trip`/`splay` survives (splay rows never serialize; `trip` is context).
- [ ] All existing tests still pass.

**Verify:** `node tests/js_unit.js` → `### UNIT OK` with count increased by the new assertions.

**Steps:**

- [ ] **Step 1: Write failing tests** — append to the Model section of `tests/js_unit.js`:

```js
// ---- trips + revision serialization ----
var tsv = CsModel.newSurvey();
tsv.date = "1998-07-04"; tsv.team = "NS/JB"; tsv.declination = -2.5;
CsModel.ensureTrips(tsv);
ok(tsv.trips.length === 1, "ensureTrips creates trip 0");
ok(tsv.trips[0].team === "NS/JB", "trip 0 mirrors team");
ok(CsModel.tripFingerprint(tsv.trips[0]) === "1998-07-04|-2.5000|NS/JB",
    "trip fingerprint format");
var t2 = CsModel.newTrip(); t2.date = "1998-07-04"; t2.team = "KL";
ok(CsModel.tripIdFor(tsv, t2) === 1, "different team = new trip id");
ok(CsModel.tripIdFor(tsv, tsv.trips[0]) === 0, "same fingerprint reuses id");
ok(tsv.trips.length === 2, "tripIdFor appended once");

var fsh = CsModel.newShot();
fsh.excludeFromPlot = true; fsh.noAdjust = true;
ok(CsModel.flagsText(fsh) === "PC", "flags text");
var fsh2 = CsModel.newShot();
CsModel.parseFlags("CP", fsh2);
ok(fsh2.excludeFromPlot && fsh2.noAdjust && !fsh2.excludeFromAll,
    "flags parse order-insensitive");

var row = CsModel.newShot();
row.from = "A1"; row.to = "A2"; row.distance = 25.4; row.azimuth = 271.5;
row.inclination = -3; row.backAzimuth = 91.0; row.left = 2; row.leftAll = [2, 5];
row.excludeFromAll = true; row.notes = "line 1\nline 2";
var rowBack = CsModel.parseShotRow(CsModel.shotRowText(row));
ok(rowBack.from === "A1" && rowBack.to === "A2", "shot row endpoints");
near(rowBack.backAzimuth, 91.0, 1e-9, "shot row backsight");
ok(rowBack.backInclination === null, "shot row null backsight stays null");
ok(rowBack.leftAll.join("/") === "2/5", "shot row multi-reading LRUD");
ok(rowBack.excludeFromAll === true, "shot row flags");
ok(rowBack.notes === "line 1\nline 2", "shot row notes with newline");

var slr = CsModel.startLrudText({left: 2, right: null, up: 1, down: 0,
    leftAll: [2, 5], rightAll: null, upAll: null, downAll: null});
var slrBack = CsModel.parseStartLrud(slr);
ok(slrBack.right === null && slrBack.down === 0, "startLrud null vs 0");
ok(slrBack.leftAll.join("/") === "2/5", "startLrud multi-reading");
```

- [ ] **Step 2: Run to verify failure** — `node tests/js_unit.js` → `### UNIT FAIL` mentioning `ensureTrips`.

- [ ] **Step 3: Implement in CsModel.js** — add after `CsModel.newShot` (top-of-file doc comment gains the trips block from the spec):

```js
/** A fresh trip record (per-trip survey metadata). */
CsModel.newTrip = function() {
    return { name: "", date: "", team: "", declination: 0.0,
        declinationSource: "", distanceUnit: "ft",
        startNote: "", startLrud: null };
};

/** Trip identity (user decision): date|declination|team. */
CsModel.tripFingerprint = function(trip) {
    var d = (trip.declination === null || trip.declination === undefined) ?
        0.0 : trip.declination;
    return (trip.date || "") + "|" + d.toFixed(4) + "|" + (trip.team || "");
};

/**
 * Normalizes a survey to the trips shape. Legacy single-survey objects
 * get trips[0] built from the top-level fields; surveys that already
 * carry trips get trip 0 mirrored back to the top level (old callers
 * keep reading survey.declination etc. as "trip 0's view").
 */
CsModel.ensureTrips = function(survey) {
    if (survey.trips === undefined || survey.trips === null ||
        survey.trips.length === 0) {
        var t = CsModel.newTrip();
        t.name = survey.name; t.date = survey.date; t.team = survey.team;
        t.declination = survey.declination;
        t.declinationSource = survey.declinationSource;
        t.distanceUnit = survey.distanceUnit;
        t.startNote = survey.startNote || "";
        t.startLrud = survey.startLrud || null;
        survey.trips = [t];
    }
    var t0 = survey.trips[0];
    survey.name = t0.name; survey.date = t0.date; survey.team = t0.team;
    survey.declination = t0.declination;
    survey.declinationSource = t0.declinationSource;
    survey.distanceUnit = t0.distanceUnit;
    survey.startNote = t0.startNote;
    survey.startLrud = t0.startLrud;
    for (var i = 0; i < survey.shots.length; i++) {
        if (survey.shots[i].trip === undefined ||
            survey.shots[i].trip === null) {
            survey.shots[i].trip = 0;
        }
    }
    return survey;
};

/** The shot's trip record (after ensureTrips). */
CsModel.tripOf = function(survey, shot) {
    return survey.trips[shot.trip || 0];
};

/** Index of the trip matching tripRecord's fingerprint, appending it
 *  as a new trip when no existing one matches. */
CsModel.tripIdFor = function(survey, tripRecord) {
    CsModel.ensureTrips(survey);
    var fp = CsModel.tripFingerprint(tripRecord);
    for (var i = 0; i < survey.trips.length; i++) {
        if (CsModel.tripFingerprint(survey.trips[i]) === fp) {
            return i;
        }
    }
    survey.trips.push(tripRecord);
    return survey.trips.length - 1;
};
```

and the serialization block (also in CsModel.js):

```js
// ---- v3 tag serialization ------------------------------------------

CsModel.flagsText = function(shot) {
    return (shot.excludeFromPlot ? "P" : "") +
           (shot.excludeFromAll ? "X" : "") +
           (shot.excludeFromLength ? "L" : "") +
           (shot.noAdjust ? "C" : "");
};

CsModel.parseFlags = function(text, shot) {
    text = text || "";
    shot.excludeFromPlot = text.indexOf("P") >= 0;
    shot.excludeFromAll = text.indexOf("X") >= 0;
    shot.excludeFromLength = text.indexOf("L") >= 0;
    shot.noAdjust = text.indexOf("C") >= 0;
    return shot;
};

// One shot as a single line of tab-separated fields ("" = null). The
// carrier tag newline-escapes, so notes keep real newlines here.
// Order: from,to,distance,azimuth,inclination,backAzimuth,
//        backInclination,L,R,U,D,flags,note
CsModel.shotRowText = function(shot) {
    var num = function(v) {
        return (v === null || v === undefined) ? "" : String(v);
    };
    var lr = function(v, all) { return CsModel.lrudEntryText(v, all); };
    // notes: tabs would split the row -- swap for spaces (survey notes
    // never carry meaningful tabs)
    var note = (shot.notes || "").replace(/\t/g, " ");
    return [shot.from, shot.to, num(shot.distance), num(shot.azimuth),
        num(shot.inclination), num(shot.backAzimuth),
        num(shot.backInclination),
        lr(shot.left, shot.leftAll), lr(shot.right, shot.rightAll),
        lr(shot.up, shot.upAll), lr(shot.down, shot.downAll),
        CsModel.flagsText(shot), note].join("\t");
};

CsModel.parseShotRow = function(text) {
    var f = text.split("\t");
    var shot = CsModel.newShot();
    var num = function(v) {
        return (v === undefined || v === "") ? null : parseFloat(v);
    };
    shot.from = f[0] || ""; shot.to = f[1] || "";
    shot.distance = num(f[2]) || 0.0;
    shot.azimuth = num(f[3]) || 0.0;
    shot.inclination = num(f[4]) || 0.0;
    shot.backAzimuth = num(f[5]);
    shot.backInclination = num(f[6]);
    var sides = [["left", 7], ["right", 8], ["up", 9], ["down", 10]];
    for (var i = 0; i < sides.length; i++) {
        var e = CsModel.parseLrudEntry(f[sides[i][1]] || "");
        shot[sides[i][0]] = e.value;
        shot[sides[i][0] + "All"] = e.all;
    }
    CsModel.parseFlags(f[11] || "", shot);
    shot.notes = f.slice(12).join("\t"); // note was the tail
    return shot;
};

// StartLrud as "L,R,U,D" with "-" for null, "/"-joined multi-readings.
CsModel.startLrudText = function(lrud) {
    if (lrud === null || lrud === undefined) {
        return "";
    }
    var side = function(v, all) {
        if (v === null || v === undefined) { return "-"; }
        return CsModel.lrudEntryText(v, all);
    };
    return [side(lrud.left, lrud.leftAll), side(lrud.right, lrud.rightAll),
        side(lrud.up, lrud.upAll), side(lrud.down, lrud.downAll)].join(",");
};

CsModel.parseStartLrud = function(text) {
    if (text === "" || text === null || text === undefined) {
        return null;
    }
    var f = text.split(",");
    var out = { left: null, right: null, up: null, down: null,
        leftAll: null, rightAll: null, upAll: null, downAll: null };
    var names = ["left", "right", "up", "down"];
    for (var i = 0; i < names.length; i++) {
        if (f[i] === "-" || f[i] === undefined) { continue; }
        var e = CsModel.parseLrudEntry(f[i]);
        out[names[i]] = e.value;
        out[names[i] + "All"] = e.all;
    }
    return out;
};
```

Also add `trip: 0` to the object literal in `CsModel.newShot`.

NOTE: verify the exact names/signatures of `CsModel.lrudEntryText` and `CsModel.parseLrudEntry` in the file before use (they exist — CsTags.js calls both).

- [ ] **Step 4: Run to verify pass** — `node tests/js_unit.js` → `### UNIT OK`.

- [ ] **Step 5: Commit**

```bash
git add scripts/CaveSurvey/Core/CsModel.js tests/js_unit.js
git commit -m "feat: trip records, fingerprints, v3 tag serialization in CsModel"
```

---

### Task 2: Parsers and writers become trip-aware

**Goal:** Every parser emits `trips[]` keyed by the date|declination|team fingerprint; writers un-apply declination per shot's trip.

**Files:**
- Modify: `scripts/CaveSurvey/Core/Format/CsCompass.js`, `CsSurvex.js`, `CsWalls.js`, `CsCsv.js`
- Test: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] Compass: each `\f` block builds a trip record (name, date, team, declination); blocks with equal fingerprints share one trip id; `shot.trip` set on every shot from the block.
- [ ] Compass: a two-block .dat with different DECLINATION values yields `trips.length === 2`, per-trip declinations preserved, all azimuths still TRUE.
- [ ] Survex: the effective `(date, declination, team)` where each leg appears keys its trip (`*date`, `*team`, `*calibrate declination` tracked as today, but recorded per trip instead of last-wins).
- [ ] Walls/CSV: `ensureTrips` result, single trip 0.
- [ ] Writers (Compass/Survex/Walls/CSV `write`): magnetic values computed per `CsModel.tripOf(survey, shot).declination` (today they use the single `survey.declination`). Round-trip write→parse of a two-trip survey preserves both declinations and TRUE azimuths.
- [ ] Every parser return path calls `CsModel.ensureTrips`.

**Verify:** `node tests/js_unit.js` → `### UNIT OK`; existing format round-trip tests untouched and green.

**Steps:**

- [ ] **Step 1: Failing tests** — append to the format section of `tests/js_unit.js` a two-block Compass fixture (copy the existing `datContent` fixture's block shape; second block: `SURVEY TEAM:` different, `DECLINATION: 4.00`, one shot `B1 B2`) and assert:

```js
var dat2 = datTwoTrips; // the new fixture string
var dsv2 = CsFormatCompass.parse(dat2);
ok(dsv2.trips.length === 2, "compass: two declinations = two trips");
near(dsv2.trips[1].declination, 4.0, 1e-9, "compass: trip 1 declination kept");
ok(dsv2.shots[dsv2.shots.length - 1].trip === 1, "compass: shots keyed to trip");
// true-azimuth invariant: last shot's stored azimuth = tape + 4.0
// (fixture writes tape azimuth 90 -> stored 94)
near(dsv2.shots[dsv2.shots.length - 1].azimuth, 94.0, 1e-9,
    "compass: declination applied per block");
var dsv2rt = CsFormatCompass.parse(CsFormatCompass.write(dsv2));
ok(dsv2rt.trips.length === 2, "compass: trips survive write/parse");
near(dsv2rt.shots[dsv2rt.shots.length - 1].azimuth, 94.0, 1e-9,
    "compass: round trip keeps true azimuth");
```

plus the same-fingerprint merge case (two blocks, identical date/team/declination → `trips.length === 1`), and a Survex fixture with two `*date` lines → two trips.

- [ ] **Step 2: Run to verify failure.** `node tests/js_unit.js`

- [ ] **Step 3: Implement.** Pattern per parser: where the block/section metadata is read today into `survey.name/date/team/declination`, build a `CsModel.newTrip()` instead, get `var tripId = CsModel.tripIdFor(survey, trip)`, set `shot.trip = tripId` on every shot created from that block. Writers: replace `survey.declination` reads in write paths with `CsModel.tripOf(survey, shot).declination`. Read each parser before editing; keep each parser's existing single-survey return shape (top level still mirrors trip 0 via ensureTrips).

- [ ] **Step 4: Run to verify pass.** Both engines: `./tests/run_all.sh`.

- [ ] **Step 5: Commit** — `feat: per-trip parsing and writing (fingerprint-deduped trips)`

---

### Task 3: CTRL-HIDDEN layer

**Goal:** Registered, template-pinned layer for excludeFromPlot legs, off by default.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsLayers.js`, `scripts/CaveSurvey/CaveTemplate/templates/NSS_Cave_Template_PLAN.dxf`
- Test: `tests/test_addon.py` (structural test pins registry layers to the PLAN template — adding to the registry makes the test demand the template entry)

**Acceptance Criteria:**
- [ ] `CsLayers.HIDDEN = "CTRL-HIDDEN"` in the registry + DEFAULTS + `ensureSurveyLayers`, gray, CONTINUOUS, Weight000, **off by default** (follow exactly how CTRL-SPLAYS was added — same commit shape; check how "off" is expressed in the registry and use the layer-frozen/off flag the existing code supports, or document that ensure creates it off via `RLayer.setOff(true)` before add).
- [ ] PLAN template carries the layer (hand-insert the DXF LAYER table entry copying the CTRL-SPLAYS entry, name + color swapped, off/frozen bit set as decided above).
- [ ] `python3 -m unittest discover -s tests -v` green.

**Verify:** `./tests/run_all.sh` → structural section green.

**Steps:**
- [ ] Step 1: Add registry entry; run structural tests → they fail demanding the template entry (this IS the failing test).
- [ ] Step 2: Edit the PLAN template's LAYER table (text DXF; copy the CTRL-SPLAYS block, rename, set flag 70 bit 1 for frozen or the off encoding the other layers use).
- [ ] Step 3: `./tests/run_all.sh` green. Commit `feat: CTRL-HIDDEN layer for plotted-but-hidden legs`.

---

### Task 4: CsDraw writes tag schema v3

**Goal:** `CsDraw.survey` output is fully self-describing: leg tags, splay reading tags, per-trip anchors, Fixed tags, ExcludedShots/UnplacedShots rows, CTRL-HIDDEN legs.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsDraw.js`
- Test: `tests/js_unit.js` (QCAD-only doc block)

**Acceptance Criteria:**
- [ ] Every drawn non-splay leg line carries `From,To,Trip,ShotSeq,Distance,Azimuth,Inclination,Left,Right,Up,Down` (+`BackAzimuth`/`BackInclination`/`Flags`/`Note` when non-empty). Existing `Shot="A->B"` tag stays.
- [ ] `ShotSeq` = the shot's index within its trip in `survey.shots` order (compute once before drawing: walk `survey.shots`, `seqInTrip[shotIndex] = counter per trip`), NOT resolution order.
- [ ] excludeFromPlot legs draw on CTRL-HIDDEN with the same tags (change the `continue` at the `excludeFromPlot` check in the legs loop to route to the hidden layer).
- [ ] Splay lines additionally carry `Trip,ShotSeq,Distance,Azimuth,Inclination,Note`.
- [ ] Each trip's anchor (the trip's first resolved station, by that trip's lowest-seq resolved station) carries `Trip,TripName,TripDate,TripTeam,TripDeclination,TripDeclinationSource,TripDistanceUnit`, `StartNote`/`StartLrud` (trip 0 only, from survey fields), and trip 0 additionally the legacy `SurveyName…DistanceUnit` block (existing lines 404-411 stay).
- [ ] `ExcludedShots` (excludeFromAll) and `UnplacedShots` (resolved.unresolved) serialize onto the trip-0 anchor via `CsModel.shotRowText`, one row per line joined with `"\n"`, PREFIXED with the shot's trip id and a tab (`tripId + "\t" + rowText`) so trips reconstruct.
- [ ] Stations from `survey.fixed` get `Fixed="x,y,z"`.
- [ ] Doc test: draw a survey with 2 trips, a loop closure, a backsight, a P-flag shot, an X-flag shot, a splay, fixed station → read raw tags back with `CsTags.get` and assert each of the above (≥15 assertions).

**Verify:** `./tests/run_all.sh` → `### UNIT OK` in the CaveCAD engine section (node section skips doc tests).

**Steps:**
- [ ] Step 1: Write the failing doc-block test (extend the existing `if (!IS_NODE)` block pattern: fresh `RDocument`, `CsNetwork.resolve`, `CsDraw.survey`, then query entities by layer and assert tags).
- [ ] Step 2: Run `./tests/run_all.sh` → new assertions fail.
- [ ] Step 3: Implement in CsDraw.survey: precompute `seqInTrip`; extend `CsDraw.shotLine` to `(doc, op, fromPos, toPos, shot, survey, seqInTrip, layerName)` — keep a thin back-compat wrapper with the old signature if other callers exist (grep `CsDraw.shotLine` first); write splay tags where splays draw (lines 340-368); after the station loop, find each trip's anchor station point (track `firstPointOfTrip[tripId]` while drawing stations: a station belongs to the trip of the first shot that touches it) and tag; serialize excluded/unplaced rows.
- [ ] Step 4: `./tests/run_all.sh` green (both engines).
- [ ] Step 5: Commit `feat: CsDraw writes fully self-describing v3 tags`.

---

### Task 5: CsRevise.surveyFromDocument — exact reconstruction

**Goal:** THE gate: `surveyFromDocument(draw(S))` deep-equals S.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsRevise.js`
- Modify: `scripts/CaveSurvey/Core/CsAll.js` (include it), `tests/js_unit.js` (add to CORE_FILES + doc test)
- Test: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `CsRevise.surveyFromDocument(doc)` returns `{survey, anchorName, anchorPos, legacy}`: survey with trips (sorted by Trip id), shots from legs + splays + ExcludedShots + UnplacedShots rows sorted by `(trip, ShotSeq)` (excluded/unplaced rows append after tagged shots of their trip, in row order), `fixed` from Fixed tags, geo tags read, `startNote`/`startLrud` parsed.
- [ ] Legacy fallback: drawing has `Station` tags but no leg with `Distance` → returns `CsTags.surveyFromDocument(doc)` result with `legacy: true`.
- [ ] Round-trip doc test: the Task-4 fixture survey S → `CsDraw.survey` → `CsRevise.surveyFromDocument` → field-by-field deep compare against S for EVERY field of every shot (write a `shotsEqual(a, b, label)` helper comparing all CsModel.newShot keys with `near` for numerics), every trip record, fixed, startNote/startLrud. This is the reconstruct-entirely contract.
- [ ] CsRevise.js loads under node (no R* references at file scope); added to `CORE_FILES` in js_unit.js.

**Verify:** `./tests/run_all.sh` → `### UNIT OK` both engines.

**Steps:**
- [ ] Step 1: failing doc test (round-trip deep compare).
- [ ] Step 2: implement. Skeleton:

```js
// CsRevise.js -- reconstruction and revision engine. See spec
// docs/superpowers/specs/2026-08-20-revision-framework-design.md.

var CsRevise = {};

CsRevise.surveyFromDocument = function(doc) {
    var survey = CsModel.newSurvey();
    survey.trips = [];
    var legs = [], splays = [], anchors = [];
    var stationPos = {};
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) { continue; }
        var st = CsTags.get(e, "Station");
        if (st !== "") {
            stationPos[st] = e.getPosition();
            var fixed = CsTags.get(e, "Fixed");
            if (fixed !== "") {
                var fx = fixed.split(",");
                survey.fixed[st] = { x: parseFloat(fx[0]),
                    y: parseFloat(fx[1]), z: parseFloat(fx[2]) };
            }
            if (CsTags.get(e, "TripDeclination") !== "" ||
                CsTags.get(e, "Trip") !== "") {
                anchors.push(e);
            }
            continue;
        }
        if (CsTags.get(e, "From") !== "" && CsTags.get(e, "Distance") !== "") {
            legs.push(e);
        } else if (CsTags.get(e, "Splay") !== "" &&
                   CsTags.get(e, "Distance") !== "") {
            splays.push(e);
        }
    }
    if (legs.length === 0) {
        var legacy = CsTags.surveyFromDocument(doc);
        // anchor: first collected station
        var ls = CsTags.collectStations(doc);
        return { survey: legacy, legacy: true,
            anchorName: ls.length ? ls[0].name : "",
            anchorPos: ls.length ? ls[0].pos : null };
    }
    // trips from anchors ... shots from legs/splays via shotFromEntity
    // ... ExcludedShots/UnplacedShots rows via CsModel.parseShotRow
    // ... sort by (trip, ShotSeq); CsModel.ensureTrips(survey)
    ...
};
```

(The elided parts are mechanical tag reads mirroring Task 4's writes — implement them completely; the test defines done. `shotFromEntity` reads every leg tag back through `CsTags.get`/`getNumber`, `CsModel.parseFlags`, `CsModel.parseLrudEntry`.)
- [ ] Step 3: green both engines. Commit `feat: exact survey reconstruction from v3 tags (CsRevise)`.

---

### Task 6: Revision math — declination + similarity fit

**Goal:** Pure functions: per-trip declination revision, and the numeric rigid-change detector.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsRevise.js`
- Test: `tests/js_unit.js` (node-safe section)

**Acceptance Criteria:**
- [ ] `CsRevise.reviseDeclination(survey, tripId, newDecl, source)`: rotates `azimuth` (and `backAzimuth` when present) of every shot with `shot.trip === tripId` — including splays and flag-carrying shots — by `delta = newDecl - trip.declination`, normalized via `CsAngles.normalizeAzimuth`; updates the trip record; returns `{delta}`. `ensureTrips` re-mirror runs if tripId is 0.
- [ ] `CsRevise.similarityFit(pairs)` (pairs = `[{old:{x,y}, nu:{x,y}}]`): least-squares rotation+uniform-scale+translation (Procrustes, no reflection); returns `{theta, scale, tx, ty, maxResidual}`. Closed form: centroids, `a = Σ dp·dq`, `b = Σ (dp.x*dq.y - dp.y*dq.x)`, `theta = atan2(b, a)`, `scale = sqrt(a²+b²)/Σ|dp|²`, translation from centroids; residual = max |transform(old) − nu|.
- [ ] `CsRevise.classifyChange(oldResolved, newResolved, extent)`: builds pairs over stations in both; returns `{rigid, theta, scale, tx, ty, maxResidual, moved}` where `rigid = maxResidual < 1e-6 * extent && z-shifts uniform`, `moved` = `[{name, dist}]` sorted desc for the report.
- [ ] Unit tests: single-trip declination change → classify rigid, theta ≈ delta (radians, sign per drawing orientation: azimuth clockwise-from-north means +delta azimuth = −delta drawing rotation — assert numerically from a resolved 3-station survey, don't hand-wave the sign); two-trip drawing, change one trip → non-rigid; one edited shot → non-rigid with correct top mover; backsight co-rotation; wraparound (359 + 2 → 1).

**Verify:** `node tests/js_unit.js` → `### UNIT OK`.

**Steps:** TDD as in Task 1 (tests exercise via `CsNetwork.resolve` on small fixture surveys; no doc needed). Commit `feat: declination revision + similarity-fit rigid detection`.

---

### Task 7: CsRevise.apply — rigid transform or erase/redraw + report

**Goal:** Apply a revised model to the document.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsRevise.js`, `scripts/CaveSurvey/Core/CsReport.js`
- Test: `tests/js_unit.js` (doc block)

**Acceptance Criteria:**
- [ ] `CsRevise.apply(doc, di, recon, newSurvey)` (recon = surveyFromDocument result): resolves old + new with anchor `{name: recon.anchorName, x/y/z: recon.anchorPos}`; classifies; applies.
- [ ] Rigid path: ONE `RModifyObjectsOperation`; every entity transformed via `.rotate(theta, anchorVec)` / `.scale` / `.move` on its queried copy then `addObject(e, false)` — EXCEPT entities on layers whose name starts with `TB_` (sheet furniture); tagged entities also get updated `Azimuth`/`TripDeclination` values and trip-0 anchor gets `RevisionLog` appended (`CsTags.get` old log + "\n" + line). Undoing once restores everything.
- [ ] Non-rigid path: `CsDraw.eraseStations(doc, allStationNames)` then `CsDraw.survey(newSurvey, newResolved, recon.anchorName, recon.anchorPos)`.
- [ ] Returns report object `{rigid, delta?, moved, before, after}` (before/after = loop error summaries via existing CsReport/CsStats helpers — grep for the loop-report helper used by ImportCaveSurvey); `CsReport.revisionSummary(report)` renders it (new function, plain text).
- [ ] Doc tests: (a) single-trip declination revision → untagged scratch line (added to the doc before apply) rotated by theta, station tags updated, RevisionLog appended, rigid=true; (b) two-trip revision of trip 1 → rigid=false, trip-0 station positions unchanged within 1e-6, trip-1 stations moved, report lists them.

**Verify:** `./tests/run_all.sh` → `### UNIT OK` both engines.

**Steps:** TDD; verify `.rotate(angle, center)` exists on queried entities in this bridge (js_syntax/console experiment first — if entity-copy rotate is unavailable, use `RTransformOperation`-equivalent: query, `e.rotate(...)`, addObject; the doc test proves whichever works). Commit `feat: CsRevise.apply — rigid whole-drawing transform or redraw+report`.

---

### Task 8: Declination tool gains revision mode

**Goal:** Declination tool on a tagged drawing lists trips and applies per-trip fixes.

**Files:**
- Modify: `scripts/CaveSurvey/Declination/Declination.js`
- Test: `tests/js_unit.js` (pure helper only) + live GUI check

**Acceptance Criteria:**
- [ ] With no doc / untagged doc: behavior unchanged (estimate dialog).
- [ ] With tagged survey: dialog (QMessageBox-free — build like SurveyNotebook, QGridLayout of QLineEdit rows; NO QTableWidget, the bridge lacks it) listing each trip: id, name, date, team, recorded declination + source; editable "new declination" field per trip; "IGRF" fill button per trip enabled when GeoLat/GeoLon + parseable TripDate exist (value from `CsGeomag.declination`).
- [ ] Apply: for each changed trip → `reviseDeclination` on the reconstructed survey; then ONE `CsRevise.apply`; `EAction.handleUserMessage(CsReport.revisionSummary(...))` + summary QMessageBox.
- [ ] Legacy drawing (`recon.legacy`) → message directing to Rebuild Survey Data first; no apply.
- [ ] Tool wiring untouched (sortOrder 55 etc.).

**Verify:** `./tests/run_all.sh` (syntax + structural) green; manual: open CaveCAD, draw two-trip survey via notebook/import, run `decl`, change one trip, confirm rotation/redraw + report.

**Steps:** read Declination.js + SurveyNotebook.js dialog construction first; implement `declinationReviseRun(doc)` branching from `declinationRun`; commit `feat: Declination tool revises tagged drawings per trip`.

---

### Task 9: GeoReference offers declination fix

**Goal:** After anchoring, offer IGRF-based declination revision where recorded values disagree.

**Files:**
- Modify: `scripts/CaveSurvey/GeoReference/GeoReference.js`

**Acceptance Criteria:**
- [ ] After storing GeoLat/GeoLon (existing flow), reconstruct; for each trip with parseable date where `declinationSource` is `""` or `"user"` and `|recorded − igrf| > 0.5°`: one `QMessageBox.question` per trip ("Trip 1 (1998-07-04, NS/JB): recorded 0.0°, IGRF says -2.5°. Revise this trip?"); yes → reviseDeclination(source "igrf"); after the loop, one CsRevise.apply if anything changed.
- [ ] Untagged/legacy drawings: current behavior exactly.

**Verify:** syntax + structural green; manual GUI pass.

**Steps:** implement after the existing courtesy-IGRF block; commit `feat: GeoReference offers per-trip IGRF declination revision`.

---

### Task 10: SurveyNotebook loads from drawing

**Goal:** Ladder becomes the shot-revision UI: load a trip from the drawing, edit, redraw.

**Files:**
- Modify: `scripts/CaveSurvey/SurveyNotebook/SurveyNotebook.js`
- Test: existing headless notebook harness assertions (`setSurvey`/`sheetSurvey` round-trip) extended with a trips fixture

**Acceptance Criteria:**
- [ ] New "Load from drawing" button beside Clear: reconstructs via CsRevise; legacy → Rebuild-first message; >1 trip → chooser (simple `getText` with numbered list is acceptable; QComboBox dialog preferred if trivial); fills header (name/date/team/declination) + ladder from ONLY that trip's shots via existing `setSurvey`-shape (azimuth cells MAGNETIC: subtract trip declination the same way imports do today — grep the existing strip-on-fill code and reuse it).
- [ ] Header (date, declination, team) fingerprint-matches drawing trips on Draw: matching trip's shots REPLACE that trip (existing eraseStations flow already replaces by station names); non-matching = new trip id (CsModel.tripIdFor against the reconstructed survey before draw).
- [ ] Draw keeps other trips' entities untouched (erase only the loaded trip's stations — but wall runs spanning shared junction stations regenerate; accepted, existing behavior).
- [ ] After a redraw that moved stations, `CsReport.revisionSummary` goes to the command panel.

**Verify:** `./tests/run_all.sh` green; headless notebook harness green; manual GUI pass (load, edit an azimuth, Draw, see report).

**Steps:** READ SurveyNotebook.js fully first (1131 lines — the draw path, setSurvey, header wiring). Implement; commit `feat: notebook loads trips from drawing for shot revision`.

---

### Task 11: RebuildSurveyData upgrades legacy drawings to v3

**Goal:** One-shot upgrade: legacy chain-reconstruction → full v3 redraw.

**Files:**
- Modify: `scripts/CaveSurvey/RebuildSurveyData/RebuildSurveyData.js`
- Test: `tests/js_unit.js` doc block

**Acceptance Criteria:**
- [ ] On a legacy drawing (station tags, no Distance legs): after existing CsStore migration, reconstruct via `CsTags.surveyFromDocument`, convert plan distances to slope (`distance = plan / cos(inclination * PI/180)` when inclination ≠ 0 — plan distance is what the chain-reconstructor measured), eraseStations + CsDraw.survey redraw as single trip 0 → drawing now passes `CsRevise.surveyFromDocument` with `legacy === false`.
- [ ] Report states counts + "distances inferred from geometry".
- [ ] v3 drawings: rebuild is a no-op redraw (idempotent — doc test: run twice, station coordinates unchanged within 1e-9, entity count stable).

**Verify:** `./tests/run_all.sh` both engines.

**Steps:** TDD via doc test building a legacy-shaped doc (draw with v3, then strip leg tags... simpler: build legacy tags directly with CsTags on hand-placed points, mirroring the existing CsStore-migration test's approach — grep it); commit `feat: RebuildSurveyData upgrades drawings to tag schema v3`.

---

### Task 12: Full gate + docs + publish

**Goal:** Everything green everywhere; docs and memory current.

**Files:**
- Modify: `docs/` (add-on docs if the suite documents tools — check `docs/` layout), memory file `cave-survey-v2-state.md`

**Acceptance Criteria:**
- [ ] `./tests/run_all.sh --publish` → `ALL TESTS PASSED -- including publish checks` (CaveCAD engine + node).
- [ ] `tools/publish.sh` run (installs to CaveCAD scripts folder + ~/Documents/Cave archive) only if user wants a release now — ASK first.
- [ ] Spec's out-of-scope list still accurate; memory updated with revision-framework state + GUI-verification TODOs (Declination revise dialog, GeoReference offer, Notebook load — all need live GUI check like the rest of the v2 backlog).

**Verify:** `./tests/run_all.sh --publish` exit 0.

---

## Task dependencies

```
1 → 2, 4, 5, 6
3 → 4
4 → 5 → 6 → 7 → 8, 9, 10, 11 → 12
```

(8, 9, 10, 11 independent of each other after 7.)

---

## RESUME HERE (2026-08-20, evening)

Review backlog is now EMPTY. All findings from the Task 1-11 reviews are fixed and
committed (see `git log a78c330..`). `./tests/run_all.sh --publish` → ALL TESTS PASSED,
1225 assertions, 46/46 parsed, 16 structural tests OK. Tree clean.

### Fixed this pass
- Revision summary names the pivot station, flags the degraded "stale anchor" path, and
  reports an anchor dragged since reconstruction (`74a6dd8`).
- `anchorMoved` measures whichever point actually won the pivot, not always trip 0
  (`adb65d2`).
- Notebook trip chooser resolves by trip id with a first-match break; labels carry the
  declination (`7c9b11b`).
- IGRF button re-checks its preconditions in the click handler, so a bridge that rejects
  the `enabled = false` write yields an explanation instead of a dead button (`d0fa542`).
- **Elevation datum, three commits.** `CsDraw` wrote station `Elevation` tags but
  `CsRevise.surveyFromDocument` never read them, so the reconstructed model had no
  vertical datum and ANY revision — a plain declination fix included — rewrote every
  elevation from a zero-anchored resolve, silently rebasing the cave to zero. Plan X/Y was
  never affected. Now there is ONE mechanism, `CsRevise.anchorZOf(recon, name)`: explicit
  `*fix` z, then the recorded `Elevation` datum, then 0, always numeric. Legacy upgrade
  (`371b655`), revisions + Rebuild heal (`754fadd`), and the notebook's three hardcoded
  `z: 0` anchors (`66071a1`) all route through it. Subtlety worth keeping: when a
  georeferenced station that is NOT the trip-0 anchor wins the pivot, its z must come from
  the probe resolve, not from `recon.anchorZ` — pinning the wrong station at the anchor's
  datum shifts every elevation by the difference between them (measured at 0.86 ft on the
  test fixture before it was corrected).
  This bug was live in the published 2.1.0 build.

### Outstanding work, in priority order

**1. Test backfill — deliberately deferred by Nathan, not forgotten.** Everything below
was verified by throwaway scratchpad harnesses run through the real CaveCAD engine
(nothing in the repo), so the behavior is proven but not guarded against regression:
  - The four engine fixes in `a3f584b`: scale ≠ 1 rewriting `Distance`/LRUD tags,
    `anchorMoved`, `anchorUsed`, and the `CTRL-AERIAL` exemption.
  - The elevation-datum chain: `anchorZOf` precedence, the georef-pivot probe z, the
    notebook's three anchor sites, junk-tag → 0 with no NaN.
  - The tool-layer pure helpers: `Declination.parseTripEdits` / `parseIsoDate` /
    `declText`, `GeoReference.tripsNeedingRevision`, `SurveyNotebook.carryHiddenFields` /
    `mergeTripIntoSurvey` / `selectionElevation`. The tool files run
    `X.prototype = new EAction()` at load, so a headless harness must stub `EAction` —
    see how the RebuildSurveyData doc tests do it.

**2. Live GUI verification — nothing in the revision framework has run in a real CaveCAD
window.** 2.1.0 is already installed, so it is testable right now. Highest risk first:
  - Declination's revision dialog is the suite's first `QDialog` + `exec()`.
  - Notebook "Load from drawing": chooser, magnetic azimuth cells, replace-by-fingerprint,
    and the carried-over backsight/flag report line.
  - GeoReference's per-trip revision questions after anchoring.
  - RebuildSurveyData on a genuinely old drawing (legacy → v3).
  - Acceptance demo: import `testdata/FingerprintCave.dat`, run `decl`, set both 1998 trips
    to -2.50, confirm the middle section swings and the loop error drops 4.21 ft → 0.74 ft,
    matching what importing `FingerprintCave_Revised.dat` produces directly.

**3. Republish after the GUI pass** — the installed 2.1.0 predates all seven fixes above.
`tools/publish.sh` (ASK NATHAN FIRST).

### Known limits, accepted (not bugs to chase)
- Legacy upgrade follows `Azimuth` tags over measured geometry when they disagree, and
  infers slope distance as plan/cos(inclination); near-vertical shots keep their drawn
  distance rather than amplifying plot noise.
- A notebook round-trip drops a shot's backsight when its azimuth was edited on the page —
  deliberate: a reading that disagrees with its foresight is worse than none.
- Stock free QCAD still discards XDATA on save; CaveCAD is the target platform.
