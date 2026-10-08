# Loop Closure Adjustment — design

**Date:** 2026-08-21
**Branch:** v2
**Status:** Approved (all sections approved as presented)

Implements master goal **B4 (P1) Loop closure adjustment** from
`2026-08-19-cave-survey-suite-design.md`, and answers that spec's open question 3
("is proportional distribution enough, or is least-squares expected?") with
least squares.

## Goal

The suite has always *detected* misclosure and never *corrected* it.
`CsNetwork.resolve` walks a spanning tree, and when a shot arrives at a station
already placed it records the gap as a closure and moves on. Nothing ever moves a
station, so the drawing shows the whole accumulated error dumped onto whichever leg
happened to be resolved last, and the loop stays visibly open on the map.

After this, a drawn centerline is an adjusted network: the misclosure is distributed
over the legs according to how much each one is likely to be wrong, fixed and
georeferenced stations are held, and the correction is shown and reversible.

## Decisions taken

- **Least squares, not Bowditch.** One solver, one code path. Bowditch corrupts
  stations shared by two loops (corrected once per loop) and yields no per-leg
  residual.
- **A Core function returning a resolved-shaped object**, not a flag inside
  `CsNetwork.resolve` and not a standalone tool. Downstream consumers only ever see
  something shaped like a resolve result, so they need no changes.
- **On by default.** Compass, Walls, Survex and every published cave map show an
  adjusted centerline. Redrawing an existing drawing therefore shifts its stations
  once; the report says so plainly.
- **Isotropic instrument weighting**, `σ² = σ_tape² + (d·σ_angle)²`. Full
  anisotropic covariance was considered and rejected: it buys error ellipses nothing
  in the suite displays, at the cost of a solve nobody can check by hand.
- **Shown as a report plus an as-surveyed ghost layer**, off by default.

## Section 1: The math

Each non-splay, non-excluded leg *i* from station *a* to station *b* is one
observation per axis:

```
x_b − x_a = dx_i        y_b − y_a = dy_i        z_b − z_a = dz_i
```

where `Δ_i` is `CsTraverse.offset(shot, SLOPE)` — the existing slope-tape math,
unchanged. Weight is the inverse variance of the leg:

```
σ_i² = σ_tape² + (d_i · σ_angle · π/180)²
w_i  = 1 / σ_i²
```

Angular error scales with leg length, so a long leg absorbs more of the misclosure
than a short one. That is the physical behaviour pure length-proportional weighting
gets wrong, and the reason for preferring this model over Survex's default.

Minimize, over the free station coordinates, with fixed stations pinned:

```
Φ = Σ_i w_i · |(p_b − p_a) − Δ_i|²
```

Setting `∂Φ/∂p_k = 0` for each free station *k* gives the normal equations:

```
(Σ_{i∋k} w_i)·x_k  −  Σ_{i∋k} w_i·x_other(i)
    =  Σ_{i: k=to} w_i·dx_i  −  Σ_{i: k=from} w_i·dx_i
```

The left-hand side is the **weighted graph Laplacian** `L` of the survey network:
diagonal = sum of incident weights, off-diagonal = −w for each leg. The
right-hand side is the signed weighted sum of observed offsets at *k*.

**The three axes decouple.** With isotropic weights, `L` is identical for x, y and
z; only the right-hand side differs. Build `L` once, solve three right-hand sides.

Fixed stations (`survey.fixed`, `*fix` / `#Fix`, the explicit `opts.anchor`, and the
georeferenced station) are **Dirichlet boundary conditions**: their rows and columns
leave the system and their known coordinates fold into the right-hand side. `L` is
symmetric positive definite exactly when every connected component holds at least
one pinned station — the same condition `CsNetwork.resolve` already guarantees with
its anchor and per-component `seedFixed` logic. No new failure mode is introduced.

### Which shots participate

| Shot | In the network? | In the adjustment? |
|------|-----------------|--------------------|
| ordinary leg | yes | yes |
| `excludeFromPlot` (`P`) | yes | **yes** — a real measurement, merely not drawn |
| `excludeFromLength` (`L`) | yes | **yes** — a real measurement, merely not counted |
| `noAdjust` (`C`) | yes | held: see below |
| `excludeFromAll` (`X`) | no | no |
| splay | no | no |

`noAdjust` means "hold this shot's geometry exactly". It is implemented as a soft
constraint at `w = NO_ADJUST_WEIGHT_FACTOR × median(w)` with the factor `1e6`, which
keeps the matrix well conditioned and needs no constraint-elimination code path. The
flag exists in `CsModel` today with only a comment behind it; this is the first code
that reads it.

### Solving

**Jacobi-preconditioned conjugate gradient** on `L`, three right-hand sides.
Sparse adjacency built from `resolved.legs`; no dense matrix is ever allocated, so a
few thousand stations costs a few thousand doubles, not millions.

The initial guess is the raw `resolve()` coordinates, which are already within the
misclosure of the answer — so CG converges in a handful of iterations rather than
the hundreds a cold start would need.

- Tolerance: `CG_TOLERANCE_FRACTION = 1e-12` of the network extent, measured on
  the Jacobi-preconditioned residual `max|r/diag|` — the coordinate step each
  station's own equation still *wants*, which is a length. **Amended
  2026-08-21 (Task 2), with measurements.** The original `1e-9` was written as
  if the criterion bounded the error in the coordinates; it does not. The
  criterion is *local*, so what it leaves behind is that imbalance amplified by
  the network's conditioning. On a 4,000-station chain with 19 loops, against
  the same solve driven to `1e-16`: `1e-9` left **0.13 units** of coordinate
  error on a 40,000-unit network — the size of a tape reading, i.e. a solver
  artifact level with the precision of the data it is adjusting — while
  `1e-12` leaves `1.7e-5` for 15% more iterations (2544 vs 2210) and no
  measurable time (48ms vs 51ms).
- Two convergence criteria were tried and are wrong, both documented in
  `CsAdjust.solve`: *"the step just taken was small"* throws away the exact
  answer of an `n = 1` system (one free station between two fixed ones), which
  CG solves in one step whose size is the whole misclosure; and *"the initial
  residual is exactly zero"* never fires for the tree it exists to catch,
  because a tree's raw coordinates satisfy its observations only to rounding.
- Iteration cap: `10 × n` (three orders of magnitude above the counts measured
  above).
- **On non-convergence, return the unadjusted result with `converged: false` and a
  warning in the summary.** A half-solved network is worse than an unsolved one,
  because it looks adjusted. Never silently partially adjust.

### Vertical simplification, stated

Strictly, `σ_dz ≈ d·cos(v)·σ_v` and the tape contributes `sin(v)·σ_d`, so the
vertical variance differs from the horizontal. This design uses one scalar `σ_i` for
all three axes, which is what keeps the axes decoupled and the solve cheap. That
asymmetry is exactly what anisotropic covariance buys, and anisotropy is out of
scope. The simplification is documented in `CsAdjust.js`'s header comment so nobody
later reads it as an oversight.

## Section 2: `CsAdjust.adjust(survey, resolved, opts)`

`Core/CsAdjust.js`, a pure function like the rest of Core. Returns an object shaped
like a `CsNetwork.resolve` result, plus adjustment-specific fields:

| Field | Meaning |
|-------|---------|
| `stations` | **adjusted** coordinates; `seq` preserved from the input |
| `legs`, `unresolved`, `skipped` | copied from the input verbatim |
| `closures`, `loops`, `ties` | copied from the input verbatim — **as-surveyed** |
| `anchors`, `controlFrame` | copied from the input verbatim. The return shape is a *superset* of a resolve result, and both of these are read downstream: `CsDraw` consults `controlFrame.notHonored` before writing a station's `Fixed` tag, and `CsReport` prints the warning naming unused control. Dropping either silently reinstates a `Fixed` tag nobody pinned and deletes the warning that says so. |
| `adjusted` | `true` |
| `raw` | the input `resolved`, for the ghost layer and shift reporting |
| `shifts` | `{name: {dx, dy, dz, distance}}` per station |
| `residuals` | per leg, aligned to `legs`: `{dx, dy, dz, distance, standardized}` |
| `summary` | `{stationCount, movedCount, worstStation, worstShift, rmsShift, worstResidual, iterations, converged, sigmaTape, sigmaAngle, pinned}` — note `iterations` and `converged` live **here and only here**, not at the top level; `warning` joins them when a solve is handed back unadjusted |

`standardized` is `distance / σ_i` — the blunder statistic. It is computed and
returned but not surfaced anywhere yet; it is B5's raw material, wired in advance.

Because the return shape is a superset of a resolve result, `CsDraw.survey`,
`CsLrud.wallRuns`, `CsStats.compute`, `CsGrade.compute` and `CsRevise` consume it
without modification.

### The rule that must not be got wrong

**`closures` and `loops` pass through as-surveyed and are never recomputed from
adjusted coordinates.**

`CsGrade.compute` derives the BCRA centreline grade *from* `loops[].percent`, and
`CsStats.worstLoop` prints it on the title block. Adjusted closures are ~0 by
construction, so recomputing them would make every survey in the world report
"grade 5, worst closure 0.00%" — the suite's honesty rules inverted into a machine
for laundering bad data. The guarantee lives in the return shape rather than in
anyone's memory, and a test pins it.

## Section 3: Settings and persistence

Global settings, with `CsAdjust` constants for the keys:

| Setting | Default |
|---------|---------|
| `CaveSurvey/AdjustEnabled` | `true` |
| `CaveSurvey/SigmaTape` | `0.1` (drawing distance unit) |
| `CaveSurvey/SigmaAngle` | `1.5` degrees |

Defaults are hand-compass-and-tape class. DistoX-class work is roughly `σ_angle
0.3`, `σ_tape 0.01`; the settings exist so that is a change of two numbers rather
than a code change. No file format records instrument precision, so this cannot be
inferred — the same reason `CsGrade` refuses to grade instrument precision upward.

At draw time the values in force are written onto the trip-0 anchor station as
`Adjustment` (`lsq` or `none`), `SigmaTape` and `SigmaAngle`. Reopening a drawing and
redrawing therefore reproduces the same geometry, instead of silently re-solving
under whatever the global setting happens to be that day.

### Interaction with the revision framework

`CsRevise.apply` resolves the reconstructed survey twice, before and after the
revision, and compares the two with `similarityFit` to decide rigid versus redraw.
**Both sides must be adjusted with the same settings**, or the fit reads the
adjustment itself as part of the revision and misclassifies it.

The declination demonstration is unaffected: `loopsBefore` / `loopsAfter` report
as-surveyed closures, so `testdata/FingerprintCave.dat` still shows 4.21 ft → 0.74 ft
when the 1998 trips get their true −2.50 declination.

## Section 4: The as-surveyed ghost

New layer `CTRL-RAW` — grey, `DASHED`, `Weight000`, **off by default** — added to the
`CsLayers` registry and `DEFAULTS`, created by `ensureSurveyLayers`, and
hand-inserted into `templates/NSS_Cave_Template_PLAN.dxf` (the structural test pins
registry layers to the PLAN template; PROFILE is not required).

When `CsDraw.survey` receives a resolved object carrying `raw`, it draws the
unadjusted centerline there: leg lines tagged `RawShot="A1->A2"` and station points
tagged `RawStation=<name>`. Both get `eraseStations` kill rules, so a redraw replaces
the ghost rather than accumulating copies. Turning the layer on shows exactly what
moved and by how much, which is the "adjustment shown and reversible" requirement
satisfied visually as well as in prose.

Reversibility needs no undo machinery: the raw readings live in XDATA and were never
touched, so redrawing with adjustment off reproduces the as-surveyed drawing exactly.

### The hazard that must not be got wrong

**Ghost points must never enter `CsBind.stationIndex`.** Ghost stations sit within
the misclosure of the real ones, so a hand-traced wall that bound to one would be
moved by the next revision against a phantom with no survey meaning — and a ghost
carrying a real station's name would put two positions under one name in the index.

Two mechanisms, deliberately both. The tag names `RawShot` / `RawStation` are
distinct from the `Station` / `LRUDName` / `SplayName` tags `stationIndex` keys on
(`CsBind.js:641-647`), so ghosts are invisible to it by construction. On top of that,
`stationIndex` gets an explicit `CTRL-RAW` skip, because it queries every entity in
the document and one careless future tag would otherwise reintroduce the whole
problem silently. A test pins the exclusion.

## Section 5: Folded-in fixes

Two neighbours in the same code, both worth more once the network is being solved.

**Component ties are not loops.** A shot joining two separately anchored components
arrives with both ends known, so `resolve` calls it a closure; `describeLoop` finds
no common ancestor, falls back to `path = [from, to]`, and sets `traverseLength` to
that single shot's distance. The percentage is then meaningless and `CsValidate`
warns of a blunder that does not exist — the everyday case being a cave with two
`*fix`ed entrances. Such a leg becomes `kind: "tie"`, reported as a control tie
against fixed points rather than as a loop. It remains a real constraint in the
solve, and one that genuinely tests the fixed coordinates.

**Horizontal and vertical error reported alongside 3D.** Closures and loops gain
`horizontal` (`√(dx²+dy²)`) and `vertical` (`|dz|`) beside the existing 3D
`distance`. A plan map shows the horizontal error, surveyors quote it, and the
current single figure silently mixes a vertical bust into a number read as a plan
error. Purely additive; `percent` keeps its present 3D-over-slope-length definition
so existing reports and grade thresholds do not shift meaning.

## Section 6: Files, and how it is verified

New: `Core/CsAdjust.js`.

Touched: `Core/CsAll.js` (include), `Core/CsLayers.js` (`CTRL-RAW`),
`Core/CsDraw.js` (ghost, tags, erase rules), `Core/CsNetwork.js` (tie
classification, horizontal/vertical error), `Core/CsReport.js` (adjustment lines,
both error components), `Core/CsBind.js` (`CTRL-RAW` exclusion),
`Core/CsRevise.js` (adjust both comparison sides), and the resolve call sites in
`SurveyNotebook.js` (3), `ImportCaveSurvey.js`, `SurveyStats.js`,
`RebuildSurveyData.js`. Plus `templates/NSS_Cave_Template_PLAN.dxf` and
`tests/js_unit.js`.

Tests, all runnable under both node and `qcad -no-gui`:

1. **The hand-checkable square.** The existing fixture at `js_unit.js:468` — four
   ~equal legs, deliberate 0.5 misclosure. Equal weights, so each leg absorbs
   0.125. Verified against arithmetic, not against the solver's own output.
2. **Two fixed stations.** Error distributes between them instead of piling onto one
   end; both fixed stations land exactly on their given coordinates.
3. **A `noAdjust` leg holds** its surveyed geometry to tolerance while its
   neighbours absorb the error.
4. **A component tie is not a loop**: `kind === "tie"`, no `loop-misclosure`
   finding from `CsValidate`.
5. **Grade honesty**: `CsGrade.compute` fed an adjusted resolve returns the same
   grade and the same worst-closure percentage as it does from the raw resolve.
6. **A 200-station network with several loops converges** inside the iteration cap,
   and its post-adjustment closures are all near zero.
7. **Idempotence**: adjusting an already-adjusted survey moves nothing beyond
   tolerance.
8. **Ghost erase leaves zero orphans** — the same orphan count assertion that
   caught the `.L2` ledge-tip leak.
9. **Non-convergence path** returns `converged: false` with unadjusted coordinates,
   exercised by a network forced past a lowered iteration cap.

## Not in scope

- **Anisotropic per-leg covariance and error ellipses.** Rejected above with reasons.
- **Blunder hunting (B5).** `residuals[].standardized` is produced for it, but no
  detection, ranking or reporting of suspects is built here.
- **`excludeFromLength` in `CsStats`.** Real, adjacent in the same flag family, and
  unrelated to adjustment; it stays with its spawned task.
- **Surfacing per-leg residuals in the report.** Deliberately deferred with B5 so
  the report gains one new concept, not two.
- **Adjusting splays.** A splay has no second station and nothing to close against;
  it is drawn from its readings off its adjusted station, as it is today.
