# Frame-aware Scan Shelf — plan, profile and section sketches

2026-08-29. Nathan's decisions taken live in session; written after the
analysis pass over the existing insert-and-align chain.

Target 0.9.21.0 (0.9.20.0 — the Align Image station box — is in flight
uncommitted at the time of writing).

## Problem

Sketch Scans inserts a scanned sketch and hands it to Align Image, which
fits it to the drawing's plotted stations. Both halves assume the sketch
is a PLAN sketch. Cavers also sketch PROFILES, and — once C5 lands —
CROSS SECTIONS. Neither can be aligned today: the elevation's station
points carry `ProfileStation`, a deliberately separate tag namespace, so
`CsTags.collectStations` returns nothing for them and the station box
never appears. Insert & Align degrades silently to clicking every target
by hand.

## What exists today

1. **Shelf** — `SketchScans.js`, docked right, walks `scans/` recursively
   (depth 4) as a simulated tree, previews, inserts.
2. **Insert** — `SketchScans.insert()`: image centred on
   `doc.getBoundingBox(true, true)`, width ≈ that extent (min 150), fade
   50, layer `CTRL-SCAN`, draw order `min - 1`, tag
   `SketchScan=<rel path>`.
3. **Hand-off** — `alignSoon()`: select, zero-delay timer,
   `di.setCurrentAction(new AlignImage(...))`. The timer is the
   documented way out of the start-an-action-from-a-widget-event crash.
4. **Align** — `AlignImage.stationContext()` builds one flat
   `name -> pos` map from `CsTags.collectStations(doc)` (tag `Station`),
   walk order from `CsStationOrder.walkOrder(CsRevise.resolveAsDrawn(doc)
   .survey)`, used names persisted on the image as `AlignedStations`.
   Two pairs give a similarity fit; three or more give a least-squares
   affine with a residual report.

Since the elevation moved into the plan drawing (no more sibling
`-PROFILE.dxf`), all frames share one document and one coordinate space.
`CsLayers.frameOf` answers `plan` / `profile` / `sheet` by layer prefix,
and `CsProfileBox` answers "which band owns this point" from the locked
boxes on `CTRL-PROFILE-BOX`.

## Decisions

### D1 — A frame dropdown, not a checkbox

The Scan Shelf gains one combo beside Insert / Insert & Align:
**Plan** (default) / **Profile** / **Cross Section**. Nathan's first
sketch was a "Profile Sketch?" check box with the dropdown arriving later
for sections; building the control twice and rewriting the tag it writes
costs more than shipping the dropdown now with its third entry disabled
until section frames exist.

The dropdown is a real choice, not a reading of which document is front:
one drawing holds every frame.

### D2 — The mode rides on the image

Insert writes `ScanFrame=plan|profile|section` beside `SketchScan`.
Align Image reads the mode off the ENTITY, not off the dialog, so an
already-inserted scan aligned later from the menu still knows what it is.
The dropdown's only job is to set the tag at insert time.

### D3 — Frame-twinned scan layers

`CTRL-SCAN` has no `PROFILE-` prefix, so `CsLayers.frameOf` classifies
every scan as plan content. Two live consequences:

- `AlignImage.js`'s frame guard (`CsLayers.frameOf(layerName) !==
  "profile"`) does not protect a profile sketch sitting on `CTRL-SCAN` —
  a plan-wide warp would drag it.
- `CsDraw`'s plan data window counts plan-frame entities, and its own
  header documents the feedback loop where imagery inflates that window,
  which crowds the profile, which inflates it again.

So: `CTRL-SCAN`, `CTRL-PROFILE-SCAN`, `CTRL-SECTION-SCAN`; insert routes
by mode; `frameOf` gains a `section` answer alongside `plan`, `profile`
and `sheet`. This mirrors the `PROFILE-*` twin-layer convention Shaped
Lines already ships. New layers go in the plan template, or
`test_registry_layers_exist_in_plan_template` fails — correctly.

### D4 — Insert box per mode (and a live bug it fixes)

| mode | insert box |
|---|---|
| Plan | the plan data window (plan-frame entities only) |
| Profile | the `ProfileBox` rect under the current view centre |
| Cross Section | the `SectionBox` cell under the current view centre |

`SketchScans.insert` currently sizes and centres on the WHOLE document
extent. Now that the elevation lives 30 units below the plan, that extent
spans plan + elevation, so every plan scan inserted today is oversized
and centred in the gap between the two views. Mode-aware boxes fix it as
a side effect; it is called out here so it is not mistaken for new
behaviour.

### D5 — Align target namespace per mode

| mode | station tag | scoping |
|---|---|---|
| Plan | `Station` | whole plan frame |
| Profile | `ProfileStation` | the ONE band the image centre falls in |
| Cross Section | `SectionStation` | the one section cell |

No second combo for "which band". The band is resolved by location
through `CsProfileBox.at`, the same "(by location)" rule Feature Trace's
run combo already defaults to. Scoping to one band first is also what
keeps station names unique: a junction station appears in every band it
ties into.

The section row assumes the section's own station DOT carries
`SectionStation=<name>` as an entity tag. The cross-section design
currently names `SectionStation` as a field on the FRAME (the plane that
made it); this design needs it on the plotted point as well, so the
align lookup has a position to return. Recorded here as a requirement on
C5, not a redefinition of its tag.

Scope is one frame, always. A profile sketch spanning a junction into a
second band cannot be fitted by one affine — the elevation's X axis is
developed distance along a run, so two runs are two different axes. Such
a scan is fitted to the band its centre lies in, and the overhang is the
user's to live with or to cut.

### D6 — Anchors stored in image-local coordinates

On apply, Align Image writes to the image, alongside `AlignedStations`:

- `ScanAnchors=A3@0.21,0.66;A4@0.78,0.61;…` — each matched station's
  position **in image-local normalised coordinates** (0..1 across the
  picture, 0..1 down). That is invariant under every later move, rotate,
  resize and warp of the entity, which is the whole trick: it records
  where the station sits ON THE PAPER, not where the paper currently
  sits in the world.
- `ScanFrameKey=<run|section key>` as a hint only, never trusted over the
  names — a renamed run must not strand a scan.

### D7 — Redraws re-anchor the scans

A regeneration moves generated geometry; today every aligned scan stays
where it was and quietly stops matching. This already bites the PLAN
side: re-run loop closure through `CsAdjust` and every aligned plan scan
is orphaned.

One pass, after generation, inside the SAME transaction (otherwise Ctrl+Z
separates the geometry from its scans):

1. Walk scan-layer images carrying `ScanAnchors`.
2. Resolve each anchor name against the regenerated points in that
   image's own `ScanFrame` namespace.
3. Re-solve with the shared fit core and re-place the image.

Degradation is reported, never silent — `GenerateProfile`'s existing
report is the home for the profile pass:

| anchors resolvable | action |
|---|---|
| 3 or more | affine, as the interactive tool does |
| 2 | similarity |
| 1 | translate only, reported |
| 0 | left alone, marked stale, reported |

**Hand-moved scans are not stomped.** Before re-fitting, predict where
the stored anchors say the image should currently be. Within tolerance,
the placement is still the tool's — re-fit it. Outside tolerance, the
user dragged it deliberately — leave it and report. Automatic; no lock
button, no new UI.

This requires pulling Align Image's solver out into Core (see Modules):
the interactive tool and the redraw pass must not carry two copies of the
same maths.

### D8 — Sections live in a grid below the elevation

This answers open question 2 of `2026-08-29-cross-section-design.md`
("beside the plan at the pick point, or in a reserved strip?"). Nathan's
answer: **a grid, underneath all the profiles.**

- Origin: the lowest `ProfileBox` minimum Y, less a gutter, recomputed
  every redraw so the grid always clears the bands as bands are added.
- Fixed cell size, N columns, left to right, top to bottom. Settings:
  `CaveSurvey/SectionCellWidth`, `…CellHeight`, `…Columns`, `…Gutter`.
- **Cells are assigned by a recorded `SectionSeq`, not by sorting.** A
  new section appends. Assigning cells by station survey order instead
  would reflow every later cell whenever a section was inserted in the
  middle, dragging every aligned section scan across the sheet on every
  redraw. Append-only keeps existing cells still.
- The grid participates in `CsProfileDraw.translateRegion`, so it travels
  with the elevation instead of colliding with it.

### D9 — Vertical exaggeration is a guard, not a feature

Nathan does not practise vertical exaggeration. `CsProfile.settings()`
still reads `CaveSurvey/ProfileVerticalExaggeration`, and a band drawn
with exaggeration ≠ 1 is stretched in Y while a 1:1 hand sketch is not —
a two-point similarity fit is then geometrically incapable of matching.
Rather than design for it: if the drawing's `ProfileExaggerationStamp`
says anything other than 1, warn once at insert time. No pre-scaling, no
anisotropic special case.

## Modules

- `Core/CsScanFit.js` — **new, pure.** The affine and similarity solvers
  and the residual report lifted out of `AlignImage.js`, plus
  `anchorsToPairs` / `serializeAnchors` / `parseAnchors` for the
  image-local coordinates of D6. Tests under node.
- `Core/CsScanFrame.js` — **new.** One answer to "what frame is this, and
  what does it offer?": the insert box, the station table, the frame key
  at a point. Providers for `plan`, `profile` (over `CsProfileBox`) and
  `section` (over `CsSectionBox`, once C5 lands).
- `AlignImage/AlignImage.js` — reads `ScanFrame` off the entity, asks
  `CsScanFrame` for its station table instead of calling
  `CsTags.collectStations` directly, writes `ScanAnchors` on apply.
  Keeps every prompt, the station box and the command-line answers
  exactly as they are.
- `SketchScans/SketchScans.js` — the frame combo, mode-aware insert box
  and layer, `ScanFrame` tag.
- `Core/CsProfileDraw.js` — calls the re-anchor pass after render.
- `Core/CsDraw.js` — calls the re-anchor pass on the plan pass after
  `CsAdjust`.
- `Core/CsLayers.js` — three scan layers, `section` frame, template rows.

## Tags and layers

| name | on | meaning |
|---|---|---|
| `ScanFrame` | scan image | `plan` / `profile` / `section` |
| `ScanAnchors` | scan image | `NAME@u,v;…` in image-local coordinates |
| `ScanFrameKey` | scan image | run or section key, a hint only |
| `SectionSeq` | section frame | grid cell order, append-only |
| `CTRL-PROFILE-SCAN` | layer | profile sketches |
| `CTRL-SECTION-SCAN` | layer | section sketches |

`SketchScan` and `AlignedStations` keep their current meaning.

## Tests

- `tests/js_unit.js` — `CsScanFit` round trips: anchors serialise and
  parse; a known three-point set gives a known affine; two points give a
  similarity with theta preserved; the hand-moved tolerance check accepts
  an untouched image and rejects a nudged one.
- `tests/align_image_frame.js` — extended: a plan warp does not reach a
  scan on `CTRL-PROFILE-SCAN`, and a profile align does not reach plan
  entities.
- A re-anchor run under CaveCAD, in the shape of
  `generate_profile_run.js`: draw a fixture survey, insert and align a
  profile scan, regenerate with a band moved, assert the scan followed;
  then nudge it by hand and assert the next regeneration left it alone
  and reported it.
- `tests/test_addon.py` — the new layers exist in the plan template.

Mutation rounds for the drawing-side files run under CaveCAD; node never
loads them.

## Out of scope

- True rubber-sheeting of a scan (per-region warp; the existing tool
  header already refuses it and nothing here changes that).
- One scan spanning two bands or two section cells.
- Designing for vertical exaggeration (D9).
- Building cross sections themselves — that is C5 and its own spec. This
  design consumes section frames; it does not produce them.

## Sequencing

1. `CsScanFit` extraction, with Align Image unchanged in behaviour.
2. `CsScanFrame` with plan and profile providers; the dropdown with
   Cross Section disabled; mode-aware insert and layers.
3. `ScanAnchors` on apply, and the re-anchor pass on both redraw paths.
4. Cross Section mode enabled once C5 ships section frames and the grid
   of D8.

Steps 1–3 stand alone and deliver working profile sketches. Step 4 is
gated on the cross-section spec being approved and built.

## Carried to the cross-section spec

Its open question 4 — does a section print at its own scale? — now has a
second consumer. A section frame has exactly ONE station point, so a
two-point align has nothing for its second point. Either the frame
carries a stated scale and generated tick marks at known distances (which
gives the second point), or section scans align from the station plus the
ceiling point of the station's own U measurement. Whichever is chosen,
the frame must carry its scale as a tag for the re-anchor pass to reuse.
