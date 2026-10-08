# To do

Newest first. Move an item to "Done" when it ships.

## Planned

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
