# Expedition Planner panel (amends the callout card plan)

Date: 2026-09-29. Supersedes the spec's "Callout tab in the Station Table dock"
and Task 6 of `2026-09-29-callout-card.md`. Nathan's decision, after seeing
the Callout tab inside Station Table: **the expedition planner needs its own
panel; a tab in Station Table is not findable.** Chosen: planner only, with a
dropdown of the map's stations, no direct link to Station Table.

## Goal

A standalone tool, **Expedition Planner** (menu "Expedition Planner", commands
`expeditionplanner` / `ep`), with its own dock. It holds the trip plan (moved
out of Station Table's Plan tab) and the callout card, and is the home for the
later expedition tools (multi-objective planner, squeeze filter, what's-left
ranking). Station Table goes back to being only the station table.

## Panel shape

> **Superseded 2026-09-29 (0.9.188.0):** the Trip and Callout tabs below are
> gone. The dock is one scrolling page in the callout card's order (Trip,
> Roster, Schedule, Escalation, Route, Card); every objectName is kept; Build
> card refuses until `CsCalloutCard.missingAll` is empty.

Dock objectName `CaveSurveyExpeditionPlannerDock`, title "Expedition Planner",
tabs:

- **Trip** (was Station Table's Plan tab): a station picker, the stop list,
  pace, team packing list, Plan trip, Save packet, plan text output.
- **Callout**: exactly the Callout tab built in commit `0853f4d` (start date,
  forecast place, days table, contacts, roster, include-roster tick, Build
  card, status).

### The station picker (new)

Replaces "select a row on the Stations tab, press Add selected station".

- An **editable `QComboBox`** listing every station in the survey in natural
  order (`CsStationTable.compareNatural`), plus an **Add stop** button.
  `QComboBox` editable works on this bridge (probed live, 2026-09-29: `editable`
  property and `setEditable(true)` both work); Qt's built-in inline completion
  comes with an editable combo. `QCompleter` does NOT exist on this bridge: do
  not use it.
- Add stop takes the combo's current text, trims it, and matches it to a station
  name case-insensitively. No match: say so in a status label under the picker
  ("A99 is not a station in this drawing"); nothing is added. A duplicate is
  ignored. On success the combo text clears.
- Remove and Clear buttons and the one-column stop table stay as they are today.
- With no stops listed, Plan trip no longer falls back to a selected row (there
  is no Stations tab any more): it says "Add at least one stop".
- The combo is refilled when the drawing changes (same trigger that refills
  everything else).

## Shared sidecar I/O

Station Table and Expedition Planner both read and write `stations.json`
(Station Table its marks; the planner `settings.packing`, `settings.pace`,
`settings.trip`). Move the file plumbing into one Core-adjacent place so it
exists once: `readSidecar(path)`, `writeText(path, text)`, `writeSidecar(path,
store)`, `sidecarPath(docPath)` are currently `StationTable.*`. Extract them to
`scripts/CaveSurvey/Core/CsStationSidecar.js` (global `CsStationSidecar`, `Cs`
prefix mandatory, listed in `CsAll.js` after `CsStationStore.js` and in the
`tests/js_unit.js` file list). These use QFile/QTextStream (GUI engine only), so
they are not unit-tested headlessly; keep their bodies byte-for-byte the same
logic. Both panels call them. Every write RE-READS the file first and passes
unrelated settings through untouched (Station Table's writes already do this
because they keep `side.store.settings`; keep it that way).

## What moves, what stays

Move out of `scripts/CaveSurvey/StationTable/StationTable.js` into
`scripts/CaveSurvey/ExpeditionPlanner/ExpeditionPlanner.js` (rename the
namespace `StationTable.` -> `ExpeditionPlanner.` for everything moved), and
delete from StationTable.js afterwards: `buildPlanPage`, every Plan-tab handler
and helper (`addStop`, `removeStop`, `clearStops`, `paceTyped`, `paceBlock`,
`savePlanSettings`, `showPlanSettings`, `planText`, `planTrip`, `savePacket`,
`resetPlan`, `planGuard` if only the plan uses it, `unitOf` if only the plan
uses it), the Callout code from commit `0853f4d` (including the
`calloutTable(name, headers, minH, maxH)` maximum-height fix that is in the
working tree, uncommitted: keep it), the `planStops/plan/planShown` state, the
Plan and Callout `addTab` lines, and the Plan/Callout refresh hooks. Station
Table keeps the Stations tab and everything it needs. Check every deletion for
other users with grep before removing a shared helper; a helper both panels use
stays where it is, or moves to the shared sidecar module, or is duplicated only
if it is under ~5 lines.

The new panel needs its own state (`ExpeditionPlanner.state`: `drawn`, `docPath`,
`store` (for settings), `planStops`, `plan`, `planShown`, `loadError`) and its own
reload path. `StationTable.readDrawing(doc)` derives `drawn` (survey + resolved)
from the document: reuse it by extracting to the shared place if it is generic,
or call it as `StationTable.readDrawing` only if StationTable.js is always
loaded in the application engine (it is included through the add-on loader, but
do NOT rely on load order: extract or duplicate). How Station Table decides to
reload (document switch and its Refresh button) must be mirrored: read
`StationTable.reload`, `StationTable.init` and `StationTable.prototype.beginEvent`
and copy the mechanism, including the `forceGlobal` wiring and
`EAction.getDocument()` (never `this.getDocument()`), and the tab-engine rules
(build in init, find widgets by objectName, no expandos). Add a Refresh button.

## Tool wiring (the shape that must not deviate)

`ExpeditionPlanner/ExpeditionPlanner.js` and `ExpeditionPlanner.svg` (a new
simple icon in the style of `StationTable.svg` and its dark-mode variant if the
other tools ship one: look at how `LoopErrors-inverse.svg` pairs). `init(basePath)`
with `setRequiresDocument(true)`, `setForceGlobal(true)`,
`setDefaultCommands(["expeditionplanner", "ep"])`, `setGroupSortOrder(451)`, a
`setSortOrder(N)` unique within group 451 (read `tests/test_addon.py` line ~1802
table and every `setSortOrder` under group 451 to pick a free N; prefer 13),
`setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"])`, a status tip a
beginner understands. Confirm `ep` and `expeditionplanner` collide with no other
command alias in the suite or QCAD's own (grep the test table and `CaveSurvey`
tools).

## Registration and docs

- `tests/test_addon.py`: add the tool to the tables at ~1802 and ~2136 (the
  second table is a one-line "what it touches" description; write it honestly:
  reads the survey; writes stations.json settings and trip-plan.html /
  callout-card.html beside the drawing; roster and contacts to per-user
  settings only). Update Station Table's entry if its description mentions the
  plan.
- Handbook: new page `docs/handbook/pages/expedition-planner.html` (use
  `station-table.html`'s markup as the template) and an entry in
  `docs/handbook/index.json` (id `expedition-planner`, class `tool`, stage 451,
  tools `["ExpeditionPlanner"]`, shots `[]`). Move the "Plan" section and the
  "Callout card" section out of `station-table.html` into it, adjusting the
  wording to the new panel (how to add a stop from the dropdown replaces the
  "select a row" text). `station-table.html` keeps a one-line pointer to the
  planner where the plan used to be.
- The spec `docs/superpowers/specs/2026-09-29-callout-card-design.md`: change
  the Panel bullet from "Callout tab in the Station Table dock" to "Callout tab
  of the Expedition Planner dock" and note the planner is its own tool.
- `scripts/CaveSurvey/README.md` (and `docs/` tool lists, if any) mention the
  new tool wherever Station Table is listed.
- VERSION `0.9.184.0` -> `0.9.185.0`.

## Verification (headless)

`tests/js_unit.js` stays green (currently `### UNIT OK 7756 assertions`; adding
`CsStationSidecar.js` to the file list must not change the count unless tests
are added). Syntax suite `tests/js_syntax.js` green. `tests/test_addon.py` green
(find how it is run from `tests/run_all.sh`). Run these through CaveCAD's own
engine as in the plan's Conventions section; the python suite through whatever
`run_all.sh` does. Then `./tools/publish.sh`. No release, no push.

The coordinator (not the implementer) verifies the panel in the running app.
