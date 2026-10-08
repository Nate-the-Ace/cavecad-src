# To do

Newest first. Move an item to "Done" when it ships.
Every new item gets a short preliminary plan when it is added (what exists, what changes, the order, the risks).

## Planned

### External references (xrefs) for drawings
Bring the visuals of another drawing into this one as a single unit, with a live link: when the
referenced drawing is saved, an open drawing that uses it offers to update.

**What the app already has (read from `src/core`, `scripts/Block`, `scripts/Widgets/BlockList`)**
- A block can carry an XRef file name (`RBlock::setXRefFileName`, `isXRef`); blocks brought in from an xref are
  named `<xref>|<name>` (`isFromXRef`); there is an `EntityXRef` entity type and `RBlockList` has an
  `xRefUpdated` signal and xref-only context-menu hooks.
- Each open drawing owns a file watcher (`RDocumentInterface::fileSystemWatcher`). When a watched file changes,
  `xRefFileChanged` remembers the path, and when you return to that drawing (`resume()`) it asks the main window
  to reload (`reloadXRefsSignal`). Undo/redo of the file-name property, and bind (turn the xref into a normal
  block) are also wired in `RDocumentInterface`.
- **What is missing:** the part that actually reads the other file. It is an interface, `RBlockProxy`
  (`loadXRef`, `unloadXRef`, `bindXRef`, `getFullXRefFilePath`), and nothing in this build implements it (in
  upstream QCAD that is a closed-source plugin). Nothing listens for `reloadXRefsSignal` either, so there is no
  "update?" prompt, and no Attach XRef command. So the plumbing exists but the feature does not.

**Preliminary plan**
1. Decide the approach (first task, a short spike):
   - (a) Write our own `RBlockProxy` in C++ (read the DXF/DWG with the existing import code into the xref block,
     names prefixed `xref|`). Most faithful, uses all the existing hooks, needs a native build for every platform.
   - (b) Do it in script: an "Attach drawing" command that imports the other file's visible geometry into a block
     (like Insert Block from file, which already exists), records the path and the file's modified time in the
     block, and re-imports on demand. No new native code, easy to ship through the tools-only fast path; but the
     existing watcher/prompt hooks would be bypassed.
   Recommendation: start with (b) for cave use (only plan/profile visuals are needed), keep the data model
   (block + file name + `|` names) identical so (a) can replace it later without breaking drawings.
2. Attach: "Attach drawing..." picks a file (cave shelf aware, paths stored relative so a cave folder can move),
   inserts one block reference carrying the whole visual, at a chosen point/scale/rotation. The drawing is
   treated as one unit: selecting any part selects the whole reference; its layers show under `xref|LAYER`
   and can be toggled/greyed as a group but not edited.
3. Dynamic link: watch the referenced file (reuse `fileSystemWatcher` for (a); a `QFileSystemWatcher` in the tools
   for (b)). On change, if the drawing is open show a non-blocking offer "<name> changed - update?" (Update now /
   Later / Always update this one). Also check on open and on layout switch for files changed while closed.
4. Management panel (an "External references" list like the Block list): status per reference (loaded, changed,
   missing, newer), Reload, Unload, Detach/Bind (make it a normal block), Re-path (the Relink idea Sketch Scans
   already has, `CsScanRelink`), Open the source drawing.
5. Cave specifics: referencing another cave's plan for context, a cave's profile into a sheet, or a survey into
   a regional map. Honour the georeference/anchor tags so the reference lands at the right place and north
   (`CsGeoProject`, anchor station), and a viewframe (see the sheet builder item) can use an xref as a view.
6. Output: xrefs must plot, export to PDF/DXF (DXF round trip: write the xref block with its path, plus an option
   to bind on export so the file opens anywhere), and package with the cave (`CsPackage`) including the
   referenced files.
7. Ribbon: a contextual "External Reference" tab when a reference is selected (Reload, Unload, Bind, Re-path,
   Open source), using the selection framework.
Risks: circular references (A uses B uses A) - detect and refuse; a missing file must never delete the cached
visuals (keep the last good copy); big references slowing the drawing (cache a simplified copy, regenerate on
update); coordinate/scale/unit mismatch between drawings; the same layer names clashing (the `xref|` prefix
solves this only if every import path honours it); updating a drawing someone has open on another computer.

### Sheet items as blocks that stay dynamic (north arrow bug)
Sheet page elements (north arrow, title block, scale bar, legend, border...) should each be a
**block**, so a sheet can be pieced together easily from parts. They must stay **dynamic**: the north
arrow block keeps rotating with its viewport's angle.

**Bug seen in testing:** after placing a north arrow and then moving it, the rotation is broken -- the
arrow turns around some displaced point instead of its own centre.

Likely cause (read from `Core/CsNorth.js`): the arrow is a set of loose pieces. Each is tagged with the
pivot it was placed at (`NorthAt`, text "x,y"), and `CsNorth.sync` rotates the pieces around that stored
pivot. Moving the pieces does not update the stored pivot, so the next sync rotates around the old spot.
(The "placed" variant instead turns each piece around its own position, which also scatters a
multi-piece arrow.) The scale bar (`Core/CsScaleBar.js`) keeps the same kind of stored anchor and probably
has the matching problem when moved.

Direction: make each item one block reference. Its insertion point is the pivot, so moving it can never
displace the pivot, and "follow the viewport" becomes setting the block reference's rotation (still keyed
to the viewport by the existing GUID link). Title block, legend and border become reusable blocks, and
this connects to the per-view sheet builder item below.

**Preliminary plan**
What already exists: `CsNorth.arrows` already knows a second kind of arrow, a *placed block reference* on
the `NORTH-ARROW` layer, and turns it about its own insertion point. So the target shape is already
half-supported; the generator just does not use it yet.
1. Reproduce: a test that places an arrow, moves it, turns the viewport, and checks every piece stayed on
   the arrow's own centre (fails today).
2. Quick safety fix first (small, ships alone): when `CsNorth.sync` finds loose pieces, take the pivot from
   the pieces' current position (their bounding-box origin) instead of the stored `NorthAt` text. Same for
   the scale bar's stored anchor. Stops the displaced rotation in old drawings immediately.
3. Define one block per item (`NORTH_ARROW`, `TITLE_BLOCK`, `SCALE_BAR`, `LEGEND`, `BORDER`) in the template /
   generated on demand, insertion point = the item's natural pivot. `CsLayoutGen.drawNorth` and friends insert
   a block reference instead of drawing loose lines.
4. Dynamic parts: the north arrow's rotation is the block reference's rotation. The scale bar's length and
   the title block's fields are the open question: block attributes (editable text in the reference) look
   right for the title block; the scale bar redraws its block *definition per viewport scale*, or stays a
   generated group but with the block-reference pivot rule. Decide when the quick fix is in.
5. One-time conversion of old loose-piece items to blocks (offer it; never silently), keeping the viewport link.
6. Ribbon: the Sheet Item tab already exists; add Rotate-with-viewport on/off and Re-place.
Risks: drawings already saved with loose pieces; DXF round trip of block attributes; the listener
(`SheetScaleBarListener`) must not loop when it rotates a block; the `LayoutCheck` and signature code
(`CsLayoutGen.signature`) read pieces and must learn about blocks.

Where it touches: `Core/CsNorth.js`, `Core/CsScaleBar.js`, `Core/CsLayoutGen.js` (draws the pieces),
`Core/CsLayoutFurniture.js`, the `LayoutNorthArrow` / `LayoutScaleBar` / `LayoutTitleBlock` / `LayoutLegend`
/ `LayoutBorder` tools, and the listeners that call `syncAll`. Needs a test: place, move, rotate the
viewport, check the arrow stays on its own centre. Existing drawings carry loose-piece arrows, so old ones
need a one-time conversion (or keep the old reading path).

### Sheet builder and viewframes that know each view
Make the sheet builder items and viewframes aware of each individual view in the drawing,
and offer to make a specific view from a list. The list holds:
- the cave's bounding box (the whole-cave plan view),
- each profile (elevation) in the drawing,
- each cross section in the drawing.

Choosing one creates a viewframe on the sheet framed to that view (right scale, right
extents), and the sheet items that belong to it (north arrow, scale bar, title) follow it.
**Preliminary plan**
What exists: the generator plans sheets for exactly two things, the cave's plan box (`caveBox`) and *one*
profile frame (`elevBox`), as jobs of kind "plan" / "elevation" (`CsLayoutGen.plan`). `CsLayoutGen.viewportOf`
turns a job's box into a viewport, and `OTHER_FRAMES` freezes the layers of the other views in it.
Profiles can be listed with `CsProfileBox.boxes(doc)` (one tagged rectangle per band, with a key). Cross
sections are the placed section blocks (callout kind "section") and their bays (`CsSectionBay`,
`SectionEdit.bayBoxOf`); a section's frame layers are the `SECTION-*` ones.
1. A "views" list: `CsViews.list(doc)` returns `[{id, kind: "plan"|"profile"|"section", label, box, frame}]`:
   the cave's bounding box first, then each profile band, then each cross section. Pure function plus one
   document reader, so it is testable with fake boxes like `CsLayoutGen.plan` is.
2. Generalise a job from "plan | elevation" to any view: `plan(o)` takes `o.views` instead of `caveBox` /
   `elevBox`; the per-view layer freezing uses the view's `frame` (plan, profile, section) so a profile
   viewframe shows profile layers only. Keep `caveBox`/`elevBox` working so existing sheets regenerate.
3. Scale: each view gets its own default scale (fit to the sheet), editable per view; the profile and section
   frames already have their own units.
4. UI: in the sheet builder and in New Viewport, a "Make a view of..." list (bounding box, each profile, each
   cross section, labelled by name). Picking one creates the viewframe framed to that view with the right
   frozen layers; multi-select makes several viewframes on one sheet.
5. Sheet items follow the view: the north arrow only on plan views, the scale bar per view, the title once per
   sheet. This is where it joins the sheet-items-as-blocks work above, so build that first, or at least the
   quick pivot fix.
6. Ribbon: the Viewport tab gets "Re-frame to..." with the same list.
Risks: a profile or section that is moved or deleted after a viewframe was made (the frame should show it as
stale rather than break); very tall or wide profile bands needing a different sheet orientation; tiling
(`CsSheetTile`) assumes plan only.

Where it touches: `cave-survey/scripts/CaveSurvey/LayoutNew`, `SheetSetup`, `LayoutDetail`,
`LayoutMatchViewport`, `Core/CsLayoutFurniture.js`, `Core/CsSheetSetup.js`, `Core/CsProfileBox.js`
(profile boxes), `Core/CsSectionBay.js` (cross sections). Layer rules for telling views apart:
`CsLayers.frameOf`.

### Contextual ribbon follow-ups
- Retake the Handbook screenshots before a public publish (the build lists which are stale).
- Add the new tab and button labels to the translation catalogs (`i18n/`).
- Area Fill tab: bring the Scale and Density controls into the tab.
- Callout tab: floor elevation and edit buttons (find the commands first).
- Entrance-layer objects and station-label text: decide whether they get a tab.
- Scan tab: turn and flip the scan image (these rewrite the scan file, so ask first).

### One repository
- Test the merged build, then move the side branch onto `cavecad`.
- Import the other tool branches (`i18n`, `profile-in-plan`, `th2-sketch`, `v2`, `github-versioning`).
- Archive `Nate-the-Ace/CaveCAD` and `Nate-the-Ace/cavecad-i18n` with a note pointing here.
