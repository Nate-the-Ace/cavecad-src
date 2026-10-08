# Linework Binding — design

**Date:** 2026-08-20
**Branch:** v2
**Status:** Approved (options brainstormed, three decisions taken by Nathan)

## Goal

Hand-drawn linework — traced walls, sketched detail, inserted symbol blocks — should
move with the survey it was traced against when a revision changes the survey's shape.

Today a RIGID revision already moves it, because the whole drawing transforms in one
operation. The gap is the NON-RIGID path: it erases and redraws tagged survey geometry
and leaves everything else where it was, so a per-trip declination fix on a multi-trip
drawing tears the traced walls off the passage they belong to.

## What makes this tractable

Two things already in the suite decide most of the design:

1. **CsDraw already draws the anchors tracing snaps to.** LRUD tips carry `LRUDName`
   and splay tips carry `SplayName`, and the comment at `CsDraw.js:451` says they exist
   so "wall tracing can snap to them". A wall traced by snapping has vertices that
   COINCIDE EXACTLY with tagged geometry — an exact binding signal, no proximity radius
   to tune.
2. **"This entity belongs to these stations" is an established tag shape.** Generated
   wall runs carry `WallRunStations="A1|A2|A3"` and `eraseStations` keys on it.

## Decisions taken

- **Capture: auto-tag while a session is armed.** A transaction listener tags what you
  draw with the notebook's current trip. Arming is explicit so tagging is never a
  surprise; the adopt action below is the fixup for anything mis-claimed.
- **Non-rigid movement: each entity follows its own stations' local fit.** A wall near a
  corrected shot moves; one far away barely does.
- **Retroactive: an adopt action, run on demand,** with a preview before it commits.

## Tag schema

On any linework entity, in the existing `CaveSurvey` property group:

| Tag | Value |
|-----|-------|
| `LineworkTrip` | integer trip id — the stable per-drawing key, NOT the `date\|team` fingerprint (a fingerprint string goes stale the moment a team's spelling or a date typo is corrected; the id does not — the same choice already made for legs) |
| `LineworkStations` | `"A3\|A4\|A5"` — the stations this entity was traced against. May be absent when nothing could be identified. |

## Binding: how the station set is chosen

In order, first hit wins:

1. **Exact coincidence.** For every vertex / endpoint / block insertion point, look for a
   tagged point at the same coordinate within a tight epsilon: station points (`Station`),
   LRUD tips (`LRUDName`, station = the part before the suffix), splay tips (`SplayName`,
   likewise). This is the snapped-tracing case and it is exact.
2. **Bounding-box proximity.** No coincidences: take stations whose position falls inside
   the entity's bounding box grown by a margin. For freehand strokes that snapped to
   nothing.
3. **Nothing found.** Keep `LineworkTrip` alone; the entity will follow its trip.

Blocks are the easy case: one insertion point, so step 1 or 2 is decisive rather than a
judgement about a long polyline.

## Movement on the non-rigid path

`CsRevise.apply` already resolves the survey twice — before and after — so both station
positions are in hand. For each entity carrying either linework tag:

1. Pairs from its listed stations' old → new positions.
2. `CsRevise.similarityFit(pairs)` (exists, tested). Residual within tolerance → apply
   the fit with the same rotate/scale/move idiom the rigid path uses.
3. One station only → translate by that station's delta.
4. No listed station still resolvable → fall back to a fit over all of `LineworkTrip`'s
   stations.
5. Neither available → leave it and REPORT it. Never guess silently.

Report gains `lineworkMoved` and `lineworkUnmoved` so `CsReport.revisionSummary` can say
what happened.

The rigid path is untouched: the whole drawing already moves, and running this step there
too would double-transform.

## The hazard that must not be got wrong

`CsDraw.eraseStations` deletes entities by tag, `WallRunStations` among them, so that a
redraw can replace generated wall runs. **It must never treat `LineworkStations` the same
way.** Generated wall runs are ours to replace; traced linework is the user's work and
deleting it is unrecoverable. The erase rules must ignore the linework tags explicitly,
with a comment saying why, and a test must pin it.

## World-fixed layers

`TB_*` (sheet furniture) and `CTRL-AERIAL` (ground-georeferenced imagery) are already
exempt from the rigid transform via `CsRevise.WORLD_FIXED_LAYERS`. The linework step
honors the same list, and the listener never tags entities on them — nor on any `CTRL-*`
layer, which is the suite's own geometry.

## Not in scope

Warping a single entity internally (rubber-sheeting a polyline whose stations moved
differently at each end). An entity moves as one rigid piece or is reported. Nathan
rejected rubber-sheeting at the revision framework's design time and nothing here
revisits that.
