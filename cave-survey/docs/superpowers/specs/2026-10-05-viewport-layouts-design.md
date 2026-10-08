# Viewport layouts — design (branch `viewport`)

Status: DRAFT 2026-10-05. Research done, nothing built. Both `cavecad-src` and
`cavecad-tools` are on branch `viewport`; standard releases stay on
`cavecad` / `legacy-map`.

## Goal

Replace file-per-sheet plotting with AutoCAD-style **layouts and viewports**
inside the one cave drawing:

- Model space holds the cave, as now.
- Each **layout** is a named paper (A1, B2, Profile…) with its own title
  block, north arrow, scale bar and match lines in paper space.
- A **viewport** on a layout is a live window onto model space with its own
  scale, centre, twist and per-viewport layer visibility.
- One PDF set comes from all (or chosen) layouts.
- No `sheets/` folder, no derived copies, no stale sheets, no
  `CsSheetFile` edit-refusal, no clip-by-cutting geometry.

Product ambition: this is the future of CaveCAD sheet creation and map
publishing, not a side feature. It must survive save/reload reliably.

**Scope decisions (Nathan, 2026-10-05):** (1) NO AutoCAD/other-CAD
interoperability requirement: the file format may be CaveCAD-private where
that is simpler and safer; standard DXF group codes are used only where
they are free. (2) NO retroactive support: no migration of `sheets/`
tiles, no legacy Sheet Setup path kept alive for old caves; the viewport
workflow replaces file-per-sheet outright and CaveCAD has one user, so old
sheet files are simply regenerated. Both simplify V1 and V4 below.

## What the engine already has (verified in `cavecad-src`, 2026-10-05)

QCAD's open core ships most of the rendering half; the stripped parts are
UI, persistence and plot.

| Piece | State |
|---|---|
| `RViewportEntity` / `RViewportData` (`src/core/`) | Compiled, registered (`main.cpp: RViewportEntity::init()`), JS bindings generated (`REcmaViewport*`). |
| Fields | `position` (centre on paper), `width`, `height`, `scaleFactor`, `rotation` (twist), `viewCenter`, `viewTarget`, `overall`, `status` (Off), `viewportId`, frozen layer ids. |
| Rendering | `RViewportEntity::exportEntity`: draws frame, `exportClipRectangle`, `exportTransform` of a temporary model-space block ref (scale/rotate/offset), freezes the viewport's layers for the pass, exports model entities whose box intersects, hatch viewport context, linetype scaling. |
| Exporter plumbing | `blockRefViewportStack`, `getCurrentViewport()`, line-pattern counter-scale by viewport scale (`RExporter.cpp`). |
| Snap/pick through viewport | `RViewportData::getShapes/getDistanceTo/getEdges` written for it. |
| Active viewport | `RDocument::setCurrentViewport/getCurrentViewportId`, `RDocumentInterface::setCurrentViewport`; active viewport frame drawn thick dashed. |
| Layouts | `RLayout` object (paper size, margins, plot origin/window, custom scale, rotation, tab order); `RBlock::layoutId`; `RDocument` auto-creates `Layout1` + `*Paper_Space` (the viewport creation is commented out). |
| Print | `Print.js` already loops pages of ONE document with a `QPainter`; Qt PDF printer allows `newPage()`. |

## What is missing

1. **DXF persistence.** dxflib has no VIEWPORT entity. `RDxfImporter` only
   routes paper-space entities (group 67) into `*Paper_Space`; `RDxfExporter`
   writes empty `*Paper_Space`/`*Paper_Space0` blocks and no LAYOUT objects.
   Today a viewport would vanish on save. **This gates everything.**
2. **Layout UI.** No tab strip, no layout create/rename/delete/reorder, no
   paper canvas (white page on grey), no viewport tools, no "enter viewport"
   (MSPACE) interaction. All Pro-only upstream; we write it.
3. **Plot of a layout.** `Print.js` prints the current block with
   document-level scale/offset/paper variables; it must print a layout's
   paper-space block at 1:1 with the layout's own paper settings, many
   layouts into one PDF.
4. **Cave integration.** Sheet furniture, tiling maths and Sheet Setup panel
   are file-based; they become layout generators.

## Stages

Each stage ships/tests on its own and leaves the app usable.

### V0 — Spike (a day; decides the rest)
Script-only, no C++ edits. In a scratch drawing: add an `RViewportEntity` to
`*Paper_Space` via `RAddObjectOperation`, `setCurrentBlock("*Paper_Space")`,
look at it, then print it. Answers:
1. Does the view draw paper space and the viewport contents correctly
   (scene regenerate, clip, twist)? Does `Print` honour it?
2. Frame/clip behaviour at twist ≠ 0; hatches, text, linetypes, images
   (aerial basemap, scans) inside a viewport.
3. Cost: `exportEntity` walks **all** model entities per viewport per
   regenerate (box test only, no spatial index). Measure Truitt and the
   largest cave drawing with 4 viewports.
4. Scripting API coverage: can JS construct/modify viewports and layouts
   without new bindings? (If not, regenerate via `support/ecmagenerator`,
   rebuild **both** trees — see [[cavecad-two-build-trees]].)

Exit criterion: a go/no-go on rendering performance and the list of engine
patches V1+ must carry.

### V1 — Persistence (DXF, CaveCAD-private where simpler)
- Layout metadata is NOT required to be AutoCAD LAYOUT objects. Plan:
  paper-space blocks written as ordinary BLOCK definitions with their
  entities inside; layout properties (name, tab order, paper size/unit,
  orientation, margins, active) serialized through the existing XRecord
  mechanism (the document-variable dictionary) and rebuilt into `RLayout`
  + `RBlock::layoutId` on import. No handle choreography with BLOCK_RECORD.
- dxflib: parse/write `VIEWPORT` (10/20/30 centre, 40/41 size, 68 status,
  69 id, 12/22 view centre, 17/27/37 view target, 45 view height →
  `scale = height/viewHeight`, 51 twist, 331 frozen layer handles, 90 flags).
- Importer: map to `RViewportEntity` in the entity's paper-space block;
  frozen-layer handle → layer id; keep overall (id 1) viewport semantic.
- Importer/exporter: stop writing the fake Layout1/Layout2 skeleton;
  one paper-space block per layout (`*Paper_Space`, `*Paper_Space1`, …).
- Round-trip tests in `tests/`: save → reload → compare layouts, viewports,
  frozen layers, paper-space entities.
- Watch the long-line trap in
  [[cavecad-dxf-long-line]] — a bad line silently drops the OBJECTS section.
- Datum: a viewport's `viewCenter` is an absolute model coordinate. Never
  default anything to 0 (see [[cave-survey-elevation-datum-trap]]).

### V2 — Layout UI (the AutoCAD feel)
- **Tab strip** under the drawing: `Model | A1 | A2 | Profile | +`.
  Switching = `setCurrentBlock(layout block)` + view fit to paper.
  Right-click: rename, move, duplicate, delete, page setup.
- **Paper canvas:** grey surround, white sheet, dashed printable margin,
  drawn by the view when the current block is a layout block.
- **Page setup dialog** per layout: paper (ISO/ANSI/custom), orientation,
  margins, units; stored in `RLayout`.
- **Viewport tools:** create (draw rectangle → viewport at default scale
  fitting the model extents), set scale (list + custom), set twist, lock,
  off, per-viewport layer freeze (dialog over `getFrozenLayerIds`), match
  viewport to another, clip to polyline (later).
- **Enter a viewport** (double-click inside; AutoCAD MSPACE): sets
  `setCurrentViewport`; pan/zoom edit `viewCenter`; drawing and snapping
  go through `getShapes`; double-click outside to leave. Scale lock honoured.
- **Selection rules:** paper-space tools never select model entities and
  vice versa unless a viewport is active.
- **Perf work from V0:** spatial-index query inside the viewport box
  (inverse-transform it, as `RViewportData::getShapes` already does) in
  place of the linear walk; cache per viewport.
- Cave tools: audit every tool for the assumption "current block = model
  space". In a layout they refuse or redirect with a message, as
  `CsSheetFile` does today. Tab-engine rules apply
  ([[cavecad-tab-engine-panels]]).

### V3 — Plot
- `Print.js` variant (or `PrintLayouts.js`): per layout, set the painter
  transform from the layout's paper size at 1:1, `paintEntities` for the
  layout block, `printer.newPage()`; mixed paper sizes across layouts.
- Print Preview shows one layout; "Export PDF set" runs chosen layouts into
  one file (what `SheetSetup.plotSet` does today, minus opening tabs).
- Clipping is the exporter's, so the white-prints-black trap
  ([[cave-sheet-tiling]]) cannot recur — no masks, no geometry cutting.

### V4 — Cave sheet generators on layouts
`CsSheetTile` maths (grid, overlap, numbering A1/B2, match lines) becomes a
generator that *writes layouts*:
- One layout per occupied tile, one viewport each (centre = tile core
  centre in model coordinates, scale from the plot-scale choice).
- Furniture (title block on the first sheet, scale bar and north arrow on
  all, "SHEET B2", match lines + "SEE SHEET …") as **derived paper-space
  entities** on suite-owned layers, regenerated by the generator; scale bar
  derives from the viewport scale, north arrow from its twist and the
  declination.
- Elevation/profile band: a viewport over the profile region of the plan
  drawing — closes the "elevation sheet not tiled" gap.
- Cross sections: a viewport per section.
- Sheet Setup panel keeps its familiar preview (`CsSheetView`) as the
  *authoring* surface; its output is layouts. Viewport edge dragging maps to
  `RViewportData` edits.
- Hand edits to a layout survive regeneration: derived entities carry a tag;
  everything else in paper space is the caver's and is left alone (the
  opposite of the current "sheets are demolition-dated" rule).
- No migration: the old tiling code path, `CsSheetFile` and the `sheets/`
  folder are deleted once the generators work.

### V5 — Polish / interop
Annotation scale for text/symbols per viewport, layer states per viewport,
viewport clip to polygon, sheet index table, title-block field attributes,
handbook pages and translations
([[cavecad-i18n]]), live-restart and dock traps re-tested.

## V0 results (2026-10-05) — GO

Probes live in `probe/viewport/` (headless, run with the dev app copy in
`~/Documents/github/viewport-dev/`, never `/Applications`).

| Question | Result |
|---|---|
| Does a viewport added to `*Paper_Space` render model space? | **Yes**, headless, via `exportBitmap` and via `Print.js`. |
| Clip to the viewport frame | **Yes** (circle larger than frame is cut). |
| Twist (`rotation`, radians) | **Yes**; content rotates about the viewport centre, frame stays axis-aligned. |
| Per-viewport frozen layers | **Yes**; a layer frozen in viewport B still shows in viewport A. |
| Absolute coordinates (500000, 3900000) | **Fine**: `viewCenter` is an absolute model point; no datum trap. |
| Print to PDF through `Print.js` unchanged | **Yes**, layout prints with clip when current block = paper space. Print scales by the DOCUMENT unit (`unitScale` 304.8 for feet), so a layout in inches needs scale `1:12` in a feet drawing — layout printing must set that itself. |
| DXF save/reload today | **Viewport, paper-space entities and layout all lost** (baseline in `v0_dxf.js`); reload also invents a stray `*Paper_Space0`. V1 is mandatory. |
| Entity block assignment | Entities go into the CURRENT block; setting `blockId` before an `RAddObjectsOperation` is overridden. Set `setCurrentBlock(paper)` first (a viewport added through `RAddObjectOperation` kept its block; a line added via `RAddObjectsOperation` did not). |
| Cost | Linear walk of model entities per viewport: 20k entities 245 ms/viewport, 100k entities ~790 ms/viewport (4 viewports 3.5 s). Acceptable for a first release (scene is cached between changes) but the spatial query is a V2 item. |

Mapping (from `getViewOffset` and the rendering test): a model point P lands
at `position + R(rotation) · (P − viewCenter − viewTarget) · scale`, where
`position` is the viewport centre on paper. `scale` = paper units per model
unit.

**Units decision (revised after measuring):** paper-space coordinates are in
the DRAWING unit, like model space. Measured via PDF content streams: line
weights (mm), text heights, linetype patterns and `Print`'s unit scale all
convert through the drawing unit, and line weights inside a viewport are NOT
scaled by the viewport scale (a 0.5 mm line stays 0.5 mm at 1/600). A paper
coordinate system in another unit (inches in a feet drawing) would make
lines 12x too thin. A Letter sheet in a feet drawing is 0.9167 x 0.7083 ft;
1 in = 50 ft is viewport scale (1/12)/50 = 1/600. People still type and read
inches or millimetres: `RLayout` plot paper units is an entry/display
preference only, and `Layouts.toPaper/fromPaper` convert.

**DXF fixtures:** QCAD's own `examples/flange.dxf` and the `iso_en_a3`
templates carry real LAYOUT/VIEWPORT data (4 viewports on one layout; two
layouts: `*Paper_Space` ↔ "Layout2", `*Paper_Space1` ↔ "Layout"). Used as
read fixtures for V1. Viewport scale there = `height / DXF 45 (view height)`.
dxflib already writes a FAKE skeleton for every file: BLOCK_RECORDs
`*Model_Space` (1F), `*Paper_Space` (1B), `*Paper_Space0` (23) and LAYOUT
objects Layout1/Layout2/Model with hard-wired handles; V1 replaces it with
the real layout list.

## Editing through viewports ("click through") — design (Nathan, 2026-10-05)

Requirement: viewports can be clicked through to edit things in model space
and to reposition the contents when the viewport is not locked.

**Implementation: the model view, composed to look identical.** Double-click
a viewport (the stock `DefaultAction.entityDoubleClicked` TODO, now filled in)
and the document switches to MODEL space while the view is zoomed so the model
appears exactly as the sheet shows it: same scale, same place on screen, no
jump (the visible paper area mapped back through the viewport). The viewport's
frame stays fixed on screen and a dimmed surround marks it. Every tool, snap,
selection, grip and preview then works on the real model with no engine
surgery, which a true paper-space pass-through would need in every tool's
mouse, snap and preview path (the stock core only carries commented remnants
of that design: `RInputEvent` input transform, `RDocumentInterface::
setCurrentViewport`).

- **Reposition:** panning / zooming slides the model under the fixed frame;
  "Back to layout" (button, any tab, or a double-click on empty ground outside
  the frame) writes the new view centre and scale into the viewport in ONE
  undoable step.
- **Locked viewports** (status bit, DXF flag 0x4000, property "Locked"): the
  edit mode still lets you edit the model, but the viewport keeps its scale
  and contents; grips and the property editor refuse to change them.
- **Twisted viewports:** the view cannot rotate, so the model is shown
  untwisted and nothing is written back.
- Generated (auto) sheets lock their viewports; editing the model through one
  does not change the layout (so it stays auto).

Why the composed view rather than paper-space pass-through: robustness first.
The tools the caver already trusts run unchanged. The cost is that paper
furniture is not drawn while editing (the layout is one click away).


## As built (2026-10-05) — read this before the stages above

Everything below was built and verified on branch `viewport`; the stage list
above is the plan it grew from, kept for the reasoning.

| Stage | Built | Where |
|---|---|---|
| V0 spike | render, clip, twist, per-viewport layer freeze, Print.js plot, perf, DXF baseline | `probe/viewport/` |
| V1 persistence | VIEWPORT in dxflib (frozen layers by name, display lock flag), layouts as XRecords through `RLayout.toStorageMap`, wipeouts as marked polylines, overall viewport draws nothing | `cavecad-src` `dl_dxf`, `RDxfImporter/Exporter`, `RLayout`, `RViewport*` |
| V2 layout UI | tab strip (Model / sheets / +), paper canvas, page setup dialog, per-sheet print settings on the block, New Viewport tool, scale dropdown with standard + custom scales, lock, per-viewport hidden layers, edit through a viewport (pixel-exact, pan/zoom writes view, lock honoured) | `scripts/Widgets/LayoutTabs`, `scripts/Layouts` |
| V3 plot | all sheets to one PDF, mixed paper sizes; File > Print / Preview on a sheet | `scripts/Layouts/LayoutPlot.js` |
| V4 cave generators | `CsLayoutGen` (viewport + furniture, tiles, elevation, white backing as wipeouts, no raster), auto / edited / manual by signature, revert, linked scale bar (`CsScaleBar` + `SheetScaleBarListener`), Sheet Setup builds layouts live | `Core/CsLayoutGen.js`, `Core/CsScaleBar.js`, `SheetSetup/` |
| Retired | `CsSheetFile`, `SheetSetup.draw/intoCopy/plotSet/...`, `sheet_setup_run.js`, sheet path helpers, tile clip helpers, `CsProfileDraw` sheet anchoring | deleted |
| V5 | not built: annotation scale, viewport clip to polygon, sheet index table, section sheets, chunked-elevation arrangement offsets on sheets | open |

Decisions taken while building that the text above does not say:
- **Paper coordinates are drawing units** (measured; see Units decision).
- **Click-through editing is the composed model view**, not a paper-space
  pass-through (see that section).
- **Auto/edited/manual is a signature, not a flag a listener flips.** Undo
  restores "auto" by itself; a hand-made layout never had a signature.
- **A linked scale bar is not a hand edit**: its scale follows the viewport;
  only where it sits counts toward the signature.
- **Strings in a DXF are kept to ~1000 characters** by dxflib's reader; the
  generator job is stored in 700-character pieces.
- **Privacy**: viewports drop raster images (`CaveCAD/NoRaster`); proven with a
  control in `tests/layout_raster_run.js`.
- **Perf**: viewport export queries the spatial index (100k entities: 790 to
  220 ms per viewport).

Verification: stages 56-64 of `tests/run_all.sh` plus 55 older stages against
the dev engine; GUI flows checked live through the MCP bridge (tabs, paper,
edit through a viewport, scale list, lock, listener, undo/redo).

## Risks and open traps

- **DXF fidelity** (V1) is the largest unknown; the fallback is a blob.
- **Performance:** O(model entities × viewports) per regenerate until the
  spatial query lands. Measure in V0.
- **Rotated viewport contents:** frame is axis-aligned, content rotates;
  confirm clip rectangle stays correct (V0).
- **Listener-regenerated geometry** (Shaped Lines, Area Fill, linework warp)
  acts on model space; confirm no listener fires wrongly when the current
  block changes.
- **Two build trees:** header changes in shared engine classes need
  `qcadjsapi` rebuilt too, or heap corruption with no useful backtrace
  ([[cavecad-two-build-trees]]). Re-sign after deploy
  ([[cavecad-resign-after-deploy]]).
- **Test harness:** engine tests load Core by a hand-written list; new files
  must be added or they pass silently ([[cavecad-test-harness-traps]]).
- **Branch hygiene:** `viewport` must not be released until V3 passes; rebase
  onto `cavecad` / `legacy-map` periodically so it can merge cleanly.

## Decisions (settled)

1. DXF target: CaveCAD-private is fine; no AutoCAD interop (Nathan).
2. Migration: none; old tiles are regenerated, legacy path deleted (Nathan).
3. Layout tabs under the drawing, AutoCAD style (Nathan likes the familiar
   workflow).
4. **Auto sheets become manual on first hand edit, with Revert** (Nathan):
   - Every layout carries a mode: `auto` (generated and owned by Sheet
     Setup) or `manual` (owned by the caver). Layouts the caver creates
     are manual from birth.
   - An auto layout stores the generator inputs and a content signature of
     what it generated (viewports geometry/scale/twist/frozen layers, derived
     entity set). Re-running the generator rewrites auto layouts freely and
     never touches manual ones.
   - ANY edit to an auto layout by the caver (move/resize/scale a
     viewport, add/delete/modify a paper-space entity, change its page
     setup) flips it to manual: detected live by a transaction listener on
     the layout block (tab shows a "manual" badge) and, as a safety net,
     by comparing the stored signature at regenerate time.
   - **Revert to auto** (tab context menu, and a button in Sheet Setup)
     discards the manual edits, regenerates that layout from the generator
     inputs, and flips it back to auto. It confirms first, because it is
     destructive; the revert is one undoable transaction.
   - Sheet Setup shows which layouts are auto vs manual and, when the cave
     has grown or the scale changed, which manual layouts it left alone
     (so the caver can revert or hand-adjust them).
   - Furniture follows the same rule per entity: derived entities carry a
     tag; deleting one flips the layout to manual, and revert restores it.
5. Auto-managed tiles by default; entering a viewport is the advanced path.
