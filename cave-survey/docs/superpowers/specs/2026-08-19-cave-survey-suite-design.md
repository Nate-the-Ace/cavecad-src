# Cave Survey for QCAD — suite design and master goals

Date: 2026-08-19
Status: proposed, awaiting approval
Supersedes: the current `scripts/CaveSurvey/` add-on, `app/`, and the separate
`qcad-align-image-tool` repository

## 1. What this is

A ground-up rewrite of the QCAD cave-survey tools into one modular suite whose
purpose is narrower and more useful than "some tools that draw survey data":

> **Take a beginner from a pocket notebook full of numbers to a cave map that
> would survive NSS Cartography Salon judging, without them having to learn
> cartographic convention first.**

Everything below serves that sentence. A tool that does not move somebody closer
to a finished, conventional sheet does not belong in the suite.

The suite presents itself as a **dedicated cave mapping application**: QCAD is
the base, but on entering Cave Mode the stock CAD clutter is hidden and what
remains is a cave-survey workspace. Delivered as an add-on plus a startup
script, not a fork (see §6a).

Five decisions are settled and constrain the rest:

1. **One repository.** `qcad-align-image-tool` is folded in. Proposed repo name
   `qcad-cave-survey`.
2. **No Python runtime.** `app/` is retired. There is exactly one parser per
   format, written in ECMAScript, living in the add-on. Python survives only as
   stdlib-only *test tooling*, which needs nothing installed.
3. **A docked Survey Notebook panel** is the primary interface, not a chain of
   modal dialogs.
4. **NSS symbology is canonical, UIS names are aliases** carried alongside every
   symbol so legends and exports can switch.
5. **Cave Mode, not a fork.** QCAD Community stays the unmodified base; a
   toggleable kiosk layer hides everything a cave cartographer does not need.
   Forking QCAD (own binary, rebrand) stays on the table for later, and nothing
   in this design would need to change to support it.

Hard constraint, unchanged: **QCAD Community only.** No Professional-only API
anywhere in the shipped add-on.

## 2. Conventions we are building to

These are external standards, not our preferences. Where a tool has to choose a
default, it chooses the one these documents call for.

### 2.1 The required elements of a cave map

The NSS Cartography Salon judging criteria is the most concrete published
checklist of what a cave map must contain, and it is what a judged map is
measured against. Its "Core Elements" become **required title-block and sheet
fields in our templates, and a checklist the suite can verify**:

| Element | Convention we enforce |
| --- | --- |
| Cave name | Present, unabbreviated |
| Geographic location | State/county minimum; coordinates must carry system, units and datum |
| Entrance / connection | An entrance symbol must exist, or an explicit connection note |
| North arrow | True north preferred; if magnetic, the **date** is mandatory |
| Bar scale + cave length | A graphic bar scale is required. A text-only scale is a defect; a ratio-only scale is a failure |
| Vertical control | Profile, contours, cross-sections, or vertical symbols with heights |
| Survey info + dates | Date range and surveyor credit |
| Symbol legend | Every non-standard symbol defined; standard sets may be cited instead |
| Cross-sections | Expected on every map, keyed to the plan with arrowed view direction |
| Cartographer + year | Named, and any copyright dated |
| Border | Defines the sheet limits |

Secondary criteria worth designing for, because they are cheap for software to
supply and expensive for a person: consistent line-weight hierarchy (heaviest for
walls, finer for secondary features), consistent lettering hierarchy (title
largest, descending), instrument/grade identification, passage endings shown as
terminated, and loop-closure/accuracy metadata.

### 2.2 Symbols

- **UIS Basic Cave Mapping Symbols** (completed 1999, reviewed 2008), plus the
  UIS Karst Surface (2006) and Artificial Cavities (2022) sets.
- **NSS standard cave map symbols** — canonical here.
- The existing templates already carry ~33 `SYM_*` blocks that map onto these
  (entrance, pit, dome, three breakdown variants, stalactite, stalagmite,
  column, flowstone, drapery, rimstone dam, moonmilk/popcorn, clay/mud tick,
  sand/gravel dot, guano, north arrow, fixed point, section marker, ceiling
  height, siphon, spring, drip/seep, sump, flow arrow, slope tick, climb arrow,
  joint tick). That is the seed of the catalog, not a rewrite target.

### 2.3 Grades

Surveys are described by grade, and the grade belongs on the sheet.

- **Centreline grade (BCRA 1–6, X).** Grade 3 = rough magnetic, angles ±2.5°,
  distances ±50 cm, station error <50 cm, loop closure typically <1%. Grade 5 =
  angles ±1° (often ±0.5°), distances ±0.5 cm, station error <10 cm, calibrated
  instruments, coordinates *computed* rather than protractor-plotted, legs
  preferably <10 m. Grade 6 = ±0.5° or better, station error <2.5 cm, tripods or
  fixed stations.
- **Passage detail grade (BCRA a–d).** `a` = walls from memory after the trip;
  `b` = drawn in-cave but widths estimated; `c` = dimensions measured at every
  station; `d` = measured at every station *and* stations deliberately placed at
  every significant passage change.
- **UISv2 composite**, written as `UISv2 <survey>-<detail>-<qualifiers>`, e.g.
  `UISv2 5-4-BCE`.

Two consequences for the software. First, "coordinates must be computed, not
hand-plotted" means a QCAD-plotted survey is *automatically* eligible for the
higher centreline grades — worth telling the user. Second, the suite can
**derive the honest grade** from the data it holds (were LRUD present at every
station? what is the loop closure? were backsights recorded?) rather than letting
the user assert one.

### 2.4 Where beginners' data actually comes from

TopoDroid, driving a DistoX or hand entry, is the common modern path. It exports
`.svx` (Survex), `.dat` (Compass), `.srv` (Walls), `.th`/`.th2` (Therion),
`.top` (PocketTopo), `.tro` (VisualTopo), `.csx` (cSurvey), `.dxf`, `.csv`,
KML/GeoJSON, and SVG/shapefile sketches. Import breadth matters more than export
breadth: people arrive with a file and want to see it.

## 3. What is wrong with the current code

Recorded so the rewrite is judged against it.

**Correctness**

1. **Slope distance treated as horizontal.** Every tool computes
   `dx = d·sin(az)`, `dy = d·cos(az)`, `z += d·tan(inc)`. Compass, Walls and
   Survex tape lengths are *slope* distances. Correct is
   `plan = d·cos(inc)`, `rise = d·sin(inc)`. The present code plots passages
   longer than they are, with the error growing as shots steepen — a 30° shot is
   plotted 15% too long. This is the single most important fix in the rewrite.
2. **Two layer vocabularies.** `AzimuthTraverse` writes `CTRL-SHOTS`,
   `CTRL-LRUD`, `CTRL-STATIONS`, `CTRL-STATION-LABELS`. `ImportNativeCaveSurvey`
   writes `ALIGNMENT`, `LRUD`, `STATIONS` — none of which exist in the
   templates. Imported surveys land on invented layers.
3. **`LRUDWalls` cannot see imported data.** It finds walls by looking up points
   tagged `CaveSurvey/LRUDName`; only `AzimuthTraverse` writes that tag.
4. **`LRUDWalls` infers survey order from entity creation order**, which is wrong
   for any drawing with more than one traverse, any resumed traverse, and any
   import.
5. **`GeoAnchor` mutates entities and calls `doc.addObject()`** outside a proper
   operation, which its own comments flag as untested. It applies a non-uniform
   scale that turns every arc and circle into an ellipse, and there is no path
   back.
6. **`ScatterBreakdown` deletes every block on the `BREAKDOWN` layer** before
   re-scattering, so a second boundary destroys the first.
7. **Survex `*calibrate declination` is ignored**, so those files import rotated.

**Structure**

8. **No shared code.** `ensureLayer`, `lrudTick`, `drawStationPoint`, `drawLrud`,
   `getStartPointFromSelection`, station tagging and the traverse math are
   duplicated across files and have already drifted apart.
9. **Two parsers per format** (JS and Python) held together only by a
   differential test.
10. **Every tool is a chain of blocking modal dialogs.** Entering a ten-shot
    traverse is roughly seventy dialog interactions with no preview and no way
    back except cancelling the lot.
11. **Nothing owns the sheet.** Title block, legend, scale bar, north arrow and
    grade exist in the template as blocks that no tool ever writes to.

## 4. Master goals

Ordered by workflow stage. **P0** = the suite is not credible without it.
**P1** = the reason somebody chooses this over Therion. **P2** = later.

### Stage A — Get the data in

- **A1 (P0) Survey Notebook panel.** Type shots into a table that looks like a
  survey notes page, with the drawing redrawing live. Covered in §6.
- **A2 (P0) Import any common format.** Compass `.dat`, Walls `.srv`, Survex
  `.svx`, plus plain CSV. One parser per format, all producing the same neutral
  `Survey` object.
- **A3 (P1) Import Therion `.th` and TopoDroid/PocketTopo exports**, because
  that is what a DistoX user has.
- **A4 (P0) Format detection.** Ask for a file, not for a format. Detect by
  extension, then by content, and only ask if genuinely ambiguous.
- **A5 (P1) Round-trip export** to Compass, Walls and Survex, so the suite is
  never a data roach motel.
- **A6 (P1) Instrument-error and declination handling as first-class fields** —
  declination with its date, tape/compass/clino corrections, backsight support —
  rather than a value silently baked into coordinates.
- **A6a (P1) Infer declination from survey date and location.** Many old
  surveys record neither declination nor a way to find it. Implement the IGRF
  model (1900–present, public-domain coefficients, pure spherical-harmonic
  math) in `Core/Geomag.js`: given lat/lon and date, produce declination to
  well under ±1° — negligible against a ±2.5° Grade 3 compass. Offered
  wherever declination is entered (Notebook header, importers, georeferencing),
  always shown as "IGRF estimate for <date> at <location>" and editable, never
  silently applied. Pre-1900 dates fall outside IGRF and stay manual, with the
  model saying so.
- **A7 (P2) Paste from clipboard** — a beginner's data is often already in a
  spreadsheet.

### Stage B — Turn data into a correct centreline

- **B1 (P0) Correct traverse math.** Slope distance, plan projection, rise.
  Configurable per drawing, defaulting to slope (what every format means).
- **B2 (P0) Network resolution, not sequential plotting.** Resolve stations
  breadth-first from every anchor so out-of-order shots and branches work. The
  current importer's repeated-passes loop is close; the notebook must share it.
- **B3 (P0) Loop detection and closure reporting.** Find loops, report closure
  error in absolute and percentage terms, and name the worst leg. This is the
  number that decides the survey's grade.
- **B4 (P1) Loop closure adjustment**, at minimum simple proportional
  distribution, with the adjustment shown and reversible.
- **B5 (P1) Blunder hunting.** Flag the classic mistakes: a bearing 180° out
  (backsight entered as foresight), a transposed digit, an inclination sign
  flip, a duplicate station name, a station that appears once and goes nowhere.
  For a beginner this is the highest-value feature in the whole suite — it
  catches the errors that make a first survey not close.
- **B6 (P0) One survey model in the drawing.** Every station and shot carries
  its full data as custom properties, so any tool can reconstruct the survey
  from the drawing without a sidecar file.
- **B7 (P1) Vertical views.** Generate a profile or extended elevation from the
  same survey, on the profile template's layers.

### Stage C — Turn a centreline into a map

- **C1 (P0) LRUD walls that work on any survey**, driven by the survey model
  rather than entity creation order, with the option of straight segments or a
  fitted spline, and honest handling of junctions.
- **C2 (P0) Wall tracing support.** Align Image, folded in, plus a passage-wall
  drawing tool that snaps to LRUD tips and keeps `WALLS-SURVEYED` and
  `WALLS-INFERRED` distinct — the line-weight hierarchy the salon criteria ask
  for is otherwise the first thing a beginner gets wrong.
- **C3 (P0) Symbol palette.** A browsable, searchable palette of the NSS
  symbols already in the templates, each placing onto its correct layer at the
  correct scale, with its UIS alias recorded. A beginner should not be able to
  put a stalactite on the water layer.
- **C4 (P1) Area fills done properly.** Generalise `ScatterBreakdown` into a
  per-boundary, tagged, re-runnable scatter for breakdown, sand/gravel, clay,
  guano and cobbles, so re-scattering one zone never disturbs another.
- **C5 (P1) Cross-section tool.** Draw a section line in plan, and get a
  correctly labelled section marker pair with the arrowed view direction and a
  framed section stub to draw into. Cross-sections are 10 of 134 salon points
  and the thing beginners omit most.
- **C6 (P1) Ceiling heights, pit depths, floor slopes, climbs** as measured
  annotations rather than freehand text.
- **C7 (P2) Passage shading / depth cueing** for overlapping levels.

### Stage D — Make it a sheet

- **D1 (P0) Title block editor.** One form, every NSS core element, writing to
  the template's `TB_*` blocks. Fields that are conventions rather than
  preferences are labelled as such.
- **D2 (P0) Sheet checklist.** Run it and get a plain-language list of what a
  judge would mark missing, keyed to the salon core elements. This is the
  single most beginner-facing feature in the suite: it turns tacit convention
  into a to-do list.
- **D3 (P0) Scale bar and north arrow placement**, choosing from the template's
  eleven bar scales by drawing scale, and stamping the declination and date on
  a magnetic north arrow automatically.
- **D4 (P0) Legend generator.** Scan the drawing, emit a legend containing only
  the symbols actually used, with NSS names and UIS aliases.
- **D5 (P1) Grade calculator.** Derive the defensible BCRA/UIS grade from the
  data and write it into the title block, rather than letting the user assert
  one.
- **D6 (P1) Statistics.** Surveyed length, plan length, vertical range, station
  count, number of loops, closure error — the numbers the title block wants.

### Stage E — Get it out

- **E1 (P1) Georeferencing that does not destroy the drawing.** Replace
  `GeoAnchor`: store the anchor and rotation as drawing metadata, and *export* a
  transformed copy (KML/GeoJSON) instead of rewriting every entity in place.
- **E2 (P1) Print/export presets** for the template sheet sizes.
- **E3 (P2) Web/SVG export** for a cave's public page.

### Stage F — Feel like a dedicated app

- **F1 (P0) Cave Mode.** One command (`cavemode`) and menu toggle. On: hides the
  stock menus, toolbars and dock widgets a cave map never needs (CAM,
  dimensioning beyond the basics, scripting, pro-upsell entries), keeps
  draw/edit/snap/view essentials, shows the Cave Survey menu, toolbar and
  Survey Notebook, and sets the NSS plan template as the new-document default.
  Off: restores QCAD exactly as it was. State persists across restarts.
- **F2 (P0) First-run experience.** On first launch after install, Cave Mode
  offers itself, opens the plan template, and points at the three entry paths:
  import a file, open the Notebook, or trace a scan.
- **F3 (P1) Cave workspace defaults.** Snap defaults, layer list ordered as the
  legend orders it, units read from the template — the drawing environment a
  cave cartographer would have set up by hand.
- **F4 (P2) Fork evaluation.** If the suite proves out, revisit shipping a
  rebranded QCAD Community build ("own binary") with the strip done at source.
  Explicitly out of scope for this rewrite.

### Cross-cutting

- **X1 (P0) Every tool works from the survey model in the drawing**, so tools
  compose in any order.
- **X2 (P0) Undo-safe, single-operation edits.** Every tool produces exactly one
  undoable operation. No tool destroys data without an undo path.
- **X3 (P0) Plain-language reporting.** Every tool ends by saying what it did, in
  drawing units, in a sentence a beginner understands.
- **X4 (P0) Teach while doing.** Status tips, prompts and reports name the
  convention being followed and why. The suite is the beginner's cartography
  tutor; that is its actual competitive advantage over Therion.
- **X5 (P1) Metric and imperial throughout**, driven by the drawing's own unit,
  not a constant edited in two source files.

### Explicit non-goals

Full specification compliance for any format; multi-file/project imports on
first pass; 3D visualisation (Aven and Therion do it better); replacing a survey
data reduction package; cave-diving-specific workflows.

## 5. Architecture

```
qcad-cave-survey/
  scripts/CaveSurvey/
    CaveSurvey.js              menu + toolbar host (unchanged pattern)
    Core/                      library, not tools: no <Folder>.js, never init'd
      Units.js                 unit registry + conversion, driven by the drawing
      Angles.js                azimuth/quadrant/grad parsing, normalisation, declination
      Geomag.js                IGRF declination from lat/lon + date (A6a);
                               coefficient table + spherical-harmonic evaluation,
                               validated against published NOAA/IGRF test values
      Model.js                 Survey / Station / Shot / Anchor value objects
      Network.js               resolve positions from anchors; find loops; closure error
      Traverse.js              one shot -> plan offset + rise (the §3.1 fix lives here)
      Lrud.js                  LRUD -> wall points; junction rules
      Validate.js              blunder detection (B5)
      Layers.js                canonical layer registry: name, colour, linetype, weight
      Tags.js                  custom-property read/write, degrades silently
      Draw.js                  station point, label, shot line, tick, block insert
      Pick.js                  start-point-from-selection and friends
      Symbols.js               catalog: NSS name, UIS alias, block, layer, default scale
      Sheet.js                 title-block field registry + read/write
      Grade.js                 BCRA/UIS grade computation and formatting
      Stats.js                 length, depth, station and loop counts
      Report.js                builds the plain-language summaries (X3)
      Format/
        Registry.js            detection by extension then content
        Compass.js  Walls.js  Survex.js  Csv.js  Therion.js
    SurveyNotebook/
      SurveyNotebook.js        the dock widget tool (§6) -- a tool folder,
                               not a library, because QCAD only init()s
                               folders containing <Folder>.js
    CaveMode/
      CaveMode.js              the kiosk toggle (F1): hide/restore stock UI,
                               set template default, persist state in RSettings
    <Tool>/<Tool>.js + .svg    one folder per tool, wiring exactly as today
```

Rules that hold everywhere:

- **`Core/` contains no GUI and no document access except through `Draw.js` and
  `Tags.js`.** Everything in `Units`, `Angles`, `Model`, `Network`, `Traverse`,
  `Lrud`, `Validate`, `Grade` and every `Format/*` parser is a pure function of
  its inputs, so the headless harness can call it directly. This is the property
  that made `AlignImage`'s math testable, generalised to the whole suite.
- **A folder is a tool if and only if it contains `<Folder>.js`.** `Core/` and
  `Panel/` therefore are not tools and QCAD never tries to `init()` them. The
  structural test is updated to know the difference, with an allowlist so a
  mistyped tool folder still fails loudly.
- **Includes are absolute from the scripts root** — `include("scripts/CaveSurvey/Core/Units.js")`
  — the form QCAD's own add-ons use and which resolves from either install
  location. A test asserts every include target exists.
- **Tool files hold no domain logic.** A tool is: gather intent, call `Core`,
  draw, report. If a tool file exceeds roughly 250 lines, logic has leaked into
  it.
- **The add-on wiring block is copied verbatim** in every tool — the pattern in
  `docs/plugin-conventions.md`, enforced by test. Consistency here is worth more
  than brevity, because the failure mode is a silently missing menu entry.

## 6. The Survey Notebook panel

A dock widget, because the survey notes page is a *table* and the current
dialog-per-field flow is the suite's worst usability problem.

Its layout follows a paper survey sheet, top to bottom, so somebody holding
their notes can read across:

```
┌─ Survey Notebook ─────────────────────────┐
│ Survey: [Main Passage      ]  ⚙ Settings  │   ← survey/trip header
│ Date [2026-08-19] By [NS, JD          ]   │
│ Decl [ 3.2°E ] on [2026-08-19]  Units[ft] │   ← declination carries its date
├───────────────────────────────────────────┤
│ From  To   Dist  Azm   Inc │ L  R  U  D   │   ← the notes page, in order
│ A1    A2   12.4  045.0 -3.0│ 2  4  8  1   │
│ A2    A3   18.1  112.5 +1.5│ 3  3 12  0   │
│ A3    A4   ...                            │
│ [+ shot]                        ⌫ delete  │
├───────────────────────────────────────────┤
│ ⚠ A3→A4 bearing 292.5 may be a backsight  │   ← live validation (B5)
│ Loop A1-A5-A1: closes 0.34 ft (0.8%)      │   ← live closure (B3)
├───────────────────────────────────────────┤
│ Length 148.2 ft  Depth 12.4 ft  Grade 5-c │   ← live stats + honest grade
│         [ Draw ]  [ Redraw ]  [ Export ]  │
└───────────────────────────────────────────┘
```

Behaviour:

- Editing any cell re-resolves the network and redraws the affected geometry.
  One QCAD operation per edit, so undo works per shot.
- Column order matches the notes page, and the header states the reading
  convention in force (azimuth from north, L/R facing travel, LRUD belongs to
  the To station) so there is nothing to guess.
- The declination field carries an **Infer** affordance: given the trip date
  and a cave location (from the drawing's geo anchor, or typed once per
  survey), it fills in the IGRF estimate (A6a), labelled as an estimate.
- Validation is advisory and inline. A suspected blunder is a warning next to the
  row, never a blocked entry — the surveyor is the authority on their own notes.
- The panel is also the *reader*: selecting a station in the drawing scrolls to
  its row, and vice versa. That is what makes it usable on imported surveys, not
  just typed ones.
- `Azimuth Traverse` survives as the click-driven, one-shot-at-a-time tool with
  live rubber-band preview, for people who prefer plotting interactively. It and
  the panel share `Core` entirely.

**Risk.** A scriptable dock widget is the largest QCAD API unknown in this
design. `RDockWidget` exists in `libqcadgui`, QCAD's own widget infrastructure
lives under `scripts/Widgets/`, and `QUiLoader` is available and demonstrated by
QCAD's own `ExWidget` example — but this must be proven before the panel is
built on it. **Task one of implementation is a throwaway spike: a dock widget
containing a `.ui`-loaded table that appears in QCAD Community and survives a
document switch.** If it fails, the fallback is a modeless `QDialog` with the
same layout and the same `Core` underneath; nothing else in the design changes.

## 6a. Cave Mode mechanics and risk

QCAD builds its menus and toolbars from `RGuiAction`s at startup; a script can
enumerate the main window's `QMenuBar`, `QToolBar`s and dock widgets and hide
them by object name. Cave Mode therefore works from **two lists in one file**: a
keep-list of stock UI (File, Edit, View basics, Draw essentials, Snap, Layer
list) and everything else hidden. Hidden, never deleted — QCAD's own state stays
intact underneath, and restore is showing them again. State and the user's
pre-Cave-Mode visibility snapshot persist via `RSettings`.

Risks, honestly: object names of stock widgets are not a stable public API and
can shift between QCAD releases, so the keep-list is defensive (unknown widgets
stay visible rather than getting hidden) and a structural test pins the widget
names against the installed QCAD version. Same spike-first rule as the panel:
**prove hide/restore of one menu and one toolbar survives restart before
building the full mode.**

## 7. Testing

The existing three-layer harness is the right shape and is kept, minus the parts
that only existed to police the Python duplication.

- **Layer 0 — structural (Python, stdlib only).** Extended: tool-vs-library
  folder rule, unique `(groupSortOrder, sortOrder)`, both widget names present,
  `setScriptFile` self-reference, icons exist and parse as SVG, status tips
  present, every `include()` target exists, every layer a tool writes to exists
  in the templates or in the layer registry, every symbol in the catalog has a
  block in the templates.
- **Layer 1 — unit tests in QCAD's own engine.** New, and the important change.
  Because `Core/` is pure, the parsers, traverse math, network resolution, loop
  closure, blunder detection, grade computation and unit conversion are all
  directly testable headlessly under `qcad -no-gui -autostart`. This replaces
  the JS-versus-Python differential test with something strictly better: real
  assertions against known-correct fixtures.
- **Layer 2 — fixtures with known answers.** The current `testdata/` surveys
  gain hand-computed expected coordinates, including a deliberately steep shot
  that fails under the old horizontal-distance assumption, an out-of-order loop
  closure, and a survey with a planted blunder.
- **Publish gate** — unchanged in spirit: icons, status tips, parseable SVG,
  every script parsed in QCAD's engine, run against the staged package.

The differential test and `--js` shim are deleted with `app/`.

## 8. Migration and packaging

- `tools/make_package.sh` and `tools/publish.sh` are kept nearly as-is; they are
  the strongest part of the current repo. The `ALIGN_IMAGE` cross-repo copy step
  is deleted, since Align Image is now in-tree.
- `legacy/` is deleted. `CheckStationProperties.js` becomes a debug command in
  the panel; `ImportCaveSurveyCSV.js` becomes `Core/Format/Csv.js`.
- Templates are kept and extended, not rebuilt: `CTRL-LRUD` and the LRUD wall
  layers get added to the plan template so nothing is created ad hoc at runtime,
  and the profile template gains the layers the profile generator needs.
- The rewrite lands on a branch, tool by tool, with the suite kept installable
  and usable at every commit. Order: `Core` + the two spikes (dock widget,
  Cave Mode hide/restore), then panel, then import, then walls, then sheet
  tools, then Cave Mode proper, then georeferencing.
- Repo rename to `qcad-cave-survey` is a separate, manual step and yours to make.

## 9. Open questions

1. Repo rename — do it, and when?
2. Profile/extended-elevation generation (B7): first release or second?
3. Loop closure adjustment (B4): is proportional distribution enough, or is
   least-squares expected?
4. Metric support (X5): needed now, or is feet-only acceptable for v1?
