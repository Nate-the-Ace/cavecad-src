# Station Table, Leads, and Trip Plans

2026-09-28. First item of the CaveCAD all-in-one master ToDo
(`memory/cavecad-master-todo.md`). Started as "a leads system"; reframed
during design into a whole-map station table with leads as one kind, and a
trip planner built on its selection.

## The reframe

A lead is not a record. Surveyors already write "LEAD ..." in a station's
note, and the callout suite already draws that note as a multileader. So
nothing new is entered and no survey format changes. What is missing is
everything *after* the note: a place to see all of them, mark them, and
plan a trip around them.

The same reasoning generalises. Open ends, junctions, controls, loops and
flagged shots are all *derived facts about stations*. One table over every
station, filterable by kind, serves leads and the rest with one engine.

## Slices

1. **Station Table** (this spec, first): rows, kinds, filters, marks, notes,
   sidecar, live links.
2. **Trip Plan** (this spec, second): selection to route, pace, gear list,
   printable packet. Built on slice 1's selection. Not required for slice 1
   to ship.

## Slice 1: Station Table

### Rows

One row per station in the whole map, computed from the survey on open and on
drawing change. Nothing derived is stored.

Columns: station, kind badges, trip(s), survey run, note text, elevation,
status mark, team notes, assignee/objective.

### Kinds (all derived, all filters, combinable)

| Kind | Rule | Engine |
|---|---|---|
| Lead | note matches `\blead\b`, case-insensitive; "leader"/"leads" do not | new |
| Open end | exactly one leg touches it; anchor and fixed stations excluded | `CsFrontier` |
| Junction | three or more legs | `CsNetwork` |
| Control | anchor, fixed station, tie into another survey | `CsModel` |
| Loop station | on a closed loop; row carries closure error | `CsClosure` / Loop Errors |
| Noted | any note at all | survey |
| Flagged | a `CsValidate.check` finding on a shot arriving at the station (missing LRUD, tape/clino disagreement) | `CsValidate` |

A station may carry several badges. Loop rows link into Loop Errors and Flagged
rows into the Survey Notebook page of their trip; the numbers are read from those engines, never
recomputed or copied.

The lead keyword is a per-cave setting with `lead` as the default, so a
team's own vocabulary is a setting change, not code.

### Live links, always

- Row click zooms the drawing to the station; highlights it in 3D if open.
- Loop rows open Loop Errors; Flagged rows open the Survey Notebook page of
  their trip. (First build shows the numbers and the zoom; the deep links
  are follow-ups.)
- Editing a survey note or shot updates the row on next refresh.
- Multi-select highlights the chosen stations on the drawing.

### Working state (the only thing stored)

A sidecar file in the cave folder (e.g. `stations.json`), so Google Drive
carries it to the team. Independent of the drawing: survives Reset Drawing
and redraws, readable with no drawing open.

Per row: status mark, team notes, assignee/objective.

**Key: station + note text.** Decided by the user, over the design's earlier
warning that note text goes stale on a typo fix. Handling: when a stored key
no longer matches, the row appears as *note changed, re-link?* with its marks
kept; the user confirms the re-attachment. Never silent, never dropped.

Status marks (any station kind, not just leads):

- Open (default), Assigned (+ who), Pushed, Done (+ reason: continues, ended,
  tied in, dug out), Skip.

Pushed and Done are only ever set by the user. The table *suggests* them: a
lead with legs beyond it, an open end since tied. A suggestion never changes
a mark.

### Planning extras

- Sort and filter, search box.
- Checklist export of the filtered rows (CSV, printable list), e.g. "all Open
  leads sorted by distance from the entrance".

## Slice 2: Trip Plan

Input: the table's selected rows. Output: an ordered trip plan.

### Directions

Shortest path over the survey graph (`CsNetwork`, `CsTraverse`), legs
weighted by length. Turn-by-turn per leg run: distance, heading, vertical
change, junction cues (which branch), notes met on the way, pitch shots.
Route highlighted on the drawing and in 3D.

Stop order: the visit order that minimises backtracking across several leads.

The survey line is not a walking route. Directions say so, and surface notes
and LRUD tightness on the path. The plan never claims safest or easiest.

### Pace

- Horizontal: hiking pace by default; team pace is a setting. Tight LRUD is
  flagged, not silently timed.
- Vertical: timed per pitch segment (`CsPitch`): a per-rope-length descent
  time, fixed cost per rebelay/deviation/rope change, slower on the way out.
- All numbers editable in a team-pace setting. Outputs: time in, per-lead
  work time, time out, turnaround time.

### Gear list

Derived from the pitches the route crosses:

- **Rope**: one line per pitch, length = total drop + margin (default 10%,
  editable) + rebelay slack, shown as segments ("P 187 ft: 62 + 125, rebelay
  at ledge") so long-rope vs two-rope is visible.
- **Anchors/hardware**: v1 always says "rig not on map, confirm" per pitch;
  reading counts from rigging symbols is a follow-up.
- **Personal kit**: checklist keyed to route type (any vertical: harness,
  descender, ascenders, helmet). Editable template.
- **Team packing list** (chosen over rope-and-anchors-only): a cave-wide
  default list any plan includes (first aid, lights, spare batteries), an
  editable text block in the same sidecar.
- Unknowns stay unknown: the list says "from the survey" and names the gap.

### Packet

The plan prints as one packet: map with the route, directions, time budget,
gear and packing list. Purpose: unguided trips, where the packet is all the
team carries.

**Privacy:** the packet follows `cave-location-privacy`. No coordinates, no
entrance location, no aerial basemap. The Station Table shows elevations
only as the drawing already does. If the packet is ever exported outside the
team, it goes through the sanitized-copy path.

## Build shape

- `Core/CsStationTable.js`: pure row engine and kind rules (node-testable).
- `Core/CsStationStore.js`: sidecar read/write, key match and re-link.
- `Core/CsTripPlan.js` (slice 2): route, pace, gear; pure.
- `StationTable/` panel tool, wired to the fixed add-on shape
  (`qcad-plugin-conventions`); a `Core/CsPanel.js` consumer.
- Handbook page per tool, plus the test that fails on an undocumented tool.
- Tests: `tests/js_unit.js` for the engines; a fixture check on Pitfall Cave
  and Plumbline Pit (pitches, loops, notes).

Check while building: whether the panel belongs under "Panels in sync"
(Symbol Palette / Feature Trace parity). Expected: no.

## Out of scope

- Any new survey field or notebook input.
- Auto-changing a mark.
- Multi-user merge on the sidecar (last write wins; Drive history is the
  fallback). Tracked separately on the master ToDo.
- Live GPS or device tracking during a trip.
- Reading rigging symbols from the drawing (follow-up).
