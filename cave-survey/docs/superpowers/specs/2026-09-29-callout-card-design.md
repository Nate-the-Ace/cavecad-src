# Callout Card

Date: 2026-09-29. First of four expedition-planning tools for basecamp
(order: callout card, multi-objective planner + team splitter, squeeze
filter, what's-left-to-push ranking). Builds on the Station Table and
Trip Plan (`2026-09-28-station-table-design.md`).

## What it is

A self-contained HTML page, `callout-card.html`, written beside the
drawing and printable on two sheets. It is what topside holds while a
team is underground: who is in, when they go in, when to worry, who to
call, what the weather is doing, and where the team is going.

Single-day and multiday trips use one model. A trip is a **schedule of
windows**; a single-day trip is a schedule with one window.

Not in v1: a check-in log, a flood tag system, auto-splitting objectives
across days (tool #2), squeeze-based route filtering (tool #3).

## Privacy (governs everything below)

Cave location privacy is the first rule: never expose entrance locations.

- The card never prints a coordinate. Route labels are station names only.
- The forecast lookup uses a **general location**: the geo anchor rounded
  to 0.1 degree (about 10 km), polled fresh on each Build, never stored,
  never printed. The exact entrance never leaves the machine.
- No anchor on the drawing: a typed place name is used instead (geocoded
  by the weather service). The panel offers the place override always.
- Roster and contacts are personal data. They are stored **locally per
  user only** (never in `stations.json`, never in the Drive-synced cave
  folder). They leave the machine only in the printed/saved card, and the
  roster block has an "include roster" tick for a copy that leaves your
  hands.

## Data

| Data | Where | Synced |
|---|---|---|
| Schedule (start date, days, entry time, work hours, night = camp/out) | `stations.json` beside the drawing | yes (Drive) |
| Weather place override | `stations.json` | yes |
| Roster: name, role, squeeze limit, medical notes, emergency contact | per-user QCAD settings (`RSettings`), one JSON string under `CaveSurvey/Callout/Roster` | no |
| Contacts: topside name + phone, escalation line, callout buffer default | per-user QCAD settings, `CaveSurvey/Callout/Contacts` | no |
| Forecast | never stored; fetched per Build | n/a |

Squeeze limit is a number (inches of passage height) or empty. Tool #3
will read the same field.

## Components

- **`Core/CsCalloutCard.js`** (pure ES5, no network, no document, no GUI).
  `CsCalloutCard.windows(plan, schedule, contacts)` computes the schedule
  rows. `CsCalloutCard.html(plan, ctx)` returns the full HTML string. Uses
  `CsTripPlan.routeSvg`, `describe`, `esc`, and `clock`. Include with the
  mandatory `Cs` prefix.
- **`Core/CsWeather.js`** (panel-side helper, network). Builds the request
  from a rounded coordinate or a place name and returns a plain object
  `{days: [{date, high, low, rainTotal, rainChance}], source, placeLabel}`
  or `null`. 5 s timeout. Kept out of `CsCalloutCard` so the card engine
  stays pure and testable offline. Service: Open-Meteo (no key).
- **Panel:** a Callout tab of the Expedition Planner dock, beside its Trip
  tab.
  *(2026-09-29, 0.9.188.0: the Trip and Callout tabs were merged into one
  scrolling page in the card's order -- Trip, Roster, Schedule, Escalation,
  Route, Card -- and Build card refuses until every required item is filled
  in, naming all gaps at once via `CsCalloutCard.missingAll`.)* The planner is its own tool (`epl`), not a tab of Station Table: see
  `docs/superpowers/plans/2026-09-29-expedition-planner-panel.md`. Schedule editor, roster editor, contacts, weather place,
  "include roster" tick, Build card. Writes `callout-card.html` beside the
  drawing and opens it. Follows the tab-engine rules (build in init, find by
  objectName, no expandos).

## Schedule arithmetic

The plan is one route with totals `minutesIn`, `minutesWork`, `minutesOut`.
Each day of the schedule has an entry time (24 h clock), work hours, and a
night: `out` (the team exits that day) or `camp` (the team stays
underground). The last day is always treated as `out`.

A day **starts from the surface** if it is the first day or the previous
night was `out`; then its inbound time (`minutesIn`) is added. A day
**ends on the surface** if its night is `out` or it is the last day.

Per day:
- `turnaround = entry + (starts from surface ? minutesIn : 0) + work hours`.
  This is the time the team must turn around at the objective.
- If the day ends on the surface: `expectedOut = turnaround + minutesOut`
  and `callout = expectedOut + buffer`. Topside starts acting at callout.
- If the night is `camp`: the row shows the turnaround and "camp night, no
  callout until day N". Underground camp-to-camp moves are not modelled in
  v1; the single route's in/out times are used at the ends only.

Times carry an absolute day offset from the start date, so a window that
crosses midnight advances the date. A day whose expected out falls after the
next day's entry gets a warning on the card; the card still builds.

## Card layout

**Page 1, callout sheet:**
1. Header: cave name (no location), dates, team.
2. Roster, directly under the header, above the fold: name, role, squeeze
   limit, medical notes, emergency contact. Omitted, with a note, when
   "include roster" is off.
3. Schedule table: entry, turnaround, callout per window, camp rows.
4. Escalation box, large type: topside contact and phone, buffer, "if no
   word by X, call Y".
5. Forecast strip, one cell per trip day (high/low, rain total, rain
   chance). If a day's rain is over the threshold and the route passes a
   station whose note matches water words (flood, sump, water, wet, creek,
   stream), a bold line reads "Rain forecast + water noted on route".
   Wording is "check", never "safe".

**Page 2, the route** (print stylesheet page break, own page):
1. Route SVG, full width.
2. Turn-by-turn directions from `CsTripPlan.describe`, with per-leg time.
3. Hazard notes on the route, by station name: station notes on the way
   that match the water words above or hazard words (hazard, danger, loose,
   unstable, rockfall, bad air, co2, slippery, exposed).
4. Pitch and rope list for the route.

Page 1 alone goes to topside. Page 2 alone goes with the team.

## Hazards

There is no flood tag in the suite. The plan carries survey station notes,
not drawing callouts, so drawn `NOTES-HAZARD` callouts are not visible to
it. v1 uses keyword matching over the station notes on the route, the same
approach as leads. The card never states a route is safe.

## Errors

- Missing schedule field: Build is disabled and names the field.
- Forecast fails or times out: the card builds with a "no forecast, check
  before you go" box.
- Roster or contacts unreadable or empty: the card builds with a "roster not
  filled in" / "contacts not filled in" line.
- No route found: page 1 builds without page 2 and says so.
- Work hours overrun the next window: card warning, build continues.

## Testing

Engine (runs through CaveCAD's own engine, per the `js_unit` trap in the
station-table notes):
- Window arithmetic: single day, multiday with camp, midnight crossover,
  overrun warning.
- Keyword hazard match (water words set the rain flag, hazard words do not).
- HTML escaping of roster and contact text.
- Page 1 contains no route SVG; page 2 contains it.
- **Privacy:** with a fixture anchor, card output must not contain the
  anchor coordinate or the unrounded lat/lon in any form; the forecast
  request builder must emit only the rounded value.
- Forecast null path and roster-absent path both build.

Panel: live-tested on a **copy** of the drawing (the panel writes beside
the open drawing), with the MCP bridge.

## Risks to check first

1. **Network from the script engine.** Resolved: `CsSurfaceData.fetch`
   already downloads with a blocking `curl` through `QProcess` (the async
   `QNetworkAccessManager` path is untested in this bridge). `CsWeather`
   uses the same pattern with its own 5 s timeout and never touches the
   shared `CsSurfaceData.TIMEOUT_S`.
2. **Per-user settings storage.** Confirm `RSettings` round-trips a JSON
   string on the deployed CaveCAD (see the QCAD JS bridge traps note:
   method-vs-property failures are GUI-only).
3. **Save hook is inert:** nothing here relies on a save hook; state is
   written explicitly by the panel.
