# Linework Warp — design

**Date:** 2026-08-28
**Branch:** v2
**Status:** Approved (options brainstormed, method chosen by Nathan)
**Amends:** `2026-08-20-linework-binding-design.md` (the "no rubber-sheet" call in
`CsRevise.moveLinework`'s doc comment and `CsRevise.LINEWORK_RESIDUAL_FRACTION`)

## Goal

Hand-traced linework (Feature Trace polylines, and anything else on a linework layer
carrying `LineworkStations`/`LineworkTrip`) should stay visually attached to the survey
it was traced against even when a revision or a least-squares re-adjustment moves its
bound stations non-rigidly — i.e. by different amounts, or with a local rotation a single
whole-entity transform cannot describe.

## Where this sits relative to the existing binding design

Nothing about *what* gets bound, or *how* it gets bound, changes. `CsBind`'s tagging
(exact-coincidence first, then bounding-box proximity, per `2026-08-20-linework-binding-
design.md`) is untouched, and both call sites that move linework are untouched:
`CsRevise.apply`'s non-rigid branch, and `SurveyNotebook.drawMergedSurvey`. The rigid path
(whole-drawing single transform) is also untouched — it already carries every entity along
correctly and this feature must never double-transform there.

What changes is the last step: today, `CsRevise.moveLinework` fits ONE whole-entity rigid
similarity transform over an entity's bound stations' old → new positions, and if the
residual is too large to trust that single transform, it leaves the entity alone and
reports it (`CsRevise.LINEWORK_RESIDUAL_FRACTION`, and the "we do not rubber-sheet" comment
at `CsRevise.js:914`). That refusal is the thing being walked back: a genuinely bent
passage is common under adjustment (a sub-loop can rotate a couple degrees relative to the
rest of the network), and a caver would rather see their tracing bend to match than have it
silently left behind with no visual cue beyond a text report.

## Chosen method: per-vertex Moving Least Squares (MLS) similarity deformation

At every vertex/control-point of a traced entity, compute a *locally weighted* best-fit
rotation + uniform scale + translation from that entity's bound control points (old → new
station positions), weighted by inverse-square distance from the vertex to each station's
OLD position. Apply that point's own local transform to itself. This is the standard
closed-form "warp a shape to follow moved control points" technique (the same family as
Schaefer/McPhail/Warren's MLS image deformation) — smooth between control points, exact
at them, and — the reason it beats plain displacement blending — it correctly represents a
local ROTATION, not just drift, because each vertex gets its own similarity solve rather
than an average of raw displacement vectors.

Two other approaches were considered and set aside:

- **Global affine fallback** (reuse `AlignImage.computeAffineFit` when the rigid fit's
  residual is too large): minimal change, but still one linear map per whole entity — a
  wall spanning two sub-regions that moved differently still can't follow both correctly,
  it would just get a larger residual before refusing.
- **Piecewise-linear triangulated rubber sheet** (Delaunay over all moved stations, map
  each vertex through its triangle's old → new affine): the "gold standard" GIS rubber-
  sheeting technique, exact and piecewise-linear, but needs a from-scratch Delaunay
  triangulation in pure JS (no libraries available in this engine), convex-hull
  extrapolation for vertices outside the triangulated area, and materially more surface to
  test. Worth revisiting only if MLS proves visually insufficient against real survey
  control density.

## New module: `Core/CsWarp.js`

Pure math, no document/GUI dependency, same shape as `Core/CsTrace.js` (plain `{x, y}` in
and out, testable under node and under the engine identically).

```
CsWarp.mlsSimilarity(point, controlPairs) -> { x, y, angle, factor }
```

- `controlPairs`: `[{old: {x, y}, nu: {x, y}}, ...]` — an entity's bound stations' old and
  new positions, exactly what `moveLinework` already assembles today for its rigid fit.
  `nu`, not `new`: matches `CsRevise.similarityFit`'s existing pair shape exactly (found
  during planning), not a fresh naming choice this doc needs to get right.
- Weight per control point: `1 / distance(point, old)^2`, with a small epsilon guard so a
  vertex that coincides with a station (the common case for snapped tracing) doesn't divide
  by zero — it takes that station's transform exactly, which is also the mathematically
  correct limit.
- Returns the warped point AND the local rotation/scale, because arc/circle handling (below)
  needs the local scale factor, not just the moved point.
- Degenerates correctly: one control point → pure translation by that station's delta (same
  as today's one-station case); two or more well-conditioned, near-rigidly-moving points →
  reproduces the same rotation/scale/translation the old whole-entity similarity fit would
  have produced, everywhere. This must hold to the old test tolerance — it is the common
  case and must not regress.

## `CsRevise.moveLinework` changes

Station-selection tiers are unchanged (own bound stations, else the entity's trip's
stations, else nothing to move against). What changes is what happens once a control-point
set is in hand:

- **0 control points:** unchanged — left alone, reported (still the only case with nothing
  to warp against).
- **1+ control points:** walk every vertex/control-point of the entity (see per-type
  handling below) and call `CsWarp.mlsSimilarity` per vertex.

  **Narrowed as built** — the code is right, this bullet was over-broad.
  `CsRevise.LINEWORK_RESIDUAL_FRACTION` and the whole-entity residual check are NOT removed
  outright; they are scoped down to the entity types with no per-vertex structure to warp:
  block references, text, and anything else the linework gate accepts that is not one of
  the five warpable types. For those, no single rigid move honestly describes what happened
  to their control points, so the "too large, refuse" branch is still the right answer and
  is kept. It is removed only for polyline, line, arc, circle and spline, which always have
  a locally sensible per-point answer and never refuse on residual. See the "SCOPE,
  NARROWED" comment above `CsRevise.LINEWORK_RESIDUAL_FRACTION` in `CsRevise.js`.

### Per-entity-type vertex handling

- **Polyline / spline:** warp every vertex or control point individually. This is the
  actual point of MLS — one entity can now bend along its length.
- **Line:** warp both endpoints (the 2-point case; the segment can still visibly bend if its
  two ends see different local control, unlike today's single rigid move).
- **Arc / circle:** warp the center point through `CsWarp.mlsSimilarity`, and scale the
  radius by the `factor` that call returns for that center — the local uniform-scale part of
  its per-point transform. Then rotate the entity about its **new** center by that call's
  `angle` — the local-rotation part. An arc's endpoints live in its start/end angles, which
  neither the center move nor the radius scale touches, so without this rotation an arc
  under a locally-rotating adjustment keeps its original absolute orientation and its
  endpoints detach from the walls they were snapped to. (No-op for a circle, which is
  rotationally symmetric.)
- **Bulge on a polyline arc segment:** left untouched, as today. Two vertices of one bulged
  segment can now move by slightly different local amounts (rotation and/or scale), so the
  arc between them (inferred purely from the bulge ratio) is a documented approximation, not
  an exact warp. This matches the existing bulge-preservation behavior of the current rigid
  path and is not expected to be visually significant at normal trace density.

## Reporting

Today's Draw/revision summary line distinguishes "moved" vs "unmoved, reported" linework.
That becomes three buckets:

- **Moved** — every vertex's local MLS transform agreed closely enough that the entity
  effectively got one rigid move (this subsumes today's "moved" case; also covers 1-2
  control points, where MLS mathematically reduces to a rigid transform).
- **Warped** — vertices disagreed enough that the entity visibly bent. New count, so a
  caver can tell at a glance how much local bending happened without inspecting geometry.
- **Unmoved, reported** — unchanged: zero control points, nothing to warp against.

## Testing

`Core/CsWarp.js` gets node-level unit tests in the same harness as `CsTrace`:

1. **Exact reproduction at control points** — a vertex placed exactly at a control point's
   old position warps to exactly that point's new position.
2. **Rigid-case regression** — 2-3 well-conditioned control points undergoing a uniform
   rotation + scale + translation must reproduce the same result the old whole-entity
   similarity fit produced, to the same tolerance, for every sampled vertex. This is the
   common case and must not regress.
3. **Genuinely non-rigid case** — a synthetic loop where one end rotates and the other
   translates; check MLS output at a few hand-computed sample vertices between the two
   regions to confirm it blends smoothly rather than picking one side.

`CsRevise.moveLinework`'s existing structural/headless tests (own-stations / trip-fallback /
neither cases) get updated for the new moved/warped/unmoved-reported three-way report, and a
new case: an entity bound to stations that moved non-rigidly (different rotation on each
end) must land in "warped", not "unmoved, reported", and its vertices must actually differ
from what a single whole-entity transform would have produced.
