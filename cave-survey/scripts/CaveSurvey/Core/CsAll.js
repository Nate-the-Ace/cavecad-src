// All.js -- includes the whole Core library in dependency order.
//
// Tools include this one file instead of maintaining their own list:
//
//   include(includeBasePath + "/../Core/CsAll.js");
//
// (Deliberately NOT named Core.js: a file named after its folder is
// how QCAD recognises a TOOL, and Core is a library.)
//
// EVERY library file is Cs-prefixed because CaveCAD's include() DEDUPES
// BY BASENAME: a file sharing a name with anything the application has
// already included -- and it includes hundreds of scripts at startup,
// among them Draw.js -- is skipped SILENTLY. That shipped as CsDraw
// being undefined in the GUI while every test passed headless (where
// no stock add-ons load). The prefix makes collision impossible.

// No dependencies of its own, so first.
include(includeBasePath + "/CsUuid.js");
// No dependencies either: how a tool tells the caver something they
// will see (warning() only reaches stderr).
include(includeBasePath + "/CsTell.js");
include(includeBasePath + "/CsUnits.js");
include(includeBasePath + "/CsLinetype.js");
include(includeBasePath + "/CsLinetypeStore.js");
include(includeBasePath + "/CsCave.js");
include(includeBasePath + "/CsFiles.js");
// After CsCave: the shelf reads CsCave.SCANS/PDF when it scans a cave
// folder, and CsCave.driveRoots when a save registers itself.
include(includeBasePath + "/CsShelf.js");
// Pure tree model over CsCave.filesUnder's relative paths -- the
// folder rows, collapse rules and collapsed-state settings format
// behind Sketch Scans' list.
include(includeBasePath + "/CsScanTree.js");
// Pure walk-order + assigned-stations logic behind Align Image's
// station assumption. Needs only a CsModel-shaped survey at call time.
include(includeBasePath + "/CsStationOrder.js");
include(includeBasePath + "/CsPackage.js");
include(includeBasePath + "/CsGeoProject.js");
include(includeBasePath + "/CsContour.js");
// After CsGeoProject (ground-window and Mercator math) and CsContour
// (marching squares over the elevation grid) -- CsSurfaceData's two
// passes call straight into both.
include(includeBasePath + "/CsSurfaceData.js");
// After CsPackage (whose GEO_TAGS it strips) and CsSurfaceData (whose
// eraser it refuses to work without): writing a copy of a drawing with
// the cave's location taken out. Package Cave and the teaching cave
// share it -- two implementations of the suite's first rule is one
// that will be updated and one that will not.
include(includeBasePath + "/CsSanitize.js");
// After CsPackage (safeName) and CsSanitize (which makes the pristine
// copy): where the teaching cave lives and what resetting it means.
include(includeBasePath + "/CsTeach.js");
include(includeBasePath + "/CsAngles.js");
// No dependencies of its own -- CsLayers.DEFAULTS is only read inside
// the assertions that check the catalog against it (tests/js_unit.js),
// never at load time here.
include(includeBasePath + "/CsArea.js");
include(includeBasePath + "/CsIgrfCoeffs.js");
include(includeBasePath + "/CsGeomag.js");
include(includeBasePath + "/CsModel.js");
include(includeBasePath + "/CsFrontier.js");
include(includeBasePath + "/CsTraverse.js");
include(includeBasePath + "/CsNetwork.js");
include(includeBasePath + "/CsAdjust.js");
include(includeBasePath + "/CsLrud.js");
// After CsTraverse (whose isPlumb/PLUMB_DEG decides what counts as a
// pitch at all) and beside CsLrud: the vertical in a cave as a thing
// rather than a list of legs, and the label a map puts beside it.
include(includeBasePath + "/CsPitch.js");
// After CsFrontier (open ends) and CsPitch: the table reads the
// frontier, and the trip plan reads pitches.
include(includeBasePath + "/CsStationTable.js");
// Pure sidecar logic for the Station Table's marks and notes.
include(includeBasePath + "/CsStationStore.js");
// stations.json on disk, shared by Station Table and Expedition Planner.
include(includeBasePath + "/CsStationSidecar.js");
// After CsStationTable and CsPitch: routes over the survey graph and
// reads pitches for its vertical steps.
include(includeBasePath + "/CsTripPlan.js");
// After CsTripPlan, whose route text, SVG and clock the card reuses.
include(includeBasePath + "/CsCalloutCard.js");
// The teams engine: per-team dates, conflicts, windows, file names.
include(includeBasePath + "/CsTeams.js");
// Squeeze view: who fits where. Before CsTeamSplit, which calls its sentence and fit rule.
include(includeBasePath + "/CsSqueeze.js");
// Suggest split: proposes each team's people and stops (CsTeams, CsTripPlan, CsPeople).
include(includeBasePath + "/CsTeamSplit.js");
// What's left to push: ranks every lead with reasons (CsStationTable, CsTripPlan).
include(includeBasePath + "/CsPushRank.js");
// Forecast lookup for the callout card. Independent of the survey engines.
include(includeBasePath + "/CsWeather.js");
include(includeBasePath + "/CsCalloutLocal.js");
// The people directory (people.json, per-user) and the trip party.
include(includeBasePath + "/CsPeople.js");
include(includeBasePath + "/CsGhost.js");

// The 3D passage surface. After CsTraverse and CsLrud, whose splay
// offsets and junction counts it reuses rather than re-deriving.
include(includeBasePath + "/CsMesh3d.js");
include(includeBasePath + "/CsScanFit.js");
include(includeBasePath + "/CsScanFrame.js");
include(includeBasePath + "/CsScanTrim.js");
include(includeBasePath + "/CsScanPdf.js");
include(includeBasePath + "/CsScanRotate.js");
include(includeBasePath + "/CsScanReanchor.js");
include(includeBasePath + "/CsSectionCut.js");

// A captured cross section, standing in the 3D view. After CsSectionCut,
// whose frame it reuses rather than deriving again.
include(includeBasePath + "/CsSection3d.js");
include(includeBasePath + "/CsSectionDraw.js");
include(includeBasePath + "/CsSectionBay.js");
// The extended elevation: CsProfile (pure geometry) needs CsLrud above
// for splaysByStation/legCounts; CsProfileDraw needs CsLayers/CsTags/
// CsDraw, but only inside function BODIES (RVector, RLineEntity, ...),
// never at load time -- defining a function that REFERENCES a Cs*
// global does not touch that global until the function actually runs,
// so this placement matches tests/js_unit.js's own CORE_FILES order
// (which loads these three right after CsLrud, well before CsLayers/
// CsTags/CsDraw) rather than needing to sit after them here too.
include(includeBasePath + "/CsProfile.js");
// After CsProfile, whose band shape it produces and whose
// bandWallRuns it calls: the PROJECTED elevation, which is a mode of
// the same view rather than a second one.
include(includeBasePath + "/CsProject.js");
// After CsProject, whose per-piece projection it calls, and CsPitch,
// whose drops decide where it cuts: the cave in pieces, so an
// elevation can be arranged rather than merely generated.
include(includeBasePath + "/CsChunk.js");
include(includeBasePath + "/CsProfileDraw.js");
include(includeBasePath + "/CsCallout.js");
// After CsModel/CsTraverse/CsLrud/CsProfile (it uses classifySplay and
// offset) and after CsCallout (it uses BASIS_FLOOR/BASIS_LINE).
include(includeBasePath + "/CsElevation.js");
// After CsContour (grids, marching squares), CsGeoProject (the grid
// transform) and CsElevation (the datum offset it places terrain by).
include(includeBasePath + "/CsTerrain3d.js");
// After CsContour and CsGeoProject (it samples the same grid through
// the same transform) and after CsMesh3d (it reads the LRUD at a
// station to find the ceiling).
include(includeBasePath + "/CsCover.js");
// After CsMesh3d (trip labels, distances, LRUD) and CsLrud (splays).
include(includeBasePath + "/CsStationCard.js");
include(includeBasePath + "/CsValidate.js");
include(includeBasePath + "/CsStats.js");
include(includeBasePath + "/CsGrade.js");
include(includeBasePath + "/Format/CsCompass.js");
include(includeBasePath + "/Format/CsWalls.js");
include(includeBasePath + "/Format/CsSurvex.js");
include(includeBasePath + "/Format/CsCsv.js");
include(includeBasePath + "/Format/CsTherion.js");
include(includeBasePath + "/Format/CsTherion2.js");
include(includeBasePath + "/Format/CsRegistry.js");
include(includeBasePath + "/CsLayers.js");
include(includeBasePath + "/CsLayerVariants.js");

// After CsLayers, whose frameOf it reuses: which starter group each
// layer belongs in, for the template sync and Repair Drawing's filing
// pass. Pure but for fileInto, the way CsLayers is pure but for ensure.
include(includeBasePath + "/CsLayerGroups.js");
// After CsLayers and CsLayerVariants: CsRestyle re-applies
// CsLayers.styleOf to layers that already exist, and resolves variant
// layers through CsLayerVariants.baseOf.
include(includeBasePath + "/CsRestyle.js");
include(includeBasePath + "/CsRebuild.js");
include(includeBasePath + "/CsCalloutSync.js");
// After CsRebuild, CsCalloutSync and CsRestyle: CsRepair calls all three.
include(includeBasePath + "/CsScanRelink.js");
include(includeBasePath + "/CsRepair.js");
include(includeBasePath + "/CsBackup.js");
include(includeBasePath + "/CsTrace.js");
include(includeBasePath + "/CsStore.js");
include(includeBasePath + "/CsTags.js");
// After CsLayers (STYLES reads layer constants at eval time), CsTrace
// (spacingFor) and CsTags (spine/decor tag IO).
include(includeBasePath + "/CsShapeLine.js");
// The Therion sketch vocabulary, in CaveCAD's own terms. After
// CsLayers, CsSymbols, CsArea and CsShapeLine: its tables name what
// those four define, and they are read at load.
// How much a piece of this map is worth trusting. Pure, and no
// dependencies: every other file may read it.
include(includeBasePath + "/CsProvenance.js");
// How big a legacy map is and which way it faces. After CsScanFit
// (the point fit is its) and CsUnits.
include(includeBasePath + "/CsCalibrate.js");
include(includeBasePath + "/CsSketch.js");
// After CsShapeLine (a shaped line is erased whole, spine and ornament)
// and CsTrace (docKey, and the pick distance is TIE_FEET's twin).
// After CsTags (reads ProfileBox tags) and CsTrace (region fallback).
include(includeBasePath + "/CsProfileBox.js");
// CsBind before CsDraw: eraseStations calls CsBind's suffix strippers,
// so the erase rules and the binding index cannot disagree about which
// station a tip name belongs to.
include(includeBasePath + "/CsBind.js");
// After CsTags, CsBind and CsLayers -- CsFocus calls all three.
//
// KEPT although the Trip Focus TOOL is frozen and its folder removed
// (docs/FROZEN.md). This is a pure Core library, not the viewer, and
// tests/js_unit.js uses CsFocus.isVisible as the observable for a
// WALL-RUN CONTINUITY regression -- a feature that does ship. Deleting
// the library would delete a guard on live code.
include(includeBasePath + "/CsFocus.js");
include(includeBasePath + "/CsDraw.js");
include(includeBasePath + "/CsWarp.js");
// Landing a Therion scrap on the survey: CsScanFit does the fit and
// CsWarp the bend, so it sits after both -- though it calls them only
// when it runs, never at load.
include(includeBasePath + "/CsSketchPlace.js");
// The write half: after CsTrace, CsShapeLine, CsArea, CsSymbols and
// CsDraw, whose doors it writes through so an imported wall IS a
// traced wall.
include(includeBasePath + "/CsSketchDraw.js");
// Which sketches are already here, and which sit beside the survey.
include(includeBasePath + "/CsSketchStore.js");
// The words a caver reads afterwards. Pure, and tested as such.
include(includeBasePath + "/CsSketchReport.js");

// A scanned sketch laid onto the passage. After CsWarp, whose
// inverse-square weighting it follows.
include(includeBasePath + "/CsDrape.js");
include(includeBasePath + "/CsFly.js");
include(includeBasePath + "/CsRevise.js");
// After CsRevise (it borrows withOffLayersOn) and CsModel/CsTags: the
// per-trip metadata editor, which retags trip anchors and touches no
// geometry at all.
include(includeBasePath + "/CsTripEdit.js");
// After CsModel and CsRevise (it shares their epsilon and their survey
// shape): the gate behind Survey Notebook's incremental Draw.
include(includeBasePath + "/CsDelta.js");
// After both CsBind and CsRevise: CsProfileBind calls into each.
include(includeBasePath + "/CsProfileBind.js");
include(includeBasePath + "/CsPick.js");
include(includeBasePath + "/CsLocationPick.js");
// After CsLocationPick (it reads anchorRecord's shape) and CsLayers:
// the rules for emptying a drawing without losing its images or its
// location.
include(includeBasePath + "/CsReset.js");
// Pure prose: what each symbol and each traced feature MEANS, for
// the panels' tooltips and the legend. Keyed by CsSymbols block
// name and by FeatureTrace row, so it loads before both.
include(includeBasePath + "/CsHelp.js");
include(includeBasePath + "/CsSymbols.js");
// After CsSymbols (it answers with catalogue rows and refuses to
// overwrite a shipped one), CsLayers (it ensures a symbol's home
// layer in both directions) and CsTags (the marker point inside a
// custom block is a property group).
include(includeBasePath + "/CsSymbolStore.js");
// After CsLayers and CsShapeLine (panel tiles are painted from the
// layer appearance one and the generated ornament of the other), after
// CsSymbolStore (an Area Fill scatter tile reads block geometry the
// same way a symbol tile does) and after CsArea, already loaded far
// above, whose placements() an Area Fill tile actually rolls.
include(includeBasePath + "/CsTileArt.js");
// Panel furniture shared by every dock: collapsible sections and
// the memory of which ones are shut. One copy, so a panel feature
// asked for in one panel is a panel feature both have.
include(includeBasePath + "/CsPanel.js");
// The scan preview: an embedded QCAD view over a throwaway document
// holding one scanned page. GUI context only, like CsPanel above, and
// shared -- Sketch Scans traces against it and the Survey Notebook
// types off it.
include(includeBasePath + "/CsScanView.js");
// The scans browser itself: a folder tree on a table, with the tick
// that says which pages a caver has finished with. Sketch Scans traces
// from it and the Survey Notebook types from it -- two browsers over
// one folder would be two answers to "which have I done".
include(includeBasePath + "/CsScanList.js");
include(includeBasePath + "/CsScanBrowser.js");
include(includeBasePath + "/CsSheet.js");
include(includeBasePath + "/CsReport.js");
// After CsLayers, CsSymbols, CsSheet, CsShapeLine, CsStats and
// CsRevise -- the map proofreader reads all of them, and its scan half
// calls into each when it runs.
include(includeBasePath + "/CsCheck.js");
// After CsHelp (the labels and sentences a legend prints), CsSymbols,
// CsLayers, CsShapeLine and CsBind -- the legend decides what a map
// USES by reading all of them.
include(includeBasePath + "/CsLegend.js");
// After CsSheet (the title block's fields), CsStats/CsGrade (the
// numbers it fills in) and CsReport (how a length is worded): the plot
// scale arithmetic that turns inches of paper into feet of cave.
include(includeBasePath + "/CsSheetSetup.js");
// After CsSheetSetup, whose margin it lays tiles out by:
include(includeBasePath + "/CsSheetTile.js");
// After CsSheetSetup, whose boxes and snapping arithmetic it draws:
// the Sheet Setup preview, as an embedded QCAD view a caver can drag
// the furniture around in. GUI context only, like CsScanView above.
include(includeBasePath + "/CsSheetView.js");
// After CsSheetSetup, CsSheetTile, CsLayers, CsTags and CsDraw: Sheet Setup's
// output as LAYOUTS (viewport branch). Needs the engine's own Layouts API
// (scripts/Layouts/Layouts.js, loaded first); plan() is pure and also loads
// under node, where include of an engine script does not exist.
if (typeof Layouts === "undefined" && typeof include === "function" && typeof QFileInfo !== "undefined") {
    include("scripts/Layouts/Layouts.js");
    include("scripts/Layouts/LayoutPlot.js");
}
// The sheet furniture blocks' shared plumbing (needs CsLayoutGen at run time only).
include(includeBasePath + "/CsSheetBlock.js");
include(includeBasePath + "/CsScaleBar.js");
include(includeBasePath + "/CsNorth.js");
include(includeBasePath + "/CsLayoutFurniture.js");
include(includeBasePath + "/CsLayoutTemplate.js");
include(includeBasePath + "/CsLayoutPlot.js");
include(includeBasePath + "/CsLayoutCheck.js");
include(includeBasePath + "/CsLayoutGen.js");
// After CsProfileBox and CsCallout: the list of views a sheet can be made of.
include(includeBasePath + "/CsViews.js");
// External references: another drawing's visuals as one linked unit (needs CsTags).
include(includeBasePath + "/CsXref.js");
include(includeBasePath + "/CsSplit.js");
// The title block's linked fields and the sheet number = layout name (pure).
include(includeBasePath + "/CsSheetLink.js");
// The title block as one block with a field per line, and the linked-field sync (after CsLayoutGen, CsSheet, CsSheetLink).
include(includeBasePath + "/CsTitleBlock.js");
// After CsAdjust (whose per-station shifts it draws) and CsNetwork
// (whose loops it labels): turning a closure percentage into arrows.
include(includeBasePath + "/CsClosure.js");
// After CsLayoutGen (and the engine's Layouts): the refusal every editing
// tool owes a SHEET (a layout showing instead of the cave).
include(includeBasePath + "/CsModelSpace.js");

// After CsModel, CsTraverse, CsProfile and (optionally) CsRevise --
// CsContrib calls ensureTrips, offset, groupRuns and tripLabel.
include(includeBasePath + "/CsContrib.js");

// Depends on nothing in this library: the handbook's index and page
// lookups read files beside the add-on, not the drawing.
include(includeBasePath + "/CsHandbook.js");

// After CsHandbook: the lessons are the handbook's own process
// pages, and the steps are lifted out of them.
include(includeBasePath + "/CsGuide.js");
