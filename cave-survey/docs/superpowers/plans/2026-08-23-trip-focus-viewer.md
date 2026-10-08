# Trip Focus Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Cave Survey > Trip Focus -- a standalone window listing each trip's, team's, person's and survey run's distance and percentage contribution, with a live plan view of just what is checked, rendered from a private copy of the drawing so the user's document is never touched.

**Architecture:** Two pure Core libraries plus one GUI tool. `CsContrib.js` turns a reconstructed survey into contribution rows (distance + percent, by trip/team/person/run). `CsFocus.js` turns a row selection into a station-name set and decides, per entity, whether it is in focus. `TripFocus.js` owns a non-modal `QDialog` holding a `QTreeWidget` and an `RGraphicsViewQt` bound to a scratch `RDocument` filled by `RCopyOperation(..., setSelectionOnly(false))`; toggling a checkbox flips the `Invisible` flag inside the scratch document only.

**Tech Stack:** QCAD/CaveCAD ECMAScript add-on API (`RDocument`, `RDocumentInterface`, `RGraphicsSceneQt`, `RGraphicsViewQt`, `RCopyOperation`, `RModifyObjectsOperation`), Qt widgets through the CaveCAD bridge (`QDialog`, `QTreeWidget`, `QVBoxLayout`, `QSplitter`), existing Core (`CsRevise`, `CsModel`, `CsStats`, `CsProfile`, `CsLayers`, `CsBind`, `CsTags`).

**User decisions (already made):**
- "Give a distance and percentage breakdown of the team's contributions" -- distance + percent are the metrics.
- "let's get a viewer up and running, we can add colors later" -- no colour-by-trip in this plan.
- "Per team, but per person would also be interesting stats" -- both a Teams section and a People section.
- "it will be plan only" -- the profile band is excluded from the viewer.
- Standalone popup window, not focus applied inside the main drawing window.

**Spec:** `docs/superpowers/specs/2026-08-23-trip-focus-viewer-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| Create `scripts/CaveSurvey/Core/CsContrib.js` | Pure: contribution rows by trip / team / person / run; distance + percent; team-string person splitting; number formatting |
| Create `scripts/CaveSurvey/Core/CsFocus.js` | Pure: station-set builders, per-entity attribution to stations, plan-frame filter, the tag list the attribution reads |
| Create `scripts/CaveSurvey/TripFocus/TripFocus.js` | The tool: menu wiring, the dialog, the scratch document, the view, the tree, apply/All/Refresh |
| Create `scripts/CaveSurvey/TripFocus/TripFocus.svg` | Menu and toolbar icon |
| Modify `scripts/CaveSurvey/Core/CsAll.js` | Include both new Core files (a structural test requires it) |
| Modify `tests/js_unit.js` | Unit sections for `CsContrib` and `CsFocus`, plus the tag-list-agreement test against `CsDraw.js` |
| Modify `README.md` | One row in the `## The tools` table (a structural test requires it both ways) |

---

### Task 1: CsContrib -- contribution rows

**Goal:** A pure library that turns a reconstructed survey into distance-and-percent rows by trip, team, person and survey run.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsContrib.js`
- Modify: `scripts/CaveSurvey/Core/CsAll.js`
- Test: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `CsContrib.byTrip` returns one row per `survey.trips` entry with `distance`, `percent`, `shotCount`, `stationCount`, `date`, `team`, `name`, `label`
- [ ] Summed `distance` over trip rows equals `CsStats.compute(survey, resolved, tapeMode).surveyedLength` for the same survey
- [ ] `CsContrib.people("Nathan, Jim and Sarah/Bob & Ann")` returns `["Nathan","Jim","Sarah","Bob","Ann"]`
- [ ] `CsContrib.byPerson` credits each person the FULL distance of every trip they were on, and sets `overlapping: true` on the result when any credited total exceeds the survey total
- [ ] `CsContrib.byRun` returns one row per `CsProfile.groupRuns` key, distance summed over shots whose `to` station is in that run
- [ ] A zero-length survey returns empty arrays and `percent` 0, never `NaN`
- [ ] `CsAll.js` includes `CsContrib.js`

**Verify:** `bash tests/run_all.sh` -> `### UNIT OK <n> assertions` with n greater than the current count, and no `### UNIT FAIL`

**AMENDED AFTER REVIEW (Task 3, commit `d032c32`).** Three wiring defects
in Task 3's draft below were found and corrected while implementing, and the
corrections apply to every later task that copies this shape:
`include("scripts/CaveSurvey/...")` is a BANNED form (a structural test greps
for it; it resolves only against the app bundle and dies silently from a
per-user install) — use `includeBasePath`-relative, as the snippets now do;
`button.clicked.connect(dlg, "close")` has no precedent in either repo — use a
function literal, as `SurveyNotebook.js` and `HatchDialog.js` do; and
`cleanUp()` must call `destrDialog(dlg)` as well as `destr(previewDi)`, or the
dialog, parented to the main window, outlives every close and ten reopens
leave ten live view+scene trees behind.

**AMENDED AFTER REVIEW (commit `126ec76`).** The Step 3 source below is the
first draft and is superseded by the shipped `CsContrib.js`; read the file,
not this snippet, when you need the current behaviour. Four defects in the
draft were found by code review and fixed: `byRun` dropped distance no run
could claim AND renormalised the survivors to 100% (a 500 ft cave with a
300 ft untied block reported one run at 100%), so it now returns
`{rows, unassigned}` with every share taken against the whole cave;
`byPerson.overlapping` tested the grand total, so a two-person trip beside
an unattributed one suppressed the credit note exactly when the rows
double-counted, and is now a per-trip test; `people()` invented
contributors out of punctuation (`"Nathan Schonegg, Jr."` credited a person
named "Jr.", a semicolon-separated surname-first list shattered into
phantoms, and `\band\b` fired inside `"(book and sketch)"`); and two
assertions could not fail. Task 4 consumes the new `{rows, unassigned}`
shape.

**WHERE THOSE FIXES ACTUALLY LANDED.** A second round of `CsContrib` review
fixes (the semicolon branch that erased cavers, a whole team in parentheses
crediting nobody, suffix merging after any separator, dedup keyed on the
display spelling, the half-counted shot on a null `offset`, and guards on
`percentText`/`distanceText`) is committed under `bb3f38a`, whose message
describes only the plan amendment: the coordinator ran `git commit` while
those files were already staged, so a docs commit swallowed a 228-line
library change. The history was left alone rather than amended, because the
branch tip is shared with a concurrent session. Read `bb3f38a` in full, not
its subject line.

**AN ENGINE DIFFERENCE WORTH KEEPING,** found while fixing `people()`:
rebuilding a `RegExp` from another regex's `.source` SILENTLY DROPS an
alternative in CaveCAD's own script engine while working correctly under
node. `"Nathan, Jim and Sarah/Bob & Ann"` came back with `Sarah/Bob` as one
token. The separator patterns are therefore stored as plain strings and the
`RegExp` is built from those, never through `.source`. This is the second
time a defect has been invisible to node and visible only in the real
engine, which is why `bash tests/run_all.sh` is the authority and
`node tests/js_unit.js` is convenience.

**Steps:**

- [ ] **Step 1: Write the failing tests** -- append to `tests/js_unit.js`, before the closing summary block

```js
// ---------------------------------------------------------------------
// CsContrib -- who surveyed what, in distance and percent
// ---------------------------------------------------------------------
(function() {
    loadRepoScript("scripts/CaveSurvey/Core/CsAngles.js");
    loadRepoScript("scripts/CaveSurvey/Core/CsUnits.js");
    loadRepoScript("scripts/CaveSurvey/Core/CsModel.js");
    loadRepoScript("scripts/CaveSurvey/Core/CsTraverse.js");
    loadRepoScript("scripts/CaveSurvey/Core/CsNetwork.js");
    loadRepoScript("scripts/CaveSurvey/Core/CsProfile.js");
    loadRepoScript("scripts/CaveSurvey/Core/CsStats.js");
    loadRepoScript("scripts/CaveSurvey/Core/CsContrib.js");

    // -- people ------------------------------------------------------
    var people = CsContrib.people("Nathan, Jim and Sarah/Bob & Ann");
    eqs(people.join(","), "Nathan,Jim,Sarah,Bob,Ann",
        "CsContrib.people: splits on comma, 'and', slash and ampersand");
    eqs(CsContrib.people("").length, 0,
        "CsContrib.people: no team text means nobody credited");
    eqs(CsContrib.people("Nathan, nathan").join(","), "Nathan",
        "CsContrib.people: one person, however they capitalised it");

    // -- a two-trip survey -------------------------------------------
    var survey = CsModel.newSurvey();
    survey.distanceUnit = "ft";
    var t0 = CsModel.newTrip();
    t0.date = "2024-03-16"; t0.team = "Nathan, Jim";
    var t1 = CsModel.newTrip();
    t1.date = "2024-04-20"; t1.team = "Nathan, Sarah";
    survey.trips = [t0, t1];

    var shot = function(from, to, dist, trip) {
        var s = CsModel.newShot();
        s.from = from; s.to = to; s.distance = dist;
        s.azimuth = 90.0; s.inclination = 0.0; s.trip = trip;
        return s;
    };
    survey.shots = [
        shot("A1", "A2", 10.0, 0),
        shot("A2", "A3", 30.0, 0),
        shot("A3", "B1", 60.0, 1)
    ];
    // a splay and an excluded shot: counted by neither, exactly as
    // CsStats.compute counts neither, so the rows still sum to Length
    var sp = shot("A2", "", 5.0, 0); sp.splay = true;
    var ex = shot("A3", "A4", 99.0, 1); ex.excludeFromAll = true;
    survey.shots.push(sp);
    survey.shots.push(ex);

    var resolved = CsNetwork.resolve(survey);
    var stats = CsStats.compute(survey, resolved, CsTraverse.SLOPE);

    var trips = CsContrib.byTrip(survey, resolved, CsTraverse.SLOPE);
    eqs(trips.length, 2, "CsContrib.byTrip: one row per trip");
    eqs(trips[0].distance, 40.0, "CsContrib.byTrip: trip 0 surveyed 40");
    eqs(trips[1].distance, 60.0, "CsContrib.byTrip: trip 1 surveyed 60");
    eqs(trips[0].percent, 40.0, "CsContrib.byTrip: trip 0 is 40% of the cave");
    eqs(trips[0].distance + trips[1].distance, stats.surveyedLength,
        "CsContrib.byTrip: the rows sum to the title block's Length");
    eqs(trips[0].date, "2024-03-16", "CsContrib.byTrip: carries the date");
    eqs(trips[0].shotCount, 2, "CsContrib.byTrip: counts the counted shots");

    // -- teams -------------------------------------------------------
    var teams = CsContrib.byTeam(trips);
    eqs(teams.length, 2, "CsContrib.byTeam: two distinct parties");
    eqs(teams[0].team, "Nathan, Jim", "CsContrib.byTeam: keyed on the team text");
    eqs(teams[0].tripCount, 1, "CsContrib.byTeam: counts its trips");

    // -- people ------------------------------------------------------
    var persons = CsContrib.byPerson(trips);
    eqs(persons.rows.length, 3, "CsContrib.byPerson: Nathan, Jim, Sarah");
    var nathan = null, jim = null;
    for (var i = 0; i < persons.rows.length; i++) {
        if (persons.rows[i].person === "Nathan") { nathan = persons.rows[i]; }
        if (persons.rows[i].person === "Jim") { jim = persons.rows[i]; }
    }
    eqs(nathan.distance, 100.0,
        "CsContrib.byPerson: on both trips, credited both in full");
    eqs(jim.distance, 40.0, "CsContrib.byPerson: one trip, credited it");
    ok(persons.overlapping,
        "CsContrib.byPerson: flags that credited totals exceed the cave");

    // -- runs --------------------------------------------------------
    var runs = CsContrib.byRun(survey, resolved, CsTraverse.SLOPE);
    eqs(runs.length, 2, "CsContrib.byRun: runs A and B");
    eqs(runs[0].run, "A", "CsContrib.byRun: run A first, in survey order");
    eqs(runs[0].distance, 40.0,
        "CsContrib.byRun: a leg belongs to the run its TO station is in");
    eqs(runs[1].distance, 60.0, "CsContrib.byRun: the leg into B1 is B's");

    // -- empty survey ------------------------------------------------
    var empty = CsModel.newSurvey();
    var emptyResolved = CsNetwork.resolve(empty);
    var emptyTrips = CsContrib.byTrip(empty, emptyResolved, CsTraverse.SLOPE);
    eqs(emptyTrips.length, 1, "CsContrib.byTrip: an empty survey has trip 0");
    eqs(emptyTrips[0].percent, 0.0,
        "CsContrib.byTrip: nothing surveyed is 0%, never NaN");

    // -- formatting --------------------------------------------------
    eqs(CsContrib.distanceText(1234.4, "ft"), "1,234 ft",
        "CsContrib.distanceText: grouped, rounded, with the unit");
    eqs(CsContrib.percentText(13.6), "14%",
        "CsContrib.percentText: whole percent");
    eqs(CsContrib.percentText(0.2), "<1%",
        "CsContrib.percentText: a real contribution never reads as 0%");
    eqs(CsContrib.percentText(0.0), "0%",
        "CsContrib.percentText: nothing really is 0%");
})();
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tests/js_unit.js`
Expected: FAIL naming `CsContrib` -- the file does not exist, so `loadRepoScript` throws

- [ ] **Step 3: Write `scripts/CaveSurvey/Core/CsContrib.js`**

```js
// CsContrib.js -- who surveyed what, in distance and percent.
//
// Part of the Cave Survey Core library: pure functions, no document and
// no GUI, so the whole of it runs under the headless test harness.
//
// WHAT COUNTS. Exactly the shots CsStats.compute counts: not splays,
// not excludeFromAll, nothing missing an end. That is copied
// deliberately rather than reinvented -- the rows have to sum to the
// Length printed on the title block, or the window and the sheet
// disagree in front of the reader. It inherits CsStats' known gap
// (excludeFromLength is not honoured); closing that is a CsStats change
// and belongs with the task already spawned for it, not here.
//
// CREDIT IS NOT DIVIDED. Two people on one trip are each credited its
// full distance, so People percentages can exceed 100%. Dividing 412 ft
// by a party of three invents a number nobody measured. byPerson
// reports `overlapping` so the window can say so out loud instead of
// leaving the reader to work out why the column does not add up.

var CsContrib = {};

/** Team text -> people. Separators: comma, semicolon, slash,
 *  ampersand, plus, and the word "and" (which is why "Ann and Bob"
 *  splits but "Alexander" does not -- the pattern needs the word
 *  whole). */
CsContrib.PERSON_SPLIT = /\s*(?:,|;|\/|&|\+|\band\b)\s*/i;

CsContrib.people = function(teamText) {
    if (teamText === undefined || teamText === null) {
        return [];
    }
    var parts = String(teamText).split(CsContrib.PERSON_SPLIT);
    var out = [], seen = {};
    for (var i = 0; i < parts.length; i++) {
        var name = parts[i].replace(/^\s+|\s+$/g, "");
        if (name.length === 0) {
            continue;
        }
        // one person however they capitalised it, keeping the first
        // spelling seen -- a survey where "nathan" and "Nathan" are two
        // contributors is a data-entry artefact, not two people
        var key = name.toUpperCase();
        if (seen[key] === true) {
            continue;
        }
        seen[key] = true;
        out.push(name);
    }
    return out;
};

/** True when a shot contributes to surveyed length. The one rule, so
 *  every row type agrees and the total matches CsStats. */
CsContrib.counts = function(shot) {
    return !(shot.excludeFromAll || shot.splay ||
        shot.from === "" || shot.to === "");
};

/** percent of total, 0 (not NaN) when there is no total. */
CsContrib.share = function(part, total) {
    if (!(total > 0)) {
        return 0.0;
    }
    return part / total * 100.0;
};

/**
 * One row per trip.
 *
 * \return [{tripId, label, name, date, team, distance, planDistance,
 *           shotCount, stationCount, percent}] in trip-index order
 */
CsContrib.byTrip = function(survey, resolved, tapeMode) {
    CsModel.ensureTrips(survey);
    var rows = [];
    var i;
    for (i = 0; i < survey.trips.length; i++) {
        var t = survey.trips[i];
        rows.push({
            tripId: i,
            label: (typeof CsRevise !== "undefined" &&
                    typeof CsRevise.tripLabel === "function") ?
                CsRevise.tripLabel(i, t) :
                ((t.date || "") + " " + (t.team || "")),
            name: t.name || "",
            date: t.date || "",
            team: t.team || "",
            distance: 0.0,
            planDistance: 0.0,
            shotCount: 0,
            stationCount: 0,
            percent: 0.0
        });
    }

    var stationsSeen = [];
    for (i = 0; i < rows.length; i++) {
        stationsSeen.push({});
    }

    var total = 0.0;
    for (i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        if (!CsContrib.counts(s)) {
            continue;
        }
        var id = s.trip || 0;
        if (id < 0 || id >= rows.length) {
            id = 0;   // a shot whose trip index is gone still counts
        }
        rows[id].distance += s.distance;
        rows[id].planDistance += CsTraverse.offset(s, tapeMode).plan;
        rows[id].shotCount++;
        stationsSeen[id][s.from] = true;
        stationsSeen[id][s.to] = true;
        total += s.distance;
    }

    for (i = 0; i < rows.length; i++) {
        rows[i].percent = CsContrib.share(rows[i].distance, total);
        var n = 0;
        for (var name in stationsSeen[i]) {
            if (stationsSeen[i].hasOwnProperty(name)) {
                n++;
            }
        }
        rows[i].stationCount = n;
    }
    return rows;
};

/**
 * Trip rows grouped by their team text.
 *
 * \return [{team, distance, percent, tripCount, tripIds}] in
 *         first-appearance order
 */
CsContrib.byTeam = function(tripRows) {
    var order = [], byKey = {}, total = 0.0;
    for (var i = 0; i < tripRows.length; i++) {
        var r = tripRows[i];
        var key = r.team || "";
        if (byKey[key] === undefined) {
            byKey[key] = { team: key, distance: 0.0, percent: 0.0,
                tripCount: 0, tripIds: [] };
            order.push(key);
        }
        byKey[key].distance += r.distance;
        byKey[key].tripCount++;
        byKey[key].tripIds.push(r.tripId);
        total += r.distance;
    }
    var out = [];
    for (i = 0; i < order.length; i++) {
        var row = byKey[order[i]];
        row.percent = CsContrib.share(row.distance, total);
        out.push(row);
    }
    return out;
};

/**
 * Trip rows credited to each person who was on them, IN FULL -- see
 * the note at the top of this file.
 *
 * \return {rows: [{person, distance, percent, tripCount, tripIds}],
 *          overlapping: true when the credited total exceeds the
 *          survey total, i.e. parties of more than one exist}
 */
CsContrib.byPerson = function(tripRows) {
    var order = [], byKey = {}, total = 0.0, credited = 0.0;
    for (var i = 0; i < tripRows.length; i++) {
        var r = tripRows[i];
        total += r.distance;
        var names = CsContrib.people(r.team);
        for (var p = 0; p < names.length; p++) {
            var key = names[p].toUpperCase();
            if (byKey[key] === undefined) {
                byKey[key] = { person: names[p], distance: 0.0,
                    percent: 0.0, tripCount: 0, tripIds: [] };
                order.push(key);
            }
            byKey[key].distance += r.distance;
            byKey[key].tripCount++;
            byKey[key].tripIds.push(r.tripId);
            credited += r.distance;
        }
    }
    var rows = [];
    for (i = 0; i < order.length; i++) {
        var row = byKey[order[i]];
        row.percent = CsContrib.share(row.distance, total);
        rows.push(row);
    }
    return { rows: rows, overlapping: credited > total };
};

/** The note the window prints over the People section, so the reader is
 *  never left wondering why the column adds up to more than the cave. */
CsContrib.PERSON_CREDIT_NOTE =
    "Everyone on a trip is credited its whole distance, so these add " +
    "up to more than 100%.";

/**
 * One row per survey run (station-name prefix).
 *
 * A leg belongs to the run its TO station is in: that is the station
 * the shot established, and it is the same rule the profile bands use
 * to decide which run a leg belongs to. A leg from A3 into B1 is B's
 * first leg, not A's fourth.
 *
 * \return [{run, distance, percent, shotCount, stations}] in
 *         resolution order
 */
CsContrib.byRun = function(survey, resolved, tapeMode) {
    var grouped = CsProfile.groupRuns(resolved);
    var runOf = {};
    var i, k;
    for (i = 0; i < grouped.order.length; i++) {
        var key = grouped.order[i];
        var members = grouped.runs[key].stations;
        for (k = 0; k < members.length; k++) {
            runOf[members[k]] = key;
        }
    }

    var byKey = {}, order = [], total = 0.0;
    for (i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        if (!CsContrib.counts(s)) {
            continue;
        }
        var run = runOf[s.to];
        if (run === undefined) {
            continue;   // never resolved, or a name groupRuns refuses
        }
        if (byKey[run] === undefined) {
            byKey[run] = { run: run, distance: 0.0, percent: 0.0,
                shotCount: 0, stations: grouped.runs[run].stations };
            order.push(run);
        }
        byKey[run].distance += s.distance;
        byKey[run].shotCount++;
        total += s.distance;
    }

    // resolution order, not discovery-by-shot order, so the list reads
    // the same way the profile bands and the notebook do
    var out = [];
    for (i = 0; i < grouped.order.length; i++) {
        var ordered = byKey[grouped.order[i]];
        if (ordered !== undefined) {
            ordered.percent = CsContrib.share(ordered.distance, total);
            out.push(ordered);
        }
    }
    return out;
};

/** "1,234 ft" -- grouped, rounded to the whole unit, unit appended.
 *  Matches CsSheet's title-block Length so the two never look like
 *  different measurements of the same cave. */
CsContrib.distanceText = function(distance, unit) {
    var n = Math.round(distance === null || distance === undefined ?
        0 : distance);
    var text = String(Math.abs(n));
    var grouped = "";
    while (text.length > 3) {
        grouped = "," + text.substring(text.length - 3) + grouped;
        text = text.substring(0, text.length - 3);
    }
    grouped = text + grouped;
    if (n < 0) {
        grouped = "-" + grouped;
    }
    return grouped + ((unit === undefined || unit === null || unit === "") ?
        "" : (" " + unit));
};

/** "14%" -- and "<1%" for a real but tiny share, because a row that
 *  reads 0% next to a drawn passage looks like a bug. */
CsContrib.percentText = function(percent) {
    var p = (percent === null || percent === undefined) ? 0 : percent;
    if (p > 0 && p < 0.5) {
        return "<1%";
    }
    return String(Math.round(p)) + "%";
};
```

- [ ] **Step 4: Add the include to `scripts/CaveSurvey/Core/CsAll.js`**

`CsContrib` calls `CsModel.ensureTrips`, `CsTraverse.offset`, `CsProfile.groupRuns` and (optionally) `CsRevise.tripLabel`, so it loads after all four. Add as the LAST line of the file:

```js
include(includeBasePath + "/CsContrib.js");
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node tests/js_unit.js`
Expected: `### UNIT OK <n> assertions`, no `### UNIT FAIL`

Then the authoritative engine:

Run: `bash tests/run_all.sh`
Expected: every section OK, including `test_every_core_file_is_included_by_csall`

- [ ] **Step 6: Commit**

```bash
git add scripts/CaveSurvey/Core/CsContrib.js scripts/CaveSurvey/Core/CsAll.js tests/js_unit.js
git commit -m "feat(CsContrib): distance and percent contributions by trip, team, person and run"
```

---

### Task 2: CsFocus -- what a selection makes visible

**Goal:** A pure library that turns a set of station names into a per-entity visibility answer, reading the same tags `CsDraw.eraseStations` reads, with a test that fails if the two lists ever diverge.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsFocus.js`
- Modify: `scripts/CaveSurvey/Core/CsAll.js`
- Test: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `CsFocus.TAG_RULES` names every station-bearing tag `CsDraw.eraseStations` reads, and a test that parses `CsDraw.js` fails on any tag present in one and not the other
- [ ] `CsFocus.stationsOf(entity)` returns `{names, kind}` where `kind` is `"suite"`, `"linework"`, `"profile"` or `"none"`
- [ ] An entity carrying no known tag returns `kind: "none"` and `CsFocus.isVisible` returns TRUE for it under every station set
- [ ] A `Shot` tagged `A1->A2` is visible only when BOTH ends are in the set; a `WallRunStations` entity is visible when ANY of its stations is
- [ ] LRUD tip `A3.L2` and splay `A3.4` attribute to station `A3` (via `CsBind.lrudBase` / `CsBind.splayBase`)
- [ ] `CsFocus.stationSet` unions trips, teams, people and runs into one `{name: true}` map
- [ ] `CsFocus.isPlanFrame(layerName)` is false for `CTRL-PROFILE-*` and `PROFILE-*`, true otherwise
- [ ] `CsAll.js` includes `CsFocus.js`

**Verify:** `bash tests/run_all.sh` -> `### UNIT OK <n> assertions`, no `### UNIT FAIL`

**Steps:**

- [ ] **Step 1: Write the failing tests** -- append to `tests/js_unit.js`

```js
// ---------------------------------------------------------------------
// CsFocus -- what a trip/team/person/run selection makes visible
// ---------------------------------------------------------------------
(function() {
    loadRepoScript("scripts/CaveSurvey/Core/CsLayers.js");
    loadRepoScript("scripts/CaveSurvey/Core/CsTags.js");
    loadRepoScript("scripts/CaveSurvey/Core/CsBind.js");
    loadRepoScript("scripts/CaveSurvey/Core/CsFocus.js");

    // A stub entity: CsTags.get reads custom properties, so the test
    // fakes exactly that surface and nothing else.
    var fake = function(tags, layer) {
        return {
            _tags: tags,
            getLayerName: function() { return layer || "CTRL-SHOTS"; },
            getCustomProperty: function(group, key, def) {
                if (group !== "CaveSurvey") { return def; }
                return this._tags.hasOwnProperty(key) ? this._tags[key] : def;
            }
        };
    };

    var setOf = function(names) {
        var s = {};
        for (var i = 0; i < names.length; i++) { s[names[i]] = true; }
        return s;
    };

    // -- attribution -------------------------------------------------
    eqs(CsFocus.stationsOf(fake({ Station: "A1" })).names.join(","), "A1",
        "CsFocus.stationsOf: a station point is its own station");
    eqs(CsFocus.stationsOf(fake({ LRUDName: "A3.L2" })).names.join(","), "A3",
        "CsFocus.stationsOf: an inner LRUD tip belongs to its station");
    eqs(CsFocus.stationsOf(fake({ SplayName: "A3.4" })).names.join(","), "A3",
        "CsFocus.stationsOf: a splay tip belongs to the station it shoots from");
    eqs(CsFocus.stationsOf(fake({ Shot: "A1->A2" })).names.join(","), "A1,A2",
        "CsFocus.stationsOf: a leg belongs to both its ends");
    eqs(CsFocus.stationsOf(fake({ WallRunStations: "A1|A2|A3" })).names.length, 3,
        "CsFocus.stationsOf: a wall run belongs to every station it followed");
    eqs(CsFocus.stationsOf(fake({})).kind, "none",
        "CsFocus.stationsOf: an untagged entity belongs to nothing");
    eqs(CsFocus.stationsOf(fake({ LineworkStations: "A2|A3" },
        "WALLS")).kind, "linework",
        "CsFocus.stationsOf: traced linework is its own kind");
    eqs(CsFocus.stationsOf(fake({ ProfileStation: "A2" },
        "CTRL-PROFILE-FLOOR")).kind, "profile",
        "CsFocus.stationsOf: profile geometry is its own kind");

    // -- visibility --------------------------------------------------
    var focus = setOf(["A1", "A2"]);
    ok(CsFocus.isVisible(fake({ Shot: "A1->A2" }), focus),
        "CsFocus.isVisible: a leg inside the focus shows");
    ok(!CsFocus.isVisible(fake({ Shot: "A2->A3" }), focus),
        "CsFocus.isVisible: a leg leaving the focus does not");
    ok(CsFocus.isVisible(fake({ WallRunStations: "A2|A3|A4" }), focus),
        "CsFocus.isVisible: a wall run shows when ANY of its stations is focused");
    ok(CsFocus.isVisible(fake({}), focus),
        "CsFocus.isVisible: an untagged entity always shows -- title block, " +
        "border, basemap, the reader's own sketches");
    ok(CsFocus.isVisible(fake({ Station: "A1" }), null),
        "CsFocus.isVisible: a null focus set is 'All', not 'nothing'");

    // -- plan only ---------------------------------------------------
    ok(CsFocus.isPlanFrame("CTRL-SHOTS"),
        "CsFocus.isPlanFrame: plan geometry is in frame");
    ok(!CsFocus.isPlanFrame("CTRL-PROFILE-FLOOR"),
        "CsFocus.isPlanFrame: generated profile geometry is not");
    ok(!CsFocus.isPlanFrame("PROFILE-WALLS"),
        "CsFocus.isPlanFrame: hand-traced profile geometry is not either");

    // -- station sets ------------------------------------------------
    var tripStations = { 0: ["A1", "A2", ""], 1: ["A2", "A3"] };
    var runs = { A: ["A1", "A2", "A3"], B: ["B1"] };
    var set = CsFocus.stationSet({
        trips: [1], runs: ["B"]
    }, tripStations, runs);
    ok(set["A3"] === true && set["B1"] === true,
        "CsFocus.stationSet: unions the trips and the runs picked");
    ok(set["A1"] !== true,
        "CsFocus.stationSet: leaves out what nothing picked");
    ok(set[""] !== true,
        "CsFocus.stationSet: the blank TO of a splay is not a station");

    // -- THE INVARIANT: the erase rules and the focus rules read the
    // -- same tags. A tag added to one and not the other means geometry
    // -- a redraw replaces but a focus cannot see, which is silent.
    var drawSource = readTextFile(repoRoot +
        "/scripts/CaveSurvey/Core/CsDraw.js");
    var eraseBody = drawSource.substring(
        drawSource.indexOf("CsDraw.eraseStations = function"));
    eraseBody = eraseBody.substring(0, eraseBody.indexOf("\n};"));
    var eraseTags = {}, m;
    var re = /CsTags\.get\(e,\s*"([A-Za-z]+)"\)/g;
    while ((m = re.exec(eraseBody)) !== null) {
        eraseTags[m[1]] = true;
    }
    var focusTags = {};
    for (var r = 0; r < CsFocus.TAG_RULES.length; r++) {
        focusTags[CsFocus.TAG_RULES[r].tag] = true;
    }
    var name;
    for (name in eraseTags) {
        if (eraseTags.hasOwnProperty(name)) {
            ok(focusTags[name] === true,
                "CsFocus.TAG_RULES: eraseStations reads " + name +
                    " -- focus must attribute it too");
        }
    }
    for (name in focusTags) {
        if (focusTags.hasOwnProperty(name) &&
                name !== CsBind.STATIONS_TAG && name !== "ProfileStation" &&
                name !== "ProfileRun") {
            ok(eraseTags[name] === true,
                "CsFocus.TAG_RULES: " + name + " is not a tag eraseStations " +
                    "reads -- either it is stale or erase has a gap");
        }
    }
})();
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tests/js_unit.js`
Expected: FAIL -- `CsFocus.js` does not exist

- [ ] **Step 3: Write `scripts/CaveSurvey/Core/CsFocus.js`**

```js
// CsFocus.js -- which entities belong to which trips, teams, people and
// survey runs, and therefore what a focus selection shows.
//
// Part of the Cave Survey Core library: pure functions over an entity's
// TAGS. Nothing here touches a document, an operation or a widget, so
// the whole file is testable headless -- which matters, because the
// thing it decides (is this entity part of that trip?) is invisible
// when it is wrong. Applying the answer is TripFocus' job.
//
// FOCUS IS A SET OF STATION NAMES. Every row type in the window reduces
// to one: a trip's stations come from CsRevise.tripStationNames, a
// team's or a person's is the union over their trips, a run's is its own
// station list. One primitive, so a Teams row and a Runs row cannot
// disagree about what "in focus" means.
//
// THE FAIL-SAFE RULE: an entity this file cannot attribute to any
// station STAYS VISIBLE. Title block, border, sheet, basemap, symbols,
// the reader's own untagged sketches. This is the same doctrine the
// deleted Cave Mode used for menus -- an unknown thing showing is
// clutter, which is recoverable; an unknown thing vanishing is a
// support call.
//
// THE INVARIANT, pinned by a test: TAG_RULES below reads the same tags
// CsDraw.eraseStations reads. Those two lists are the drawing's only
// answers to "which station does this entity belong to". A tag added to
// erase and not here means geometry a redraw replaces but a focus
// cannot see; added here and not to erase means a redraw orphans it.
// The test parses eraseStations' body and fails either way.

var CsFocus = {};

/** How each tag's value maps to station names.
 *
 *  `base` is applied to the tag value; `split` means the value is a
 *  station LIST rather than one name; `both` means an "A1->A2" pair
 *  where the entity belongs to both ends. */
CsFocus.TAG_RULES = [
    { tag: "Station",          mode: "one" },
    { tag: "StationLabel",     mode: "one" },
    { tag: "LRUDName",         mode: "one", base: "lrud" },
    { tag: "LRUDLine",         mode: "one", base: "lrud" },
    { tag: "LRUDNote",         mode: "one" },
    { tag: "Splay",            mode: "one", base: "splay" },
    { tag: "SplayName",        mode: "one", base: "splay" },
    { tag: "SplayLabel",       mode: "one", base: "splay" },
    { tag: "NoteLabel",        mode: "one" },
    { tag: "NoteLeader",       mode: "one" },
    { tag: "Shot",             mode: "pair" },
    { tag: "RawStation",       mode: "one" },
    { tag: "RawShot",          mode: "pair" },
    { tag: "WallRunStations",  mode: "list" },
    { tag: "LineworkStations", mode: "list", kind: "linework" },
    { tag: "ProfileStation",   mode: "one",  kind: "profile" }
];

/** Tags whose presence means "every station has to be in focus", as
 *  against "any one of them". A LEG is the drawing's only record of a
 *  shot between two stations, so it belongs to both; a WALL RUN is
 *  generated geometry following a chain, and showing it beside a focused
 *  station it touches is more useful than hiding it because the chain
 *  wandered out of focus. */
CsFocus.ALL_ENDS_MODES = { pair: true };

CsFocus.applyBase = function(value, base) {
    if (base === "lrud") {
        return CsBind.lrudBase(value);
    }
    if (base === "splay") {
        return CsBind.splayBase(value);
    }
    return value;
};

/**
 * The stations an entity belongs to.
 *
 * \return {names: [stationName], kind: "suite"|"linework"|"profile"|
 *          "none", mode: the rule that matched, or ""}
 */
CsFocus.stationsOf = function(entity) {
    for (var i = 0; i < CsFocus.TAG_RULES.length; i++) {
        var rule = CsFocus.TAG_RULES[i];
        var value = CsTags.get(entity, rule.tag);
        if (value === "") {
            continue;
        }
        var names = [];
        if (rule.mode === "pair") {
            var ends = String(value).split("->");
            for (var e = 0; e < ends.length; e++) {
                if (ends[e] !== "") {
                    names.push(ends[e]);
                }
            }
        } else if (rule.mode === "list") {
            var members = CsBind.decodeStations(value);
            for (var m = 0; m < members.length; m++) {
                if (members[m] !== "") {
                    names.push(members[m]);
                }
            }
        } else {
            var one = CsFocus.applyBase(value, rule.base);
            if (one !== "") {
                names.push(one);
            }
        }
        if (names.length === 0) {
            continue;   // a tag present but empty attributes nothing
        }
        return {
            names: names,
            kind: (rule.kind === undefined) ? "suite" : rule.kind,
            mode: rule.mode
        };
    }
    return { names: [], kind: "none", mode: "" };
};

/**
 * Is this entity in focus?
 *
 * \param stationSet {name: true}, or null/undefined for "All"
 */
CsFocus.isVisible = function(entity, stationSet) {
    if (stationSet === undefined || stationSet === null) {
        return true;   // All: nothing is filtered
    }
    var att = CsFocus.stationsOf(entity);
    if (att.kind === "none") {
        return true;   // the fail-safe rule -- see the file header
    }
    var needsAll = CsFocus.ALL_ENDS_MODES[att.mode] === true;
    var anyIn = false;
    for (var i = 0; i < att.names.length; i++) {
        var hit = stationSet[att.names[i]] === true;
        if (needsAll && !hit) {
            return false;
        }
        if (hit) {
            anyIn = true;
        }
    }
    return anyIn;
};

/** Plan frame or not. Nathan's decision: the viewer is plan only, so
 *  the profile band is hidden whatever is checked. Delegates to
 *  CsLayers.frameOf so the two spellings of the profile frame
 *  (CTRL-PROFILE-* generated, PROFILE-* traced) stay in one place. */
CsFocus.isPlanFrame = function(layerName) {
    return CsLayers.frameOf(layerName) !== "profile";
};

/**
 * The station set a window selection makes.
 *
 * \param picked {trips: [tripId], teams: [teamText], people: [name],
 *                runs: [runKey]} -- any key may be absent
 * \param tripStations {tripId: [stationName]} from
 *                     CsRevise.tripStationNames
 * \param runStations {runKey: [stationName]} from CsProfile.groupRuns
 * \param tripsForGroup {teamText or person: [tripId]} -- what byTeam
 *                      and byPerson put in their rows' tripIds
 * \return {stationName: true}
 */
CsFocus.stationSet = function(picked, tripStations, runStations,
        tripsForGroup) {
    var set = {};
    var addTrip = function(id) {
        var names = tripStations[id];
        if (names === undefined || names === null) {
            return;
        }
        for (var i = 0; i < names.length; i++) {
            // tripStationNames pushes the blank TO of every splay; a
            // blank is not a station and must not enter the set, or
            // every entity tagged with an empty name reads as focused
            if (names[i] !== "" && names[i] !== null &&
                    names[i] !== undefined) {
                set[names[i]] = true;
            }
        }
    };

    var i, j, ids;
    if (picked.trips !== undefined && picked.trips !== null) {
        for (i = 0; i < picked.trips.length; i++) {
            addTrip(picked.trips[i]);
        }
    }
    var groups = [picked.teams, picked.people];
    for (var g = 0; g < groups.length; g++) {
        if (groups[g] === undefined || groups[g] === null) {
            continue;
        }
        for (i = 0; i < groups[g].length; i++) {
            ids = (tripsForGroup === undefined || tripsForGroup === null) ?
                null : tripsForGroup[groups[g][i]];
            if (ids === undefined || ids === null) {
                continue;
            }
            for (j = 0; j < ids.length; j++) {
                addTrip(ids[j]);
            }
        }
    }
    if (picked.runs !== undefined && picked.runs !== null) {
        for (i = 0; i < picked.runs.length; i++) {
            var members = runStations[picked.runs[i]];
            if (members === undefined || members === null) {
                continue;
            }
            for (j = 0; j < members.length; j++) {
                if (members[j] !== "") {
                    set[members[j]] = true;
                }
            }
        }
    }
    return set;
};

/** True when the selection picked nothing at all -- the window shows
 *  everything rather than an empty view, because a blank drawing looks
 *  like a broken tool. */
CsFocus.isEmptySelection = function(picked) {
    var keys = ["trips", "teams", "people", "runs"];
    for (var i = 0; i < keys.length; i++) {
        var list = picked[keys[i]];
        if (list !== undefined && list !== null && list.length > 0) {
            return false;
        }
    }
    return true;
};
```

- [ ] **Step 4: Add the include to `scripts/CaveSurvey/Core/CsAll.js`**

`CsFocus` calls `CsTags`, `CsBind` and `CsLayers`, so it loads after all three. Add after the `CsContrib.js` line:

```js
include(includeBasePath + "/CsFocus.js");
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node tests/js_unit.js`
Expected: `### UNIT OK <n> assertions`

Run: `bash tests/run_all.sh`
Expected: all sections OK

- [ ] **Step 6: Commit**

```bash
git add scripts/CaveSurvey/Core/CsFocus.js scripts/CaveSurvey/Core/CsAll.js tests/js_unit.js
git commit -m "feat(CsFocus): attribute drawn entities to trips, teams and runs"
```

---

### Task 3: The window, showing the whole drawing

**Goal:** Cave Survey > Trip Focus opens a standalone, non-modal window containing a live, pannable view of a PRIVATE COPY of the drawing -- no filtering yet, and provably nothing written to the user's document.

**Files:**
- Create: `scripts/CaveSurvey/TripFocus/TripFocus.js`
- Create: `scripts/CaveSurvey/TripFocus/TripFocus.svg`
- Modify: `README.md` (the `## The tools` table)
- Test: `tests/test_addon.py` runs unchanged and must stay green

**Acceptance Criteria:**
- [ ] `tripfocus` and `tf` both open the window; it also appears in the Cave Survey menu and toolbar
- [ ] The window is non-modal (`show()`, not `exec()`) -- the main window still pans and zooms while it is open
- [ ] The view shows the drawing's plan geometry and can be panned and zoomed
- [ ] `doc.isModified()` is unchanged by opening, using and closing the window
- [ ] The main window's selection is unchanged by opening the window
- [ ] Closing the window destroys the scratch document interface (`destr`) -- reopening ten times does not grow memory without bound
- [ ] `sortOrder` 30 is unique; the README table lists `tripfocus`
- [ ] `python3 -m unittest discover -s tests` passes, `CAVESURVEY_PUBLISH_CHECK=1` included

**Verify:** `bash tests/run_all.sh` green, then in a GUI CaveCAD: open a drawing with a survey, type `tf`, confirm the window opens with the drawing in it and the title bar of the main document shows no modified marker

**Steps:**

- [ ] **Step 1: Write `scripts/CaveSurvey/TripFocus/TripFocus.js`**

```js
// TripFocus.js
//
// QCAD add-on tool: a standalone window showing who surveyed what.
//
// Each trip, team, person and survey run is listed with the distance it
// surveyed and its share of the cave. Check any of them and the view
// beside the list shows just that work.
//
// WHY A SEPARATE WINDOW WITH ITS OWN COPY OF THE DRAWING, rather than
// hiding entities in the drawing itself: everything this window does is
// done to a PRIVATE COPY, so the user's drawing is never written to.
// That is not tidiness. Hiding entities in the real document walks into
// four separate silent failures in this build -- an invisible entity is
// not editable, so un-hiding it is refused with no error; eraseStations
// then cannot delete it either, so the next redraw draws a duplicate
// beside it; every toggle marks the drawing modified; and every toggle
// lands on the undo stack. A scratch copy has none of those, and it is
// also what makes the next step (colour by trip) safe, since recolouring
// a copy cannot overwrite the cartographer's own colours.
//
// USAGE:
//   Cave Survey > Trip Focus   (or type "tripfocus" / "tf")

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

function TripFocus(guiAction) {
    EAction.call(this, guiAction);
}

TripFocus.prototype = new EAction();

/** The one live window. Reopening focuses it rather than stacking a
 *  second copy: two windows would each hold a full copy of the drawing
 *  and each claim to be the focus. */
TripFocus.dialog = null;
TripFocus.previewDi = null;
/** {tree, read, view, doc} while the window is open, null otherwise. */
TripFocus.state = null;

TripFocus.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    TripFocus.show(this.getDocument());
    this.terminate();
};

/**
 * A private copy of `sourceDoc` and an interface onto it.
 *
 * setSelectionOnly(false) is what makes this safe: with it ON (the
 * default) RCopyOperation copies the SOURCE's selection, which would
 * mean selecting entities in the user's drawing to look at them. With it
 * off, RClipboardOperation copies queryAllEntities() and carries layers,
 * linetypes and blocks across, so the copy is faithful and the main
 * window's selection is never touched.
 */
TripFocus.buildPreview = function(sourceDoc) {
    var previewDoc = new RDocument(new RMemoryStorage(),
        createSpatialIndex());
    var di = new RDocumentInterface(previewDoc);
    di.setNotifyListeners(false);

    var op = new RCopyOperation(new RVector(0, 0), sourceDoc);
    op.setSelectionOnly(false);
    di.applyOperation(op);
    return di;
};

TripFocus.show = function(doc) {
    if (TripFocus.dialog !== null && TripFocus.dialog !== undefined) {
        TripFocus.dialog.raise();
        return;
    }

    var dlg = new QDialog(RMainWindowQt.getMainWindow());
    dlg.windowTitle = "Trip Focus";
    // a window in its own right, not a sheet stuck to the main one:
    // the reader compares it against the drawing behind it
    dlg.setSizeGripEnabled(true);
    var layout = new QVBoxLayout();

    var di = TripFocus.buildPreview(doc);
    TripFocus.previewDi = di;

    var view = new RGraphicsViewQt(dlg, false);
    view.objectName = "TripFocusView";
    var imageView = view.getImageView();
    imageView.setScene(new RGraphicsSceneQt(di));
    imageView.setPaintOrigin(false);
    imageView.setMargin(10);
    layout.addWidget(view, 1, 0);

    var buttons = new QHBoxLayout();
    var closeButton = new QPushButton("Close");
    buttons.addStretch(1);
    buttons.addWidget(closeButton, 0, 0);
    layout.addLayout(buttons, 0);

    dlg.setLayout(layout);
    dlg.resize(900, 600);

    closeButton.clicked.connect(dlg, "close");
    dlg.finished.connect(function() { TripFocus.cleanUp(); });

    TripFocus.dialog = dlg;
    dlg.show();                  // NON-modal: exec() would freeze the
                                 // main window the reader is comparing
                                 // against
    imageView.autoZoom();
};

/** Frees the scratch document AND the dialog. A preview left behind
 *  holds a whole second copy of the drawing; ten opens without this is
 *  ten copies. The dialog needs freeing too -- it is parented to the
 *  main window, so without destrDialog it survives every close until
 *  the app exits, taking its view and scene with it. */
TripFocus.cleanUp = function() {
    if (TripFocus.previewDi !== null && TripFocus.previewDi !== undefined) {
        destr(TripFocus.previewDi);
        TripFocus.previewDi = null;
    }
    if (TripFocus.dialog !== null && TripFocus.dialog !== undefined) {
        destrDialog(TripFocus.dialog);
    }
    TripFocus.dialog = null;
    TripFocus.state = null;
};

TripFocus.init = function(basePath) {
    var action = new RGuiAction(qsTr("Trip Focus"),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/TripFocus.js");
    action.setIcon(basePath + "/TripFocus.svg");
    action.setStatusTip(qsTr("See how much of the cave each trip, team " +
        "and person surveyed, and look at just their work."));
    action.setDefaultCommands(["tripfocus", "tf"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(30);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
```

- [ ] **Step 2: Draw the icon** -- `scripts/CaveSurvey/TripFocus/TripFocus.svg`

A survey chain with one leg picked out, matching the flat two-colour style of the suite's other icons. Must be parseable XML (`test_every_icon_is_parseable_svg`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
  <g fill="none" stroke="#808080" stroke-width="1.4" stroke-linecap="round">
    <path d="M3 19 L8 13 L12 15"/>
    <circle cx="3" cy="19" r="1.3" fill="#808080" stroke="none"/>
    <circle cx="8" cy="13" r="1.3" fill="#808080" stroke="none"/>
  </g>
  <g fill="none" stroke="#c8321e" stroke-width="1.8" stroke-linecap="round">
    <path d="M12 15 L16 8 L21 6"/>
    <circle cx="12" cy="15" r="1.6" fill="#c8321e" stroke="none"/>
    <circle cx="16" cy="8" r="1.6" fill="#c8321e" stroke="none"/>
    <circle cx="21" cy="6" r="1.6" fill="#c8321e" stroke="none"/>
  </g>
</svg>
```

- [ ] **Step 3: Add the README row**

In `README.md`, inside the `## The tools` table, after the `Survey Stats | sst` row:

```markdown
| Trip Focus | `tf` | See how much of the cave each trip, team and person surveyed -- distance and share -- and look at just their work in a window of its own. Your drawing is never touched: the window renders its own copy. |
```

- [ ] **Step 4: Run the structural and syntax tests**

Run: `bash tests/run_all.sh`
Expected: all sections OK -- in particular `test_sort_orders_are_unique`, `test_every_tool_appears_in_the_readme_table`, `test_readme_table_advertises_no_tool_that_does_not_exist`, `test_every_icon_is_parseable_svg`

Run: `CAVESURVEY_PUBLISH_CHECK=1 python3 -m unittest discover -s tests`
Expected: OK

- [ ] **Step 5: Check it in a real GUI**

Install and launch:

```bash
tools/publish.sh && open ~/Applications/CaveCAD.app
```

In CaveCAD: open a drawing that has a survey in it, type `tf`. Confirm:
the window opens as its own window; the drawing is in it; the wheel
zooms and dragging pans; the main window still works while it is open;
the main window's title shows no modified marker after closing; nothing
in the main drawing became selected.

- [ ] **Step 6: Commit**

```bash
git add scripts/CaveSurvey/TripFocus README.md
git commit -m "feat(TripFocus): a standalone window rendering its own copy of the drawing"
```

---

### Task 4: The contributions list

**Goal:** Fill the window's left pane with the four sections -- Trips, Teams, People, Survey runs -- each row showing distance and percent, each row checkable.

**Files:**
- Modify: `scripts/CaveSurvey/TripFocus/TripFocus.js`
- Test: `tests/js_unit.js` (the row-building helper, which is pure)

**Acceptance Criteria:**
- [ ] The pane is a `QTreeWidget` with three columns -- what, distance, share -- and four top-level section items
- [ ] Every row shows `CsContrib.distanceText` and `CsContrib.percentText` values
- [ ] The People section carries `CsContrib.PERSON_CREDIT_NOTE` as a visible note when `overlapping` is true
- [ ] Checking a section item checks all its children; a section with no rows reads "none recorded" and is disabled rather than absent
- [ ] `TripFocus.picked(tree)` returns `{trips, teams, people, runs}` from the checked items
- [ ] A drawing with no survey in it opens the window with every section empty and no exception
- [ ] When `CsContrib.byRun` reports unassigned distance, the Survey runs section lists a `(not in any run)` row that is NOT checkable, so the runs visibly do not add up to the whole cave

**Verify:** `bash tests/run_all.sh` green; in the GUI, `tf` on the Pitfall Cave fixture lists its four trips with distances that sum to the title block Length

**Steps:**

- [ ] **Step 1: Write the failing test for the pure row builder** -- append to `tests/js_unit.js`

```js
// ---------------------------------------------------------------------
// TripFocus.sections -- the rows the window lists (pure part)
// ---------------------------------------------------------------------
(function() {
    loadRepoScript("scripts/CaveSurvey/Core/CsAngles.js");
    loadRepoScript("scripts/CaveSurvey/Core/CsUnits.js");
    loadRepoScript("scripts/CaveSurvey/Core/CsModel.js");
    loadRepoScript("scripts/CaveSurvey/Core/CsTraverse.js");
    loadRepoScript("scripts/CaveSurvey/Core/CsNetwork.js");
    loadRepoScript("scripts/CaveSurvey/Core/CsProfile.js");
    loadRepoScript("scripts/CaveSurvey/Core/CsStats.js");
    loadRepoScript("scripts/CaveSurvey/Core/CsContrib.js");
    loadRepoScript("scripts/CaveSurvey/TripFocus/TripFocusRows.js");

    var survey = CsModel.newSurvey();
    survey.distanceUnit = "ft";
    var t0 = CsModel.newTrip();
    t0.date = "2024-03-16"; t0.team = "Nathan, Jim";
    survey.trips = [t0];
    var s = CsModel.newShot();
    s.from = "A1"; s.to = "A2"; s.distance = 100.0; s.azimuth = 0.0;
    survey.shots = [s];
    var resolved = CsNetwork.resolve(survey);

    var sections = TripFocusRows.build(survey, resolved, CsTraverse.SLOPE);
    eqs(sections.length, 4,
        "TripFocusRows.build: trips, teams, people and runs");
    eqs(sections[0].key, "trips", "TripFocusRows.build: trips first");
    eqs(sections[0].rows[0].distanceText, "100 ft",
        "TripFocusRows.build: the row carries its formatted distance");
    eqs(sections[0].rows[0].percentText, "100%",
        "TripFocusRows.build: one trip surveyed all of it");
    eqs(sections[2].key, "people", "TripFocusRows.build: people third");
    eqs(sections[2].rows.length, 2, "TripFocusRows.build: Nathan and Jim");
    ok(sections[2].note.length > 0,
        "TripFocusRows.build: the People section says credit is not divided");

    var empty = CsModel.newSurvey();
    // a shot into a station that never resolved: its distance belongs to
    // no run, and the section has to say so rather than rescale itself
    var orphaned = CsModel.newSurvey();
    orphaned.distanceUnit = "ft";
    orphaned.trips = [t0];
    var connected = CsModel.newShot();
    connected.from = "A1"; connected.to = "A2";
    connected.distance = 200.0; connected.azimuth = 0.0;
    var stray = CsModel.newShot();
    stray.from = "Q1"; stray.to = "Q.2";   // splitName refuses a dotted name
    stray.distance = 300.0; stray.azimuth = 0.0;
    orphaned.shots = [connected, stray];
    var orphanSections = TripFocusRows.build(orphaned,
        CsNetwork.resolve(orphaned), CsTraverse.SLOPE);
    var runSection = orphanSections[3];
    var unassignedRow = runSection.rows[runSection.rows.length - 1];
    eqs(unassignedRow.label, "(not in any run)",
        "TripFocusRows.build: distance no run claimed is listed, not dropped");
    ok(isNull(unassignedRow.pick),
        "TripFocusRows.build: the unassigned row is not checkable -- there " +
        "is no station set to focus");

    var emptySections = TripFocusRows.build(empty,
        CsNetwork.resolve(empty), CsTraverse.SLOPE);
    eqs(emptySections.length, 4,
        "TripFocusRows.build: an empty drawing still has four sections");
    eqs(emptySections[3].rows.length, 0,
        "TripFocusRows.build: no runs in an empty drawing");
})();
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/js_unit.js`
Expected: FAIL -- `TripFocusRows.js` does not exist

- [ ] **Step 3: Write `scripts/CaveSurvey/TripFocus/TripFocusRows.js`**

A second file in the tool's own folder, not in Core: it is specific to
this window's list, and `test_every_folder_is_a_tool_or_a_known_library`
keys a TOOL on `<Folder>.js` existing, so a sibling file beside it is
fine (`FeatureTrace/FeatureTraceRun.js` is the precedent).

```js
// TripFocusRows.js -- the rows the Trip Focus window lists.
//
// Pure: survey in, display rows out. Separated from TripFocus.js so the
// numbers and the labels are testable headless while the widgets are
// not.

var TripFocusRows = {};

/**
 * \return [{key, title, note, rows: [{label, distanceText, percentText,
 *          pick}]}] -- four sections, always, in list order. `pick` is
 *          what CsFocus.stationSet wants: a trip id, a team text, a
 *          person name, or a run key.
 */
TripFocusRows.build = function(survey, resolved, tapeMode) {
    var unit = survey.distanceUnit || "";
    var tripRows = CsContrib.byTrip(survey, resolved, tapeMode);
    var teamRows = CsContrib.byTeam(tripRows);
    var personResult = CsContrib.byPerson(tripRows);
    var runResult = CsContrib.byRun(survey, resolved, tapeMode);
    var runRows = runResult.rows;

    /** Summed distance of the run rows -- the denominator's other half
     *  when working out what share the unclaimed distance is. */
    var runTotal = function(rows) {
        var sum = 0.0;
        for (var r = 0; r < rows.length; r++) {
            sum += rows[r].distance;
        }
        return sum;
    };

    var display = function(label, row, pick) {
        return {
            label: label,
            distanceText: CsContrib.distanceText(row.distance, unit),
            percentText: CsContrib.percentText(row.percent),
            pick: pick
        };
    };

    var trips = [], i;
    for (i = 0; i < tripRows.length; i++) {
        // a trip with no counted shots is still listed: "this party
        // went in and brought back nothing plottable" is information,
        // and hiding the row makes it look like the trip was never
        // recorded
        trips.push(display(tripRows[i].label, tripRows[i],
            tripRows[i].tripId));
    }

    var teams = [];
    for (i = 0; i < teamRows.length; i++) {
        teams.push(display(teamRows[i].team === "" ?
            "(no team recorded)" : teamRows[i].team,
            teamRows[i], teamRows[i].team));
    }

    var people = [];
    for (i = 0; i < personResult.rows.length; i++) {
        people.push(display(personResult.rows[i].person,
            personResult.rows[i], personResult.rows[i].person));
    }

    var runs = [];
    for (i = 0; i < runRows.length; i++) {
        runs.push(display("Survey " + runRows[i].run, runRows[i],
            runRows[i].run));
    }
    // Distance no run could claim -- a shot into a station that never
    // resolved, which is the normal state of a survey mid-project. It is
    // LISTED so the runs visibly do not add up to the cave, and it is
    // NOT checkable (pick null): there is no station set to focus, since
    // the stations it belongs to are exactly the ones the drawing could
    // not place. Hiding it instead would make the Survey runs section
    // quietly claim 100% of a cave it only covers part of.
    if (runResult.unassigned > 0) {
        runs.push({
            label: "(not in any run)",
            distanceText: CsContrib.distanceText(runResult.unassigned, unit),
            percentText: CsContrib.percentText(
                CsContrib.share(runResult.unassigned,
                    runResult.unassigned + runTotal(runRows))),
            pick: null
        });
    }

    return [
        { key: "trips",  title: "Trips",       note: "", rows: trips },
        { key: "teams",  title: "Teams",       note: "", rows: teams },
        { key: "people", title: "People",
          note: personResult.overlapping ? CsContrib.PERSON_CREDIT_NOTE : "",
          rows: people },
        { key: "runs",   title: "Survey runs", note: "", rows: runs }
    ];
};

/** trip ids per team text and per person, for CsFocus.stationSet. */
TripFocusRows.tripsForGroup = function(survey, resolved, tapeMode) {
    var tripRows = CsContrib.byTrip(survey, resolved, tapeMode);
    var out = {};
    var i, rows = CsContrib.byTeam(tripRows);
    for (i = 0; i < rows.length; i++) {
        out[rows[i].team] = rows[i].tripIds;
    }
    var persons = CsContrib.byPerson(tripRows).rows;
    for (i = 0; i < persons.length; i++) {
        out[persons[i].person] = persons[i].tripIds;
    }
    return out;
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/js_unit.js`
Expected: `### UNIT OK <n> assertions`

- [ ] **Step 5: Build the tree pane in `TripFocus.js`**

Add the include at the top, beside the others. It MUST be
`includeBasePath`-relative: `tests/test_addon.py`'s
`test_every_include_target_exists` greps for and BANS the
`include("scripts/CaveSurvey/...")` form, because it resolves only
against the app bundle and fails silently from a per-user install.

```js
include(includeBasePath + "/TripFocusRows.js");
```

Add the tree builder, and put the tree and the view in a splitter
inside `TripFocus.show` (replacing the plain `layout.addWidget(view...)`):

```js
/** The reconstructed survey the window is describing, or null when the
 *  drawing holds none. Read once per open/Refresh -- surveyFromDocument
 *  is a full document scan. */
TripFocus.readSurvey = function(doc) {
    try {
        var recon = CsRevise.surveyFromDocument(doc);
        if (isNull(recon) || isNull(recon.survey)) {
            return null;
        }
        var resolved = CsNetwork.resolve(recon.survey);
        return { survey: recon.survey, resolved: resolved };
    } catch (e) {
        return null;
    }
};

TripFocus.COL_WHAT = 0;
TripFocus.COL_DISTANCE = 1;
TripFocus.COL_SHARE = 2;

/** The list pane. Section items carry their own key in column 0's
 *  user role so picked() can read a checked child's section without
 *  walking back up by title text. */
TripFocus.buildTree = function(read) {
    var tree = new QTreeWidget();
    tree.objectName = "TripFocusTree";
    tree.columnCount = 3;
    tree.setHeaderLabels(["Contributor", "Distance", "Share"]);
    tree.rootIsDecorated = true;
    tree.uniformRowHeights = true;

    if (read === null) {
        var none = new QTreeWidgetItem(tree);
        none.setText(TripFocus.COL_WHAT, "No survey data in this drawing");
        none.setDisabled(true);
        return tree;
    }

    var sections = TripFocusRows.build(read.survey, read.resolved,
        CsTraverse.SLOPE);
    for (var s = 0; s < sections.length; s++) {
        var section = sections[s];
        var head = new QTreeWidgetItem(tree);
        head.setText(TripFocus.COL_WHAT, section.title +
            (section.note === "" ? "" : "  -- " + section.note));
        head.setData(TripFocus.COL_WHAT, Qt.UserRole, section.key);
        head.setExpanded(true);

        if (section.rows.length === 0) {
            head.setDisabled(true);
            head.setText(TripFocus.COL_WHAT, section.title +
                "  (none recorded)");
            continue;
        }
        head.setFlags(head.flags() | Qt.ItemIsUserCheckable);
        head.setCheckState(TripFocus.COL_WHAT, Qt.Unchecked);

        for (var r = 0; r < section.rows.length; r++) {
            var row = section.rows[r];
            var item = new QTreeWidgetItem(head);
            item.setText(TripFocus.COL_WHAT, row.label);
            item.setText(TripFocus.COL_DISTANCE, row.distanceText);
            item.setText(TripFocus.COL_SHARE, row.percentText);
            if (isNull(row.pick)) {
                // informational only -- see TripFocusRows' unassigned row
                item.setDisabled(true);
            } else {
                item.setFlags(item.flags() | Qt.ItemIsUserCheckable);
                item.setCheckState(TripFocus.COL_WHAT, Qt.Unchecked);
            }
            item.setData(TripFocus.COL_WHAT, Qt.UserRole, section.key);
            item.setData(TripFocus.COL_SHARE, Qt.UserRole,
                isNull(row.pick) ? null : String(row.pick));
        }
    }
    return tree;
};

/** What is checked, in the shape CsFocus.stationSet wants. A trip's
 *  pick round-trips through text (Qt.UserRole is set as a string), so
 *  it comes back parsed rather than as "0". */
TripFocus.picked = function(tree) {
    var out = { trips: [], teams: [], people: [], runs: [] };
    for (var s = 0; s < tree.topLevelItemCount; s++) {
        var head = tree.topLevelItem(s);
        for (var r = 0; r < head.childCount(); r++) {
            var item = head.child(r);
            if (item.checkState(TripFocus.COL_WHAT) !== Qt.Checked) {
                continue;
            }
            var key = item.data(TripFocus.COL_WHAT, Qt.UserRole);
            var pick = item.data(TripFocus.COL_SHARE, Qt.UserRole);
            if (isNull(pick) || pick === "null") {
                continue;   // the "(not in any run)" row: nothing to focus
            }
            if (key === "trips") {
                out.trips.push(parseInt(pick, 10));
            } else if (key === "teams") {
                out.teams.push(String(pick));
            } else if (key === "people") {
                out.people.push(String(pick));
            } else if (key === "runs") {
                out.runs.push(String(pick));
            }
        }
    }
    return out;
};
```

In `TripFocus.show`, replace the view-only layout with a splitter and
keep the pieces on the dialog object so the next task can reach them:

```js
    var read = TripFocus.readSurvey(doc);
    var tree = TripFocus.buildTree(read);

    var splitter = new QSplitter(Qt.Horizontal, dlg);
    splitter.addWidget(tree);
    splitter.addWidget(view);
    splitter.setSizes([320, 620]);
    layout.addWidget(splitter, 1, 0);

    // one window at a time (show() raises the existing one), so the
    // window's parts live here rather than as properties bolted onto the
    // QDialog wrapper -- Refresh replaces the tree widget, and a stale
    // reference on a wrapper object is the kind of thing that reads as
    // "the buttons stopped working" much later
    TripFocus.state = { tree: tree, read: read, view: view, doc: doc };
```

Section checkboxes drive their children:

```js
    tree.itemChanged.connect(function(item, column) {
        if (column !== TripFocus.COL_WHAT || TripFocus.inCascade) {
            return;
        }
        if (item.childCount() === 0) {
            return;
        }
        TripFocus.inCascade = true;   // a child's own itemChanged would
                                      // otherwise re-enter this handler
        var state = item.checkState(TripFocus.COL_WHAT);
        for (var r = 0; r < item.childCount(); r++) {
            item.child(r).setCheckState(TripFocus.COL_WHAT, state);
        }
        TripFocus.inCascade = false;
    });
```

- [ ] **Step 6: Check it in the GUI**

```bash
tools/publish.sh && open ~/Applications/CaveCAD.app
```

Open `testdata/` Pitfall Cave, type `tf`. Confirm four trips are listed
with dates and teams, the distances sum to the Length on the title
block, People lists each person with the credit note, and checking a
section head checks its rows.

- [ ] **Step 7: Commit**

```bash
git add scripts/CaveSurvey/TripFocus tests/js_unit.js
git commit -m "feat(TripFocus): list each trip, team, person and run with its distance and share"
```

---

### Task 5: Filtering the view

**AMENDED AFTER IMPLEMENTATION (commit `485ffae`).** The `applyFocus` source
below is superseded -- read the shipped `TripFocus.js`. Its mechanism does not
work: **`entity.setInvisible()` inside an `RModifyObjectsOperation` is silently
dropped for any ordinary entity.** `RTransaction`'s modify path is a property
diff over `object->getPropertyTypeIds()` (`RTransaction.cpp:845,868`) and only
saves when that diff reports a change (`:915,935`), while
`RObject::PropertyInvisible` is registered once against `RObject::getRtti()`
(`RObject.cpp:75`) and re-registered per type only by `RAttributeEntity` /
`RAttributeDefinitionEntity`. The clone's flag flips; the stored object never
changes; nothing errors. `setAllowInvisible(true)` and `setAllowAll(true)` do
NOT rescue it -- they gate an earlier check that is never reached, which is
exactly why the draft treated them as load-bearing. (This is also why
`CsLayers.withLayerOn` works: `RLayer` registers its own off/frozen
properties.)

The shipped mechanism is `RChangePropertyOperation(RObject.PropertyInvisible,
value, RS.EntityAll, false)` over the PREVIEW document's own selection -- what
QCAD's property editor itself uses, handing the transaction an explicit
one-property set instead of relying on the diff. It also calls
`setAllowInvisible(true)` internally, so the caller needs no such call.
Verified in both directions in the real engine, and the un-hide assertion in
`tests/trip_focus_filter.js` was confirmed to go red when that branch is
broken.

Two further corrections made while implementing: `CsLayers.ensureSurveyLayers`
does NOT create `CTRL-LRUD-WALL-LEFT`, `CTRL-PROFILE-FLOOR` or `TITLE-BLOCK`,
so the test must `CsLayers.ensure` them explicitly or its entities land on the
default layer and the profile-frame assertions pass for the wrong reason; and
`show()` calls `reapply()` once after wiring, so the profile band is out of the
window from the moment it opens rather than after the first click.

**Goal:** Checking rows filters the preview: only entities attributable to the checked stations are drawn, the profile band never is, and All / Refresh work.

**Files:**
- Modify: `scripts/CaveSurvey/TripFocus/TripFocus.js`
- Test: `tests/js_unit.js` (the plan-frame and empty-selection rules are already covered in Task 2; this task's verification is a GUI check plus a headless document test)
- Test: `tests/trip_focus_filter.js` (new headless document test)

**Acceptance Criteria:**
- [ ] Checking one trip leaves that trip's stations, labels, legs, LRUD, splays, notes and wall runs drawn and hides the others
- [ ] Nothing on a profile-frame layer (`CTRL-PROFILE-*`, `PROFILE-*`) is ever drawn in the window
- [ ] Untagged entities -- title block, border, basemap -- stay drawn under every selection
- [ ] Checking nothing shows everything (an empty selection reads as All, not as a blank drawing)
- [ ] **All** checks every row; **Refresh** rebuilds the copy and the list from the current drawing
- [ ] Un-hiding works: check a trip, then All, and everything is drawn again -- this needs `op.setAllowInvisible(true)`, without which the modify is silently refused
- [ ] The scratch document's operations are non-undoable (`new RModifyObjectsOperation(false)`)
- [ ] The user's document is untouched: `isModified()` unchanged, selection unchanged, undo stack unchanged

**Verify:** `CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/trip_focus_filter.js "$PWD"` prints `### FILTER OK`, then the GUI check in Step 5

**Steps:**

- [ ] **Step 1: Write the failing headless document test** -- `tests/trip_focus_filter.js`

Drives a real document through the same functions the window uses, in
CaveCAD's own engine. The GUI cannot be scripted, but the filter can.

```js
// trip_focus_filter.js -- does the focus filter hide the right entities?
//
// Runs in CaveCAD's own engine against a real document:
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/trip_focus_filter.js "$PWD"
//
// Prints "### FILTER OK <n> checks" or "### FILTER FAIL".
//
// The entities are hand-built and hand-tagged rather than drawn by
// CsDraw.survey: CsDraw.survey reads the CURRENT document out of
// getDocument()/getDocumentInterface(), so pointing it at a scratch
// document means stubbing two globals, and this test is about the
// FILTER, not about drawing. Six tagged entities exercise every
// attribution mode there is.

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

include(repoRoot + "/scripts/CaveSurvey/Core/CsAll.js");
include(repoRoot + "/scripts/CaveSurvey/TripFocus/TripFocusRows.js");
include(repoRoot + "/scripts/CaveSurvey/TripFocus/TripFocus.js");

var checks = 0, failures = [];
function ok(cond, what) {
    checks++;
    if (!cond) { failures.push(what); }
}

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);
di.setNotifyListeners(false);
CsLayers.ensureSurveyLayers(doc, di);

/** A tagged line on `layer`, returned by id. */
function tagged(layer, tagKey, tagValue, x) {
    var op = new RAddObjectsOperation();
    var e = new RLineEntity(doc, new RLineData(
        new RVector(x, 0), new RVector(x + 5, 0)));
    var layerId = doc.getLayerId(layer);
    if (layerId !== RObject.INVALID_ID) {
        e.setLayerId(layerId);
    }
    if (tagKey !== null) {
        CsTags.set(e, tagKey, tagValue);
    }
    op.addObject(e, false);
    // CTRL-RAW and CTRL-HIDDEN ship OFF, and an off layer silently
    // refuses adds in this build -- so anything landing there has to go
    // through withLayerOn or it is never in the document to filter.
    CsLayers.withLayerOn(doc, di, layer, function() {
        di.applyOperation(op);
    });
    return e.getId();
}

var idA1     = tagged("CTRL-STATIONS", "Station", "A1", 0);
var idLegIn  = tagged("CTRL-SHOTS", "Shot", "A1->A2", 10);
var idLegOut = tagged("CTRL-SHOTS", "Shot", "A3->A4", 20);
var idTip    = tagged("CTRL-LRUD", "LRUDName", "A4.L2", 30);
var idWall   = tagged("CTRL-LRUD-WALL-LEFT", "WallRunStations",
    "A2|A3|A4", 40);
var idProf   = tagged("CTRL-PROFILE-FLOOR", "ProfileStation", "A1", 50);
var idPlain  = tagged("TITLE-BLOCK", null, "", 60);

function invisible(id) {
    var e = doc.queryEntity(id);
    return isNull(e) ? false : e.isInvisible();
}

// -- focus on A1/A2 ---------------------------------------------------
var set = {};
set["A1"] = true;
set["A2"] = true;
TripFocus.applyFocus(di, set);

ok(!invisible(idA1), "a focused station stays drawn");
ok(!invisible(idLegIn), "a leg with both ends focused stays drawn");
ok(invisible(idLegOut), "a leg outside the focus is hidden");
ok(invisible(idTip), "an LRUD tip of an unfocused station is hidden");
ok(!invisible(idWall),
    "a wall run touching a focused station stays drawn (ANY, not ALL)");
ok(invisible(idProf),
    "profile-frame geometry is never drawn: the viewer is plan only");
ok(!invisible(idPlain),
    "an untagged entity always stays drawn -- title block, border, basemap");

// -- All restores -- THE check that catches a missing setAllowInvisible
TripFocus.applyFocus(di, null);
ok(!invisible(idLegOut) && !invisible(idTip),
    "All un-hides every plan entity (needs op.setAllowInvisible(true) -- " +
    "an invisible entity is not editable, so the modify is refused " +
    "silently without it)");
ok(invisible(idProf),
    "All still leaves the profile band out: plan only is not a filter " +
    "the reader can switch off");

if (failures.length === 0) {
    print("### FILTER OK " + checks + " checks");
} else {
    print("### FILTER FAIL");
    for (var f = 0; f < failures.length; f++) { print("  - " + failures[f]); }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/trip_focus_filter.js "$PWD"`
Expected: FAIL -- `TripFocus.applyFocus` is not a function

- [ ] **Step 3: Add `applyFocus` and the buttons to `TripFocus.js`**

```js
/**
 * Hides everything out of focus in the PREVIEW document.
 *
 * Three things here are load-bearing, and each is silent when wrong:
 *
 * - `setAllowInvisible(true)`: an invisible entity is not editable
 *   (REntity::isEditable returns false for it), so without this the
 *   operation that would un-hide it is refused with no error and All
 *   does nothing.
 * - `setAllowAll(true)`: layers that are off, locked or frozen refuse
 *   modifies in this build exactly as they refuse adds -- CTRL-RAW and
 *   CTRL-HIDDEN ship off, so their geometry would never take a flag.
 * - `new RModifyObjectsOperation(false)`: non-undoable. This is a view
 *   change, not an edit; and the scratch document's undo stack is
 *   never shown to anyone, so recording into it is pure cost.
 *
 * \param stationSet from CsFocus.stationSet, or null for All
 */
TripFocus.applyFocus = function(di, stationSet) {
    var doc = di.getDocument();
    var op = new RModifyObjectsOperation(false);
    op.setAllowInvisible(true);
    op.setAllowAll(true);

    var ids = doc.queryAllEntities(false, false);
    var changed = 0;
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        // Plan only (Nathan's decision): the profile band is out of the
        // window whatever is checked, so it is hidden before the focus
        // rules are consulted at all.
        var wanted = CsFocus.isPlanFrame(CsBind.layerNameOf(doc, e)) &&
            CsFocus.isVisible(e, stationSet);
        if (e.isInvisible() === !wanted) {
            continue;              // already in the right state
        }
        e.setInvisible(!wanted);
        op.addObject(e, false);
        changed++;
    }
    if (changed > 0) {
        di.applyOperation(op);
    }
    di.regenerateScenes();
    return changed;
};

/** Re-reads the drawing: a new copy, a rebuilt list. The window is a
 *  snapshot, not a mirror -- transactionUpdated is still unverified in
 *  this build, so refreshing is something the reader asks for rather
 *  than something we promise and half-deliver. */
TripFocus.refresh = function(sourceDoc) {
    var oldDi = TripFocus.previewDi;
    var di = TripFocus.buildPreview(sourceDoc);
    TripFocus.previewDi = di;
    TripFocus.state.view.getImageView().setScene(new RGraphicsSceneQt(di));
    if (!isNull(oldDi)) {
        destr(oldDi);
    }

    var read = TripFocus.readSurvey(sourceDoc);
    TripFocus.state.read = read;
    var fresh = TripFocus.buildTree(read);
    // swap the tree in place inside the splitter, so the reader's
    // pane widths survive a Refresh
    var splitter = TripFocus.state.tree.parentWidget();
    var index = splitter.indexOf(TripFocus.state.tree);
    var sizes = splitter.sizes();
    TripFocus.state.tree.setParent(null);
    splitter.insertWidget(index, fresh);
    splitter.setSizes(sizes);
    TripFocus.state.tree = fresh;
    TripFocus.wireTree();
    TripFocus.reapply();
};

/** Reads the checkboxes and applies them. Called on every change. */
TripFocus.reapply = function() {
    var read = TripFocus.state.read;
    if (isNull(read)) {
        TripFocus.applyFocus(TripFocus.previewDi, null);
        return;
    }
    var picked = TripFocus.picked(TripFocus.state.tree);
    if (CsFocus.isEmptySelection(picked)) {
        // nothing checked shows everything: a blank window looks like a
        // broken tool, not like an empty selection
        TripFocus.applyFocus(TripFocus.previewDi, null);
        return;
    }
    var grouped = CsProfile.groupRuns(read.resolved);
    var runStations = {};
    for (var i = 0; i < grouped.order.length; i++) {
        runStations[grouped.order[i]] =
            grouped.runs[grouped.order[i]].stations;
    }
    var set = CsFocus.stationSet(picked,
        CsRevise.tripStationNames(read.survey), runStations,
        TripFocusRows.tripsForGroup(read.survey, read.resolved,
            CsTraverse.SLOPE));
    TripFocus.applyFocus(TripFocus.previewDi, set);
};
```

Move the `itemChanged` connection into `TripFocus.wireTree()` so
Refresh can re-wire the replacement tree, and have it call
`TripFocus.reapply()` after the cascade. Add the two buttons beside
Close in `TripFocus.show`:

```js
    var allButton = new QPushButton("All");
    var refreshButton = new QPushButton("Refresh");
    buttons.addWidget(allButton, 0, 0);
    buttons.addWidget(refreshButton, 0, 0);

    allButton.clicked.connect(function() {
        TripFocus.inCascade = true;
        var tree = TripFocus.state.tree;
        for (var s = 0; s < tree.topLevelItemCount; s++) {
            var head = tree.topLevelItem(s);
            if (head.childCount() === 0) {
                continue;
            }
            head.setCheckState(TripFocus.COL_WHAT, Qt.Checked);
            for (var r = 0; r < head.childCount(); r++) {
                head.child(r).setCheckState(TripFocus.COL_WHAT, Qt.Checked);
            }
        }
        TripFocus.inCascade = false;
        TripFocus.reapply();
    });
    refreshButton.clicked.connect(function() {
        TripFocus.refresh(doc);
    });
```

- [ ] **Step 4: Run the headless test to verify it passes**

Run: `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/trip_focus_filter.js "$PWD"`
Expected: `### FILTER OK 9 checks`

Add it to `tests/run_all.sh` beside the other engine tests, keyed on
`### FILTER OK` and failing on `### FILTER FAIL`.

Run: `bash tests/run_all.sh`
Expected: all sections OK

- [ ] **Step 5: Check it in the GUI**

```bash
tools/publish.sh && open ~/Applications/CaveCAD.app
```

Open Pitfall Cave, type `tf`, then confirm each of these by eye:

1. Check one trip -- only that trip's passage, stations, LRUD, splays and notes draw.
2. Check a second trip -- both draw.
3. Press **All** -- everything draws again. (If anything stays hidden, `setAllowInvisible` is not doing its job.)
4. Uncheck everything -- everything draws.
5. Check a Person who was on two trips -- both trips draw.
6. Check a Survey run -- that lettered run draws.
7. No profile band appears in the window at any point.
8. The title block and border stay drawn throughout.
9. Close the window. The main drawing shows no modified marker, nothing became selected, and Edit > Undo still names whatever it named before.

- [ ] **Step 6: Commit**

```bash
git add scripts/CaveSurvey/TripFocus tests/trip_focus_filter.js tests/run_all.sh
git commit -m "feat(TripFocus): filter the preview by trip, team, person and run"
```

---

### Task 6: Ship it

**Goal:** The tool is documented, the publish gate is green, and it is installed in CaveCAD.

**Files:**
- Modify: `README.md` (version history if the file keeps one)
- Modify: `docs/superpowers/specs/2026-08-23-trip-focus-viewer-design.md` (append what the GUI check actually found)
- Modify: `scripts/CaveSurvey/CaveSurvey.js` only if the menu host keeps a version constant

**Acceptance Criteria:**
- [ ] `CAVESURVEY_PUBLISH_CHECK=1 bash tests/run_all.sh` green
- [ ] `tools/publish.sh` installs and archives without error
- [ ] The spec's "Limits, accepted" section records anything the GUI check contradicted
- [ ] The version is bumped the way the repo already bumps it

**Verify:** `CAVESURVEY_PUBLISH_CHECK=1 bash tests/run_all.sh` -> all sections OK, then `tools/publish.sh` -> exits 0

**Steps:**

- [ ] **Step 1: Read how the last feature bumped the version**

Run: `git log --oneline -20 -- tools/publish.sh README.md` and `grep -rn "VERSION" tools/publish.sh tools/make_package.sh`
Follow whatever that shows; do not invent a scheme.

- [ ] **Step 2: Append the GUI findings to the spec**

Under "Limits, accepted", record what the Task 3 and Task 5 GUI checks
actually showed -- in particular whether `setAllowInvisible(true)` was
needed (it has no precedent anywhere in `scripts/`, so this is the first
recorded answer), and how long the copy took on the largest drawing
tried. A limit that was guessed and a limit that was measured must not
read the same.

- [ ] **Step 3: Run the publish gate**

Run: `CAVESURVEY_PUBLISH_CHECK=1 bash tests/run_all.sh`
Expected: all sections OK

- [ ] **Step 4: Publish**

Run: `tools/publish.sh`
Expected: exits 0, reports the install path and the archive

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs(TripFocus): record the GUI findings and ship v<version>"
```

---

### Task 7: Wall runs carry their own stations

**Goal:** A generated LRUD wall run is tagged with the stations IT followed, not with every station in the drawing, so a focus can tell one passage's walls from another's.

**Why this task exists.** `CsDraw.js:592` is `var allNames = names.join("|")`, where `names` is every resolved station in the drawing (`CsDraw.js:387-395`), and that one string is written as `WallRunStations` to every left and right wall polyline. The tag's own name promises the run's stations; it delivers the survey's. Nothing noticed until Trip Focus asked the question, because the only previous consumer was `eraseStations`, for which "every wall run dies on any redraw" is over-broad but safe. For a FOCUS it is fatal: `CsFocus` matches a wall run when ANY of its stations is in focus, so every wall run in the cave matches every selection, and a single-trip view comes overlaid with dashed walls for the whole map.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsLrud.js` (`wallRuns` return shape)
- Modify: `scripts/CaveSurvey/Core/CsDraw.js` (the wall-run tagging block, around line 586-600)
- Test: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `CsLrud.wallRuns` returns, for each run, the station names that run was built from, in run order -- alongside the points it already returns
- [ ] `CsDraw.survey` tags each wall polyline with only its own run's stations
- [ ] A survey with two disjoint passages produces wall runs whose station lists do not overlap
- [ ] `eraseStations` still replaces a wall run when any of ITS stations is redrawn, and no longer kills wall runs belonging to passages that were not redrawn -- assert both halves
- [ ] `CsFocus.isVisible` shows a wall run for a focused passage and hides one for an unfocused passage, on a document drawn by `CsDraw.survey` rather than by hand-written tags
- [ ] The `CsLrud.wallRuns` return-shape change is absorbed by every existing caller (grep for it) with no behaviour change to the drawn geometry itself

**Verify:** `bash tests/run_all.sh` -> all six sections OK, and the new assertions present in the CaveCAD-engine count

**Steps:**

- [ ] **Step 1: Read the three pieces before changing any of them**

`CsLrud.wallRuns` (`scripts/CaveSurvey/Core/CsLrud.js`, from its docblock through `return`), the wall-run block in `CsDraw.survey` (`scripts/CaveSurvey/Core/CsDraw.js:586-620`), and `eraseStations`' `WallRunStations` rule. `wallRuns` currently accumulates bare `{x,y}` points into `left`/`right` arrays and flushes them at a break; the station whose points are being appended is known at that moment (`pointsFor(stationName, ...)`), so the run's station list can be accumulated in the same walk. That is the whole change on the `CsLrud` side.

- [ ] **Step 2: Write the failing tests**

Assert, in this order: that `wallRuns` reports per-run stations for a two-passage survey and that the two runs' lists are disjoint; that a document drawn by `CsDraw.survey` carries a `WallRunStations` tag naming only one passage's stations; that `eraseStations` on passage A's stations leaves passage B's wall runs alive (the half that is broken today -- it currently deletes them); and that `CsFocus.isVisible` hides an unfocused passage's wall run. Write the `CsFocus` assertion against a REAL drawn document, not a hand-written tag: the hand-written 3-station values in the existing `CsFocus` tests are exactly why this defect survived review.

- [ ] **Step 3: Extend `CsLrud.wallRuns`**

Accumulate a station-name list per run beside the points, flushing it with the same `flush()` that flushes the points, so a run's names and its points cannot get out of step. Keep the existing `{left, right, skipped}` keys working -- decide deliberately whether the names ride as a parallel array (`leftStations`) or each run becomes `{points, stations}`, and say in the docblock which and why. A parallel array keeps every existing caller untouched; the object shape makes it impossible to pair the wrong list with the wrong run. Prefer the shape that cannot be mispaired unless a caller makes that expensive.

- [ ] **Step 4: Tag per run in `CsDraw.survey`**

Replace `allNames` with the run's own list. Update the comment that currently says "Tagged with the survey's station list" -- it is honest about today's behaviour and would become a lie.

- [ ] **Step 5: Note the legacy consequence**

A drawing tagged before this change carries the all-stations list, so its wall runs stay visible under every Trip Focus selection. That is accepted rather than worked around: any redraw from the notebook re-tags them, and a heuristic guess at "this list looks like the whole survey" would be a second source of truth about what a wall run belongs to. Record it in the spec's "Limits, accepted" section.

- [ ] **Step 6: Verify and commit**

```bash
bash tests/run_all.sh
git add scripts/CaveSurvey/Core/CsLrud.js scripts/CaveSurvey/Core/CsDraw.js tests/js_unit.js
git commit -m "fix(CsLrud): a wall run carries its own stations, not the whole survey's"
```

---

### Task 8: Rebuild the list pane on widgets this bridge actually has

**Goal:** The contributions list is built from `QCheckBox` and `QLabel` in a `QGridLayout`, because `QTreeWidget` cannot be constructed from script in this build at all.

**Why this task exists — and why no test caught it.** Task 4 built the pane on `QTreeWidget`, on the authority of a note in my own memory saying that widget "exists". It does not, in the only sense that matters. Probed directly in CaveCAD 3.33.0's engine, 2026-08-23:

```
Warning: "QTreeWidget.js: No constructor found for class QTreeWidget"
new QTreeWidget()              -> a STUB whose toString() is a convincing "QTreeWidget [JS]"
QTreeWidget.setHeaderLabels    -> undefined
QTreeWidget.topLevelItemCount  -> undefined
new QTreeWidgetItem()          -> constructs, but checkState/setCheckState are undefined
new QListWidget()              -> "No constructor found" as well
QCheckBox, QScrollArea, QGridLayout, QLabel, QWidget, QSplitter, QDialog,
QLineEdit, QPushButton         -> all construct fine
```

So `TripFocus.buildTree` threw on `setHeaderLabels` for EVERY drawing — the window could not open at all — while `run_all.sh` stayed green through six sections, because no test ever constructed the widget. Stock QCAD only ever obtains a tree via `WidgetFactory.createWidget(<ui file>).findChild(...)`, never through `new`. Reading Qt's generated binding source is not evidence either: those files exist for classes this build never registers.

**Files:**
- Modify: `scripts/CaveSurvey/TripFocus/TripFocus.js` (replace `buildTree`/`picked`/`wireTree` and the splitter's left pane)
- Test: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] No `QTreeWidget`, `QTreeWidgetItem` or `QListWidget` anywhere in the add-on
- [ ] The pane is a `QScrollArea` over a `QWidget` with a `QGridLayout`: one row per entry, column 0 the checkbox (its text is the contributor), column 1 the distance, column 2 the share, and a trailing stretch row so rows pin to the top rather than spreading down the pane
- [ ] Four section headers, each itself a `QCheckBox` whose text is the section title; toggling it sets every row in that section
- [ ] A section with no rows shows a disabled `QLabel` reading "(none recorded)" and no checkbox
- [ ] The `(not in any run)` row is a `QLabel` with no checkbox at all -- there is nothing to focus, so there is nothing to tick
- [ ] **Selection state lives in a JS array of `{section, pick, box}`, not in the widget hierarchy.** `TripFocus.picked()` reads that array. Walking widget children to recover selection is what made the old `picked` both untestable and silently wrong
- [ ] `TripFocus.picked()` is covered by a HEADLESS test that constructs real `QCheckBox` widgets and ticks them -- `QCheckBox` constructs fine under `-no-gui`, so the previous "needs a live widget, cannot be tested" excuse does not apply
- [ ] Every user-visible string wrapped in `qsTr`
- [ ] The window opens on a drawing with a survey, on a drawing with none, and on an empty drawing, without an exception

**Verify:** `bash tests/run_all.sh` green, plus a probe script that constructs the pane headlessly and asserts `picked()` reflects the ticked boxes

**Steps:**

- [ ] **Step 1: Probe before you build.** Write a throwaway `-no-gui -autostart` script that constructs every widget class you intend to use and calls the methods you intend to call. Paste its output in your report. This is the step whose absence let the tree ship.

- [ ] **Step 2: Write the failing headless test for `picked()`** in `tests/js_unit.js`, gated to the real engine (`if (!IS_NODE)`), constructing the pane via a `TripFocus.buildList(read)` that returns `{widget, entries}`, ticking a known set of boxes, and asserting `TripFocus.picked()` returns exactly the matching `{trips, teams, people, runs}` -- including that a `(not in any run)` entry can never appear in it.

- [ ] **Step 3: Replace `buildTree` with `buildList`.** Keep the section/row data coming from `TripFocusRows.build` unchanged -- that part is pure, correct and already tested. Only the widget layer changes. `QCheckBox` carries its own label, so a row is `[checkbox, distanceLabel, shareLabel]`; keep the checkbox's text the plain contributor name and put the `pick` in the entries array, never in the widget.

- [ ] **Step 4: Cascade without a signal storm.** A section checkbox sets its rows directly from the entries array. Guard against re-entrancy the way the tree version did (a module-level flag), because setting a child's `checked` fires `toggled` again.

- [ ] **Step 5: Re-wire All, Refresh and `reapply`** against `TripFocus.picked()` as an opaque call. Task 5's filtering path must not reach into the widgets at all.

- [ ] **Step 6: Verify and commit**

```bash
bash tests/run_all.sh
git add scripts/CaveSurvey/TripFocus/TripFocus.js tests/js_unit.js
git commit -m "fix(TripFocus): build the list from widgets this bridge can construct"
```
