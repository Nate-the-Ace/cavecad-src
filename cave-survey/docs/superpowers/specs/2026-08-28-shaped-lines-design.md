# Shaped Lines — design (2026-08-28)

Cave-map line symbology drawn as real geometry that stays linked to its
spine: floor ledges, ceiling ledges, pits, flowstone/dripstone edges and
rimstone dams, each one toolbar button away, each landing on its own
layer, each re-decorating itself when the spine is edited.

Decided in a live design session with Nathan 2026-08-27/28; he approved
building the whole feature overnight without further prompts.

## Why NOT a true shaped linetype

Nathan's first pick was a native shaped linetype. Researched and
rejected on evidence:

- The engine machinery exists in the GPL fork source
  (`RLinetypePattern.shapes/shapeTexts/shapeOffsets`, glyphs rendered via
  `RFontList`/`RTextRenderer`), but parsing of complex `.lin` segments is
  gated behind `RPluginLoader::hasPlugin("DWG")`
  (`RLinetypePattern.cpp:446`) — a Pro-plugin check. Patchable in one
  line; that is not the blocker.
- The blocker: `RDxfExporter::writeLinetype` writes **dash lengths
  only**. A complex linetype survives until the first save; the reopened
  drawing has plain dashes. Extending dxflib's LTYPE writer AND reader
  (255-char group-1000 records, shape handles) is engine surgery with a
  compatibility tail (any other CAD opening the DXF lacks the shape font
  and shows gaps).
- Cave maps live as DXF on Drive and get exchanged. Symbology that
  silently degrades on the file's own life cycle is a trap.

So: decoration is **real entities** (portable, prints anywhere,
survives every DXF round trip), and the "dynamic" half is a
transaction listener that regenerates decoration when the spine
changes — the exact architecture Callouts already ship
(`CalloutListener.js`), proven live.

## Feature set and layers

| Button | Style key | Spine layer | Decor layer | Symbol (NSS 1976) |
|---|---|---|---|---|
| Floor Ledge | `floorledge` | LEDGE-FLOOR | LEDGE-FLOOR | solid line, hachures point down the drop |
| Ceiling Ledge | `ceilingledge` | LEDGE-CEILING (DASHED) | LEDGE-CEILING | dashed line, hachures toward lower ceiling |
| Pit | `pit` | LEDGE-FLOOR | LEDGE-FLOOR | closed contour, hachures inward |
| Flowstone | `flowstone` | CTRL-SHAPE-SPINE (hidden) | FLOWSTONE | scallops bow downslope |
| Rimstone Dam | `rimstone` | CTRL-SHAPE-SPINE (hidden) | RIMSTONE | tighter scallops bow downstream |

Direction rule from the NSS standard sheet ("hachures point down",
"lines splay down"): ornament always lives on the DOWN side. Geometry
cannot know which side is down, so side is a per-feature flag the caver
can flip.

New layers (registry + DEFAULTS + template sync):
- `LEDGE-FLOOR` white / CONTINUOUS / Weight035
- `LEDGE-CEILING` white / DASHED / Weight025
- `FLOWSTONE` white / CONTINUOUS / Weight025
- `RIMSTONE` white / CONTINUOUS / Weight025
- `CTRL-SHAPE-SPINE` gray / DASHED / Weight000, created OFF (in
  `CsLayers.OFF`) — the editable skeleton of decor-only styles. Turn it
  on to grab and reshape a flowstone edge; the listener re-decorates.

All five are plan-frame (`frameOf` default). Draw actions refuse a
stroke in the profile frame like FeatureTrace does; profile variants are
future work.

`planDataBox` safety: LEDGE-*/FLOWSTONE/RIMSTONE are legitimate map
linework and SHOULD count toward the plan extent. CTRL-SHAPE-SPINE is
off by default so hidden spines do not count while hidden.

## Anatomy of a shaped line

- **Spine**: one curve entity — the editable soul of the feature.
  Tagged (CsTags group `CaveSurvey`):
  - `ShapeStyle` = style key
  - `ShapeId` = CsUuid.v4()
  - `ShapeSide` = `1` (right of travel) or `-1`
  - `ShapeScale` = size multiplier, default 1
  - `ShapeSig` = geometry signature (see listener)
- **Decor**: N entities tagged `ShapeDecor=<uuid>`, on the style's decor
  layer. Ticks are RLine entities; a scallop chain is ONE RPolyline with
  bulges. Decor is derived state — never hand-edited, always
  reconstructible from the spine.

Supported spine types: line, polyline (bulges honored), arc, circle,
spline — anything `CsShapeLine.sampleEntity` can walk. Draw buttons
produce splines (freehand trace, FeatureTrace mechanics); any other
type arrives via Decorate Selection.

## Core math (`Core/CsShapeLine.js`, pure JS + engine adapter)

Pure functions (node + engine testable):
- `resamplePath(pts, closed, step)` — arc-length walk, evenly divided on
  closed paths so the seam is clean.
- `stations(pts, closed, spacing)` — decoration anchor points + unit
  tangents (finite difference), normals = tangent rotated toward `side`.
- `ticks(...)` / `scallops(...)` — primitive generators returning plain
  data (`{lines:[[p,q],...]}` / `{points:[...], bulges:[...]}`).
- `signature(pts)` — rounded coordinate hash for the listener's cheap
  "did geometry actually change" gate.
- `STYLES` — the five specs: spacing/size in FEET (converted per drawing
  unit via CsUnits/CsTrace.spacingFor so a setting means the same thing
  in a metre drawing), bulge for scallop styles, closed/inward for pit.

Engine adapter (engine-only, engine-tested):
- `sampleEntity(entity, step)` — per type: line/arc/circle closed-form,
  polyline per segment from vertices+bulges, spline via
  `getPointsWithDistanceToEnd` (probed: works, 1 point, FromStart
  honored; circle probed BROKEN for that API, polyline returns 2 points
  — hence the closed-form paths).
- `decorate(doc, di, spineEntity, opts)` — delete existing decor by id,
  rebuild from current geometry, stamp `ShapeSig`, one operation, joins
  the caller's transaction group when given one.

## Tools (`ShapedLines/` folder)

`ShapedLines.js` — folder-named host. Registers the dedicated toolbar
`EAction.getToolBar(qsTr("Cave Lines"), "CaveLinesToolBar")` and inits
the per-feature actions (FeatureTrace/FeatureTraceRun precedent: extra
action files in the tool folder, registered from the host's init).
Sort orders 30–37 (free window), group 450, widgets
`["CaveSurveyMenu", "CaveLinesToolBar"]`.

| Action file | Menu label | Commands | sortOrder |
|---|---|---|---|
| ShapedLines.js (folder file) | Decorate Selection | `shapedlines`, `shl` | 30 |
| LedgeFloorDraw.js | Floor Ledge | `ledgefloor`, `lgf` | 31 |
| LedgeCeilingDraw.js | Ceiling Ledge | `ledgeceiling`, `lgc` | 32 |
| PitDraw.js | Pit | `pitedge`, `pte` | 33 |
| FlowstoneDraw.js | Flowstone | `flowstone`, `fst` | 34 |
| RimstoneDraw.js | Rimstone Dam | `rimstone`, `rst` | 35 |
| ShapedFlip.js | Flip Shaped Side | `shapedflip`, `shf` | 36 |
| ShapedSync.js | Sync Shaped Lines | `shapedsync`, `shs` | 37 |

Decorate Selection is the FOLDER-NAMED tool (the structural tests pin
the README table to folder-file commands), and it alone also sits on
the main Cave Survey menu/toolbar; the other seven live on the Cave
Lines toolbar only, reachable by command everywhere.

As built, two engine truths moved the math (probed, pinned in tests):
a positive DXF bulge bows RIGHT of travel (center on the LEFT of the
chord -- RPolyline.getSegmentAt on bulge +0.5 from (0,0)-(10,0) answers
center (5,3.75), middle point (5,-2.5)); and a never-added spline's
getLength() answers NaN on the FIRST call and the real length on the
second (getData().castToShape(), ask twice). Circles return no point
from getPointsWithDistanceToEnd and polylines return points from BOTH
ends, so both sample closed-form in JS.

The five draw actions subclass one `ShapedLinesRun` (freehand
press-drag-release lifted from FeatureTraceRun: screen-space sampling,
snap suspended, resample/reduce via CsTrace, spline fit, plan-frame
guard). On release, ONE transaction group adds spine (tagged) + decor.
Pit closes the path (last point welded to first) and defaults side
inward.

- **Decorate Selection**: takes the current selection; for each
  supported un-tagged entity, asks style/side once (QDialog: style
  QComboBox, side QComboBox, scale QLineEdit — all probed-constructible
  widgets) and decorates in place. The entity stays on its own layer if
  it is one of ours, else moves? NO — it stays where it is; only decor
  goes on the style's decor layer. Least surprise: never relocate a
  caver's entity.
- **Flip Shaped Side**: selection's shaped spines (or decor — resolved
  to spine by uuid): `ShapeSide` negated, re-decorate.
- **Sync Shaped Lines**: manual regeneration — selection, or the whole
  drawing when nothing is selected. The fallback for a listener that
  failed to install (headless edits, disabled listener) — CalloutSync
  precedent.

## The listener (`ShapedLines/ShapedLinesListener.js`)

CalloutListener clone, same four hazards handled the same way:
1. busy flag cleared in `finally`;
2. cheap gate: only reads tags off `transaction.getAffectedObjects()`;
3. document used synchronously, never captured;
4. regen joins the triggering transaction's group (one Ctrl+Z).

Reconcile per touched uuid:
- spine gone → delete orphaned decor;
- ALL decor gone but spine tagged → strip the spine's Shape* tags (the
  caver deleted the ornament: keep their curve, forget the feature —
  mirror of Callout's "a note without an arrow is still a note");
- spine present, decor partial/stale → re-decorate — but FIRST compare
  `signature(current geometry)` to `ShapeSig` and decor count; equal →
  return without writing (the no-op-write freeze lesson).

Installed from `CaveSurvey.js` init beside CalloutListener, guarded the
same way.

## Sizing defaults (tuned live tonight, revisable)

Feet, converted per drawing unit at decorate time:
- floorledge: tick every 3 ft, tick 2 ft
- ceilingledge: tick every 5 ft, tick 2 ft
- pit: as floorledge
- flowstone: scallop chord 3 ft, bulge 0.5
- rimstone: scallop chord 2 ft, bulge 0.62

Per-feature `ShapeScale` multiplies both spacing and size.

## Tests

- Pure (node + engine): stations spacing/handedness on a straight run,
  closed-path even division, tick endpoints, scallop bulge signs vs
  side, signature stability + sensitivity (mutate one coordinate → sig
  changes), STYLES table sanity (every style names registry layers).
- Engine: sampleEntity on all five entity types (bulge polyline arc
  length pinned), decorate creates tagged decor on the right layer,
  re-decorate replaces rather than accumulates, flip mirrors decor,
  reconcile's three branches, spine-off-layer write path
  (CsLayers.withLayerOn for CTRL-SHAPE-SPINE).
- Structural: README rows for the eight commands; template carries the
  five new layers (sync_template_layers run); sort orders unique.

## Out of scope (named so they stay out)

- Profile-frame variants of the layers/buttons.
- Slope/breakdown/gradient fans (different primitive family).
- Engine-side complex linetypes (documented dead end above).
- A style editor UI; sizes are code constants + ShapeScale for now.
