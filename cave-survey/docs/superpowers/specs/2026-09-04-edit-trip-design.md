# Edit Trip — a per-trip metadata editor

Date: 2026-09-04
Status: approved (option A — metadata only)

## The problem

A trip's date, team, name and instruments are typed once, in the Survey
Notebook header, and after the page is drawn there is no way to correct
them. Nathan hit this on Truitt Cave: two trips carried the wrong date
and team, and nothing in the suite would edit them.

The only path that looks like it should work makes it worse. Survey
Notebook > More > "Load from drawing" reconstructs a trip onto the page,
and `SurveyNotebook.mergeTripIntoSurvey` decides which trip the page
REPLACES by fingerprint -- `date + "|" + team`
(`CsModel.tripFingerprint`). Editing either field changes the
fingerprint, so nothing matches: the page lands as a NEW trip and the
old one keeps its shots and station marks. Correcting a typo forks the
cave.

## What this adds

A new tool, **Edit Trip** (`et`), on the open drawing: a table of the
drawing's trips with Name, Date, Team and Instruments editable, applied
by TRIP ID rather than by fingerprint.

Declination is deliberately NOT editable here. Changing a declination
rotates every azimuth and moves the whole plan; that already has its own
editor (Survey Notebook's Declination dialog, `CsRevise.parseTripEdits`
+ `reviseDeclination` + `CsRevise.apply`) with its own IGRF wiring. Edit
Trip shows the recorded declination read-only and points at it. The two
edits keep their different risk profiles: this one rewrites tags on one
entity per trip and touches no geometry at all.

## Where the data lives

Trip metadata rides as XDATA on each trip's ANCHOR station point -- the
trip's first resolved station in drawing order:

    Trip, TripName, TripDate, TripTeam, TripInstruments,
    TripDeclination, TripDeclinationSource, TripDistanceUnit

Written in exactly one place today, `CsDraw.survey`
(`Core/CsDraw.js:812`), read back by `CsRevise.surveyFromDocument`
(`Core/CsRevise.js:180`). Trip 0's anchor additionally carries the
legacy drawing-level mirror `SurveyName` / `SurveyDate` / `SurveyTeam`,
which pre-trip readers still use.

## Components

### `Core/CsTripEdit.js` (new)

Pure logic plus one document writer. Included from `CsAll.js` after
`CsRevise` (it reuses `withOffLayersOn`) and added to `CORE_FILES` in
`tests/js_unit.js` -- the list is hand-written, and a file left out of
it passes silently.

- `CsTripEdit.rows(survey)` -> one row per trip:
  `{tripId, label, name, date, team, instruments, declination,
    declinationSource, shots}`, shots counted from `survey.shots`.
- `CsTripEdit.normalizeDate(text)` -> `{ok, value, error}`. Accepts ""
  (a trip may legitimately have no date), `YYYY-MM-DD`, and the
  `M/D/YYYY` form a caver actually types, which it converts. Rejects an
  impossible calendar date (2026-02-30) rather than storing it, because
  IGRF and the shelf's drift check both parse this field.
- `CsTripEdit.planEdits(survey, inputs)` -> `{changes, error}`.
  `inputs` is `[{tripId, name, date, team, instruments}]` -- raw field
  text. Every value is trimmed; date is normalized. Returns only trips
  that actually differ. On any error NOTHING is applied and the message
  names the trip.
- Identity guard: if the edits would give two trips the same
  fingerprint (same date and team), that is refused by name -- "Trip 2
  would become the same trip as Trip 5". Merging trips is a different
  operation with different consequences (shot renumbering, linework
  rebinding) and is not smuggled in through a typo fix.
- `CsTripEdit.applyToSurvey(survey, changes)` -> mutates `survey.trips`
  and re-runs `CsModel.ensureTrips` so trip 0's top-level mirror fields
  follow.
- `CsTripEdit.writeTags(doc, di, survey, changes)` -> finds each
  changed trip's anchor (a station point whose `Trip` tag reads that
  id), rewrites the four tags, and for trip 0 also rewrites the legacy
  `SurveyDate` / `SurveyTeam` / `SurveyName` mirror. ONE
  `RModifyObjectsOperation`, so the whole edit is one undo step.
  Wrapped in `CsRevise.withOffLayersOn` -- a modify on an off layer is
  refused silently, and station points are frequently on a hidden
  control layer.
  Returns `{written, missing}` where `missing` lists trip ids with no
  anchor point in the drawing (a trip whose stations never resolved).

### `EditTrip/EditTrip.js` (new tool)

Standard add-on wiring: `setSortOrder(16)`, right after Survey Notebook
(15), group 450, commands `["edittrip", "et"]`, widget names
`["CaveSurveyMenu", "CaveSurveyToolBar"]`.

The dialog: one row per trip in a `QGridLayout` inside a `QScrollArea`
(the Package Cave pattern) -- trip label, Shots and the recorded
declination as read-only labels, then `QLineEdit`s for Name, Date, Team
and Instruments prefilled from the drawing. Name, Team and Instruments
upper-case as typed, the same as the Notebook's own header fields.
A trip with no anchor point renders read-only with the reason on the
row, rather than accepting an edit that cannot be stored.

OK: `planEdits`, then on error a message box and the dialog stays open;
on success `applyToSurvey` + `writeTags`, then a summary through
`EAction.handleUserMessage` saying which trips changed and what
follow-up the edit implies -- a changed DATE invalidates the trip's
declination estimate, so the message says so and names the Declination
dialog.

Nothing is redrawn. No geometry, elevation, LRUD, linework binding or
profile depends on these four fields.

## Failure handling

- No open drawing, or a drawing with no survey: say so and stop.
- Legacy (pre-v3) drawing: `surveyFromDocument` reports `legacy`; the
  trips it recovers are guesses and have no anchor tags to write. Refuse
  and point at Rebuild Survey Data, which upgrades the tags in place.
- A trip whose anchor is missing: read-only row, explained.
- Nothing edited: "no changes" and stop, no operation applied.

## Tests

`tests/js_unit.js` (pure, runs under node and CaveCAD):
normalizeDate over ISO/US/blank/garbage/impossible dates; planEdits
trimming, no-op detection, error naming; the fingerprint collision
refusal; applyToSurvey re-mirroring trip 0.

`tests/edit_trip_run.js` (new engine stage, needs a real
RDocument): draw a two-trip fixture survey with `CsDraw.survey`, edit
trip 1's date and team, and assert `surveyFromDocument` reads the new
values back, that trip COUNT is unchanged (the fork that started all
this), that no shot moved, and that editing trip 0 also updates the
legacy `SurveyDate`/`SurveyTeam` mirror.


---

## Amendment, 2026-09-05: the Notebook still forked, and trips can now be deleted

Reported live: loading trip 9 of Truitt Cave, correcting it, and pressing
Draw appended a thirteenth trip instead of revising the ninth.

**The Notebook had the same bug this tool was built to route around.**
`SurveyNotebook.mergeTripIntoSurvey` decided which trip a page replaced
by fingerprint (`date | team`), so editing either field on a loaded page
stopped it matching anything and it landed as a new trip. The page now
remembers the trip it was loaded from -- `w.loadedTripId`, set by
`loadFromDrawing`, cleared by `setSurvey`, Clear and New Trip -- and
`mergeTripIntoSurvey` takes identity first, falling back to fingerprint
only for a page nobody loaded. Covered in
`tests/notebook_partial_draw_run.js`: a loaded page with a corrected
date and team must revise its trip and leave the trip count alone, while
the same page without the loaded id still appends.

**Delete Trip** is a per-row action in this dialog.

- Trip ids are array indices, stamped into XDATA on legs, splays, trip
  anchors and `LineworkTrip` on traced linework, so a delete renumbers
  and every one of those tags follows.
- The removal is not surgery on the survivors: build the survey the
  drawing should now hold (`CsTripEdit.surveyWithoutTrip`), erase, and
  redraw the whole cave from it. The excluded-shot blobs, wall runs,
  trip anchors and profile bands all carry trip ids and all four already
  know how to rebuild themselves from a model.
- The trip's own legs and splays are deleted by their `Trip` tag first:
  `CsDraw.eraseStations` drops a leg only when BOTH ends are in the kill
  set, so the tie-in leg from an older trip's station would otherwise
  survive, pointing at a station that no longer exists.
- Linework is asked about, never assumed: keep-and-unbind, or delete
  with the trip. Every LATER trip's `LineworkTrip` is renumbered in the
  same operation, or a wall silently starts claiming whichever trip
  inherited its old id.
- Deleting a trip that closed a loop re-solves the rest of the cave, so
  the surviving tracing is carried along exactly as a revision does.
- **Refused** when another trip ties into a station only this trip
  reaches (`CsTripEdit.tripsStandingOn`). That trip's shots would
  survive with a `from` that is gone, the network could not place them,
  and a whole trip would leave the map into the UnplacedShots blob. The
  caver deletes the dependents first, in the order that keeps the cave
  connected -- their choice, not the tool's guess.
