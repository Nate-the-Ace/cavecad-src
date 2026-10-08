# Multiple teams for the Expedition Planner

Date: 2026-09-29. Tool #2 of the expedition-planning list (after the callout
card, tool #1). Nathan's request: "support multiple teams for different
objectives."

Decisions made in the brainstorm (all Nathan's, quotable):

- **Split: manual first, then suggest.** Stage 1 (this spec) is fully manual:
  he creates teams, picks who is on each, assigns stops. Stage 2 (a later
  spec) adds a "Suggest split" button that proposes a split (balanced route
  time; hard limits such as a vertical stop needing a vertical-trained member;
  warns when a team has nobody first-aid trained) on the SAME data model, which
  he can then edit. Stage 2 is out of scope here.
- **Each team has its own schedule** (own days: entry, work hours, night out or
  camp) and its own packing list. Pace, start date, forecast place, escalation
  contacts and the people directory stay trip-level.
- **A person may be on several teams on different days; warn, never block, when
  the same person is on two teams on the same calendar day.**
- **Output is separate files:** one topside sheet plus one file per team.
- **One scrolling panel, no tabs**, teams as stacked collapsible sections
  (his earlier rule: "too easy to not enter important information").
- **Single-team trips are unchanged**: exactly today's card, no team files.

Builds on the callout card, people directory and intersection directions
(`2026-09-29-callout-card-design.md`, `2026-09-29-people-directory.md`,
`2026-09-29-expedition-planner-panel.md`). Privacy rules carry over: no
coordinates in any file; personal data (medical, emergency contacts) stays on
this computer except in the files Nathan builds and prints.

## Data model

In `stations.json` `settings.trip` (extend `CsStationStore.cleanTrip`):

```json
{ "startDate": "2026-10-03", "weatherPlace": "Nashville, TN",
  "party": [ {"id": "...", "name": "Ana Ruiz"} ],
  "days": [ ... ],          // LEGACY single-team schedule, read for migration only
  "teams": [
    { "id": "<uuid v4>", "name": "Team 1", "goal": "Survey B passage",
      "dayOffset": 0,
      "members": [ {"id": "...", "name": "Ana Ruiz"} ],
      "stops": ["B20", "D8"],
      "days": [ {"entry": "08:00", "workHours": 5, "night": "out"} ],
      "packing": "First aid kit\nSpare batteries" } ] }
```

- `party` stays the trip-wide "Going" list (ticks in the people directory).
  A team's `members` are picked from the party. A member no longer in the party
  is kept but flagged ("no longer going") in the panel and the sheet.
- `id`: `CsUuid.v4()`, assigned once, stable across renames.
- `dayOffset`: whole days after the trip start date on which the team's day 1
  falls (0 = the start date). Team day i falls on start date + offset + i.
- `stops`: station names, persisted (fixing today's gap: stops are lost between
  sessions).
- Validation (`cleanTrip`): teams without a name get "Team N"; days cleaned
  exactly like today's trip days; `dayOffset` a non-negative integer (bad ->
  0); stops trimmed, blanks and duplicates dropped, order kept; members need a
  name, ids optional; at most 8 teams (extras dropped, and the panel says so).
  Unknown fields are dropped so personal data can never ride into the file
  (medical and contact fields must never appear in `teams`).
- **Migration:** a trip with no `teams` and a non-empty legacy `days` becomes
  one team named "Team 1" holding those days, `party` as members, and
  `settings.packing` as its packing list, on first load. `settings.packing` is
  then no longer read; new teams start with an empty packing list. A trip with
  no `teams` and no days gets one empty "Team 1" so the panel always shows a
  team.
- Single-team trips: `teams.length === 1` builds today's single card exactly.

## Engine (pure, unit-tested): `Core/CsTeams.js`

`Cs` prefix, global `CsTeams`, in `CsAll.js` after `CsCalloutCard.js` and in
the `tests/js_unit.js` file list.

- `CsTeams.blank(name)` -> a new empty team with a fresh id.
- `CsTeams.copyOf(team, name)` -> new id, copied days and dayOffset, no members
  or stops (used for "Add team" defaults).
- `CsTeams.fromLegacy(trip, packing, party)` -> the migrated team list.
- `CsTeams.dates(trip, team)` -> the team's calendar dates, `yyyy-mm-dd`, in
  order (start date + offset + i).
- `CsTeams.sameDayConflicts(trip)` -> `[{person, date, teams: [names]}]` for
  every person on two or more teams that both have a day on that date (match by
  id, then trimmed case-insensitive name). Sorted by date then person.
- `CsTeams.windows(plan, trip, team, bufferMin)` -> the team's schedule rows via
  `CsCalloutCard.windows` with the team's own start date (start + offset) and
  days; same arithmetic as today (callout = expected out + buffer; camp nights
  have no callout).
- `CsTeams.calloutStrip(rowsByTeam)` -> `[{team, stamp, kind: "callout"}]` for
  every team day that ends on the surface, sorted by absolute time then team
  order (the "next callouts" strip).
- `CsTeams.missingAll(trip, plansByTeam, contacts, roster, includeRoster)` ->
  short strings, in panel order, per team prefixed with the team name:
  trip-level (start date, escalation contact name, phone, "if no word" line),
  then per team: name, "at least one person", "at least one day", "at least
  one stop", plus "the roster (or untick Include roster)" only when roster
  inclusion applies. Whitespace-only counts as missing; empty when complete.
- `CsTeams.slug(name)` -> lowercase, letters/digits/hyphens, max 30 chars,
  "team" when empty; `CsTeams.fileName(index, team)` -> `team-<n>-<slug>.html`
  with n 1-based by list position.
- `CsTeams.memberRows(team, resolvedParty)` -> the team's members resolved
  against the people directory (`CsPeople.resolveParty` rules: id, then name;
  unknown -> `known:false`).

## Rendering: `Core/CsCalloutCard.js`

Existing `html` (single team) is unchanged. Add:

- `CsCalloutCard.topsideHtml(ctx)`: `ctx` carries the trip, the teams with
  their plans, resolved members, contacts, forecast, generated date, and the
  file names of the team files. Contents, top to bottom:
  1. Header (cave name, dates), then the **next callouts strip** (sorted by
     time: "2026-10-04 13:17  Team 2 callout", every team's callouts).
  2. **Roster grouped by team:** each team's members with role, squeeze limit,
     skills, medical notes and emergency contact (topside is who calls them);
     a person on several teams is listed under each team. Unknown members print
     "details not on this computer". Same-day conflicts print as bold warnings
     ("Ana Ruiz is on Team 1 and Team 2 on 2026-10-04").
  3. **Per-team schedule tables** (entry, turnaround, expected out, callout,
     camp rows) with the team's name, goal and the team file name to look up.
  4. Escalation box, then the forecast strip with weather icons and the
     rain-plus-water flag when ANY team's route has a water note and a trip day
     is wet.
  No route drawing, no directions (they are in the team files).
- `CsCalloutCard.teamHtml(ctx)`: team name and goal, the team's dates, its
  members (role, squeeze limit, skills, medical notes; NOT emergency contacts,
  which stay on the topside sheet), the team's schedule table, the forecast for
  the team's dates only, then the route SVG, intersection directions with the
  leg summaries, hazards on the route, and the rope and packing list (the
  team's own `packing`). Team files are single documents (no page-2 split
  needed, but a print page break before the route is kept).
- Everything through `CsTripPlan.esc`; no coordinates; a team with no route
  says so instead of failing.

## Panel: `ExpeditionPlanner`

One scrolling page, order: Trip, People, **Teams**, Escalation, Card.

- **Teams section:** heading, "Add team" and "Remove team" buttons (Remove asks
  with a Yes/No box, default No; the last team cannot be removed). One
  collapsible section per team (the `CsPanel` chevron fold-section already used
  by the skills groups). The header shows the team name and a live summary
  ("3 people · 2 stops · 2 days"), plus a red mark when it has a same-day
  conflict. The newest or last-edited team is expanded, others collapsed.
- **Team section body:** Name, Goal, "Starts on trip day" (a QSpinBox,
  1-based in the UI, stored as `dayOffset`), Members (a checkbox per Going
  person; people not going are not offered), Schedule (the days table with Add
  and Remove day), Stops (the station dropdown, Add stop, stops table, Remove
  and Clear), Packing (plain text).
- Widget objectNames are per team: `ExpeditionPlannerTeam<n>_<Field>` (n =
  the team's 1-based position), so probes and live tests can drive them. Widgets
  are found by objectName; no expandos; nothing is built through a lookup that
  reaches the dock while the dock is being built (see the 0.9.194 lesson in
  `ensureDock`); team sections are added AFTER the dock exists.
- "Add team": a new team copies the previous team's days and dayOffset (blank
  members and stops), name "Team N".
- Team edits write through to `stations.json` `settings.trip.teams` (fill guard,
  the sidecar's re-read-before-write rule), so a restart restores teams, stops
  and members.
- **Card section:** the "Build cards" button, status line, and the plan text
  with a heading per team. "Save packet" stays for single-team trips; with two
  or more teams it is disabled with a tooltip ("the team files include the
  route").
- **Build:** plans each team's route from its own stops, then writes
  `callout-card.html` (topside) and one `team-<n>-<slug>.html` per team beside
  the drawing. With exactly one team it writes today's single `callout-card.html`
  and nothing else. Build refuses (lists everything missing, per team) unless
  `CsTeams.missingAll` is empty. It never deletes files: if the folder holds
  `team-*.html` files that this build did not write, the status line names them
  ("left in place from an earlier build: team-3-old.html").
- The status line also shows same-day conflicts as a warning (build still
  succeeds).

## Tests

Engine (headless): `cleanTrip` teams round trip and cleaning (name default,
offsets, stops dedupe, member validation, cap of 8, no medical fields ever
serialised); migration (legacy days become Team 1 with packing and party; empty
trip gets one empty team); `dates`; `sameDayConflicts` (same date, different
dates no warning, id vs name match, three teams, sorted); `windows` with an
offset (a day-2 team's dates and callout); `calloutStrip` ordering including
ties and camp nights (no entry); `missingAll` per team prefixes, each item alone,
whitespace-only, roster rule; `slug` and `fileName`; single-team parity (the
single-team card is byte-identical to today's for the same inputs).
Rendering: topside sheet has the strip, roster grouped by team, per-team
schedule tables, warnings, escalation, forecast, and no route SVG; team file has
members without emergency contacts, the schedule, the route and directions, the
team's packing; everything escaped; no coordinates; unknown members print the
placeholder; a team with no route degrades.

Live (scratch copy only, never Truitt; check `cavecad_status` first; test the
dock BUILD in a real launch before handing over, see
`feedback-test-dock-build-before-handing-over`): build the panel, add a second
team, assign members and stops, set a same-day overlap, confirm the warning,
Build cards, read both file types, restart and confirm teams restore. The
per-user `people.json` must be created and removed by the test, never a real one.

## Out of scope (this spec)

Stage 2 (Suggest split); per-team pace; per-team start station or multiple
entrances; team-level escalation contacts; deleting stale team files; sending
files anywhere; team-to-team messaging; a combined map of all routes.

## Risks to check first

1. Dynamic widget creation and removal in the dock at runtime (Add/Remove team)
   under the tab-engine rules: build team sections after the dock exists,
   find by objectName, keep ownership so removed sections do not leave stale
   named children that `findChild` still returns (the bridge cannot destroy
   widgets: give removed sections new names or hide and reuse them; test with a
   live add/remove/add cycle).
2. Cost and correctness of `CsTripPlan.build` per team on large caves (fine at
   8 teams; measured live).
3. `cleanTrip` is also called by `serialize`; make sure the migration never
   runs there (migrate on load in the panel/engine call site, not in the pure
   cleaner, so a save cannot invent a "Team 1").
