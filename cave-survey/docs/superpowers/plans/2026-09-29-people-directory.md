# People directory for the Expedition Planner

Date: 2026-09-29. Nathan's request: keep a dynamic roster of people and any
info tied to an individual, because people go on multiple trips and he does not
want to retype their details. Decision (Option A, plus a free-text skills field):

- **People directory** in a readable LOCAL file, `people.json`, in CaveCAD's
  per-user data folder. Never in the Drive-synced cave folder (medical notes and
  emergency contacts must not sync).
- **Party for this trip** stored with the trip in `stations.json`
  (`settings.trip.party`): who is going, by id and name ONLY. No medical, contact
  or skills data there.

Supersedes the roster blob in per-user RSettings (`CaveSurvey/Callout/Roster`).
Contacts (topside contact, phone, escalation, buffer) stay in RSettings as today.
The old roster key is simply no longer read (no migration: no real roster was
ever saved by Nathan; only test fixtures, since cleared).

## Data

`people.json` (UTF-8, pretty-printed, stable order by name so a manual diff is
small):

```json
{ "version": 1,
  "people": [
    { "id": "<uuid v4>", "name": "Ana Ruiz", "role": "Lead", "squeeze": 14,
      "medical": "Asthma", "emergency": "Luis 555-0111",
      "skills": "SRT, first aid, survey lead" } ] }
```

- `id`: `CsUuid.v4()` (it exists; `CsUuid.create` does not). Assigned once, never
  changes, so renaming a person never breaks a saved trip party.
- `name` required (a row with no name is dropped on save). `squeeze`: number of
  inches or null. `role`, `medical`, `emergency`, `skills`: free text, may be "".
- Squeeze limit stays a plain number so the later squeeze-filter tool can read it.

Trip party in `stations.json`: `settings.trip.party = [{id, name}]`. Extend
`CsStationStore.cleanTrip` (drop entries without a name; keep order; `id` may be
"" for a hand-typed name). Round-trip tested like the rest of the trip block.

Location of `people.json`: CaveCAD's per-user data folder, the folder that
holds `CsMcpBridge.enabled` (`~/Library/Application Support/QCAD/CaveCAD/` on
macOS). Find how existing code resolves it (look at how the per-caver symbol
library and `CsCalloutLocal`/other per-user files locate their folder;
`RSettings.getDataLocation` is the documented one in the plugin-conventions
notes) and reuse that; do not hard-code a macOS path.

## Engine (pure, headless-testable): `Core/CsPeople.js`

`Cs` prefix, global `CsPeople`, listed in `CsAll.js` after `CsCalloutLocal.js`
and in the `tests/js_unit.js` file list. Pure functions, no file I/O:

- `CsPeople.parse(text)` -> `{people, error}`; never throws; empty text is an
  empty directory with no error; damaged text is an empty directory WITH an
  error string (so the caller can refuse to overwrite it). Missing ids are
  assigned (with `CsUuid.v4`) so old or hand-edited files load. Duplicate ids:
  the later one gets a new id. Rows with no name are skipped.
- `CsPeople.serialize(people)` -> text (sorted by `CsStationTable.compareNatural`
  on lower-cased name, ties by id).
- `CsPeople.blank()` -> a new empty person with a fresh id.
- `CsPeople.resolveParty(party, people)` -> the printable list:
  `[{id, name, role, squeeze, medical, emergency, skills, known: true|false}]`
  in party order. Match by `id` first, then by case-insensitive trimmed name;
  no match gives `{name, known: false}` with every other field "" / null.
- `CsPeople.partyOf(people, goingIds)` -> `[{id, name}]` in directory order.

File I/O (GUI engine only, so not unit-tested): a small `CsPeopleFile` section
in the same file or the existing per-user I/O place: `CsPeople.path()`,
`CsPeople.load()` -> `{people, error}`, `CsPeople.save(people)` -> "" or why not.
**A `people.json` that will not parse is never overwritten**: `save` refuses and
returns the reason until a person has looked at the file (same rule as
stations.json in Station Table). Write via the temp-file-then-rename pattern if
QFile supports it here; otherwise write directly as the sidecar code does.

## Card

`CsCalloutCard.html` takes `ctx.roster` = the RESOLVED party (what
`resolveParty` returns) instead of the raw table rows. Page 1 roster table gains
a **Skills** column. A person with `known: false` prints their name and, in the
row, the single line "details not on this computer". `missingAll`: the roster is
required only when "Include roster" is ticked, and now means "at least one person
going" (rename the message to "at least one person going (tick Going, or untick
Include roster)"). Escape everything, as today.

## Panel (Expedition Planner, ROSTER section)

Replace the free-typing roster table with the directory:

- A table of everyone in the directory: columns **Going** (a checkable item:
  `setCheckState` / `flags() | Qt.ItemIsUserCheckable`, probed working on this
  bridge; read with `checkState() == Qt.Checked`), Name, Role, Squeeze limit (in),
  Medical, Emergency contact, Skills. Cells are editable in place.
- Buttons: **Add person** (adds a blank row, focused on Name), **Remove person**
  (asks with a Qt message box first: "Remove NAME from the people directory? This
  deletes their saved details from this computer." Default answer No; removing
  also unticks them from this trip), and **Show file** (reveal `people.json` in
  Finder, using the same call CaveShelf.reveal uses), and the existing "Include
  roster on the card" tick.
- A grey line above the table: "Saved on this computer only. Tick Going for
  this trip." Roster heading stays in the same place in the panel order.
- **Saving:** edits write through to `people.json` when a cell is committed
  (FILLING IS NOT EDITING: guard programmatic fills exactly as the Stations tab
  does; connect the change handler only after the fill, and use a fill guard
  flag). The Going ticks are the trip party: write them into `stations.json`
  `settings.trip.party` when Build card runs (with the rest of the trip block),
  and ALSO when a tick changes, so the party survives a restart even if the card
  was never built. If `people.json` failed to parse the table is read-only, the
  status label says why, and nothing is written to that file.
- **Populating:** on drawing change / first open, load the directory, then tick
  the people in `settings.trip.party` (match with `resolveParty` rules: id, then
  name). Party names that are not in the directory are shown as extra read-only
  rows at the bottom ("details not on this computer") so they are visible and
  can be added to the directory with Add person if wanted; keep the panel
  simple: it is enough to list them with a grey note and keep them in the party.
- Keep every existing objectName that other code or tests use; the new table is
  `ExpeditionPlannerCalloutRoster` (keep the name so probes still work), with
  companion buttons `ExpeditionPlannerPersonAdd`, `ExpeditionPlannerPersonRemove`,
  `ExpeditionPlannerPeopleFile`.

## Docs / version

Handbook page `docs/handbook/pages/expedition-planner.html`: rewrite the roster
paragraph: people are entered once in the directory (saved on this computer only,
in `people.json`, backed up or moved by copying that file; Show file finds it),
tick Going for each trip, the trip remembers only names, the card prints the
details from the directory, skills is free text (SRT, first aid, survey lead...).
Say plainly that the directory holds medical notes and stays off Drive, so a
teammate's copy of the drawing will show names but need their own directory for
details. VERSION 0.9.190.0 -> 0.9.191.0. Tables in `tests/test_addon.py`: update
the Expedition Planner "what it touches" line (it now also reads and writes
`people.json` in the per-user data folder).

## Tests (headless)

- `CsPeople`: parse/serialize round trip; ids assigned when missing and stable
  across serialize; duplicate id repair; nameless rows skipped; junk text ->
  empty + error; empty text -> empty, no error; sort order; `resolveParty` by id,
  by name (case, whitespace), unknown -> `known:false`; `partyOf` order.
- `CsStationStore.cleanTrip` party: round trip, nameless dropped, id optional.
- Card: skills column present and escaped; unknown person prints "details not on
  this computer"; `missingAll` roster rule (needs at least one going, only when
  included; message text).
- The per-user file must never be written by the card build or any pure code.
