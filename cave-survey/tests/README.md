# Tests

Fourteen stages, cheapest first, all driven by one script:

    ./tests/run_all.sh             what has to pass while developing
    ./tests/run_all.sh --publish   also what has to pass before releasing

What is under test, and where it lives:

    scripts/CaveSurvey/     the QCAD add-on -- the source of truth
    templates/              drawing templates several tests build against
    testdata/               survey fixtures used by the parser tests

## Setup

Everything here is stdlib Python plus CaveCAD's own script engine -- no
virtualenv, no `pip install`, nothing to skip cleanly if it's missing:

    python3 -m unittest discover -s tests -v

`tests/test_addon.py` imports only `os`, `re`, `shutil`, `subprocess`,
`tempfile`, `unittest` and `xml.etree.ElementTree`.

## Stage 1/11 -- `test_addon.py` (structural tests)

Checks the add-on's structure without running any of it: every tool lives in
a folder named after it, nothing loose sits beside `CaveSurvey.js`,
`setScriptFile` points at its own file, referenced icons actually exist, no
two tools share a `(groupSortOrder, sortOrder)` pair, every `Core/` file is
`Cs`-prefixed (QCAD's `include()` dedupes by basename -- an unprefixed file
sharing a name with anything QCAD already loads at startup is skipped
silently), every layer `Core/CsLayers.js` defines exists in
`NSS_Cave_Template_PLAN.dxf` -- with no exemptions, and including the
profile frame, since the elevation is drawn into the plan drawing -- and
that no standalone `NSS_Cave_Template_PROFILE.dxf` has come back. These are the failures that
otherwise show up as a tool mysteriously absent from the menu, or a layer
silently missing from a fresh drawing.

## Stage 2/11 -- `js_syntax.js` (add-on syntax check)

Parses every script under `scripts/CaveSurvey/` inside QCAD's own ECMAScript
engine, by wrapping each in a function expression and `eval`-ing it -- which
parses without executing, so no dialog opens and `RMainWindowQt` is never
touched. Catches a syntax error that would otherwise surface only as a tool
silently missing from the menu at runtime.

## Stage 3/11 -- `js_unit.js` (Core unit tests)

Unit tests for `scripts/CaveSurvey/Core/*.js` -- the pure survey engine
(parsing, network resolution, LRUD, adjustment, the extended-elevation
geometry, and more). Deliberately runs in TWO engines from the same file:

    node tests/js_unit.js
    CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
        -autostart tests/js_unit.js "$PWD"

Node is the fast developer loop; CaveCAD's own engine is authoritative,
because it has caught real divergences node cannot -- `Array.prototype.sort`
is unstable in CaveCAD's engine and stable in node, so a comparator that can
return 0 for two distinct items produces different geometry in each. Every
Core file loaded here must stay loadable under plain node: nothing may touch
`R*`/`Q*` globals at file (as opposed to function-body) scope.

## Stage 4/11 -- `profile_draw_roundtrip.js`

QCAD-context only (real `RDocument`/`RDocumentInterface`), so it cannot run
under node. Proves the drawing half (`Core/CsProfileDraw.js`): rendering a
built profile creates its layers and geometry, every entity it draws lands
in the PROFILE frame (`CsLayers.frameOf`), a second render erases exactly
what the first one drew (by its `Profile*` tags) and redraws in its place,
hand-drawn linework on the plain `PROFILE-FLOOR` / `PROFILE-CEILING` tracing
layers is never touched, the region's origin is recomputed below the plan's
extents and the user's tracing travels with it, and a line traced on the
elevation binds to elevation stations rather than to the plan stations a
few units away in absolute coordinates.

## Stage 5/11 -- `generate_profile_run.js`

`tests/cross_section_run.js` -- the cross-section lifecycle against a real document: cut a section on a fixture survey, place it as a block on a leader, change the survey and assert the block DEFINITION followed while the REFERENCE stayed put, then assert a frozen section is skipped and counted and a section whose leg is gone is counted lost and left in the drawing. Needs the real engine: every bug this feature shipped (a false re-entrant on every LRUD diamond, an inverted scale caption, sections drawn on their side) was invisible to the pure tests and obvious the first time the code met an RDocument.

`tests/section_sketch_run.js` -- the SKETCHED cross-section lifecycle against a
real document, end to end: Sketch Section opens a bay over a real scan and a
real computed ghost, a line is traced inside the frame, Capture Section sweeps
it (and not the frame, the ghost or the scan) into a `CS_<CalloutId>` block,
leaders it to its station and marches it clear of a wall deliberately placed in
its way, then the bay is torn down, Draw counts it `sketched` without touching
it, the whole thing survives a DXF round trip with all eleven tags, and Edit
Sketch puts the linework back out into a fresh bay and deletes the emptied
block definition. Two of its assertions are mutation-tested and the file says
so: removing the block-local `move` from Capture, and removing the locked-layer
unwrap from the teardown, each turn it red. Absence is asserted through
`queryAllEntities(false, true)` rather than `isNull()` -- measured in this
build, `queryEntity()` on a deleted id hands the entity back with
`isUndone() === true`, so an `isNull()` teardown check passes whether or not
the delete landed. Loads Core by reading `Core/CsAll.js`'s own include list
rather than a hand-written array, so a Core file the tools reach for can never
be silently `undefined` here.

Drives the Generate Profile TOOL's own entry point (not just the Core
library it calls) through the real `include()` chain, against a real
document: the survey is rebuilt from the drawing's own tags, splays
included, the elevation is drawn into that same drawing, and the report
reaches the user through `QMessageBox.information` with its newlines
intact.

## Stage 6/11 -- `align_image_frame.js`

Calls `AlignImage.prototype.transform` -- the one per-entity hook this repo
owns, since stock QCAD's `Transform` owns the selection walk -- against a
real document, and proves a plan warp moves the plan's own geometry and
leaves every profile-frame entity at exactly its original coordinates.

## Publish checks

Some things are only required to ship, not to develop. A tool with no icon
works fine from the menu and the command line while it's being written -- it
just can't go out that way. So `TestPublishReadiness` is off by default and
enabled by `--publish` (or `CAVESURVEY_PUBLISH_CHECK=1`):

* every tool has a toolbar icon;
* every referenced icon is parseable SVG, since a file QCAD can't parse
  renders exactly like a missing one;
* every tool has a status tip -- the one-line hover text that, for a layman,
  is often the only documentation they read.

## Survex format limits

`Core/Format/CsSurvex.js` (used by the `ImportCaveSurvey` tool) has three
known limits worth knowing about, not fixing:

* `*data passage` is keyed by station, so two shots ending at the same
  station cannot carry different passage sizes in the same file. All-zero
  LRUD is treated as "not measured" so blanks never clobber a real
  measurement recorded from the other end, and a genuine contradiction
  produces a plain-language warning naming both shots and saying which was
  kept.
* `*begin`/`*end` name-prefix scoping is supported, but only in the shape
  Survex itself writes it (see the file's own header comment for the exact
  supported grammar) -- an unusual hand-edited file may need reshaping first.
* Anonymous stations (`.`, `..`, `...`) and the PocketTopo `-` convention are
  both supported, but neither survives a round trip back out to Survex with
  its original anonymous spelling; they come out as ordinary generated names.

## Not covered

Behaviour that exists only as GUI interaction -- a dialog the user drives, or
a command that acts on the current selection -- is not stubbed; the fidelity
loss isn't worth it. Test those by hand in the GUI, via
**Misc > Development > Run Script...** for a script that isn't installed yet.

## Notes on driving CaveCAD headless

All learned the hard way, and relevant to any new `-autostart` test script:

* The binary at `CaveCAD.app/Contents/MacOS/CaveCAD` runs headless directly.
* A `-autostart` script must not assume `library.js` helpers are preloaded --
  `js_syntax.js`, `js_unit.js`, and both round-trip scripts each carry their
  own fallback shims for the handful of globals (`isNull`,
  `createSpatialIndex`, `destr`) they need.
* `-allow-multiple-instances` is required, or the app aborts with
  "Application already running" whenever the GUI is open.
* The process cwd may not be where you invoked it. Relative paths won't
  resolve; pass the repo root as an argument (`"$PWD"` in every invocation
  above) and read it back with `RSettings.getOriginalArguments()`.
* `QCoreApplication.arguments()` is not wrapped in this build. There is also
  no `quit()`/`qApp.quit()` -- the process exits when the script returns.
* A direct `eval()` inside a helper function (a `loadRepoScript`-style
  loader, for instance) lands its definitions in THAT FUNCTION's scope,
  invisible the moment it returns. Use indirect eval -- `(0, eval)(source)`
  -- so definitions land in the global scope instead. Every loader in this
  test suite depends on this.
* A headless run (`-no-gui`) has no MDI area at all: `RMainWindowQt` exists,
  but its main window and MDI area are null. Any code path that enumerates
  open tabs degrades to "nothing is open" here, by design -- it cannot be
  exercised end-to-end by a headless script, only by hand in the real GUI or
  against injected fakes.

## Stage 7/11 -- `callout_write.js`, Stage 8/11 -- `callout_sync.js`

The callout suite against a real document: what a note writes, and what a
revision does to the notes already drawn.

## Stage 9/11 -- `callout_elev_mode.js`

`Callout`'s elevation-reading mode against a real document, drawn with a real
survey (v3 tags, via `CsDraw.survey`) so `CalloutWrite.sampleElevationAt` --
the same shared function the tool's dialog and its elevation branch both
call -- has real LRUD to read. One point sits along a leg with a measured
floor and comes back on the real `elevation` style with no `LINE` marker;
another sits along a leg with no LRUD anywhere on it and falls back to the
survey line, forced onto the muted `elevation-line` style and stamped
`LINE` on its face; a point far from every leg samples nothing at all. Also
asserts `CalloutElev/` is gone from the tree -- this stage replaced the
standalone Elevation Callout tool, folded into `Callout` as a source choice
("Type the note" / "Floor elevation here") rather than a second command.

## Stage 10/11 -- `repair_drawing_run.js`

`CsRepair.run` against a real document -- the merge of the former Rebuild
Survey Data, Restyle Layers and Callout Sync menu entries into one Repair
Drawing entry. Each pass keeps its own engine coverage; what this stage
proves is that `CsRepair` drives all three in the order that matters
(survey data, then layers, then callouts -- see `Core/CsRepair.js` for
why), that every pass reports a line whether it ran or was skipped, and
that skipping every pass changes nothing.

## `surface_data_run.js`

`CsSurfaceData.run` against real documents -- the merge of the former Aerial
Basemap and Surface Contours menu entries into one Surface Data entry. Both
passes needed the same geo anchor and used to ask about (and fail on) a
missing one separately; this stage proves the merged tool asks once, before
either pass reaches for the network: a drawing with no anchor at all is
refused with a single line naming where to fix it (an existing Geo
Reference, station A1, a selected point, or Survey Notebook > Declination),
and an anchored drawing with both passes switched off is accepted and
reports both as skipped. Deliberately NOT covered here: either pass actually
fetching imagery or elevation data, since both hit a real tile service over
the network and a test suite must not depend on one being reachable -- the
shared request math (ground windows, Mercator bboxes, pixel sizing) is
covered headlessly instead, in `Core/CsGeoProject.js`'s own unit tests.

## Stage 11/11 -- `package_cave.js`

Package Cave Project against real files in a temp cave folder. It writes a DXF
carrying both survey tags and a geographic anchor, stages a sanitized copy and a
full one, and re-imports each to prove the difference is real: the sanitized
drawing keeps its station and loses all three geo tags, the full one keeps
everything, and the original on disk is untouched. Then it runs the platform's
own zip program (`ditto`, `zip`, or `Compress-Archive`) and checks an archive
actually appeared -- none of which can be faked under node.

## `edit_trip_run.js`

Edit Trip against a real document. Draws a two-trip cave, corrects trip 1's
date, team and name, and reads the drawing back through
`CsRevise.surveyFromDocument` -- the reader every other tool uses. The
assertion that matters is the trip COUNT: Survey Notebook's own edit path
matches a page to a trip by fingerprint (`date | team`), so correcting a date
there forked the trip into a duplicate and left the original standing. This
stage also proves nothing moved, that a cleared field is really cleared
(`CsTags.set` cannot clear a tag -- only `CsTags.remove` can), that an edit to
trip 0 carries the legacy `SurveyDate`/`SurveyTeam` mirror with it, and that a
trip with no anchor point in the drawing is reported rather than silently
dropped.

It also covers deletion, where the dangerous part is the RENUMBERING: trip ids
are array indices stamped into XDATA on legs, splays, trip anchors and the
surveyor's own traced linework, so deleting trip 1 of three must bring the old
trip 2 back as trip 1 everywhere at once -- record, shots, tags and linework.
The fixture branches its trips off a trunk rather than chaining them, because
that is the shape in which deleting a middle trip is legal at all; the chained
shape is covered too, as the refusal it has to produce.

## `notebook_partial_draw_run.js`

Survey Notebook's incremental Draw, against real documents. The claim is an
equivalence and cannot be made any other way: the same page is drawn into two
identical fixture drawings, one forced down the whole-cave path
(`Redraw All`), one left to `CsDelta.decide`, and the two drawings must
reconstruct to the same survey with every station in the same place -- and with
exactly ONE anchor carrying the drawing-level record, which is the failure a
partial draw invites, since the page it draws does not start at trip 0. The
second half proves the gate refuses: a page that revises an earlier trip under a
different declination turns the survey, so it must take the full path, where the
linework mover runs.

## `test_align_math.js`

The geometry underneath `ScanAlign`, inside CaveCAD's own script engine so it
runs against real `RVector` and `RImageEntity` behaviour rather than a stand-in.
`align_image_frame.js` covers the frame gate and the per-entity hook; this file
covers the arithmetic those depend on and nothing else covers: the exact
two-point `computeTransform` (including its `noscale` mode and its refusals),
the least-squares `computeSimilarityFit`, the affine `computeAffineFit` -- exact
on three stations, least squares on more, and refusing to invent a warp from
stations in a straight line -- and `getResiduals`, whose outlier case is checked
against hand-computed numbers (an 8-unit mis-click on the middle of five
stations leaves the four good ones 1.6 out and the bad one 6.4) so a fit that
quietly dumped the error on one station, or ignored it, would fail here.

The last two blocks put a fit onto a real image entity: one confirms
rotate/scale/move in that order really do land the picked points on their
targets with pixels still square, the other warps an image by a three-station
affine fit and reads the stations back off the picture's own `u`/`v` vectors,
then checks `isPointInImage` still finds a click in the middle of the warped,
skewed page (which QCAD's own hit test, measuring to the border, does not).

An image entity's pixel size comes from a file on disk, so the suite writes a
120x80 PNG into a temp directory at startup and removes it at the end -- the
same approach as `scan_rotate_run.js`, and the reason no binary fixture is
committed. Deliberately not square, so an across scale and a down scale cannot
swap places unnoticed.

Prints `### ALIGN MATH OK <checks>`, or `### ALIGN MATH FAIL <n> of <checks>`
with each failed assertion above it.

## `check_map_run.js` -- Check Map reads a real drawing

`tests/js_unit.js` runs all fourteen of `CsCheck`'s checks over literal
`scan` objects, which is where the LOGIC is proved. This stage proves
the other half: that `CsCheck.scan` turns a real document into one of
those objects correctly.

That is where a lint tool fails silently and expensively -- every check
passes, the panel says "nothing to fix", and the reason is that the scan
found nothing to check. So the fixture builds a drawing with known
faults (two wall ends 3 ft apart, a line 900 ft from any station, work
on layer 0, an open breakdown boundary, a stalactite on the water layer)
and asserts each one is SEEN, then builds a clean drawing and asserts
the panel stays quiet.

It has already earned its place twice: it caught `CsCheck.scan` reading
`station.position` where `CsTags.collectStations` writes `pos` -- which
threw inside a guard, emptied the station index, and reported every line
in the cave as drawn away from the survey -- and it caught the test's own
`addLine` helper being clobbered by `scripts/simple.js`'s global of the
same name.

Passes when the output contains `### CHECK MAP OK`.

## `build_legend_run.js` -- Build Legend explains the lines too

`tests/js_unit.js` proves `CsLegend`'s row logic over literal usage
objects. This stage proves the two halves a literal cannot reach.

`CsLegend.usage` has to recognise a drawing's linework as the feature it
is -- including a feature traced only in the ELEVATION, which is still a
feature the map draws. A usage scan that sees nothing produces an empty
legend and no error, which is exactly the failure worth a test: it
caught `planBaseOf` answering null for a layer already in the plan
frame, so every plan-frame feature registered as `layer:null` and no
legend would ever have mentioned the surveyed walls.

The samples have to be real geometry: a line row draws a line wearing
its layer's colour and dash pattern, and a shaped row draws its
ornament. "Floor Ledge" in words teaches nobody which of the lines on
the map is the ledge.

It also holds two promises about rebuilding: everything drawn lands on
the LEGEND layer so the legend hides and clears as one thing, and a
second run replaces the first rather than stacking a copy on top.

Passes when the output contains `### BUILD LEGEND OK`.

## `layout_gen_run.js` / `sheet_setup_layouts_run.js` -- Sheet Setup makes LAYOUTS

Sheets are layouts of the cave's own drawing (viewport branch): one
viewport showing the part of the cave the sheet is responsible for,
plus the furniture (border, title block, scale bar, north arrow, match
lines) in paper space. `layout_gen_run.js` proves the generator: a
viewport at the right scale and view centre with the other views'
layers frozen, nothing written into model space, auto sheets rewritten
in place without piling up copies, edited and manual sheets left alone,
undo restoring "auto" by itself, Revert, tiling into numbered sheets
whose viewports show exactly the tile's map, and all of it surviving a
save and reload. `sheet_setup_layouts_run.js` proves the panel logic
against layouts: measuring is MODEL space even while a sheet is
showing, and what a sheet says is read back from the sheet without
doubling its captions.

Pass when the outputs contain `### LAYOUT GEN OK` and
`### SHEET SETUP LAYOUTS OK`.

## `loop_errors_run.js` -- Loop Errors draws the closure where it happened

`tests/js_unit.js` pins the arithmetic: how far to exaggerate, the
colour bands, and which end of the arrow sits on the station. This stage
needs a real survey in a real document.

The fixture is a square loop whose last leg is six feet short, so the
adjustment has six feet to share out among four stations. What is
checked is what would look plausible while being wrong: that the worst
station's arrow actually REACHES that station (get the direction wrong
and every arrow sits a whole shift away from the thing it describes),
that everything lands on `CTRL-CLOSURE`, and that the layer -- which the
registry ships switched OFF -- is switched on, since otherwise a caver
runs the tool and sees nothing at all.

It also reads the caption back out of the drawing and checks it states
the exaggeration, because an exaggeration nobody is told about is a
falsified map, and that an unadjusted drawing is told its arrows point
the other way.

Passes when the output contains `### LOOP ERRORS OK`.

## `teaching_cave_run.js` -- the teaching cave hands out a sanitized copy

`tests/js_unit.js` pins the path arithmetic and the plans. This stage
moves real files, and two of the things it does are things you only get
to be wrong about once.

The master has to be SANITIZED: a teaching copy that still carries the
entrance is the suite's first rule broken by the one tool whose whole
job is handing a cave to strangers. So the fixture's drawing carries
both a geo anchor and a georeferenced aerial image, and the test reads
the master back OFF DISK and asserts neither survived -- stripping the
tags alone would leave the entrance baked into a raster.

Reset is a RECURSIVE DELETE. The test ruins the student's copy, leaves
homework in it, resets, and checks the drawing came back byte for byte
with the leftovers gone -- and then checks the REAL cave still carries
its own location and its plotted map, because the teaching cave reads
that folder once and never writes to it.

It also holds the line about what travels: field sketches do, because
tracing a real one is most of what a student is here to learn; plotted
PDFs do not, because a title block carries a location somebody typed and
this tool cannot strip that.

Passes when the output contains `### TEACHING CAVE OK`.
