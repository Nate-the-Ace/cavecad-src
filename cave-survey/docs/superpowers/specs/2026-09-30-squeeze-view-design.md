# Squeeze view for the Expedition Planner

Date: 2026-09-30. Tool #3 of the expedition-planning list. Nathan approved the
shape (2026-09-29): "a view that shows [who fits where]: pick a person and see
which stops they can't reach, or pick a stop and see who can go." The engine
already exists (`CsTripPlan.routeTightestAt`, `CsTeamSplit`); this spec adds the
display and closes a gap found while building Suggest split: **manual teams get
no squeeze check at all** (only the Suggest popup checks fit).

Rules carried over: a recorded width of 0 or less is UNMEASURED, never a
squeeze; an unknown limit or unknown width never blocks and is shown as
unknown; nothing here writes personal data anywhere new; a widget is verified
live, never built in a headless test; dock-build rule; no `deleteLater`; no
`screencapture`.

## Engine: `Core/CsSqueeze.js` (pure, unit-tested)

`Cs` prefix, global `CsSqueeze`, in `CsAll.js` after `CsTeamSplit.js` and in the
`tests/js_unit.js` file list.

- `CsSqueeze.forStop(survey, resolved, station, opts)` -> `{station, reachable,
  inches (number|null), near (station|null)}`: the narrowest known passage width
  on the route from the start to that stop and back (`CsTripPlan.build` with the
  single stop, then `routeTightestAt`), `inches` null when no width is known
  anywhere on the route, `reachable` false when the stop is not on the surveyed
  line. `opts` = `{start, unit, config}` as the other planner calls. Cache per
  station within one `matrix` call.
- `CsSqueeze.forTeam(survey, resolved, stops, opts)` -> the same shape for the
  team's whole route (all stops planned together), `station` = "team".
- `CsSqueeze.fit(limitInches, inches)` -> `"fits"` (both known and limit <=
  inches... precisely: fits when `inches >= limit`), `"no"` (both known and
  `inches < limit`), or `"unknown"` (limit missing/0 or width unknown).
- `CsSqueeze.matrix(survey, resolved, stops, people, directory, opts)` ->
  `{stops: [ {station, reachable, inches, near} ], people: [ {id, name,
  limit (number|null)} ], cells: [ [ "fits"|"no"|"unknown"|"unreachable" ] ] }`
  with `cells[stopIndex][personIndex]`; limit comes from the directory by id,
  else trimmed case-insensitive name; a person with no details has limit null
  ("unknown"); `unreachable` when the stop is not reachable. Never throws;
  empty inputs give empty arrays.
- `CsSqueeze.teamIssues(team, teamRoute, directory)` -> `[ {person, limit,
  inches, near, text} ]` for every member of the team whose `fit` is `"no"`
  against the team's route (`forTeam`), text exactly like the Suggest engine's
  squeeze warning without the team prefix: `Ana Ruiz (limit 12 in) may not fit
  the tightest passage on the route (10 in near A6).` (inches rounded to 1
  decimal, as `CsTeamSplit` does; reuse its formatting helper if one exists, or
  extract it so both use ONE implementation). Also `teamNotes(...)` -> a note
  string when the team has stops but no known width ("passage widths on the route
  are unknown, squeeze limits not checked").

## Panel

- A new collapsible section **"Who fits where"** (chevron fold section, same
  helper as the team sections) between **Teams** and **Escalation**, folded by
  default. Body: a one-line explanation, a read-only matrix `QTableWidget`
  (objectName `ExpeditionPlannerFitTable`): first column Stop, second column
  "Tightest passage" (`10 in near A6`, `not measured`, or `not on the surveyed
  line`), then one column per person going (header = the person's name and limit,
  `Ana Ruiz (14 in)`, or `(no limit)`); cells `fits`, `NO`, `?`, `-` (unreachable)
  with foreground colours: `NO` red, `fits` normal, `?` and `-` grey. A stop
  picker (editable QComboBox, same pattern as the team stop picker) + `Add stop`
  to add extra stops to the matrix, `Refresh`, and a status line. Rows = every
  stop on any team (in team order, deduped) plus the extra stops. The matrix
  rebuilds when: the section is opened, Refresh is pressed, the party changes, a
  team's stops change, or the drawing changes (build it lazily and only when the
  section is expanded, so a closed section costs nothing).
- **Team warnings:** each team section gets a status line (`ExpeditionPlannerTeam<n>_Squeeze`,
  hidden when empty) listing `teamIssues` for that team (red) and the `teamNotes`
  note (grey); the team header already shows a red mark for same-day overlaps:
  add the same red mark and the words `squeeze` in the header summary when a
  member won't fit. Recomputed when the team's members, stops or the party change.
- **Build:** the status line appends the squeeze warnings per team (like the
  same-day warnings; the build still succeeds). The topside sheet (`topsideHtml`)
  prints each team's squeeze warnings under its roster block; the team file
  (`teamHtml`) prints them under its members table; a team with unknown widths
  prints the grey note. Escaped; hidden when there is nothing to say. Single-team
  cards (`html`) gain the same warning block under the roster ONLY when there is
  at least one warning, so single-team output stays byte-identical when there is
  none.
- Pure helpers (fake-testable): `ExpeditionPlanner.fitRows(state, party, extraStops)`
  (engine call and row/column structure), `ExpeditionPlanner.fitCellText(cell)`,
  `ExpeditionPlanner.fitHeaderText(person)`, `ExpeditionPlanner.teamSqueeze(team)`
  (issues + note for a team from state).

## Docs

Handbook `expedition-planner.html`: a "Who fits where" section (the matrix, what
fits / NO / ? / - mean, that a width of 0 counts as unmeasured, extra stops,
the team warning lines, and the honest limits: it uses the survey's recorded
LRUD only, an unmeasured passage is never called a squeeze, people with no saved
squeeze limit show ?). VERSION 0.9.199.0 -> 0.9.200.0.

## Tests

Engine (headless): reuse the `ssSurvey()` fixture from the Suggest split tests
(a 10 in north branch, east corridor with no widths, west pitch, an unreachable
island): `forStop` for each; `forTeam` over several stops (tightest wins);
`fit` all branches incl. equal width (10 vs 10 fits) and limit 0/null; `matrix`
shape and values with a small directory (id match, name match, unknown person),
unreachable stop, empty inputs, no throw; `teamIssues` text and inches rounding;
`teamNotes`; ONE shared formatting implementation with `CsTeamSplit` (a test
that the two produce the same sentence for the same input). Rendering: topside
and team-file squeeze blocks present when warnings exist, absent otherwise,
escaped; single-team `html` byte-identical when no warnings (the existing
parity tests must pass untouched). Panel (fake Qt only, NEVER real widgets in
headless tests): `fitRows`, cell and header text, `teamSqueeze`, the Build
status line text, lazy build (closed section never calls the engine), refresh
after a team stop change. Live (coordinator, scratch copy): the section opens,
the matrix fills for the Pitfall fixture people, a red NO where a limit is under
a passage, team warning line and header mark appear/clear as members change,
Build cards prints the warnings on both sheets, no new crash report.

## Out of scope

Editing squeeze limits here (edit the person), per-station (non-stop) queries,
suggesting a fix, a 3D or map overlay, and lead ranking (tool #4).
