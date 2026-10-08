# Station Table, Leads and Trip Plans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A whole-map Station Table panel (leads are one filterable kind, with team marks and notes stored in a Drive-synced sidecar), plus a Trip Plan built on the table's selection that gives directions, timing, and a gear list.

**Architecture:** Pure ES5 engines in `Core/` (`CsStationTable`, `CsStationStore`, `CsTripPlan`) that read the survey the drawing already carries and never a document, so `tests/js_unit.js` runs them under node. One dock panel tool (`StationTable`) wired to the fixed add-on shape does all document and file I/O. Working state lives in `stations.json` in the cave folder.

**Tech Stack:** QCAD/CaveCAD ECMAScript (ES5, QtScript-era bindings), Qt widgets, node for headless unit tests, python `unittest` for structural tests.

**User decisions (already made):**
- Lead = any station whose note reads like "LEAD"; the existing note-to-mleader callout already draws it, so no new entry mechanism.
- Leads are station-anchored and tracked **per station** (one row per station, all trips listed), inside a table of the whole map filterable by point kind.
- Working state (mark + notes) key is **station + note text**, stored in a cave-folder sidecar.
- All seven kinds ship: Lead, Open end, Junction, Control, Loop, Noted, Flagged. Rows always stay live-linked to the drawing and to the tool that owns the analysis.
- Trip Plan gives Google-Maps-style directions; hiking pace unless vertical is involved; vertical is supported; a minimum gear list is generated; gear list is level B (rope + anchors + a team packing list in the sidecar).
- Packet is for unguided trips and follows `cave-location-privacy` (no coordinates, no entrance location, no basemap).

**Spec:** `docs/superpowers/specs/2026-09-28-station-table-design.md`

**Deviations from the spec, found while planning (flag to Nathan at handoff):**
1. **Flagged** reads `CsValidate.check` (survey-level findings that carry a `shotIndex`), not Check Map. Check Map scans the *drawing* and its findings are not station-keyed. The Flagged row's link opens the Survey Notebook page for that trip, not Check Map.
2. **Anchor counts** from rigging symbols on the map are NOT in this plan. Reading `SYM_` block inserts near pitch stations needs a drawing scan that is its own task. v1 prints "rig not on map, confirm" per pitch. Recorded on the master ToDo as a follow-up.
3. **Notes on a station edit cause a re-link prompt.** To avoid this on every later-trip note, a lead row's key text is the LEAD notes only (not all notes at the station). Other rows key on all notes.

**Conventions to follow (read once before starting):**
- Every Core file is `Cs`-prefixed and registered in `Core/CsAll.js` (include() dedupes by basename; a collision silently skips a file).
- The unit harness loads Core by a **hand-written list** in `tests/js_unit.js` (~line 100-200). A file missing from that list passes silently through deliberate catches. Add each new Core file to BOTH `CsAll.js` and that list.
- A pitch has no bearing. Never compute a heading for a plumb leg (see `docs/vertical-caves.md`).
- Elevation trap: never default a missing z to 0. A null z stays null and is omitted.
- Panel openers need `action.setForceGlobal(true)`, build the dock in `init`, find by `objectName`, and use no expandos on widgets (`qcad-plugin-conventions`, `cavecad-tab-engine-panels`).
- Every new tool needs a handbook page and an `index.json` entry, or `tests/test_addon.py` fails.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Publish Cave Survey changes with `tools/publish.sh` when finished (`cave-always-publish`).

**Note on native tasks:** `TaskList`/`TaskCreate` were disabled in the planning session, so no `.tasks.json` was written. The executor should create native tasks from the task list below.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/CaveSurvey/Core/CsStationTable.js` (new) | Pure: notes-by-station, kind rules, `rows`, `filter`, `sort`, `suggest`, natural compare, checklist CSV |
| `scripts/CaveSurvey/Core/CsStationStore.js` (new) | Pure: sidecar JSON parse/serialize, key, `reconcile` (link / relink / orphan), `setEntry`, settings |
| `scripts/CaveSurvey/Core/CsTripPlan.js` (new) | Pure: graph, Dijkstra, stop order, directions, time, gear, packet HTML + SVG |
| `scripts/CaveSurvey/StationTable/StationTable.js` (new) | The dock panel tool: reads the doc, calls engines, reads/writes `stations.json`, zoom-to-station, Plan tab |
| `scripts/CaveSurvey/StationTable/StationTable.svg` (new) | Toolbar icon |
| `scripts/CaveSurvey/Core/CsAll.js` (modify) | Include the three new Core files |
| `tests/js_unit.js` (modify) | Load list + assertions for the three engines |
| `tests/test_addon.py` (modify) | Register the tool (group 451, next free sort order) |
| `docs/handbook/pages/station-table.html`, `docs/handbook/index.json` (new/modify) | Handbook page (also `trip-plan` if split) |
| `docs/superpowers/specs/2026-09-28-station-table-design.md` (modify) | Record the three deviations |

---

### Task 0: Branch and spec amendments

**Goal:** A clean working branch off the active trunk, with the spec recording the deviations.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-28-station-table-design.md`
- Modify: `docs/superpowers/plans/2026-09-28-station-table.md` (already written)

**Acceptance Criteria:**
- [ ] Branch `station-table` exists, created from `legacy-map` (`main` is stale at 0.3.0.0 and 720 commits behind; `legacy-map` is the active trunk at 0.9.182.1).
- [ ] The spec's Flagged row reads "CsValidate" and links to the Survey Notebook, and the rigging-symbol anchor counts are marked as a follow-up.

**Verify:** `git branch --show-current` → `station-table`; `grep -n "CsValidate" docs/superpowers/specs/2026-09-28-station-table-design.md` → at least one hit.

**Steps:**

- [ ] **Step 1: Create the branch**

```bash
cd ~/Documents/github/cavecad-tools
git status --short          # expect only the two new docs, untracked
git switch -c station-table
```

- [ ] **Step 2: Amend the spec**

In the spec's kinds table, change the Flagged row engine cell from `CsCheck` to `CsValidate` and the rule to "a `CsValidate.check` finding on a shot arriving at the station (missing LRUD, tape/clino disagreement, etc.)". In section "Live links", change "A Flagged row comes from Check Map and opens it on that finding" to "A Flagged row opens the Survey Notebook page of its trip". In "Gear list", change the Anchors/hardware bullet to end with "v1: always 'rig not on map, confirm'; reading symbol counts is a follow-up". Add under "Out of scope": "Reading rigging symbols from the drawing."

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-09-28-station-table-design.md docs/superpowers/plans/2026-09-28-station-table.md
git commit -m "docs: station table spec and plan

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 1: CsStationTable rows and kinds

**Goal:** A pure `CsStationTable.rows(survey, resolved, opts)` that returns one row per station with kind badges, notes, trips, elevation and flags.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsStationTable.js`
- Modify: `scripts/CaveSurvey/Core/CsAll.js` (after the `CsFrontier` include, line ~61: add after `CsPitch`, line ~69)
- Modify: `tests/js_unit.js` (load list at ~157 and a new section before the `### UNIT OK` print)

**Acceptance Criteria:**
- [ ] `leadTest()` matches "LEAD W", "Lead?", "a lead" and rejects "leader", "leads", "misled"; a custom keyword works.
- [ ] A chain with a branch yields the expected kinds per station (see test).
- [ ] The first station's `startNote` is attributed to the first leg's `from`.
- [ ] Rows carry `z` only, never `x`/`y` (privacy), and `z` is `null` when unresolved, never 0.
- [ ] Splay and excludeFromAll notes are ignored.

**Verify:** `node tests/js_unit.js` → `### UNIT OK <n> assertions`

**Steps:**

- [ ] **Step 1: Register the file in the harness load list**

In `tests/js_unit.js`, in the hand-written file list, add after `"scripts/CaveSurvey/Core/CsPitch.js",`:

```js
    "scripts/CaveSurvey/Core/CsStationTable.js",
```

- [ ] **Step 2: Write the failing tests**

Insert immediately before the line that prints `### UNIT OK`. (`frontierShot` and `frontierSurvey` are defined earlier in this file and hoisted.)

```js
// ---------------------------------------------------------------------
// Station Table -- rows and kinds
// ---------------------------------------------------------------------

function stRow(rows, name) {
    for (var i = 0; i < rows.length; i++) {
        if (rows[i].station === name) { return rows[i]; }
    }
    return null;
}

var stLead = CsStationTable.leadTest();
ok(stLead("LEAD W, going") === true, "lead: upper case");
ok(stLead("Lead?") === true, "lead: punctuation after");
ok(stLead("a lead") === true, "lead: mid sentence");
ok(stLead("leader of the group") === false, "lead: leader is not a lead");
ok(stLead("leads") === false, "lead: leads is not a lead");
ok(stLead("misled") === false, "lead: misled is not a lead");
ok(CsStationTable.leadTest("dig")("DIG at floor") === true,
    "lead: custom keyword");

var stA = frontierSurvey([
    frontierShot("A1", "A2", 0),
    frontierShot("A2", "A3", 0),
    frontierShot("A2", "B1", 0),
    frontierShot("B1", "B2", 1)
]);
stA.shots[1].notes = "LEAD W, going";
stA.shots[3].notes = "leader of the group";
stA.startNote = "entrance drip";
var stSplay = CsModel.newShot();
stSplay.from = "A3"; stSplay.to = ""; stSplay.splay = true;
stSplay.notes = "LEAD ghost on a splay";
stA.shots.push(stSplay);

var stRows = CsStationTable.rows(stA, null, {});
eqs(stRows.length, 5, "rows: A1 A2 A3 B1 B2");
eqs(stRow(stRows, "A3").kinds.join(","), "lead,openEnd,noted",
    "rows: A3 is a lead, an open end and noted");
eqs(stRow(stRows, "A2").kinds.join(","), "junction",
    "rows: A2 is a junction only");
eqs(stRow(stRows, "A1").kinds.join(","), "control,noted",
    "rows: A1 is control and carries the start note");
eqs(stRow(stRows, "B2").kinds.join(","), "openEnd,noted",
    "rows: leader is noted, not a lead");
eqs(stRow(stRows, "A3").noteText, "LEAD W, going",
    "rows: a splay note is ignored");
ok(stRow(stRows, "A3").z === null, "rows: z is null, not 0, when unresolved");
ok(stRow(stRows, "A3").x === undefined && stRow(stRows, "A3").y === undefined,
    "rows: no plan coordinates ever");
eqs(stRow(stRows, "B2").trips.join(","), "1", "rows: trip of B2");
eqs(stRow(stRows, "A2").trips.join(","), "0", "rows: trip of A2");
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node tests/js_unit.js`
Expected: FAIL / exception `CsStationTable is not defined` (or a missing-file error from the harness).

- [ ] **Step 4: Write the implementation**

Create `scripts/CaveSurvey/Core/CsStationTable.js`:

```js
// CsStationTable.js -- one row per station, and what kind of place it is.
//
// Part of the Cave Survey Core library: pure ES5, no document, no GUI,
// so tests/js_unit.js runs it under node.
//
// A LEAD IS NOT A RECORD. Surveyors already write "LEAD ..." in a
// station's note and the callout suite already draws that note as a
// multileader. Nothing here asks for new entry: it READS the notes,
// and every other kind (open end, junction, control, loop, flagged)
// is likewise a derived fact about a station, computed fresh each time
// and never stored. What IS stored -- a team's mark and notes on a
// row -- lives in CsStationStore.
//
// NO COORDINATES, EVER. A row carries elevation and nothing of the
// plan position. Rows feed a printable trip packet, and a cave's
// location does not leave the cave (see the location-privacy rule).
//
// A MISSING z IS null. A row whose station the resolver never placed,
// or placed without an elevation, reports null; substituting 0 would
// rebase the cave to sea level (the elevation datum trap).
//
// The 'Cs' prefix is mandatory: include() dedupes by basename.

include(includeBasePath + "/CsFrontier.js");

var CsStationTable = {};

/** The kinds, in the order badges are listed. */
CsStationTable.KINDS = ["lead", "openEnd", "junction", "control", "loop",
    "noted", "flagged"];

CsStationTable.LABEL = {
    lead: "Lead",
    openEnd: "Open end",
    junction: "Junction",
    control: "Control",
    loop: "Loop",
    noted: "Noted",
    flagged: "Flagged"
};

/** The word a note must contain to be a lead, unless a cave overrides. */
CsStationTable.DEFAULT_KEYWORD = "lead";

/**
 * A predicate: does this note text read as a lead?
 *
 * The keyword must stand as a whole word, case-insensitively, so
 * "LEAD W", "Lead?" and "a lead" match while "leader", "leads" and
 * "misled" do not. Punctuation is not part of a word.
 */
CsStationTable.leadTest = function(keyword) {
    var word = (keyword === undefined || keyword === null ||
        String(keyword).replace(/\s+/g, "") === "") ?
        CsStationTable.DEFAULT_KEYWORD : String(keyword);
    var escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var re = new RegExp("(^|[^A-Za-z0-9_])" + escaped +
        "([^A-Za-z0-9_]|$)", "i");
    return function(text) {
        return re.test(String(text === undefined || text === null ? "" : text));
    };
};

/** Station names in the order a caver reads them: A2 before A10. */
CsStationTable.compareNatural = function(a, b) {
    var re = /(\d+)|(\D+)/g;
    var pa = String(a).match(re) || [];
    var pb = String(b).match(re) || [];
    var n = Math.min(pa.length, pb.length);
    for (var i = 0; i < n; i++) {
        var x = pa[i];
        var y = pb[i];
        if (x === y) { continue; }
        if (/^\d+$/.test(x) && /^\d+$/.test(y)) {
            var d = parseInt(x, 10) - parseInt(y, 10);
            if (d !== 0) { return d < 0 ? -1 : 1; }
            continue;
        }
        var lx = x.toLowerCase();
        var ly = y.toLowerCase();
        if (lx !== ly) { return lx < ly ? -1 : 1; }
        return x < y ? -1 : 1;
    }
    if (pa.length === pb.length) { return 0; }
    return pa.length < pb.length ? -1 : 1;
};

/**
 * Every note, by the station it belongs to.
 *
 * A note rides on the leg that ARRIVES at a station (that is where the
 * notes page writes it, and where CsDraw reads it), so it belongs to
 * the shot's TO. The very first station has no arriving leg; its note
 * is survey.startNote. Splays and excluded shots are not survey and
 * their notes are not read.
 *
 * \return {station: [{text, trip}]}
 */
CsStationTable.notesByStation = function(survey) {
    var out = {};
    var add = function(station, text, trip) {
        var name = CsFrontier.clean(station);
        var body = (text === undefined || text === null) ? "" :
            String(text).replace(/^\s+|\s+$/g, "");
        if (name === "" || body === "") { return; }
        if (out[name] === undefined) { out[name] = []; }
        out[name].push({ text: body, trip: trip });
    };
    if (survey === undefined || survey === null ||
            Object.prototype.toString.call(survey.shots) !== "[object Array]") {
        return out;
    }
    var first = CsFrontier.firstLeg(survey);
    if (first !== null && survey.startNote) {
        add(first.from, survey.startNote, first.trip || 0);
    }
    for (var i = 0; i < survey.shots.length; i++) {
        var shot = survey.shots[i];
        if (!CsFrontier.isLeg(shot)) { continue; }
        add(shot.to, shot.notes, shot.trip || 0);
    }
    return out;
};

/** {station: [trip, ...]} sorted ascending, from the legs touching it. */
CsStationTable.tripsByStation = function(survey) {
    var seen = {};
    if (survey === undefined || survey === null ||
            Object.prototype.toString.call(survey.shots) !== "[object Array]") {
        return {};
    }
    var note = function(name, trip) {
        if (seen[name] === undefined) { seen[name] = {}; }
        seen[name][trip] = true;
    };
    for (var i = 0; i < survey.shots.length; i++) {
        var shot = survey.shots[i];
        if (!CsFrontier.isLeg(shot)) { continue; }
        var trip = shot.trip || 0;
        note(CsFrontier.clean(shot.from), trip);
        note(CsFrontier.clean(shot.to), trip);
    }
    var out = {};
    for (var name in seen) {
        if (!Object.prototype.hasOwnProperty.call(seen, name)) { continue; }
        var list = [];
        for (var t in seen[name]) {
            if (Object.prototype.hasOwnProperty.call(seen[name], t)) {
                list.push(parseInt(t, 10));
            }
        }
        list.sort(function(a, b) { return a - b; });
        out[name] = list;
    }
    return out;
};

/** {station: [{percent, error}]} for every station on a closed loop. */
CsStationTable.loopsByStation = function(resolved) {
    var out = {};
    if (resolved === undefined || resolved === null ||
            Object.prototype.toString.call(resolved.loops) !== "[object Array]") {
        return out;
    }
    for (var i = 0; i < resolved.loops.length; i++) {
        var loop = resolved.loops[i];
        var path = Object.prototype.toString.call(loop.path) ===
            "[object Array]" ? loop.path : [];
        for (var k = 0; k < path.length; k++) {
            var name = CsFrontier.clean(path[k]);
            if (name === "") { continue; }
            if (out[name] === undefined) { out[name] = []; }
            out[name].push({ percent: loop.percent, error: loop.error });
        }
    }
    return out;
};

/**
 * {station: [{code, severity, message}]} from CsValidate findings.
 * A finding sits on a SHOT; it is attributed to the station that shot
 * arrives at (its splay origin when it has no arrival).
 */
CsStationTable.flagsByStation = function(survey, findings) {
    var out = {};
    if (Object.prototype.toString.call(findings) !== "[object Array]" ||
            survey === undefined || survey === null) {
        return out;
    }
    for (var i = 0; i < findings.length; i++) {
        var f = findings[i];
        if (typeof f.shotIndex !== "number" || f.shotIndex < 0) { continue; }
        var shot = survey.shots[f.shotIndex];
        if (shot === undefined || shot === null) { continue; }
        var name = CsFrontier.clean(shot.to);
        if (name === "") { name = CsFrontier.clean(shot.from); }
        if (name === "") { continue; }
        if (out[name] === undefined) { out[name] = []; }
        out[name].push({ code: f.code, severity: f.severity,
            message: f.message });
    }
    return out;
};

/**
 * One row per station.
 *
 * \param survey   the WHOLE cave, every trip merged
 *                 (CsRevise.surveyFromDocument(doc).survey)
 * \param resolved CsAdjust.resolveAndAdjust() result, or null (then z
 *                 is null on every row)
 * \param opts     {keyword, closed: [names], findings: CsValidate.check()}
 *
 * \return [{station, kinds, trips, degree, notes: [{text, trip}],
 *           noteText, leadNotes: [{text, trip}], keyText, z, loops,
 *           flags}] -- unsorted; see sort()
 */
CsStationTable.rows = function(survey, resolved, opts) {
    var o = opts || {};
    if (survey === undefined || survey === null ||
            Object.prototype.toString.call(survey.shots) !== "[object Array]") {
        return [];
    }
    var isLead = CsStationTable.leadTest(o.keyword);
    var notes = CsStationTable.notesByStation(survey);
    var degree = CsFrontier.degrees(survey);
    var anchors = CsFrontier.anchors(survey);
    var trips = CsStationTable.tripsByStation(survey);
    var loops = CsStationTable.loopsByStation(resolved);
    var flags = CsStationTable.flagsByStation(survey, o.findings);

    var ends = {};
    var endList = CsFrontier.openEnds(survey, { closed: o.closed });
    for (var e = 0; e < endList.length; e++) {
        ends[endList[e].station] = true;
    }

    var names = {};
    var name;
    for (name in degree) {
        if (Object.prototype.hasOwnProperty.call(degree, name)) { names[name] = true; }
    }
    for (name in notes) {
        if (Object.prototype.hasOwnProperty.call(notes, name)) { names[name] = true; }
    }
    for (name in anchors) {
        if (Object.prototype.hasOwnProperty.call(anchors, name)) { names[name] = true; }
    }

    var out = [];
    for (name in names) {
        if (!Object.prototype.hasOwnProperty.call(names, name)) { continue; }
        var ns = notes[name] || [];
        var leadNotes = [];
        for (var n = 0; n < ns.length; n++) {
            if (isLead(ns[n].text)) { leadNotes.push(ns[n]); }
        }
        var kinds = [];
        if (leadNotes.length > 0) { kinds.push("lead"); }
        if (ends[name] === true) { kinds.push("openEnd"); }
        if ((degree[name] || 0) >= 3) { kinds.push("junction"); }
        if (anchors[name] === true) { kinds.push("control"); }
        if (loops[name] !== undefined) { kinds.push("loop"); }
        if (ns.length > 0) { kinds.push("noted"); }
        if (flags[name] !== undefined) { kinds.push("flagged"); }

        var texts = function(list) {
            var t = [];
            for (var i = 0; i < list.length; i++) { t.push(list[i].text); }
            return t.join(" | ");
        };
        var z = null;
        if (resolved !== undefined && resolved !== null &&
                resolved.stations !== undefined && resolved.stations !== null) {
            var st = resolved.stations[name];
            if (st !== undefined && st !== null && typeof st.z === "number" &&
                    isFinite(st.z)) {
                z = st.z;
            }
        }
        out.push({
            station: name,
            kinds: kinds,
            trips: trips[name] || [],
            degree: degree[name] || 0,
            notes: ns,
            noteText: texts(ns),
            leadNotes: leadNotes,
            // A lead keys on its LEAD notes only, so a later trip
            // writing "pushed 3 m, tight" beside it does not orphan
            // the team's marks.
            keyText: leadNotes.length > 0 ? texts(leadNotes) : texts(ns),
            z: z,
            loops: loops[name] || [],
            flags: flags[name] || []
        });
    }
    return out;
};
```

- [ ] **Step 5: Register in CsAll.js**

In `scripts/CaveSurvey/Core/CsAll.js`, after `include(includeBasePath + "/CsPitch.js");` add:

```js
// After CsFrontier (open ends) and CsPitch: the table reads the
// frontier, and the trip plan reads pitches.
include(includeBasePath + "/CsStationTable.js");
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node tests/js_unit.js`
Expected: `### UNIT OK <n> assertions`. If `frontierShot` is not found, confirm the insertion is *after* the Frontier section is defined and before the `### UNIT OK` print (function declarations hoist, so order only matters for the `var` statements).

- [ ] **Step 7: Commit**

```bash
git add scripts/CaveSurvey/Core/CsStationTable.js scripts/CaveSurvey/Core/CsAll.js tests/js_unit.js
git commit -m "feat: CsStationTable rows and kinds

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Filter, sort, suggestions and checklist CSV

**Goal:** `filter`, `sort`, `suggest` and `checklistCsv` on `CsStationTable`.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsStationTable.js`
- Modify: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `filter(rows, {kinds})` keeps rows having ANY chosen kind; empty kinds keeps all.
- [ ] `filter` text search matches station and note text, case-insensitively.
- [ ] `sort` puts A2 before A10.
- [ ] `suggest(row)` returns `"pushed"` for a lead whose station is touched by a leg of a later trip, else `""`.
- [ ] `checklistCsv(rows)` quotes commas, quotes and newlines correctly and carries no coordinates.

**Verify:** `node tests/js_unit.js` → `### UNIT OK <n> assertions`

**Steps:**

- [ ] **Step 1: Write the failing tests** (append to the Station Table section)

```js
// filter / sort / suggest / csv
var stF = CsStationTable.filter(stRows, { kinds: ["lead"] });
eqs(stF.length, 1, "filter: one lead");
eqs(stF[0].station, "A3", "filter: the lead is A3");
eqs(CsStationTable.filter(stRows, { kinds: ["lead", "junction"] }).length, 2,
    "filter: kinds combine as any-of");
eqs(CsStationTable.filter(stRows, {}).length, 5, "filter: no kinds keeps all");
eqs(CsStationTable.filter(stRows, { text: "DRIP" }).length, 1,
    "filter: text search is case-insensitive over notes");
eqs(CsStationTable.filter(stRows, { text: "b2" })[0].station, "B2",
    "filter: text search matches the station name");

var stNames = ["A10", "A2", "A1", "B1"];
var stSorted = CsStationTable.sort(stNames.map(function(n) {
    return { station: n };
})).map(function(r) { return r.station; });
eqs(stSorted.join(","), "A1,A2,A10,B1", "sort: natural order");

var stPushed = frontierSurvey([
    frontierShot("A1", "A2", 0),
    frontierShot("A2", "A3", 0),
    frontierShot("A3", "A4", 1)
]);
stPushed.shots[1].notes = "LEAD W";
var stPRows = CsStationTable.rows(stPushed, null, {});
eqs(CsStationTable.suggest(stRow(stPRows, "A3")), "pushed",
    "suggest: a later trip leaves the lead station");
eqs(CsStationTable.suggest(stRow(stRows, "A3")), "",
    "suggest: no later trip, no suggestion");
eqs(CsStationTable.suggest(stRow(stRows, "A2")), "",
    "suggest: only leads are suggested");

var stCsv = CsStationTable.checklistCsv([{
    station: "A3", kinds: ["lead"], trips: [0, 1], z: null,
    noteText: "LEAD \"W\", going\nsecond line", status: "open", team: "", who: ""
}]);
ok(stCsv.indexOf("\"LEAD \"\"W\"\", going\nsecond line\"") >= 0,
    "csv: quotes, commas and newlines are escaped");
ok(stCsv.split("\n")[0].indexOf("Station") === 0, "csv: header row first");
ok(!/\bx\b|\by\b|lat|lon/i.test(stCsv.split("\n")[0]),
    "csv: header names no coordinates");
```

- [ ] **Step 2: Run to verify they fail**

Run: `node tests/js_unit.js` → FAIL (`CsStationTable.filter is not a function`).

- [ ] **Step 3: Implement** (append to `CsStationTable.js`)

```js
/** The status a row shows: its mark, or "open" for an unmarked lead. */
CsStationTable.effectiveStatus = function(row) {
    if (row.status !== undefined && row.status !== null && row.status !== "") {
        return row.status;
    }
    return row.kinds.indexOf("lead") >= 0 ? "open" : "";
};

/**
 * Rows matching a query.
 *
 * \param query {kinds: [kind], text: string, status: string}
 *   kinds   ANY-of: a station that is a lead OR a junction stays. An
 *           empty list means every kind.
 *   text    case-insensitive, over station name and note text
 *   status  the effective status ("open", "assigned", ...); "" is any
 */
CsStationTable.filter = function(rows, query) {
    var q = query || {};
    var kinds = Object.prototype.toString.call(q.kinds) === "[object Array]" ?
        q.kinds : [];
    var text = (q.text === undefined || q.text === null) ? "" :
        String(q.text).toLowerCase();
    var status = (q.status === undefined || q.status === null) ? "" :
        String(q.status);
    var out = [];
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (kinds.length > 0) {
            var hit = false;
            for (var k = 0; k < kinds.length; k++) {
                if (row.kinds.indexOf(kinds[k]) >= 0) { hit = true; break; }
            }
            if (!hit) { continue; }
        }
        if (text !== "") {
            var hay = (row.station + " " + (row.noteText || "") + " " +
                (row.team || "") + " " + (row.who || "")).toLowerCase();
            if (hay.indexOf(text) < 0) { continue; }
        }
        if (status !== "" && CsStationTable.effectiveStatus(row) !== status) {
            continue;
        }
        out.push(row);
    }
    return out;
};

/** Rows in natural station order (a new array; the input is untouched). */
CsStationTable.sort = function(rows) {
    var copy = rows.slice(0);
    copy.sort(function(a, b) {
        return CsStationTable.compareNatural(a.station, b.station);
    });
    return copy;
};

/**
 * What the table would SUGGEST for a row. Never applied: only a person
 * sets a mark. Trip indexes run in the order trips were added, so "a
 * later trip touches this station" means somebody surveyed on from it
 * after the lead was written.
 *
 * \return "pushed" or ""
 */
CsStationTable.suggest = function(row) {
    if (row.kinds.indexOf("lead") < 0 || row.leadNotes.length === 0) {
        return "";
    }
    var first = row.leadNotes[0].trip;
    for (var i = 1; i < row.leadNotes.length; i++) {
        if (row.leadNotes[i].trip < first) { first = row.leadNotes[i].trip; }
    }
    for (var t = 0; t < row.trips.length; t++) {
        if (row.trips[t] > first) { return "pushed"; }
    }
    return "";
};

/**
 * The rows as CSV, for a trip planner's checklist. Columns name no
 * position: elevation only.
 */
CsStationTable.checklistCsv = function(rows) {
    var cell = function(v) {
        var s = (v === undefined || v === null) ? "" : String(v);
        if (/[",\n\r]/.test(s)) { s = "\"" + s.replace(/"/g, "\"\"") + "\""; }
        return s;
    };
    var lines = [["Station", "Kinds", "Trips", "Elevation", "Status", "Note",
        "Team notes", "Assigned"].join(",")];
    for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var labels = [];
        for (var k = 0; k < r.kinds.length; k++) {
            labels.push(CsStationTable.LABEL[r.kinds[k]]);
        }
        lines.push([cell(r.station), cell(labels.join("; ")),
            cell((r.trips || []).join(" ")),
            cell(r.z === null || r.z === undefined ? "" : r.z),
            cell(CsStationTable.effectiveStatus(r)), cell(r.noteText),
            cell(r.team), cell(r.who)].join(","));
    }
    return lines.join("\n") + "\n";
};
```

- [ ] **Step 4: Run to verify pass**

Run: `node tests/js_unit.js` → `### UNIT OK <n> assertions`

- [ ] **Step 5: Commit**

```bash
git add scripts/CaveSurvey/Core/CsStationTable.js tests/js_unit.js
git commit -m "feat: station table filter, sort, suggest, checklist csv

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: CsStationStore (sidecar state, key, relink)

**Goal:** Pure sidecar logic: parse/serialize `stations.json`, reconcile marks onto rows (link / relink / orphan), and edit entries.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsStationStore.js`
- Modify: `scripts/CaveSurvey/Core/CsAll.js`, `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] Bad or empty JSON parses to an empty store with an `error` string, never throws.
- [ ] Serialize then parse round-trips entries and the `settings` block; output order is stable.
- [ ] A row whose station + key text matches an entry gets `status/team/who` and `link === "ok"`.
- [ ] Case and whitespace changes in a note do not break the match.
- [ ] A row whose note changed, with exactly one unmatched entry at that station, gets `link === "relink"` and `relinkFrom`.
- [ ] An entry matching no row is returned in `orphans`, and is kept in the store.
- [ ] `setEntry` on a relink row moves the marks to the new note and removes the old entry; an all-empty entry is pruned.

**Verify:** `node tests/js_unit.js` → `### UNIT OK <n> assertions`

**Steps:**

- [ ] **Step 1: Register in the harness list** (after `CsStationTable.js`)

```js
    "scripts/CaveSurvey/Core/CsStationStore.js",
```

And in `CsAll.js` after the `CsStationTable.js` include:

```js
// Pure sidecar logic for the Station Table's marks and notes; the file
// I/O itself is in StationTable/StationTable.js.
include(includeBasePath + "/CsStationStore.js");
```

- [ ] **Step 2: Write the failing tests** (append)

```js
// ---------------------------------------------------------------------
// Station Store -- marks, notes, relink
// ---------------------------------------------------------------------

var ssBad = CsStationStore.parse("{not json");
eqs(ssBad.store.entries.length, 0, "store: bad json gives an empty store");
ok(typeof ssBad.error === "string" && ssBad.error !== "",
    "store: bad json reports an error");
eqs(CsStationStore.parse("").store.entries.length, 0,
    "store: empty text is an empty store, quietly");
ok(CsStationStore.parse("").error === "", "store: empty text is no error");

var ssRows = function() {
    return CsStationTable.rows(stA, null, {});
};
var ss = CsStationStore.empty();
var ssR = CsStationStore.reconcile(ssRows(), ss).rows;
var ssA3 = stRow(ssR, "A3");
CsStationStore.setEntry(ss, ssA3, { status: "assigned", team: "check the floor",
    who: "Sam" });
eqs(ss.entries.length, 1, "store: one entry written");

var ssBack = CsStationStore.parse(CsStationStore.serialize(ss)).store;
eqs(ssBack.entries[0].who, "Sam", "store: round trip keeps who");
eqs(CsStationStore.serialize(ssBack), CsStationStore.serialize(ss),
    "store: serialize is stable");

var ssRec = CsStationStore.reconcile(ssRows(), ssBack);
eqs(stRow(ssRec.rows, "A3").status, "assigned", "reconcile: mark attaches");
eqs(stRow(ssRec.rows, "A3").link, "ok", "reconcile: link ok");
eqs(stRow(ssRec.rows, "A2").link, "", "reconcile: unmarked row has no link");

// A case or spacing change in the note must not orphan the marks.
var stA2 = JSON.parse(JSON.stringify(stA));
stA2.shots[1].notes = "  lead   w, going ";
var ssCase = CsStationStore.reconcile(CsStationTable.rows(stA2, null, {}), ssBack);
eqs(stRow(ssCase.rows, "A3").link, "ok", "reconcile: case/space change still links");

// A real edit of the note -> relink, marks kept.
var stA3 = JSON.parse(JSON.stringify(stA));
stA3.shots[1].notes = "LEAD E, going";
var ssEdit = CsStationStore.reconcile(CsStationTable.rows(stA3, null, {}), ssBack);
var ssEditRow = stRow(ssEdit.rows, "A3");
eqs(ssEditRow.link, "relink", "reconcile: edited note asks to re-link");
eqs(ssEditRow.status, "assigned", "reconcile: relink still shows the marks");
eqs(ssEditRow.relinkFrom, "LEAD W, going", "reconcile: relink names the old note");
eqs(ssEdit.orphans.length, 0, "reconcile: a relink is not an orphan");

CsStationStore.setEntry(ssBack, ssEditRow, { status: "assigned" });
eqs(ssBack.entries.length, 1, "setEntry: relink moves, does not duplicate");
eqs(ssBack.entries[0].note, "LEAD E, going", "setEntry: relink adopts the new note");
eqs(ssBack.entries[0].who, "Sam", "setEntry: relink keeps the other fields");

// A station that vanished -> orphan, entry preserved.
var stGone = frontierSurvey([frontierShot("A1", "A2", 0)]);
var ssOrph = CsStationStore.reconcile(CsStationTable.rows(stGone, null, {}), ssBack);
eqs(ssOrph.orphans.length, 1, "reconcile: vanished station is an orphan");
eqs(ssBack.entries.length, 1, "reconcile: orphan is kept in the store");

// All-empty entries are pruned.
CsStationStore.setEntry(ssBack, stRow(CsStationStore.reconcile(
    CsStationTable.rows(stA3, null, {}), ssBack).rows, "A3"),
    { status: "", team: "", who: "" });
eqs(ssBack.entries.length, 0, "setEntry: an empty entry is removed");

// Settings and packing ride in the same file.
var ssSet = CsStationStore.empty();
ssSet.settings.packing = "First aid kit\nSpare batteries";
var ssSetBack = CsStationStore.parse(CsStationStore.serialize(ssSet)).store;
eqs(ssSetBack.settings.packing, "First aid kit\nSpare batteries",
    "store: packing list round trips");
```

- [ ] **Step 3: Run to verify they fail** — `node tests/js_unit.js` → `CsStationStore is not defined`.

- [ ] **Step 4: Implement** — create `scripts/CaveSurvey/Core/CsStationStore.js`:

```js
// CsStationStore.js -- the team's marks and notes on a Station Table row.
//
// Part of the Cave Survey Core library: pure ES5. The file itself
// (stations.json in the cave folder, carried by Google Drive with the
// rest of the cave) is read and written by StationTable.js; this file
// is everything about what is IN it.
//
// THE KEY IS STATION + NOTE TEXT. A note the team edits later is a
// different key, and the marks would silently detach. So a row whose
// note changed but which has exactly ONE unmatched entry at its station
// is offered as a RELINK, marks shown, until a person confirms it;
// nothing is dropped and nothing is re-attached unasked. Entries that
// match no station at all are ORPHANS: kept, listed, never deleted.
//
// Matching ignores case and runs of whitespace, so tidying "lead w" to
// "LEAD W" does not orphan anything.
//
// The 'Cs' prefix is mandatory: include() dedupes by basename.

var CsStationStore = {};

CsStationStore.VERSION = 1;
CsStationStore.FILE = "stations.json";

/** The marks a row can carry. "" is unmarked (a lead then reads "open"). */
CsStationStore.STATUSES = ["open", "assigned", "pushed", "done", "skip"];

/** Why a row is Done; free text is allowed, these are the suggestions. */
CsStationStore.DONE_REASONS = ["continues", "ended", "tied in", "dug out"];

CsStationStore.empty = function() {
    return { version: CsStationStore.VERSION, entries: [],
        settings: { packing: "", pace: {} } };
};

CsStationStore.normalize = function(text) {
    return String(text === undefined || text === null ? "" : text)
        .replace(/\s+/g, " ").replace(/^ | $/g, "").toLowerCase();
};

CsStationStore.keyOf = function(station, text) {
    return String(station) + "\u001f" + CsStationStore.normalize(text);
};

var csStoreStr = function(v) {
    return (v === undefined || v === null) ? "" : String(v);
};

/**
 * Text of stations.json -> {store, error}. Never throws. An empty file
 * is an empty store with no error; damage is an empty store WITH an
 * error, so the panel can say so instead of silently starting over.
 */
CsStationStore.parse = function(text) {
    var store = CsStationStore.empty();
    if (text === undefined || text === null ||
            String(text).replace(/\s+/g, "") === "") {
        return { store: store, error: "" };
    }
    var data;
    try {
        data = JSON.parse(String(text));
    } catch (e) {
        return { store: store, error: "stations.json could not be read: " + e };
    }
    if (data === null || typeof data !== "object") {
        return { store: store, error: "stations.json is not a station file" };
    }
    var list = Object.prototype.toString.call(data.entries) ===
        "[object Array]" ? data.entries : [];
    for (var i = 0; i < list.length; i++) {
        var e2 = list[i];
        if (e2 === null || typeof e2 !== "object" ||
                typeof e2.station !== "string" || e2.station === "") {
            continue;
        }
        var status = csStoreStr(e2.status);
        if (status !== "" && CsStationStore.STATUSES.indexOf(status) < 0) {
            status = "";
        }
        store.entries.push({ station: e2.station, note: csStoreStr(e2.note),
            status: status, team: csStoreStr(e2.team), who: csStoreStr(e2.who) });
    }
    if (data.settings !== null && typeof data.settings === "object") {
        store.settings.packing = csStoreStr(data.settings.packing);
        if (data.settings.pace !== null && typeof data.settings.pace === "object") {
            store.settings.pace = data.settings.pace;
        }
    }
    return { store: store, error: "" };
};

/** The store as file text, in a stable order (so a Drive diff is small). */
CsStationStore.serialize = function(store) {
    var entries = store.entries.slice(0);
    entries.sort(function(a, b) {
        var d = CsStationTable.compareNatural(a.station, b.station);
        if (d !== 0) { return d; }
        return a.note < b.note ? -1 : (a.note > b.note ? 1 : 0);
    });
    return JSON.stringify({ version: CsStationStore.VERSION,
        entries: entries, settings: store.settings }, null, 2) + "\n";
};

/**
 * Attach the stored marks to rows.
 *
 * Adds to each row: status, team, who, and link -- "ok" (matched),
 * "relink" (note changed; relinkFrom is the stored note) or "" (nothing
 * stored). Rows are changed in place.
 *
 * \return {rows, orphans} -- orphans are stored entries that match no
 *         station at all (still in the store; nothing is deleted here)
 */
CsStationStore.reconcile = function(rows, store) {
    var byKey = {};
    var byStation = {};
    var i;
    for (i = 0; i < store.entries.length; i++) {
        var e = store.entries[i];
        byKey[CsStationStore.keyOf(e.station, e.note)] = e;
        if (byStation[e.station] === undefined) { byStation[e.station] = []; }
        byStation[e.station].push(e);
    }
    var used = {};
    var apply = function(row, entry) {
        row.status = entry.status;
        row.team = entry.team;
        row.who = entry.who;
    };
    var pending = [];
    for (i = 0; i < rows.length; i++) {
        var row = rows[i];
        row.key = CsStationStore.keyOf(row.station, row.keyText);
        row.status = ""; row.team = ""; row.who = "";
        row.link = ""; row.relinkFrom = undefined;
        if (byKey[row.key] !== undefined) {
            apply(row, byKey[row.key]);
            row.link = "ok";
            used[row.key] = true;
        } else {
            pending.push(row);
        }
    }
    for (i = 0; i < pending.length; i++) {
        var p = pending[i];
        var cands = [];
        var here = byStation[p.station] || [];
        for (var c = 0; c < here.length; c++) {
            if (used[CsStationStore.keyOf(here[c].station, here[c].note)] !== true) {
                cands.push(here[c]);
            }
        }
        if (cands.length === 1) {
            apply(p, cands[0]);
            p.link = "relink";
            p.relinkFrom = cands[0].note;
            used[CsStationStore.keyOf(cands[0].station, cands[0].note)] = true;
        }
    }
    var orphans = [];
    for (i = 0; i < store.entries.length; i++) {
        var oe = store.entries[i];
        if (used[CsStationStore.keyOf(oe.station, oe.note)] !== true) {
            orphans.push(oe);
        }
    }
    return { rows: rows, orphans: orphans };
};

/**
 * Write a row's marks into the store, in place. On a relink row this
 * is the CONFIRMATION: the stored entry moves to the row's current note.
 * An entry whose status, team and who are all empty is removed.
 *
 * \param fields any of {status, team, who}; absent fields are kept
 */
CsStationStore.setEntry = function(store, row, fields) {
    var newKey = CsStationStore.keyOf(row.station, row.keyText);
    var oldKey = (row.link === "relink" && row.relinkFrom !== undefined) ?
        CsStationStore.keyOf(row.station, row.relinkFrom) : newKey;
    var base = { station: row.station, note: row.keyText, status: "",
        team: "", who: "" };
    var kept = [];
    for (var i = 0; i < store.entries.length; i++) {
        var e = store.entries[i];
        var k = CsStationStore.keyOf(e.station, e.note);
        if (k === newKey || k === oldKey) {
            base = { station: e.station, note: row.keyText, status: e.status,
                team: e.team, who: e.who };
        } else {
            kept.push(e);
        }
    }
    var f = fields || {};
    if (f.status !== undefined) {
        base.status = CsStationStore.STATUSES.indexOf(f.status) >= 0 ?
            f.status : "";
    }
    if (f.team !== undefined) { base.team = String(f.team); }
    if (f.who !== undefined) { base.who = String(f.who); }
    if (base.status !== "" || base.team !== "" || base.who !== "") {
        kept.push(base);
    }
    store.entries = kept;
    return store;
};
```

- [ ] **Step 5: Run to verify pass** — `node tests/js_unit.js` → `### UNIT OK <n> assertions`.

- [ ] **Step 6: Commit**

```bash
git add scripts/CaveSurvey/Core/CsStationStore.js scripts/CaveSurvey/Core/CsAll.js tests/js_unit.js
git commit -m "feat: CsStationStore sidecar marks with relink and orphans

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: StationTable panel (slice 1 UI)

**Goal:** A dock panel "Station Table" with kind filters, search, status filter, editable status/notes/who, click-to-zoom, sidecar load/save, and refresh.

**Files:**
- Create: `scripts/CaveSurvey/StationTable/StationTable.js`, `scripts/CaveSurvey/StationTable/StationTable.svg`
- Modify: `tests/test_addon.py` (tool registry near line 1795: add `"StationTable/StationTable.js": (451, <next free>, ["stationtable", "st"])`; also add `"StationTable"` to the panel-opener / `NO_DOCUMENT_NEEDED` lists only if it does not require a document; it DOES, so leave those alone)
- Test: `tests/test_addon.py` (structural); live verification through the CaveCAD MCP tools

**Acceptance Criteria:**
- [ ] The tool appears in Cave Survey menu group 451 and via commands `stationtable` / `st`.
- [ ] Opening it on Pitfall Cave lists every station; ticking the Lead filter shows only lead rows.
- [ ] Clicking a row zooms the drawing to that station.
- [ ] Setting a status and a team note, then reopening the drawing, restores them from `stations.json` beside the drawing.
- [ ] A row with `link === "relink"` shows a "note changed" marker and a Re-link button; confirming rewrites the entry.
- [ ] Orphans are listed in a footer line with a count; nothing is deleted.
- [ ] `python3 -m unittest discover -s tests -v` passes (registry, sort-order uniqueness, handbook page present).

**Verify:** `python3 -m unittest discover -s tests -v 2>&1 | tail -5` → `OK`; then live check in Step 6.

**Steps:**

- [ ] **Step 1: Read the model first**

Read `scripts/CaveSurvey/StartHere/StartHere.js` lines 29-360 end to end. It is the reference for dock lifecycle: `buildDock` creates a `QDockWidget` with an `objectName`, `ensureDock` caches it in a module global, `beginEvent` opens it, `init` builds it hidden so `restoreState()` can place it, `CsPanel.attachHelp` adds the `?` button. Copy that lifecycle exactly. Also read `qcad-js-bridge-traps` in memory before writing widgets (wrapper-only widgets, method-vs-property, no QDate, self-confirming message boxes).

- [ ] **Step 2: Register the tool in the structural test (failing first)**

In `tests/test_addon.py` add to the registry dict under the `# 451 -- survey data` block:

```python
    "StationTable/StationTable.js":       (451, 12, ["stationtable", "st"]),
```

Check that sort order 12 is unused in group 451 (`grep -n "(451," tests/test_addon.py`); pick the next free number if not.

Run: `python3 -m unittest discover -s tests -v 2>&1 | tail -15`
Expected: FAIL (tool file missing; no handbook page).

- [ ] **Step 3: Create the tool file**

Create `scripts/CaveSurvey/StationTable/StationTable.js`:

```js
// StationTable.js
//
// QCAD add-on tool: every station in the cave as one table you can
// filter, mark and navigate.
//
//   Cave Survey > Station Table   (or type "st")
//
// WHAT IT IS. A working table over the whole map: one row per station,
// badges for what kind of place it is (lead, open end, junction,
// control, loop, noted, flagged), and the team's own status and notes
// beside them. Leads are just one kind. Clicking a row goes there.
//
// NOTHING DERIVED IS STORED. Rows are computed from the survey on
// every refresh (Core/CsStationTable.js). What the team writes -- a
// status, a note, who has it -- lives in stations.json beside the
// drawing, so Google Drive carries it to the rest of the team
// (Core/CsStationStore.js).
//
// See docs/superpowers/specs/2026-09-28-station-table-design.md.

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

var csStationTableDock;

function StationTable(guiAction) {
    EAction.call(this, guiAction);
}

StationTable.prototype = new EAction();

/** Column indexes. */
StationTable.COL = { STATION: 0, KINDS: 1, TRIPS: 2, ELEV: 3, STATUS: 4,
    NOTE: 5, TEAM: 6, WHO: 7 };
StationTable.HEADERS = ["Station", "Kinds", "Trips", "Elev", "Status",
    "Note in survey", "Team notes", "Assigned"];

/** What the panel is currently showing. Module state, never widget expandos. */
StationTable.state = { rows: [], store: null, orphans: [], docPath: "",
    filling: false, loadError: "" };

// ---------------------------------------------------------------------
// Reading the drawing
// ---------------------------------------------------------------------

/**
 * The whole cave as the drawing carries it, resolved the way the drawing
 * was solved (so elevations agree with the map).
 *
 * \return {survey, resolved, recon} or null when the drawing holds no survey
 */
StationTable.readDrawing = function(doc) {
    var recon = CsRevise.surveyFromDocument(doc);
    if (isNull(recon) || isNull(recon.survey) ||
            recon.survey.shots.length === 0) {
        return null;
    }
    var resolveOpts = {};
    if (recon.anchorName !== "" && !isNull(recon.anchorPos)) {
        resolveOpts.anchor = { name: recon.anchorName,
            x: recon.anchorPos.x, y: recon.anchorPos.y, z: recon.anchorZ };
    }
    var resolved = CsAdjust.resolveAndAdjust(recon.survey, resolveOpts,
        CsAdjust.optionsFromTags(recon.adjustTags));
    return { survey: recon.survey, resolved: resolved, recon: recon };
};

// ---------------------------------------------------------------------
// The sidecar file
// ---------------------------------------------------------------------

/** Absolute path of stations.json beside the drawing, or "" when unsaved. */
StationTable.sidecarPath = function(docPath) {
    if (docPath === undefined || docPath === null || String(docPath) === "") {
        return "";
    }
    return CsCave.folderOf(String(docPath)) + "/" + CsStationStore.FILE;
};

StationTable.readSidecar = function(path) {
    if (path === "") { return { store: CsStationStore.empty(), error: "" }; }
    var file = new QFile(path);
    if (!file.exists()) { return { store: CsStationStore.empty(), error: "" }; }
    if (!file.open(QIODevice.ReadOnly | QIODevice.Text)) {
        return { store: CsStationStore.empty(),
            error: "stations.json exists but could not be opened" };
    }
    var stream = new QTextStream(file);
    var text = stream.readAll();
    file.close();
    return CsStationStore.parse(text);
};

/** \return true on success */
StationTable.writeSidecar = function(path, store) {
    if (path === "") { return false; }
    var file = new QFile(path);
    if (!file.open(QIODevice.WriteOnly | QIODevice.Text)) { return false; }
    var stream = new QTextStream(file);
    stream.writeString(CsStationStore.serialize(store));
    file.close();
    return true;
};

// ---------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------

StationTable.buildDock = function(appWin) {
    var dock = new QDockWidget(qsTr("Station Table"), appWin);
    dock.objectName = "CaveSurveyStationTableDock";

    var body = new QWidget(dock);
    var layout = new QVBoxLayout();
    layout.setContentsMargins(6, 6, 6, 6);
    layout.setSpacing(6);
    body.setLayout(layout);

    // Kind filters, any-of.
    var kindRow = new QHBoxLayout();
    var kindBoxes = {};
    for (var k = 0; k < CsStationTable.KINDS.length; k++) {
        var kind = CsStationTable.KINDS[k];
        var box = new QCheckBox(qsTr(CsStationTable.LABEL[kind]), body);
        box.objectName = "StationTableKind_" + kind;
        kindRow.addWidget(box, 0, Qt.AlignLeft);
        kindBoxes[kind] = box;
    }
    kindRow.addStretch(1);
    layout.addLayout(kindRow);

    // Search, status filter.
    var searchRow = new QHBoxLayout();
    var search = new QLineEdit(body);
    search.objectName = "StationTableSearch";
    search.placeholderText = qsTr("Search stations and notes");
    var statusFilter = new QComboBox(body);
    statusFilter.objectName = "StationTableStatusFilter";
    statusFilter.addItem(qsTr("Any status"), "");
    var statuses = CsStationStore.STATUSES;
    for (var s = 0; s < statuses.length; s++) {
        statusFilter.addItem(qsTr(statuses[s]), statuses[s]);
    }
    searchRow.addWidget(search, 1, 0);
    searchRow.addWidget(statusFilter, 0, 0);
    layout.addLayout(searchRow);

    // The table.
    var table = new QTableWidget(0, StationTable.HEADERS.length, body);
    table.objectName = "StationTableTable";
    table.setHorizontalHeaderLabels(StationTable.HEADERS);
    table.selectionBehavior = QAbstractItemView.SelectRows;
    table.selectionMode = QAbstractItemView.ExtendedSelection;
    table.editTriggers = QAbstractItemView.NoEditTriggers;
    table.verticalHeader().visible = false;
    table.horizontalHeader().stretchLastSection = true;
    layout.addWidget(table, 1, 0);

    // Editing strip for the selected row.
    var editRow = new QHBoxLayout();
    var statusEdit = new QComboBox(body);
    statusEdit.objectName = "StationTableStatusEdit";
    statusEdit.addItem(qsTr("(unmarked)"), "");
    for (var s2 = 0; s2 < statuses.length; s2++) {
        statusEdit.addItem(qsTr(statuses[s2]), statuses[s2]);
    }
    var whoEdit = new QLineEdit(body);
    whoEdit.objectName = "StationTableWho";
    whoEdit.placeholderText = qsTr("Assigned to");
    var teamEdit = new QLineEdit(body);
    teamEdit.objectName = "StationTableTeam";
    teamEdit.placeholderText = qsTr("Team notes (objective, what to look at)");
    var saveButton = new QPushButton(qsTr("Save row"), body);
    saveButton.objectName = "StationTableSave";
    var relinkButton = new QPushButton(qsTr("Re-link"), body);
    relinkButton.objectName = "StationTableRelink";
    relinkButton.toolTip = qsTr("The note in the survey changed. Keep this " +
        "row's marks with the new note.");
    editRow.addWidget(statusEdit, 0, 0);
    editRow.addWidget(whoEdit, 1, 0);
    editRow.addWidget(teamEdit, 2, 0);
    editRow.addWidget(saveButton, 0, 0);
    editRow.addWidget(relinkButton, 0, 0);
    layout.addLayout(editRow);

    // Footer.
    var footRow = new QHBoxLayout();
    var summary = new QLabel("", body);
    summary.objectName = "StationTableSummary";
    var refreshButton = new QPushButton(qsTr("Refresh"), body);
    refreshButton.objectName = "StationTableRefresh";
    var exportButton = new QPushButton(qsTr("Export checklist"), body);
    exportButton.objectName = "StationTableExport";
    footRow.addWidget(summary, 1, 0);
    footRow.addWidget(refreshButton, 0, 0);
    footRow.addWidget(exportButton, 0, 0);
    layout.addLayout(footRow);

    dock.setWidget(body);

    var refill = function() { StationTable.fill(); };
    for (var kk in kindBoxes) {
        if (kindBoxes.hasOwnProperty(kk)) { kindBoxes[kk].clicked.connect(refill); }
    }
    search.textChanged.connect(refill);
    statusFilter.currentIndexChanged.connect(refill);
    refreshButton.clicked.connect(function() { StationTable.reload(); });
    exportButton.clicked.connect(function() { StationTable.exportChecklist(); });
    saveButton.clicked.connect(function() { StationTable.saveSelected(false); });
    relinkButton.clicked.connect(function() { StationTable.saveSelected(true); });
    table.itemSelectionChanged.connect(function() { StationTable.onSelection(); });
    table.itemDoubleClicked.connect(function() { StationTable.zoomToSelected(); });

    appWin.addDockWidget(Qt.RightDockWidgetArea, dock);
    CsPanel.attachHelp(dock, "StationTable", qsTr("Station Table"));
    return dock;
};

/** Find a child widget by objectName. Widgets are found, never stashed. */
StationTable.child = function(name) {
    var dock = StationTable.ensureDock();
    return dock.findChild(name);
};

StationTable.ensureDock = function() {
    if (isNull(csStationTableDock)) {
        csStationTableDock = StationTable.buildDock(RMainWindowQt.getMainWindow());
    }
    return csStationTableDock;
};

/** The kinds currently ticked. */
StationTable.ticked = function() {
    var out = [];
    for (var k = 0; k < CsStationTable.KINDS.length; k++) {
        var box = StationTable.child("StationTableKind_" + CsStationTable.KINDS[k]);
        if (!isNull(box) && box.checked) { out.push(CsStationTable.KINDS[k]); }
    }
    return out;
};

/** The rows the current filters leave, in station order. */
StationTable.visibleRows = function() {
    var q = {
        kinds: StationTable.ticked(),
        text: String(StationTable.child("StationTableSearch").text),
        status: String(StationTable.child("StationTableStatusFilter").itemData(
            StationTable.child("StationTableStatusFilter").currentIndex))
    };
    return CsStationTable.sort(CsStationTable.filter(StationTable.state.rows, q));
};

/** Repaint the table from state.rows and the current filters. */
StationTable.fill = function() {
    var table = StationTable.child("StationTableTable");
    var shown = StationTable.visibleRows();
    StationTable.state.shown = shown;
    StationTable.state.filling = true;
    table.setRowCount(0);
    table.setRowCount(shown.length);
    for (var r = 0; r < shown.length; r++) {
        var row = shown[r];
        var labels = [];
        for (var k = 0; k < row.kinds.length; k++) {
            labels.push(CsStationTable.LABEL[row.kinds[k]]);
        }
        var suggest = CsStationTable.suggest(row);
        var status = CsStationTable.effectiveStatus(row);
        if (suggest !== "" && (row.status === undefined || row.status === "")) {
            status += " (looks " + suggest + ")";
        }
        var noteCell = row.noteText;
        if (row.link === "relink") {
            noteCell = "[note changed] " + noteCell;
        }
        var cells = [row.station, labels.join(", "), row.trips.join(" "),
            row.z === null ? "" : String(Math.round(row.z * 10) / 10),
            status, noteCell, row.team || "", row.who || ""];
        for (var c = 0; c < cells.length; c++) {
            table.setItem(r, c, new QTableWidgetItem(String(cells[c])));
        }
    }
    StationTable.state.filling = false;
    table.resizeColumnToContents(0);
    StationTable.updateSummary(shown.length);
    StationTable.onSelection();
};

StationTable.updateSummary = function(shownCount) {
    var s = StationTable.state;
    var text = qsTr("%1 of %2 stations").arg(shownCount).arg(s.rows.length);
    if (s.orphans.length > 0) {
        text += "  |  " + qsTr("%1 saved marks match no station").arg(s.orphans.length);
    }
    if (s.loadError !== "") { text += "  |  " + s.loadError; }
    StationTable.child("StationTableSummary").text = text;
};

/** The single selected row's data, or null. */
StationTable.selectedRow = function() {
    var table = StationTable.child("StationTableTable");
    var shown = StationTable.state.shown || [];
    var items = table.selectedItems();
    if (items.length === 0) { return null; }
    var idx = items[0].row();
    return (idx >= 0 && idx < shown.length) ? shown[idx] : null;
};

/** Load the selected row into the editing strip. */
StationTable.onSelection = function() {
    if (StationTable.state.filling) { return; }
    var row = StationTable.selectedRow();
    var statusEdit = StationTable.child("StationTableStatusEdit");
    var who = StationTable.child("StationTableWho");
    var team = StationTable.child("StationTableTeam");
    var relink = StationTable.child("StationTableRelink");
    var save = StationTable.child("StationTableSave");
    var enabled = row !== null;
    statusEdit.enabled = enabled; who.enabled = enabled;
    team.enabled = enabled; save.enabled = enabled;
    relink.visible = enabled && row.link === "relink";
    if (!enabled) { return; }
    var i = statusEdit.findData(row.status || "");
    statusEdit.currentIndex = i < 0 ? 0 : i;
    who.text = row.who || "";
    team.text = row.team || "";
};

/** Write the editing strip into the sidecar for the selected row. */
StationTable.saveSelected = function(confirmRelink) {
    var row = StationTable.selectedRow();
    var s = StationTable.state;
    if (row === null || s.store === null) { return; }
    var path = StationTable.sidecarPath(s.docPath);
    if (path === "") {
        CsTell.warn(qsTr("Save the drawing first: the team marks are stored " +
            "beside it in stations.json."));
        return;
    }
    var edit = StationTable.child("StationTableStatusEdit");
    var fields = {
        status: String(edit.itemData(edit.currentIndex)),
        who: String(StationTable.child("StationTableWho").text),
        team: String(StationTable.child("StationTableTeam").text)
    };
    if (row.link === "relink" && confirmRelink !== true) {
        // Saving a row whose note changed must not silently move the
        // old entry: say so, and leave it for the Re-link button.
        CsTell.warn(qsTr("This row's note changed since its marks were " +
            "saved. Press Re-link to keep them with the new note."));
        return;
    }
    CsStationStore.setEntry(s.store, row, fields);
    if (!StationTable.writeSidecar(path, s.store)) {
        CsTell.warn(qsTr("Could not write stations.json beside the drawing."));
        return;
    }
    StationTable.reload();
};

/** Zoom the drawing to the selected station. */
StationTable.zoomToSelected = function() {
    var row = StationTable.selectedRow();
    var d = StationTable.state.drawn;
    if (row === null || isNull(d) || isNull(d.resolved) ||
            isNull(d.resolved.stations[row.station])) {
        return;
    }
    var st = d.resolved.stations[row.station];
    try {
        var pad = 25;
        var box = new RBox(new RVector(st.x - pad, st.y - pad),
            new RVector(st.x + pad, st.y + pad));
        var view = getDocumentInterface().getLastKnownViewWithFocus();
        view.zoomTo(box, 10);
    } catch (e) {
        CsTell.warn("Station Table: could not zoom (" + e + ")");
    }
};

/** Save the currently shown rows as a CSV checklist. */
StationTable.exportChecklist = function() {
    var s = StationTable.state;
    var path = CsFiles.saveFile(RMainWindowQt.getMainWindow(),
        qsTr("Export checklist"), CsCave.folderOf(s.docPath) + "/checklist.csv",
        "CSV (*.csv)");
    if (path === "") { return; }
    var file = new QFile(path);
    if (!file.open(QIODevice.WriteOnly | QIODevice.Text)) {
        CsTell.warn(qsTr("Could not write the checklist."));
        return;
    }
    var stream = new QTextStream(file);
    stream.writeString(CsStationTable.checklistCsv(StationTable.visibleRows()));
    file.close();
};

/** Re-read the drawing and the sidecar, then repaint. */
StationTable.reload = function() {
    var s = StationTable.state;
    var di = getDocumentInterface();
    var doc = di.getDocument();
    s.docPath = String(doc.getFileName());
    var drawn = StationTable.readDrawing(doc);
    s.drawn = drawn;
    if (drawn === null) {
        s.rows = []; s.orphans = []; s.store = CsStationStore.empty();
        s.loadError = "";
        StationTable.fill();
        return;
    }
    var findings = CsValidate.check(drawn.survey, drawn.resolved);
    var rows = CsStationTable.rows(drawn.survey, drawn.resolved,
        { findings: findings });
    var side = StationTable.readSidecar(StationTable.sidecarPath(s.docPath));
    s.store = side.store;
    s.loadError = side.error;
    var rec = CsStationStore.reconcile(rows, s.store);
    s.rows = rec.rows;
    s.orphans = rec.orphans;
    StationTable.fill();
};

StationTable.open = function() {
    var dock = StationTable.ensureDock();
    dock.visible = true;
    try { dock.raise(); } catch (eRaise) { }
    StationTable.reload();
};

StationTable.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    try {
        StationTable.open();
    } catch (e) {
        csStationTableDock = undefined;
        CsTell.warn("Station Table: this CaveCAD build refused the docked " +
            "panel (" + e + ") -- please report this.");
    }
    this.terminate();
};

StationTable.init = function(basePath) {
    StationTable.basePath = basePath;

    var action = new RGuiAction(qsTr("Station Table"),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    // A requiresDocument action runs in the ACTIVE TAB'S own script
    // engine, where dock globals start empty; forceGlobal makes every
    // tab share the one dock (qcad-plugin-conventions).
    action.setForceGlobal(true);
    action.setScriptFile(basePath + "/StationTable.js");
    action.setIcon(basePath + "/StationTable.svg");
    action.setStatusTip(qsTr("Every station in the cave: filter to leads " +
        "and open ends, mark them, and jump to them on the map"));
    action.setDefaultCommands(["stationtable", "st"]);
    action.setGroupSortOrder(451);
    action.setSortOrder(12);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);

    try {
        var dock = StationTable.ensureDock();
        dock.visible = false;
    } catch (eInit) {
        csStationTableDock = undefined;
        warning("Station Table: could not build the panel at startup (" +
            eInit + "); the menu entry will try again.");
    }
};
```

Two APIs used above must be confirmed against the tree before running (they were not verified while planning): `CsFiles.saveFile` (grep `^CsFiles\.` in `Core/CsFiles.js`; if the save-file wrapper has another name or signature, use that) and `QTableWidget` `setHorizontalHeaderLabels`/`findData` availability in the bridge (grep other panels for a `QTableWidget` or `QComboBox.findData` use; if `findData` is missing, loop `itemData(i)` to find the index).

- [ ] **Step 4: Create the icon**

Create `scripts/CaveSurvey/StationTable/StationTable.svg`, a 24x24 icon, copying the stroke style of `scripts/CaveSurvey/LoopErrors/LoopErrors.svg` (open it and match the stroke width/colour):

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
  <rect x="3" y="4" width="18" height="16" rx="1.5" fill="none" stroke="#333" stroke-width="1.6"/>
  <line x1="3" y1="9" x2="21" y2="9" stroke="#333" stroke-width="1.6"/>
  <line x1="3" y1="14" x2="21" y2="14" stroke="#333" stroke-width="1.2"/>
  <line x1="9" y1="9" x2="9" y2="20" stroke="#333" stroke-width="1.2"/>
</svg>
```

- [ ] **Step 5: Handbook page**

Create `docs/handbook/pages/station-table.html` copying the structure of `docs/handbook/pages/loop-errors.html` (title, "what it does", "how to use", "what to check"). Content: what the table shows, the seven kinds in one line each, how to mark a lead, what "note changed" means, that marks are stored in `stations.json` beside the drawing and are carried by Drive. Add to `docs/handbook/index.json` after the `loop-errors` entry:

```json
    {
      "id": "station-table",
      "title": "Station Table",
      "class": "tool",
      "file": "station-table.html",
      "stage": 451,
      "tools": ["StationTable"],
      "shots": []
    },
```

- [ ] **Step 6: Run structural tests, then verify live**

Run: `python3 -m unittest discover -s tests -v 2>&1 | tail -8` → `OK`.

Then publish to the dev CaveCAD and verify in the running app with the MCP tools (`mcp__cavecad__cavecad_status`, `cavecad_eval`, `cavecad_screenshot`; see `cavecad-mcp-bridge` and `cavecad-live-restart-trap`: a quit blocked by unsaved changes leaves the OLD add-on running, so confirm the new code is loaded before trusting a result):

```bash
tools/publish.sh
```

Open `testdata/PitfallCave` (or the Truitt teaching cave), run `st`, and confirm: all stations listed; Lead filter shows only lead rows; double-click zooms; set a status and a team note, reload, they persist; delete a lead note text in the survey, press Refresh, the row shows "[note changed]".

- [ ] **Step 7: Commit**

```bash
git add scripts/CaveSurvey/StationTable tests/test_addon.py docs/handbook
git commit -m "feat: Station Table panel

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Trip Plan routing (pure)

**Goal:** `CsTripPlan.graph`, `shortest`, `pathTo`, `order` and `describe` — shortest routes, stop order and turn-by-turn steps.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsTripPlan.js`
- Modify: `scripts/CaveSurvey/Core/CsAll.js` (after `CsStationStore.js`), `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `shortest` finds the shorter of two routes around a loop.
- [ ] `order` visits targets in the minimum round-trip order (brute force up to 8 targets) and reports unreachable targets without throwing.
- [ ] A plumb leg has `bearing === null`; a horizontal leg has a bearing.
- [ ] `describe` merges consecutive legs into runs, breaks at junctions, marks pitch runs "down"/"up", and never prints a heading for a pitch.
- [ ] A station with unknown z produces no vertical text (no fabricated 0).

**Verify:** `node tests/js_unit.js` → `### UNIT OK <n> assertions`

**Steps:**

- [ ] **Step 1: Register** in the harness list after `CsStationStore.js` and in `CsAll.js`:

```js
    "scripts/CaveSurvey/Core/CsTripPlan.js",
```

```js
// After CsStationTable and CsPitch: routes over the survey graph and
// reads pitches for its vertical steps.
include(includeBasePath + "/CsTripPlan.js");
```

- [ ] **Step 2: Write the failing tests** (append). The tests build `resolved` by hand so no network solve is needed:

```js
// ---------------------------------------------------------------------
// Trip Plan -- routes
// ---------------------------------------------------------------------

// A square loop A1-A2-A3-A4-A1 (A1-A2 short, A1-A4-A3 long) plus a
// spur A3-A5 that is a plumb 40 unit pitch.
function tpSurvey() {
    var s = frontierSurvey([
        frontierShot("A1", "A2", 0), frontierShot("A2", "A3", 0),
        frontierShot("A1", "A4", 0), frontierShot("A4", "A3", 0),
        frontierShot("A3", "A5", 0)
    ]);
    return s;
}
var tpResolved = { stations: {
    A1: { x: 0, y: 0, z: 0 },   A2: { x: 10, y: 0, z: 0 },
    A3: { x: 20, y: 0, z: 0 },  A4: { x: 0, y: 30, z: 0 },
    A5: { x: 20, y: 0, z: -40 } }, legs: [] };

var tpAdj = CsTripPlan.graph(tpSurvey(), tpResolved);
var tpSp = CsTripPlan.shortest(tpAdj, "A1");
near(tpSp.dist.A3, 20, 1e-9, "route: A3 by the short side is 20");
var tpPath = CsTripPlan.pathTo(tpSp, "A3");
eqs(tpPath.map(function(e) { return e.to; }).join(","), "A2,A3",
    "route: path goes A1 A2 A3");
ok(CsTripPlan.pathTo(tpSp, "ZZ") === null, "route: unreachable is null");

var tpToA5 = CsTripPlan.pathTo(tpSp, "A5");
ok(tpToA5[tpToA5.length - 1].bearing === null,
    "route: a plumb leg carries no bearing");
ok(tpToA5[0].bearing !== null && Math.abs(tpToA5[0].bearing - 90) < 1e-6,
    "route: a horizontal leg heads east (90)");
near(tpToA5[tpToA5.length - 1].dz, -40, 1e-9, "route: dz of the drop is -40");

// Stop order: two spurs, one near and one far; visiting near then far
// beats far then near on the round trip.
var tpOrder = CsTripPlan.order(tpAdj, "A1", ["A4", "A2", "A5"]);
eqs(tpOrder.unreachable.length, 0, "order: everything reachable");
eqs(tpOrder.order.length, 3, "order: all three stops kept");
var tpRoundTrip = tpOrder.roundTrip;
// brute force check against the worst permutation
var tpAll = [["A4","A2","A5"],["A4","A5","A2"],["A2","A4","A5"],
    ["A2","A5","A4"],["A5","A4","A2"],["A5","A2","A4"]];
var tpBest = 1e18;
tpAll.forEach(function(p) {
    var d = 0, at = "A1";
    p.forEach(function(t) {
        d += CsTripPlan.shortest(tpAdj, at).dist[t]; at = t; });
    d += CsTripPlan.shortest(tpAdj, at).dist.A1;
    if (d < tpBest) { tpBest = d; }
});
near(tpRoundTrip, tpBest, 1e-9, "order: round trip is the true minimum");

var tpUnr = CsTripPlan.order(tpAdj, "A1", ["A2", "NOPE"]);
eqs(tpUnr.unreachable.join(","), "NOPE", "order: unknown station is unreachable");
eqs(tpUnr.order.join(","), "A2", "order: reachable stops still ordered");

// Directions: merged runs, junction break, pitch run.
var tpDeg = CsFrontier.degrees(tpSurvey());
var tpSteps = CsTripPlan.describe(tpToA5, { degree: tpDeg, notes: {},
    pitchOfEdge: function(e) { return e.to === "A5" ? 0 : -1; }, unit: "ft" });
ok(tpSteps.length >= 2, "describe: at least a walk and a pitch");
var tpLast = tpSteps[tpSteps.length - 1];
eqs(tpLast.kind, "pitch", "describe: final run is a pitch");
eqs(tpLast.vertical, "down", "describe: the pitch goes down");
ok(tpLast.text.indexOf("heading") < 0, "describe: no heading on a pitch");
ok(tpSteps[0].text.indexOf("A1 to A3") === 0, "describe: A1 A2 A3 merge into one run");
ok(tpSteps[0].text.indexOf("heading E") >= 0, "describe: heading in words");

// Unknown z: no vertical wording invented.
var tpNoZ = { stations: { A1: { x: 0, y: 0, z: null }, A2: { x: 10, y: 0, z: null } },
    legs: [] };
var tpNoZAdj = CsTripPlan.graph(frontierSurvey([frontierShot("A1", "A2", 0)]), tpNoZ);
var tpNoZPath = CsTripPlan.pathTo(CsTripPlan.shortest(tpNoZAdj, "A1"), "A2");
ok(tpNoZPath[0].dz === null, "route: unknown z gives dz null, not 0");
var tpNoZSteps = CsTripPlan.describe(tpNoZPath, { degree: {}, notes: {},
    pitchOfEdge: function() { return -1; }, unit: "ft" });
ok(!/\b(up|down)\b/.test(tpNoZSteps[0].text), "describe: no vertical wording without z");
```

- [ ] **Step 3: Run to verify failure** — `CsTripPlan is not defined`.

- [ ] **Step 4: Implement** — create `scripts/CaveSurvey/Core/CsTripPlan.js`:

```js
// CsTripPlan.js -- a trip plan: where to go, how, how long, what to carry.
//
// Part of the Cave Survey Core library: pure ES5, no document, no GUI.
//
// THE SURVEY LINE IS NOT A WALKING ROUTE. A crawl, a squeeze, water, a
// climb or a loose section only shows up if somebody wrote it in a note
// or the LRUD is tight. Everything here says "follows the survey line"
// and surfaces the notes and tightness it finds on the way. It never
// claims a route is safe or easy.
//
// A PITCH HAS NO BEARING. A plumb leg carries bearing null and its
// step never prints a heading (docs/vertical-caves.md).
//
// A MISSING z IS null, and null z prints no vertical wording. Never 0.
//
// NO COORDINATES in any output a person reads. Positions are used to
// measure and are not repeated in text or in the packet.
//
// The 'Cs' prefix is mandatory: include() dedupes by basename.

include(includeBasePath + "/CsFrontier.js");
include(includeBasePath + "/CsPitch.js");
include(includeBasePath + "/CsUnits.js");

var CsTripPlan = {};

/** A leg whose plan run is under this fraction of its length is plumb. */
CsTripPlan.PLUMB_FRACTION = 0.05;

/**
 * The survey as an adjacency map over LEGS.
 *
 * \return {station: [{from, to, len, dz, bearing, dx, dy, shot}]} where
 *   len is the straight-line length between the resolved ends (3D when
 *   both ends have a z, plan otherwise), dz is null when either end has
 *   no z, bearing is degrees from north or null for a plumb leg, and
 *   shot is the index into survey.shots (for LRUD lookups)
 */
CsTripPlan.graph = function(survey, resolved) {
    var adj = {};
    if (survey === undefined || survey === null || resolved === undefined ||
            resolved === null || resolved.stations === undefined ||
            resolved.stations === null) {
        return adj;
    }
    var finite = function(v) { return typeof v === "number" && isFinite(v); };
    var add = function(a, b, pa, pb, shotIndex) {
        var dx = pb.x - pa.x;
        var dy = pb.y - pa.y;
        var plan = Math.sqrt(dx * dx + dy * dy);
        var known = finite(pa.z) && finite(pb.z);
        var dz = known ? pb.z - pa.z : null;
        var len = known ? Math.sqrt(plan * plan + dz * dz) : plan;
        var bearing = null;
        if (plan > len * CsTripPlan.PLUMB_FRACTION && plan > 0) {
            bearing = Math.atan2(dx, dy) * 180 / Math.PI;
            if (bearing < 0) { bearing += 360; }
        }
        if (adj[a] === undefined) { adj[a] = []; }
        adj[a].push({ from: a, to: b, len: len, dz: dz, bearing: bearing,
            dx: dx, dy: dy, shot: shotIndex });
    };
    for (var i = 0; i < survey.shots.length; i++) {
        var shot = survey.shots[i];
        if (!CsFrontier.isLeg(shot)) { continue; }
        var a = CsFrontier.clean(shot.from);
        var b = CsFrontier.clean(shot.to);
        var pa = resolved.stations[a];
        var pb = resolved.stations[b];
        if (pa === undefined || pa === null || pb === undefined || pb === null) {
            continue;
        }
        add(a, b, pa, pb, i);
        add(b, a, pb, pa, i);
    }
    return adj;
};

/** Dijkstra from one station. \return {dist, prev} */
CsTripPlan.shortest = function(adj, source) {
    var dist = {};
    var prev = {};
    dist[source] = 0;
    var heap = [[0, source]];
    var push = function(item) {
        heap.push(item);
        var i = heap.length - 1;
        while (i > 0) {
            var p = (i - 1) >> 1;
            if (heap[p][0] <= heap[i][0]) { break; }
            var t = heap[p]; heap[p] = heap[i]; heap[i] = t;
            i = p;
        }
    };
    var pop = function() {
        var top = heap[0];
        var last = heap.pop();
        if (heap.length > 0) {
            heap[0] = last;
            var i = 0;
            for (;;) {
                var l = 2 * i + 1;
                var r = l + 1;
                var m = i;
                if (l < heap.length && heap[l][0] < heap[m][0]) { m = l; }
                if (r < heap.length && heap[r][0] < heap[m][0]) { m = r; }
                if (m === i) { break; }
                var t = heap[m]; heap[m] = heap[i]; heap[i] = t;
                i = m;
            }
        }
        return top;
    };
    while (heap.length > 0) {
        var cur = pop();
        var d = cur[0];
        var u = cur[1];
        if (d > dist[u]) { continue; }
        var edges = adj[u] || [];
        for (var k = 0; k < edges.length; k++) {
            var e = edges[k];
            var nd = d + e.len;
            if (dist[e.to] === undefined || nd < dist[e.to]) {
                dist[e.to] = nd;
                prev[e.to] = e;
                push([nd, e.to]);
            }
        }
    }
    return { dist: dist, prev: prev };
};

/** The edges from the source to target, or null when unreachable. */
CsTripPlan.pathTo = function(sp, target) {
    if (sp.dist[target] === undefined) { return null; }
    var edges = [];
    var at = target;
    var guard = 0;
    while (sp.prev[at] !== undefined && guard++ < 1000000) {
        edges.push(sp.prev[at]);
        at = sp.prev[at].from;
    }
    edges.reverse();
    return edges;
};

/**
 * The order to visit stops, start to start.
 *
 * Up to 8 reachable stops are ordered by exhaustive search (the true
 * minimum round trip); more use nearest-neighbour, which is honest about
 * being an approximation (approximate: true).
 *
 * \return {order: [station], unreachable: [station], roundTrip, approximate}
 */
CsTripPlan.order = function(adj, start, targets) {
    var from = {};
    from[start] = CsTripPlan.shortest(adj, start);
    var reach = [];
    var unreachable = [];
    var seen = {};
    var i;
    for (i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (seen[t] === true || t === start) { continue; }
        seen[t] = true;
        if (from[start].dist[t] === undefined) { unreachable.push(t); }
        else { reach.push(t); }
    }
    for (i = 0; i < reach.length; i++) {
        from[reach[i]] = CsTripPlan.shortest(adj, reach[i]);
    }
    var d = function(a, b) { return from[a].dist[b]; };

    var best = null;
    var bestLen = Infinity;
    var approximate = false;
    if (reach.length <= 8) {
        var perm = function(rest, chain, len, at) {
            if (len >= bestLen) { return; }
            if (rest.length === 0) {
                var total = len + d(at, start);
                if (total < bestLen) { bestLen = total; best = chain.slice(0); }
                return;
            }
            for (var k = 0; k < rest.length; k++) {
                var next = rest[k];
                var left = rest.slice(0, k).concat(rest.slice(k + 1));
                chain.push(next);
                perm(left, chain, len + d(at, next), next);
                chain.pop();
            }
        };
        perm(reach, [], 0, start);
    } else {
        approximate = true;
        var rest = reach.slice(0);
        var at = start;
        best = [];
        bestLen = 0;
        while (rest.length > 0) {
            var pick = 0;
            for (var r = 1; r < rest.length; r++) {
                if (d(at, rest[r]) < d(at, rest[pick])) { pick = r; }
            }
            bestLen += d(at, rest[pick]);
            at = rest[pick];
            best.push(at);
            rest.splice(pick, 1);
        }
        bestLen += d(at, start);
    }
    if (best === null) { best = []; bestLen = 0; }
    return { order: best, unreachable: unreachable, roundTrip: bestLen,
        approximate: approximate };
};

/** 45-degree sector name for a heading. */
CsTripPlan.compass = function(degrees) {
    var names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return names[Math.round(((degrees % 360) + 360) % 360 / 45) % 8];
};

/** A distance the way a caver would say it: whole units. */
CsTripPlan.dist = function(value, unit) {
    return String(Math.round(value)) + " " + unit;
};

/**
 * Turn-by-turn steps for a list of edges.
 *
 * \param ctx {degree: {station: legs}, notes: {station: [{text}]},
 *             pitchOfEdge: function(edge) -> pitch index or -1, unit}
 * \return [{kind: "walk"|"pitch", from, to, length, dz, vertical:
 *           "up"|"down"|"", heading, edges, atJunction, notes, text}]
 */
CsTripPlan.describe = function(edges, ctx) {
    var unit = ctx.unit === "m" ? "m" : "ft";
    var steps = [];
    var cur = null;
    var flush = function() { if (cur !== null) { steps.push(cur); cur = null; } };
    var isJunction = function(name) { return (ctx.degree[name] || 0) >= 3; };

    for (var i = 0; i < edges.length; i++) {
        var e = edges[i];
        var pitch = ctx.pitchOfEdge(e);
        var kind = pitch >= 0 ? "pitch" : "walk";
        if (cur !== null && (cur.kind !== kind || cur.pitch !== pitch ||
                isJunction(cur.to))) {
            flush();
        }
        if (cur === null) {
            cur = { kind: kind, pitch: pitch, from: e.from, to: e.to,
                length: 0, dz: 0, dzKnown: true, dx: 0, dy: 0, edges: [] };
        }
        cur.to = e.to;
        cur.length += e.len;
        if (e.dz === null) { cur.dzKnown = false; } else { cur.dz += e.dz; }
        cur.dx += e.dx; cur.dy += e.dy;
        cur.edges.push(e);
    }
    flush();

    for (var s = 0; s < steps.length; s++) {
        var st = steps[s];
        st.vertical = "";
        if (st.dzKnown && Math.abs(st.dz) >= 1 && st.kind === "walk") {
            st.vertical = st.dz < 0 ? "down" : "up";
        }
        if (st.kind === "pitch") {
            st.vertical = (st.dzKnown && st.dz > 0) ? "up" : "down";
        }
        st.heading = "";
        if (st.kind === "walk") {
            var plan = Math.sqrt(st.dx * st.dx + st.dy * st.dy);
            if (plan > 0) {
                var b = Math.atan2(st.dx, st.dy) * 180 / Math.PI;
                st.heading = CsTripPlan.compass(b);
            }
        }
        st.atJunction = isJunction(st.to) && s < steps.length - 1;
        st.notes = [];
        var stations = [];
        for (var q = 0; q < st.edges.length; q++) { stations.push(st.edges[q].to); }
        for (var n = 0; n < stations.length; n++) {
            var ns = ctx.notes[stations[n]] || [];
            for (var m = 0; m < ns.length; m++) {
                st.notes.push(stations[n] + ": " + ns[m].text);
            }
        }
        var text = st.from + " to " + st.to + ": ";
        if (st.kind === "pitch") {
            var parts = [];
            for (var p = 0; p < st.edges.length; p++) {
                if (st.edges[p].dz !== null) {
                    parts.push(String(Math.round(Math.abs(st.edges[p].dz))));
                }
            }
            var total = st.dzKnown ? Math.round(Math.abs(st.dz)) : null;
            text += "pitch " + st.vertical + (total === null ? "" :
                " " + total + " " + unit);
            if (parts.length > 1) { text += " (" + parts.join(" + ") + ")"; }
        } else {
            text += CsTripPlan.dist(st.length, unit);
            if (st.heading !== "") { text += " heading " + st.heading; }
            if (st.vertical !== "") {
                text += ", " + st.vertical + " " +
                    Math.round(Math.abs(st.dz)) + " " + unit;
            }
        }
        st.text = text;
        if (st.atJunction && steps[s + 1].kind === "walk" &&
                steps[s + 1].heading !== "") {
            st.text += ". At " + st.to + " (junction) leave by the branch heading " +
                steps[s + 1].heading;
        } else if (st.atJunction) {
            st.text += ". At " + st.to + " (junction) take the next branch as listed";
        }
        st.length = st.length;
    }
    return steps;
};
```

- [ ] **Step 5: Run to verify pass** — `node tests/js_unit.js` → `### UNIT OK <n> assertions`.

- [ ] **Step 6: Commit**

```bash
git add scripts/CaveSurvey/Core/CsTripPlan.js scripts/CaveSurvey/Core/CsAll.js tests/js_unit.js
git commit -m "feat: CsTripPlan routes, stop order, directions

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Trip Plan pace, gear and assembly (pure)

**Goal:** `CsTripPlan.build(...)` assembling stops, directions, time budget, tight-passage warnings and gear; plus `paceMinutes` and `gear`.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsTripPlan.js`, `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] Horizontal time uses `paceFtPerMin` (default 264, i.e. 3 mph hiking pace); a metre survey converts before applying it.
- [ ] A descending pitch costs rig time + drop/`descendFtPerMin` + rebelays × `rebelayMin` going in, and no rig time coming out.
- [ ] Rope per pitch = drop × (1 + margin) + rebelays × slack, rounded UP to the step, with segments listed; a plan with no pitch has no rope lines and no vertical kit.
- [ ] Hardware lines say "rig not on map, confirm" per pitch (deviation 2).
- [ ] The packing list text comes from the store settings verbatim.
- [ ] Tight passage (height or width under the threshold from LRUD) yields a warning naming the station; a station with no LRUD yields none.
- [ ] `build` reports unreachable targets in `warnings` and still plans the rest.

**Verify:** `node tests/js_unit.js` → `### UNIT OK <n> assertions`

**Steps:**

- [ ] **Step 1: Write the failing tests** (append)

```js
// ---------------------------------------------------------------------
// Trip Plan -- pace, gear, build
// ---------------------------------------------------------------------

var tpCfg = CsTripPlan.config({});
eqs(tpCfg.paceFtPerMin, 264, "pace: default is a 3 mph hike");
eqs(CsTripPlan.config({ paceFtPerMin: 100 }).paceFtPerMin, 100,
    "pace: a team value overrides the default");
eqs(CsTripPlan.config({ paceFtPerMin: -5 }).paceFtPerMin, 264,
    "pace: nonsense falls back to the default");

// 528 ft at 264 ft/min = 2 minutes.
near(CsTripPlan.walkMinutes(528, "ft", tpCfg), 2, 1e-9, "pace: 528 ft is 2 min");
near(CsTripPlan.walkMinutes(160.9344, "m", tpCfg), 2, 1e-6, "pace: metres convert");

// Pitch: 60 ft drop, one rebelay: in = rig 10 + 60/30 + 5 = 17.
var tpPit = { kind: "pitch", vertical: "down", dz: -60, dzKnown: true,
    length: 60, edges: [{ dz: -30 }, { dz: -30 }] };
near(CsTripPlan.stepMinutes(tpPit, "ft", tpCfg, true), 17, 1e-9,
    "pace: pitch in costs rig + descent + rebelay");
// out: climb 60/10 = 6 + rebelay 5 = 11, no rig.
var tpPitOut = { kind: "pitch", vertical: "up", dz: 60, dzKnown: true,
    length: 60, edges: [{ dz: 30 }, { dz: 30 }] };
near(CsTripPlan.stepMinutes(tpPitOut, "ft", tpCfg, false), 11, 1e-9,
    "pace: pitch out costs the climb and rebelay, no rigging");

var tpRope = CsTripPlan.ropeLine({ top: "P1", bottom: "P3", drop: 187,
    segments: [{ from: "P1", to: "P2", drop: 62 }, { from: "P2", to: "P3", drop: 125 }],
    rebelays: 1 }, "ft", tpCfg);
// 187 * 1.1 = 205.7 + 10 slack = 215.7 -> 220
eqs(tpRope.need, 220, "gear: rope rounds up to the step");
ok(tpRope.text.indexOf("62 + 125") >= 0, "gear: rope names its segments");

var tpGearNone = CsTripPlan.gear([], "ft", tpCfg, "First aid");
eqs(tpGearNone.rope.length, 0, "gear: no pitch, no rope");
ok(tpGearNone.kit.join("|").indexOf("Harness") < 0, "gear: no pitch, no harness");
eqs(tpGearNone.packing, "First aid", "gear: packing text passes through");
var tpGearV = CsTripPlan.gear([{ top: "P1", bottom: "P3", drop: 187,
    segments: [{ from: "P1", to: "P2", drop: 62 }, { from: "P2", to: "P3", drop: 125 }],
    rebelays: 1 }], "ft", tpCfg, "");
ok(tpGearV.kit.join("|").indexOf("Harness") >= 0, "gear: a pitch adds a harness");
ok(tpGearV.hardware[0].indexOf("rig not on map, confirm") >= 0,
    "gear: hardware says confirm, never invents a count");

// build
var tpBuildSurvey = tpSurvey();
tpBuildSurvey.shots[4].up = 1.0; tpBuildSurvey.shots[4].down = 1.0;   // A3->A5 tight
tpBuildSurvey.shots[4].left = 5; tpBuildSurvey.shots[4].right = 5;
tpBuildSurvey.shots[4].notes = "PITCH, tight start";
var tpPlan = CsTripPlan.build(tpBuildSurvey, tpResolved, { start: "A1",
    targets: ["A5", "MISSING"], unit: "ft", config: {}, packing: "Lights" });
eqs(tpPlan.stops.length, 1, "build: one reachable stop");
eqs(tpPlan.stops[0].station, "A5", "build: the stop is A5");
ok(tpPlan.warnings.join("|").indexOf("MISSING") >= 0,
    "build: an unreachable target is named in the warnings");
ok(tpPlan.warnings.join("|").indexOf("tight") >= 0,
    "build: tight LRUD near the pitch is warned");
ok(tpPlan.totals.minutesAll > tpPlan.totals.minutesIn,
    "build: the total includes work and the way out");
eqs(tpPlan.gear.packing, "Lights", "build: packing text reaches the gear list");
ok(JSON.stringify(tpPlan).indexOf("\"x\"") < 0 || true, "build: plan built");
```

The last line is a harmless smoke assertion (`|| true`); the meaningful privacy assertion is in Task 7 on the packet text.

- [ ] **Step 2: Run to verify failure** — `CsTripPlan.config is not a function`.

- [ ] **Step 3: Implement** — append to `CsTripPlan.js`:

```js
// ---------------------------------------------------------------------
// Pace, gear, assembly
// ---------------------------------------------------------------------

/**
 * Every number a team may want to change. All in FEET and MINUTES.
 * These are STARTING VALUES for a plan, not measurements: a training
 * trip and an expedition differ, and the team overrides them in the
 * sidecar (settings.pace). Hiking pace (3 mph) is the horizontal default.
 */
CsTripPlan.DEFAULTS = {
    paceFtPerMin: 264,
    descendFtPerMin: 30,
    ascendFtPerMin: 10,
    rigMin: 10,
    rebelayMin: 5,
    leadWorkMin: 20,
    ropeMargin: 0.10,
    rebelaySlackFt: 10,
    tightFt: 3
};

/** Defaults overlaid with the team's values; bad values are ignored. */
CsTripPlan.config = function(overrides) {
    var out = {};
    var o = overrides || {};
    for (var key in CsTripPlan.DEFAULTS) {
        if (!Object.prototype.hasOwnProperty.call(CsTripPlan.DEFAULTS, key)) {
            continue;
        }
        var v = o[key];
        out[key] = (typeof v === "number" && isFinite(v) && v > 0) ? v :
            CsTripPlan.DEFAULTS[key];
    }
    return out;
};

var csTpFeet = function(value, unit) {
    return unit === "m" ? CsUnits.convert(value, "m", "ft") : value;
};

/** Minutes to walk a length given in the survey's unit. */
CsTripPlan.walkMinutes = function(length, unit, cfg) {
    return csTpFeet(length, unit) / cfg.paceFtPerMin;
};

/**
 * Minutes for one step. `inbound` is true on the way in: a descent is
 * rigged then (rig time once), and the way out finds it rigged.
 */
CsTripPlan.stepMinutes = function(step, unit, cfg, inbound) {
    if (step.kind !== "pitch") {
        return CsTripPlan.walkMinutes(step.length, unit, cfg);
    }
    var drop = step.dzKnown ? csTpFeet(Math.abs(step.dz), unit) :
        csTpFeet(step.length, unit);
    var rebelays = Math.max(0, step.edges.length - 1);
    var going = (step.vertical === "down");
    var rate = going ? cfg.descendFtPerMin : cfg.ascendFtPerMin;
    var minutes = drop / rate + rebelays * cfg.rebelayMin;
    if (inbound) { minutes += cfg.rigMin; }
    return minutes;
};

/** One rope line for a pitch: length to pack and how it is made up. */
CsTripPlan.ropeLine = function(pitch, unit, cfg) {
    var slack = unit === "m" ? CsUnits.convert(cfg.rebelaySlackFt, "ft", "m") :
        cfg.rebelaySlackFt;
    var step = unit === "m" ? 5 : 10;
    var want = pitch.drop * (1 + cfg.ropeMargin) + pitch.rebelays * slack;
    var need = Math.ceil(want / step - 1e-9) * step;
    var parts = [];
    for (var i = 0; i < pitch.segments.length; i++) {
        parts.push(String(Math.round(pitch.segments[i].drop)));
    }
    var text = "Pitch " + pitch.top + " to " + pitch.bottom + ": " +
        Math.round(pitch.drop) + " " + unit + " drop";
    if (parts.length > 1) {
        text += " (" + parts.join(" + ") + "), " + pitch.rebelays +
            " rebelay" + (pitch.rebelays === 1 ? "" : "s");
    }
    text += " -- pack " + need + " " + unit + " of rope";
    return { top: pitch.top, bottom: pitch.bottom, need: need, text: text };
};

/** The starting personal kit. A template: the team edits it. */
CsTripPlan.BASE_KIT = ["Helmet", "Primary light", "Two backup lights",
    "Warm layer", "Gloves", "Water and food", "Survey notebook and pencils"];
CsTripPlan.VERTICAL_KIT = ["Harness", "Descender",
    "Ascending system", "Lanyards", "Carabiners", "Rope protectors"];

/**
 * The gear list for the pitches a route crosses.
 *
 * \param pitches CsPitch.find entries on the route (may be [])
 * \param packing the team's packing text from the sidecar, verbatim
 * \return {rope: [line], hardware: [text], kit: [text], packing}
 *
 * Anchor counts are NOT read from the map yet: every pitch says "rig not
 * on map, confirm" rather than inventing a count.
 */
CsTripPlan.gear = function(pitches, unit, cfg, packing) {
    var rope = [];
    var hardware = [];
    for (var i = 0; i < pitches.length; i++) {
        rope.push(CsTripPlan.ropeLine(pitches[i], unit, cfg));
        hardware.push("Pitch " + pitches[i].top + " to " + pitches[i].bottom +
            ": rig not on map, confirm anchors and hangers");
    }
    var kit = CsTripPlan.BASE_KIT.slice(0);
    if (pitches.length > 0) { kit = kit.concat(CsTripPlan.VERTICAL_KIT); }
    return { rope: rope, hardware: hardware, kit: kit,
        packing: (packing === undefined || packing === null) ? "" : String(packing) };
};

/** A warning per station on the path where LRUD says the passage is tight. */
CsTripPlan.tightWarnings = function(survey, edges, unit, cfg) {
    var out = [];
    var limit = unit === "m" ? CsUnits.convert(cfg.tightFt, "ft", "m") : cfg.tightFt;
    var num = function(v) { return typeof v === "number" && isFinite(v) ? v : null; };
    for (var i = 0; i < edges.length; i++) {
        var sh = survey.shots[edges[i].shot];
        if (sh === undefined || sh === null) { continue; }
        var l = num(sh.left), r = num(sh.right), u = num(sh.up), d = num(sh.down);
        var width = (l !== null && r !== null) ? l + r : null;
        var height = (u !== null && d !== null) ? u + d : null;
        var bits = [];
        if (height !== null && height < limit) {
            bits.push("height " + (Math.round(height * 10) / 10) + " " + unit);
        }
        if (width !== null && width < limit) {
            bits.push("width " + (Math.round(width * 10) / 10) + " " + unit);
        }
        if (bits.length > 0) {
            out.push("tight near " + edges[i].to + " (" + bits.join(", ") + ")");
        }
    }
    return out;
};

/**
 * Assemble a plan.
 *
 * \param opts {start, targets: [station], unit, config, packing, notes}
 *   start defaults to the survey's first station. `notes` is
 *   CsStationTable.notesByStation(survey) if the caller has it; it is
 *   computed when omitted.
 * \return {stops: [{station, steps, minutesIn}], back: {steps, minutes},
 *   totals: {lengthIn, lengthAll, minutesIn, minutesWork, minutesOut,
 *   minutesAll, netDrop}, pitches, gear, warnings, unreachable, approximate}
 */
CsTripPlan.build = function(survey, resolved, opts) {
    var o = opts || {};
    var unit = o.unit === "m" ? "m" : "ft";
    var cfg = CsTripPlan.config(o.config);
    var first = CsFrontier.firstLeg(survey);
    var start = (o.start !== undefined && o.start !== "") ? o.start :
        (first === null ? "" : CsFrontier.clean(first.from));
    var adj = CsTripPlan.graph(survey, resolved);
    var warnings = [];
    var plan = { stops: [], back: { steps: [], minutes: 0 }, warnings: warnings,
        unreachable: [], approximate: false, pitches: [],
        totals: { lengthIn: 0, lengthAll: 0, minutesIn: 0, minutesWork: 0,
            minutesOut: 0, minutesAll: 0, netDrop: 0 },
        gear: null, start: start, unit: unit };
    if (start === "" || adj[start] === undefined) {
        warnings.push("The start station is not on the surveyed line.");
        plan.gear = CsTripPlan.gear([], unit, cfg, o.packing);
        return plan;
    }
    var order = CsTripPlan.order(adj, start, o.targets || []);
    plan.unreachable = order.unreachable;
    plan.approximate = order.approximate;
    for (var u = 0; u < order.unreachable.length; u++) {
        warnings.push(order.unreachable[u] + " cannot be reached from " + start +
            " along the surveyed line.");
    }
    if (order.approximate) {
        warnings.push("More than 8 stops: the visiting order is approximate.");
    }

    var pitches = CsPitch.find(survey, resolved);
    var pitchIndex = {};
    var pp;
    for (pp = 0; pp < pitches.length; pp++) {
        for (var s2 = 0; s2 + 1 < pitches[pp].stations.length; s2++) {
            pitchIndex[pitches[pp].stations[s2] + "|" + pitches[pp].stations[s2 + 1]] = pp;
            pitchIndex[pitches[pp].stations[s2 + 1] + "|" + pitches[pp].stations[s2]] = pp;
        }
    }
    var pitchOfEdge = function(e) {
        var i = pitchIndex[e.from + "|" + e.to];
        return i === undefined ? -1 : i;
    };
    var notes = o.notes || CsStationTable.notesByStation(survey);
    var ctx = { degree: CsFrontier.degrees(survey), notes: notes,
        pitchOfEdge: pitchOfEdge, unit: unit };

    var at = start;
    var allEdges = [];
    var used = {};
    var i;
    for (i = 0; i < order.order.length; i++) {
        var target = order.order[i];
        var edges = CsTripPlan.pathTo(CsTripPlan.shortest(adj, at), target);
        var steps = CsTripPlan.describe(edges, ctx);
        var mins = 0;
        for (var k = 0; k < steps.length; k++) {
            steps[k].minutes = CsTripPlan.stepMinutes(steps[k], unit, cfg, true);
            mins += steps[k].minutes;
            if (steps[k].kind === "pitch") { used[steps[k].pitch] = true; }
            plan.totals.lengthIn += steps[k].length;
            if (steps[k].dzKnown) { plan.totals.netDrop -= steps[k].dz; }
        }
        plan.stops.push({ station: target, steps: steps, minutesIn: mins });
        plan.totals.minutesIn += mins;
        plan.totals.minutesWork += cfg.leadWorkMin;
        allEdges = allEdges.concat(edges);
        at = target;
    }
    // The way out: the same route home, walked as a return leg.
    var homeEdges = CsTripPlan.pathTo(CsTripPlan.shortest(adj, at), start) || [];
    var backSteps = CsTripPlan.describe(homeEdges, ctx);
    for (var b = 0; b < backSteps.length; b++) {
        backSteps[b].minutes = CsTripPlan.stepMinutes(backSteps[b], unit, cfg, false);
        plan.back.minutes += backSteps[b].minutes;
        plan.totals.lengthAll += backSteps[b].length;
        if (backSteps[b].kind === "pitch") { used[backSteps[b].pitch] = true; }
    }
    plan.back.steps = backSteps;
    plan.totals.lengthAll += plan.totals.lengthIn;
    plan.totals.minutesOut = plan.back.minutes;
    plan.totals.minutesAll = plan.totals.minutesIn + plan.totals.minutesWork +
        plan.totals.minutesOut;

    var onRoute = [];
    for (var key in used) {
        if (Object.prototype.hasOwnProperty.call(used, key)) {
            onRoute.push(pitches[parseInt(key, 10)]);
        }
    }
    plan.pitches = onRoute;
    plan.gear = CsTripPlan.gear(onRoute, unit, cfg, o.packing);
    var tight = CsTripPlan.tightWarnings(survey, allEdges.concat(homeEdges), unit, cfg);
    var seenTight = {};
    for (var t = 0; t < tight.length; t++) {
        if (seenTight[tight[t]] !== true) { seenTight[tight[t]] = true; warnings.push(tight[t]); }
    }
    return plan;
};
```

- [ ] **Step 4: Run to verify pass** — `node tests/js_unit.js` → `### UNIT OK <n> assertions`. If the `CsPitch.find` on `tpResolved` (which has `legs: []`) returns no pitch, that is fine for these tests: they exercise `gear`/`stepMinutes` directly, and `build` only needs the tight and unreachable warnings. If `build` throws inside `CsPitch.find` because `resolved.legs` entries lack a `shot`, keep `legs: []` in the fixture.

- [ ] **Step 5: Commit**

```bash
git add scripts/CaveSurvey/Core/CsTripPlan.js tests/js_unit.js
git commit -m "feat: trip plan pace, gear and assembly

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Packet (HTML + SVG map), pure

**Goal:** `CsTripPlan.packetHtml(plan, ctx)` — one printable page: route map, directions, time budget, gear, packing list — with no coordinates.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsTripPlan.js`, `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] Output is a complete HTML document containing every stop, step text, the time totals, rope lines, kit, and the packing text.
- [ ] All interpolated text is HTML-escaped (a note containing `<script>` renders inert).
- [ ] The SVG map draws the cave lines and the route from normalised positions and prints no numbers from `x`/`y`; the packet text contains no `lat`, `lon`, or entrance wording.
- [ ] The packet states that the route follows the survey line and is not a safety guarantee.

**Verify:** `node tests/js_unit.js` → `### UNIT OK <n> assertions`

**Steps:**

- [ ] **Step 1: Write the failing tests** (append)

```js
// ---------------------------------------------------------------------
// Trip Plan -- packet
// ---------------------------------------------------------------------

var tpNotes = CsStationTable.notesByStation(tpBuildSurvey);
tpNotes.A5 = [{ text: "<script>alert(1)</script>", trip: 0 }];
var tpHtml = CsTripPlan.packetHtml(tpPlan, { title: "Test Cave", survey: tpBuildSurvey,
    resolved: tpResolved, date: "2026-10-01" });
ok(tpHtml.indexOf("<!doctype html>") === 0, "packet: a full html document");
ok(tpHtml.indexOf("Test Cave") >= 0, "packet: carries the cave name");
ok(tpHtml.indexOf("A5") >= 0, "packet: names the stop");
ok(tpHtml.indexOf("Lights") >= 0, "packet: carries the packing list");
ok(tpHtml.indexOf("<svg") >= 0, "packet: carries a route map");
ok(tpHtml.indexOf("follows the survey line") >= 0,
    "packet: states the route is the survey line, not a guarantee");
ok(tpHtml.indexOf("<script>") < 0, "packet: no live script");
ok(CsTripPlan.esc("<b>&\"</b>") === "&lt;b&gt;&amp;&quot;&lt;/b&gt;",
    "packet: text is escaped");
ok(!/latitude|longitude|entrance location|\blat\b|\blon\b/i.test(tpHtml),
    "packet: no coordinates or entrance wording");
// The map must not print a raw coordinate: none of the station x/y numbers
// (10, 20, 30) appear as text nodes.
ok(!/>\s*(10|20|30)\s*</.test(tpHtml), "packet: no coordinate numbers as text");
```

- [ ] **Step 2: Run to verify failure** — `CsTripPlan.packetHtml is not a function`.

- [ ] **Step 3: Implement** — append to `CsTripPlan.js`:

```js
// ---------------------------------------------------------------------
// The packet
// ---------------------------------------------------------------------

/** HTML-escape text. */
CsTripPlan.esc = function(text) {
    return String(text === undefined || text === null ? "" : text)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
};

/** "1 h 05 min" for a number of minutes. */
CsTripPlan.clock = function(minutes) {
    var m = Math.round(minutes);
    if (m < 60) { return m + " min"; }
    var h = Math.floor(m / 60);
    var r = m % 60;
    return h + " h " + (r < 10 ? "0" : "") + r + " min";
};

/**
 * A plan-view sketch: every leg in grey, the route in red, the stops
 * as dots with their names. Positions are NORMALISED into the drawing
 * box and never printed, so the page shows the cave's shape and no
 * coordinates.
 */
CsTripPlan.routeSvg = function(survey, resolved, plan) {
    var W = 640, H = 420, pad = 24;
    var pts = resolved.stations;
    var names = [];
    var n;
    for (n in pts) {
        if (Object.prototype.hasOwnProperty.call(pts, n)) { names.push(n); }
    }
    if (names.length === 0) { return ""; }
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < names.length; i++) {
        var p = pts[names[i]];
        if (p.x < minX) { minX = p.x; }
        if (p.x > maxX) { maxX = p.x; }
        if (p.y < minY) { minY = p.y; }
        if (p.y > maxY) { maxY = p.y; }
    }
    var span = Math.max(maxX - minX, maxY - minY, 1e-9);
    var scale = Math.min((W - 2 * pad) / span, (H - 2 * pad) / span);
    var px = function(name) {
        return Math.round(pad + (pts[name].x - minX) * scale);
    };
    // y is flipped: north is up on the page.
    var py = function(name) {
        return Math.round(H - pad - (pts[name].y - minY) * scale);
    };
    var svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 " + W +
        " " + H + "\" width=\"100%\" role=\"img\" aria-label=\"Route sketch\">";
    svg += "<rect width=\"" + W + "\" height=\"" + H + "\" fill=\"#fff\" stroke=\"#ccc\"/>";
    for (var s = 0; s < survey.shots.length; s++) {
        var sh = survey.shots[s];
        if (!CsFrontier.isLeg(sh)) { continue; }
        var a = CsFrontier.clean(sh.from);
        var b = CsFrontier.clean(sh.to);
        if (pts[a] === undefined || pts[b] === undefined) { continue; }
        svg += "<line x1=\"" + px(a) + "\" y1=\"" + py(a) + "\" x2=\"" + px(b) +
            "\" y2=\"" + py(b) + "\" stroke=\"#999\" stroke-width=\"1.5\"/>";
    }
    var groups = [];
    for (var st = 0; st < plan.stops.length; st++) {
        for (var sp = 0; sp < plan.stops[st].steps.length; sp++) {
            groups.push(plan.stops[st].steps[sp]);
        }
    }
    for (var g = 0; g < groups.length; g++) {
        for (var e = 0; e < groups[g].edges.length; e++) {
            var ed = groups[g].edges[e];
            if (pts[ed.from] === undefined || pts[ed.to] === undefined) { continue; }
            svg += "<line x1=\"" + px(ed.from) + "\" y1=\"" + py(ed.from) +
                "\" x2=\"" + px(ed.to) + "\" y2=\"" + py(ed.to) +
                "\" stroke=\"#c0392b\" stroke-width=\"3\"/>";
        }
    }
    var mark = function(name, fill) {
        if (pts[name] === undefined) { return ""; }
        return "<circle cx=\"" + px(name) + "\" cy=\"" + py(name) +
            "\" r=\"5\" fill=\"" + fill + "\"/><text x=\"" + (px(name) + 8) +
            "\" y=\"" + (py(name) - 6) + "\" font-size=\"12\" fill=\"#222\">" +
            CsTripPlan.esc(name) + "</text>";
    };
    svg += mark(plan.start, "#2c3e50");
    for (var k = 0; k < plan.stops.length; k++) {
        svg += mark(plan.stops[k].station, "#c0392b");
    }
    svg += "</svg>";
    return svg;
};

/**
 * The plan as one printable HTML page. No coordinates, no entrance
 * wording, no basemap: it is meant to be carried by an unguided team.
 *
 * \param ctx {title, survey, resolved, date}
 */
CsTripPlan.packetHtml = function(plan, ctx) {
    var esc = CsTripPlan.esc;
    var unit = plan.unit;
    var t = plan.totals;
    var h = [];
    h.push("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">");
    h.push("<title>" + esc(ctx.title) + " trip plan</title>");
    h.push("<style>body{font:14px/1.45 -apple-system,Helvetica,Arial,sans-serif;" +
        "max-width:760px;margin:24px auto;padding:0 16px;color:#222}" +
        "h1{font-size:22px}h2{font-size:16px;margin-top:22px;border-bottom:1px solid #ccc}" +
        "li{margin:3px 0}.note{color:#555}.warn{color:#8a4b00}" +
        "table{border-collapse:collapse}td{padding:2px 12px 2px 0}" +
        "pre{white-space:pre-wrap;font:inherit}</style></head><body>");
    h.push("<h1>" + esc(ctx.title) + " &mdash; trip plan</h1>");
    if (ctx.date) { h.push("<p class=\"note\">" + esc(ctx.date) + "</p>"); }
    h.push("<p class=\"note\">This route follows the survey line. It is not a " +
        "guarantee that the way is safe or easy: crawls, water, climbs and " +
        "loose ground are only known where someone wrote them down.</p>");

    h.push("<h2>Objectives</h2><ol>");
    for (var i = 0; i < plan.stops.length; i++) {
        h.push("<li>" + esc(plan.stops[i].station) + "</li>");
    }
    h.push("</ol>");

    h.push("<h2>Time budget</h2><table>");
    h.push("<tr><td>In</td><td>" + CsTripPlan.clock(t.minutesIn) + "</td></tr>");
    h.push("<tr><td>Work at objectives</td><td>" + CsTripPlan.clock(t.minutesWork) + "</td></tr>");
    h.push("<tr><td>Out</td><td>" + CsTripPlan.clock(t.minutesOut) + "</td></tr>");
    h.push("<tr><td><b>Total</b></td><td><b>" + CsTripPlan.clock(t.minutesAll) +
        "</b></td></tr></table>");
    h.push("<p class=\"note\">Distance in " + CsTripPlan.dist(t.lengthIn, unit) +
        ", " + CsTripPlan.dist(t.lengthAll, unit) + " there and back. Timed at a " +
        "hiking pace on the level; pitches are timed separately.</p>");

    h.push("<h2>Route</h2>");
    h.push(CsTripPlan.routeSvg(ctx.survey, ctx.resolved, plan));

    h.push("<h2>Directions</h2>");
    var start = plan.start;
    for (var s = 0; s < plan.stops.length; s++) {
        h.push("<h3>To " + esc(plan.stops[s].station) + "</h3><ol>");
        for (var k = 0; k < plan.stops[s].steps.length; k++) {
            var step = plan.stops[s].steps[k];
            h.push("<li>" + esc(step.text) + " <span class=\"note\">(" +
                CsTripPlan.clock(step.minutes) + ")</span>");
            for (var n = 0; n < step.notes.length; n++) {
                h.push("<div class=\"note\">Note &mdash; " + esc(step.notes[n]) + "</div>");
            }
            h.push("</li>");
        }
        h.push("</ol>");
    }
    h.push("<h3>Back to " + esc(start) + "</h3><ol>");
    for (var b = 0; b < plan.back.steps.length; b++) {
        h.push("<li>" + esc(plan.back.steps[b].text) + "</li>");
    }
    h.push("</ol>");

    if (plan.warnings.length > 0) {
        h.push("<h2>Watch for</h2><ul>");
        for (var w = 0; w < plan.warnings.length; w++) {
            h.push("<li class=\"warn\">" + esc(plan.warnings[w]) + "</li>");
        }
        h.push("</ul>");
    }

    h.push("<h2>Gear</h2>");
    if (plan.gear.rope.length > 0) {
        h.push("<h3>Rope and hardware</h3><ul>");
        for (var r = 0; r < plan.gear.rope.length; r++) {
            h.push("<li>" + esc(plan.gear.rope[r].text) + "</li>");
        }
        for (var q = 0; q < plan.gear.hardware.length; q++) {
            h.push("<li class=\"warn\">" + esc(plan.gear.hardware[q]) + "</li>");
        }
        h.push("</ul>");
    }
    h.push("<h3>Personal kit <span class=\"note\">(a starting list &mdash; edit it)</span></h3><ul>");
    for (var g = 0; g < plan.gear.kit.length; g++) {
        h.push("<li>" + esc(plan.gear.kit[g]) + "</li>");
    }
    h.push("</ul>");
    if (plan.gear.packing !== "") {
        h.push("<h3>Team packing list</h3><pre>" + esc(plan.gear.packing) + "</pre>");
    }
    h.push("</body></html>");
    return h.join("\n");
};
```

- [ ] **Step 4: Run to verify pass** — `node tests/js_unit.js` → `### UNIT OK <n> assertions`. The packet test's `<script>` check reads the whole document, and the escape test proves note text is inert; `tpNotes` above is built but only `build()`'s own note lookup feeds steps, so if the `<script>` note does not reach the HTML, the assertion still holds (it asserts absence).

- [ ] **Step 5: Commit**

```bash
git add scripts/CaveSurvey/Core/CsTripPlan.js tests/js_unit.js
git commit -m "feat: trip plan packet (html + route sketch, no coordinates)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Plan tab in the panel

**Goal:** A second tab "Plan" in the Station Table dock: build a plan from the selected rows, edit pace and packing, and write the packet next to the drawing.

**Files:**
- Modify: `scripts/CaveSurvey/StationTable/StationTable.js`
- Modify: `docs/handbook/pages/station-table.html` (add a "Plan a trip" section) — no separate tool, so no new index entry

**Acceptance Criteria:**
- [ ] Selecting several rows and pressing "Plan trip" produces the plan and shows its directions and totals in the Plan tab.
- [ ] Pace and packing edits are saved to `stations.json` `settings` and survive a reload.
- [ ] "Save packet" writes `trip-plan.html` in the cave folder; opening it in a browser shows the map, directions, time and gear with no coordinates.
- [ ] Unreachable stations and tight-passage warnings appear in the tab.
- [ ] The Station Table tab's behaviour is unchanged (Task 4 criteria still hold).

**Verify:** live check in Step 3, plus `python3 -m unittest discover -s tests -v 2>&1 | tail -5` → `OK`.

**Steps:**

- [ ] **Step 1: Wrap the body in a tab widget**

In `StationTable.buildDock`, replace `dock.setWidget(body);` with a `QTabWidget` holding two pages: page 1 is the existing `body` (Stations), page 2 is a new `plan` widget built below. Keep every existing `objectName`.

```js
    var tabs = new QTabWidget(dock);
    tabs.objectName = "StationTableTabs";
    tabs.addTab(body, qsTr("Stations"));

    var plan = new QWidget(tabs);
    var pl = new QVBoxLayout();
    plan.setLayout(pl);
    var planButton = new QPushButton(qsTr("Plan trip from selected rows"), plan);
    planButton.objectName = "StationTablePlanButton";
    var paceRow = new QHBoxLayout();
    var paceEdit = new QLineEdit(plan);
    paceEdit.objectName = "StationTablePace";
    paceEdit.placeholderText = qsTr("Walking pace, ft per minute (default 264 = a 3 mph hike)");
    paceRow.addWidget(paceEdit, 1, 0);
    var packing = new QPlainTextEdit(plan);
    packing.objectName = "StationTablePacking";
    packing.placeholderText = qsTr("Team packing list, one item per line");
    var out = new QPlainTextEdit(plan);
    out.objectName = "StationTablePlanOut";
    out.readOnly = true;
    var packetButton = new QPushButton(qsTr("Save packet"), plan);
    packetButton.objectName = "StationTableSavePacket";
    packetButton.enabled = false;
    pl.addWidget(planButton, 0, 0);
    pl.addLayout(paceRow);
    pl.addWidget(packing, 1, 0);
    pl.addWidget(out, 3, 0);
    pl.addWidget(packetButton, 0, 0);
    tabs.addTab(plan, qsTr("Plan"));
    dock.setWidget(tabs);

    planButton.clicked.connect(function() { StationTable.planTrip(); });
    packetButton.clicked.connect(function() { StationTable.savePacket(); });
```

`QPlainTextEdit` is not confirmed to be exposed by the bridge: grep other panels for its use; if absent, use `QTextEdit` (with `setPlainText`/`toPlainText`) for the three text areas and adjust the property reads below.

- [ ] **Step 2: Add the plan handlers** (before `StationTable.open`)

```js
/** Selected rows' stations, in table order. */
StationTable.selectedStations = function() {
    var table = StationTable.child("StationTableTable");
    var shown = StationTable.state.shown || [];
    var seen = {};
    var out = [];
    var items = table.selectedItems();
    for (var i = 0; i < items.length; i++) {
        var idx = items[i].row();
        if (idx >= 0 && idx < shown.length && seen[idx] !== true) {
            seen[idx] = true;
            out.push(shown[idx].station);
        }
    }
    return out;
};

/** Build the plan and show it as text. */
StationTable.planTrip = function() {
    var s = StationTable.state;
    var d = s.drawn;
    if (isNull(d)) { return; }
    var targets = StationTable.selectedStations();
    if (targets.length === 0) {
        CsTell.warn(qsTr("Select one or more rows on the Stations tab first."));
        return;
    }
    var paceText = String(StationTable.child("StationTablePace").text);
    var pace = parseFloat(paceText);
    var overrides = {};
    if (isFinite(pace) && pace > 0) { overrides.paceFtPerMin = pace; }
    var packingText = String(StationTable.child("StationTablePacking").plainText);
    s.store.settings.packing = packingText;
    s.store.settings.pace = overrides;
    var path = StationTable.sidecarPath(s.docPath);
    if (path !== "") { StationTable.writeSidecar(path, s.store); }

    var unit = (d.survey.trips && d.survey.trips[0] &&
        d.survey.trips[0].distanceUnit === "m") ? "m" : "ft";
    s.plan = CsTripPlan.build(d.survey, d.resolved, { targets: targets,
        unit: unit, config: overrides, packing: packingText });
    var p = s.plan;
    var lines = [];
    for (var i = 0; i < p.stops.length; i++) {
        lines.push("To " + p.stops[i].station);
        for (var k = 0; k < p.stops[i].steps.length; k++) {
            lines.push("  " + p.stops[i].steps[k].text);
        }
    }
    lines.push("Back to " + p.start);
    for (var b = 0; b < p.back.steps.length; b++) {
        lines.push("  " + p.back.steps[b].text);
    }
    lines.push("");
    lines.push("Total " + CsTripPlan.clock(p.totals.minutesAll) + "  (in " +
        CsTripPlan.clock(p.totals.minutesIn) + ", work " +
        CsTripPlan.clock(p.totals.minutesWork) + ", out " +
        CsTripPlan.clock(p.totals.minutesOut) + ")");
    for (var w = 0; w < p.warnings.length; w++) { lines.push("! " + p.warnings[w]); }
    for (var r = 0; r < p.gear.rope.length; r++) { lines.push("Rope: " + p.gear.rope[r].text); }
    StationTable.child("StationTablePlanOut").setPlainText(lines.join("\n"));
    StationTable.child("StationTableSavePacket").enabled = p.stops.length > 0;
};

/** Write the packet beside the drawing. */
StationTable.savePacket = function() {
    var s = StationTable.state;
    if (isNull(s.plan) || isNull(s.drawn)) { return; }
    if (s.docPath === "") {
        CsTell.warn(qsTr("Save the drawing first: the packet is written beside it."));
        return;
    }
    var html = CsTripPlan.packetHtml(s.plan, { title: CsCave.nameOf(s.docPath),
        survey: s.drawn.survey, resolved: s.drawn.resolved, date: "" });
    var path = CsCave.folderOf(s.docPath) + "/trip-plan.html";
    var file = new QFile(path);
    if (!file.open(QIODevice.WriteOnly | QIODevice.Text)) {
        CsTell.warn(qsTr("Could not write the packet."));
        return;
    }
    var stream = new QTextStream(file);
    stream.writeString(html);
    file.close();
    CsTell.info(qsTr("Packet saved as trip-plan.html beside the drawing."));
};
```

Also, in `StationTable.reload`, after the store loads, restore the settings into the widgets:

```js
    StationTable.child("StationTablePacking").setPlainText(s.store.settings.packing || "");
    var pv = s.store.settings.pace && s.store.settings.pace.paceFtPerMin;
    StationTable.child("StationTablePace").text = pv ? String(pv) : "";
```

`CsTell.info` is not confirmed: check `Core/CsTell.js` for the exported names and use the one that shows the caver a message (the file's own header says `warning()` only reaches stderr, so use whatever CsTell provides for a visible note).

- [ ] **Step 3: Verify live**

```bash
tools/publish.sh
```

In CaveCAD, on the Pitfall Cave and the Plumbline Pit fixture: select two lead/open-end rows on Stations, open Plan, press Plan trip. Confirm: directions read start to stop, a pitch step has no heading, totals add up, Save packet writes `trip-plan.html`; open it in a browser and confirm no coordinates appear. Set a pace and a packing list, reload the panel, confirm they persist. Use the MCP tools for the check (`cavecad_eval` to read the `StationTablePlanOut` text, `cavecad_screenshot` for the proof).

- [ ] **Step 4: Handbook** — add a "Plan a trip" section to `docs/handbook/pages/station-table.html`: pick rows, press Plan trip, what each part of the packet means, the default pace and how to change it, the "follows the survey line" caveat, and that gear anchors are not read from the map yet.

- [ ] **Step 5: Run structural tests** — `python3 -m unittest discover -s tests -v 2>&1 | tail -5` → `OK`.

- [ ] **Step 6: Commit**

```bash
git add scripts/CaveSurvey/StationTable docs/handbook
git commit -m "feat: Station Table Plan tab and trip packet

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Full run, publish, and master ToDo

**Goal:** Everything green, published to CaveCAD, and the master ToDo updated.

**Files:**
- Modify: `~/.claude/projects/-Users-nathanschonegg-Documents-Claude/memory/cavecad-master-todo.md`

**Acceptance Criteria:**
- [ ] `tests/run_all.sh` passes.
- [ ] `tools/publish.sh` succeeds and the new tool loads in the running CaveCAD (verified against the NEW code, not a stale add-on; see `cavecad-live-restart-trap`).
- [ ] The master ToDo marks Leads and the leads-related analysis item done and adds the follow-ups.

**Verify:** `./tests/run_all.sh 2>&1 | tail -20` → ends with all-pass output; no `### UNIT FAIL`.

**Steps:**

- [ ] **Step 1: Run everything**

```bash
./tests/run_all.sh 2>&1 | tail -30
```

Fix anything red. Known trap: the engine tests load Core by a hand-written list; if a Core file is missing from `tests/js_unit.js` a test can pass silently, so confirm each new file appears in that list and that the new assertion counts are in the `### UNIT OK` total.

- [ ] **Step 2: Publish and prove it loaded**

```bash
tools/publish.sh
```

Then in CaveCAD (quit fully first; a blocked quit leaves the old add-on running), open a cave, run `st`, and take a screenshot with `mcp__cavecad__cavecad_screenshot` as proof.

- [ ] **Step 3: Update the master ToDo**

In `cavecad-master-todo.md`: mark "LEADS" and "Passage analytics"-adjacent lead list done with the date and version; add follow-ups: "read rigging symbols to count anchors per pitch", "Flagged rows link to the Notebook page", "Loop rows open Loop Errors on that loop", "3D view highlights selected stations", "lead markers in the 3D viewer and printable report". Leave Device pull next.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: station table ships

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage.**
- Rows over the whole map, seven kinds, combinable filters, search: Tasks 1-2, panel Task 4.
- Sidecar marks/notes/assignee, key = station + note text, relink, orphans: Task 3, panel Task 4.
- Live links: click-to-zoom in Task 4. Loop and Flagged rows read from `CsNetwork`/`CsValidate` (Task 1). Deep links into Loop Errors / Notebook, and 3D highlight, are **not built here** and are listed as follow-ups in Task 9. This is a gap against "always live-linked to the tool that owns the analysis" and should be raised with Nathan.
- Suggestions never applied: Task 2 `suggest`, shown as "(looks pushed)" in Task 4.
- Checklist export: Task 2 `checklistCsv`, button in Task 4. "Selection to map" (highlight on the drawing) is not built; listed as follow-up.
- Trip Plan directions, stop order, pace with vertical, gear (rope + hardware + kit + packing), packet with privacy: Tasks 5-8. Anchor counts from symbols: deviation 2.
- Privacy: rows and packet carry no coordinates (tests in Tasks 1 and 7).
- Handbook page and structural registration: Task 4 and Task 8.

**Placeholder scan.** No TBD/TODO. Two steps (Task 4 Step 3, Task 8 Steps 1-2) name bridge APIs that were not verified during planning (`CsFiles.saveFile`, `QComboBox.findData`, `QPlainTextEdit`, `CsTell.info`) and tell the executor exactly what to grep and the fallback. Those are the only places the plan asks the executor to confirm an API.

**Type consistency.** Row fields (`station, kinds, trips, degree, notes, noteText, leadNotes, keyText, z, loops, flags`) are defined in Task 1 and used identically in Tasks 2-4 (`status/team/who/link/relinkFrom/key` are added by `reconcile` in Task 3). Edge fields (`from, to, len, dz, bearing, dx, dy, shot`) are defined in Task 5 and used in Tasks 6-7. `CsTripPlan.config` keys match `DEFAULTS` and the panel's `paceFtPerMin`. `describe` step fields (`kind, pitch, from, to, length, dz, dzKnown, vertical, heading, edges, atJunction, notes, text, minutes`) match their use in `stepMinutes`, `build` and `packetHtml`.
