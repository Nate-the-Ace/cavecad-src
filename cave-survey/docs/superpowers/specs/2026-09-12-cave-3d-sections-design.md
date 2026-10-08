# Cross sections beside the 3D cave -- design

Date: 2026-09-12
Status: approved
Version target: cavecad-tools 0.9.122.0, cavecad-src 0.5.0.0

## What this is

Every cross section the caver has captured, standing on its own plane in
the 3D view, offset clear of the passage, with a leader back to the
station it belongs to.

NO TEXTURES. A captured section's block holds real traced geometry, so
this draws lines and reuses the flat-line shader that already exists.
The textured-scan version of the same idea is a later and separate
thing; it buys the original pencil instead of the tracing, and costs the
entire texture subsystem to get it.

## Everything needed is already recorded

A section block reference carries, as XDATA (CsCallout.KEY):

    SectionStationRef   the station the section belongs to
    SectionScale        drawing units per real unit
    SectionScan         the scan file -- unused here, wanted later
    SectionBayFit       how the scan maps on -- unused here
    SectionSource       traced from a sketch, or computed from LRUD

And from SectionCapture.js: "THE BLOCK IS BLOCK-LOCAL about the ghost's
centre, which is where the centreline of the passage was. So the
reference's insertion point IS the centreline on the sheet."

That is the fact the whole feature rests on. The block's own origin is
the point that maps to the station in 3D, so no registration is needed:
block-local (0,0) IS the station.

## The frame is CsSectionCut's, reused

`CsSectionCut.frameForLeg(resolved, from, to)` returns {d, r, s} --
direction, right, up -- and `CsSectionCut.nearestLeg(resolved, point,
tolerance)` finds which leg a station's section belongs to.

REUSED, NOT RE-DERIVED, for the reason that module's own header gives:
it carries theta from leg to leg so sections do not spin as you move
along a passage, and it reports `reseeded: true` when a run opens on a
pitch and the perpendicular is genuinely arbitrary. A second frame
derivation here would be a second answer to a question already answered,
and the place it would first disagree is exactly the pitch.

## The block's geometry comes through CsArea.vertsOf

Reading a block's lines back out means discretising arcs and splines.
`CsArea.vertsOf` already does it, and already encodes THE SPLINE PROXY
TRAP: `getPointCloud()` on an RSpline delegates to a proxy plugin that a
`-no-gui -autostart` run never loads, so it measures EMPTY headlessly
while returning real points in the GUI. Its branch is fixed by the
shape's TYPE rather than by whether the first attempt came back empty,
precisely so the two environments agree.

Writing a second flattener here would have produced sections that looked
right in the GUI and vanished in the test suite. CsArea.vertsOf is
reused as-is, including its STEP.

## Where a section stands

The section is placed like the callout it already is in 2D: to one side,
with a leader home.

DIRECTION comes from the caver, not from us. SectionCapture marches the
block to a spot near its station and the caver can drag it, so the 2D
vector from station to block already says which side they chose.
Projected into the section's own frame, that picks the 3D side.

    side = normalise( proj_r(blockPos - stationPos) )   in the r/s plane

FALLBACK. Beyond a few passage widths from its station the direction is
meaningless -- a block parked in a bay, or laid out on a sheet -- and a
section flung across the cave on a bad bearing is worse than one on an
arbitrary but sane side. Past that distance, use +r.

DISTANCE is the passage half-width at that station plus a margin. The
half-width is the ring radius CsMesh3d already computes for the shell,
so the section clears the passage it belongs to rather than a guess at
its size.

## The mapping

A block-local point (u, v) becomes, in world space:

    station + side * offset + r * (u / scale) + s * (v / scale)

SCALE IS A DIVISION, and getting it inverted is the failure this design
most expects: SectionScale is drawing units per real unit, so a section
drawn at 2 units/ft is half the size of its numbers, not twice. Wrong
way round and every section is either microscopic or the size of the
cave. It gets a test with a known value rather than an eyeball.

## What is drawn

Three things, all into one new line buffer:

  the section     the block's traced geometry, mapped as above
  the leader      a line from the section's centre to the station
  nothing else    no frame rectangle, no ghost, no bay

Coloured distinctly from the passage and NOT by the active colour mode:
a section is annotation, not another way of reading the survey, and
colouring it by depth would say something false about it.

## Architecture

    Core/CsSection3d.js     PURE: the mapping, the side choice, the
                            leader. Plus a QCAD-context half, banner-
                            separated the way CsBind and CsScanTrim do
                            it, that reads the block references and
                            their geometry out of a document.

    RCave3dView             one more flat-line buffer and its visibility
                            flag. No new shader.

    RCave3dBridge           setMesh carries `sections`; setShowSections.

    RCave3dPanel            a "Sections" toggle on the overlay row.

The pure half takes block-local polylines, a frame, a station, a scale
and an offset, and returns world-space segments. That is the half worth
testing and it needs no document at all.

## Testing

Headless, pure:

  - a unit square at scale 1, offset 0, on an axis-aligned frame lands
    where hand-arithmetic says
  - scale 2 halves it; scale 0.5 doubles it -- the inversion test
  - the side choice follows a block placed left, and follows it right
  - a block absurdly far from its station falls back to +r rather than
    aiming at it
  - the leader runs from section centre to station, both ends finite
  - no NaN anywhere, on any input above

Live, in a restarted CaveCAD, on a drawing that HAS captured sections:

  - each section stands at its own station, the right size
  - it sits on the side the caver put it on in 2D
  - a section on a PITCH does not spin relative to its neighbours --
    the case a re-derived frame would get wrong and a carried one will
    not
  - the toggle hides and shows without a rebuild

## Out of scope

The textured scan version. Sections drawn in place slicing the passage
rather than offset. Picking or hovering a section. Section scans as
images -- that is the texture subsystem, and this deliberately does not
need it.

---

## As built (2026-09-12, 0.9.122.0 / cavecad-src 0.5.0.0)

Shipped as designed. Both reuse decisions held: CsArea.vertsOf returned
real points for every one of Truitt Cave's seven sections (465 to 2729
points each), and CsSectionCut's frame needed no help.

### The test drawing was there all along

The spec said Truitt had no captured sections and Task 5 would have to
make some. That was wrong, and wrong in an instructive way: the grep ran
against `~/Documents/Cave/teaching/Truitt Cave/Truitt Cave.dxf`, a stale
copy. The live working drawing is on Google Drive under
`Library/CloudStorage/GoogleDrive-.../Survey Group/Truitt Cave/`, and it
holds SEVEN sections with real scans.

The lesson is not about sections. It is that a cave folder under
~/Documents/Cave may be a stale copy of one that actually lives on the
shared drive, and a grep that answers "no" about a drawing is worth
checking against the file the application actually has open -- the
command line prints the path on load.

### The trip legend now survives a duplicated name

Found while looking at Truitt, where nine trips all read "TRUITT CAVE".
That turned out NOT to be a code defect: the Notebook's Survey field is
the trip name, and it had been filled with the cave name instead. The
data was wrong, not the label.

The behaviour was still worth hardening, and the hardening changes
nothing for correctly entered data -- a name that tells its trip apart
is used plainly, exactly as before. Only a SHARED name falls back, to
name + date; and because two trips can legitimately share both (Truitt
has two on 2024-04-06, Team A and Team B out together, as the scan
folders show), a shared name and date falls back further to a position
suffix. Two teams out on one day is not an edge case in cave survey; it
is a Saturday.

So this is a degraded-data path, not a correction. Drawings already
carrying the duplicated name still read clearly, and drawings filled in
correctly are untouched.

### THE AXIS SWAP, and why the test agreed with it

Sections came out rotated ninety degrees, and offset into the ceiling
rather than to one side. Both from one mistake.

`CsSectionCut.seedFrame` projects world UP onto the plane perpendicular
to the passage and calls that `r`. So `r` is UP and `s = d x r` is
ACROSS. Read as "r is right", block x maps to r and block y to s -- and
every section lies on its side while every offset climbs.

THE UNIT TEST PASSED THROUGHOUT, because it hand-wrote its frame as
`{r: east, s: up}` -- the same wrong assumption as the code. Two things
agreeing with each other and disagreeing with the drawing is not a test,
and no amount of assertions on a hand-made frame would have caught it.

The tests now DERIVE the frame from CsSectionCut.seedFrame and assert
its axes first, so the convention is checked against its owner rather
than restated. The pitch case builds its frame through
CsSectionCut.frameFor for the same reason. The axis note now sits at the
top of CsSection3d.js where it cannot be missed.

Caught by Nathan looking at the screen, which is the only place it was
visible.

### Verified live

On the real Truitt drawing: all seven sections read, placed and drawn --
8285 segments, no NaN. Every block sits 10 to 40 drawing units from its
station, well inside FAR_FACTOR, so the side choice came from the caver
in every case rather than from the fallback. Sections show edge-on in Plan, which is correct: a cross section stands
vertical. After the axis fix, frame.r measures (0, 0, 1.0) and frame.s
(0.94, 0.33, 0) on a real section at A2, with the offset horizontal to
nineteen decimal places.

NOT verified: a section on a genuine PITCH, which is the case
CsSectionCut's carried theta exists for. Truitt's seven sections are all
on near-horizontal passage. The frame is reused rather than re-derived
precisely so this cannot go wrong, but the live proof is still owed and
wants a cave with a sectioned drop.
