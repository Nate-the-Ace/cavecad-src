# What's left to push (lead ranking) for the Expedition Planner

Date: 2026-09-30. Tool #4 of the expedition-planning list. Nathan's decisions,
quotable: **C, a balanced score with presets**, "go ahead with all of it";
done and skipped leads stay out by default (a tick includes them). The reasons
matter as much as the order: every row shows WHY it ranks where it does, in
plain words. A signal that cannot be computed is left out, never guessed.

Builds on: `Core/CsStationTable.js` (`rows`: station, kinds, trips, notes,
z, status via `CsStationStore.reconcile`, `effectiveStatus`),
`Core/CsFrontier.js` (open ends, degrees, `isLeg`, `clean`), `Core/CsTripPlan.js`
(`build`, `graph`, `shortest`, cost model incl. pitches and rope), the resolved
station positions (`resolved.stations[name] = {x, y, z}`), and the Expedition
Planner team data layer (`addTeamStop`). Privacy and process rules unchanged:
station names only, no coordinates in any text; no real widgets in headless
tests; dock-build rule (no `child()`/`ensureDock` reach inside `build*`); no
`deleteLater`; no `screencapture`; widgets are verified live.

## What is ranked

Every LEAD in the drawing: a station whose row has the kind `lead` (a note
matching the lead keyword) or `openEnd`. A lead's status is its Station Table
mark (`open` for an unmarked lead, `assigned`, `pushed`, `done`, `skip`).
`done` and `skip` leads are hidden unless `includeDone` is on; `assigned` and
`pushed` stay visible with their status shown.

## Engine: `Core/CsPushRank.js` (pure, deterministic, unit-tested)

`Cs` prefix, global `CsPushRank`, in `CsAll.js` and the tests file list. No GUI,
no file I/O, no randomness, no clock reads inside (the caller passes `today`).

`CsPushRank.rank(input)`, `input = { survey, resolved, rows, statuses, keyword,
weights, preset, includeDone, positive, negative, today, unit, config, start }`:
`rows` = `CsStationTable.rows(...)` output already merged with statuses (or
`statuses` = `{station: status}` and the engine applies `effectiveStatus`);
`weights` overrides the preset; `today` = "yyyy-mm-dd" (defaults to none: the
recency signal then uses trip order only); `positive`/`negative` = arrays of
lower-case hint words (defaults below). Output:
`{ leads: [ {station, status, kinds, total, minutes, signals: {cost, blank,
connect, elevation, recency, hints}, reasons: [text] } ], notes: [text] }`
where each signal is `null` (not computable) or `{score (0-100), text}`.

### Signals (each 0-100, with a reason text in plain words)

1. **cost.** Plan the single stop with `CsTripPlan.build` (walk in, work, walk
   out, pitch time; cache per station). `score` = 100 at total minutes <= 15,
   falling linearly to 0 at >= 240; minus 15 (floor 0) when the route has a pitch.
   Text: `"<in> min in, no pitch, no rope"` / `"... 1 pitch, 42 ft of rope"`
   (rope length from the plan's gear/`rope` lines when available, else omit the
   rope clause). Unreachable lead: cost null, and the lead gets a note
   ("X2 is not on the surveyed line") and is listed last.
2. **blank** ("blank ground ahead"). Needs the lead's arriving leg bearing from
   the resolved plan positions (x, y); null when the arriving leg is plumb
   (a pitch has no bearing), the lead has no arriving leg, or positions are
   missing. Cast a ray in PLAN from the lead along that bearing (max 500 ft
   in the survey's unit converted); the ray hits the first surveyed leg segment
   (excluding legs within 3 graph hops of the lead) within a corridor of 30 ft
   either side. `blankFt` = distance to the hit, or 500 when none. Score =
   `min(100, blankFt / 300 * 100)`. Text: `"nothing surveyed for 340 ft ahead"`
   (`"more than 500 ft"` when no hit). When a hit exists at <= 150 ft the
   blank score is capped by `connect` semantics below (blank score = 0 when the
   hit is within 60 ft: it is a connection, not blank ground).
3. **connect** ("connection potential"). From the same ray: when it hits a leg
   within 150 ft AND the hit station is far along the passage graph from the lead
   (graph distance >= 3 x the straight distance, so it would close a loop or link
   passages, not just parallel itself), `score = 100 - (hitFt / 150) * 60`
   (100 at touching, 40 at 150 ft); null otherwise. Text: `"points at B12, 60 ft
   away (240 ft by the surveyed way)"`.
4. **elevation** ("elevation edge"). From `z` of the lead and all stations that
   have z: `range = max - min`; null when the lead has no z or `range < 20 ft`.
   `edge` = `abs(z - mid) / (range / 2)` with `mid` the midpoint; `score = 100 *
   edge`. Text: `"12 ft above the highest surveyed station"` /
   `"at the deepest surveyed level"` / `"near the middle elevation"` (the words
   chosen by which end it is nearer to, with the distance from that end).
5. **recency** ("time since visited"). The lead's last survey trip: use the
   survey's trip record (find how the survey stores a trip's date, e.g.
   `survey.trips[i].date`; read Core/CsModel.js and CsStationTable.tripsByStation)
   to get its date; `months = whole months between the trip date and
   input.today`; `score = min(100, months / 24 * 100)`. Text: `"last surveyed
   2025-03, 19 months ago"`. When trips have no dates or `today` is missing, rank
   by trip ORDER: the oldest trip scores 100 and the newest 0 (linear over the
   trip indexes), text `"surveyed on the oldest trip (trip 1 of 4)"`; null when
   the lead has no trips or there is only one trip.
6. **hints.** Search the lead's note text (`noteText`, incl. team notes when
   provided) case-insensitively for whole words. Defaults `positive` = draft,
   wind, airflow, breeze, going, continues, big, borehole, booming, echo,
   `negative` = tight, ended, choked, sump, pinches, blocked, dead. Score = 50
   plus 25 per DISTINCT positive word minus 25 per DISTINCT negative word,
   clamped 0-100; null when no word matched. Text: `"note says: draft, going"` /
   `"note says: too tight"` (list the matched words).

### Presets and total

Weights (sum need not be 1, they are normalised over the signals AVAILABLE for
each lead): `quick` = cost .50, blank .10, connect .10, elevation .05, recency
.10, hints .15; `potential` = cost .10, blank .25, connect .25, elevation .15,
recency .10, hints .15; `balanced` (default) = cost .25, blank .20, connect .15,
elevation .10, recency .15, hints .15. `input.weights` (partial ok) overrides.
`total = sum(w_i * score_i) / sum(w_i)` over non-null signals, rounded to
1 decimal; a lead with no computable signal gets total 0 and a note.
`reasons` = the signal texts ordered by weighted contribution (highest first),
at most the four strongest plus, always, the cost text. Sort leads by total
descending, ties by natural station order. Never throws on degenerate input
(empty survey, no leads, no positions, no trips).

## Panel: "What's left to push" in the Expedition Planner

A new collapsible chevron section between **Who fits where** and **Escalation**,
folded by default, lazily filled (a folded section never runs the engine):

- Controls: three preset buttons `Quick wins`, `Big potential`, `Balanced`
  (the active one is marked), six small spin boxes 0-100 for the weights (they
  show the active preset's values; editing one switches the preset label to
  "Custom"), two single-line text fields for the positive and negative hint words
  (comma separated, prefilled with the defaults), a `Show done and skipped`
  checkbox, `Refresh`.
- Table `ExpeditionPlannerPushTable` (read-only): Rank, Station, Score, Status,
  Why (reasons joined with " · "). Row selection is single. Below it: a team
  dropdown (non-editable QComboBox listing "Team 1" ... , `ExpeditionPlannerPushTeam`)
  and `Add selected to team` (`ExpeditionPlannerPushAdd`), which calls the existing
  `addTeamStop(teamId, station)` and reports in the status line (`ExpeditionPlannerPushStatus`)
  ("B20 added to Team 2" / the data layer's refusal, e.g. not on the surveyed
  line, or already there).
- Settings live in session state only (not saved); preset default Balanced.
- The section refills when opened, on Refresh, on a preset/weight/hint/tick change
  while open, and when the drawing changes while open.
- Pure, fake-testable helpers: `pushInput(state, controls)`, `pushRowText(lead)`,
  `pushWeightsFor(preset)`, `parseHintWords(text)`, and `addLeadToTeam(station,
  teamIndex)`.

## Docs

Handbook `expedition-planner.html`: a "What's left to push" section: what counts
as a lead, the six signals and their meaning, the presets, the weights, hint
words, how done/skipped are handled, "Add selected to team", and honest limits:
it estimates from the survey and the notes; the direction signals need a
surveyed heading and are left out for pitches and unsurveyed positions; it does
not know what is actually beyond the survey. VERSION 0.9.201.0 -> 0.9.202.0.

## Tests

Engine (pure): a hand-built fixture survey with resolved positions where the
expected scores are computable by hand: cost (short/long, with and without a
pitch, unreachable), blank (clear ahead 500 ft, hit at 340 ft, the plumb lead
gives null), connect (hit within 150 ft on a far-along passage scores by the
formula; hit on the lead's own passage is not a connection; hit within 60 ft
zeroes blank), elevation (highest, lowest, middle, range < 20 ft null, no z
null), recency (dated trips with `today`, undated trips by order, single trip
null), hints (positive, negative, mixed, none -> null, whole words only:
"tightly" is not "tight"), presets and weight override and normalisation over
available signals, sorting and ties, `includeDone`, status filtering,
determinism (JSON.stringify twice equal), degenerate inputs (no throw), reasons
ordering and the always-included cost text, no coordinates in any text.
Panel (fake Qt only): `pushWeightsFor`, `parseHintWords`, `pushInput` mapping,
`pushRowText`, lazy fill (folded never calls the engine; open calls once;
refresh again), preset switch marks Custom on a weight edit, Add selected calls
`addTeamStop` with the right team id and reports the result, the dock-build
guard still green for the new builder. Live (coordinator, scratch copy): the
section opens, the table fills for the Pitfall test cave, presets reorder it,
reasons read sensibly, a done lead is hidden until ticked, Add selected puts the
stop on a team, no crash report on quit.

## Out of scope

Editing lead notes or statuses here (Station Table does that), saving weights or
hint words, multi-lead route optimisation (Suggest split does), a map overlay,
learning from past trips, and any use of GPS or the entrance location.
