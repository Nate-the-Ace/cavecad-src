# Depth of cover, and a station you can click

**Date:** 2026-09-19
**Status:** design approved, not implemented
**Repos:** `cavecad-tools` (script side) and `cavecad-src` (renderer)

## The problem

The 3D panel can colour the passage seven ways, and every one of them is
a fact about the *survey*: which trip, how deep below the cave's own
highest point, how far in, how big, how well closed. None of them is a
fact about the *rock*.

The question a caver actually asks standing over a cave is how much
ground is above it. Thin cover is where a passage might daylight, where
a dig from the surface is worth trying, where breakdown comes from, and
where a road or a quarry above is a problem. The terrain work of
0.9.139.4 put the real answer in reach — the 3DEP grid beside the
drawing, placed in the survey's own vertical frame — and nothing asks it.

Two things here, one build:

1. **Depth of cover** — an eighth colour mode: ground elevation above the
   passage ceiling, hot where the rock is thin.
2. **A station card** — click a station in the view and get its numbers,
   which is where a single cover figure belongs and where several other
   facts already computed for other modes have nowhere to appear.

## What is already there

- `Cave3D.terrainBuffer` loads `<name>-surface.tif`, reads
  `SurfaceBbox` off the geo anchor, builds `CsGeoProject.gridTransform`,
  and gets `CsLocationPick.datumOffset`. **Everything cover needs is in
  that function already** — it is loaded, placed, and converted.
- `CsTerrain3d.mesh` converts a grid reading to survey z:
  `CsUnits.convert(metres) - offset`. Cover uses the same arithmetic;
  it must not grow a second copy.
- `CsMesh3d.build` already carries ramp modes (a number per station,
  coloured by where it sits in a range) and banded modes (a swatch per
  station), with the legend built on the same side as the colours.
- `CsMesh3d.stationLabels` hands the view **every** station, and
  `RCave3dLabels` decides which can be read. The view therefore already
  holds every station's world position — the hit test needs no new data.
- `RCave3dLegend` is the pattern for a child widget over the GL view.
  A QPainter inside `paintGL` draws nothing on this build.

## Depth of cover

### What it measures

`cover(station) = groundZ(x, y) − ceilingZ`, where `ceilingZ` is
`station.z + up` from the LRUD at that station, and `station.z` where
there is no up reading. Vertical rock thickness over the top of the
passage, which is the number a dig or a drill cares about.

Ground-minus-centerline was rejected: it overstates cover by the passage
height, and in a 30 ft borehole that is the whole finding. A true nearest
distance to the surface mesh was rejected as its own project — right
under a cliff, much slower, and not what the first version of this
should promise.

### Sampling the grid

New pure primitive, `Core/CsCover.js`:

- `CsCover.sampler(grid, transform, opts)` → `function(x, y)` giving
  ground z in the SURVEY's vertical frame, or `null`.
  `gridTransform` is affine, so the inverse is three samples of it
  (`(0,0)`, `(1,0)`, `(0,1)`) and a 2x2 solve — no search.
  Bilinear between the four surrounding readings.
- **A no-data corner makes the sample `null`, not a floor value.**
  `CsTerrain3d.mesh` fills holes with the grid's lowest real reading so a
  bounding box stays usable; a *measurement* filled that way would report
  hundreds of feet of cover over a hole in the data. Outside the grid is
  `null` for the same reason.
- `CsCover.atStations(survey, resolved, sample, opts)` →
  `{name: feet|null}`, ceiling-based as above, reusing
  `CsMesh3d.lrudAt`.

**Negative cover is kept, never clamped.** A station above the modelled
ground means a wrong datum, a bad anchor, or a sample off a cliff edge —
exactly the family of [[cave-survey-elevation-datum-trap]] — and a
`Math.max(0, ...)` hides it. The status line says how many stations sit
above the surface.

### Colour

`colorBy: "cover"`, a ramp, clamped 5th–95th percentile like passage
size, with the legend saying it is clamped.

`CsMesh3d.coverColor(t)`: **t = 0 is thin and hot** (red → orange →
yellow), t = 1 is deep and cool-dark. Deliberately unlike both the depth
ramp (cool, light-to-dark) and the generic `rampColor`, so no two modes
read alike. A station with `null` cover is drawn in one flat unknown
grey, and the legend carries that grey as a labelled swatch — a ramp
whose bottom end silently means "no data" is a lie about the rock.

The mesh stays pure: `CsMesh3d.build` takes `opts.cover` (the values map)
and never touches a grid, a TIFF or a document.

### When there is no surface

The mode stays selectable. The mesh draws entirely in the unknown grey
and the status line says exactly which step is missing, reusing
`terrainBuffer`'s existing sentences ("run Surface Data to fetch the
ground above this cave", "this drawing has no georeference", and so on).
Falling back to trip colouring would look like it worked.

`terrainBuffer` is split so both callers share one load:
`Cave3D.surfaceContext(doc)` → `{grid, transform, offset, unit, why}`.
Cover and terrain then cannot disagree about where the ground is.

### The status line

`thinnest cover 14 ft at A7  --  thickest 190 ft` plus, when it applies,
`3 stations sit above the surface`. The thinnest station and its name is
the figure a caver quotes; a ramp alone cannot be read to a number.

## The station card

### Picking

Hit testing lives in `RCave3dView`, not in `RCave3dLabels` — the view
already owns the mouse and knows a drag from a click, and a clickable
label widget would have to hand unhandled presses back to the camera.

On release within 4 px of the press, the view projects every station it
was given, keeps those within 20 px of the cursor, and takes the nearest
in screen distance (ties by depth, nearest eye first). **Any station
answers, whether or not its name survived label culling** — most labels
are culled at any distance, and clicking a passage that shows no name
must not be dead.

A miss closes an open card.

### The card

New `RCave3dCard`, a child widget of the view, painted like
`RCave3dLegend`: rounded panel, title line, then rows of
label / value pairs, a close affordance, Esc to dismiss.

**It is pinned to the station, not to the pixel.** The view re-projects
the station each paint and moves the card beside it, hiding it when the
station goes behind the eye or off screen. A card pinned to where the
mouse was becomes a label for empty air on the first camera move.

**The view never computes a row.** As with the legend, the script hands
over finished strings: `showStationCard(handle, station, title, rows)`
where rows are `[[label, value], ...]` already in the drawing's units,
with trips named and dates formatted. Every unit that knows what a foot
or a trip is stays script-side.

### What it says

Built by a new pure `Core/CsStationCard.js` so it is testable headless:

- Trip, with its date
- Elevation, relative — and absolute when `datumOffset` is known
- Depth of cover, and the ground elevation it came from
- Distance in from the anchor
- Passage: L / R / U / D, and how many splays
- Closure shift, when the survey is adjusted

Rows whose fact is missing are **omitted**, not shown empty.

**No coordinates, ever.** Not latitude, not longitude, not the drawing
point. The card is the obvious place someone would add them and this
suite's first rule is that a cave's location does not leave it — see
[[cave-location-privacy]]. A test asserts no row carries a coordinate.

## Out of scope

- Cover values written into the plan drawing (its own tool, own spec).
- Nearest-distance-to-surface cover.
- Editing anything from the card. It reads.

## Tests

Headless: the inverse transform against `gridTransform` round trip;
bilinear against a hand-computed cell; a no-data corner giving `null`;
cover as ground minus ceiling with and without an up reading; negative
cover preserved; the legend carrying the unknown swatch; card rows
omitted rather than blanked; no coordinate row.

Both new Core files must be added to the test harness's hand-written
load list — a missing file otherwise passes silently through the
deliberate catches ([[cavecad-test-harness-traps]]).

GUI, over the MCP bridge: a click picks the station under it, the card
follows the camera, a miss closes it, Esc closes it.

## Ship

tools `0.9.147.0`; `cavecad-src` gui bump. Handbook's 3D panel page gains
the mode and the card. Deploy, deep re-sign, `publish.sh`.
