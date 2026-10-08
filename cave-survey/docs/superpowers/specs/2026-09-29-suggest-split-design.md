# Suggest split for the Expedition Planner teams

Date: 2026-09-29. Stage 2 of "multiple teams" (stage 1, the manual teams,
shipped as 0.9.198.0: `2026-09-29-multiple-teams-design.md`). Nathan's
decisions, all quotable:

- **Scope: A. Stops AND people both**: it proposes which people go on each team
  and which stops each team takes, with **locks**: anything he has assigned by
  hand starts locked and the suggestion fills in around it.
- **Popup with a preview (A)**: a "Suggest split" popup shows the proposal
  without changing anything; **Apply** writes it into the team sections;
  **Undo suggestion** restores exactly what was there before.
- **Rules (all six, "go with your suggestion"):** HARD LIMITS: (1) a team whose
  route has a pitch needs a Vertical-skilled member; (2) every member must fit
  the tightest passage on their team's route (squeeze limit vs passage width).
  PREFERENCES (warn, never block): (3) each team has someone with First aid,
  CPR or Wilderness first responder; (4) each team has a Trip leader; (5)
  balance each team's estimated total time and keep nearby stops together;
  (6) warn when a team's required work time exceeds its scheduled work hours.
- "Please proceed unattended ... get to something I can test myself."

Builds on: `Core/CsTeams.js`, the panel data layer in
`ExpeditionPlanner/ExpeditionPlanner.js` (`state.teams`, `addTeam`,
`setTeamMember`, `addTeamStop`, `saveTeams`, ...), `Core/CsPeople.js` (skills,
squeeze), `Core/CsTripPlan.js` (`graph`, `shortest`, `order`, `build`,
`tightWarnings`), `Core/CsPitch.js`. Privacy rules unchanged: nothing here writes
personal data anywhere new; a team stores names and ids only.

## Engine: `Core/CsTeamSplit.js` (pure, unit-tested)

`Cs` prefix, global `CsTeamSplit`, in `CsAll.js` after `CsTeams.js` and in the
`tests/js_unit.js` file list. No GUI, no file I/O, no randomness (same input ->
same output).

### Input

`CsTeamSplit.suggest(input)` with:

```
{ teamCount,                     // 1..8, >= number of current teams
  teams: [ current teams (CsTeams shape: id,name,goal,dayOffset,members,stops,days,packing) ],
  freeStops: [ "B20", ... ],     // stops to distribute (not locked)
  lockedStops: [ {station, team: index} ],   // stay on that team
  freePeople: [ {id, name} ],    // people to place
  lockedPeople: [ {id, name, team: index} ],
  directory: [ CsPeople people ],// skills + squeeze by id, else by name; unknown -> no skills, no limit
  survey, resolved, unit, config, // CsTripPlan inputs
  start }                         // start station, default the survey's first
```

Locks are decided by the caller (the popup): a stop or person currently on a
team is locked to that team unless the user frees it. `teamCount` above the
current count adds new teams named "Team N" whose schedule is a copy of the last
team's (`CsTeams.copyOf`).

### Output

`{ feasible, teams: [ {index, name, members: [{id,name}], stops: [ordered],
minutes: {in, work, out, total}, needsVertical, tightestInches (number|null),
warnings: [ {kind, hard, text} ] } ], notes: [strings] }`.

- `feasible` is false when any HARD warning exists. Apply is still allowed; the
  preview shows hard warnings in red.
- Warning kinds: `vertical` (hard), `squeeze` (hard, one per person and team),
  `first-aid`, `leader`, `balance`, `schedule` (preferences). Texts are plain
  sentences that name the team and person, for example
  "Team 2: the route has a pitch and nobody on the team has the Vertical skill."
  and "Team 1: Ana Ruiz (limit 12 in) may not fit the tightest passage on the
  route (10 in near A6)."
- Unknown passage width on a route is NOT a violation: it produces a note
  ("Team 1: passage widths on the route are unknown, squeeze limits not checked").

### Algorithm

1. **Time model.** A team's time is `CsTripPlan.build(survey, resolved,
   {start, targets: stops, unit, config})`'s `totals` (walk in, work at stops,
   walk out, pitch time). Cache builds by the sorted stop set (results are pure).
2. **Stops.** Locked stops go to their team. Free stops are seeded greedily in
   descending order of distance from the start: each goes to the team whose
   total time grows least (ties: fewest stops, then lowest index). Then improve
   deterministically: repeatedly try moving one free stop to another team and
   swapping two free stops between teams, in stable index order, accepting a
   change only when the largest team total decreases (ties broken by a smaller
   sum of squares); stop when a full pass changes nothing (cap 200 passes).
3. **Route facts per team** (after stops are fixed): `needsVertical` = the team's
   planned route contains a pitch (`plan.pitches.length > 0`); `tightestInches` =
   the narrowest passage width on the route in inches, from LRUD (add a pure
   helper `CsTripPlan.routeTightness(survey, plan)` returning inches or null,
   reusing the same width rule `tightWarnings` uses, in the survey's unit
   converted to inches; null when no width is known).
4. **People.** Locked people go to their team. Free people are placed to
   satisfy, in this priority order: (a) a team that needsVertical and has no
   Vertical-skilled member gets one (scarcest first: fewest Vertical people
   first); (b) squeeze: a person may not be placed on a team whose
   `tightestInches` is below their limit (unknown limit or unknown width never
   blocks); (c) each team gets a First-aid/CPR/WFR person, then a Trip leader,
   when available; (d) remaining people fill teams so sizes differ by at most
   one, preferring the team with the fewest members. Placement is greedy in a
   stable order (people sorted by scarcity of skills, then name), teams in index
   order.
5. **Warnings.** After placement compute every warning for every team from the
   final state (including locked members): vertical, squeeze, first-aid, leader,
   balance (a team's total is more than 30% above or below the mean of teams
   that have stops, only reported when there are 2+ teams with stops), schedule
   (required work minutes = stops x the config's per-stop work minutes plus any
   pitch rigging the plan reports, versus the team's scheduled work hours x 60
   summed over its days; warn when required > scheduled and days exist).
6. **Degenerate inputs never throw:** no free stops -> stops unchanged, people
   still placed; no free people -> stops still split; fewer people than teams ->
   teams left empty are reported ("Team 3 has nobody"); a stop that is not
   reachable from the start is reported in `notes` and left out.

## Panel: `ExpeditionPlanner`

- A **`Suggest split...`** button (objectName `ExpeditionPlannerSuggest`) next
  to `Add team` / `Remove team`, and an **`Undo suggestion`** button
  (`ExpeditionPlannerSuggestUndo`, disabled until a suggestion has been applied
  and cleared by the next manual team edit or drawing change).
- The popup is a QDialog like the person popup (objectName
  `ExpeditionPlannerSuggestDialog`, title "Suggest split"): a team-count spin
  box (min = current team count, max 8), an **Objectives** table (Lock tick,
  Stop, Currently: team name or "free") plus the station picker to add extra
  stops, a **People** table (Lock tick, Person, Skills summary, Squeeze,
  Currently) listing everyone ticked Going, a `Free everything` button
  (unticks all locks), a **Suggest** button, a read-only **preview** area, and
  **Apply** and **Close** buttons. Lock ticks default to on when the item is on a
  team now and off when it is free; free items are exactly what gets
  distributed. Preview text per team: name, members, stops in route order, "in
  X, work Y, out Z, total T", and its warnings (hard ones in red with a leading
  "!"), then any notes. Apply is enabled only after a proposal exists.
- **Apply** snapshots the current teams (`state.suggestUndo`, deep copy), writes
  the proposal into the team sections through the existing data layer (new teams
  created with `CsTeams.copyOf(last, "Team N")`; members and stops set per
  team, stops in the proposed route order), saves, rebuilds the sections, and
  enables Undo. **Undo suggestion** restores the snapshot exactly (including
  removing teams the suggestion added), saves, rebuilds.
- Pure helpers, unit-testable with fakes: `ExpeditionPlanner.suggestInput(...)`
  (build the engine input from state and the popup's tick states),
  `ExpeditionPlanner.suggestPreviewText(result)`,
  `ExpeditionPlanner.applySuggestion(result)` (returns the snapshot),
  `ExpeditionPlanner.undoSuggestion()`.
- Rules from the earlier stages still hold: dock-build rule (no `child()` /
  `ensureDock` reach inside build functions; the popup is built on click, after
  the dock exists), no real widgets in headless tests (fake-Qt objects only),
  every popup widget has an objectName, hide and rename instead of deleting.

## Docs

Handbook `expedition-planner.html`: a "Suggest split" section (what it decides,
the locks, the six rules and which are hard, the preview, Apply, Undo, and the
honest limits: it estimates from the survey, unknown passage widths are not
checked, it cannot know who gets along or who drives). VERSION 0.9.198.0 ->
0.9.199.0.

## Tests

Engine (headless, pure): a small hand-built survey (reuse `tpSurvey`/
`tpResolved` and, where a pitch or LRUD widths are needed, purpose-built
fixtures) covering: two teams balanced (the seeded split and the improved split
give a lower maximum than the naive one); locked stops and locked people never
move; hard vertical (a pitch route with and without a Vertical member; the
scarce Vertical person goes to the pitch team); squeeze (a 10 in passage, a
12 in person kept off, an unknown limit allowed, unknown width -> note, not
violation); first aid and leader placement and their warnings; balance and
schedule warnings; team count above the current count adds "Team N"; fewer
people than teams; unreachable stop; determinism (same input twice gives an
identical result); no free stops; no free people; `feasible` false with a hard
warning; `CsTripPlan.routeTightness`. Panel logic with fake Qt: input builder
lock defaults, preview text, apply then undo restores exactly (including added
teams), apply/undo save calls, dock-build guard still green. Live (coordinator,
scratch copy only): popup opens, tables fill, Suggest produces a preview,
Apply writes the teams and files build, Undo restores, a hard warning shows red.

## Out of scope

Learning from past trips, preferences like who gets along, vehicles or driving,
multiple entrances/start stations, optimising across days, automatically
changing team schedules, and re-running the suggestion continuously as you edit.
