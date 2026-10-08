# To do

Newest first. Move an item to "Done" when it ships.
Every new item gets a short preliminary plan when it is added (what exists, what changes, the order, the risks).

## Planned

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
