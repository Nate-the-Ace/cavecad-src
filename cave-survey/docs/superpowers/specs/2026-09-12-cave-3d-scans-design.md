# Sketch scans in the 3D view -- design

Date: 2026-09-12
Status: approved
Version target: cavecad-tools 0.9.123.0 (plan) and 0.9.124.0 (profile),
cavecad-src 0.6.0.0

## What this is

The caver's own scanned sketches, hanging in the 3D view on the passage
they were drawn of. Plan scans first, profile scans straight after.

Sections are already done and took a different road: a captured section
holds traced GEOMETRY, so it needed no textures. Scans are pictures, so
this is where the texture pipeline finally gets built.

## Where a scan's file actually lives

PROBED, NOT ASSUMED, against Truitt's 28 plan scans. An image entity's
own `getFileName()` returns EMPTY and `getWidth()`/`getHeight()` return
ZERO, through both the method and the property route. Taking those at
face value would have produced a drape that found no images and said
nothing.

The suite keeps the path in XDATA instead, under the key `SketchScan`,
stored RELATIVE to the cave's scans folder:

    "2024 Scans/7-7-24 Survey notes/20240707-TRUITT_Page_03.jpg"

`CsCave.resolveUnderScans(scansFolder, stored)` turns that into an
absolute path. Pixel dimensions come from the image FILE, read when it
is loaded for its texture, since the entity does not report them.

Placement is `getInsertionPoint()`, `getUVector()`, `getVVector()` --
these DO work, and u and v are PER-PIXEL vectors, so the scan's far
corner is `origin + widthPx * u + heightPx * v`.

## The trimmed images are free

`CsScanTrim` works by pointing the image entity at a smaller derivative
file under `scans/Trimmed/` -- DXF has no image clipping in this engine,
so "place only this part" can only mean a separate file. Whatever the
drawing references IS the trimmed image. Nothing to choose, nothing to
resolve.

## Both drapes are one idea

Each is "sample the survey for the coordinate the sketch does not
carry":

    PLAN     the sketch carries x and y, and needs z
    PROFILE  the sketch carries distance-along-run and elevation,
             and needs x and y

Plan becomes a subdivided grid in XY with z sampled per vertex; profile
becomes vertical strips, one per leg, each standing on its own leg.

## Plan: sampling elevation

Inverse-distance weighting from nearby stations, the same `1/distSq`
weighting `CsWarp` already uses for linework and guarded the same way
against a query point sitting exactly on a station.

THIS INVENTS ELEVATION BETWEEN STATIONS, and that has to be said plainly
because `CsLrud` refuses to invent wall detail between measured points
and this is the same class of act. What makes it defensible is that the
3D panel DRAWS NO ENTITY AND WRITES NO TAG -- it has always been a view.
Inventing a surface to look at is not inventing survey data. Nothing
here may ever be written back into a drawing.

Beyond `CsDrape.REACH` from any station the drape goes FLAT rather than
extrapolating: past the last station there is no trend to follow, and a
plane is an honest answer where a guessed slope is not.

## Profile: no vertical exaggeration to undo

Settled by deleting it. Version 0.9.123.0 removed the profile's vertical
exaggeration outright -- the setting, the stamp, and the parameter
threaded through unrollBand, bandWallRuns and CsProfileDraw -- because
hand-drawn profiles are not exaggerated and the generated bands should
match them.

So a band's y IS elevation, and the drape has nothing to divide out.
This section used to describe machinery to recover an exaggeration
factor; that machinery does not need to exist.

## Profile: the mapping

`CsProfile.unrollBand` returns `stations: [{name, x, y, z}]` in
band-local coordinates and `legs: [{from, to, fromX, fromY, toX, toY}]`.
That is the forward map; the drape needs it backwards:

  1. `CsProfileBox.boxes(doc)` gives `{key, minX, minY, maxX, maxY}` per
     band; `CsProfileBox.at(boxes, point)` says which band a scan sits
     in, and the key is the run.
  2. Re-derive that run's band with `unrollBand`.
  3. For a scan pixel at band-local x, find the leg whose `fromX..toX`
     spans it and interpolate to get `t` along that leg.
  4. The real position is `lerp(resolved.stations[from],
     resolved.stations[to], t)` -- x and y recovered.
  5. z is the scan's own band-local y, un-exaggerated and re-datumed.

STRIPS, ONE PER LEG, because step 3 is only linear within a leg. A
single quad across a bend would cut the corner.

## Keying out the paper

A scan is mostly white paper; drawn opaque it is a wall. The fragment
shader discards a fragment whose luminance exceeds `CsDrape.INK_MAX`, so
only the pencil floats over the passage.

Faint pencil on grey paper may drop out with the background. The
threshold is therefore a named constant and not a magic number, and if
real scans need it adjustable it becomes a control rather than a
recompile.

## The texture pipeline

New in C++, and the first textures in this renderer:

  upload      QImage -> QOpenGLTexture, downscaled to MAX_TEXTURE_PX on
              the long edge. Trimmed scans are smaller but still
              megapixel JPEGs, and a cave with thirty of them would
              otherwise eat VRAM for pictures nobody is looking at
              closely.
  shader      a second program: textured, with the luminance discard
  blending    on, depth-WRITE off for the scan pass, drawn after the
              geometry, so overlapping sketches do not z-fight
  lifetime    textures owned per scan and dropped on clear(), and
              rebuilt when the GL context is remade -- which a dock does
              every time it floats

## Architecture

    Core/CsDrape.js        PURE: elevation sampling, grid generation,
                           band-local inverse mapping, exaggeration
                           derivation. Plus a QCAD half that reads image
                           entities off CTRL-SCAN and CTRL-PROFILE-SCAN.

    RCave3dTexture         C++: one scan's image as a GL texture
    RCave3dView            a textured-quad pass and its visibility flags
    RCave3dBridge          carries scan meshes and their image paths
    RCave3dPanel           "Plan scans" and "Profile scans" toggles

The C++ side still knows nothing about caves: it is handed triangles,
texture coordinates and a file path.

## Order of work

PLAN FIRST, because it proves the texture pipeline -- upload, keying,
blending, downscaling, context loss -- against the geometry with no
ambiguity in it. PROFILE SECOND and soon, because it is the one Nathan
actually wants and because its risk is all in the mapping rather than in
the rendering, which by then will be known good.

They ship as two versions so the first is usable before the second is
finished.

## Testing

Pure, headless:

  - elevation sampling returns a station's own z at that station
  - it interpolates between two stations, and goes FLAT beyond REACH
  - a grid over a scan quad has the right vertex and index counts, and
    no NaN
  - band-local x maps onto the right leg, including at a leg boundary
  - a point past the end of a band clamps rather than extrapolating

Live:

  - a plan scan lies over the passage it was drawn of
  - paper keys out; pencil survives
  - a profile scan follows the passage round a bend
  - a profile drape sits at true elevation -- checked against a known
    passage height, since a stretched one still looks fine
  - floating and re-docking the panel does not lose the textures

## Out of scope

Section scans as textures -- sections already draw from traced geometry
and the picture adds only the original pencil. Editing or re-fitting a
scan from the 3D view. Any write back into the drawing.

---

## As built (2026-09-12, 0.9.124.0 plan / 0.9.125.0 profile, src 0.6.0.0)

Both drapes shipped. Four things worth keeping.

### A scan entity does not know its own file

Probed, not assumed. `getFileName()` returns EMPTY and
`getWidth()`/`getHeight()` return ZERO on Truitt's 28 plan scans,
through BOTH the method route and the property route. The path is XDATA
under `SketchScan`, relative to the cave's scans folder; the pixel size
comes from the file.

The test fixture then hit the same trap from the other side:
`RImageData`'s constructor vectors do not stick, because the entity has
no `setData`, does not forward `setUVector`/`setVVector`, and
`getData()` hands back a copy. A fixture quietly building a zero-sized
scan would have been testing nothing.

### GL objects must be destroyed against the context that owns them

Floating the dock crashed with EXC_BAD_ACCESS inside
`QOpenGLTexturePrivate::destroy()`. Reparenting a QOpenGLWidget destroys
its context; `initializeGL` then runs against the NEW one, and deleting a
texture there calls into the freed context. The shader programs carried
the same latent bug and had simply not been the ones to fault.

`initializeGL` now FORGETS what it holds without calling into GL, and
the real destruction happens in a slot on `aboutToBeDestroyed` while the
owning context is still alive and current.

### CsProfileBox.at returns the KEY, not the box

And profile scans are routinely WIDER than the band box they were fitted
over -- measured, a scan centred at x 606 against a box ending at 423,
which missed eleven of sixteen. Bands are stacked in elevation and all
start at the same x, so the band is found by Y containment, and the box
object is then looked up for its span.

### A band is drawn 1:1 at an offset

Recovering band coordinates is a TRANSLATION, not a rescaling. Treated
as a rescaling, the sketches landed below the cave -- drape z -60 to 44
against a cave spanning -21 to 0. The offset comes from the box: its
minimum corner is the band's own minimum corner, moved to wherever the
region was drawn.

## Verified live on Truitt Cave

28 plan scans draping onto the passage at 17500 vertices and 32256
triangles, paper keyed out and pencil surviving; 11 profile scans in
strips, seamed at every leg boundary so they follow the passage round
its bends; textures surviving a float and re-dock.

NOT verified: nothing was measured against a known passage height to
confirm the profile drape sits at true elevation rather than merely
plausible elevation. The translation is asserted in the unit tests
against a band built by CsProfile itself, which is the strongest check
available without a hand-measured reference.
