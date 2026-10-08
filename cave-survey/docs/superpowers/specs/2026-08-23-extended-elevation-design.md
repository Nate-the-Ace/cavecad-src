# Extended Elevation Generator (B7) — Design

Date: 2026-08-23
Status: approved design, not yet implemented
Feature: master-goal B7 (vertical views), first half — the extended
elevation. Projected profile is explicitly out of scope here.

## 1. What this builds

A vertical view of the survey, generated from the same survey model the
plan is drawn from, with floor and ceiling lines derived from LRUD and
splays the way the plan's walls are derived from LRUD and splays.

The view is an **extended elevation** (a developed profile): the
horizontal axis is distance travelled along the passage, not northing or
easting, so no passage hides behind another and every leg draws at its
true length. It is not a projected profile. A projected profile — true
3D coordinates flattened onto one vertical plane — remains a separate,
later tool; the PROFILE template's `PROFILE-PROJECTED` layer is reserved
for it and this generator never writes there.

### Rejected alternative: same drawing, or a block

Two other destinations were investigated and rejected.

*Same drawing, offset south of the plan.* Cheap to build (`CsDraw.survey`
already draws with an origin offset, and distinct tag keys would keep the
two geometry sets apart the way splay and note tags already do). Rejected
because the elevation's X axis is along-passage distance, not northing.
Every global operation that is meaningful on a plan — rotate to grid
north, scale, morph to fit an aerial — is meaningless applied to an
elevation, yet a window select, a select-all, or a layer-wide edit
catches both. Shared layer visibility compounds it.

*A named block in the plan drawing, tagged so it owns its linework.*
Technically sound on the persistence question: XDATA survives inside
block definitions, because `RDxfExporter::writeBlock` walks block
entities through the same `writeEntity` that calls
`writeCustomProperties` (`src/io/dxf/RDxfExporter.cpp`). Rejected on two
other grounds. First, sketching: editing block contents happens in
QCAD's block-edit context, where the plan, border and title block are
invisible — the wrong ergonomics for a view that is going to be drawn on
by hand. Second, lifecycle: every existing tool queries model space, so
`eraseStations`, `RebuildSurveyData` and `CsRevise` would not see block
contents, and the profile's generated geometry would go stale with no
redraw able to clean it. Teaching all of them to walk block entities is a
larger change than the sibling file below.

## 2. Destination: a sibling file, maintained automatically

The elevation lives in its own drawing, `<plan>-PROFILE.dxf`, beside the
plan file. It is created from `templates/NSS_Cave_Template_PROFILE.dxf`
on first generation and opened in a second tab with
`openFiles([path], false)` (`scripts/library.js`).

Two mechanism facts were established while planning, and both changed the
design for the better:

*An already-open profile tab is drawn into directly.* `openFiles` itself
enumerates open documents -- `mdiArea.subWindowList()`, then
`getDocument()` on each child -- and `RMdiChildQt` also exposes
`getDocumentInterface()`. So when the profile is already open we draw
into that tab rather than rewriting the file underneath the user: their
view updates, their undo still works, and unsaved sketching is not
clobbered. Only when no tab holds it is the file built off screen and
then revealed.

*The DXF writer must be the dxflib one, named explicitly.*
`RFileExporterRegistry::getFileExporter` picks the LOWEST `canExport`
score, and `RDxfExporterFactory::canExport` returns 1 for a name filter
containing "dxflib" against 100 for a bare `.dxf`. Naming the filter is
therefore what selects the writer CaveCAD taught to emit custom
properties as XDATA. Exported by any other writer, every profile tag is
silently dropped -- and the next regeneration cannot find its own
previous output to erase, so it doubles it instead. This is verified by
a round-trip test rather than assumed.

Generation is **not** a separate step the user has to remember. Every
`CsDraw.survey` pass — notebook Draw, import, revision redraw —
regenerates the sibling file in the same breath, gated by
`CaveSurvey/ProfileAuto` (default TRUE). A `GenerateProfile` command
exists to force a rebuild and to print the report on demand, but the
normal path never needs it.

If the plan drawing has never been saved there is no sibling path to
write. The profile is skipped and the report says exactly that, rather
than inventing a location.

### Regeneration is sketch-safe

Regeneration erases only entities carrying this feature's own tags
(§7) — the same discipline `eraseStations` uses in plan. Hand-drawn
linework in the profile file is never touched by an erase.

When stations move, sketched linework follows, through the machinery that
already exists for the plan: `CsBind` tags each hand-drawn entity on a
linework layer with the stations it was traced against, and
`CsRevise.moveLinework` moves each entity by a similarity fit over its
own bound stations, reporting anything whose residual exceeds tolerance
as unmoved rather than mangling it. `similarityFit` is reused unchanged
(user decision).

Recorded caveat: a similarity fit is free to rotate and to scale
uniformly. In plan space both are meaningful. In elevation space rotation
is not — X is a distance along a path and Y is an elevation, so the axes
are not interchangeable — which means a differential station move can be
absorbed as a small tilt of sketched linework. Accepted deliberately in
exchange for one shared code path. If tilt is ever observed in practice,
the fix is a fit with theta pinned to zero, not a new mover.

## 3. Unroll geometry

Per leg, working from the resolved (adjusted) coordinates:

- horizontal step = plan distance = `d · cos(inclination)`
- vertical step = rise = `d · sin(inclination)`

so each leg draws at its true slope length. This inherits the suite's
slope-tape convention instead of restating it; a horizontal-tape
assumption was the original 1.x bug and is not reintroduced here.

Elevation (Y) is the station's resolved Z. It is read from the resolve
result and never defaulted to 0 — see the elevation-datum trap: any code
path that substitutes 0 for a missing Z silently rebases a cave surveyed
to an absolute datum.

The unroll advances left to right, monotonically. A passage that doubles
back on itself in plan does not double back here; that is what "extended"
means.

Vertical exaggeration is a setting, `CaveSurvey/ProfileVerticalExaggeration`,
default 1.0. It scales Y about the band's datum only, never X.

## 4. Runs, bands, and how they are ordered

### 4.1 One band per survey run

One profile per survey run, stacked: run `A` on top, the next below it,
and so on. A run is identified by **station name**, which is where the
surveyor's own intent already lives.

Parse a station name into alternating letter and digit groups. The run
key is every group but the last; the sequence within the run is the last
group.

| Station    | Run key   | Sequence | Tie station (name-derived) |
|------------|-----------|----------|----------------------------|
| `A20`      | `A`       | 20       | none (letter run)          |
| `A13a1`    | `A13a`     | 1        | `A13`                      |
| `A13a2`    | `A13a`     | 2        | `A13`                      |
| `A13b1`    | `A13b`     | 1        | `A13`                      |
| `A13a2b1`  | `A13a2b`   | 1        | `A13a2`                    |
| `B1`       | `B`        | 1        | none (letter run)          |

A spur is signified by a lowercase letter and ties to the uppercase
station its name contains: `A13a1` ties in at `A13` and continues to
`A13a2`. Two spurs off one station (`A13a*`, `A13b*`) are two runs and
two bands. A sub-spur off a spur (`A13a2b1`) needs no special case — the
same split handles arbitrary depth.

A spur long enough to deserve promotion becomes its own letter run
(`B1`, `B2`, …) — a naming decision the surveyor makes. **There is no
length threshold anywhere in the code.** The tool reads the names as
typed and never guesses whether something is "big enough".

Splays keep their existing dot form (`A3.1`) and are excluded from
station parsing, so they can never collide with spur letters.

### 4.2 Hierarchy comes from the graph, membership from the name

Names decide which stations belong to which run. The **graph** decides
band order: a run's parent is the run owning the station its first leg
ties to, and its junction X is that station's along-distance within the
parent band. Bands are laid out depth-first over that parent
relationship, siblings ordered by junction distance.

This is what makes `A13a1` and `B1` behave identically: `A13a`'s parent
lands on `A` because its tie station is `A13`, not because its name looks
nested. Letter runs carry no name-derived tie, so the graph is their only
source.

Where a spur's name-derived tie and its graph tie disagree — `A13a1`'s
first leg actually comes off `A14` — the band is drawn at the **graph's**
junction, because that is the measured fact, and the mismatch is named in
the report. Both facts are already in hand, so this is a free blunder
catch in the spirit of goal B5.

A run tied to its parent at both ends (a loop between two surveys) takes
the nearer tie as its junction; the second tie is drawn as a light tie
line and named in the report.

### 4.3 A band includes its tie station

Each band's leftmost point, at X = 0, is its **tie station** — not its
own first station. Band `A13a` draws `A13` (labeled, at its true
elevation), then the tie leg, then `A13a1`, `A13a2`, ….

Without this the connecting leg `A13 → A13a1` would belong to no band and
would vanish from the profile. With it, every leg in the survey appears in
exactly one band, and a tie station appears once in its own run's band and
once at the origin of each band hanging off it — which doubles as the
visual cue for where the spur leaves the parent passage.

Run `A` has no tie, so its band starts at its own first station.

### 4.4 Within a band: the longest chain

A band unrolls the longest chain of stations within its run. Internal
side leads that were never given their own name are omitted and listed by
name in the report, so nothing disappears silently.

### 4.5 Vertical placement

Y is true elevation at true scale (times the exaggeration setting) for
every band, so ceiling heights and depths read correctly and two bands
can be compared with a ruler.

Where a band's elevation span would collide with a band already placed,
it is pushed down by a whole band height. The applied offset is recorded
on the band (`ProfileZOffset`) and written into the band's label, so a
reader is never misled about which bands are at true datum and which have
been displaced.

Noted alternative, deliberately not chosen: always stack every band with
a fixed gutter (offset 0 only for the first). More predictable layout,
less information — every band but one would need its datum read off a
label.

## 5. Floor and ceiling lines

Per station in the band:

- ceiling point at `z + U`
- floor point at `z - D`
- `null` = not measured, no point at all
- `0` = wall at the station, point at the station itself

matching the LRUD convention the suite already uses (`null` = not
measured, `0` = wall here).

### Splays

Splays join a line by the **sign of their inclination**: up joins the
ceiling, down joins the floor. A splay within
`CaveSurvey/ProfileFlatSplayDeg` of horizontal (default 10°) joins
neither — it is drawn as a tick on `CTRL-SPLAYS` so the evidence is
visible, but it bends no line it does not describe.

This is a deliberate departure from the plan rule, where every splay
counts with no steepness filter. The asymmetry is the geometry's, not a
change of mind: in plan, every splay has a real horizontal projection and
so is a real wall hit. In elevation, a near-horizontal splay is still a
real wall hit but says nothing about where the floor or ceiling is, and
letting it into either line would pull that line to near-centerline
level.

A splay's X is its station's X plus its along-passage plan projection.
Within a line, points are ordered by that projection, with the LRUD tick
sitting at 0 and leading ties — the same ordering rule
`CsLrud.stationWallPoints` uses for plan walls.

### Breaks

A run of floor or ceiling points ends at a junction station, at a closure
leg, and at any station with no vertical evidence at all (neither U/D nor
a non-flat splay). Each break starts a new polyline rather than inventing
a connection.

Straight segments between measured points only, never curves — these
lines are previsualization, and implying detail between stations that is
not in the data would misrepresent the passage. Same reasoning as the
plan's inferred walls, same faint dashed treatment.

## 6. Layers

New in the registry (`CsLayers`), in `CsLayers.DEFAULTS`, and added to
`NSS_Cave_Template_PROFILE.dxf`:

| Layer                   | Purpose                        | Default              |
|-------------------------|--------------------------------|----------------------|
| `CTRL-PROFILE-FLOOR`    | generated floor runs           | gray DASHED Weight000 |
| `CTRL-PROFILE-CEILING`  | generated ceiling runs         | gray DASHED Weight000 |

Also added to the PROFILE template, which currently lacks them:
`CTRL-LRUD` (U/D ticks) and `CTRL-SPLAYS` (splay rays, tips, flat ticks).

The template's `PROFILE-FLOOR` and `PROFILE-CEILING` are left **empty**
for lines traced by hand, exactly as `WALLS-SURVEYED` is left for the
plan while `CTRL-LRUD-WALL-*` carries the generated previsualization.
`PROFILE-PROJECTED` is untouched, reserved for the future projected view.

Centerline, stations and labels reuse the template's existing
`CTRL-SHOTS`, `CTRL-STATIONS`, `CTRL-STATION-LABELS`.

## 7. Tags

Profile geometry carries its own tag namespace so that plan-side
tag scanners can never mistake it for plan geometry, even if the two
files are merged one day:

| Tag                 | On                                    |
|---------------------|---------------------------------------|
| `ProfileStation`    | station point and its label           |
| `ProfileShot`       | centerline leg                        |
| `ProfileFloorRun`   | generated floor polyline              |
| `ProfileCeilingRun` | generated ceiling polyline            |
| `ProfileSplay`      | splay ray, tip and flat tick          |
| `ProfileRun`        | every entity of a band: its run key   |
| `ProfileZOffset`    | band datum shift, on the band label   |

Erase rules mirror `CsDraw.eraseStations`: erasing a station kills its
profile geometry on any station match, so a redraw replaces rather than
duplicates. `ProfileRun` allows a whole band to be dropped when its run
disappears.

## 8. Structure

- `Core/CsProfile.js` — pure. Name parsing and run splitting, run
  hierarchy from the graph, band layout and offsets, unroll math,
  floor/ceiling run construction with the dead-zone rule. No `R*` at file
  scope, so it runs under plain node like the rest of Core.
- `Core/CsDraw.js` — the drawing half: sibling-file open/create,
  band drawing, tagging, tagged erase, report hand-off. Called from
  `CsDraw.survey` behind the `ProfileAuto` gate.
- `GenerateProfile/` — thin tool folder following the fixed add-on wiring
  conventions, for a forced rebuild and the report.
- `Core/CsReport.js` — a profile summary alongside the existing draw
  summary: bands drawn, legs drawn, floor and ceiling runs, flat splay
  ticks, omitted side leads, tie mismatches, second ties, unmoved
  sketched entities.

## 9. Tests

- Run splitting: `A20`, `A13a1`, `A13b1`, `A13a2b1`, `B1`, a bare `A`,
  and a splay name that must not parse as a station.
- Unroll geometry against hand-computed coordinates, including a leg with
  negative inclination and a leg doubling back in plan.
- Tie-station derivation, graph-vs-name mismatch reporting, both-ends tie.
- Band includes its tie station; every leg in the survey lands in exactly
  one band (a coverage assertion, not a spot check).
- Dead-zone classification at the boundary, above and below.
- Run breaking: junction, closure leg, no-evidence station.
- Band offsetting when elevation spans collide.
- Elevation datum: a survey anchored at a non-zero Z produces profile Y
  values at that datum, and no code path substitutes 0.
- Structural test pinning `CTRL-PROFILE-FLOOR`, `CTRL-PROFILE-CEILING`,
  `CTRL-LRUD` and `CTRL-SPLAYS` to the PROFILE template.
- Headless round trip: generate, hand-add an entity, regenerate, assert
  the hand-added entity is untouched and the generated geometry is
  replaced rather than duplicated.

## 10. Deliberately out of scope

- Projected profile (the second half of B7).
- Cross sections (C5).
- Vertical exaggeration applied to sketched linework: a change of
  exaggeration mid-project is a manual retouch, not a migration.
- Any length heuristic for spur-versus-branch. Naming is the surveyor's.

---

## Superseded 2026-09-12: vertical exaggeration removed

The exaggeration setting, its stamp and the parameter threaded through
`unrollBand`, `bandWallRuns`, `build` and `CsProfileDraw` are gone.

Nathan's reason, and it is the right one: hand-drawn profiles are not
vertically exaggerated, and the generated bands should match them. The
setting defaulted to 1.0 and no drawing these tools have made ever used
it -- Truitt Cave has none across sixteen bands.

What it cost to keep was worse than what it bought. An exaggerated band
beside a 1:1 field sketch is two drawings that disagree about vertical
scale, and every feature reading a band's geometry afterwards -- the
scan drape into the 3D view, which is what raised this -- had to carry
the question. A suite with one vertical scale everywhere cannot have
that class of disagreement at all.

A band's `y` is now simply elevation. `yOf` survives as a function
rather than becoming a bare `z` at each call site, because that is the
one place a vertical scale would ever go again.

The loop-closure arrow exaggeration in `CsClosure` is a DIFFERENT thing
and is untouched: those arrows are exaggerated so a tenth of a foot is
visible at all, and the caption states the factor.
