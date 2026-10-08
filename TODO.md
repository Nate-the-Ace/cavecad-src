# To do

Newest first. Move an item to "Done" when it ships.

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
