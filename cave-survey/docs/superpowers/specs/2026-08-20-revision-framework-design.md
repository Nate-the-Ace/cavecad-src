# Survey Revision Framework — Design

**Date:** 2026-08-20
**Branch:** v2
**Status:** Approved (sections 1–2 approved explicitly; 3–7 follow the approved direction)

## Goal

A drawing produced by the suite must be **entirely reconstructible from its XDATA
tags** — the drawing is a render of the data, never the only copy of it. On top of
that, revisions become possible: drop in a correction (magnetic declination learned
after the fact, a moved georeference, a fixed blunder shot) and the drawing adjusts
around the new information instead of being redrawn by hand.

User decisions driving this design:

- **General revision framework**, not a one-off declination fixer.
- **Per-trip sections now**: one drawing holds multiple survey trips, each with its
  own date, team, declination, and unit.
- **Rigid changes move everything** (sketches ride along); non-rigid changes redraw
  tagged geometry and report which stations moved.
- **Revisions surface in the existing tools** (Declination, GeoReference,
  SurveyNotebook) — no new menu entry.
- **Full fidelity**: every field of every shot survives the round trip
  model → drawing → model, including backsights, flags, splays, and shots that draw
  nothing.

## Section 1: Tag schema v3

All tags in custom-property group `CaveSurvey` (persisted as real DXF XDATA by the
CaveCAD fork). The big shift: **shot data moves to the leg line** — one shot, one
entity. The current scheme hangs shot data on the TO station point, which breaks on
loops (a closure shot arrives at a station that already has an arriving shot; only
one can win) and has nowhere for backsights or duplicate legs.

### Leg line (CTRL-SHOTS, one per non-splay shot)

| Tag | Value |
|-----|-------|
| `From`, `To` | station names |
| `Trip` | trip id (integer, 0-based) |
| `ShotSeq` | index within the trip, file/row order |
| `Distance` | slope tape distance, in the trip's unit |
| `Azimuth` | degrees, TRUE bearing (declination applied, as everywhere in the suite) |
| `Inclination` | degrees, positive up |
| `BackAzimuth`, `BackInclination` | unreversed backsight readings; tag absent = not taken (CsTags.set already skips null) |
| `Left`, `Right`, `Up`, `Down` | LRUD at the TO station, existing `CsModel.lrudEntryText` format (`5/10` multi-reading text) |
| `Flags` | compact letters, order-insensitive: `P`=excludeFromPlot, `X`=excludeFromAll, `L`=excludeFromLength, `C`=noAdjust |
| `Note` | shot note text |

The existing `Shot="A1->A2"` tag stays (eraseStations keys on it).

### Splay line (CTRL-SPLAYS)

Existing `Splay=<station>.<n>` plus `Trip`, `ShotSeq`, `Distance`, `Azimuth`,
`Inclination`, `Note` — a splay reconstructs from its readings, never from measured
geometry.

### Station point (CTRL-STATIONS)

Keeps today's tags (`Station`, `Seq`, `Azimuth`, `Inclination`, `Left/Right/Up/Down`,
`Elevation`, `Note`) so existing consumers (wall runs, erase, pick, legacy fallback)
keep working — but **legs are canonical** for reconstruction; station shot-tags are
derived. New on station points:

- `Fixed="x,y,z"` on stations that came from `*fix` / `#Fix`.

### Trip anchor (the trip's first station point)

| Tag | Value |
|-----|-------|
| `Trip` | trip id |
| `TripName`, `TripDate`, `TripTeam` | metadata |
| `TripDeclination` | degrees east-positive, the value APPLIED to this trip's azimuths |
| `TripDeclinationSource` | `file` \| `user` \| `igrf` \| `""` |
| `TripDistanceUnit` | `ft` \| `m` |
| `StartNote`, `StartLrud` | first-station data (StartLrud serialized `L,R,U,D` with `-` for null; multi-readings joined `/`) |
| `ExcludedShots` | serialized rows for excludeFromAll shots (no geometry exists for them by definition) |
| `UnplacedShots` | serialized rows for shots whose stations never connected (network `unresolved`) |

Serialized-row format for the two blob-lite tags: one shot per line
(newline-escaped by CsTags.set), fields tab-separated in fixed order
`from, to, distance, azimuth, inclination, backAzimuth, backInclination, L, R, U, D,
flags, note`; empty field = null. These are the only two places data doesn't ride
its own entity — accepted because these shots HAVE no entity, and the alternative
(invisible carrier entities at fake positions) lies about geometry.

### Drawing-level (trip-0 anchor)

- `GeoLat`, `GeoLon`, `GeoStation` — existing, unchanged semantics.
- `RevisionLog` — one appended line per applied revision:
  `2026-08-20 trip 1 declination 2.5 -> 8.1 (igrf)`. Audit trail, newline-escaped.
- Legacy `SurveyName`/`SurveyDate`/`SurveyTeam`/`Declination`/`DeclinationSource`/
  `DistanceUnit` still written for trip 0 (back-compat with v2.0 readers); read as
  trip 0 when no `Trip*` tags exist.

### Undrawn-but-placed shots: layer CTRL-HIDDEN

`excludeFromPlot` shots ARE resolved (they position stations) but draw nothing today
— data would be lost. They now draw as normal tagged leg lines on new layer
**CTRL-HIDDEN** (off by default; registered in CsLayers + DEFAULTS +
ensureSurveyLayers + hand-inserted into the PLAN template — the structural test pins
registry layers to the template). Their stations draw normally (they always did
position). Reconstruction treats CTRL-HIDDEN legs as `Flags` says.

## Section 2: Model changes

`Survey` gains:

```
trips: [ { name, date, team, declination, declinationSource,
           distanceUnit, startNote, startLrud } ]
```

`Shot` gains `trip` (integer index into `trips`, default 0).

**Trip identity (user decision 2026-08-20): the fingerprint `date + "|" +
declination + "|" + team` uniquely identifies a trip.** `CsModel.tripFingerprint
(trip)` computes it (declination formatted to 4 decimals so float noise can't split
a trip). Everywhere trips are created or matched, the fingerprint is the key:

- Parsers **dedupe** blocks by fingerprint — two Compass `\f` blocks or Survex
  sections with the same (date, declination, team) are the SAME trip.
- Drawing into a document that already has trips: a survey trip whose fingerprint
  matches an existing drawing trip **reuses that Trip id**; otherwise it gets
  `maxExistingId + 1`. The integer `Trip` tag is the stable per-drawing index;
  the fingerprint is the identity.
- Notebook: a page whose header (date, declination, team) matches an existing
  drawing trip appends to that trip.

Back-compat: top-level `survey.name/date/team/declination/declinationSource/
distanceUnit/startNote/startLrud` remain and mirror **trip 0**.
`CsModel.ensureTrips(survey)` normalizes: no `trips` → create `trips[0]` from the
top-level fields; `trips` present → copy `trips[0]` outward. Called at every model
entry point (parsers' return, notebook build, reconstruction). Helper
`CsModel.tripOf(survey, shot)` returns the shot's trip record.

Parsers emit trips:

- **Compass**: trip per `\f`-separated block, deduped by fingerprint (same
  date+declination+team = same trip; per-block declination now survives).
- **Survex**: shots keyed to the effective `(date, declination, team)` fingerprint
  in force where the leg appears; each distinct fingerprint = one trip.
- **Walls / CSV**: single trip 0.
- **Writers** un-apply declination per shot's trip (today: per survey).

Notebook ladder = exactly one trip; header declination/date/team become that trip's
record.

## Section 3: Reconstruction + revision engine (new Core module CsRevise.js)

### CsRevise.surveyFromDocument(doc)

Exact reconstruction, superseding the chain-guessing `CsTags.surveyFromDocument`
(which stays as the legacy fallback):

1. Scan all entities once. Collect: leg lines (`From` + `To` + `Distance` present),
   splay lines (`Splay` + `Distance`), station points (`Station`), trip anchors
   (`TripDeclination` present, or legacy `Declination`/`SurveyName`).
2. Build `trips[]` from anchors sorted by trip id; shots from legs + splays +
   `ExcludedShots` + `UnplacedShots`, sorted by `(Trip, ShotSeq)`; `fixed` from
   `Fixed` tags; geo anchor from `GeoLat`/`GeoLon`/`GeoStation`.
3. **Fidelity check**: if the drawing has stations but no `Distance`-tagged legs, it
   is a v2.0 legacy drawing → fall back to `CsTags.surveyFromDocument`, mark the
   result `survey.legacy = true` (tools then offer Rebuild Survey Data to upgrade).
4. Return `{ survey, anchorName, anchorPos }` — anchor = trip-0 anchor station's
   current drawing position, so re-resolution lands in place.

Round-trip contract (the acceptance test): for any survey S,
`surveyFromDocument(draw(S))` equals S field-by-field — every Shot field in
CsModel.newShot, every trip record, fixed, startNote/startLrud, geo tags.

### Revision operations (pure, on the model)

- `CsRevise.reviseDeclination(survey, tripId, newDecl, source)` — delta = newDecl −
  trip.declination; every shot of the trip (legs AND splays AND excluded/unplaced):
  `azimuth += delta`, `backAzimuth += delta` when present, both normalized to
  [0, 360); trip.declination = newDecl, source recorded. Returns `{delta}`.
- Shot edits are not a separate primitive: the Notebook path rebuilds the trip's
  shot list wholesale from the ladder (existing flow), then hands the whole model to
  apply().

### CsRevise.apply(doc, di, oldModel, newModel, opts)

1. Resolve both models with `CsNetwork.resolve` using the same anchor
   `{name: anchorName, x/y/z: anchorPos}` so coordinates are comparable.
2. Diff station positions over stations present in both.
3. **Rigid detection — numeric, not case-based**: least-squares similarity
   transform (rotation θ + uniform scale s + translation t, no reflection) mapping
   old → new station positions (2D; z compared separately). If every residual <
   epsilon (1e-6 × drawing extent) and z displacements are uniform, the change is
   rigid. A single-trip declination fix comes out as pure rotation about the anchor
   automatically; a future unit fix as pure scale; nothing is special-cased.
4. **Rigid path**: ONE `RModifyObjectsOperation` — every entity in the document
   (tagged AND untagged: sketches, traced walls, images ride along) gets
   `.rotate()/.scale()/.move()` applied to its script-side copy, tagged entities
   additionally get updated tag values (leg `Azimuth`, station `Azimuth`, trip
   `TripDeclination`, `RevisionLog` appended), then `addObject(e, false)`. One undo
   step. Template/title-block entities on TB_* layers are excluded from the
   transform (they are sheet furniture, not cave).
5. **Non-rigid path**: `CsDraw.eraseStations` over every station of the model, then
   `CsDraw.survey` redraw (per Section 4 it now writes v3 tags + trips), then report.
6. **Report** (both paths, via CsReport into the command-line panel + a summary
   dialog): revision description, rigid/redraw, stations moved (count, max
   displacement, top 5 by distance), loop-closure error before → after, and on the
   non-rigid path the warning that hand-drawn linework near moved stations needs
   re-tracing.

### Georeference revisions

Tag-only (the anchor is data; geometry never changes) — no CsRevise.apply needed.
Re-running GeoReference re-anchors. New: after storing, if a tagged survey exists
and any trip's declination source is `""`/`user` and differs from the IGRF value for
(anchor, trip date) by more than 0.5°, offer per-trip declination revision
(yes/no per trip) which routes through reviseDeclination + apply.

## Section 4: CsDraw + tool changes

### CsDraw.survey

- Draws multi-trip surveys (shots carry `trip`); writes the Section-1 leg tags on
  every shot line, splay reading tags, trip-anchor metadata on each trip's first
  station point (legacy Survey*/Declination tags additionally on trip 0), `Fixed`
  tags, `ExcludedShots`/`UnplacedShots` rows, and CTRL-HIDDEN legs for
  excludeFromPlot shots.
- `CsDraw.shotLine` gains the shot + trip so it can tag; splay drawing gains
  reading tags. Signature stays source-compatible for existing callers.
- `eraseStations` unchanged in shape; already kills `Shot`-tagged lines by both
  endpoints, which now includes CTRL-HIDDEN legs.

### Declination tool

Doc has a tagged survey → dialog: table of trips (id, name, date, recorded
declination, source) + new-value entry per selected trip, with an "IGRF" button
enabled when GeoLat/GeoLon + trip date exist. Apply → reviseDeclination +
CsRevise.apply. No tagged survey (or no doc) → current estimate-only behavior.

### GeoReference tool

Current behavior + the Section-3 declination offer + re-anchor is just re-run.

### SurveyNotebook

New "Load from drawing" button: reconstruct via CsRevise, trip picker when more
than one trip, ladder filled from that trip's shots — azimuth cells MAGNETIC (trip
declination stripped on the way in, existing convention), header gets the trip's
date/team/declination. Draw with the same station names = the existing
erase-and-redraw replacement flow, now producing v3 tags; after apply, the
non-rigid report runs. Editing a shot in the ladder IS the shot-revision UI.

### RebuildSurveyData

Upgrade path for v2.0 drawings: legacy chain reconstruction → redraw as v3 single
trip 0 (distances inferred from geometry: slope = plan/cos(inclination), noted as
inferred in the report) → full v3 tags. Existing CsStore migration stays first.

## Section 5: Migration + compatibility

- v2.0 tagged drawings: read via legacy fallback everywhere; upgraded by
  RebuildSurveyData (or implicitly by any Notebook redraw of the whole survey).
- CsStore-era drawings: CsStore.migrate path untouched, runs before everything.
- Stock free QCAD still loses XDATA on save (no writer) — CaveCAD fork remains the
  target platform, caveat already accepted.
- Seq numbering: per-drawing station `Seq` stays global (existing behavior);
  `ShotSeq` is per-trip and lives on legs only.

## Section 6: Testing

Unit (node + `qcad -no-gui`, existing harness):

- **Round-trip exactness**: multi-trip survey with branches, loops (closure shots),
  splays, backsights, all four flags, unplaced shots, fixed stations, notes,
  multi-reading LRUD → draw (headless doc) → surveyFromDocument → deep-equal
  field-by-field. This is THE gate for "reconstruct entirely".
- reviseDeclination math: delta application, wraparound normalization, backsight
  co-rotation, splay co-rotation, excluded-shot co-rotation.
- Similarity-transform detector: pure rotation detected rigid; single edited shot
  detected non-rigid; mixed-trip declination change on a two-trip drawing detected
  non-rigid; epsilon behavior.
- Parser trip segmentation: Compass multi-block, Survex date/calibrate changes,
  Walls/CSV single trip; writers un-apply per-trip declination.
- Serialized-row round-trip for ExcludedShots/UnplacedShots, StartLrud text.

Headless document tests (harness pattern from the splay work):

- Draw two-trip survey → revise trip 1 declination → stations of trip 1 rotated
  about the junction within tolerance, trip 0 untouched, tags updated, RevisionLog
  appended, report counts correct.
- Single-trip declination revision → rigid: an untagged scratch line rotates with
  the survey; TB_* text does not.
- Notebook load-from-drawing → edit one azimuth → redraw → moved stations reported.

Structural test: CTRL-HIDDEN in CsLayers registry + PLAN template; Cs-prefix rule
for the new Core file (CsRevise.js).

## Out of scope (recorded, not built)

Distance-unit revision (schema supports it: TripDistanceUnit + similarity scale);
per-trip loop-closure adjustment (B4); warping hand-drawn linework near non-rigid
moves; multi-drawing/project-level revisions.
