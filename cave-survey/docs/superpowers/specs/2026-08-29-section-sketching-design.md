# Cross Section Sketching — design

2026-08-29. Nathan's ask, taken in session: "a Cross Section Sketching
widget that uses our scans/ folder — when I click go, it asks for the
station of the section, lets me sketch the outline and other features,
imports that into the plan view area of the active cave DXF, uses the
section leader function to identify the station, and places that block
outside the plan view cave walls."

Target 0.9.38.0.

## Problem

`CrossSection.js` draws a section that is **computed**: lofted from the
station's own LRUD and splays by `CsSectionCut`, block-local, on a
`KIND_SECTION` callout leader. That is the right answer where the splays
are dense and the wrong one everywhere else — a rough LRUD box says
nothing about the ledge, the breakdown floor or the keyhole, all of
which the surveyor drew in the field book and which is sitting in the
cave's `scans/` folder unused.

Sketch Scans already gets a scan onto the sheet as an aligned underlay,
but only for **plan** and **profile**. There is no path from a scanned
cross section to a placed section block.

## What already exists (verified in tree at 0.9.37.1)

Earlier notes had these listed as unbuilt prerequisites. They are built.

1. **Section layers** — `CsLayers` defines fourteen `CTRL-SECTION-*`
   control layers (including `CTRL_SECTION_SCAN`, `CTRL_SECTION_BOX` and
   `CTRL_SECTION_OUTLINE`) and twenty-two unprefixed `SECTION-*` draw
   layers (`SECTION-WALLS-SURVEYED`, `SECTION-CEILING`,
   `SECTION-BREAKDOWN`, the `SECTION-NOTES-*` family, and the Shaped
   Lines twins). `CsLayers.frameOf` answers `"section"` for both
   spellings, and `templates/NSS_Cave_Template_PLAN.dxf` already carries
   them — no template sync is owed.
2. **Frame-aware scans** — `Core/CsScanFrame.js` exists with
   `KINDS = ["plan", "profile", "section"]`, `layerFor`,
   `stationTagFor`, `runTagFor`, `labelFor`, `dedupePlaces`, `placesIn`.
   `SketchScans.insert()` already takes a frame and routes the layer and
   the `ScanFrame` tag by it.
3. **Section blocks and leaders** — `CsSectionDraw` defines one block per
   section, `CS_<CalloutId>`, block-local about the cut's centreline
   point, definition owned by the tool and reference owned by the caver.
   `CalloutWrite.createSection` / `addSectionLeaders` /
   `refreshSections` wire and refresh the leader.
4. **Station picking** — `CsTags.collectStations`, `CsStationOrder`
   (`walkOrder`, `nextUnassigned`), and the Align Image station box.

So this spec adds a workflow, not a foundation.

### The one dead end found while checking

`CsScanFrame.stationTagFor("section")` returns `"SectionStation"`.
**Nothing in the suite writes that tag**, so `placesIn(doc, "section")`
returns an empty list on every drawing that exists. It is not a bug in
`CsScanFrame` — it is a producer that was never built, and it would have
surfaced here as a station picker that silently offers nothing.

A cross section is cut at a **plan** station. This tool therefore reads
plan stations (`Station`, via `CsTags.collectStations`) and never
consults `stationTagFor("section")`. `CsScanFrame` is left alone;
`SectionStation` stays reserved for a future frame that genuinely plots
its own station points.

## Decisions

### D1 — Sketch in a staging bay inside the drawing

Not a custom paint canvas in the dock, and not a scratch document.

A canvas widget would need a script-constructible `QWidget` with paint
and mouse-move handling, which this bridge has repeatedly refused for
lesser widgets (`QTreeWidget`, `QListWidget`, `QTableWidget`), and would
throw away snap, arcs, undo, Feature Trace and the whole Shaped Lines
symbology — the caver would be tracing a cave with a mouse and nothing
else. A scratch document would cross the `RCopyOperation` path and sit
next to the freed-`RDocument` segfault.

The bay is a locked, named rectangle on `CTRL-SECTION-BOX`, parked clear
of the drawing's plan extents, holding the scan and the tracing. The
caver draws with the tools they already use every day.

### D2 — An LRUD ghost is the ruler

The bay is pre-loaded with the **computed** section for that station —
`CsSectionCut.polygonAt`, dashed, on `CTRL-SECTION-OUTLINE`, at
`CsSectionDraw.SCALE` (2.0), origin at the centreline point, up = up.

The caver scales, rotates and moves the *scan* to sit over that ghost,
then traces. One object does three jobs: scale calibration, orientation,
and a visible check of the tracing against the measurements. It is
deleted at Capture and never reaches the block.

Where the station has no usable LRUD, no ghost is drawn and the bay
says so. *As built:* the fallback is a message telling the caver to
scale against a line of known length they draw themselves, not the
two-click calibration tool described here. See "As built" below.

### D3 — Capture is geometric containment

Everything whose geometry falls inside the bay frame joins the block,
minus the scan image, the ghost and the frame itself. Not "everything on
the section layers" (a stray line from the previous section joins
silently) and not "the current selection" (one mis-click loses a traced
wall).

The frame is visible, so what is in and what is out can be seen before
committing.

### D4 — Auto-propose the placement, one click to override

March a ray outward from the station and drop the block at the first
clear spot. Show it as a live preview with the leader attached; Enter
accepts, moving the mouse and clicking places it elsewhere.

Automatic when the guess is good, one click when it is not. Fully
automatic with no prompt was rejected: a bad guess is cleanup after the
fact, and the preview costs nothing because `di.previewOperation`
already exists on this path.

### D5 — A sketched section is never regenerated, and is re-openable

`SectionSource=sketch` on the block reference is a hard gate:
`CalloutWrite.refreshSections` skips it, so no Draw, adjustment or
refresh ever overwrites hand tracing with LRUD geometry.

The leader tip still re-anchors to the station, so a sketched section
follows the survey exactly like a computed one.

Revision is by **reopening the bay**, not by editing the block in place:
the scan path and the bay fit are stored on the reference, so Edit
Sketch restores the scan at the same scale with the tracing back inside
the frame. *As built:* Re-Capture builds a NEW reference under a new
callout id rather than redefining in place, so the reference does move —
its scale and rotation are carried across the reopen on the bay frame,
but its position is re-proposed. See "As built" below.

This is the revision framework's own rule — the drawing is
reconstructible from what is stored on it.

### D6 — One scan browser

The Go button is a third action on the Sketch Scans shelf, beside Insert
and Insert & Align, enabled when the frame selector says Cross Section.
A second panel would duplicate the recursive tree, the collapse state,
the preview pane, the hover tooltips and the completed marks, and the
two copies would drift.

### D7 — The frame selector becomes a combo

`w.profileCheck` (a two-state `QCheckBox`) becomes a `QComboBox`:
Plan / Profile / Cross Section. A combo always has a value and can be
read off the widget, rather than being accumulated from click events
that may never fire.

### D8 — The bay parks beside the plan, and remembers

Default position is clear of `doc.getBoundingBox(true, true)` on the
side with the most empty space. Once the caver moves it, the position is
remembered per cave in settings, so a session of ten sections opens the
bay in the same place every time.

*As built: neither half shipped.* The bay always parks to the right of
the plan extents, and nothing writes the remembered corner — the read
path exists and is dead. See "As built" below.

## Architecture

### New pure Core — `Core/CsSectionBay.js`

No `R*` or `Q*` symbols anywhere, so `tests/js_unit.js` exercises all of
it under node.

- `frameRectFor(planBox, size, remembered)` — where the bay goes.
- `contains(rect, box)` / `sweepOf(boxes, rect, excludeIds)` — the
  capture set, by containment.
- `fitTransform(scanBox, ghostBox)` — the initial scan placement over
  the ghost, and `serializeFit` / `parseFit` for the tag
  (as built `ux,uy,vx,vy,tx,ty` — the image's own u and v vectors,
  which carry scale AND rotation together; comma-joined, capped well
  under the dxflib 1024-per-line rule).
- `marchOut(origin, direction, blockBox, obstacles, margin, cap)` — the
  placement search of D4, returning a point or null.
- `perpOf(d)` and `clearerSide(origin, perp, obstacles, probe)` — the
  outward direction: perpendicular to the local leg tangent, sign toward
  the clearer side. (Shipped as this pair rather than one `axisAt`, so
  each half is testable alone.)

### New tool — `SketchSection/`

Per the add-on convention: own folder, own `.svg`, unique
`(groupSortOrder, sortOrder)`, `includeBasePath`-relative includes, `Cs`
prefix on every library file.

- `SketchSection.js` — opens the bay. Station prompt, scan insert, ghost,
  zoom, snap to free. Menu command `sketchsection` / `sks`.
- `SectionCapture.js` — the sweep, the block definition, the leader, the
  march, the preview, the teardown. Command `sectioncapture` / `skc`.
- `SectionEdit.js` — reopens the bay from a selected sketched block.
  Command `sectionedit` / `ske`.

### Changed

- `SketchScans/SketchScans.js` — checkbox to combo (D7), third action
  button (D6), `frameNow()` gains the section answer.
- `Callout/CalloutWrite.js` — `refreshSections` skips
  `SectionSource=sketch`, and **counts** what it skipped, the treatment
  `SectionFrozen` already gets: a skipped section is never silently
  stale.

## Flow

1. Shelf frame selector → Cross Section. Pick a scan. **Sketch Section**.
2. Station prompt: plan stations, `CsStationOrder.walkOrder` ordering,
   the box Align Image already uses.
3. Bay opens: frame drawn and locked, scan inserted on
   `CTRL-SECTION-SCAN` faded 50 at the back of the draw order, ghost on
   `CTRL-SECTION-OUTLINE`, view zoomed to the frame, snap switched to
   free through the snap `RGuiAction`.
4. Caver scales the scan onto the ghost and traces onto the `SECTION-*`
   layers with Feature Trace, Shaped Lines, arcs, whatever fits.
5. **Capture**: sweep, define `CS_<CalloutId>` block-local about the
   ghost origin, `CalloutWrite.createSection` for the leader,
   `CsSectionBay.marchOut` for the position, preview, accept.
6. Teardown: scan, ghost, frame and the loose tracing deleted.

Each phase is one transaction group, so each is one undo.

## Tags

On the block reference:

| tag | meaning |
|---|---|
| `SectionSource` | `sketch` — the regeneration gate (D5) |
| `SectionScan` | scan path relative to `scans/` |
| `SectionBayFit` | `ux,uy,vx,vy,tx,ty` — the scan's actual placement, read off the image at capture, not the auto-fit |
| `SectionStationRef` | the plan station the section is cut at |
| `SectionScale` | drawing units per survey unit in the block |

Written through `CsTags.set`, cleared through `CsTags.remove` — `set`
returns early on empty and cannot unset.

## Error handling

- **No usable LRUD at the station** — no ghost; the bay says so and
  asks the caver to scale against a line of known length (D2 as built).
- **March finds nowhere clear** — capped; falls back to plain
  click-to-place rather than flinging the block into empty space.
- **Empty sweep** — Capture refuses and explains, rather than defining
  an empty block that renders as nothing.
- **Active drawing changed under the dock** — the shelf's existing
  guard (`CsCave.folderOf` comparison, rebuild on mismatch) covers the
  Sketch Section button too. Never hold `doc` across a bay session;
  re-resolve through `EAction.getDocument()`.
- **Scan missing on Edit Sketch** — reopens with the tracing and the
  ghost, no underlay, and says which file it could not find.

## Traps this design must respect

Every one of these has already produced a real defect in this suite.

- Sketch layers must stay **out of `CsBind` and `CsWarp`** — a
  plan-scoped warp would rubber-sheet a section sitting in plan
  coordinates. `frameOf` answers `section`; the sweeps must use it.
- `CTRL-SECTION-BOX` and `CTRL-SECTION-SCAN` may be **off**, and an off
  layer silently refuses adds, modifies and deletes. Every write goes
  through `CsLayers.withLayerOn`.
- **Bounding boxes are cached** and a modify does not invalidate them.
  `entity.update()` before any containment test that follows a move.
- **No fit-point splines** — Pro-only, fail silently, vanish on save.
  Control-point splines with the degree clamped to the point count, or
  short straight segments.
- **Never `RGuiAction.trigger()` from a widget event.** The shelf button
  hands off through `alignSoon()`'s zero-delay timer.
- **`di.setSnap()` takes ownership** — record the snap's class name and
  rebuild from a name→constructor table on teardown.
- **`queryAllEntities` is not insertion-ordered** — the sweep diffs the
  id set, never takes the last id.
- **A no-op write is still a transaction** and the callout listener will
  hear it. Do not rewrite unchanged geometry.

## Testing

**node (`tests/js_unit.js`)** — all of `CsSectionBay`: containment
including edge cases at the frame boundary, fit transform round-trip,
`serializeFit`/`parseFit` through the `\N` inner-escape nesting,
`marchOut` against synthetic obstacle sets (clear, boxed in, cap
reached), `axisAt` sign selection.

**Real engine (`tests/run_all.sh`, `/Applications/CaveCAD.app`)** —

- the bay opens, and its frame is locked;
- Capture on a known tracing yields a block whose bounding box matches
  the tracing's, block-local about the ghost origin;
- the leader anchors to the plan station and re-anchors when the station
  moves;
- a DXF round trip preserves the block, its reference and all five tags;
- `refreshSections` leaves a `SectionSource=sketch` block byte-identical
  and reports it as skipped.

**Mutation-tested assertions.** The "Draw does not clobber a sketch"
test and the containment test both get their code deliberately broken to
confirm they go red. Four tests in this suite have passed while the
thing they named was broken; a comparison is only evidence if the two
sides can disagree.

## Out of scope

- Sketching profiles or plan detail in a bay. The bay is section-only
  until this ships and is used.
- Any change to `CrossSection.js`'s computed sections. The two coexist:
  computed where splays are dense, sketched where the field book is
  better.
- A producer for `SectionStation`. Reserved, not built.

## As built — 2026-08-30

Shipped at 0.9.38.0 across sixteen commits. The decisions above are the
record of what was decided; this section records where the build
diverged, and why. Everything not listed here shipped as designed.

**Delivered as designed:** D1 (the bay), D3 (containment sweep), D4
(auto-propose, live preview, Enter or click), D6 (one scan browser), D7
(the frame combo). D2's ghost shipped, on its own dashed layer
`CTRL-SECTION-GHOST` rather than on `CTRL-SECTION-OUTLINE` — sharing the
outline layer made the provisional ghost render pixel-identical to a
finished section, since that layer is `CONTINUOUS` and this suite has no
precedent for per-entity linetypes.

**D2's fallback is weaker than promised.** Where a station has no
cuttable LRUD there is no two-click calibration tool; the bay opens
without a ghost and tells the caver to scale against a line of known
length they draw themselves.

**D5's "the reference does not move" is not true.** Edit Sketch deletes
the reference and its leaders; Capture then builds a new one under a new
callout id. Scale and rotation survive — they are parked on the bay
frame (`SectionBayRefScale` / `SectionBayRefRot`) across the reopen, the
same place the pre-bay snap class rides — but the position is
re-proposed by the march. A caver who dragged a section somewhere
deliberate will have to drag it again after an edit.

**D5's leader promise needed building.** The re-anchor described here did
not follow from the gate: `refreshSections` skipped a sketched section
before reaching its leader-aiming code, exactly as it does for a frozen
one. `reanchorSketchLeader` now re-aims it, guarded by the existing
`signatureOfLeaders` no-op check so an unmoved station writes no
transaction at all — a refresh that rewrites unchanged geometry is what
froze CaveCAD once before.

**D8 shipped neither half.** The bay always parks to the right of the
plan extents, not on the side with the most space, and nothing writes
the remembered corner — `SketchSection.rememberedCorner` reads a setting
no code sets. Deliberate: noticing the frame has been dragged needs a
transaction listener, and a listener firing on a no-op write is the
freeze above. The read path is in place for whoever picks it up.

**`SectionBayFit` changed shape.** It is `ux,uy,vx,vy,tx,ty` — the
image's own vectors, read off the placed scan at capture — not
`sx,sy,rot,tx,ty` derived from the auto-fit. The original could not
express rotation at all, and being written once at insert time it threw
away the scaling and rotating the caver did to match the ghost, which is
the whole D2 workflow. A five-field tag from before this change parses
as `null` and reopens auto-fitted rather than throwing.

**`SectionScan` is stored relative to the cave's `scans/` folder**, as
the tag table says. It was briefly absolute, which would have broken
every reopen on a moved, renamed or shared cave folder. An absolute path
stored by that build still resolves.

### Defects found in the suite while building this

Four pre-existing bugs, each fixed and regression-tested:

1. `SketchScans.insert` hardcoded `CTRL-SCAN`, so the plain Insert button
   put a **profile** scan on the plan's scan layer, where `frameOf`
   classifies it as plan content and a plan-wide warp can drag it.
   Scans placed that way in existing drawings are still stranded — a
   migration is owed.
2. `CsScanReanchor` looked section scans up against `SectionStation`, the
   tag nothing writes, so every section scan would have reported stale
   and refused a backfill on every draw.
3. `SectionCapture` and `SectionEdit` were never registered with QCAD —
   `AddOn` loads only `<Dir>/<Dir>.js` — so the bay could be opened and
   never closed. Wiring them at file top level then turned out to
   recurse until the stack died, because `include()`'s dedupe registers
   a file only once its own load returns; the includes are deferred into
   `init()`. A new structural test covers every sibling tool in the
   suite.
4. The `isNull()` shim copied across the engine test files cannot detect
   a deleted entity in this build, so any "this was deleted" assertion
   passed regardless. Absence is now asserted through
   `queryAllEntities(false, true)`.

### Verification

`./tests/run_all.sh --publish` — 13/13 green including publish checks.
`tests/section_sketch_run.js` carries 176 assertions over the full
lifecycle: open, trace, capture, refresh, DXF round trip, reopen,
re-capture. The load-bearing ones were mutation-tested — including one
that was found to be self-confirming (it used the function under test as
its own oracle) and rewritten to read the numbers off the entity.

### Cross sections face forward along the alignment

Nathan, 2026-08-30: "Cross sectional facing is always forward on the
survey alignment." Recorded because it is a convention of the craft, not
a consequence of anything in the code, and because a mirrored section is
an error that survives to print.

Verified the same day that the generated sections already honour it:
`CsSectionCut.seedFrame` builds `s = d x r`, which for a leg heading east
answers `(0,-1,0)` — south, and therefore right-of-travel for a viewer
facing the direction of travel — and `CsSectionDraw.pointOf` maps `+s` to
`+x`. So right of travel is drawn right of the page, and the bay's ghost
inherits that. Probed rather than reasoned about.

No guard was added against a scan drawn the other way round. Nathan's
call: a backward page is a mistake at the source, and the ghost sitting
under the scan is already a visual check against it.

### A P side leaves the ghost closed

Nathan, 2026-08-31: "It's fine if our ghost lines close when the real
wall may have a Passage, once inserted properly, the cross section
sketch will show the real passage."

An earlier answer had the outline breaking open where a side is written
`P`. It does not, and should not. The ghost is a ruler — it exists to
scale a scanned page against and to check the tracing, and it is deleted
at Capture. What a reader finally sees is the caver's tracing, drawn
from a field book on which the open passage was already drawn. So the
closure costs nothing and buys a simpler contract: `cut()` always
returns a closed ring, and `boundaryHits`, `radiusAt`, `leaderStop`,
`centroidOf` and `CsSectionDraw.localBox` can all keep assuming one.

Recorded because the opposite was specified first, and because the gap's
angular width is not recoverable from LRUD in any case — `P` says "no
wall measured in this direction", never "no wall across this span".
