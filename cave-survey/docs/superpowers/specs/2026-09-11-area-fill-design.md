# Area Fill — design

Date: 2026-09-11
Status: approved design, not yet planned
Ships as: 0.9.116.0

## What this is

A caver arms an area pattern in the Draw panel, drags a loop around a
patch of cave floor, and gets a closed spline boundary with the right
fill inside it — sand stipple, a pile of boulders, a water tint. Every
fill is derived from its boundary and redrawn when the boundary moves.
A caver can also draw their own fill element and add it to the palette
permanently, the way New Symbol already adds a symbol.

Also in this change: the Draw panel stops being two fixed columns and
becomes a reorderable two-wide grid, because a third section no longer
fits beside the other two.

## Research: what cave maps actually fill areas with

The **UIS official symbol list (1999)** carries these area-type
entries: Blocks/Debris, Pebbles, Clastic sediments (sand-silt-clay-
humus), Clay-covered walls, Guano, Ice-Snow-Firn, Bones, Lake / Sump /
flowing water, Flowstone-wall calcite-moonmilk.

**Therion** — the de-facto modern standard — defines thirteen area
types: `water, sump, sand, debris, blocks, ice, snow, clay, pebbles,
bedrock, flowstone, moonmilk, u:<custom>`, and splits their rendering in
a way this design copies exactly: `water, sump, flowstone, moonmilk`
fill the region; `sand, debris, blocks, ice, snow, clay, pebbles` are
drawn by randomly placing picture elements inside it.

US/NSS practice agrees: breakdown is individual angular boulders (which
is what ScatterBreakdown already draws), sand is random stipple, clay is
sparse fine dots, gravel is small circles, bedrock is blank, water is a
tint.

Sources: UIS symbol list (startcaving.com mirror of carto.net),
uis-speleo.org mapping symbols, Therion by examples §2.7, Therion symbol
set PDF (2013).

## Engine facts established before designing

Read out of `cavecad-src`, not assumed:

- `RHatchData::setCustomPattern(const RPattern&)` exists, so a hatch can
  carry its own pattern inline — no `.pat` file to install.
- `RS::getDirectoryList` adds `RSettings::getPath()` and
  `RSettings::getDataLocation()`, so `patterns/metric` is also read from
  the user config dir; a `.pat` *could* be installed per user the way
  scripts are.
- A `.pat` holds only families of parallel dashed lines. No arcs, no
  curves, no randomness. **A hand-drawn pattern containing an arc cannot
  become a faithful `.pat`** — which is why the custom-pattern editor
  saves a block and a placement rule instead of a pattern file.
- `ScatterBreakdown` already fills closed boundaries with block
  references, tagged per boundary and re-runnable: the Therion
  "scattered elements" model, already in the house.

## Decisions taken (Nathan, 2026-09-11)

1. **Two fill engines, split per pattern** — hatch entities for the
   filled types, scattered block geometry for the chunky ones. Therion's
   split, because a repeating `.pat` makes a boulder pile look like
   wallpaper.
2. **Boundary is a freehand drag, auto-closed.** Same hand as Feature
   Trace: press, drag, release; the stroke fits a spline and the loop
   closes.
3. **A custom pattern is one drawn element plus a placement rule**
   (scattered or tiled), not a `.pat` export.
4. **Fills redraw themselves live** when the boundary is edited, through
   a transaction listener — the Shaped Lines model.
5. **Areas is a third section of the Draw panel**, not its own dock.
6. **ScatterBreakdown becomes the Blocks area button.** Its menu entry
   survives as a re-run-everything command; its guts move to the shared
   engine and old `BREAKDOWN-BOUNDARY` polylines are adopted as areas.
7. **The Draw panel becomes a two-wide grid** with right-click reorder
   (see "Draw panel layout" below).

## Architecture

An area is a **boundary plus a derived fill**, exactly as a shaped line
is a spine plus derived decoration. The boundary spline is the truth;
the fill is disposable and rebuilt from it.

```
scripts/CaveSurvey/AreaFill/
    AreaFill.js          the Areas section (built by DrawPanel; no dock
                         of its own), tiles, controls, editor mode
    AreaFillRun.js       press / drag / release -> closed spline + fill
    AreaFillEdit.js      the New Area Pattern editor tab
    AreaFillListener.js  boundary changed -> refill
    AreaFill.svg, AreaFill-inverse.svg
scripts/CaveSurvey/AreaSync/
    AreaSync.js          rebuild every area by hand; adopts legacy
                         BREAKDOWN-BOUNDARY polylines
scripts/CaveSurvey/Core/
    CsArea.js            NEW — catalog, seeded RNG, fill generation,
                         regeneration. No widgets.
    CsSymbolStore.js     EXTENDED — already opens the custom library
                         and saves/imports blocks; area patterns are
                         AREA_* blocks in that same library, with their
                         own marker XDATA
```

`Core/CsAll.js` **and** the test harness's hand-written Core list both
gain `CsArea.js`. A file missing from the harness list passes silently
through the deliberate catches, so both edits are mandatory.

The folder is `AreaFill`, not `Area` or `Hatch`: `include()` dedupes by
basename and QCAD ships its own `Draw/Hatch`. A basename collision fails
silently with every test still passing.

Add-on wiring follows the fixed shape — `AreaFill.js` `include()`s its
siblings, the section is BUILT during `init()`, every widget
construction and connect is wrapped so a bridge refusal costs one
control rather than the panel.

### Data model

The boundary spline carries XDATA through `CsTags` (schema v3):

    AreaId        uuid, the identity of this area
    AreaPattern   catalog name, built-in or AREA_* block
    AreaScale     element scale multiplier
    AreaDensity   elements per 100 square drawing units (scatter only)
    AreaSeed      integer, the scatter's dice
    TripId        the trip whose ground it sits on, by nearest station

Every generated fill entity carries `AreaOwner = AreaId`. Regeneration
deletes by that tag, so two adjacent areas never eat each other's fill.

### Seeded, not random

`CsArea.rng(seed)` is a small LCG. `Math.random()` cannot be seeded, and
without a stored seed every listener regeneration reshuffles a whole
boulder room on a two-centimetre nudge. With `AreaSeed` on the boundary,
regeneration is deterministic: the elements near the changed edge move
and nothing else does.

### The two engines

**FILLED** — `water, sump, flowstone, moonmilk`. One `RHatch` entity
built from the boundary loop, rebuilt on change. `bedrock` is the
degenerate member of this family: it generates no fill entity at all,
only its printed boundary. A hatch would
follow its own boundary natively, but it is rebuilt through the same
path as a scatter so that both kinds of area behave identically on a
drag.

**SCATTERED** — `blocks, debris, pebbles, sand, clay, ice, snow, guano,
bones`. Block references placed by the seeded RNG with random position,
rotation and scale within the pattern's jitter range, accepted when the
element's centre is inside the sampled boundary polygon. Boundary
sampling and the point-in-polygon test come from ScatterBreakdown.

A self-intersecting stroke is handled by the even-odd rule and not
cleaned up; v1 does not attempt to repair a figure-eight boundary.

## The catalog

Thirteen built-ins, on existing registry layers where one exists.

| Pattern | Engine | Look | Layer |
|---|---|---|---|
| Blocks / Breakdown | scatter | SYM_BREAKDOWN A/B/C | BREAKDOWN |
| Debris | scatter | angular chips, denser, smaller | BREAKDOWN |
| Pebbles | scatter | small open circles | SEDIMENT-SAND-GRAVEL |
| Sand | scatter | random stipple dots | SEDIMENT-SAND-GRAVEL |
| Clay / Silt | scatter | sparse fine dots | SEDIMENT-CLAY-MUD |
| Bedrock | filled | no fill entity, boundary only | FLOOR |
| Water / Lake | filled | light solid tint | WATER-POOL-SUMP |
| Sump | filled | tint plus sump ticks | WATER-POOL-SUMP |
| Flowstone | filled | fine ruled fill | FLOWSTONE |
| Moonmilk | filled | stipple fill | FORMATIONS-MOONMILK-POPCORN |
| Guano | scatter | short random dashes | GUANO |
| Ice / Snow | scatter | crystal ticks | ICE-SNOW (new) |
| Bones | scatter | bone glyph, sparse | ARCHAEOLOGY |

Two registry additions: `ICE-SNOW` (cyan, CONTINUOUS, Weight018) and
`CTRL-AREA-BOUNDARY` (gray, DASHED, Weight000). Profile and section
twins are DERIVED from the plan row by the existing machinery and are
never hand-copied.

### Boundary visibility is per pattern

Most boundaries are scaffolding and land on `CTRL-AREA-BOUNDARY` —
invisible in print, grabbable on screen. Four are real map linework and
keep their pattern's own layer: Water/Lake (the shoreline), Sump,
Flowstone, and Bedrock (which is boundary-only by definition).

### Routing by location

Same rule as Feature Trace since 0.9.48.0. Where the drag happens picks
the view:

    frame = CsProfileBox.frameAt(doc, region, point, bays)
    layer = CsLayers.twinFor(entry.layer, frame)
    layer = CsLayerVariants.nameFor(layer, run)   // profile bands only

Boundary and fill both route. An area drawn in a section bay is stamped
with `SectionTraceStation` and its bay tag, as a section trace is. There
are no per-view buttons.

## The Areas section

A tile wall in the shape of the other two sections. Each tile is a
picture of the actual fill: `CsTileArt` renders a small patch through
the real generator, so no tile can drift from what the button draws.

- Controls: Scale, Density (disabled for a filled pattern), a search box
  across pattern names, and **New Area Pattern… / Edit / Delete**, the
  last two enabled only for a custom pattern.
- Exactly one tile armed at a time; the armed tile IS the indicator.
- Fold state is remembered, as in the other sections.

## The stroke

`AreaFillRun` is an `EAction` in the `FeatureTraceRun` shape.

- **Press** starts the stroke at the snapped point.
- **Move** collects points and rubber-bands the developing loop.
- **Release** fits a spline through the sampled points with the existing
  `CsTrace` fitter and forces it closed.
- A stroke of too few points, or enclosing a trivially small area, is
  discarded silently rather than making a degenerate area.
- Boundary, tags and fill are committed in ONE transaction: one undo
  step removes the whole area.
- The action stays armed for the next area; Escape ends it.

A locked or frozen target layer swallows adds silently in this build, so
the layer state is read back and named in the refusal, in Feature
Trace's `refusalReason` voice.

## The custom pattern editor

**New Area Pattern…** opens a drawing tab from a small editor template
carrying an origin crosshair and a reference square at the element's
nominal size. The panel switches to editor mode with these fields:

- name
- home layer — a combo from `CsLayers.DEFAULTS`, plan-frame names only
- placement — Scattered or Tiled
- default density
- scale jitter, min and max
- rotation — random or fixed

**Save Pattern** takes every entity except the crosshair and the
reference square and writes block `AREA_<slug>` into the caver's own
symbol library — `CsSymbolStore.customPath()`, i.e.
`~/Documents/Cave/symbols/CaveCustomSymbols.dxf` — through
`CsSymbolStore.saveBlock`, with an invisible marker point on
`CTRL-HIDDEN` carrying, via `CsTags`:

    AreaName, AreaLayer, AreaPlacement, AreaDensity,
    AreaScaleMin, AreaScaleMax, AreaRotate, AreaCustom = "1"

The block is therefore self-describing: import-on-demand into an old
drawing carries the placement RULE along with the geometry, so the
pattern works there, not just its shapes.

**Edit** reopens a custom pattern's block in the editor. **Delete**
removes it from the template only — never from drawings that used it.

No upgrade risk, and this is a CORRECTION to an earlier draft of this
spec: custom symbols stopped living in the template on 2026-09-07
precisely because a release replaces it. Area patterns join them in the
library file, which no installer touches and which sits in the Cave
folder that syncs and gets backed up.

## Regeneration

`AreaFillListener` uses `RTransactionListenerAdapter` in the
`ShapedLinesListener` shape:

- A modified entity carrying an `AreaId` marks that area dirty.
- Regeneration deletes every entity tagged with that `AreaOwner` and
  rebuilds from the boundary and the stored seed.
- A re-entry guard stops a regeneration from triggering itself.
- No-op writes are suppressed (the freeze lesson: a float that
  regenerates forever).
- A deleted boundary takes its fill with it.

**Sync Areas** does the same by hand for a whole drawing, and is what
adopts legacy `BREAKDOWN-BOUNDARY` polylines into areas.

## Draw panel layout

The Draw dock stops being two fixed columns. With a third section the
old layout puts either Areas below the fold or all three too narrow to
show a tile wall.

- **A two-wide grid, rows descending in section order.** New sections
  append to the end.
- **A section alone on the last row spans the full width.** With three
  sections: Trace and Symbols share row one, Areas takes row two whole.
- **Tile columns derive from cell width** — two tiles across in a
  half-width cell, four in a full-width one. Tiles keep their size; the
  grid gets wider.
- **Rows size to content**, so a short section does not pad a tall
  neighbour.
- **A folded section keeps its cell** — a half-width header strip whose
  row-mate stays half-width. A fold never reflows the grid.
- **Right-click a section header for Move Up / Move Down / Reset Order**,
  the moves disabled at the ends. The order persists in
  `CaveSurvey/DrawOrder` as section titles. A title in the setting that
  no longer exists is ignored; a section not in the setting appends
  after its original predecessor — so a saved order survives a tool
  being added or removed.
- **This machinery already exists.** `CsPanel.stack`, `stackAdd`,
  `moveSection`, `saveOrder`, `orderedTitles` and `applyOrder` are what
  Feature Trace and the Symbol Palette already use for their inner
  sections, right-click menu included — the bridge hands script mouse
  events to four widget classes and a header is none of them, so
  drag-to-reorder is impossible and the menu is the answer. The only
  missing piece is GRID relayout: `CsPanel.relayout` calls
  `insertWidget`, which is a box layout's method. The stack gains an
  optional column count and a grid relayout that spans a lone last
  section across both columns.

Reordering re-adds the EXISTING section widgets into the grid at their
new positions. Section bodies are never rebuilt: each keeps its widgets
in a single module-level `widgets`, and a second copy would leave one
copy wired to nothing — a panel that looks right and does nothing.

## Testing

Engine tests, headless in the harness:

- `CsArea.rng` determinism: same seed, same placements; different seeds
  differ.
- Point-in-polygon against known cases, including a concave boundary.
- Element count scales with boundary area at fixed density.
- Boundary tag round-trip: write, reopen, read back every key.
- Catalog / registry agreement: every catalog layer exists in
  `CsLayers.DEFAULTS`. A failure means fix the catalog — never add an
  exception entry.
- Regeneration is idempotent: regenerating twice leaves the same entity
  count, and leaves a clean boundary untouched.
- Draw panel order: a saved order with an unknown title and a missing
  title still yields every built section exactly once.

GUI checks run live through the MCP bridge: arm a tile, drag an area,
confirm the fill and its layer; drag the boundary and confirm the refill;
save a custom pattern and place it. CaveCAD is restarted properly first —
a quit blocked by unsaved changes leaves the old add-on running, and
"verified live" then means verified against stale code.

## Out of scope for 0.9.116.0

- Boundary repair for self-intersecting strokes.
- Filling a region detected from surrounding walls (click-inside-to-fill).
- Exporting a custom pattern as a `.pat` for QCAD's own Hatch dialog.
- Merging custom patterns across a template upgrade.
