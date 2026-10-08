# Arbitrary cross sections — design

2026-08-29. Nathan: "since we have LRUDs for each station, can you draw a
cross section at any arbitrary location along the surveyed alignment?"
and "i want to have dynamic arbitary cross sections as a cool feature."

**Supersedes**, in `docs/superpowers/specs/2026-08-29-cross-section-design.md`:
its station-snapped-only rule ("a section is built at a station, not at
an arbitrary point along the passage"), and its open questions 1 and 2.
Everything else in that spec — the layer split, the modules, the refusal
to invent shape — stands and is assumed here.

**Placement is decided:** a section is a CALLOUT beside its cut point, on
a leader. The grid under the elevation is dropped (Nathan, same session).
See `2026-08-29-lrud-callout-research.md` for the callout machinery this
rides on.

## What is measured, and where the third dimension goes today

Nothing is missing from the survey. It is discarded in one known place.

- `CsTraverse.offset(shot, tapeMode)` already returns `{dx, dy, dz}` —
  full 3D, with tape mode handled (tangent for compass-and-tape, sine for
  slope). Every splay is therefore already a 3D wall hit.
- `resolved.stations[name]` carries `z`.
- `CsLrud.stationWallPoints` uses `dx`/`dy` and DROPS `dz`, because the
  plan view has no use for it. That single discard is why the suite looks
  like it has no 3D model.

So each station has, in the plane perpendicular to its passage azimuth:
four LRUD points (L and R at the station's z, U and D straight up and
down) plus every splay as a measured wall hit. That is a cross-section
polygon per station, built entirely from measurements. The passage
between two stations is the LOFT between two such polygons.

## The construction

### A leg is straight, and that simplifies everything

A survey leg is a straight line, so the tangent is CONSTANT along it. A
cut anywhere on leg A→B uses one plane normal — the leg's own direction
`d` — for every point on that leg. There is no twist to solve WITHIN a
leg.

Two consequences worth stating because they remove problems the general
lofting literature has:

- **No junction ambiguity for the cut itself.** A point P lies on one
  leg, and a leg has exactly two ends. The stations bounding P are simply
  that leg's own two. Junction ambiguity survives only in which azimuth a
  STATION's own polygon is built against, which `CsLrud.wallRuns` already
  answers (the azimuth of the leg that REACHED the station) and which
  this design does not change.
- **The frame problem is reduced to picking θ = 0**, not to tracking a
  moving frame along a curve.

### Picking θ = 0, and why a rotation-minimizing frame is still needed

For each leg, the section plane needs a reference direction `r` (θ = 0)
and `s = d × r` to complete the basis. The obvious choice is world up,
projected into the plane:

```
r = normalize(up - (up·d) d)
```

That degenerates on a PITCH: when the passage is near vertical, `up` lies
almost along `d`, the projection goes to zero, and θ = 0 becomes noise —
sections spin randomly from one leg to the next in exactly the passages
where a reader most needs them steady.

So the reference is CARRIED between legs by a rotation-minimizing frame,
using the double-reflection method (Wang et al., 2008), which is stable
where a Frenet frame flips at inflection points. From `(x_i, d_i, r_i)`
to the next leg:

```
v1  = x_{i+1} - x_i
c1  = v1 · v1
rL  = r_i - (2/c1)(v1 · r_i) v1      # reflect the reference
dL  = d_i - (2/c1)(v1 · d_i) v1      # reflect the tangent
v2  = d_{i+1} - dL
c2  = v2 · v2
r_{i+1} = rL - (2/c2)(v2 · rL) v2
s_{i+1} = d_{i+1} × r_{i+1}
```

**The rule:** seed `r` from projected world up on the first leg of a run
where that projection is well conditioned (|projection| above a
threshold, default 0.2 of unit length); carry it by double reflection
from leg to leg thereafter; re-seed from world up whenever the passage
returns to well-conditioned AND the carried frame has drifted more than a
set angle from the up-projected one, so a long cave does not accumulate
an arbitrary roll. Re-seeding is a visible discontinuity, so it is
reported, not silent.

### The station polygon, in the leg's frame

For station A on leg A→B with unit direction `d`, for each measured wall
point `p` (as an offset from the station, in 3D):

```
perp   = p - (p·d) d          # project onto the section plane
theta  = atan2(perp·s, perp·r)
radius = |perp|
```

Projecting along `d` is what makes an obliquely shot splay contribute its
PERPENDICULAR distance, which is what a section wants — at the cost of
discarding where along the passage it was shot. That is the correct trade
for this purpose and it is stated on the section, not hidden.

LRUD contributes four points: L at `-lrud.left` along the station's own
left, R likewise, U at `+up` vertical, D at `-down` vertical. Splays
contribute one point each, side-assigned exactly as
`CsLrud.stationWallPoints` already does it.

### The cut

For a cut at fraction `t` along leg A→B:

1. Build A's and B's polygons in the leg frame (above).
2. Resample BOTH at a common set of angles — default 32, evenly spaced.
   The radius at an angle is the distance from the centerline to the
   polygon BOUNDARY along that ray (ray/segment intersection), NOT the
   nearest vertex. Sampling vertices would make a four-point LRUD diamond
   read as a four-spoke star.
3. `r_P(θ) = (1-t)·r_A(θ) + t·r_B(θ)` for every sampled angle.
4. Emit the outline through those points, in angle order, as straight
   segments. No splines: the same refusal the rest of the suite makes.

That is the whole algorithm. It is cheap — a few dozen ray/segment
intersections per section — and it is the same thing Therion, Loch and
Survex already do to draw passage walls in 3D.

## Where it is dishonest, and what it does about it

**Concavity.** Radial resampling assumes the polygon is star-shaped about
the centerline: one radius per angle. LRUD diamonds always are.
Splay-rich sections usually are. A re-entrant — an undercut ledge — is
not, and radial sampling silently cuts the corner off it. DETECT it: if
any sampled ray crosses the boundary more than once, the section is
marked `re-entrant simplified` in its own report and in the callout's
tooltip. Not refused — simplified and SAID.

**Sparsity.** Four LRUD samples plus a handful of splays is thin angular
coverage, and the resample is where invention creeps in. A section built
from LRUD alone is a smoothed diamond and should not pretend otherwise:
the report states how many MEASURED points each end contributed.

**The honesty gradient.** A cut 1m from A is nearly a measurement; one
midway between stations 30m apart is a guess. Every generated section
carries `SectionNearest=<feet>` — the distance to the nearer bounding
station — and the callout states it. The reader calibrates themselves
rather than being told a section is a section.

**Degenerate ends.** Fewer than three wall points at either end cannot
form a boundary. The cut is refused with the reason named (which station,
how many points), never drawn from two points and a hope.

## What gets drawn

A cross-section callout: a leader from the cut point on the alignment to
a block holding the section, using the callout machinery in
`2026-08-29-lrud-callout-research.md` (probed: a block definition can be
regenerated and the placed instance follows).

| Layer | Contents |
|---|---|
| `CTRL-SECTION-OUTLINE` | the resampled outline |
| `CTRL-SECTION-SPLAYS` | the contributing splays, faint, so the evidence shows |
| `CTRL-SECTION-STATIONS` | the centerline mark and the scale ticks |
| `CTRL-SECTION-TEXT-LABELS` | the caption: cut point, scale, nearest-station distance |
| `CROSS-SECTION-MARKERS` | in the plan: the cut mark and its letter |

Sections draw at their OWN scale with the scale stated in the caption
(decided this session; open question 4 of the cross-section design).

`docs/superpowers/plans/2026-08-29-cross-section-layers.md` provides
every layer above and the `section` frame answer. It is a prerequisite.

## Regeneration

A section callout stores its PROVENANCE, exactly as `KIND_ELEV` does:
`SectionFrom`, `SectionTo`, `SectionFraction`, plus `SectionScale` and
`SectionAngles`. On every Draw, `CalloutWrite.refreshSections` re-derives
each one and redefines its block in place, so the section follows the
survey while staying where the caver put it.

The hand-edit rule needs its own answer, because a regenerated block
cannot be compared against "what it would have rendered" the way a text
label can. Rule: the block definition is the tool's, always regenerated;
the block REFERENCE (its position, scale and rotation) is the caver's and
is never touched. A caver who wants to edit the geometry explodes the
block, which drops the tags and takes the section out of regeneration —
a deliberate one-way door, reported the first time it is seen.

A cut whose leg has vanished from the survey is COUNTED as lost and left
alone, never silently deleted. Same rule as the elevation callouts.

## Modules

- `Core/CsSectionCut.js` — **new, pure, node-testable.** Plain `{x,y,z}`
  in and out: the leg frame, the double-reflection carry, the station
  polygon, the resample, the lerp, the concavity detection. No document,
  no QCAD symbol.
- `Core/CsSectionDraw.js` — the QCAD half: the block definition, the
  outline, splays, caption, erase-and-redefine.
- `Callout/CalloutWrite.js` — `KIND_SECTION`, the block content role, and
  `refreshSections`.
- `CrossSection/CrossSection.js` — the tool: pick a point on the
  alignment, pick where the block goes. Two clicks, like `CalloutElev`.
- `Core/CsLrud.js` — one addition: a 3D variant of
  `stationWallPoints` that keeps `dz` instead of discarding it. The
  existing 2D function keeps its exact behaviour; the plan view must not
  change.

## Tests

Node, in `tests/js_unit.js`, with numbers worked by hand:

- A straight east-running leg, both stations L=R=U=D=10: every sampled
  radius is 10 at any `t`, and the outline is a 32-gon inscribing the
  diamond's boundary — not four spokes.
- L=10 at A and L=20 at B: the radius at θ pointing left is exactly 15 at
  `t=0.5`, and 12 at `t=0.2`.
- A vertical leg (a pitch): θ=0 does NOT come from world up, the carried
  frame is used, and two consecutive pitch legs produce sections whose
  θ=0 differs by less than a stated tolerance — the anti-spin assertion.
- Double reflection against a hand-worked three-leg dogleg: the carried
  reference stays perpendicular to each leg and the roll between first
  and last matches the value computed by hand.
- A polygon with a re-entrant: `reentrant === true` in the result and the
  outline is the simplified one.
- A station with two wall points: the cut is refused, naming that station.
- A splay shot 45° forward of the passage lands at its PERPENDICULAR
  distance, not its slope distance.

Under CaveCAD, `tests/cross_section_run.js`: cut a section on a fixture
survey with splays, read the generated block back, redraw with a station
moved, assert the block was redefined and the reference did not move.

## Open questions

1. **Angular resolution.** 32 samples is a guess: fine for a printed
   section, and it makes a four-point LRUD diamond into a 32-vertex
   near-diamond, which is more vertices than there is evidence for. The
   alternative is to sample at the UNION of both polygons' own angles —
   truer to the data, ragged between very different ends. Recommendation:
   32, with the count settable.
2. **Does the outline close through the floor?** A passage with a
   measured D but no floor splays has one point below the centerline.
   Connecting it straight to L and R draws a V-shaped floor no one
   measured. Alternative: leave the floor open where evidence is that
   thin. Recommendation: draw it, and let the splay layer show how thin
   the evidence was.
3. **Re-seeding the frame.** The drift threshold that triggers a re-seed
   is a number nobody can pick from first principles. Recommendation:
   start at 15°, report every re-seed, tune on a real cave.
