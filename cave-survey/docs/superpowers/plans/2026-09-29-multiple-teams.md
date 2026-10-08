# Multiple Teams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Expedition Planner supports several teams per trip, each with its own members, stops, schedule and packing list, producing a topside sheet plus one file per team.

**Architecture:** Team data lives in `stations.json` `settings.trip.teams` (validated by `CsStationStore.cleanTrip`); a new pure engine `Core/CsTeams.js` does all rules (dates, same-day conflicts, per-team schedule windows, callout strip, missing-item lists, file names); `Core/CsCalloutCard.js` gains `topsideHtml` and `teamHtml` beside the untouched single-team `html`; the panel gets a Teams section of stacked collapsible team sections and a multi-file build. Single-team trips must stay byte-identical to today's output.

**Tech Stack:** QCAD/CaveCAD add-on JS (ES5 only: no let/const/arrows/template strings), Qt widgets through the script bridge, the existing suites (`tests/js_unit.js` through CaveCAD's own engine, `tests/js_syntax.js`, `python3 -m unittest discover -s tests`).

**User decisions (already made):**
- Manual split first; the "Suggest split" button is a LATER stage (option B, manual version first).
- Each team has its own schedule (days: entry, work hours, night) and its own packing list; pace, start date, forecast place, escalation contacts and the people directory stay trip-level.
- A person may be on several teams on different days; WARN (never block) when the same person is on two teams on the same calendar day.
- Output is SEPARATE FILES: a topside sheet plus one file per team (`team-<n>-<slug>.html`); one team builds today's single card unchanged.
- The topside sheet has a "next callouts" strip sorted by time.
- One scrolling panel, no tabs; teams are stacked collapsible sections.
- Team files carry members' medical notes (a team needs them in an incident) but NOT emergency contacts (topside sheet only).
- Nothing deletes files; stale team files are named in the status line.

Spec (authoritative): `docs/superpowers/specs/2026-09-29-multiple-teams-design.md`. Repo: `~/Documents/github/cavecad-tools`, branch `legacy-map`.

## Conventions every task follows

- ES5 only. New Core files: `Cs` prefix, listed in BOTH `scripts/CaveSurvey/Core/CsAll.js` and the CORE file list in `tests/js_unit.js` (a missing entry passes silently).
- Tests: `ok(cond, what)`, `eqs(actual, expected, what)`; new test vars use the prefix `tm` (teams); new blocks go immediately above the `// Report.` banner near the end of `tests/js_unit.js`. Write the test first, watch it fail (report honestly if it aborts instead of failing per assertion), implement, watch it pass.
- Run the suites (unit takes ~100 s; run in the background, stdin closed, read the log):
  `cd ~/Documents/github/cavecad-tools && /Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/js_unit.js "$PWD" </dev/null > /tmp/unit-teams.log 2>&1` then read the last `### UNIT OK <n> assertions` line (baseline 8139). Same shape for `tests/js_syntax.js` (`### SYNTAX OK`), plus `python3 -m unittest discover -s tests` (`OK (skipped=5)`).
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. No push, no release.
- **Implementers never launch, quit or restart the CaveCAD GUI** (the coordinator's live session may hold real unsaved work) and never touch the real `people.json`; the coordinator does all live checks after checking `cavecad_status` (scratch copy `.../scratchpad/EPTest/PitfallCave.dxf` only, never Truitt).
- **Dock-build rule (0.9.194 lesson):** inside any `build*` function or anything it calls, never use `child()`, `setXText()` or anything that reaches the dock through `ensureDock`; operate on the widget in hand. Team sections are added AFTER the dock exists.
- Privacy: no coordinates in any file; `teams` in `stations.json` must never carry medical, phone or contact data.

---

### Task 1: Teams in the trip store

**Goal:** `settings.trip` carries `teams` (and keeps `party`, legacy `days`), validated and round-tripped.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsStationStore.js` (`cleanTrip`, `emptyTrip`)
- Test: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `emptyTrip()` has `teams: []`; `cleanTrip` cleans `teams` as: `id` string kept (or "" allowed at this layer), `name` default `"Team N"` (N = 1-based position) when blank, `goal` and `packing` trimmed strings, `dayOffset` a non-negative integer (bad or negative -> 0), `members` `[{id, name}]` (entries without a name dropped, ids optional, duplicates by id or by lower-cased name dropped), `stops` strings trimmed with blanks and duplicates dropped and order kept, `days` cleaned by exactly the same rules as trip days, at most 8 teams (extras dropped).
- [ ] Unknown fields on a team or member are dropped (a `medical` or `phone` field never survives `serialize` -> `parse`).
- [ ] Legacy `days` and `party` behave as before; trips without `teams` parse to `teams: []` (NO migration here).
- [ ] Existing store tests still pass.

**Verify:** unit suite -> `### UNIT OK <n> assertions`

**Steps:**

- [ ] **Step 1: Write failing tests (`tm store:`)** covering every acceptance bullet: a two-team round trip through `CsStationStore.serialize`/`parse`; blank name -> "Team 2" for the second entry; negative and text `dayOffset`; member/stop/day cleaning; 9 teams -> 8; a team carrying `{medical:"x", phone:"y"}` and a member carrying `{medical:"x"}` serialise without those keys; a trip with only legacy `days` keeps `teams: []`.

- [ ] **Step 2: Implement.** In `cleanTrip`, after the `party` handling, add:

```js
    var rawTeams = Object.prototype.toString.call(raw.teams) === "[object Array]" ?
        raw.teams : [];
    for (var ti = 0; ti < rawTeams.length && trip.teams.length < 8; ti++) {
        var rt = rawTeams[ti];
        if (rt === null || typeof rt !== "object") { continue; }
        trip.teams.push(CsStationStore.cleanTeam(rt, trip.teams.length + 1));
    }
```

and a new `CsStationStore.cleanTeam(rt, position)` implementing the acceptance rules, reusing the day-cleaning loop (extract the existing days loop of `cleanTrip` into `CsStationStore.cleanDays(list)` and call it from both, so trip days and team days share ONE implementation). Set `teams: []` in `emptyTrip`.

- [ ] **Step 3: Run suites; expect PASS. Commit** `feat: teams in the trip store`.

---

### Task 2: The teams engine (CsTeams)

**Goal:** `Core/CsTeams.js` implements every team rule as pure, tested functions.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsTeams.js`
- Modify: `scripts/CaveSurvey/Core/CsAll.js` (after `CsCalloutCard.js`), `tests/js_unit.js` (file list + tests)

**Acceptance Criteria:**
- [ ] `CsTeams.blank(name)` -> `{id: CsUuid.v4(), name, goal:"", dayOffset:0, members:[], stops:[], days:[], packing:""}`; `CsTeams.copyOf(team, name)` -> new id, copies `days` (deep) and `dayOffset`, empty `members`/`stops`/`packing`.
- [ ] `CsTeams.fromLegacy(trip, packing, party)` -> `[team]` named "Team 1" holding `trip.days`, `party` as members, `packing`; an empty legacy trip (no days) -> one empty "Team 1"; a trip that already has teams -> returns them unchanged.
- [ ] `CsTeams.dates(trip, team)` -> yyyy-mm-dd strings for start date + `dayOffset` + i (empty when the start date is invalid).
- [ ] `CsTeams.sameDayConflicts(trip)` -> `[{person, date, teams:[names]}]` for every person on two or more teams that share a date; match by id, else trimmed lower-cased name; sorted by date then person; a person twice on different dates is NOT reported.
- [ ] `CsTeams.windows(plan, trip, team, bufferMin)` -> `CsCalloutCard.windows(plan, {startDate: <start + offset>, days: team.days}, bufferMin)` (a team with `dayOffset` 1 has its day-1 entry on start date + 1).
- [ ] `CsTeams.calloutStrip(rowsByTeam)` -> `[{team, stamp}]`, one per team day that ends on the surface, sorted by absolute minute then team order; camp days contribute nothing.
- [ ] `CsTeams.missingAll(trip, plansByTeam, contacts, roster, includeRoster)` -> strings in panel order: trip level (start date, contact name, phone, "if-no-word" line) then per team `"<Team name>: ..."` for no name text ("a name"), no members ("at least one person"), no days ("at least one day"), no stops ("at least one stop"); the roster wording applies only when `includeRoster !== false` and no team has any member; whitespace-only counts as missing; buffer never required; empty when complete.
- [ ] `CsTeams.slug(name)`: lower-cased, non-alphanumerics -> single hyphens, trimmed of hyphens, max 30 chars, `"team"` when empty; `CsTeams.fileName(index0, team)` -> `"team-" + (index0 + 1) + "-" + slug + ".html"`.
- [ ] `CsTeams.memberRows(team, directory)` -> members resolved through `CsPeople.resolveParty(team.members, directory)` (same rules and shape as the existing card roster; unknown -> `known:false`).

**Verify:** unit suite -> `### UNIT OK <n> assertions`

**Steps:**

- [ ] **Step 1: Register the (empty) file** (`var CsTeams = {};` plus a header comment following `CsCalloutCard.js`'s style) in `CsAll.js` and the test file list.

- [ ] **Step 2: Write failing tests (`tm engine:`)** for every acceptance bullet, including the edge cases named: offset dates, same-person-different-dates no warning, three teams on one date, id-vs-name matching, calloutStrip tie order, camp-only team, each missing item alone, whitespace-only, and slug cases ("Deep Push!" -> "deep-push", "" -> "team", a 40-char name cut to 30, "***" -> "team").

- [ ] **Step 3: Implement.** Key pieces:

```js
CsTeams.sameDayConflicts = function(trip) {
    var byKey = {};          // date|person -> {person, date, teams:[]}
    var order = [];
    var teams = trip.teams || [];
    for (var t = 0; t < teams.length; t++) {
        var dates = CsTeams.dates(trip, teams[t]);
        for (var m = 0; m < teams[t].members.length; m++) {
            var who = teams[t].members[m];
            var pkey = who.id !== "" && who.id !== undefined ? "id:" + who.id :
                "n:" + String(who.name).replace(/^\s+|\s+$/g, "").toLowerCase();
            for (var d = 0; d < dates.length; d++) {
                var k = dates[d] + "|" + pkey;
                if (byKey[k] === undefined) {
                    byKey[k] = { person: who.name, date: dates[d], teams: [] };
                    order.push(k);
                }
                if (byKey[k].teams.indexOf(teams[t].name) < 0) { byKey[k].teams.push(teams[t].name); }
            }
        }
    }
    var out = [];
    for (var o = 0; o < order.length; o++) {
        if (byKey[order[o]].teams.length > 1) { out.push(byKey[order[o]]); }
    }
    out.sort(function(a, b) {
        return a.date < b.date ? -1 : (a.date > b.date ? 1 :
            (a.person < b.person ? -1 : (a.person > b.person ? 1 : 0)));
    });
    return out;
};
```

Note: identity key differs between an id member and a name-only member of the same person; when a member has an id, also register a name alias so a second team listing the same person by name only still conflicts (build an `idByName` map first, then key everything by the id when the name is known). Test it.

`fromLegacy` must not mutate its inputs; `windows` shifts the start date with `CsCalloutCard.dateMinutes` and `stamp` (no `Date` in local time).

- [ ] **Step 4: Run suites; expect PASS. Commit** `feat: CsTeams engine`.

---

### Task 3: Topside sheet and team file

**Goal:** `CsCalloutCard.topsideHtml` and `CsCalloutCard.teamHtml` render the two file types; single-team output is byte-identical to today.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsCalloutCard.js`
- Test: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `topsideHtml(ctx)` — ctx: `{title, trip (with teams), teams: [{team, plan, windows, members (resolved), route: {survey, resolved}}], contacts, includeRoster, forecast, generated, fileNames: [...]}` — renders, in order: header, the next-callouts strip (`CsTeams.calloutStrip`), the roster grouped by team (role, squeeze, skills, medical, emergency contact; unknown members print "details not on this computer"; a person on several teams appears under each), same-day conflicts as bold warnings (`"<person> is on <A> and <B> on <date>"`), one schedule table per team (heading with team name, goal and its file name), the escalation box, then the forecast strip with weather icons (rain-plus-water flag if ANY team's route has a water note and a day is wet). It contains NO route drawing and no directions.
- [ ] `teamHtml(ctx)` — ctx: `{title, trip, team, plan, windows, members, forecast, generated, survey, resolved}` — renders team name and goal, its dates, its members (role, squeeze, skills, medical; NOT emergency contact), its schedule table, the forecast for its own dates only, then (print page break before) the route SVG, intersection directions with leg summaries, hazards on the route, and the rope list plus the team's own `packing` text.
- [ ] Everything through `CsTripPlan.esc`; no coordinates; a team with no route (`plan.stops.length === 0`) prints "No route: add stops under this team" instead of failing.
- [ ] Refactor: the schedule table, forecast strip, roster row and escalation box are shared private helpers used by `html`, `topsideHtml` and `teamHtml`; the existing single-team `html` output for the existing test contexts is byte-identical (assert with stored expected strings or a before/after equality on the same inputs).

**Verify:** unit suite -> `### UNIT OK <n> assertions`

**Steps:**

- [ ] **Step 1: Write failing tests (`tm render:`)** — first capture the CURRENT `html` output for two fixed contexts (single team, with and without roster) BEFORE refactoring and assert equality afterwards; then tests for each acceptance bullet: strip order (two teams, callouts at different times), roster grouped by team with a person listed under two teams, conflict banner text, per-team schedule tables, no `<svg` on the topside sheet, team file without emergency contact text, own-dates forecast, packing text, escaping (`<b>` in a team name, goal, packing and member name), no long-decimal coordinate-like text, no-route degradation.

- [ ] **Step 2: Extract shared helpers** from `html` without changing its output (run the parity assertions after each extraction), then add `topsideHtml` and `teamHtml` on top of them.

- [ ] **Step 3: Run suites; expect PASS. Commit** `feat: topside sheet and team file renderers`.

---

### Task 4: Panel team data layer

**Goal:** The panel keeps teams in state, loads and migrates them, writes them through to `stations.json`, and exposes plain functions for every team edit, all testable without widgets.

**Files:**
- Modify: `scripts/CaveSurvey/ExpeditionPlanner/ExpeditionPlanner.js`
- Test: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `ExpeditionPlanner.state.teams` holds the current teams; `ExpeditionPlanner.loadTeams(trip, settings)` fills it: stored teams as is, else `CsTeams.fromLegacy(trip, settings.packing, trip.party)`, so the migration happens at LOAD in the panel and never inside `cleanTrip` or `serialize`.
- [ ] Plain edit functions (no widgets): `addTeam()` (copyOf the last team, name "Team N", refuses at 8), `removeTeam(id)` (refuses the last team), `setTeamField(id, "name"|"goal"|"packing"|"dayOffset", value)`, `setTeamMember(id, person, on)`, `addTeamStop(id, station)` / `removeTeamStop(id, station)` / `clearTeamStops(id)` (stops must exist in the survey, case-insensitive match as the current picker does), `setTeamDays(id, days)`. Each edit validates through `CsStationStore.cleanTeam`.
- [ ] `ExpeditionPlanner.saveTeams()` writes `settings.trip.teams` through the existing sidecar path (re-read the file first, keep unrelated settings, refuse when `stations.json` is damaged) and is called after every edit; unsaved drawings keep teams in memory and say so.
- [ ] Members offered to a team are only people in the party (Going); a member who is no longer in the party is kept and flagged.
- [ ] `ExpeditionPlanner.teamWarnings()` returns `CsTeams.sameDayConflicts` for the current state.

**Verify:** unit suite -> `### UNIT OK <n> assertions`

**Steps:**

- [ ] **Step 1: Write failing tests (`tm panel:`)** stubbing the sidecar read/write and `child()` as the existing `qd`/`dd` tests do: load with stored teams; load with legacy days (migration -> Team 1 with packing and party); add/remove/refuse rules; each setter validates; stops must be real stations; a save writes only `teams` and preserves `pace`/`packing`/entries; a damaged file refuses.

- [ ] **Step 2: Implement** the state, load and edit functions. `showCalloutSettings` (the populate path) calls `loadTeams`; the existing single trip fields (`days`, stops list) stop being read by Build in Task 5, not here.

- [ ] **Step 3: Run suites; expect PASS. Commit** `feat: panel team data layer`.

---

### Task 5: Team sections in the panel and the multi-file build

**Goal:** The panel shows teams as stacked collapsible sections and builds the topside sheet plus one file per team.

**Files:**
- Modify: `scripts/CaveSurvey/ExpeditionPlanner/ExpeditionPlanner.js`, `scripts/CaveSurvey/Core/CsPanel.js` (only if the fold-section helper needs a small addition), `tests/js_unit.js`, `tests/test_addon.py` (only if a structural test needs the new names)

**Acceptance Criteria:**
- [ ] Panel order: Trip, People, Teams, Escalation, Card. The old single Schedule and Route sections are replaced by the team sections (their widgets, objectNames and handlers removed; no dead code).
- [ ] Teams section: heading, `Add team` and `Remove team` buttons (Remove confirms with Yes/No, default No; the last team cannot be removed), one collapsible chevron section per team whose header shows the name plus a live summary ("3 people · 2 stops · 2 days") and a red mark when the team has a same-day conflict; the newest or last-edited team is expanded, others collapsed.
- [ ] Team body: Name, Goal, "Starts on trip day" (QSpinBox, 1-based in the UI, stored as `dayOffset`), Members (a QCheckBox per Going person), Schedule (days table with Add/Remove day), Stops (the station dropdown, Add stop, stops table, Remove, Clear), Packing (plain text). All widgets have objectNames `ExpeditionPlannerTeam<n>_<Field>` (n = 1-based position).
- [ ] Removing a team hides its section widgets and renames them (`ExpeditionPlannerRemoved<k>_...`) so `findChild` can never return a stale one; a later add reuses or builds fresh sections; an add/remove/add cycle leaves exactly the live teams findable (verified live by the coordinator).
- [ ] Team sections are built AFTER the dock exists (from `showCalloutSettings`/load), never during `buildDock`; nothing in a `build*` function uses `child()`.
- [ ] Edits write through via the Task 4 functions (fill guard; programmatic fills never write).
- [ ] Build (renamed `Build cards`): plans each team's route from its own stops (start = the survey's first station, shared pace), runs `CsTeams.missingAll` (lists ALL missing items, per team; builds nothing while any), then with exactly one team writes today's single `callout-card.html` only, else writes `callout-card.html` (topside) and `CsTeams.fileName(i, team)` per team beside the drawing; the status line reports files written, same-day conflict warnings, and any `team-*.html` files in the folder this build did not write ("left in place from an earlier build: ..."). Nothing is deleted.
- [ ] `Save packet` and `Plan trip` work per the spec: Plan trip plans every team and shows the plan text with a heading per team; Save packet is enabled only when there is exactly one team (tooltip otherwise).
- [ ] Forecast lookup, escalation contacts, roster/Include-roster and the people directory behave as before.

**Verify:** unit suite + syntax + python suites green; then the coordinator's live checks (Task 6).

**Steps:**

- [ ] **Step 1: Read first:** `ExpeditionPlanner.js` in full, `CsPanel.js` `section`/fold helpers (the skills groups in the person popup use one), `buildCalloutCard`/`buildCard`, `showCalloutSettings`, and the 0.9.194 lesson comment on `ensureDock`.

- [ ] **Step 2: Failing tests (`tm build:`)** for what is testable headless: a pure `ExpeditionPlanner.teamSummary(team, conflicts)` string; `ExpeditionPlanner.planTeams(teams, survey...)` returning per-team plans and per-team missing lists with stubbed `CsTripPlan.build`; the build-output planner `ExpeditionPlanner.buildFileList(teams)` returning file names (single -> one file; multi -> topside + team files) and `staleTeamFiles(existingNames, written)`; the status-line text builder.

- [ ] **Step 3: Implement** the section builders, the add/remove/rename logic, the write-through wiring and the multi-file build, keeping the dock-build rule. Add a test that `buildDock`'s call graph never calls `child()`/`ensureDock` re-entrantly (the existing `dd2` guard test stays green).

- [ ] **Step 4: Run all suites; expect green. Commit** in logical commits (`feat: team sections in the panel`, `feat: multi-team build writes topside sheet and team files`).

---

### Task 6: Docs, version, publish, live verification

**Goal:** Handbook, version bump, local publish, and a live verification on the scratch copy.

**Files:**
- Modify: `docs/handbook/pages/expedition-planner.html`, `VERSION` (0.9.197.0 -> 0.9.198.0), `tests/test_addon.py` (the Expedition Planner "what it touches" line: teams and team files)

**Acceptance Criteria:**
- [ ] Handbook describes teams (own schedule, members, stops, packing; starts on trip day N; same-day warnings), the topside sheet (next callouts strip, roster by team with medical notes and emergency contacts) and the team files (members with medical notes, no emergency contacts; team schedule; route and directions; packing), the single-team behaviour, and that stale team files are never deleted.
- [ ] All suites green; `./tools/publish.sh` ran; the installed folder matches the repo.
- [ ] **Live (coordinator, scratch copy only, after `cavecad_status` shows my scratch doc unmodified and no other tabs):** fresh launch has no recursion errors in `~/Library/Application Support/QCAD/CaveCAD/logs/session-*.log`; the panel builds; adding a second team, assigning members and stops, editing days, a same-day overlap warning, `Build cards` writes the topside sheet and both team files with the right contents (read them and render with Quick Look), an add/remove/add team cycle leaves no stale named widgets, teams restore after a restart, single-team output unchanged; fixture `people.json` and contacts created and removed by the test.

**Verify:** the live checklist above.

**Steps:**

- [ ] **Step 1:** Handbook + `test_addon.py` line + VERSION; run all suites; commit; run `./tools/publish.sh`.
- [ ] **Step 2 (coordinator):** live verification per the acceptance list; fix anything found with a new patch version and re-test in a real launch BEFORE telling Nathan to restart.

---

## Self-review

**Spec coverage:** data model and validation (Task 1), migration at load and never in the cleaner (Task 4), engine functions (Task 2), the two file types and single-team parity (Task 3), panel layout, per-team objectNames, add/remove with stale-widget handling, write-through and required-item rule (Tasks 4 and 5), stale-file reporting and non-deletion (Task 5), privacy rules (Tasks 1 and 3 tests), live testing and the risks list (Task 6 and Conventions). Stage 2 suggestion is out of scope by decision.

**Type consistency:** team shape `{id, name, goal, dayOffset, members:[{id,name}], stops:[string], days:[{entry, workHours, night}], packing}` is used identically in `cleanTeam` (Task 1), `CsTeams` (Task 2), the renderers' ctx (Task 3) and the panel state (Tasks 4 and 5). File names come from `CsTeams.fileName(index0, team)` everywhere.
