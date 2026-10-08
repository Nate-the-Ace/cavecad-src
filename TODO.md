# To do

Newest first. Move an item to "Done" when it ships.
Every new item gets a short preliminary plan when it is added (what exists, what changes, the order, the risks).

## Status of the work done on this branch (untested in the app: nothing here has been run in CaveCAD itself)

Built and checked as far as this build machine can: syntax, the packaging checks (`tools/make_package.sh`),
and unit tests of the pure logic. The tests that need the real engine (`tests/north_arrow_run.js` and the
other `*_run.js`) are written but have NOT been run. Try each in the app before relying on it.

### Done
- Contextual ribbon: selection tabs for shaped lines, scans, callouts, cross sections, area fills, stations,
  survey shots, symbols, profiles, sheet items, the surface (aerial/contours), plain cave lines, section
  drawings and external references; layer-aware; tabs take focus; Layout tab follows the layout.
- North arrow fixed: ONE block, its insertion point is the pivot (a move can no longer displace the turn);
  text never rotates (and stays upright even if the block itself is rotated); old loose-piece arrows still read.
- Sheets from Views: a sheet of the whole cave, each profile or each cross section (`CsViews`, the generator's
  `views`/`skipPlan`, the `LayoutViews` command, handbook page, ribbon button).
- External references: Attach Drawing (Overlay/Attach, Absolute/Relative, remembered defaults, Overlay+Absolute to
  begin with), External References manager, update offer when the file changes, ribbon tab (`CsXref`).
- Area Fill tab: Scale and Density controls.
- **Sheet number = Layout tab name, both ways** (`CsSheetLink`, `SheetNameListener`, `CsLayoutGen.refreshNames`): a new
  "Sheet:" title block field; renaming the tab rewrites it, the "SHEET A1" corner label, the neighbours' match lines
  and the sheet index; editing the field renames the tab (a name that is not allowed is refused and the line is put
  back). A generated sheet is now found by its job id, so a renamed tab is still that sheet. The sheet signature
  has a new recipe (version 2) so a rename or a linked field is not a hand edit; older sheets are still read with
  the first recipe.
- **Title block = ONE block with a field (block attribute) per line** (`CsTitleBlock`): linked fields (cave name,
  surveyed by, dates, length, depth, survey code) follow the notebook; typing over one makes it manual; Location is
  never linked; Refresh from notebook / Link field to notebook on the Sheet Item tab. Falls back to the old loose
  text lines if making the block fails, and `CaveSurvey/TitleBlockAsBlock` = false switches it off.
- One repository: `cave-survey/` and `i18n/` merged into this repo with history; builds read from it.

### Still to do, from the items below
- **Sheet items as blocks**: the NORTH ARROW and the TITLE BLOCK are blocks now. The scale bar (must stay dynamic),
  the grid (must BECOME dynamic), the sheet index and the border are still loose pieces; the legend needs none. Each has readers that expect pieces (`CsScaleBar.pieces/anchorOf`, `SheetSetup.titleValues`
  reads the title's text entities, `CsLayoutFurniture.hasBorder`, the signature rows, `LayoutCheck`), so each
  conversion should be made and tried in the app one at a time, the way the north arrow now can be.
- **Sheets from Views**: Viewport-tab "Re-frame to...", editing a view's scale before making it, marking a sheet
  stale when its profile/section moved, tiling for profile/section views.
- **External references**: package/share conversion of absolute paths to relative (`CsPackage`), the DXF
  bind-on-export option, cave-shelf awareness, georeference placement, a cached simplified copy for big
  references, nested-block name prefixing (a nested block of the same name in two drawings merges), and the
  engine-run test (attach, change the file, update; Overlay vs Attach nesting).
- **Callout tab**: floor elevation and edit buttons (no standalone command exists; the Callout panel does it).
- **Entrance-layer objects and station-label text**: decide whether they get a tab.
- **Scan tab**: turn and flip the scan image (rewrites the scan file; ask first).
- **Translations**: new labels need adding to `i18n/` (needs Qt's `lupdate`, not on the build machine).
- **Handbook**: retake the stale `handbook-panel.png` before a public publish.
- **Repo cutover**: test the merged build, then move this branch onto `cavecad`; import the other tool branches
  (`i18n`, `profile-in-plan`, `th2-sketch`, `v2`, `github-versioning`); archive the two old repos.

## Planned

### Sheet number = the Layout tab name, both ways
Changing the sheet number on the sheet changes the Layout tab's name, and renaming the Layout tab changes the sheet
number.

**What exists (read from `Core/CsLayoutGen.js`, `Core/CsSheet.js`, `scripts/Layouts/Layouts.js`, `LayoutTabs.js`)**
- There is NO sheet-number field today. `CsSheet.FIELDS` (the title block's fields) has none. The only sheet label
  is "SHEET A1" on a tiled plan, drawn top-left from the tile's id (`CsLayoutGen.draw`, ~line 375). On a one-sheet
  plan there is no label at all, and the tab is just "Plan" (or "Elevation").
- For tiled sheets the layout NAME already equals the tile id (`job(t.id, ...)`: id = name), so the two start equal.
- Renaming goes through one place, `Layouts.rename(di, name, newName)` (called by `LayoutTabs.rename`). It enforces:
  unique, not empty, not "Model", not starting with "*".
- **A generated sheet is found by its NAME** (`Layouts.get(doc, job.name)` in `CsLayoutGen.generate`; the
  `revert`/`stamp` code does the same). So today, renaming a generated sheet's tab makes the next Sheet Setup build
  forget it and make a new "A1" beside the renamed one. This has to be fixed first or two-way linking cannot work.
- Match lines on a tiled plan name their neighbour ("matches B2"): they would go stale on a rename.
- The sheet index (`LayoutIndex`) lists layout names and is rebuilt only when it is added again.

**Preliminary plan**
1. **Stable identity.** Store the job's `id` on the layout (the stored job already has it; also keep it as its own
   layout property) and make `generate`/`revert`/`state` find a layout by that id first, by name second. Then a
   renamed sheet is still "the A1 sheet". Test: generate, rename the tab, generate again: no extra sheet appears.
2. **A sheet-number field.** Add `sheetNumber` ("Sheet:  ") to `CsSheet.FIELDS`, drawn in the title block of every
   sheet (single sheets too, so "Plan" reads "SHEET: PLAN"). Its text is the layout name, as a special LINKED field
   (see the title block item: the link type is "layout name", and it works both ways). The old "SHEET A1" corner
   label becomes the same field's value.
3. **Name -> number.** One hook inside `Layouts.rename` (like the existing `Layouts.stateOf` hooks) calls
   `CsLayoutGen.afterRename(doc, di, old, new)`: it rewrites that sheet's sheet-number field, the "SHEET x" label,
   its neighbours' match-line text (labels carry `MatchTo=<job id>` so they are rewritten from names, not parsed),
   and the sheet index text. One undo step, joined to the rename's transaction group.
4. **Number -> name.** The transaction listener (same pattern as `SheetScaleBarListener`, busy flag and all) hears
   an edit to a text/attribute tagged `TBField=sheetNumber` on a layout. It calls `Layouts.rename` with the typed
   value. If the name is refused (duplicate, empty, "Model", starts with "*") the field is put back to the layout's
   name and one message says why. Editing it never leaves the tab and the sheet disagreeing.
5. **Sheet Setup build** reads the sheet number from the layout (never invents "A1" over a renamed sheet) and a
   rename made while the panel is open refreshes the panel.
6. **Edge cases to decide:** a name longer than fits the title block (shrink/wrap); duplicating a layout
   (the copy needs a new unique name and number); "Sheet 3 of 12" counts (not asked for; leave); the plot/PDF file
   name uses the layout name already.
Risks: the rename hook runs inside an undoable operation, so the follow-up edits must join its group; the
edit-hearing listener must ignore the rename's own rewrite (busy flag); drawings saved before this have no
sheetNumber field (add it on the next build, never over a hand-made title block).

### Layout items as blocks: what benefits, and a title block with linked fields
(Investigated by reading `Core/CsLayoutGen.js`, `CsLayoutFurniture.js`, `CsScaleBar.js`, `CsSheet.js`, `CsSheetSetup.js`.)

**Ranked by benefit.** "Benefit" = one object to select, move, copy and reuse, with its dynamic behaviour kept.
1. **Title block - highest.** Today it is loose text lines, each tagged `TBField=<field id>` (`CsSheet`), plus a white
   backing rectangle. It was loose text on purpose: older builds kept it in `TB_*` blocks and editing a field
   needed a dedicated tool. Attributes (below) keep double-click editing, so the block comes back without that cost.
2. **Scale bar - high. MUST STAY DYNAMIC** (it is today: see below; the block version must redraw its definition whenever the viewport's scale changes, by any route, including undo/redo, and a test must prove it). Many pieces (base, ticks, numbers, caption, unit) redrawn whenever the viewport scale
   changes. Same shape as the north arrow now: one block per viewport link, redefined on a scale change, the
   reference's insertion point is the baseline start (`CsScaleBar.anchorOf` already reads that point).
3. **Grid - high. MUST BECOME DYNAMIC, and TODAY IT IS NOT.** `CsLayoutFurniture.addGrid` draws the ticks and
   labels once, from the viewport's scale, centre, size and view centre at that moment, and nothing watches
   afterwards (only `LayoutGrid` calls it; there is no sync and no listener). Pan, zoom, change the scale, or
   resize the viewport and the grid is left behind. As one block per viewport it would redraw its definition
   whenever any of those change.
   - Link it to its viewport by GUID like the north arrow and scale bar (`GridOf` already carries the GUID).
   - Keep the grid's own choices on the block reference (`GridAbsolute` = true/false, the origin used), so a
     redraw needs nothing but the viewport.
   - Triggers to watch, beyond scale: the view centre (pan), size (resizing grips), the step that fits
     (`gridStep` changes as scale changes, so ticks get denser or sparser), and rotation. Extend the existing
     `SheetScaleBarListener` (it already hears every viewport change and syncs the bar and arrow) to sync grids too.
   - A rotated or clipped viewport is refused today ("a grid goes round a rectangular viewport that is not
     turned"). Dynamic version: when a viewport becomes rotated or clipped, the grid is hidden (kept, not deleted) and
     a message says why; it comes back when the viewport is plain again.
   - Test: place a grid, change the viewport scale, pan it, resize it: the ticks and labels follow each time, a
     second sync writes nothing, and undo/redo keep it in step.
4. **Sheet index - medium.** A list of text lines (`SheetIndex`), rebuilt when re-added. A block gives one object
   to move; its content is regenerated from the layouts list.
5. **Border - medium.** Four lines on `BORDER`. Mainly useful as a reusable template piece
   (`CsLayoutTemplate` saves a sheet's pieces); it follows the paper size, so the generator redraws its
   definition when the paper or margin changes. The white "backing" rectangles behind the furniture should
   become part of their block.
6. **Detail marks - low.** A circle and a letter that tie a detail viewport to its callout; fine as they are.
7. **Legend - none needed.** It is already one object (a viewport onto the model-space legend).
8. **Tile labels and match lines on tiled sheets - leave.** Generated per sheet; nobody assembles these.

**The title block, with fields linked to the notebook**
- ONE block per sheet. The definition holds the fixed parts (heading rule, backing); each field is an
  **attribute** (a QCAD block attribute: tag = the field id from `CsSheet.FIELDS`, prompt = its label, text = its
  line). The reference carries one attribute entity per field, in the layout's block, double-click editable like text.
- Keep every existing reader working by tagging each attribute entity `TBField=<id>` too: `CsSheet.taggedTexts`,
  `SheetSetup.titleValues`, `CsLayoutCheck`, `CsLayoutTemplate`, Survey Stats' stamping and Check Map then see
  attributes exactly as they see text today (the attribute's text is the same full line, prefix included).
- **Linked fields.** The notebook already produces the values (`CsSheetSetup.autoFill(survey, stats, grade)`):
  cave name, surveyed by, survey dates, length, depth, survey code. Each of those attributes carries a link:
  `TBLink = auto` (follows the notebook) or `manual` (someone typed over it), and `TBAuto` = the last value the
  link wrote. A sync step (like `CsNorth.sync`) rewrites an `auto` attribute whose notebook value changed. If the
  attribute's text no longer equals `TBAuto`, a person edited it: it flips to `manual` and is never overwritten
  (the suite's rule: a value already typed is never replaced by nothing or by a guess).
- **Location is never linked** (`CsSheetSetup.locationFor` answers empty on purpose; a person types it).
  Cartography by, personnel, copyright, survey method and legend note stay manual fields.
- A "Re-link" button (Title Block tab) sets a manual field back to `auto`; "Refresh from notebook" runs the sync.
- Where the sync runs: after Sheet Setup builds, after Survey Stats, after a notebook save, and from the button.

**Order of work:** (1) title block block+attributes with the sync, because it is the request and the readers are
known; (2) scale bar; (3) grid; (4) index and border. Each is made and tried in the app before the next.
**Risks:** attribute entities inside references behave differently on copy/explode (an exploded title block must
keep its text); the DXF round trip of attributes (check it opens in other CAD programs); old drawings with loose-text
title blocks and `TB_*` legacy blocks must keep reading (convert only on request); `CsLayoutGen.signature` must
count attribute text so a hand edit still marks a sheet "edited"; the layout-template save/load code
(`CsLayoutTemplate.js:457`) reads the tagged texts and must handle attributes.

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
2. Attach: "Attach drawing..." picks a file (cave shelf aware), asks the two options below, and inserts one
   block reference carrying the whole visual, at a chosen point/scale/rotation. The drawing is treated as one
   unit: selecting any part selects the whole reference; its layers show under `xref|LAYER` and can be
   toggled/greyed as a group but not edited.

   **Attachment style** (chosen per reference):
   - **Overlay** - a visual only. This drawing sees the other drawing's own geometry, but not anything that
     drawing has itself referenced. If drawing B is overlaid into A and B has xrefs of its own, those do not come
     along into A. Also safe against loops: overlaying never makes the other drawing depend on this one.
   - **Attach** - inherits the geometry and brings it along. If B has xrefs (overlay or attach) of its own, A
     gets those too, one level at a time, as part of B. Use it to build a regional map out of caves that are
     themselves built from references.
   Rules: Attach carries nested references with it; Overlay stops at the first level; an Attach chain that
   leads back to the drawing itself is refused (loop check), an Overlay that does so is allowed (it adds
   nothing back). The style can be changed later without re-attaching (Overlay <-> Attach), and either can be
   made a plain block (Bind).

   **Path style** (chosen per reference): **Absolute** (the full path; first choice) or **Relative** (kept
   relative to this drawing, so a cave folder can be moved or shared). Switching a reference between them later
   is a button, and packaging/sharing a cave (`CsPackage`) offers to convert absolute paths to relative ones
   so the package opens on another computer. A missing file under an absolute path is reported with its full
   path; under a relative one, with where it looked.

   **Defaults:** whatever the user picks last becomes the default the next time (kept in the user's settings,
   one for style and one for path). The shipped/template defaults, used until the user has picked anything and
   for the cave template, are **Overlay** and **Absolute**. The attach dialog shows both choices with the
   remembered one selected.
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
Risks: circular references (A attaches B attaches A) - detect and refuse (Overlay is exempt, see above);
absolute paths breaking when a drawing is copied to another computer (the package conversion and a clear
"missing file" message are the answer); which style to choose being unclear to a new user (the dialog
explains each in one line); a missing file must never delete the cached
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
has the matching problem when moved. (Checked: the scale bar reads its anchor from its pieces' current position, so it does not have this bug.)

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
2. DONE in the working branch (needs a run on a real engine): quick safety fix (small, ships alone): when `CsNorth.sync` finds loose pieces, take the pivot from
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
