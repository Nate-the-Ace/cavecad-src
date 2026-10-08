# Our own spline maths, and what detail level is worth paying for

Date: 2026-09-12
Status: built, measured, shipped; interval settled at half a foot

## Why

`CsTrace.fitSpline` builds an APPROXIMATING cubic: the sampled trace
points are used as CONTROL points, and a B-spline stays inside its
control polygon. So every bend a caver traces is pulled inward, and a
sharp corner rounds off. Nathan traces against scans and found the
result too smooth.

QCAD's own answer — fit-point splines, which pass through their points —
is a **Pro feature this fork does not have**, and reaching for it cost a
release: `appendFitPoint` left `getControlPoints()` empty, the bounding
box was 0 x 0, the DXF exporter wrote no SPLINE record at all so a trace
VANISHED on save, and `isValid()` still answered true, which is why
nothing caught it.

What is Pro is QCAD's interpolation ENGINE, not the spline entity.
Control-point splines render, save and round-trip perfectly well here.
So we compute the control points ourselves.

## What was built

`Core/CsTrace.js` gained global cubic B-spline interpolation:

- **centripetal parameterisation** (`centripetalParams`), not
  chord-length: the two differ where samples bunch at a corner, and
  chord-length answers that with an overshoot loop outside the traced
  line. Centripetal is the standard cure and costs one square root.
- **averaged knots** (`averagedKnots`) — an arbitrary knot vector makes
  the system singular; averaging is what keeps it solvable.
- **a banded solver** (`solveInterpolation`). A long wall at a quarter
  foot is thousands of points and a dense matrix would be millions of
  cells in a script engine. Each row has at most `p+1` non-zero entries,
  so only the band is stored and elimination reaches `p` rows down. No
  pivoting: the matrix from averaged knots is totally positive, which is
  exactly the property that makes pivoting unnecessary.
- `interpolationFit` returns control points, knots and parameters, and
  `evalCurve` evaluates the curve in pure JavaScript — because headless,
  `RSpline.getPointCloud()` returns nothing (no spline proxy plugin), so
  "does this curve pass through its points" cannot be asked of the
  entity. It is asked of the maths, and the entity is checked separately
  by a DXF round trip.

`CsTrace.emit` now interpolates, falling back to the approximating fit
when interpolation returns null (fewer than four points, a zero-length
path, a singular system). The fallback is not ceremony — a caver
mid-trace must still get their line.

**Closed loops too, as of 0.9.120.2.** A closed boundary cannot use the
banded solve: wrapping makes the system CYCLIC -- the first row reaches
the last column and the last row the first -- and band elimination has
nowhere to put those corners. Sherman-Morrison is the standard answer,
solving it as a tridiagonal system plus a rank-one correction.

Uniform parameterisation there, where the open fit uses centripetal, and
deliberately: a closed boundary arrives already RESAMPLED at a fixed
step, so its chords are equal and uniform is what the data is.

`AreaFillRun.closedBoundary` interpolates first and keeps the
approximating periodic fit as its fallback.

A note on testing it, because it cost an hour: the first seam assertion
failed at 179.7 degrees, which was not a corner at all. `getExploded`
returns its segments in no particular order, so concatenating their
samples jumps between opposite sides of the loop and fakes a reversal.
Ordering the samples by angle about the centre restores the curve's own
sequence. The maths was right and the measurement was wrong -- worth
remembering the next time a geometry assertion fails loudly.

## What it is worth — measured

Reference: a real traced wall from Truitt Cave — 95 stored points, 92 ft
long, with a 99-degree corner in it. Deviations are from the traced path,
in INCHES. DXF size is the measured cost of one spline record.

| Interval | Fit | Ctrl pts | DXF | Max | Mean | At the corner |
|---|---|---|---|---|---|---|
| 1.0 ft | approximating | 93 | 26.3 KB | 3.06 | 0.56 | **3.35** |
| 1.0 ft | interpolating | 93 | 26.3 KB | 2.24 | 0.23 | **0.31** |
| 0.5 ft | approximating | 185 | 32.9 KB | 1.51 | 0.16 | **1.74** |
| 0.5 ft | interpolating | 185 | 32.9 KB | 1.02 | 0.09 | **0.35** |
| 0.25 ft | approximating | 369 | 46.0 KB | 0.71 | 0.04 | **0.97** |
| 0.25 ft | interpolating | 369 | 46.0 KB | 0.44 | 0.03 | **0.36** |
| 0.1 ft | approximating | 920 | 85.4 KB | 0.30 | 0.01 | **0.47** |
| 0.1 ft | interpolating | 920 | 85.4 KB | 0.18 | 0.00 | **0.31** |

Read the corner column. The approximating fit's corner error scales with
the sampling interval — 3.35 inches at a foot, still 0.97 at a quarter
foot — because the curve is pulled inside the corner by a fraction of the
step. The interpolating fit is within about a third of an inch at EVERY
interval, because it passes through the corner by construction. That is
the entire complaint, closed.

The max and mean columns still improve with finer sampling for both fits.
That is a different quantity: it is how faithfully the SAMPLES follow the
path between them, not how faithfully the curve follows the samples.

**Interpolating at one foot beats approximating at a quarter foot on the
corner (0.31 vs 0.97 inches) with a quarter of the control points and
half the file size.**

## The recommendation

Interpolating fit, and the sampling interval backed off from the quarter
foot shipped in 0.9.119.0 to **half a foot**:

- better than today on every measured axis (max 1.02 against 0.71 is the
  one exception, and it is sampling fidelity rather than corner
  fidelity — the corner, which is what reads on a map, is three times
  better at 0.35 against 0.97)
- half the control points, so half the `CsWarp` per-vertex MLS cost,
  which is the cost actually felt when linework is adjusted
- 33 KB against 46 KB per long wall

A quarter foot interpolating remains available and is strictly better
again (max 0.44, corner 0.36) at twice the cost. Nothing below a quarter
foot is worth it: at 1"=50ft a quarter foot is 0.13 mm on paper, finer
than a pen line.

**Taken, 0.9.120.1.** `CsTrace.INTERVAL_FEET` is 0.5. The number moved
twice in one day and that is the honest record: raised 1.0 -> 0.25 while
the approximating fit made step size the only lever on a corner, then
settled at 0.5 once interpolation made the corner exact and the
measurement said something different.

## Tests

`tests/spline_fit_run.js`, registered as suite 37. The assertions are
chosen to be the ones that would have caught the vanished-on-save
failure:

- the curve passes through EVERY sampled point (to 1e-6)
- one control point per sample — no inflation
- the curve stays within a foot of the traced path everywhere, not only
  at the samples (the overshoot check)
- the approximating fit measurably misses its points — the gap being
  closed is real, not assumed
- degenerate input degrades to null rather than throwing or producing a
  NaN curve: no points, two points, a zero-length path, collinear points
- determinism
- a DXF round trip: exactly one SPLINE record survives, carrying every
  control point, with a real bounding box
- and for closed loops: the periodic fit solves, passes through every
  loop point as the ENGINE renders it (sampled through `getExploded`,
  since `getPointCloud` is empty for a spline headless), has no corner at
  the seam, and degrades to null on too few or coincident points

`isValid()` is never asserted. It answered true for the spline that
vanished.
