# Callout Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Callout tab in the Station Table that writes `callout-card.html`: a two-page printable card (page 1 roster, schedule, escalation, forecast; page 2 route, directions, hazards, rope) for single-day and multiday trips.

**Architecture:** Pure ES5 Core engines (`CsCalloutCard` schedule + HTML, `CsWeather` request builders and parsers, `CsCalloutLocal` roster/contacts codec) tested in `tests/js_unit.js`; schedule and weather place ride in `stations.json` `settings.trip` (extending `CsStationStore`); roster and contacts live in per-user `RSettings` and never in the Drive folder; the panel tab is a thin shell over the engines. Network is a blocking `curl` through `QProcess`, the same pattern as `CsSurfaceData.fetch`.

**Tech Stack:** QCAD/CaveCAD JS (ES5 only: no let/const/arrows/template strings), Qt widgets via the JS bridge, Open-Meteo (no key), CaveCAD's own engine for tests.

**User decisions (already made):**
- Output is a printable HTML page; weather for the trip's duration is on it.
- Weather uses a general location (anchor rounded to 0.1 degree), polled per run, never stored or printed; typed place override always available.
- Schedule is user-entered (start date, days, entry, work hours, night out/camp); auto-splitting is tool #2, later.
- Roster (name, role, squeeze limit, medical notes, emergency contact) prints **above the fold on page 1**; the route, directions, hazards and rope are **their own page 2**.
- Roster and contacts are stored locally per user only, not in the synced cave folder.
- Order of the four expedition tools: callout card, multi-objective planner + team splitter, squeeze filter, what's-left-to-push ranking.

Spec: `docs/superpowers/specs/2026-09-29-callout-card-design.md`. Repo: `~/Documents/github/cavecad-tools`, branch `legacy-map`.

## Conventions every task follows

- Add new Core files to BOTH `scripts/CaveSurvey/Core/CsAll.js` and the file list in `tests/js_unit.js` (around line 165). A file missing from the test list passes silently through deliberate catches (cavecad-test-harness-traps).
- Test vars in `tests/js_unit.js` use the prefix `cc` (`ccStore`, `ccWin`...) so they cannot collide with the file's other globals. Assertions are `ok(cond, what)` and `eqs(actual, expected, what)`. New test blocks go **immediately above** the `// Report.` banner near the end of the file.
- Run the unit suite through CaveCAD's own engine (the node runner is broken on this branch):
  `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/js_unit.js "$PWD"`
  Expected last line: `### UNIT OK <n> assertions`. Run from the repo root.
- No coordinates in any card text (cave-location-privacy). Positions never printed.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

---

### Task 1: Trip settings in the station store

**Goal:** `stations.json` carries `settings.trip = {startDate, weatherPlace, days: [{entry, workHours, night}]}` and round-trips it, cleaning bad values.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsStationStore.js` (`empty` at line 31, `parse` settings block at line 84)
- Test: `tests/js_unit.js` (above the `// Report.` banner)

**Acceptance Criteria:**
- [ ] `CsStationStore.empty().settings.trip` is `{startDate:"", weatherPlace:"", days:[]}`.
- [ ] A trip round-trips through `serialize` and `parse`.
- [ ] Bad days (bad clock, negative or non-numeric work hours) are dropped; unknown night becomes `"out"`; `"8:00"` becomes `"08:00"`; a bad start date becomes `""`.
- [ ] Existing `packing` and `pace` settings are untouched.

**Verify:** the unit command in Conventions → `### UNIT OK <n> assertions`

**Steps:**

- [ ] **Step 1: Write the failing test.** Insert above `// Report.`:

```js
// ---------------------------------------------------------------------
// Callout card -- trip settings in the station store
// ---------------------------------------------------------------------

var ccStore0 = CsStationStore.empty();
eqs(ccStore0.settings.trip.startDate, "", "trip: empty start date");
eqs(ccStore0.settings.trip.days.length, 0, "trip: empty has no days");

var ccStore1 = CsStationStore.empty();
ccStore1.settings.packing = "First aid";
ccStore1.settings.trip = { startDate: "2026-10-03", weatherPlace: " Sewanee, TN ",
    days: [ { entry: "8:00", workHours: 6, night: "camp" },
            { entry: "07:30", workHours: 3.5, night: "out" } ] };
var ccBack1 = CsStationStore.parse(CsStationStore.serialize(ccStore1)).store;
eqs(ccBack1.settings.packing, "First aid", "trip: packing survives");
eqs(ccBack1.settings.trip.startDate, "2026-10-03", "trip: start date round trips");
eqs(ccBack1.settings.trip.weatherPlace, "Sewanee, TN", "trip: place is trimmed");
eqs(ccBack1.settings.trip.days.length, 2, "trip: two days round trip");
eqs(ccBack1.settings.trip.days[0].entry, "08:00", "trip: clock is zero padded");
eqs(ccBack1.settings.trip.days[0].night, "camp", "trip: camp night kept");
eqs(ccBack1.settings.trip.days[1].workHours, 3.5, "trip: fractional work hours kept");

var ccBad = CsStationStore.parse(JSON.stringify({ settings: { trip: {
    startDate: "2026-02-31", weatherPlace: 7,
    days: [ { entry: "25:00", workHours: 4, night: "out" },
            { entry: "09:00", workHours: -1, night: "out" },
            { entry: "09:00", workHours: "x", night: "out" },
            { entry: "09:00", workHours: 4, night: "sideways" },
            null ] } } })).store;
eqs(ccBad.settings.trip.startDate, "", "trip: an impossible date is dropped");
eqs(ccBad.settings.trip.days.length, 1, "trip: only the one good day survives");
eqs(ccBad.settings.trip.days[0].night, "out", "trip: unknown night becomes out");
```

- [ ] **Step 2: Run the suite; expect FAIL** (`TypeError` on `settings.trip` or `FAIL: trip:` lines).

- [ ] **Step 3: Implement.** In `CsStationStore.js`, replace `empty` and add the helpers after `csStoreStr`:

```js
CsStationStore.empty = function() {
    return { version: CsStationStore.VERSION, entries: [],
        settings: { packing: "", pace: {}, trip: CsStationStore.emptyTrip() } };
};
```

```js
/** Nights a trip day may end with: back on the surface, or in camp. */
CsStationStore.NIGHTS = ["out", "camp"];

CsStationStore.emptyTrip = function() {
    return { startDate: "", weatherPlace: "", days: [] };
};

var csStoreDateOk = function(text) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (m === null) { return false; }
    var y = parseInt(m[1], 10), mo = parseInt(m[2], 10) - 1, d = parseInt(m[3], 10);
    var t = new Date(Date.UTC(y, mo, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === mo && t.getUTCDate() === d;
};

/**
 * A trip block from whatever the file held: bad days are dropped, a bad
 * date is blank, an unknown night is "out". Never throws.
 */
CsStationStore.cleanTrip = function(raw) {
    var trip = CsStationStore.emptyTrip();
    if (raw === null || typeof raw !== "object") {
        return trip;
    }
    var date = csStoreStr(raw.startDate);
    trip.startDate = csStoreDateOk(date) ? date : "";
    trip.weatherPlace = csStoreStr(raw.weatherPlace).replace(/^\s+|\s+$/g, "");
    var list = Object.prototype.toString.call(raw.days) === "[object Array]" ?
        raw.days : [];
    for (var i = 0; i < list.length; i++) {
        var d = list[i];
        if (d === null || typeof d !== "object") { continue; }
        var entry = csStoreStr(d.entry);
        if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(entry)) { continue; }
        if (entry.length === 4) { entry = "0" + entry; }
        var hours = d.workHours;
        if (typeof hours !== "number" || !isFinite(hours) || hours < 0) { continue; }
        var night = CsStationStore.NIGHTS.indexOf(csStoreStr(d.night)) >= 0 ?
            csStoreStr(d.night) : "out";
        trip.days.push({ entry: entry, workHours: hours, night: night });
    }
    return trip;
};
```

In `parse`, inside the `if (data.settings ...)` block after the `pace` lines add:

```js
        store.settings.trip = CsStationStore.cleanTrip(data.settings.trip);
```

- [ ] **Step 4: Run the suite; expect PASS** (`### UNIT OK`).

- [ ] **Step 5: Commit**

```bash
git add scripts/CaveSurvey/Core/CsStationStore.js tests/js_unit.js
git commit -m "feat: station store carries the trip schedule and weather place

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Schedule arithmetic (CsCalloutCard part 1)

**Goal:** `CsCalloutCard.windows` turns a plan and a trip schedule into rows with entry, turnaround, expected out and callout, handling camp nights and midnight.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsCalloutCard.js`
- Modify: `scripts/CaveSurvey/Core/CsAll.js` (after the `CsTripPlan.js` include, line 78), `tests/js_unit.js` (file list after `CsTripPlan.js`, line 165; test block)

**Acceptance Criteria:**
- [ ] Single day, in 90 out 80, entry 08:00 work 4 h, buffer 120: turnaround 13:30, expected out 14:50, callout 16:50.
- [ ] Three days camp, camp, out: day 1 turnaround 15:30 (adds in), day 2 turnaround 14:00 (no in), day 3 turnaround 11:00, out 12:20, callout 14:20; days 1 and 2 have no callout.
- [ ] Entry 22:00 crosses midnight into the next date.
- [ ] An overrun into the next entry produces a warning and still returns rows.
- [ ] `missing` names the absent field; returns `""` when complete.

**Verify:** unit command → `### UNIT OK <n> assertions`

**Steps:**

- [ ] **Step 1: Register the (empty) file** so the test can load it. Create `scripts/CaveSurvey/Core/CsCalloutCard.js` with just:

```js
// CsCalloutCard.js -- the callout card: schedule windows and the page.
//
// Part of the Cave Survey Core library: pure ES5, no document, no GUI,
// no network. The forecast arrives as plain data; see CsWeather.
//
// NO COORDINATES in any output. Route labels are station names only.
// THE ROUTE FOLLOWS THE SURVEY LINE and is never called safe or easy.
//
// The 'Cs' prefix is mandatory: include() dedupes by basename.

include(includeBasePath + "/CsTripPlan.js");

var CsCalloutCard = {};
```

In `CsAll.js` after line 78 add:

```js
// After CsTripPlan, whose route text, SVG and clock the card reuses.
include(includeBasePath + "/CsCalloutCard.js");
```

In `tests/js_unit.js` after the `CsTripPlan.js` list entry add `    "scripts/CaveSurvey/Core/CsCalloutCard.js",`.

- [ ] **Step 2: Write the failing tests** above `// Report.`:

```js
// ---------------------------------------------------------------------
// Callout card -- schedule windows
// ---------------------------------------------------------------------

var ccPlan = { stops: [ { station: "A3", steps: [], minutesIn: 90 } ],
    totals: { minutesIn: 90, minutesWork: 20, minutesOut: 80 } };
var ccOne = CsCalloutCard.windows(ccPlan, { startDate: "2026-10-03",
    days: [ { entry: "08:00", workHours: 4, night: "out" } ] }, 120);
eqs(ccOne.rows.length, 1, "windows: one day, one row");
eqs(ccOne.rows[0].turnaround.time, "13:30", "windows: turnaround is entry + in + work");
eqs(ccOne.rows[0].expectedOut.time, "14:50", "windows: expected out adds the way out");
eqs(ccOne.rows[0].callout.time, "16:50", "windows: callout is expected out + buffer");

var ccThree = CsCalloutCard.windows(ccPlan, { startDate: "2026-10-03", days: [
    { entry: "08:00", workHours: 6, night: "camp" },
    { entry: "08:00", workHours: 6, night: "camp" },
    { entry: "08:00", workHours: 3, night: "out" } ] }, 120);
eqs(ccThree.rows[0].turnaround.time, "15:30", "windows: day 1 adds the way in");
eqs(ccThree.rows[0].callout, null, "windows: a camp night has no callout");
eqs(ccThree.rows[1].turnaround.time, "14:00", "windows: day 2 starts underground");
eqs(ccThree.rows[1].fromSurface, false, "windows: day 2 does not start on the surface");
eqs(ccThree.rows[2].turnaround.time, "11:00", "windows: day 3 turnaround");
eqs(ccThree.rows[2].expectedOut.time, "12:20", "windows: day 3 out");
eqs(ccThree.rows[2].callout.time, "14:20", "windows: day 3 callout");
eqs(ccThree.rows[2].entry.date, "2026-10-05", "windows: day 3 is two dates on");

var ccLate = CsCalloutCard.windows(ccPlan, { startDate: "2026-10-03",
    days: [ { entry: "22:00", workHours: 3, night: "out" } ] }, 120);
eqs(ccLate.rows[0].turnaround.date, "2026-10-04", "windows: turnaround crosses midnight");
eqs(ccLate.rows[0].turnaround.time, "02:30", "windows: midnight turnaround time");
eqs(ccLate.rows[0].callout.time, "05:50", "windows: midnight callout time");

var ccOver = CsCalloutCard.windows(ccPlan, { startDate: "2026-10-03", days: [
    { entry: "08:00", workHours: 30, night: "out" },
    { entry: "09:00", workHours: 2, night: "out" } ] }, 120);
eqs(ccOver.rows.length, 2, "windows: an overrun still returns rows");
ok(ccOver.warnings.length === 1 && /day 1/i.test(ccOver.warnings[0]),
    "windows: an overrun into the next entry warns about day 1");

eqs(CsCalloutCard.missing({ startDate: "", days: [] }, ccPlan),
    "start date", "missing: start date first");
eqs(CsCalloutCard.missing({ startDate: "2026-10-03", days: [] }, ccPlan),
    "at least one day", "missing: days");
ok(CsCalloutCard.missing({ startDate: "2026-10-03", days: [ {} ] },
    { stops: [], totals: {} }) !== "", "missing: a plan with no stops");
eqs(CsCalloutCard.missing({ startDate: "2026-10-03", days: [ {} ] }, ccPlan),
    "", "missing: complete is blank");
```

- [ ] **Step 3: Run; expect FAIL** (`CsCalloutCard.windows is not a function`).

- [ ] **Step 4: Implement.** Append to `CsCalloutCard.js`:

```js
/** "HH:MM" to minutes past midnight, or null. */
CsCalloutCard.parseClock = function(text) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(text));
    if (m === null) { return null; }
    var h = parseInt(m[1], 10);
    var mi = parseInt(m[2], 10);
    if (h > 23 || mi > 59) { return null; }
    return h * 60 + mi;
};

/** "YYYY-MM-DD" to minutes since 1970 UTC at midnight, or null. Timezone free. */
CsCalloutCard.dateMinutes = function(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
    if (m === null) { return null; }
    return Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1,
        parseInt(m[3], 10)) / 60000;
};

/** Absolute minutes to {date, time, abs}. */
CsCalloutCard.stamp = function(abs) {
    var whole = Math.round(abs);
    var d = new Date(whole * 60000);
    var two = function(n) { return (n < 10 ? "0" : "") + n; };
    return { date: d.getUTCFullYear() + "-" + two(d.getUTCMonth() + 1) + "-" +
            two(d.getUTCDate()),
        time: two(d.getUTCHours()) + ":" + two(d.getUTCMinutes()), abs: whole };
};

/** The date of each trip day, "YYYY-MM-DD", in order. */
CsCalloutCard.tripDates = function(trip) {
    var base = CsCalloutCard.dateMinutes(trip.startDate);
    var out = [];
    if (base === null) { return out; }
    for (var i = 0; i < trip.days.length; i++) {
        out.push(CsCalloutCard.stamp(base + i * 1440).date);
    }
    return out;
};

/**
 * What is missing before a card can be built: "" when nothing, else a
 * short name of the first missing thing.
 */
CsCalloutCard.missing = function(trip, plan) {
    if (plan === null || plan === undefined || plan.stops === undefined ||
            plan.stops.length === 0) {
        return "a planned route (pick stops and press Plan trip)";
    }
    if (CsCalloutCard.dateMinutes(trip.startDate) === null) { return "start date"; }
    if (trip.days.length === 0) { return "at least one day"; }
    return "";
};

/**
 * The schedule as rows. A day STARTS FROM THE SURFACE when it is the
 * first or the night before was "out": the inbound time is added. A day
 * ENDS ON THE SURFACE when its night is "out" or it is the last: expected
 * out and callout are then given. Underground camp-to-camp moves are not
 * modelled; only the ends of the trip use the route's in and out times.
 *
 * \param plan a CsTripPlan plan (totals.minutesIn / minutesOut)
 * \param trip {startDate, days: [{entry, workHours, night}]}
 * \param bufferMin minutes after expected out that topside starts acting
 * \return {rows: [{day, entry, turnaround, expectedOut, callout, night,
 *   fromSurface, endsOnSurface}], warnings}; stamps are {date, time, abs}
 */
CsCalloutCard.windows = function(plan, trip, bufferMin) {
    var rows = [];
    var warnings = [];
    var base = CsCalloutCard.dateMinutes(trip.startDate);
    if (base === null) { return { rows: rows, warnings: warnings }; }
    var minutesIn = plan.totals.minutesIn;
    var minutesOut = plan.totals.minutesOut;
    var n = trip.days.length;
    for (var i = 0; i < n; i++) {
        var day = trip.days[i];
        var last = i === n - 1;
        var fromSurface = i === 0 || trip.days[i - 1].night === "out";
        var endsOnSurface = last || day.night === "out";
        var entryAbs = base + i * 1440 + CsCalloutCard.parseClock(day.entry);
        var turnAbs = entryAbs + (fromSurface ? minutesIn : 0) + day.workHours * 60;
        var row = { day: i + 1, entry: CsCalloutCard.stamp(entryAbs),
            turnaround: CsCalloutCard.stamp(turnAbs),
            expectedOut: null, callout: null,
            night: endsOnSurface ? "out" : "camp",
            fromSurface: fromSurface, endsOnSurface: endsOnSurface };
        var endAbs = turnAbs;
        if (endsOnSurface) {
            endAbs = turnAbs + minutesOut;
            row.expectedOut = CsCalloutCard.stamp(endAbs);
            row.callout = CsCalloutCard.stamp(endAbs + bufferMin);
        }
        rows.push(row);
        if (!last) {
            var nextEntry = base + (i + 1) * 1440 +
                CsCalloutCard.parseClock(trip.days[i + 1].entry);
            if (endAbs > nextEntry) {
                warnings.push("Day " + (i + 1) + " runs past day " + (i + 2) +
                    "'s entry time. Check the work hours.");
            }
        }
    }
    return { rows: rows, warnings: warnings };
};
```

- [ ] **Step 5: Run; expect PASS.**

- [ ] **Step 6: Commit**

```bash
git add scripts/CaveSurvey/Core/CsCalloutCard.js scripts/CaveSurvey/Core/CsAll.js tests/js_unit.js
git commit -m "feat: callout card schedule windows (turnaround, expected out, callout)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Hazards and the HTML card (CsCalloutCard part 2)

**Goal:** `CsCalloutCard.hazards` finds water and hazard notes on the route; `CsCalloutCard.html` builds the two-page card with the roster above the fold.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsCalloutCard.js`
- Test: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `hazards` returns `{station, text, water}` for notes matching water words (`water: true`) or hazard words (`water: false`), deduped, in route order; a note with neither is ignored.
- [ ] Page 1 has the roster before the schedule table; page 1 contains no `<svg`; page 2 (after the `page2` marker) contains it.
- [ ] Roster text is HTML-escaped; `includeRoster: false` prints no names.
- [ ] Rain over threshold + a water note on the route prints "Rain forecast + water noted on route"; without a water note it does not.
- [ ] Forecast `null` prints "No forecast, check before you go".
- [ ] Card text contains no coordinate and no forecast place label.

**Verify:** unit command → `### UNIT OK <n> assertions`

**Steps:**

- [ ] **Step 1: Write the failing tests.**

```js
// ---------------------------------------------------------------------
// Callout card -- hazards and the page
// ---------------------------------------------------------------------

var ccHazPlan = { stops: [ { station: "A3", steps: [
    { notes: ["A2: knee-deep water crossing", "A2: nice formations"] },
    { notes: ["A3: loose rock overhead", "A2: knee-deep water crossing"] } ] } ] };
var ccHaz = CsCalloutCard.hazards(ccHazPlan);
eqs(ccHaz.length, 2, "hazards: two distinct hits, the duplicate and the pretty note ignored");
eqs(ccHaz[0].station, "A2", "hazards: station parsed");
eqs(ccHaz[0].water, true, "hazards: water is water");
eqs(ccHaz[1].water, false, "hazards: loose rock is a hazard, not water");

var ccRealPlan = CsTripPlan.build(tpSurvey(), tpResolved,
    { start: "A1", targets: ["A3"], unit: "ft" });
var ccTrip = { startDate: "2026-10-03", weatherPlace: "",
    days: [ { entry: "08:00", workHours: 4, night: "out" } ] };
var ccCtx = function(over) {
    var c = { title: "Test Cave", survey: tpSurvey(), resolved: tpResolved,
        trip: ccTrip,
        contacts: { topName: "Pat Topside", topPhone: "555-0100",
            escalation: "Call the rescue coordinator, 555-0199.", bufferMin: 120 },
        roster: [ { name: "Ana <b>Ruiz</b>", role: "Lead", squeeze: 14,
            medical: "Asthma", emergency: "Luis 555-0111" } ],
        includeRoster: true, forecast: null, generated: "2026-09-29" };
    for (var k in over) { c[k] = over[k]; }
    return c;
};
var ccHtml = CsCalloutCard.html(ccRealPlan, ccCtx({}));
var ccSplit = ccHtml.indexOf("class=\"page2\"");
ok(ccSplit > 0, "card: page 2 marker present");
ok(ccHtml.slice(0, ccSplit).indexOf("<svg") < 0, "card: page 1 has no route drawing");
ok(ccHtml.slice(ccSplit).indexOf("<svg") > 0, "card: page 2 has the route drawing");
ok(ccHtml.indexOf("Roster") < ccHtml.indexOf("Schedule"),
    "card: roster comes before the schedule");
ok(ccHtml.indexOf("Ana &lt;b&gt;Ruiz&lt;/b&gt;") > 0, "card: roster text is escaped");
ok(ccHtml.indexOf("<b>Ruiz") < 0, "card: no raw markup from the roster");
ok(ccHtml.indexOf("14 in") > 0, "card: squeeze limit printed");
ok(ccHtml.indexOf("No forecast, check before you go") > 0, "card: forecast null message");
ok(ccHtml.indexOf("Pat Topside") > 0 && ccHtml.indexOf("555-0199") > 0,
    "card: escalation printed");
ok(ccHtml.indexOf("14:00") > 0, "card: callout time printed (real plan on the tiny fixture: 08:00 + 4 h + 120 min buffer)");

var ccNoRoster = CsCalloutCard.html(ccRealPlan, ccCtx({ includeRoster: false }));
ok(ccNoRoster.indexOf("Ana") < 0, "card: include roster off prints no names");
ok(ccNoRoster.indexOf("Roster not included") > 0, "card: roster-off line");

var ccWaterPlan = JSON.parse(JSON.stringify(ccRealPlan));
ccWaterPlan.stops[0].steps[0].notes = ["A2: creek crossing"];
var ccRain = { days: [ { date: "2026-10-03", high: 70, low: 50, rainTotal: 0.8,
    rainChance: 90 } ], placeLabel: "Somewhere, TN" };
var ccWet = CsCalloutCard.html(ccWaterPlan, ccCtx({ forecast: ccRain }));
ok(ccWet.indexOf("Rain forecast + water noted on route") > 0,
    "card: rain plus water note raises the flag");
ok(ccWet.indexOf("Somewhere") < 0, "card: the forecast place label is never printed");
var ccDry = CsCalloutCard.html(ccRealPlan, ccCtx({ forecast: ccRain }));
ok(ccDry.indexOf("Rain forecast + water noted on route") < 0,
    "card: rain without a water note raises no flag");
ok(ccDry.indexOf("90%") > 0, "card: rain chance printed");
ok(!/-?\d{2}\.\d{3,}/.test(ccHtml.slice(0, ccSplit)),
    "card: page 1 has no long decimal that could be a coordinate");
```

- [ ] **Step 2: Run; expect FAIL** (`hazards is not a function`).

- [ ] **Step 3: Implement.** Append to `CsCalloutCard.js`:

```js
CsCalloutCard.WATER_WORDS = /\b(flood\w*|sump\w*|siphon\w*|water\w*|wet|creek|stream|river)\b/i;
CsCalloutCard.HAZARD_WORDS = /\b(hazard\w*|danger\w*|loose|unstable|rockfall|bad air|co2|slippery|exposed|exposure)\b/i;
/** A day counts as wet at this chance (percent) or this much rain (inches). */
CsCalloutCard.RAIN_CHANCE = 50;
CsCalloutCard.RAIN_INCHES = 0.25;

/**
 * Notes on the way in that name water or a hazard.
 * \return [{station, text, water}] in route order, each note once
 */
CsCalloutCard.hazards = function(plan) {
    var out = [];
    var seen = {};
    for (var s = 0; s < plan.stops.length; s++) {
        var steps = plan.stops[s].steps;
        for (var k = 0; k < steps.length; k++) {
            var notes = steps[k].notes || [];
            for (var n = 0; n < notes.length; n++) {
                var line = String(notes[n]);
                if (seen[line] === true) { continue; }
                var water = CsCalloutCard.WATER_WORDS.test(line);
                if (!water && !CsCalloutCard.HAZARD_WORDS.test(line)) { continue; }
                seen[line] = true;
                var cut = line.indexOf(": ");
                out.push({ station: cut < 0 ? "" : line.slice(0, cut),
                    text: cut < 0 ? line : line.slice(cut + 2), water: water });
            }
        }
    }
    return out;
};

var csCardWet = function(day) {
    return day !== null && ((typeof day.rainChance === "number" &&
            day.rainChance >= CsCalloutCard.RAIN_CHANCE) ||
        (typeof day.rainTotal === "number" &&
            day.rainTotal >= CsCalloutCard.RAIN_INCHES));
};

/** Two-line stamp text: "Sat 2026-10-03 08:00" without a weekday, dates are plain. */
var csCardWhen = function(stamp) { return stamp.date + " " + stamp.time; };

/**
 * The card as one HTML page that prints on two sheets.
 *
 * \param ctx {title, survey, resolved, trip, contacts: {topName, topPhone,
 *   escalation, bufferMin}, roster: [{name, role, squeeze, medical,
 *   emergency}], includeRoster, forecast: {days: [{date, high, low,
 *   rainTotal, rainChance}]} | null, generated}
 */
CsCalloutCard.html = function(plan, ctx) {
    var esc = CsTripPlan.esc;
    var trip = ctx.trip;
    var contacts = ctx.contacts || {};
    var buffer = typeof contacts.bufferMin === "number" ? contacts.bufferMin : 120;
    var win = CsCalloutCard.windows(plan, trip, buffer);
    var hazards = CsCalloutCard.hazards(plan);
    var dates = CsCalloutCard.tripDates(trip);
    var h = [];
    h.push("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">");
    h.push("<title>" + esc(ctx.title) + " callout card</title>");
    h.push("<style>body{font:14px/1.4 -apple-system,Helvetica,Arial,sans-serif;" +
        "max-width:760px;margin:20px auto;padding:0 16px;color:#111}" +
        "h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:16px 0 4px;" +
        "border-bottom:1px solid #999}table{border-collapse:collapse;width:100%}" +
        "td,th{border:1px solid #bbb;padding:3px 6px;text-align:left;font-size:13px}" +
        ".note{color:#555}.warn{color:#8a4b00}.flag{font-weight:bold;color:#a00;" +
        "border:2px solid #a00;padding:4px 8px;margin:6px 0}" +
        ".box{border:3px solid #111;padding:8px 12px;margin:10px 0;font-size:17px}" +
        ".days{display:flex;gap:6px;flex-wrap:wrap}.day{border:1px solid #bbb;" +
        "padding:4px 8px;min-width:110px}.page2{margin-top:32px}" +
        "@media print{.page2{page-break-before:always;margin-top:0}}</style></head><body>");
    h.push("<h1>" + esc(ctx.title) + " &mdash; callout card</h1>");
    h.push("<p class=\"note\">" + esc(dates.length > 0 ? dates[0] : "") +
        (dates.length > 1 ? " to " + esc(dates[dates.length - 1]) : "") +
        (ctx.generated ? " &middot; made " + esc(ctx.generated) : "") + "</p>");

    // Roster: above the fold, straight under the header.
    h.push("<h2>Roster</h2>");
    if (ctx.includeRoster === false) {
        h.push("<p class=\"note\">Roster not included on this copy.</p>");
    } else if (!ctx.roster || ctx.roster.length === 0) {
        h.push("<p class=\"warn\">Roster not filled in.</p>");
    } else {
        h.push("<table><tr><th>Name</th><th>Role</th><th>Squeeze limit</th>" +
            "<th>Medical</th><th>Emergency contact</th></tr>");
        for (var r = 0; r < ctx.roster.length; r++) {
            var p = ctx.roster[r];
            h.push("<tr><td>" + esc(p.name) + "</td><td>" + esc(p.role) + "</td><td>" +
                (typeof p.squeeze === "number" ? esc(p.squeeze) + " in" : "&mdash;") +
                "</td><td>" + esc(p.medical) + "</td><td>" + esc(p.emergency) +
                "</td></tr>");
        }
        h.push("</table>");
    }

    h.push("<h2>Schedule</h2><table><tr><th>Day</th><th>Entry</th>" +
        "<th>Turnaround</th><th>Expected out</th><th>Callout</th></tr>");
    for (var w = 0; w < win.rows.length; w++) {
        var row = win.rows[w];
        h.push("<tr><td>" + row.day + "</td><td>" + esc(csCardWhen(row.entry)) +
            "</td><td>" + esc(csCardWhen(row.turnaround)) + "</td>");
        if (row.endsOnSurface) {
            h.push("<td>" + esc(csCardWhen(row.expectedOut)) + "</td><td><b>" +
                esc(csCardWhen(row.callout)) + "</b></td></tr>");
        } else {
            h.push("<td colspan=\"2\" class=\"note\">Camp night, no callout until " +
                "the team surfaces</td></tr>");
        }
    }
    h.push("</table>");
    for (var wn = 0; wn < win.warnings.length; wn++) {
        h.push("<p class=\"warn\">" + esc(win.warnings[wn]) + "</p>");
    }

    h.push("<h2>Escalation</h2><div class=\"box\">");
    if (!contacts.topName && !contacts.topPhone && !contacts.escalation) {
        h.push("<span class=\"warn\">Contacts not filled in.</span>");
    } else {
        h.push("Topside contact: <b>" + esc(contacts.topName) + "</b> " +
            esc(contacts.topPhone) + "<br>Callout buffer: " + esc(buffer) +
            " min after expected out.<br>" + esc(contacts.escalation));
    }
    h.push("</div>");

    h.push("<h2>Forecast</h2>");
    var anyWet = false;
    if (ctx.forecast === null || ctx.forecast === undefined) {
        h.push("<p class=\"warn\">No forecast, check before you go.</p>");
    } else {
        h.push("<div class=\"days\">");
        for (var d = 0; d < dates.length; d++) {
            var fd = null;
            for (var f = 0; f < ctx.forecast.days.length; f++) {
                if (ctx.forecast.days[f].date === dates[d]) { fd = ctx.forecast.days[f]; }
            }
            h.push("<div class=\"day\"><b>" + esc(dates[d]) + "</b><br>");
            if (fd === null) {
                h.push("<span class=\"note\">outside forecast range</span>");
            } else {
                if (csCardWet(fd)) { anyWet = true; }
                h.push(esc(fd.high) + "&deg; / " + esc(fd.low) + "&deg; F<br>rain " +
                    esc(fd.rainTotal) + " in, " + esc(fd.rainChance) + "%");
            }
            h.push("</div>");
        }
        h.push("</div>");
    }
    var anyWater = false;
    for (var hz = 0; hz < hazards.length; hz++) {
        if (hazards[hz].water) { anyWater = true; }
    }
    if (anyWet && anyWater) {
        h.push("<p class=\"flag\">Rain forecast + water noted on route. Check " +
            "conditions before going in.</p>");
    }

    // Page 2: the route.
    h.push("<div class=\"page2\"><h1>" + esc(ctx.title) + " &mdash; route</h1>");
    h.push("<p class=\"note\">This route follows the survey line. It is not a " +
        "guarantee that the way is safe or easy: crawls, water, climbs and loose " +
        "ground are only known where someone wrote them down.</p>");
    if (plan.stops.length === 0) {
        h.push("<p class=\"warn\">No route: pick stops on the Plan tab.</p>");
    } else {
        h.push(CsTripPlan.routeSvg(ctx.survey, ctx.resolved, plan));
        h.push("<h2>Directions</h2>");
        for (var s = 0; s < plan.stops.length; s++) {
            h.push("<h3>To " + esc(plan.stops[s].station) + "</h3><ol>");
            for (var k = 0; k < plan.stops[s].steps.length; k++) {
                var step = plan.stops[s].steps[k];
                h.push("<li>" + esc(step.text) + " <span class=\"note\">(" +
                    CsTripPlan.clock(step.minutes) + ")</span></li>");
            }
            h.push("</ol>");
        }
        h.push("<h3>Back to " + esc(plan.start) + "</h3><ol>");
        for (var b = 0; b < plan.back.steps.length; b++) {
            h.push("<li>" + esc(plan.back.steps[b].text) + "</li>");
        }
        h.push("</ol>");
    }
    h.push("<h2>Hazards on the route</h2>");
    if (hazards.length === 0) {
        h.push("<p class=\"note\">None noted. Notes only exist where someone wrote them.</p>");
    } else {
        h.push("<ul>");
        for (var z = 0; z < hazards.length; z++) {
            h.push("<li class=\"warn\">" + esc(hazards[z].station) + ": " +
                esc(hazards[z].text) + "</li>");
        }
        h.push("</ul>");
    }
    if (plan.gear && plan.gear.rope.length > 0) {
        h.push("<h2>Rope and hardware</h2><ul>");
        for (var ro = 0; ro < plan.gear.rope.length; ro++) {
            h.push("<li>" + esc(plan.gear.rope[ro].text) + "</li>");
        }
        for (var hw = 0; hw < plan.gear.hardware.length; hw++) {
            h.push("<li class=\"warn\">" + esc(plan.gear.hardware[hw]) + "</li>");
        }
        h.push("</ul>");
    }
    h.push("</div></body></html>");
    return h.join("\n");
};
```

- [ ] **Step 4: Run; expect PASS.** The long-decimal check covers page 1 only; the route drawing on page 2 uses normalised positions in a 640x420 box, not real coordinates.

- [ ] **Step 5: Commit**

```bash
git add scripts/CaveSurvey/Core/CsCalloutCard.js tests/js_unit.js
git commit -m "feat: callout card page, hazards and rain-plus-water flag

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Weather (CsWeather)

**Goal:** `CsWeather.lookup` returns a per-day forecast for the trip dates from a rounded coordinate or a typed place, with an injectable fetcher; the exact coordinate never reaches a URL.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsWeather.js`
- Modify: `scripts/CaveSurvey/Core/CsAll.js` (after `CsCalloutCard.js`), `tests/js_unit.js` (list + tests)

**Acceptance Criteria:**
- [ ] Anchor 35.12345678, -85.98765432 produces URLs containing `latitude=35.1` and `longitude=-86.0` and neither `35.12` nor `85.98`.
- [ ] A typed place is geocoded first; the forecast URL uses the geocode result rounded.
- [ ] `parseForecast` returns days with `date, high, low, rainTotal, rainChance`; malformed JSON returns null.
- [ ] No anchor and no place: `{days: null, error: "no location"}`. Fetch failure: `{days: null, error: <reason>}`. Never throws.
- [ ] Real fetch uses `/usr/bin/curl`, `--max-time 5`, a temp file removed afterwards.

**Verify:** unit command → `### UNIT OK <n> assertions`

**Steps:**

- [ ] **Step 1: Register the file.** Create `CsWeather.js` containing only `var CsWeather = {};` plus the header comment below, add to `CsAll.js`:

```js
// Forecast lookup for the callout card. Independent of the survey engines.
include(includeBasePath + "/CsWeather.js");
```

and add `"scripts/CaveSurvey/Core/CsWeather.js",` to the `tests/js_unit.js` list after `CsCalloutCard.js`.

- [ ] **Step 2: Write the failing tests.**

```js
// ---------------------------------------------------------------------
// Callout card -- weather requests
// ---------------------------------------------------------------------

var ccForecastJson = JSON.stringify({ daily: {
    time: ["2026-10-03", "2026-10-04"],
    temperature_2m_max: [70.2, 66.0], temperature_2m_min: [50.1, null],
    precipitation_sum: [0.8, 0], precipitation_probability_max: [90, 10] } });
var ccUrls = [];
var ccFake = function(url) {
    ccUrls.push(url);
    if (url.indexOf("geocoding") >= 0) {
        return { text: JSON.stringify({ results: [ { latitude: 35.94821,
            longitude: -85.90417 } ] }), error: "" };
    }
    return { text: ccForecastJson, error: "" };
};
var ccAnchor = { lat: 35.12345678, lon: -85.98765432 };
var ccDates = ["2026-10-03", "2026-10-04"];
var ccWx = CsWeather.lookup(ccDates, ccAnchor, "", ccFake);
eqs(ccWx.error, "", "weather: anchor lookup has no error");
eqs(ccWx.days.length, 2, "weather: two days back");
eqs(ccWx.days[0].rainChance, 90, "weather: rain chance parsed");
eqs(ccWx.days[1].low, null, "weather: a null low stays null");
ok(ccUrls[0].indexOf("latitude=35.1") > 0 && ccUrls[0].indexOf("longitude=-86.0") > 0,
    "weather: the request carries the rounded coordinate");
ok(ccUrls[0].indexOf("35.12") < 0 && ccUrls[0].indexOf("85.98") < 0,
    "weather: the exact coordinate never reaches the request");
ok(ccUrls[0].indexOf("start_date=2026-10-03") > 0 &&
    ccUrls[0].indexOf("end_date=2026-10-04") > 0, "weather: the trip dates are asked for");

ccUrls = [];
var ccWx2 = CsWeather.lookup(ccDates, null, "Sewanee, TN", ccFake);
eqs(ccUrls.length, 2, "weather: a place is geocoded, then forecast");
ok(ccUrls[0].indexOf("geocoding") >= 0 && ccUrls[0].indexOf("Sewanee%2C%20TN") > 0,
    "weather: place name is encoded into the geocode request");
ok(ccUrls[1].indexOf("latitude=35.9") > 0, "weather: geocode result is rounded too");
eqs(CsWeather.lookup(ccDates, null, "", ccFake).error, "no location",
    "weather: nothing to look up says so");
var ccDown = CsWeather.lookup(ccDates, ccAnchor, "", function() {
    return { text: "", error: "timed out" }; });
eqs(ccDown.days, null, "weather: a failed fetch gives no days");
eqs(ccDown.error, "timed out", "weather: the failure reason is kept");
eqs(CsWeather.parseForecast("not json"), null, "weather: junk parses to null");
```

- [ ] **Step 3: Run; expect FAIL.**

- [ ] **Step 4: Implement** `CsWeather.js`:

```js
// CsWeather.js -- forecast lookup for the callout card.
//
// Part of the Cave Survey Core library. The request builders and parsers
// are pure; only fetchText touches the network (a blocking curl through
// QProcess, the pattern CsSurfaceData.fetch proved in this bridge).
//
// PRIVACY: only a coordinate rounded to 0.1 degree (about 10 km), or a
// typed place name, ever leaves the machine. The exact entrance never
// does, and the result carries no place label.
//
// The 'Cs' prefix is mandatory: include() dedupes by basename.

var CsWeather = {};

CsWeather.TIMEOUT_S = 5;

/** A coordinate to 0.1 degree, as text ("35.1", "-86.0"). */
CsWeather.round = function(v) {
    return (Math.round(v * 10) / 10).toFixed(1);
};

CsWeather.forecastUrl = function(lat, lon, startDate, endDate) {
    return "https://api.open-meteo.com/v1/forecast?latitude=" +
        CsWeather.round(lat) + "&longitude=" + CsWeather.round(lon) +
        "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum," +
        "precipitation_probability_max&temperature_unit=fahrenheit" +
        "&precipitation_unit=inch&timezone=auto&start_date=" + startDate +
        "&end_date=" + endDate;
};

CsWeather.geocodeUrl = function(name) {
    return "https://geocoding-api.open-meteo.com/v1/search?count=1&language=en" +
        "&format=json&name=" + encodeURIComponent(name);
};

/** \return {lat, lon} (unrounded here, rounded when used) or null */
CsWeather.parseGeocode = function(text) {
    try {
        var data = JSON.parse(String(text));
        var hit = data.results[0];
        if (typeof hit.latitude === "number" && typeof hit.longitude === "number") {
            return { lat: hit.latitude, lon: hit.longitude };
        }
    } catch (e) {
    }
    return null;
};

/** \return [{date, high, low, rainTotal, rainChance}] or null */
CsWeather.parseForecast = function(text) {
    try {
        var daily = JSON.parse(String(text)).daily;
        var num = function(list, i) {
            var v = list[i];
            return typeof v === "number" ? v : null;
        };
        var out = [];
        for (var i = 0; i < daily.time.length; i++) {
            out.push({ date: daily.time[i],
                high: num(daily.temperature_2m_max, i),
                low: num(daily.temperature_2m_min, i),
                rainTotal: num(daily.precipitation_sum, i),
                rainChance: num(daily.precipitation_probability_max, i) });
        }
        return out;
    } catch (e) {
        return null;
    }
};

/**
 * GET a URL and return {text, error}. Blocking, 5 s, never throws.
 * Written to a temp file and read back: the bridge stringifies process
 * output as "QByteArray [JS]" (see CsSurfaceData.fetch).
 */
CsWeather.fetchText = function(url) {
    var path = QDir.tempPath() + "/cavecad-weather.json";
    try {
        if (new QFileInfo(path).exists()) { QFile.remove(path); }
        var process = new QProcess();
        process.start("/usr/bin/curl", ["-s", "--fail", "--max-time",
            String(CsWeather.TIMEOUT_S), "-o", path, url]);
        if (!process.waitForFinished((CsWeather.TIMEOUT_S + 3) * 1000)) {
            var never = process.state() === QProcess.NotRunning;
            process.kill();
            QFile.remove(path);
            return { text: "", error: never ? "curl could not be started" : "timed out" };
        }
        if (process.exitCode() !== 0) {
            QFile.remove(path);
            return { text: "", error: "no answer from the forecast service" };
        }
        var file = new QFile(path);
        if (!file.open(QIODevice.ReadOnly | QIODevice.Text)) {
            return { text: "", error: "forecast file could not be read" };
        }
        var stream = new QTextStream(file);
        var text = String(stream.readAll());
        file.close();
        QFile.remove(path);
        return { text: text, error: "" };
    } catch (e) {
        return { text: "", error: "forecast lookup failed (" + e + ")" };
    }
};

/**
 * The forecast for the trip's dates.
 * \param dates ["YYYY-MM-DD", ...] first to last
 * \param anchor {lat, lon} of the drawing's geo anchor, or null
 * \param place typed place name, or "" (a typed place wins over the anchor)
 * \param fetcher optional replacement for fetchText, for tests
 * \return {days: [...] | null, error: ""|reason}. Never throws.
 */
CsWeather.lookup = function(dates, anchor, place, fetcher) {
    var get = fetcher || CsWeather.fetchText;
    if (dates.length === 0) { return { days: null, error: "no trip dates" }; }
    var lat = null, lon = null;
    if (place !== "") {
        var g = get(CsWeather.geocodeUrl(place));
        if (g.error !== "") { return { days: null, error: g.error }; }
        var where = CsWeather.parseGeocode(g.text);
        if (where === null) { return { days: null, error: "place not found" }; }
        lat = where.lat; lon = where.lon;
    } else if (anchor !== null && anchor !== undefined) {
        lat = anchor.lat; lon = anchor.lon;
    } else {
        return { days: null, error: "no location" };
    }
    var r = get(CsWeather.forecastUrl(lat, lon, dates[0], dates[dates.length - 1]));
    if (r.error !== "") { return { days: null, error: r.error }; }
    var days = CsWeather.parseForecast(r.text);
    if (days === null) { return { days: null, error: "forecast could not be read" }; }
    return { days: days, error: "" };
};
```

- [ ] **Step 5: Run; expect PASS.**

- [ ] **Step 6: Commit**

```bash
git add scripts/CaveSurvey/Core/CsWeather.js scripts/CaveSurvey/Core/CsAll.js tests/js_unit.js
git commit -m "feat: CsWeather forecast lookup on a rounded coordinate or typed place

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Local roster and contacts codec (CsCalloutLocal)

**Goal:** Roster and contacts serialize to and from JSON strings and are stored in per-user `RSettings`, never in the cave folder.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsCalloutLocal.js`
- Modify: `scripts/CaveSurvey/Core/CsAll.js`, `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] Roster round trips; squeeze `"14"` becomes 14, blank or junk becomes null; fully empty rows are dropped.
- [ ] Contacts round trip; buffer defaults to 120 when blank or not a positive number.
- [ ] Junk text parses to an empty roster and default contacts, never throws.
- [ ] `load*` and `save*` wrappers use keys `CaveSurvey/Callout/Roster` and `CaveSurvey/Callout/Contacts` and swallow settings errors.

**Verify:** unit command → `### UNIT OK <n> assertions`

**Steps:**

- [ ] **Step 1: Register** (`CsAll.js` after CsWeather: `include(includeBasePath + "/CsCalloutLocal.js");`; test list entry; create the file with `var CsCalloutLocal = {};` and header comment).

- [ ] **Step 2: Write the failing tests.**

```js
// ---------------------------------------------------------------------
// Callout card -- local roster and contacts
// ---------------------------------------------------------------------

var ccRosterText = CsCalloutLocal.serializeRoster([
    { name: "Ana", role: "Lead", squeeze: "14", medical: "", emergency: "Luis" },
    { name: "", role: "", squeeze: "", medical: "", emergency: "" },
    { name: "Bo", role: "", squeeze: "big", medical: "Asthma", emergency: "" } ]);
var ccRoster = CsCalloutLocal.parseRoster(ccRosterText);
eqs(ccRoster.length, 2, "roster: the empty row is dropped");
eqs(ccRoster[0].squeeze, 14, "roster: squeeze text becomes a number");
eqs(ccRoster[1].squeeze, null, "roster: junk squeeze is null");
eqs(ccRoster[1].medical, "Asthma", "roster: medical kept");
eqs(CsCalloutLocal.parseRoster("nonsense").length, 0, "roster: junk is empty");

var ccContacts = CsCalloutLocal.parseContacts(CsCalloutLocal.serializeContacts(
    { topName: "Pat", topPhone: "555", escalation: "Call X", bufferMin: "90" }));
eqs(ccContacts.bufferMin, 90, "contacts: buffer round trips");
eqs(ccContacts.topName, "Pat", "contacts: name round trips");
eqs(CsCalloutLocal.parseContacts("").bufferMin, 120, "contacts: default buffer");
eqs(CsCalloutLocal.parseContacts(JSON.stringify({ bufferMin: -5 })).bufferMin, 120,
    "contacts: a bad buffer falls back to the default");
eqs(CsCalloutLocal.KEY_ROSTER, "CaveSurvey/Callout/Roster", "roster: settings key");
```

- [ ] **Step 3: Run; expect FAIL.**

- [ ] **Step 4: Implement:**

```js
// CsCalloutLocal.js -- the callout card's roster and contacts.
//
// Part of the Cave Survey Core library. Names, medical notes and phone
// numbers are personal data: they live in per-user QCAD settings on this
// machine and are NEVER written to stations.json or the cave folder
// (Drive syncs that). The codec is pure; load/save touch RSettings.
//
// The 'Cs' prefix is mandatory: include() dedupes by basename.

var CsCalloutLocal = {};

CsCalloutLocal.KEY_ROSTER = "CaveSurvey/Callout/Roster";
CsCalloutLocal.KEY_CONTACTS = "CaveSurvey/Callout/Contacts";
CsCalloutLocal.DEFAULT_BUFFER_MIN = 120;

var csLocalStr = function(v) {
    return (v === undefined || v === null) ? "" : String(v);
};

CsCalloutLocal.serializeRoster = function(list) {
    return JSON.stringify(list);
};

/** \return [{name, role, squeeze (number|null), medical, emergency}] */
CsCalloutLocal.parseRoster = function(text) {
    var out = [];
    var list;
    try {
        list = JSON.parse(String(text));
    } catch (e) {
        return out;
    }
    if (Object.prototype.toString.call(list) !== "[object Array]") { return out; }
    for (var i = 0; i < list.length; i++) {
        var p = list[i];
        if (p === null || typeof p !== "object") { continue; }
        var sq = parseFloat(csLocalStr(p.squeeze));
        var row = { name: csLocalStr(p.name), role: csLocalStr(p.role),
            squeeze: (isFinite(sq) && sq > 0) ? sq : null,
            medical: csLocalStr(p.medical), emergency: csLocalStr(p.emergency) };
        if (row.name === "" && row.role === "" && row.squeeze === null &&
                row.medical === "" && row.emergency === "") { continue; }
        out.push(row);
    }
    return out;
};

CsCalloutLocal.serializeContacts = function(c) {
    return JSON.stringify(c);
};

/** \return {topName, topPhone, escalation, bufferMin} */
CsCalloutLocal.parseContacts = function(text) {
    var c = { topName: "", topPhone: "", escalation: "",
        bufferMin: CsCalloutLocal.DEFAULT_BUFFER_MIN };
    try {
        var data = JSON.parse(String(text));
        c.topName = csLocalStr(data.topName);
        c.topPhone = csLocalStr(data.topPhone);
        c.escalation = csLocalStr(data.escalation);
        var b = parseFloat(csLocalStr(data.bufferMin));
        if (isFinite(b) && b > 0) { c.bufferMin = b; }
    } catch (e) {
    }
    return c;
};

var csLocalRead = function(key) {
    try {
        return String(RSettings.getStringValue(key, ""));
    } catch (e) {
        return "";
    }
};

var csLocalWrite = function(key, text) {
    try {
        RSettings.setValue(key, text);
        return true;
    } catch (e) {
        return false;
    }
};

CsCalloutLocal.loadRoster = function() {
    return CsCalloutLocal.parseRoster(csLocalRead(CsCalloutLocal.KEY_ROSTER));
};
CsCalloutLocal.saveRoster = function(list) {
    return csLocalWrite(CsCalloutLocal.KEY_ROSTER, CsCalloutLocal.serializeRoster(list));
};
CsCalloutLocal.loadContacts = function() {
    return CsCalloutLocal.parseContacts(csLocalRead(CsCalloutLocal.KEY_CONTACTS));
};
CsCalloutLocal.saveContacts = function(c) {
    return csLocalWrite(CsCalloutLocal.KEY_CONTACTS, CsCalloutLocal.serializeContacts(c));
};
```

- [ ] **Step 5: Run; expect PASS.** (`RSettings` is not defined under the node runner; the wrappers are wrapped in try/catch and are not called by the tests. The live round trip is checked in Task 7.)

- [ ] **Step 6: Commit**

```bash
git add scripts/CaveSurvey/Core/CsCalloutLocal.js scripts/CaveSurvey/Core/CsAll.js tests/js_unit.js
git commit -m "feat: local roster and contacts store for the callout card

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The Callout tab

**Goal:** A Callout tab in the Station Table dock: start date, weather place, day table, contacts, roster table, include-roster tick, Build card button writing `callout-card.html` beside the drawing.

**Files:**
- Modify: `scripts/CaveSurvey/StationTable/StationTable.js` (add `buildCalloutPage`, `readCalloutForm`, `showCalloutSettings`, `saveTrip`, `buildCard`; wire in `buildDock` at line 447 and the settings refresh at line 1568)

**Acceptance Criteria:**
- [ ] Tab "Callout" appears after Plan.
- [ ] Editing the form and pressing Build card with a planned route writes `callout-card.html` beside the drawing (checked on a COPY).
- [ ] Schedule and place are saved into the copy's `stations.json` `settings.trip`; roster and contacts are NOT in that file.
- [ ] A missing field disables Build card and names it in the status label.
- [ ] Forecast failure still builds the card.
- [ ] Reopening the dock repopulates the form (trip from `stations.json`, roster and contacts from settings).

**Verify:** live check with the MCP bridge (steps below); `js_unit` still passes.

**Steps:**

- [ ] **Step 1: Read the patterns first.** Read `StationTable.js` lines 262-300 (itemChanged comment: FILLING IS NOT EDITING), 440-470 (`buildDock`, `child`), 1177-1200 (`planGuard`), 1555-1570 (refresh). Follow their conventions: build widgets in `buildCalloutPage`, find by `objectName` through `StationTable.child`, no expandos, every Qt property read in try/catch where existing code does.

- [ ] **Step 2: Add the tab.** In `buildDock` after the Plan tab line:

```js
    tabs.addTab(StationTable.buildCalloutPage(), qsTr("Callout"));
```

- [ ] **Step 3: Add the page builder** after `buildPlanPage`:

```js
StationTable.CALLOUT_DAY_HEADERS = ["Day", "Entry (HH:MM)", "Work hours", "Night (out/camp)"];
StationTable.CALLOUT_ROSTER_HEADERS = ["Name", "Role", "Squeeze limit (in)", "Medical", "Emergency contact"];

/** A labelled one-line field row; returns the QLineEdit. */
StationTable.calloutField = function(layout, label, name, tip) {
    var row = new QHBoxLayout();
    row.addWidget(new QLabel(label), 0, 0);
    var edit = new QLineEdit();
    edit.objectName = name;
    edit.toolTip = tip;
    row.addWidget(edit, 1, 0);
    layout.addLayout(row, 0);
    return edit;
};

/** An editable table with fixed headers; rows are added with addTableRow. */
StationTable.calloutTable = function(name, headers, minH) {
    var t = new QTableWidget(0, headers.length);
    t.objectName = name;
    t.setHorizontalHeaderLabels(headers);
    try {
        t.verticalHeader().visible = false;
        t.horizontalHeader().stretchLastSection = true;
        t.setMinimumHeight(minH);
    } catch (e) {
    }
    return t;
};

StationTable.addTableRow = function(table, cells) {
    var r = table.rowCount;
    table.setRowCount(r + 1);
    for (var c = 0; c < cells.length; c++) {
        table.setItem(r, c, new QTableWidgetItem(String(cells[c])));
    }
};

StationTable.buildCalloutPage = function() {
    var page = new QWidget();
    var layout = new QVBoxLayout();
    layout.setContentsMargins(6, 6, 6, 6);
    layout.setSpacing(6);

    StationTable.calloutField(layout, qsTr("Start date:"),
        "StationTableCalloutStart",
        qsTr("First day of the trip, YYYY-MM-DD. Saved in stations.json."));
    StationTable.calloutField(layout, qsTr("Forecast place:"),
        "StationTableCalloutPlace",
        qsTr("Optional: a nearby town. Blank uses the drawing's location " +
            "rounded to about 10 km. The exact entrance is never sent."));

    layout.addWidget(new QLabel(qsTr("Days (entry time, work hours, night):")), 0, 0);
    var days = StationTable.calloutTable("StationTableCalloutDays",
        StationTable.CALLOUT_DAY_HEADERS, 90);
    layout.addWidget(days, 0, 0);
    var dayRow = new QHBoxLayout();
    var addDay = new QPushButton(qsTr("Add day"));
    var delDay = new QPushButton(qsTr("Remove day"));
    dayRow.addWidget(addDay, 0, 0);
    dayRow.addWidget(delDay, 0, 0);
    dayRow.addStretch(1);
    layout.addLayout(dayRow, 0);
    addDay.clicked.connect(function() {
        var t = StationTable.child("StationTableCalloutDays");
        StationTable.addTableRow(t, [t.rowCount + 1, "08:00", "6", "out"]);
    });
    delDay.clicked.connect(function() {
        var t = StationTable.child("StationTableCalloutDays");
        if (t.currentRow >= 0) { t.removeRow(t.currentRow); }
    });

    StationTable.calloutField(layout, qsTr("Topside contact:"),
        "StationTableCalloutTopName", qsTr("Saved on this computer only."));
    StationTable.calloutField(layout, qsTr("Contact phone:"),
        "StationTableCalloutTopPhone", qsTr("Saved on this computer only."));
    StationTable.calloutField(layout, qsTr("If no word by callout:"),
        "StationTableCalloutEscalation",
        qsTr("Who to call next, with the number. Saved on this computer only."));
    StationTable.calloutField(layout, qsTr("Callout buffer, min:"),
        "StationTableCalloutBuffer",
        qsTr("Minutes after the expected exit that topside starts acting. Default 120."));

    layout.addWidget(new QLabel(qsTr("Roster (saved on this computer only):")), 0, 0);
    var roster = StationTable.calloutTable("StationTableCalloutRoster",
        StationTable.CALLOUT_ROSTER_HEADERS, 90);
    layout.addWidget(roster, 0, 0);
    var rosterRow = new QHBoxLayout();
    var addP = new QPushButton(qsTr("Add person"));
    var delP = new QPushButton(qsTr("Remove person"));
    rosterRow.addWidget(addP, 0, 0);
    rosterRow.addWidget(delP, 0, 0);
    rosterRow.addStretch(1);
    layout.addLayout(rosterRow, 0);
    addP.clicked.connect(function() {
        StationTable.addTableRow(StationTable.child("StationTableCalloutRoster"),
            ["", "", "", "", ""]);
    });
    delP.clicked.connect(function() {
        var t = StationTable.child("StationTableCalloutRoster");
        if (t.currentRow >= 0) { t.removeRow(t.currentRow); }
    });

    var include = new QCheckBox(qsTr("Include roster on the card"));
    include.objectName = "StationTableCalloutInclude";
    include.checked = true;
    layout.addWidget(include, 0, 0);

    var buildRow = new QHBoxLayout();
    var build = new QPushButton(qsTr("Build card"));
    build.objectName = "StationTableCalloutBuild";
    build.toolTip = qsTr("Write callout-card.html beside the drawing. Plan the " +
        "trip on the Plan tab first.");
    var status = new QLabel("");
    status.objectName = "StationTableCalloutStatus";
    buildRow.addWidget(build, 0, 0);
    buildRow.addWidget(status, 1, 0);
    layout.addLayout(buildRow, 0);
    build.clicked.connect(function() { StationTable.buildCard(); });

    page.setLayout(layout);
    return page;
};
```

- [ ] **Step 4: Add form read, fill, save, and build.**

```js
/** The form as {trip, contacts, roster, includeRoster}. */
StationTable.readCalloutForm = function() {
    var text = function(name) {
        var w = StationTable.child(name);
        return w === null ? "" : String(w.text);
    };
    var cell = function(t, r, c) {
        var it = t.item(r, c);
        return it === null ? "" : String(it.text());
    };
    var days = [];
    var dt = StationTable.child("StationTableCalloutDays");
    for (var r = 0; r < dt.rowCount; r++) {
        days.push({ entry: cell(dt, r, 1), workHours: parseFloat(cell(dt, r, 2)),
            night: cell(dt, r, 3) });
    }
    var trip = CsStationStore.cleanTrip({ startDate: text("StationTableCalloutStart"),
        weatherPlace: text("StationTableCalloutPlace"), days: days });
    var rt = StationTable.child("StationTableCalloutRoster");
    var roster = [];
    for (var p = 0; p < rt.rowCount; p++) {
        roster.push({ name: cell(rt, p, 0), role: cell(rt, p, 1),
            squeeze: cell(rt, p, 2), medical: cell(rt, p, 3),
            emergency: cell(rt, p, 4) });
    }
    return { trip: trip,
        contacts: CsCalloutLocal.parseContacts(CsCalloutLocal.serializeContacts({
            topName: text("StationTableCalloutTopName"),
            topPhone: text("StationTableCalloutTopPhone"),
            escalation: text("StationTableCalloutEscalation"),
            bufferMin: text("StationTableCalloutBuffer") })),
        roster: CsCalloutLocal.parseRoster(CsCalloutLocal.serializeRoster(roster)),
        includeRoster: StationTable.child("StationTableCalloutInclude").checked };
};

/** Fill the form from stations.json (trip) and local settings (people). */
StationTable.showCalloutSettings = function() {
    var s = StationTable.state;
    var set = function(name, v) {
        var w = StationTable.child(name);
        if (w !== null) { w.text = String(v); }
    };
    var trip = (s.store !== null && s.store.settings.trip) ?
        s.store.settings.trip : CsStationStore.emptyTrip();
    set("StationTableCalloutStart", trip.startDate);
    set("StationTableCalloutPlace", trip.weatherPlace);
    var dt = StationTable.child("StationTableCalloutDays");
    dt.setRowCount(0);
    for (var i = 0; i < trip.days.length; i++) {
        StationTable.addTableRow(dt, [i + 1, trip.days[i].entry,
            trip.days[i].workHours, trip.days[i].night]);
    }
    var c = CsCalloutLocal.loadContacts();
    set("StationTableCalloutTopName", c.topName);
    set("StationTableCalloutTopPhone", c.topPhone);
    set("StationTableCalloutEscalation", c.escalation);
    set("StationTableCalloutBuffer", c.bufferMin);
    var rt = StationTable.child("StationTableCalloutRoster");
    rt.setRowCount(0);
    var people = CsCalloutLocal.loadRoster();
    for (var p = 0; p < people.length; p++) {
        StationTable.addTableRow(rt, [people[p].name, people[p].role,
            people[p].squeeze === null ? "" : people[p].squeeze,
            people[p].medical, people[p].emergency]);
    }
};

/**
 * Put the trip into stations.json settings (re-reading the file first,
 * like savePlanSettings). \return "" when saved, else why not.
 */
StationTable.saveTrip = function(trip) {
    var s = StationTable.state;
    var path = StationTable.sidecarPath(s.docPath);
    if (path === "") {
        return qsTr("trip not saved: save the drawing first");
    }
    var side = StationTable.readSidecar(path);
    if (side.error !== "") {
        return qsTr("trip not saved: stations.json could not be read") +
            " (" + side.error + ")";
    }
    side.store.settings.trip = trip;
    if (!StationTable.writeSidecar(path, side.store)) {
        return qsTr("trip not saved: could not write stations.json");
    }
    if (s.store !== null) { s.store.settings.trip = trip; }
    return "";
};

StationTable.calloutSay = function(text) {
    var label = StationTable.child("StationTableCalloutStatus");
    if (label !== null) { label.text = text; }
};

/** Write callout-card.html beside the drawing. \return the path or "" */
StationTable.buildCard = function() {
    var s = StationTable.state;
    if (!StationTable.planGuard()) { return ""; }
    if (s.docPath === "" || CsCave.folderOf(s.docPath) === null) {
        StationTable.calloutSay(qsTr("Save the drawing first."));
        return "";
    }
    var form = StationTable.readCalloutForm();
    var plan = StationTable.planTrip();
    var need = CsCalloutCard.missing(form.trip, plan);
    if (need !== "") {
        StationTable.calloutSay(qsTr("Missing: %1").arg(need));
        return "";
    }
    var problems = [];
    var why = StationTable.saveTrip(form.trip);
    if (why !== "") { problems.push(why); }
    if (!CsCalloutLocal.saveRoster(form.roster)) { problems.push(qsTr("roster not saved")); }
    if (!CsCalloutLocal.saveContacts(form.contacts)) { problems.push(qsTr("contacts not saved")); }

    var anchor = null;
    try {
        var rec = CsLocationPick.anchorRecord(StationTable.document());
        if (rec !== null) { anchor = { lat: rec.lat, lon: rec.lon }; }
    } catch (eAnchor) {
    }
    var wx = CsWeather.lookup(CsCalloutCard.tripDates(form.trip), anchor,
        form.trip.weatherPlace);
    if (wx.days === null) {
        problems.push(qsTr("no forecast (%1)").arg(wx.error));
    }
    var html = CsCalloutCard.html(plan, {
        title: CsCave.nameOf(s.docPath) || qsTr("Cave"),
        survey: s.drawn.survey, resolved: s.drawn.resolved,
        trip: form.trip, contacts: form.contacts, roster: form.roster,
        includeRoster: form.includeRoster,
        forecast: wx.days === null ? null : { days: wx.days },
        generated: StationTable.today() });
    var path = CsCave.folderOf(s.docPath) + "/callout-card.html";
    if (!StationTable.writeText(path, html)) {
        StationTable.calloutSay(qsTr("Could not write callout-card.html beside the drawing."));
        return "";
    }
    StationTable.calloutSay(qsTr("Saved callout-card.html") +
        (problems.length > 0 ? " (" + problems.join("; ") + ")" : ""));
    try {
        QDesktopServices.openUrl(QUrl.fromLocalFile(path));
    } catch (eOpen) {
    }
    return path;
};
```

- [ ] **Step 5: Refresh hook.** At the end of the function containing line 1568 (`StationTable.showPlanSettings(changed);`) add `StationTable.showCalloutSettings();` on the same condition that repopulates the plan settings (when the drawing changed), not on every refresh, so a Refresh never eats typing. Read the surrounding lines and follow `showPlanSettings`'s force/untouched logic; if the drawing changed (`changed` true) call it, otherwise leave the form alone.

- [ ] **Step 6: Live check on a COPY.** Copy a cave folder (use the Pitfall fixture or `~/Documents/Cave/<any cave>` copy) to the scratchpad, open the copy's drawing in CaveCAD. Confirm the app is running fresh code first (cavecad-live-restart-trap: a blocked quit leaves stale add-ons). Then via `mcp__cavecad__cavecad_eval` and `cavecad_screenshot`:
  1. Open Station Table, Plan tab: add a stop, Plan trip.
  2. Callout tab: start date, one day `08:00 / 4 / out`, contact, one roster row.
  3. Build card. Expected: status "Saved callout-card.html", the file exists beside the drawing.
  4. `grep -c "Roster" callout-card.html` ≥ 1; `grep -c "<svg" callout-card.html` = 1; stations.json contains `"trip"` and does NOT contain the roster name or phone.
  5. Turn networking off (or type an unresolvable place): card still builds with "No forecast, check before you go".
  6. Close and reopen the drawing: the form repopulates.

- [ ] **Step 7: Run `js_unit` again (expect `### UNIT OK`), then commit**

```bash
git add scripts/CaveSurvey/StationTable/StationTable.js
git commit -m "feat: Station Table Callout tab builds the callout card

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Handbook, version, publish

**Goal:** The handbook documents the card, the version is bumped one patch, and the build is published locally with `tools/publish.sh`.

**Files:**
- Modify: `docs/handbook/pages/station-table.html`, `VERSION`

**Acceptance Criteria:**
- [ ] The station-table handbook page has a Callout section: what the card is, the two pages, the schedule fields, the privacy rules (roster local only, forecast uses a general location), and the cost of camp nights (the route's in/out only).
- [ ] `VERSION` is one patch above the current value (`0.9.183.0` -> `0.9.184.0`), matching how `861f2fb` bumped it.
- [ ] `js_unit` passes including handbook tests.
- [ ] `tools/publish.sh` completes and the deployed CaveCAD shows the Callout tab after a real restart.

**Verify:** unit command → `### UNIT OK <n> assertions`; then live check of the Callout tab in the installed app.

**Steps:**

- [ ] **Step 1: Write the handbook section.** Append before the closing tags of `docs/handbook/pages/station-table.html`, in the page's existing markup style (read the page first and match its heading and list tags):

```html
<h2>Callout card</h2>
<p>The Callout tab builds <code>callout-card.html</code> beside the drawing: two printed sheets for a trip. Plan the trip on the Plan tab first, then fill in the Callout tab and press <b>Build card</b>.</p>
<ul>
<li><b>Sheet 1, for topside:</b> the roster (name, role, squeeze limit, medical notes, emergency contact), the schedule, who to call if there is no word, and the forecast for each trip day.</li>
<li><b>Sheet 2, for the team:</b> the route sketch, turn-by-turn directions, hazard notes found on the way, and the rope list.</li>
<li><b>Schedule:</b> a start date, then one row per day with an entry time, work hours, and a night: <code>out</code> (back on the surface) or <code>camp</code> (stay underground). Turnaround is entry plus the way in (on days that start from the surface) plus work hours. Callout is the expected time out plus your buffer. Camp nights have no callout. Only the trip's first way in and last way out use the route's times; moves between camps are not timed.</li>
<li><b>Forecast:</b> looked up when you build, from the drawing's location rounded to about 10 km, or from a town you type. The exact entrance is never sent and never printed. With no network the card says so and still builds.</li>
<li><b>Rain plus water:</b> if a day's forecast is wet and a station note on the route mentions water, the card carries a bold warning. It says "check", never "safe".</li>
<li><b>Privacy:</b> the roster and phone numbers are saved on this computer only, not in the cave's folder, so Drive does not carry them. Untick <b>Include roster</b> for a copy that leaves your hands.</li>
</ul>
```

- [ ] **Step 2: Bump VERSION** to `0.9.184.0` (versioning stays at 0.9.X patch bumps).

- [ ] **Step 3: Run `js_unit`; expect PASS.**

- [ ] **Step 4: Commit, then publish locally.**

```bash
git add docs/handbook/pages/station-table.html VERSION
git commit -m "chore: 0.9.184.0 (callout card)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
./tools/publish.sh
```

Then restart CaveCAD for real (Quit, confirm the process is gone, relaunch: cavecad-live-restart-trap; then codesign per cavecad-resign-after-deploy if publish.sh replaced the app bundle) and confirm the Callout tab shows.

- [ ] **Step 5: Do NOT trigger the release workflow.** Publishing a release build is a separate step Nathan asks for (publish-means-release); report that the local publish is done and ask.

---

## Self-review

**Spec coverage:** schedule and arithmetic (Task 2), card layout with roster above the fold and route on its own page (Task 3), hazards by keyword (Task 3), forecast with rounded coordinate or typed place and null path (Task 4), roster/contacts local only (Task 5), schedule and place in `stations.json` (Task 1, Task 6), Callout tab (Task 6), errors (missing-field status, forecast failure, roster/contacts empty lines, no-route page 2 message: Tasks 3 and 6), privacy tests (Tasks 3 and 4), handbook and publish (Task 7). Spec risk 2 (RSettings string round trip) is checked live in Task 6 step 6 item 6 and item 4; if `RSettings.getStringValue` misbehaves there, fix in `CsCalloutLocal` and add a comment naming the trap in `qcad-js-bridge-traps`.

**Known gaps by design:** underground camp-to-camp routing is not modelled (documented); no check-in log; drawn `NOTES-HAZARD` callouts are not read (spec updated).

**Type consistency:** `windows` returns `{rows, warnings}` with `entry/turnaround/expectedOut/callout` stamps `{date, time, abs}` and flags `fromSurface/endsOnSurface`; `html` reads exactly those. `CsWeather.lookup(dates, anchor, place, fetcher)` returns `{days, error}`; the panel and the card use `days` as `[{date, high, low, rainTotal, rainChance}]`. `trip` is `{startDate, weatherPlace, days: [{entry, workHours, night}]}` everywhere. Contacts `{topName, topPhone, escalation, bufferMin}`; roster rows `{name, role, squeeze, medical, emergency}`.
