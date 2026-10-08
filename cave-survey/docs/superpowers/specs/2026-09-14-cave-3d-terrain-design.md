# Surface terrain in the 3D view

**Date:** 2026-09-14
**Status:** design approved, not implemented
**Repos:** `cavecad-tools` (script side) and `cavecad-src` (renderer)

## The problem

The 3D panel draws the surveyed passage in space with nothing around it.
A cave read that way is a shape floating in the dark: you cannot tell
whether a passage runs under a ridge or under a road, how deep below the
surface a lead sits, or which of two levels is the one that daylights.

Surface Data already fetches both halves of the answer — a USGS NAIP
aerial photograph and a USGS 3DEP elevation grid — and draws them into
the plan drawing. The 3D view uses neither.

This spec adds a terrain surface to the 3D panel: the 3DEP grid as a
triangle mesh, the NAIP photo draped over it, semi-transparent so the
cave reads through the hill, with the surface contour lines available as
a separate overlay.

It also closes a gap the terrain work exposes. A cave's station
elevations are stored on whatever datum the survey ran on. Nothing in the
suite knows how to relate them to a real-world elevation, so there is no
honest way to place a cave against a NAVD88 terrain surface. One stored
number fixes that for every tool, not just this one.

## What is already there

Read this before touching anything — most of the pipeline exists.

- `Core/CsSurfaceData.js` fetches a float32 GeoTIFF from 3DEP
  (`CsGeoProject.demUrl`), parses it, draws contours, and **deletes the
  TIFF**. It also samples the surface elevation at the anchor and prints
  it, deliberately not storing it.
- `Core/CsContour.js` — `parseFloatTiff` (grid out of the latin1 byte
  string) and `lines` (marching squares at one level, grid coordinates
  out).
- `Core/CsGeoProject.js` — `mercatorBbox`, `pixelSize`, `gridTransform`
  (grid coordinates to drawing coordinates), `anchorGridCoord`. DEM caps:
  `DEM_MAX_PX = 512`, `DEM_MIN_PX = 64`, native 1 m.
- `Core/CsTags.js` — every station carries an `Elevation` tag
  (`tagStation`); the georeference anchor carries `GeoLat`, `GeoLon`,
  `GeoStation`. There is **no** elevation on the anchor.
- `Core/CsElevation.js` — elevation at a point on the alignment, floor
  rather than centerline. Already the designated primitive for this
  question; do not grow a second copy.
- `RCave3dView` / `RCave3dTexture` — textured, indexed geometry already
  works: the draped sketch scans go through `setMesh`'s `scans` block as
  `{positions, uvs, indices, paths, runs}`.

The aerial photo already persists beside the drawing as
`<name>-aerial.png`, and both it and the DEM are requested from **one
shared bbox** computed by `CsSurfaceData.contours`/`basemap`. Photo and
grid therefore register against each other by construction — there is no
image-fitting step to write, and there must not be one.

## Data model: the datum anchor

### `GeoElev`

A new tag on the georeference anchor station, beside `GeoLat`/`GeoLon`:
the **raw 3DEP ground elevation at the anchor**, in **metres, NAVD88**,
regardless of the drawing's unit — the same store-canonical,
convert-at-read convention `GeoLat`/`GeoLon` follow.

Raw ground, not the entrance's own elevation. The entrance sits some
distance below the ground surface, and that distance is a guess unless
somebody measured it. Storing the guessed-down value would cement a guess
into data that later readers cannot distinguish from a measurement, and
would make re-fetching a better DEM a two-step correction instead of an
overwrite of one honest number.

Written by Surface Data's contour pass, which already computes exactly
this value and currently only prints it.

### The entrance depth

`CsElevation.ENTRANCE_DEPTH_FT = 5` — how far A1 sits below the ground
directly above it. A display-time constant, applied on read, never
stored. Five feet is the project default; a per-cave measured depth is
out of scope here and would arrive as its own tag.

### Deriving an absolute elevation

```
CsElevation.datumOffset(doc)  ->  number | null
```

The constant that turns a survey `Elevation` into an absolute one:

```
offset   = (GeoElev - entranceDepth) - Elevation(GeoStation)
absolute = Elevation + offset
```

`null` when `GeoElev` or the geo station is missing. **Absent is
unknown, not zero** — the rule the rest of `CsElevation` already
follows, and the one the elevation-datum-trap family keeps punishing.
Every caller must handle `null` by declining to answer, never by
substituting 0.

### What this deliberately does not do

**No survey elevation is rewritten.** Every `Elevation` tag stays exactly
as surveyed; the offset is applied when something needs an absolute
number. Rewriting them would rebase the survey against a 1 m-resolution
national DEM, which is the elevation-datum trap with extra steps.

Existing tools keep reading relative elevations exactly as they do today.
Switching callouts, profile bands or reports to an absolute display is a
separate spec, to be written once `GeoElev` has proved itself on real
caves.

### Privacy

`GeoElev` is locating data. It joins `GeoLat`/`GeoLon` everywhere those
are handled:

- `CsSanitize` strips it.
- `PackageCave`'s sanitized package excludes it, and excludes
  `<name>-surface.tif` exactly as it already excludes the aerial.
- `CsReset` clears it with the rest of the geo anchor.

A missing entry in any of those three is a privacy leak, not a cosmetic
omission. See the project's first rule on entrance locations.

## Terrain pipeline

### Keeping the grid

`CsSurfaceData.contours` stops removing its temp TIFF and instead writes
it beside the drawing as `<name>-surface.tif` — the `<name>-aerial.png`
pattern, neutral filename, no coordinates in it. The contour pass is
otherwise unchanged.

The drawing must be saved for this, as it already must be for the
imagery pass. An unsaved drawing keeps today's behaviour: contours drawn,
nothing kept, and the 3D terrain unavailable until the drawing is saved
and Surface Data re-run.

### `Core/CsTerrain3d.js`

Pure ECMAScript, no document, no GUI, no network, so `tests/js_unit.js`
exercises all of it. Takes a parsed grid and produces renderable buffers.

```
CsTerrain3d.mesh(grid, transform, opts)
  -> {positions, normals, uvs, indices, bounds}
```

- **Indexed, shared vertices.** Unlike `CsMesh3d`, a terrain grid's
  vertices genuinely are shared: `w*h` vertices against `(w-1)*(h-1)*6`
  indices. At the DEM cap that is 262k vertices and 1.5M indices, which
  is why `setMesh` must stop ignoring `indices` for this block.
- **Decimated** to `CsTerrain3d.TARGET_CELLS = 200` per axis, by
  integer striding. The transfer across the QVariantList bridge, not the
  GPU, is what this protects.
- **Smooth normals**, averaged per vertex — terrain is a continuous
  surface, and flat normals would faceted-shade a hillside into a
  geodesic dome.
- **No-data cells drop their triangles.** 3DEP writes a huge negative
  float where it has nothing (`CsContour.isNoData`); a triangle touching
  one must be omitted, never clamped, or the mesh spikes to the floor of
  the world.
- **uvs** are the vertex's fractional position in the grid, which is its
  fractional position in the photo, because both came from one bbox.
- `transform` is `CsGeoProject.gridTransform(...)` composed with
  `datumOffset` — the same vertical frame the cave is drawn in.

```
CsTerrain3d.contourLines(grid, transform, levels)
  -> {positions, colors}
```

Reuses `CsContour.lines` per level and lifts every vertex of that level's
polylines to that level's own elevation. The lines therefore sit **on**
the surface by construction; there is no draping pass and no sampling
error to reconcile. Majors (every fifth level) take the brighter colour,
matching the plan drawing's `CTRL-CONTOUR-MAJOR` convention.

### Vertical placement

Terrain is drawn at true NAVD88. The cave is drawn through
`datumOffset`, which is what raises it to meet the surface: A1 lands
`ENTRANCE_DEPTH_FT` below the ground directly above it, and every other
station keeps its surveyed offset from A1. One rigid shift of the whole
cave, computed once per build.

This is the general rule for relating survey elevations to the world, not
a 3D-panel special case. The 3D panel is simply its first consumer.

The status line reports the shift in drawing units — `cave raised 87 ft
to meet the surface` — so a survey on a wrong or arbitrary datum shows
itself as an implausible number instead of hiding behind a rendering that
always looks right.

## Rendering

### The bridge

A new block in the `setMesh` map:

```
terrain: {positions, normals, uvs, indices, texture,
          lines: {positions, colors}, bounds}
```

`texture` is the absolute path to `<name>-aerial.png`, or empty when the
drawing has no aerial — in which case the mesh still draws, shaded, with
no drape.

New `Q_INVOKABLE`s on `RCave3dBridge`, following the existing
`setShowScans`/`setScanInk` shape:

- `setShowTerrain(handle, bool)`
- `setShowTerrainContours(handle, bool)`
- `setTerrainOpacity(handle, double)` / `getTerrainOpacity(handle)`

`RCave3dPanel::setTerrainAvailable(bool)` gates the controls, set from
whether `terrain.positions` is non-empty.

### Drawing order

Terrain draws **last**, after the passage, with blending on and
**depth-write off**. Depth-test stays on, so terrain is still occluded by
anything genuinely in front of it, but a transparent hillside must not
stop the cave behind it from being drawn. Contour lines draw with
depth-write on at full opacity, so they read against both the drape and
the sky.

Textures reuse `RCave3dTexture` unchanged.

**GL objects must be destroyed against the context that owns them.** The
terrain texture and buffers follow the existing rule: forgotten in
`initializeGL`, destroyed in the `aboutToBeDestroyed` slot. A dock float
kills the context, and freeing a texture afterwards is `EXC_BAD_ACCESS`.

### Controls

In the panel toolbar, grouped after the existing overlay toggles:

- **Terrain** — checkbox, off by default.
- **Contours** — checkbox, off by default, enabled only with Terrain on.
- **Opacity** — slider 0–100, default **50**, modelled on the existing
  Scan ink slider, live, remembered for the session.

Any widget placed in a `QToolBar` is shown and hidden through the
`QAction` that `addWidget` returns — `setVisible` on the widget itself
does nothing, silently.

`viewAll` fits the union of the cave and terrain bounds. Terrain is
wider than the cave by the 25% margin plus the 150 m floor, so fitting
the cave alone would frame terrain off-screen, and fitting terrain alone
would shrink the cave to a thread.

## Failure modes

Each says what is missing and what to do about it. None of them silently
degrade.

| Condition | Behaviour |
|---|---|
| No georeference anchor | Terrain controls disabled. Status line: run Surface Data, which acquires an anchor as it already does. |
| No `<name>-surface.tif` | Terrain controls disabled. Status line: run Surface Data to fetch the elevation grid. |
| Drawing never saved | As above — the grid has nowhere to live. |
| TIFF present, `GeoElev` absent (older drawing) | Terrain draws at true NAVD88; the cave is **not** shifted. Status line flags that the cave's datum is unknown and the two may not agree. Never guess an offset. |
| No `<name>-aerial.png` | Mesh draws shaded, no drape. Opacity slider still applies. |
| Grid entirely no-data | No terrain; existing "3DEP covers the United States" message. |
| Corrupt TIFF | Terrain unavailable, parse error surfaced verbatim in the status line. |

## Testing

### Headless (`tests/js_unit.js`)

`CsTerrain3d` is pure, so all of this runs under node:

- Mesh from a synthetic grid: vertex count, index count, consistent
  winding, normals pointing up, uv range within [0,1].
- Decimation: a grid above `TARGET_CELLS` strides down; one below is
  untouched.
- No-data: a hole drops exactly the triangles touching it and no others;
  no vertex lands at the no-data value.
- `contourLines`: every vertex of a level's polyline carries that level's
  elevation.
- `CsElevation.datumOffset`: the arithmetic, and that a missing
  `GeoElev` or geo station returns `null` rather than 0.
- Sanitize and package strip `GeoElev` and exclude `<name>-surface.tif`.

`CsTerrain3d` must be added to `CORE_FILES`. The harness loads Core by a
hand-written list, and a file missing from it passes silently through
deliberate catches — a green suite proves nothing about a file it never
loaded.

### Document-level (`tests/surface_data_run.js`)

- A contour run on a saved drawing leaves `<name>-surface.tif` beside it.
- The same run writes `GeoElev` on the geo station, in metres.
- A re-run replaces both without duplicating the anchor tag.

### Live GUI (MCP bridge, on Pitfall Cave)

None of these are reachable headless:

- Drape registers against the cave — a road in the photo lands where the
  plan drawing puts it.
- The cave reads through the terrain at 50% and is hidden at 100%.
- Both toggles, and the slider's live response.
- `viewAll` frames cave and terrain together.
- A1 sits roughly 5 ft below the surface, and the status line's reported
  shift matches the cave's known entrance elevation.

Verify against `cavecad-src/debug/CaveCAD.app`, not the packaged
`/Applications` build. And confirm the app actually restarted: a quit
blocked by unsaved changes leaves the old add-on running, and "verified
live" then means verified against stale code.

## Out of scope

- Absolute-elevation display in callouts, profile bands or reports. Own
  spec, after `GeoElev` proves itself.
- A measured per-cave entrance depth. The 5 ft constant stands.
- Terrain from any source but 3DEP; terrain outside the United States.
- Slicing, clipping or cutaway views of the terrain.
- Re-fetching the DEM from inside the 3D panel. Surface Data owns the
  network.
