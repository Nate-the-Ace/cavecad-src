# Cave 3D visualization modes -- design

Date: 2026-09-12
Status: approved
Version target: cavecad-tools 0.9.120.0, cavecad-src 0.4.0.0

## What this is

The 3D panel currently draws one picture: passage coloured by trip, with
a centerline. This gives it a set of ways to ask questions of the same
geometry -- colour by seven different properties, three overlays, and an
animation that builds the cave the way it was surveyed.

Everything here reads data the Core library already derives. No new
survey maths.

## Two independent axes

The panel's controls split in two, and the split is the design:

COLOUR MODE, exactly one at a time, from a dropdown:

    Trip                    six cycling swatches, one per trip
    Depth                   ramp over the cave's own z range
    Distance from entrance  ramp over traverse length from the anchor
    Passage size            ramp over each station's ring area
    Survey date             ramp over trips in chronological order
    Closure shift           CsClosure.bandFor bands -- discrete
    Splay coverage          three states: splays, LRUD only, nothing

OVERLAYS, independent toggles:

    Passage        the lofted shell            (exists)
    Centerline     station-to-station lines    (exists)
    Raw ghost      the pre-adjustment network, faint grey
    Leads          markers at CsFrontier.openEnds stations

LEADS IS AN OVERLAY, NOT A MODE, because "where is the cave still going"
is a question you ask WHILE looking at something else -- while coloured
by trip, to see who left it going; while coloured by depth, to see
whether the leads are up or down. A colour mode would make it the only
question you could ask at a time.

CLOSURE SHIFT IS A MODE, NOT AN OVERLAY, because it is a property every
station has, not a marked subset of them.

## Survey date, and why it is not a duplicate of Trip

Trip is identity: which party, which notebook. Date is progression: what
the cave looked like as it grew.

The ramp runs over trips sorted by date, and trips sharing a date are
ordered by SURVEY ORDER -- the order their shots appear in the survey,
which is the order they were walked. Two trips on the same Saturday are
therefore still distinguishable and still in the right sequence, which a
sort on date alone would leave arbitrary.

A survey whose trips carry no dates at all falls back to survey order
for all of them, which is still a meaningful progression.

## Passage size is clamped, and the legend says so

One big room makes every crawl the same colour at the bottom of a linear
ramp over min..max. The ramp therefore runs over the 5th to 95th
PERCENTILE of station ring area, and anything outside is pinned to the
end colours.

The legend labels those ends with the percentile values and marks them
as clamped. A scale that quietly discards its outliers while looking
linear is a lie about the data; one that says "5th-95th percentile" is a
choice the reader can see.

## The raw ghost

`CsAdjust.adjust` already returns `raw`, the pre-adjustment network, and
`CsDraw` already draws it grey and dashed on the CTRL-RAW layer. The 3D
ghost is the same data in its own line buffer -- its own buffer so that
toggling it needs no rebuild.

ITS RULE CARRIES OVER VERBATIM from CsDraw.js: NO RAW MEANS NO GHOST.
That is not a degenerate case -- it is adjustment switched off, or a
solve that did not converge, and in both the drawn geometry already IS
the as-surveyed geometry. A ghost lying exactly on top of it would be
noise. The toggle disables itself in that case and the status line says
which of the two reasons applies.

## Where the colour logic lives

`CsMesh3d.build` grows `opts.colorBy` from two values to seven and
returns a LEGEND DESCRIPTOR beside the buffers:

    legend: {
      title: "Depth",
      kind:  "ramp" | "swatches",
      note:  "5th-95th percentile" or "",
      stops: [{ color: [r,g,b], label: "1204 ft" }, ...]
    }

The view never computes a legend. It paints the one it is handed.

That keeps every unit that knows what a trip or a foot is inside the
pure, headless-tested Core module, and leaves the C++ side a renderer
that has never heard of caves -- the line this whole feature was built
along, and the reason the C++ needs no test of its own for any of the
seven modes.

A `colorBy` naming a mode that does not exist falls back to trip. An
unknown mode is a caller's bug, and a mesh that refuses to build would
take the panel down with it over a spelling.

## The legend paints in QPainter

After the GL pass in `paintGL`, a QPainter on the widget draws the
legend in the bottom-left corner over the dark ground: a gradient bar
with labelled ends and a midpoint for a ramp, a stack of swatch rows for
bands.

QOpenGLWidget IS A QPaintDevice, so this needs no GL text rendering at
all -- the objection that made an on-canvas legend look expensive does
not apply. The painter runs after the raw GL calls and Qt saves and
restores the GL state around it.

Light text on a fixed dark ground, so no light/dark theme handling.
Hidden when the mesh is empty.

## The build animation

One tick reveals ONE LEG -- one shot and the passage around it -- at a
fixed rate, in the order the network resolved them, which is the order
they were surveyed. A long shot takes the same time as a short one,
which is how it felt to survey it.

IT COSTS TWO INTEGERS PER FRAME. `CsMesh3d.build` already emits geometry
leg by leg, so it also returns a cumulative vertex count per leg:

    steps: [{ triangleVertices, lineVertices, station, trip }, ...]

Revealing the cave to step N is then clamping the count passed to
`glDrawArrays`. No rebuild, no per-frame geometry, nothing recomputed.

THIS REQUIRES ONE RESTRUCTURE. Today `build` walks the legs twice -- once
for the centerline over every leg, once for the shell over the "new"
legs only -- so the two buffers do not share an ordering. They become
one pass: each leg contributes its centerline segment and, when it is a
spanning-tree leg, its lofted shell, before the next leg contributes
anything. The step table indexes both. This is a better shape
independent of the animation.

Controls are a play/pause button and a scrub slider. The slider is not
just a progress bar: dragging it is how you ask "what did trip 2 add",
which is a different and more useful question than "watch it build".
Reaching the end, or stopping, leaves the whole cave showing -- the
animation is a way of looking at the cave, never a state the panel gets
stuck in.

## Panel layout

The toolbar becomes two rows, because a mode dropdown, four toggles, a
play button and a slider do not fit across a docked panel:

    row 1   Refresh | All  Plan  Profile | [colour mode dropdown]
    row 2   Passage  Centerline  Ghost  Leads | Play [-------slider-------]

## Persistence

Colour mode and the four overlay states are written to RSettings under
`Cave3D/` and read when the panel opens. A caver who works in depth
colour gets depth colour tomorrow.

Animation state is NOT persisted. It is a thing you do, not a way you
have the panel set up, and restoring a half-built cave on startup would
look like a bug.

## Testing

Headless, in CsMesh3d, against the Pitfall Cave fixture:

  - every mode emits finite colours, one per vertex, no NaN
  - every mode returns a legend with non-empty stops and unit-bearing
    labels
  - an unknown colorBy falls back to trip rather than throwing
  - date mode with a single trip does not divide by zero
  - date mode orders same-date trips by survey order
  - size mode with no LRUD anywhere does not divide by zero
  - size mode clamps to the 5th-95th percentile and says so in the note
  - the ghost buffer is empty when raw is null, populated when it is not
  - the step table is monotonic, its last entry equals the full vertex
    counts, and it has one entry per leg
  - leads markers appear exactly at CsFrontier.openEnds stations

Live, in a genuinely restarted CaveCAD:

  - each of the seven modes renders, with a legend that reads correctly
  - the ghost appears only with adjustment on, and the toggle explains
    itself when it cannot
  - play builds the cave and leaves it whole; the slider scrubs both
    directions
  - the mode survives a restart

## Out of scope

Per-station picking or hover readout, camera that follows the
animation, exporting a video, and any colour mode needing data the Core
library does not already derive.

---

## As built (2026-09-12, 0.9.120.0 / cavecad-src 0.4.0.0)

All seven modes, both overlays and the animation shipped as designed.
Three things diverged.

### The legend is a child widget, not a QPainter pass

The design said the legend would paint in QPainter inside paintGL, on
the grounds that QOpenGLWidget is a QPaintDevice and so needs no GL text
machinery. That reasoning is correct and the technique still does not
work here.

Tried in both orders -- painter constructed after the raw GL calls, and
painter constructed first with the GL wrapped in
beginNativePainting/endNativePainting -- it drew NOTHING. No warning, no
error, the painter reporting success. An unconditional magenta
diagnostic string confirmed the paint pass itself never lands, so it was
not the legend data failing to arrive.

RCave3dLegend is therefore a child widget floating over the view:
ordinary Qt painting no GL state can defeat, transparent to mouse events
so a drag that starts on it still turns the camera, and to the reader
the same thing -- a legend over the cave taking no layout space. The
reason is written into the class header so nobody re-attempts the
documented route believing it was never tried.

### An undated trip sorts LAST, not first

The spec said date mode sorts trips by date with same-date trips in
survey order. It did not say where a trip with no date at all goes.
Undated sorts after the dated ones: "undated" is not "earliest", and
putting it first would invent a history the survey does not record.

### The animation clamps to whole primitives

A vertex prefix that ends mid-triangle draws a torn one, so the count
passed to glDrawArrays is rounded down to a multiple of three for
triangles and two for lines.

## Verified live

Against Pitfall Cave in a restarted CaveCAD: all seven modes render with
correct legends -- Passage size carrying "5th-95th percentile", Closure
shift four bands, Splay coverage three states showing the cave as mostly
LRUD-only with a few splayed sections. The slider ranges 0..74, one step
per leg for 75 legs, and shell and centerline reveal in lockstep. All
four overlay gates verified: with every one off, nothing draws.

The ghost could not be verified against a drawing that HAS a raw
network, because the test fixture resolves without adjustment. Its two
paths are covered headlessly -- empty when raw is absent, populated and
NaN-free when present -- and the "no ghost" branch was seen live, with
the toggle greyed and the status line naming the reason.

## A trap this cost, worth keeping

Editing RCave3dView.cpp by slicing between two function names deleted
setTriangles and setLines along with the function being replaced,
because they sat between it and the next landmark. The link error named
them plainly; the lesson is that a slice between landmarks is only safe
when you have checked what lies between them.
