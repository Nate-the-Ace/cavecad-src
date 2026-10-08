# Loop Closure Adjustment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Distribute loop misclosure over the whole survey network by least squares, holding fixed and georeferenced stations, shown as a report plus an as-surveyed ghost layer and reversible because the raw readings never move.

**Architecture:** A new pure Core module `CsAdjust.js` solves the weighted normal equations of the survey graph. With one scalar sigma per leg the three axes decouple into a single weighted graph Laplacian with three right-hand sides, solved matrix-free by Jacobi-preconditioned conjugate gradient seeded with the raw `CsNetwork.resolve` coordinates. `CsAdjust.adjust` returns an object shaped like a resolve result, so `CsDraw`, `CsLrud`, `CsStats`, `CsGrade` and `CsRevise` consume it unchanged.

**Tech Stack:** Pure ECMAScript (QCAD/CaveCAD script engine + node), no libraries. Tests in `tests/js_unit.js` (`ok`/`near` kit), structural tests in `tests/test_addon.py` (Python stdlib), runner `tests/run_all.sh`.

**User decisions (already made):**
- "Least squares only" — not Bowditch, not both.
- "Core function, resolved-shaped return" — not a flag inside `CsNetwork.resolve`, not a standalone tool.
- "On by default."
- "Instrument model, isotropic" weighting: `sigma^2 = sigmaTape^2 + (d*sigmaAngle)^2`.
- Folded into scope: disconnected-component false warning; horizontal error reported alongside 3D.
- Explicitly out of scope: per-leg residuals in the report, `excludeFromLength` in `CsStats`.
- "Report + as-surveyed ghost layer."
- **Added 2026-08-21, after Task 1 review:** when a survey carries two or more fixed
  stations AND a tool passes an explicit anchor, *offset the control into the anchor's
  frame* — compute the offset between the anchored station's own control coordinate and
  the anchor position, apply it to every other fixed station, then pin them. Falls back
  to today's behavior when the anchored station has no control of its own. Chosen over
  "explicit anchor wins outright" and "world control always wins".

**Spec:** `docs/superpowers/specs/2026-08-21-loop-closure-adjustment-design.md`

## Spec addenda discovered while planning

Two things the spec does not name, both required and both consistent with it:

1. **`CsNetwork.resolve` must export its anchors.** The solver needs to know which
   stations are pinned, and the resolve result currently keeps that in the private
   `parent` map (anchors are the entries with `null`). Without it a network with no
   `*fix` station has nothing pinned, the Laplacian is singular, and the whole cave
   floats. Task 1 adds `anchors: [names]` — purely additive.
2. **Field name:** the spec's `summary.totalCorrection` is implemented as
   `summary.rmsShift` (root-mean-square station shift). A sum of shift distances is
   not a meaningful quantity; RMS is. Task 1 patches the spec line so the two agree.

---

### Task 1: `CsNetwork` tells the truth about anchors, ties, and error components

**Goal:** `CsNetwork.resolve` exports the anchors the solver needs, reports horizontal and vertical error beside 3D, and stops calling a two-component tie a loop.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsNetwork.js` (`resolve`, `describeLoop`)
- Modify: `docs/superpowers/specs/2026-08-21-loop-closure-adjustment-design.md` (the `totalCorrection` row)
- Test: `tests/js_unit.js` (Network section, after the existing disconnected-components block near line 515)

**Acceptance Criteria:**
- [ ] `resolve()` returns `anchors`, an array of the station names placed with no parent, in placement order
- [ ] every `closures[i]` and `loops[i]` carries `horizontal` and `vertical` beside `distance` / `error`
- [ ] `percent` keeps its existing 3D-over-slope-length definition (existing assertions unchanged)
- [ ] a leg joining two separately-anchored components gets `kind: "tie"`, appears in `resolved.ties`, and does NOT appear in `loops`
- [ ] `CsValidate` raises no `loop-misclosure` finding for a tie
- [ ] the spec's summary table says `rmsShift`, not `totalCorrection`

**Verify:** `node tests/js_unit.js` → `### UNIT OK <n> assertions` with n above the current count

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `tests/js_unit.js` immediately after the existing disconnected-components block in the Network section:

```javascript
// ---- anchors, error components, component ties ----------------------
ok(rsq.anchors.length === 1 && rsq.anchors[0] === "A4",
    "resolve exports its anchor (A4, the first usable shot's FROM)");
if (rsq.loops.length === 1) {
    near(rsq.loops[0].horizontal, 0.5, 1e-9, "loop horizontal error");
    near(rsq.loops[0].vertical, 0, 1e-9, "loop vertical error");
    near(rsq.closures[0].horizontal, 0.5, 1e-9, "closure horizontal error");
    near(rsq.closures[0].vertical, 0, 1e-9, "closure vertical error");
}

// a vertical-only misclosure must land in `vertical`, not be smeared
// into a number a reader takes for a plan error
var vsq = CsModel.newSurvey();
vsq.shots.push(shotOf("V1", "V2", 10, 0, 0));
vsq.shots.push(shotOf("V2", "V3", 10, 90, 0));
vsq.shots.push(shotOf("V3", "V1", 10 * Math.sqrt(2), 225, 2));
var rv = CsNetwork.resolve(vsq, {});
ok(rv.loops.length === 1, "vertical-bust survey has one loop");
if (rv.loops.length === 1) {
    near(rv.loops[0].horizontal, 0, 1e-6, "vertical bust has no plan error");
    ok(rv.loops[0].vertical > 0.4, "vertical bust shows up as vertical error");
}

// two fixed components joined by one leg: a control tie, not a loop
var tie = CsModel.newSurvey();
tie.shots.push(shotOf("P1", "P2", 10, 0));
tie.shots.push(shotOf("Q1", "Q2", 10, 0));
tie.shots.push(shotOf("P2", "Q1", 10, 90));   // joins the two components
tie.fixed["P1"] = { x: 0, y: 0, z: 0 };
tie.fixed["Q1"] = { x: 10.4, y: 10, z: 0 };   // 0.4 off where P2->Q1 lands it
var rtie = CsNetwork.resolve(tie, {});
ok(rtie.loops.length === 0, "a component tie is not reported as a loop");
ok(rtie.ties.length === 1, "a component tie is reported as a tie");
if (rtie.ties.length === 1) {
    near(rtie.ties[0].error, 0.4, 1e-9, "tie misclosure against fixed control");
}
var tieLeg = null;
for (var tli = 0; tli < rtie.legs.length; tli++) {
    if (rtie.legs[tli].from === "P2" && rtie.legs[tli].to === "Q1") {
        tieLeg = rtie.legs[tli];
    }
}
ok(tieLeg !== null && tieLeg.kind === "tie", "the joining leg is kind 'tie'");
var tieFindings = CsValidate.check(tie, rtie);
var tieMisclosure = 0;
for (tli = 0; tli < tieFindings.length; tli++) {
    if (tieFindings[tli].code === "loop-misclosure") { tieMisclosure++; }
}
ok(tieMisclosure === 0, "a tie raises no loop-misclosure finding");
ok(rtie.anchors.length === 2, "each fixed component contributes an anchor");
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node tests/js_unit.js
```

Expected: `### UNIT FAIL` listing `resolve exports its anchor`, the four error-component assertions, and the tie assertions. `rtie.ties` is `undefined` so `rtie.ties.length` throws — if the run dies with a TypeError rather than printing failures, that is the same red, keep going.

- [ ] **Step 3: Export anchors**

In `CsNetwork.resolve`, the `place` helper already receives `from` (null for anchors). Collect them. Add near the other accumulators:

```javascript
    var anchors = [];
```

and inside `place`, after `parent[name] = from;`:

```javascript
        if (from === null || from === undefined) {
            anchors.push(name);
        }
```

- [ ] **Step 4: Add horizontal and vertical to the misclosure**

In the `haveFrom && haveTo` branch, where `mis.distance` is computed, add the two
components. Replace:

```javascript
                mis.distance = Math.sqrt(mis.dx * mis.dx + mis.dy * mis.dy +
                    mis.dz * mis.dz);
```

with:

```javascript
                mis.horizontal = Math.sqrt(mis.dx * mis.dx + mis.dy * mis.dy);
                mis.vertical = Math.abs(mis.dz);
                mis.distance = Math.sqrt(mis.horizontal * mis.horizontal +
                    mis.dz * mis.dz);
```

- [ ] **Step 5: Classify ties, and carry the components through `describeLoop`**

Still in that branch, replace the two lines that push the leg and the loop:

```javascript
                legs.push({ shot: shot, from: shot.from, to: shot.to,
                    kind: "closure" });
                loops.push(CsNetwork.describeLoop(shot, mis, parent, tapeMode));
```

with:

```javascript
                // A loop is a ring in ONE component: both ends trace
                // back to the same anchor. Two separately anchored
                // components joined by a leg is a control TIE -- a real
                // and useful check against the fixed coordinates, but
                // it has no ring, so a "percent of traverse length"
                // computed for it is meaningless and used to make
                // CsValidate cry blunder over a cave with two fixed
                // entrances.
                var described = CsNetwork.describeLoop(shot, mis, parent,
                    tapeMode);
                if (described.path.length === 2 &&
                        described.traverseLength === shot.distance) {
                    legs.push({ shot: shot, from: shot.from, to: shot.to,
                        kind: "tie" });
                    ties.push(described);
                } else {
                    legs.push({ shot: shot, from: shot.from, to: shot.to,
                        kind: "closure" });
                    loops.push(described);
                }
```

Declare `var ties = [];` with the other accumulators, and add both new fields to the
returned object:

```javascript
        loops: loops,
        ties: ties,
        anchors: anchors,
```

`describeLoop` already signals "no ring" exactly this way — `meet < 0` sets
`path = [shot.from, shot.to]` and leaves `traverseLength` at the closure shot's own
distance. The test above pins that a real 2-station ring (a there-and-back pair of
shots between the same two stations) is NOT mistaken for a tie, because such a ring
walks a parent chain and gets `traverseLength > shot.distance`.

- [ ] **Step 6: Give `describeLoop` the error components too**

At the end of `describeLoop`, in the returned object, add beside `error`:

```javascript
        error: misclosure.distance,
        horizontal: misclosure.horizontal,
        vertical: misclosure.vertical,
```

- [ ] **Step 7: Update the doc comment**

In the block comment above `CsNetwork.resolve`, extend the return description:

```javascript
 *   closures:   [{shot, atStation, dx, dy, dz, horizontal, vertical,
 *               distance}] misclosure of each closure leg: computed
 *               minus already-known
 *   loops:      [{from, to, path, traverseLength, error, horizontal,
 *               vertical, percent}] one per closure ring, path =
 *               station names around the loop
 *   ties:       the same shape, for legs that join two separately
 *               anchored components -- control ties, not rings, so
 *               they carry no meaningful percent
 *   anchors:    [name] stations placed with no parent, in placement
 *               order: the explicit anchor, the #Fix / *fix seeds, or
 *               the first usable shot's FROM. CsAdjust pins these.
```

and in the `kind` line of the `legs` description, replace `kind "new" | "closure"`
with `kind "new" | "closure" | "tie"`.

- [ ] **Step 8: Run the tests to verify they pass**

```bash
node tests/js_unit.js
```

Expected: `### UNIT OK <n> assertions`, n increased by 14.

- [ ] **Step 9: Fix the spec's field name**

In `docs/superpowers/specs/2026-08-21-loop-closure-adjustment-design.md`, in the
`summary` row of the Section 2 table, replace `totalCorrection` with `rmsShift`.

- [ ] **Step 10: Commit**

```bash
git add scripts/CaveSurvey/Core/CsNetwork.js tests/js_unit.js docs/superpowers/specs/2026-08-21-loop-closure-adjustment-design.md
git commit -m "feat: resolve exports anchors, splits error components, and calls a tie a tie"
```

---

### Task 1b: fixed control follows the anchor's frame

**Goal:** When a survey has two or more fixed stations and the caller passes an explicit
anchor, the other fixed stations are pinned at their control coordinates *translated into
the anchor's frame*, so real control disagreement surfaces as a tie instead of being
silently discarded — and no station is ever tagged with a coordinate that contradicts
where it is drawn.

Found by the Task 1 spec review, which proved the discard empirically: with
`{anchor: {name: "P1", ...}}` a second fixed station `Q1` was placed at (10,10,0) by
traversal while its control said (10.4,10,0), `anchors` omitted it, and no closure, tie
or finding recorded the disagreement. `ImportCaveSurvey.js:131`,
`SurveyNotebook.js:722` and `:1366`, and `CsRevise.js:1665-1666` all pass an anchor, so
this is the common path, not the exotic one.

**Why not simply pin every fixed station.** `opts.anchor` pins a station at a DRAWING
position; `survey.fixed` pins one at a WORLD coordinate. Pin both unconditionally and
the offset between two coordinate frames becomes a large fake misclosure on the tying
leg. The pre-existing comment about fixed stations "fighting" an explicit anchor was
load-bearing, not naive.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsNetwork.js` (`resolve`: frame-aware `seedFixed`)
- Modify: `scripts/CaveSurvey/Core/CsDraw.js` (never write a `Fixed` tag that contradicts
  the drawn position)
- Modify: `scripts/CaveSurvey/Core/CsReport.js` (say when control was offset, and by how
  much)
- Test: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] with an explicit anchor whose station is ITSELF fixed, every other fixed station is
      pinned at `control + (anchorPos − anchoredStationControl)`
- [ ] the resulting tie misclosure equals the one the same survey reports with no anchor
      at all — the frame shift must not change the measured disagreement
- [ ] with an explicit anchor whose station has NO control of its own, behavior is
      unchanged from today (nothing to compute an offset from), and the report says which
      fixed stations were not honored and why
- [ ] a survey with 0 or 1 fixed stations is byte-identical to today on every path
- [ ] `CsDraw` never writes `Fixed=<coords>` on a station drawn somewhere else; where the
      control was offset, the tag records the offset control, matching the drawn position
- [ ] the offset applied is reported once, in drawing units

**Verify:** `./tests/run_all.sh` → `ALL TESTS PASSED`

**Steps:** TDD as elsewhere — write the failing assertions first, from the acceptance
criteria above, using the reviewer's `P1/P2/Q1/Q2` two-component fixture plus a
same-component variant. The frame offset is a pure translation, so the tie misclosure is
invariant under it; that invariance is the assertion that proves the implementation right
rather than merely green.

---

### Task 1c: the bridge classifier must not be quadratic, and must not fabricate a path

**Goal:** Fix the two blocking findings from the Task 1 code-quality review, plus two
smaller honesty fixes it surfaced.

The review measured the bridge classifier under Node/V8 with a chain-plus-closures
survey:

```
n=500  shots=510  time=32ms
n=1000 shots=1020 time=96ms
n=2000 shots=2040 time=366ms
n=4000 shots=4080 time=1501ms
```

Quadratic, and that is the *fast* engine. QCAD's script engine is older and non-JIT, so
the ~100ms perceptible threshold arrives well under 1,000 shots, and `resolve()` runs on
every redraw. Real cave projects reach 5,000-20,000 shots.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsNetwork.js`
- Test: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] the bridge test runs only for shots that actually resolve as closures, not for
      every usable shot — cost becomes O(k·m) with k = closure count
- [ ] a 4,000-shot survey with a handful of loops resolves in well under 100ms under
      node, measured and asserted as a loose upper bound so the quadratic cannot return
      unnoticed
- [ ] the classifier's verdicts are unchanged on all existing fixtures (square, tie,
      there-and-back, two-fixed ring, ring+branch) — this is a performance change, not a
      behavior change, and the existing assertions prove it
- [ ] the two-root circuit no longer implies an adjacency that does not exist: `path`'s
      join semantics are documented, and a consumer can tell where the circuit closes
      through control rather than through a surveyed leg (a `viaControl` flag on the
      loop record, or an equivalent the implementer judges cleaner)
- [ ] `.path` contents are asserted for both the single-root and two-root cases — that
      branch is currently untested
- [ ] ties carry `percent: null`, matching the docstring's "no meaningful percent"; no
      consumer formats it (check `CsReport`, `CsValidate`, `CsStats`, `CsRevise`)
- [ ] a shot with `from === to` is SKIPPED, not scored as a 100%-blown loop
- [ ] a direct double tie between two already-fixed anchors is tested

**Verify:** `./tests/run_all.sh` → `ALL TESTS PASSED`

**Why restriction rather than Tarjan.** A single-pass Tarjan low-link bridge finder is
O(n+m) and asymptotically better, but it must track edge IDs rather than parent vertices
to avoid mistaking a parallel leg for a back edge — and parallel legs (duplicate shots
between one pair of stations) are ordinary in real survey data. The union-find test is
already verified correct against four topologies; restricting it to closure candidates
removes the quadratic without trading a verified classifier for an unverified one. k is
the number of independent loops, and cave surveys are overwhelmingly tree-like: passages
branch, closed loops are comparatively rare. Revisit only if a real survey shows k large
enough to matter.

**The self-loop case, with care.** `from === to` shots are not necessarily garbage: the
Compass writer in this suite emits zero-length carrier shots to hang leaf-station LRUD
on, and the parser folds them back. Any that reach the network should be skipped, which
is what the `usable` filter is for. They must never be scored — a self-loop currently
resolves as `kind: "loop"`, `percent: 100`, which fires the blunder warning for data
that is not a blunder.

**Known and deliberately NOT fixed here.** For a branched network, the parent chain back
to a root is whatever the spanning tree happened to pick, so `percent`'s denominator can
be a resolver artifact rather than the physical arc. This is pre-existing — the
single-root case has always had it — and fixing it means choosing a canonical loop path,
which is a design question, not a cleanup. Recorded so it is not mistaken for new.

---

### Task 1d: a real survey fixture with two fixed stations

**Goal:** Close the coverage gap a real-data regression check surfaced — none of
`testdata/`'s five cave files carries two or more fixed stations, so bridge-based tie
classification, control-tie splitting and the two-root circuit have only ever run against
synthetic fixtures built inside `tests/js_unit.js`.

Measured state of the real data, for the record: FingerprintCave (17 stations, 1 loop, 0
fixed), FingerprintCave_Revised (same), TestCave_Compass (6 stations, 1 loop, 0 fixed),
TestCave_Walls (6 stations, 1 loop, **1** fixed `W1`), TestCave_Survex (5 stations, 1
loop, **1** fixed `TestSurvey.S1`). Maximum fixed-station count anywhere: one.

**Files:**
- Create: a survey file under `testdata/` with two `*fix` / `#Fix` stations on one
  connected passage plus a second, separately fixed component
- Test: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] the file is real, parseable survey data in one of the suite's supported formats,
      not a synthetic in-memory fixture — it must go through the format registry
- [ ] it exercises BOTH shapes at once: two fixed stations on one ring (which must report
      per-arc loops, not ties) and a genuinely disconnected fixed component joined by one
      leg (which must report a tie)
- [ ] the expected loop count, per-arc traverse lengths, tie count and tie misclosure are
      hand-computed in a comment and asserted against, not read off the implementation
- [ ] resolving it with an explicit anchor on one fixed station reports a `controlFrame`
      whose offset is applied, and the misclosures are invariant against the no-anchor
      resolve — the same invariance Task 1b established, now on real parsed data
- [ ] the fixture is small enough to read and verify by hand (single figures of stations)

**Verify:** `./tests/run_all.sh` → `ALL TESTS PASSED`

Low priority relative to the solver chain: it adds confidence in work already shipped
rather than unblocking anything. Run it when `tests/js_unit.js` is free.

---

### Task 2: `CsAdjust.js` — the solver

**Goal:** A pure Core module that takes a survey and its raw resolve result and returns a resolved-shaped object with adjusted coordinates, per-station shifts, per-leg residuals, and a summary.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsAdjust.js`
- Modify: `scripts/CaveSurvey/Core/CsAll.js` (include, after `CsNetwork.js`)
- Modify: `tests/js_unit.js` (`CORE_FILES`, after `CsNetwork.js`; new test section after Task 1's block)

**Acceptance Criteria:**
- [ ] the hand-computed square with equal weights puts `+0.125` on every one of the four loop legs and `0` on the branch leg
- [ ] the pinned anchor does not move; `y` and `z` do not move when the misclosure is purely in `x`
- [ ] a loopless (tree) survey is returned unchanged, in zero iterations
- [ ] two fixed stations both land exactly on their given coordinates
- [ ] a `noAdjust` leg keeps its surveyed geometry while its neighbours absorb the error
- [ ] `closures` and `loops` come back identical to the input's — as-surveyed
- [ ] `CsGrade.compute` fed the adjusted result returns the same grade and worst-closure percent as from the raw result
- [ ] adjusting an already-adjusted survey moves nothing (idempotence)
- [ ] a network forced past a lowered iteration cap returns `converged: false` with raw coordinates and `raw: null`

**Verify:** `node tests/js_unit.js` → `### UNIT OK <n> assertions`

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `tests/js_unit.js` after Task 1's block:

```javascript
// ---------------------------------------------------------------------
// Adjust -- least-squares loop closure. The square fixture again, with
// equal weights (sigmaAngle 0, sigmaTape 1) so the arithmetic is doable
// by hand: four legs share one 0.5 misclosure, so every leg's residual
// is 0.5/4 = 0.125 and the stations walk out in 0.125 steps.
// ---------------------------------------------------------------------

var EQ = { sigmaTape: 1, sigmaAngle: 0 };
var asq = CsAdjust.adjust(sq, rsq, EQ);

ok(asq.summary.converged === true, "square adjustment converges");
ok(asq.adjusted === true, "adjust marks its result adjusted");
near(asq.shifts["A4"].distance, 0, 1e-9, "the pinned anchor A4 does not move");
near(asq.shifts["A1"].dx, 0.125, 1e-9, "A1 shifts one quarter of the misclosure");
near(asq.shifts["A2"].dx, 0.25, 1e-9, "A2 shifts two quarters");
near(asq.shifts["A3"].dx, 0.375, 1e-9, "A3 shifts three quarters");
near(asq.shifts["B1"].dx, 0.375, 1e-9, "the branch rides along with A3");
near(asq.shifts["A2"].dy, 0, 1e-9, "no y misclosure, no y shift");
near(asq.shifts["A2"].dz, 0, 1e-9, "no z misclosure, no z shift");

var resByPair = {};
for (var ri = 0; ri < asq.residuals.length; ri++) {
    var rr = asq.residuals[ri];
    resByPair[rr.from + ">" + rr.to] = rr;
}
near(resByPair["A4>A1"].dx, 0.125, 1e-9, "leg A4-A1 absorbs 0.125");
near(resByPair["A1>A2"].dx, 0.125, 1e-9, "leg A1-A2 absorbs 0.125");
near(resByPair["A2>A3"].dx, 0.125, 1e-9, "leg A2-A3 absorbs 0.125");
near(resByPair["A3>A4"].dx, 0.125, 1e-9, "closure leg A3-A4 absorbs 0.125");
near(resByPair["A3>B1"].distance, 0, 1e-9, "the branch leg absorbs nothing");
near(resByPair["A4>A1"].standardized, 0.125, 1e-9,
    "standardized residual is the residual over sigma (sigma = 1 here)");

// HONESTY: closures and loops pass through as-surveyed. CsGrade reads
// loops[].percent, so recomputing them post-adjustment would report
// every survey on earth as grade 5.
ok(asq.loops.length === rsq.loops.length, "adjust keeps the loop list");
near(asq.loops[0].error, 0.5, 1e-9, "adjust reports the AS-SURVEYED misclosure");
var gradeRaw = CsGrade.compute(sq, rsq, CsStats.compute(sq, rsq, CsTraverse.SLOPE));
var gradeAdj = CsGrade.compute(sq, asq, CsStats.compute(sq, asq, CsTraverse.SLOPE));
ok(gradeRaw.centreline === gradeAdj.centreline,
    "adjustment cannot launder the centreline grade");
ok(gradeRaw.centrelineText === gradeAdj.centrelineText,
    "adjustment cannot launder the grade's stated reasoning");

// a tree has nothing to close: the raw coordinates are already the
// exact least-squares answer
var tree = CsModel.newSurvey();
tree.shots.push(shotOf("T1", "T2", 10, 0));
tree.shots.push(shotOf("T2", "T3", 10, 90, 5));
tree.shots.push(shotOf("T2", "T4", 7, 200, -12));
var rtree = CsNetwork.resolve(tree, {});
var atree = CsAdjust.adjust(tree, rtree, EQ);
ok(atree.summary.converged === true, "tree adjustment converges");
ok(atree.summary.iterations === 0, "a tree needs no iterations");
near(atree.summary.worstShift, 0, 1e-9, "a tree does not move");

// idempotence: adjusting the adjusted result is a no-op
var asq2 = CsAdjust.adjust(sq, asq, EQ);
near(asq2.summary.worstShift, 0, 1e-6, "adjusting an adjusted survey moves nothing");

// two fixed stations: both must land exactly on their control
var twofix = CsModel.newSurvey();
twofix.shots.push(shotOf("F1", "M1", 10, 90));
twofix.shots.push(shotOf("M1", "F2", 10, 90));
twofix.fixed["F1"] = { x: 0, y: 0, z: 0 };
twofix.fixed["F2"] = { x: 20.6, y: 0, z: 0 };   // 0.6 further than surveyed
var rtwo = CsNetwork.resolve(twofix, {});
var atwo = CsAdjust.adjust(twofix, rtwo, EQ);
near(atwo.stations["F1"].x, 0, 1e-9, "fixed F1 stays on its control");
near(atwo.stations["F2"].x, 20.6, 1e-9, "fixed F2 stays on its control");
near(atwo.stations["M1"].x, 10.3, 1e-9, "the middle station splits the difference");

// noAdjust holds its leg's geometry; the neighbour absorbs the error
var held = CsModel.newSurvey();
var heldLeg = shotOf("H1", "H2", 10, 90);
heldLeg.noAdjust = true;
held.shots.push(heldLeg);
held.shots.push(shotOf("H2", "H3", 10, 90));
held.fixed["H1"] = { x: 0, y: 0, z: 0 };
held.fixed["H3"] = { x: 20.6, y: 0, z: 0 };
var rheld = CsNetwork.resolve(held, {});
var aheld = CsAdjust.adjust(held, rheld, EQ);
near(aheld.stations["H2"].x - aheld.stations["H1"].x, 10, 1e-4,
    "a noAdjust leg keeps its surveyed length");

// non-convergence returns the survey UNADJUSTED, and says so
var stuck = CsAdjust.adjust(sq, rsq, { sigmaTape: 1, sigmaAngle: 0,
    maxIterations: 1, cgTolerance: 1e-30 });
ok(stuck.summary.converged === false, "a starved solve reports non-convergence");
ok(stuck.adjusted === false, "a starved solve does not claim to be adjusted");
ok(stuck.raw === null, "a starved solve offers no ghost -- its geometry IS the raw");
near(stuck.stations["A3"].x, rsq.stations["A3"].x, 1e-12,
    "a starved solve leaves coordinates exactly as surveyed");
```

- [ ] **Step 2: Register the new file in both loaders**

In `tests/js_unit.js`, add to `CORE_FILES` immediately after the `CsNetwork.js` line:

```javascript
    "scripts/CaveSurvey/Core/CsAdjust.js",
```

In `scripts/CaveSurvey/Core/CsAll.js`, add immediately after the `CsNetwork.js` include:

```javascript
include(includeBasePath + "/CsAdjust.js");
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
node tests/js_unit.js
```

Expected: the run dies reading `scripts/CaveSurvey/Core/CsAdjust.js` — `ENOENT`. That is the red.

- [ ] **Step 4: Write `CsAdjust.js`**

Create `scripts/CaveSurvey/Core/CsAdjust.js`:

```javascript
// Adjust.js -- least-squares loop closure adjustment.
//
// Part of the Cave Survey Core library: pure functions.
//
// CsNetwork.resolve walks a spanning tree, so all of a loop's
// accumulated error lands on whichever leg happened to close it. This
// distributes it over every leg instead, weighted by how wrong each leg
// is likely to be, holding the fixed and anchored stations.
//
// THE MATH. Each leg a->b is one observation per axis:
//
//     x_b - x_a = dx        (and the same for y and z)
//
// weighted w = 1/sigma^2 with
//
//     sigma^2 = sigmaTape^2 + (distance * sigmaAngle * pi/180)^2
//
// so angular error grows with leg length: long legs absorb more of the
// misclosure than short ones, which is the behaviour pure
// length-proportional weighting gets wrong.
//
// Minimizing the weighted sum of squared residuals and setting the
// derivative to zero at each free station k gives
//
//     (sum_i w_i) x_k  -  sum_i w_i x_other(i)
//         =  sum_{i: k is TO} w_i dx_i  -  sum_{i: k is FROM} w_i dx_i
//
// whose left-hand side is the WEIGHTED GRAPH LAPLACIAN of the survey
// network. With one scalar sigma per leg the three axes decouple: the
// same matrix solves x, y and z with three different right-hand sides.
// Fixed and anchored stations are Dirichlet boundary conditions -- out
// of the system, into the right-hand side.
//
// The matrix is never built. Jacobi-preconditioned conjugate gradient
// only needs L*v, which is a loop over the legs. Seeded with the raw
// resolve() coordinates -- already within the misclosure of the answer
// -- it converges in a handful of iterations, and a survey with no
// loops converges in zero.
//
// VERTICAL SIMPLIFICATION, deliberate. Strictly sigma_dz is
// distance*cos(inclination)*sigmaClino, and the tape contributes
// sin(inclination)*sigmaTape, so vertical variance is not horizontal
// variance. One scalar sigma per leg is what keeps the axes decoupled,
// and anisotropic per-leg covariance is out of scope by decision (see
// the design spec). This is a documented simplification, not an
// oversight.
//
// HONESTY RULE, load-bearing: the returned closures, loops and ties are
// the AS-SURVEYED ones, copied from the input, NEVER recomputed from
// adjusted coordinates. CsGrade derives the BCRA centreline grade from
// loops[].percent and CsStats prints it on the title block. Adjusted
// closures are ~0 by construction, so recomputing them would report
// every survey on earth as "grade 5, worst closure 0.00%" -- the
// suite's honesty rules inverted into a machine for laundering bad
// data. The guarantee lives in this return shape, not in anyone's
// memory, and a unit test pins it.

var CsAdjust = {};

CsAdjust.SETTING_ENABLED = "CaveSurvey/AdjustEnabled";
CsAdjust.SETTING_SIGMA_TAPE = "CaveSurvey/SigmaTape";
CsAdjust.SETTING_SIGMA_ANGLE = "CaveSurvey/SigmaAngle";

// Hand compass and tape, the suite's stated audience. DistoX-class work
// is roughly 0.3 degrees and 0.01 -- two numbers in the settings, not a
// code change. No file format records instrument precision, which is
// why this cannot be inferred from the data (the same reason CsGrade
// refuses to grade precision upward).
CsAdjust.DEFAULT_SIGMA_TAPE = 0.1;
CsAdjust.DEFAULT_SIGMA_ANGLE = 1.5;

// A noAdjust leg is held by weight rather than by eliminating it from
// the system: no constraint-elimination code path, and the matrix stays
// conditioned.
CsAdjust.NO_ADJUST_WEIGHT_FACTOR = 1e6;

// Convergence is measured as the largest coordinate STEP, so the
// tolerance is a length: this fraction of the network's extent.
CsAdjust.CG_TOLERANCE_FRACTION = 1e-9;

CsAdjust.MIN_VARIANCE = 1e-12;
CsAdjust.DEG = Math.PI / 180.0;

/** The variance of one leg, never zero (weights are its reciprocal). */
CsAdjust.legVariance = function(shot, sigmaTape, sigmaAngle) {
    var angular = shot.distance * sigmaAngle * CsAdjust.DEG;
    var v = sigmaTape * sigmaTape + angular * angular;
    return v < CsAdjust.MIN_VARIANCE ? CsAdjust.MIN_VARIANCE : v;
};

CsAdjust.median = function(values) {
    if (values.length === 0) {
        return 1.0;
    }
    var s = values.slice().sort(function(a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    return (s.length % 2 === 1) ? s[mid] : (s[mid - 1] + s[mid]) / 2.0;
};

/** Bounding-box diagonal of a stations map, for scaling tolerances. */
CsAdjust.extentOf = function(stations) {
    var minX = null, maxX = null, minY = null, maxY = null,
        minZ = null, maxZ = null;
    for (var name in stations) {
        if (!stations.hasOwnProperty(name)) {
            continue;
        }
        var p = stations[name];
        if (minX === null || p.x < minX) { minX = p.x; }
        if (maxX === null || p.x > maxX) { maxX = p.x; }
        if (minY === null || p.y < minY) { minY = p.y; }
        if (maxY === null || p.y > maxY) { maxY = p.y; }
        if (minZ === null || p.z < minZ) { minZ = p.z; }
        if (maxZ === null || p.z > maxZ) { maxZ = p.z; }
    }
    if (minX === null) {
        return 0.0;
    }
    var dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

/**
 * Jacobi-preconditioned conjugate gradient on the Laplacian, applied
 * matrix-free.
 *
 * \param n     number of free stations
 * \param diag  diagonal of L, one entry per free station
 * \param edges [{a, b, w}] free-to-free legs (indices into 0..n-1)
 * \param rhs   right-hand side for this axis
 * \param x0    starting guess (the raw coordinates)
 * \param tol   convergence threshold on the largest coordinate step
 * \return {x, iterations, converged}
 */
CsAdjust.solve = function(n, diag, edges, rhs, x0, tol, maxIter) {
    if (n === 0) {
        return { x: [], iterations: 0, converged: true };
    }
    var applyL = function(v) {
        var out = new Array(n);
        var k;
        for (k = 0; k < n; k++) {
            out[k] = diag[k] * v[k];
        }
        for (var e = 0; e < edges.length; e++) {
            var ed = edges[e];
            out[ed.a] -= ed.w * v[ed.b];
            out[ed.b] -= ed.w * v[ed.a];
        }
        return out;
    };

    var x = x0.slice();
    var Ax = applyL(x);
    var r = new Array(n), z = new Array(n), p = new Array(n);
    var rz = 0.0;
    var k;
    for (k = 0; k < n; k++) {
        r[k] = rhs[k] - Ax[k];
        z[k] = r[k] / diag[k];
        p[k] = z[k];
        rz += r[k] * z[k];
    }

    // Already solved -- a survey with no loops starts AT the answer,
    // because a tree's observations are exactly satisfiable.
    var converged = !(rz > 0);
    var iterations = 0;

    while (iterations < maxIter && !converged) {
        var Ap = applyL(p);
        var pAp = 0.0;
        for (k = 0; k < n; k++) {
            pAp += p[k] * Ap[k];
        }
        if (!(pAp > 0)) {
            break; // not positive definite (or exhausted): report failure
        }
        var alpha = rz / pAp;
        var maxStep = 0.0;
        for (k = 0; k < n; k++) {
            var step = alpha * p[k];
            x[k] += step;
            if (Math.abs(step) > maxStep) {
                maxStep = Math.abs(step);
            }
            r[k] -= alpha * Ap[k];
        }
        iterations++;
        if (maxStep <= tol) {
            converged = true;
            break;
        }
        var rzNew = 0.0;
        for (k = 0; k < n; k++) {
            z[k] = r[k] / diag[k];
            rzNew += r[k] * z[k];
        }
        if (!(rz > 0)) {
            break;
        }
        var beta = rzNew / rz;
        rz = rzNew;
        for (k = 0; k < n; k++) {
            p[k] = z[k] + beta * p[k];
        }
    }

    return { x: x, iterations: iterations, converged: converged };
};

/**
 * The pass-through result: this survey, unadjusted, in the shape the
 * adjusted one has. Used when the solver fails to converge and by
 * callers that have adjustment switched off, so every consumer sees
 * one shape.
 *
 * `raw` is null on purpose: there is no ghost to draw when the drawn
 * geometry IS the as-surveyed geometry.
 */
CsAdjust.unadjusted = function(resolved, summaryExtra) {
    var shifts = {};
    for (var name in resolved.stations) {
        if (resolved.stations.hasOwnProperty(name)) {
            shifts[name] = { dx: 0.0, dy: 0.0, dz: 0.0, distance: 0.0 };
        }
    }
    var summary = {
        stationCount: 0,
        movedCount: 0,
        worstStation: "",
        worstShift: 0.0,
        rmsShift: 0.0,
        worstResidual: null,
        iterations: 0,
        converged: true,
        sigmaTape: 0.0,
        sigmaAngle: 0.0,
        pinned: []
    };
    for (var key in (summaryExtra || {})) {
        if (summaryExtra.hasOwnProperty(key)) {
            summary[key] = summaryExtra[key];
        }
    }
    for (name in shifts) {
        if (shifts.hasOwnProperty(name)) {
            summary.stationCount++;
        }
    }
    return {
        stations: resolved.stations,
        legs: resolved.legs,
        closures: resolved.closures,
        loops: resolved.loops,
        ties: resolved.ties || [],
        anchors: resolved.anchors || [],
        unresolved: resolved.unresolved,
        skipped: resolved.skipped,
        adjusted: false,
        raw: null,
        shifts: shifts,
        residuals: [],
        summary: summary
    };
};

/**
 * \param survey   the CsModel survey
 * \param resolved a CsNetwork.resolve() result (or another adjust()
 *                 result -- adjusting an adjusted survey is a no-op)
 * \param opts {
 *   sigmaTape, sigmaAngle  instrument sigmas (defaults above),
 *   tapeMode               CsTraverse mode (default slope),
 *   pinned                 [name] extra stations to hold, e.g. the
 *                          georeferenced one,
 *   maxIterations, cgTolerance  overrides, for tests
 * }
 *
 * \return {
 *   stations   ADJUSTED coordinates, seq preserved
 *   legs, unresolved, skipped        copied from the input
 *   closures, loops, ties            copied -- AS-SURVEYED, see the
 *                                    honesty rule at the top
 *   adjusted   true when the solve converged
 *   raw        the input resolved (what the CTRL-RAW ghost draws), or
 *              null when nothing was adjusted
 *   shifts     {name: {dx, dy, dz, distance}}
 *   residuals  per leg, aligned to legs: {shot, from, to, dx, dy, dz,
 *              distance, standardized}
 *   summary    {stationCount, movedCount, worstStation, worstShift,
 *              rmsShift, worstResidual, iterations, converged,
 *              sigmaTape, sigmaAngle, pinned}
 * }
 */
CsAdjust.adjust = function(survey, resolved, opts) {
    opts = opts || {};
    var sigmaTape = (opts.sigmaTape === undefined || opts.sigmaTape === null) ?
        CsAdjust.DEFAULT_SIGMA_TAPE : opts.sigmaTape;
    var sigmaAngle = (opts.sigmaAngle === undefined || opts.sigmaAngle === null) ?
        CsAdjust.DEFAULT_SIGMA_ANGLE : opts.sigmaAngle;
    var tapeMode = opts.tapeMode || CsTraverse.SLOPE;
    var stationsIn = resolved.stations;
    var legs = resolved.legs || [];
    var i, k, name;

    // ---- pinned stations -----------------------------------------
    // resolve()'s anchors are one per connected component, which is
    // exactly what makes the Laplacian non-singular. Fixed stations are
    // pinned on top of that even when resolve DERIVED them rather than
    // seeding from them: a second fixed entrance is control, and the
    // adjustment should close onto it.
    var pinned = {};
    var addPin = function(n2) {
        if (n2 !== undefined && n2 !== null && n2 !== "" &&
                stationsIn.hasOwnProperty(n2)) {
            pinned[n2] = true;
        }
    };
    var anchors = resolved.anchors || [];
    for (i = 0; i < anchors.length; i++) {
        addPin(anchors[i]);
    }
    for (name in survey.fixed) {
        if (survey.fixed.hasOwnProperty(name)) {
            addPin(name);
        }
    }
    if (opts.pinned !== undefined && opts.pinned !== null) {
        for (i = 0; i < opts.pinned.length; i++) {
            addPin(opts.pinned[i]);
        }
    }
    // Nothing pinned means nothing anchors the network and the whole
    // cave floats. Hold the first-resolved station rather than failing:
    // the drawing's origin is the least surprising thing to keep still.
    var pinnedCount = 0;
    for (name in pinned) {
        if (pinned.hasOwnProperty(name)) {
            pinnedCount++;
        }
    }
    if (pinnedCount === 0) {
        var lowest = null;
        for (name in stationsIn) {
            if (stationsIn.hasOwnProperty(name) &&
                    (lowest === null ||
                     stationsIn[name].seq < stationsIn[lowest].seq)) {
                lowest = name;
            }
        }
        if (lowest !== null) {
            pinned[lowest] = true;
        }
    }

    // ---- index the free stations ---------------------------------
    var freeNames = [];
    var index = {};
    for (name in stationsIn) {
        if (!stationsIn.hasOwnProperty(name) || pinned[name] === true) {
            continue;
        }
        index[name] = freeNames.length;
        freeNames.push(name);
    }
    var n = freeNames.length;

    // ---- weights -------------------------------------------------
    var weights = [];
    for (i = 0; i < legs.length; i++) {
        weights.push(1.0 / CsAdjust.legVariance(legs[i].shot, sigmaTape,
            sigmaAngle));
    }
    var med = CsAdjust.median(weights);
    for (i = 0; i < legs.length; i++) {
        if (legs[i].shot.noAdjust === true) {
            weights[i] = med * CsAdjust.NO_ADJUST_WEIGHT_FACTOR;
        }
    }

    // ---- assemble the Laplacian and the three right-hand sides ----
    var diag = [], bx = [], by = [], bz = [];
    for (k = 0; k < n; k++) {
        diag.push(0.0); bx.push(0.0); by.push(0.0); bz.push(0.0);
    }
    var edges = [];
    for (i = 0; i < legs.length; i++) {
        var leg = legs[i];
        if (leg.from === leg.to) {
            continue; // degenerate: constrains nothing
        }
        if (!stationsIn.hasOwnProperty(leg.from) ||
                !stationsIn.hasOwnProperty(leg.to)) {
            continue;
        }
        var w = weights[i];
        var o = CsTraverse.offset(leg.shot, tapeMode);
        var ka = index.hasOwnProperty(leg.from) ? index[leg.from] : -1;
        var kb = index.hasOwnProperty(leg.to) ? index[leg.to] : -1;
        if (ka < 0 && kb < 0) {
            continue; // both ends held: nothing to solve for
        }
        if (ka >= 0) {
            diag[ka] += w;
            bx[ka] -= w * o.dx; by[ka] -= w * o.dy; bz[ka] -= w * o.dz;
            if (kb < 0) {
                var pb = stationsIn[leg.to];
                bx[ka] += w * pb.x; by[ka] += w * pb.y; bz[ka] += w * pb.z;
            }
        }
        if (kb >= 0) {
            diag[kb] += w;
            bx[kb] += w * o.dx; by[kb] += w * o.dy; bz[kb] += w * o.dz;
            if (ka < 0) {
                var pa = stationsIn[leg.from];
                bx[kb] += w * pa.x; by[kb] += w * pa.y; bz[kb] += w * pa.z;
            }
        }
        if (ka >= 0 && kb >= 0) {
            edges.push({ a: ka, b: kb, w: w });
        }
    }
    // A free station touched by no leg has an empty row: hold it where
    // it is rather than dividing by a zero diagonal.
    for (k = 0; k < n; k++) {
        if (diag[k] === 0.0) {
            var p0 = stationsIn[freeNames[k]];
            diag[k] = 1.0; bx[k] = p0.x; by[k] = p0.y; bz[k] = p0.z;
        }
    }

    // ---- solve ---------------------------------------------------
    var extent = CsAdjust.extentOf(stationsIn);
    var tol = (opts.cgTolerance === undefined || opts.cgTolerance === null) ?
        CsAdjust.CG_TOLERANCE_FRACTION * Math.max(extent, 1.0) :
        opts.cgTolerance;
    var maxIter = (opts.maxIterations === undefined ||
        opts.maxIterations === null) ? Math.max(10 * n, 50) :
        opts.maxIterations;

    var x0 = [], y0 = [], z0 = [];
    for (k = 0; k < n; k++) {
        var p = stationsIn[freeNames[k]];
        x0.push(p.x); y0.push(p.y); z0.push(p.z);
    }
    var sx = CsAdjust.solve(n, diag, edges, bx, x0, tol, maxIter);
    var sy = CsAdjust.solve(n, diag, edges, by, y0, tol, maxIter);
    var sz = CsAdjust.solve(n, diag, edges, bz, z0, tol, maxIter);
    var iterations = Math.max(sx.iterations, sy.iterations, sz.iterations);

    // A half-solved network is worse than an unsolved one, because it
    // LOOKS adjusted. Hand back the survey as measured and say why.
    if (!(sx.converged && sy.converged && sz.converged)) {
        return CsAdjust.unadjusted(resolved, {
            converged: false,
            iterations: iterations,
            sigmaTape: sigmaTape,
            sigmaAngle: sigmaAngle,
            warning: "the adjustment did not converge -- coordinates are " +
                "as surveyed, with the misclosure still on the closing leg"
        });
    }

    // ---- adjusted coordinates and per-station shifts --------------
    var stations = {};
    var shifts = {};
    var moveEps = 1e-9 * Math.max(extent, 1.0);
    var movedCount = 0, worstShift = 0.0, worstStation = "";
    var sumSq = 0.0, stationCount = 0;
    for (name in stationsIn) {
        if (!stationsIn.hasOwnProperty(name)) {
            continue;
        }
        var raw = stationsIn[name];
        var nx = raw.x, ny = raw.y, nz = raw.z;
        if (index.hasOwnProperty(name)) {
            k = index[name];
            nx = sx.x[k]; ny = sy.x[k]; nz = sz.x[k];
        }
        stations[name] = { x: nx, y: ny, z: nz, seq: raw.seq };
        var ddx = nx - raw.x, ddy = ny - raw.y, ddz = nz - raw.z;
        var dist = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
        shifts[name] = { dx: ddx, dy: ddy, dz: ddz, distance: dist };
        stationCount++;
        sumSq += dist * dist;
        if (dist > moveEps) {
            movedCount++;
        }
        if (dist > worstShift) {
            worstShift = dist;
            worstStation = name;
        }
    }

    // ---- per-leg residuals ---------------------------------------
    // Produced for B5 blunder hunting: `standardized` is the residual
    // in units of its own sigma, which is the statistic that ranks
    // suspects. Nothing surfaces it yet, by decision.
    var residuals = [];
    var worstResidual = null;
    for (i = 0; i < legs.length; i++) {
        var lg = legs[i];
        var pa2 = stations[lg.from], pb2 = stations[lg.to];
        if (pa2 === undefined || pb2 === undefined) {
            continue;
        }
        var of = CsTraverse.offset(lg.shot, tapeMode);
        var rx = (pb2.x - pa2.x) - of.dx;
        var ry = (pb2.y - pa2.y) - of.dy;
        var rz2 = (pb2.z - pa2.z) - of.dz;
        var rd = Math.sqrt(rx * rx + ry * ry + rz2 * rz2);
        var sg = Math.sqrt(CsAdjust.legVariance(lg.shot, sigmaTape,
            sigmaAngle));
        var res = { shot: lg.shot, from: lg.from, to: lg.to,
            dx: rx, dy: ry, dz: rz2, distance: rd,
            standardized: sg > 0 ? rd / sg : 0.0 };
        residuals.push(res);
        if (worstResidual === null ||
                res.standardized > worstResidual.standardized) {
            worstResidual = res;
        }
    }

    var pinnedNames = [];
    for (name in pinned) {
        if (pinned.hasOwnProperty(name)) {
            pinnedNames.push(name);
        }
    }

    return {
        stations: stations,
        legs: legs,
        closures: resolved.closures,
        loops: resolved.loops,
        ties: resolved.ties || [],
        anchors: anchors,
        unresolved: resolved.unresolved,
        skipped: resolved.skipped,
        adjusted: true,
        raw: (resolved.raw !== undefined && resolved.raw !== null) ?
            resolved.raw : resolved,
        shifts: shifts,
        residuals: residuals,
        summary: {
            stationCount: stationCount,
            movedCount: movedCount,
            worstStation: worstStation,
            worstShift: worstShift,
            rmsShift: stationCount > 0 ?
                Math.sqrt(sumSq / stationCount) : 0.0,
            worstResidual: worstResidual,
            iterations: iterations,
            converged: true,
            sigmaTape: sigmaTape,
            sigmaAngle: sigmaAngle,
            pinned: pinnedNames
        }
    };
};
```

Note the `raw` field: re-adjusting an already-adjusted result keeps the ORIGINAL raw
result rather than making the previous adjustment the ghost. The ghost must always
show the as-surveyed centerline.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
node tests/js_unit.js
```

Expected: `### UNIT OK <n> assertions`, n increased by 28.

- [ ] **Step 6: Run the whole suite, both engines**

```bash
./tests/run_all.sh
```

Expected: `ALL TESTS PASSED (publish checks not run; use --publish)`. The structural
test walks `CsAll.js`'s include list, so a missing include shows up here rather than
in the unit run.

- [ ] **Step 7: Commit**

```bash
git add scripts/CaveSurvey/Core/CsAdjust.js scripts/CaveSurvey/Core/CsAll.js tests/js_unit.js
git commit -m "feat: least-squares loop closure adjustment in CsAdjust"
```

**AS BUILT (2026-08-21, commit `1e4b4bf`).** Four departures from the source
drafted above, each forced by evidence. Later tasks should work from these, not
from the draft:

1. **The pin set excludes `resolved.controlFrame.notHonored`.** Task 1b landed
   after this task was written: when an explicit anchor is passed and a fixed
   station's control cannot be reconciled into the anchor's frame, resolve
   leaves that station to ordinary traversal. Its resolved position is a
   traversal artifact, not control, and pinning it would freeze a coordinate
   nobody measured. Pinned = `anchors` + `survey.fixed` keys not in
   `notHonored` + `opts.pinned` (an explicit `opts.pinned` still wins: it is
   the caller's instruction, not a made-up number). Anchors need no
   `notHonored` test — the two sets provably cannot overlap; see the comment in
   the code.

2. **Convergence is measured on `max|r/diag|`, the Jacobi-preconditioned
   residual** — the coordinate step still *wanted* — against `tol`. The
   drafted `solve` was wrong in both directions and both drafted assertions
   caught it: an `n = 1` system (one free station between two fixed ones) is
   solved EXACTLY by CG's first step, whose size is the whole misclosure, so
   the two-fixed-station and `noAdjust` fixtures were reported non-convergent
   and thrown away (`M1` came back at the as-surveyed 10 instead of 10.3); and
   `!(rz > 0)` never fires for a tree, because a tree's raw coordinates satisfy
   its own observations only to rounding (~1e-16), so the loopless survey took
   a pointless iteration. The `if (!(rz > 0)) break` guard before `beta` is
   gone with it: the loop is only entered when `max|z| > tol`, so `rz > 0`
   there by construction.

3. **`controlFrame` is copied into both return shapes** (`adjust` and
   `unadjusted`). `CsDraw.js:430` reads it to decide whether a station's
   `Fixed` tag can honestly be written and `CsReport.js:67` reads it to warn
   about unused control, so the drafted shape — which dropped it — would have
   silently reinstated a `Fixed` tag nobody pinned and deleted the warning
   saying so, the moment Task 7 wired the call sites through
   `resolveAndAdjust`. Demonstrated: `CsReport.drawSummary` lost its warning
   line under test.

4. **`CG_TOLERANCE_FRACTION` is `1e-12`, not `1e-9`** — the spec's number was
   written on the assumption that this local criterion bounds the coordinate
   error. Measurements are in the spec's Solving section and in the constant's
   own comment.

Also settled while building: `converged` and `iterations` live in `summary`,
never at the top level (the drafted assertions above read them at the top level
and have been corrected in place); the returned `stations` map is always newly
built, so `raw` really is the as-surveyed geometry the ghost needs; and the
node-only cost check asserts a 3,000-station, 14-loop network adjusts in well
under 500ms (measured ~35ms, 2038 iterations) so the solve cannot go quadratic
inside a redraw unnoticed.

---

### Task 3: Settings, and the tags that make a redraw reproducible

**Goal:** `CsAdjust.currentOptions()` reads the sigmas and the on/off switch from settings; the values in force get written onto the trip-0 anchor so reopening and redrawing reproduces the same geometry.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsAdjust.js` (add `currentOptions`, `optionsFromTags`, `resolveAndAdjust`)
- Test: `tests/js_unit.js` (Adjust section)

**Acceptance Criteria:**
- [ ] `CsAdjust.currentOptions()` returns the defaults when `RSettings` is absent (node) and the stored values when present
- [ ] `CsAdjust.currentOptions()` reports `enabled: true` when nothing has been stored
- [ ] `CsAdjust.optionsFromTags(tagValues)` prefers a drawing's recorded sigmas over the current settings, and treats `Adjustment: "none"` as disabled
- [ ] `CsAdjust.resolveAndAdjust(survey, resolveOpts, adjustOpts)` returns a plain resolve result when disabled and an adjusted one when enabled — one call site, one shape

**Verify:** `node tests/js_unit.js` → `### UNIT OK <n> assertions`

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to the Adjust section of `tests/js_unit.js`:

```javascript
// settings plumbing: under node there is no RSettings, so the defaults
// must come back rather than an exception
var defOpts = CsAdjust.currentOptions();
ok(defOpts.enabled === true, "adjustment is enabled by default");
near(defOpts.sigmaTape, CsAdjust.DEFAULT_SIGMA_TAPE, 1e-12,
    "default sigmaTape");
near(defOpts.sigmaAngle, CsAdjust.DEFAULT_SIGMA_ANGLE, 1e-12,
    "default sigmaAngle");

// a drawing's own recorded values win over the current settings, so
// reopening and redrawing reproduces the geometry it was drawn with
var fromTags = CsAdjust.optionsFromTags({ Adjustment: "lsq",
    SigmaTape: "0.01", SigmaAngle: "0.3" });
ok(fromTags.enabled === true, "recorded Adjustment=lsq enables");
near(fromTags.sigmaTape, 0.01, 1e-12, "recorded sigmaTape wins");
near(fromTags.sigmaAngle, 0.3, 1e-12, "recorded sigmaAngle wins");
ok(CsAdjust.optionsFromTags({ Adjustment: "none" }).enabled === false,
    "recorded Adjustment=none disables");
ok(CsAdjust.optionsFromTags({}).enabled === true,
    "a drawing with no recorded adjustment follows the settings");
ok(CsAdjust.optionsFromTags({ Adjustment: "lsq", SigmaTape: "" }).sigmaTape ===
    CsAdjust.DEFAULT_SIGMA_TAPE, "a blank recorded sigma falls back");

// one call for both paths, one shape out
var onResult = CsAdjust.resolveAndAdjust(sq, {}, EQ);
ok(onResult.adjusted === true, "resolveAndAdjust adjusts when enabled");
var offResult = CsAdjust.resolveAndAdjust(sq, {},
    { enabled: false, sigmaTape: 1, sigmaAngle: 0 });
ok(offResult.adjusted === false, "resolveAndAdjust passes through when off");
ok(offResult.raw === null, "a pass-through offers no ghost");
near(offResult.stations["A3"].x, rsq.stations["A3"].x, 1e-12,
    "a pass-through is the raw resolve");
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node tests/js_unit.js
```

Expected: `### UNIT FAIL` — `CsAdjust.currentOptions is not a function`.

- [ ] **Step 3: Implement the three helpers**

Append to `scripts/CaveSurvey/Core/CsAdjust.js`:

```javascript
/**
 * The options in force: the stored settings where a QCAD engine is
 * present, the defaults where it is not (node, and the unit tests).
 *
 * Core is otherwise pure. This one reader exists because the
 * alternative is every tool duplicating three RSettings lookups and
 * drifting on the defaults -- CsBind.SETTING_AUTO_BIND set the
 * precedent.
 */
CsAdjust.currentOptions = function() {
    var enabled = true;
    var sigmaTape = CsAdjust.DEFAULT_SIGMA_TAPE;
    var sigmaAngle = CsAdjust.DEFAULT_SIGMA_ANGLE;
    if (typeof RSettings !== "undefined") {
        try {
            enabled = RSettings.getBoolValue(CsAdjust.SETTING_ENABLED, true);
            sigmaTape = RSettings.getDoubleValue(CsAdjust.SETTING_SIGMA_TAPE,
                CsAdjust.DEFAULT_SIGMA_TAPE);
            sigmaAngle = RSettings.getDoubleValue(CsAdjust.SETTING_SIGMA_ANGLE,
                CsAdjust.DEFAULT_SIGMA_ANGLE);
        } catch (e) {
            // an engine without these getters: the defaults stand
        }
    }
    return { enabled: enabled === true, sigmaTape: sigmaTape,
        sigmaAngle: sigmaAngle };
};

/**
 * The options a DRAWING was adjusted with, from its trip-0 anchor tags,
 * falling back to the current settings for anything it does not record.
 *
 * A drawing's own record wins so that reopening it and pressing Draw
 * reproduces the geometry it already has, instead of silently
 * re-solving under whatever the global setting happens to be today.
 *
 * \param tags {Adjustment, SigmaTape, SigmaAngle} as read by CsTags.get
 *             (missing tags are "" -- CsTags.get never returns null)
 */
CsAdjust.optionsFromTags = function(tags) {
    var current = CsAdjust.currentOptions();
    tags = tags || {};
    var mode = tags.Adjustment;
    var enabled = current.enabled;
    if (mode === "none") {
        enabled = false;
    } else if (mode === "lsq") {
        enabled = true;
    }
    var num = function(text, fallback) {
        if (text === undefined || text === null || text === "") {
            return fallback;
        }
        var v = parseFloat(text);
        return isNaN(v) ? fallback : v;
    };
    return {
        enabled: enabled,
        sigmaTape: num(tags.SigmaTape, current.sigmaTape),
        sigmaAngle: num(tags.SigmaAngle, current.sigmaAngle)
    };
};

/** The tag values to record for a given set of options. */
CsAdjust.tagsFor = function(options) {
    return {
        Adjustment: options.enabled ? "lsq" : "none",
        SigmaTape: String(options.sigmaTape),
        SigmaAngle: String(options.sigmaAngle)
    };
};

/**
 * Resolve, then adjust if adjustment is on -- the one call every tool
 * makes, so that "on" and "off" hand back the same shape and no caller
 * has to branch.
 *
 * \param adjustOpts as CsAdjust.adjust's opts, plus `enabled`; omitted
 *                   means CsAdjust.currentOptions().
 */
CsAdjust.resolveAndAdjust = function(survey, resolveOpts, adjustOpts) {
    var resolved = CsNetwork.resolve(survey, resolveOpts || {});
    var o = adjustOpts || CsAdjust.currentOptions();
    if (o.enabled === false) {
        return CsAdjust.unadjusted(resolved, {
            sigmaTape: o.sigmaTape, sigmaAngle: o.sigmaAngle });
    }
    return CsAdjust.adjust(survey, resolved, o);
};
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node tests/js_unit.js
```

Expected: `### UNIT OK <n> assertions`, n increased by 13.

- [ ] **Step 5: Commit**

```bash
git add scripts/CaveSurvey/Core/CsAdjust.js tests/js_unit.js
git commit -m "feat: adjustment settings, per-drawing record, and one resolveAndAdjust entry point"
```

**AS BUILT (2026-08-21).** The four helpers landed essentially as drafted above
— unlike Task 2, nothing here was wrong. Two things worth recording for the
next task anyway:

1. **The Task 2 as-built correction did not touch this task's own code.**
   `converged`/`iterations` living under `summary` and `controlFrame` copying
   into both `adjust()` and `unadjusted()` are properties of `CsNetwork.resolve`
   / `CsAdjust.adjust` / `CsAdjust.unadjusted`, none of which this task's four
   helpers reimplement — `resolveAndAdjust` just calls them and passes the
   result through. The drafted `resolveAndAdjust` body above was already
   correct against the as-built module. What *did* need adding, beyond the
   drafted test block, was an explicit assertion that `controlFrame` survives
   `resolveAndAdjust` on both the enabled and disabled paths (`onResult` and
   `offResult` each checked against a fresh `CsNetwork.resolve(sq, {})`) —
   the acceptance criteria call this out by name and the drafted Step-1 tests
   above did not exercise it at all.

2. **Purity decision.** `currentOptions()` stays in `CsAdjust.js` and reads
   `RSettings` directly, guarded by `typeof` + `try/catch`. The module header
   now says Core is pure "except `currentOptions()`", and the function's own
   docstring says so again and points at `CsBind.SETTING_AUTO_BIND` as the
   precedent. Reasoning: three tools (`CsDraw`, `CsBind`, `CsReport` by Task 8)
   would otherwise each duplicate the same three `RSettings` lookups and the
   same three defaults, and copies drift — which is exactly the bug class this
   feature exists to prevent, just relocated to the settings layer instead of
   the geometry layer. A single reader with one set of defaults, one try/catch,
   and one docstring is easier to audit for the "must not throw" requirement
   than N call sites each doing their own guarding. The alternative (each tool
   reads settings and passes `options` in) was rejected only because it has no
   compensating benefit here: `currentOptions()` takes no survey-specific
   argument and returns a plain value object, so it is trivially injectable —
   any test or tool that wants a specific `{enabled, sigmaTape, sigmaAngle}`
   can already pass its own `adjustOpts` to `resolveAndAdjust` and skip
   `currentOptions()` entirely, which the disabled-path test above does.

The test block above (Step 1) is also expanded past the drafted 13 assertions:
added coverage for a stubbed `RSettings` with real stored values (the drafted
tests only ever ran with `RSettings` absent, so "stored values when present"
and "does not throw when the getters differ" were asserted in the acceptance
criteria but never actually exercised), for an unparseable (non-blank,
non-numeric) recorded sigma alongside the drafted blank-string case, for
`tagsFor` round-tripping through `optionsFromTags` in both the enabled and
disabled directions, and for a recorded sigma winning over a *non-default*
stubbed setting (the drafted test only proved it beats the hardcoded default,
which is also what a bug that ignored the settings entirely would produce).

---

### Task 4: The `CTRL-RAW` layer

**Goal:** A grey dashed layer, off by default, that the as-surveyed ghost draws on — registered, defaulted, and present in the plan template so the structural test passes.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsLayers.js` (constant, `DEFAULTS`, `OFF`)
- Modify: `templates/NSS_Cave_Template_PLAN.dxf` (LAYER table record)
- Test: `tests/test_addon.py` (already pins registry against template — no new test needed there; add a unit assertion instead)
- Test: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `CsLayers.RAW === "CTRL-RAW"`, with a `DEFAULTS` entry `["gray", "DASHED", "Weight000"]`
- [ ] `CsLayers.OFF["CTRL-RAW"] === true`
- [ ] `test_registry_layers_exist_in_plan_template` passes with the new layer
- [ ] the template's LAYER record uses a handle no other object uses

**Verify:** `python3 -m unittest discover -s tests -v` → `OK`, and `node tests/js_unit.js` → `### UNIT OK`

**Steps:**

- [ ] **Step 1: Write the failing tests**

Add to `tests/js_unit.js`, in the layers section (search for `CsLayers.SPLAYS` to find it):

```javascript
ok(CsLayers.RAW === "CTRL-RAW", "the as-surveyed ghost layer is CTRL-RAW");
ok(CsLayers.DEFAULTS["CTRL-RAW"][1] === "DASHED",
    "CTRL-RAW is dashed -- it is not the survey, it is where the survey was");
ok(CsLayers.OFF["CTRL-RAW"] === true, "CTRL-RAW is created switched off");
```

- [ ] **Step 2: Run to verify red**

```bash
node tests/js_unit.js
```

Expected: three failures naming CTRL-RAW.

- [ ] **Step 3: Register the layer**

In `scripts/CaveSurvey/Core/CsLayers.js`, after the `CsLayers.HIDDEN` line:

```javascript
CsLayers.RAW = "CTRL-RAW";
```

In `CsLayers.DEFAULTS`, after the `"CTRL-HIDDEN"` entry:

```javascript
    "CTRL-RAW": ["gray", "DASHED", "Weight000"],
```

Replace the `CsLayers.OFF` assignment with:

```javascript
CsLayers.OFF = { "CTRL-DATA": true, "CTRL-HIDDEN": true, "CTRL-RAW": true };
```

- [ ] **Step 4: Run the structural test to see the template gap**

```bash
python3 -m unittest tests.test_addon -v -k registry_layers
```

Expected: FAIL — `layers in Core/Layers.js but not the plan template: ['CTRL-RAW']`.

- [ ] **Step 5: Add the layer to the plan template**

Find the `CTRL-SPLAYS` LAYER record in `templates/NSS_Cave_Template_PLAN.dxf` and
insert a sibling immediately after it. First pick an unused handle:

```bash
grep -c "^AcDbLayerTableRecord$" templates/NSS_Cave_Template_PLAN.dxf
grep -n "^ *5$" templates/NSS_Cave_Template_PLAN.dxf | wc -l
```

Use `7FF0` — verify it is unused before inserting:

```bash
grep -n "^7FF0$" templates/NSS_Cave_Template_PLAN.dxf; echo "exit $? (1 = unused, good)"
```

Then insert this record after the `CTRL-SPLAYS` record's trailing `  0` / `LAYER`
pair, matching that record's field order exactly (`62` is the colour index — 8 is
grey, the same as CTRL-SPLAYS):

```
  5
7FF0
330
1
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
CTRL-RAW
 70
0
 62
8
  6
DASHED
370
0
390
13
347
21
  0
LAYER
```

`DASHED` is already in the template's LTYPE table (alongside `DASHEDX2` and
`DASHED2`), so no linetype needs adding.

- [ ] **Step 6: Verify both test layers pass**

```bash
python3 -m unittest discover -s tests -v && node tests/js_unit.js
```

Expected: `OK` from unittest, `### UNIT OK <n>` from node.

- [ ] **Step 7: Commit**

```bash
git add scripts/CaveSurvey/Core/CsLayers.js templates/NSS_Cave_Template_PLAN.dxf tests/js_unit.js
git commit -m "feat: CTRL-RAW layer for the as-surveyed ghost"
```

---

### Task 5: `CsDraw` draws the ghost

**Goal:** When the resolved object carries a `raw` result, draw the as-surveyed centerline on `CTRL-RAW`, tagged so a redraw replaces it and never orphans it.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsDraw.js` (`survey`, `eraseStations`)
- Test: `tests/js_unit.js` (the doc-level draw tests — search for `drawn.splaysDrawn` to find the pattern)

**Acceptance Criteria:**
- [ ] with `raw` present, one ghost line per drawn leg and one ghost point per station appear on `CTRL-RAW`
- [ ] ghost lines are tagged `RawShot="<from>-><to>"`, ghost points `RawStation="<name>"`
- [ ] `drawn.ghostDrawn` counts the ghost lines; `CsDraw.survey` returns it
- [ ] with `raw` null or absent, nothing is drawn on `CTRL-RAW`
- [ ] `eraseStations` deletes ghost geometry for the named stations and leaves zero orphans
- [ ] `eraseStations` still refuses to touch anything carrying linework tags

**Verify:** `./tests/run_all.sh` → `ALL TESTS PASSED`

**Steps:**

- [ ] **Step 1: Write the failing test**

Add to the document-level draw test section of `tests/js_unit.js` (the block that
builds a real `RDocument` and calls `CsDraw.survey`; search for
`drawn.splaysDrawn` and follow the surrounding harness). Use the harness already
there rather than a new one:

```javascript
    // --- as-surveyed ghost on CTRL-RAW -----------------------------
    var ghostSurvey = CsModel.newSurvey();
    ghostSurvey.shots.push(shotOf("G1", "G2", 10, 0));
    ghostSurvey.shots.push(shotOf("G2", "G3", 10, 90));
    ghostSurvey.shots.push(shotOf("G3", "G4", 10, 180));
    ghostSurvey.shots.push(shotOf("G4", "G1", 10.5, 270));
    var rGhost = CsNetwork.resolve(ghostSurvey, {});
    var aGhost = CsAdjust.adjust(ghostSurvey, rGhost,
        { sigmaTape: 1, sigmaAngle: 0 });
    var drawnGhost = CsDraw.survey(aGhost === null ? rGhost : aGhost,
        aGhost, "G1", new RVector(0, 0), 0);
    ok(drawnGhost.ghostDrawn === 4,
        "one ghost leg per drawn leg (got " + drawnGhost.ghostDrawn + ")");
    var rawLines = 0, rawPoints = 0;
    var gids = doc.queryAllEntities(false, false);
    for (var gi = 0; gi < gids.length; gi++) {
        var ge = doc.queryEntity(gids[gi]);
        if (isNull(ge)) { continue; }
        if (CsTags.get(ge, "RawShot") !== "") { rawLines++; }
        if (CsTags.get(ge, "RawStation") !== "") { rawPoints++; }
    }
    ok(rawLines === 4, "four ghost lines tagged RawShot (got " + rawLines + ")");
    ok(rawPoints === 4, "four ghost points tagged RawStation (got " +
        rawPoints + ")");

    // a redraw must replace the ghost, not accumulate it
    CsDraw.eraseStations(doc, ["G1", "G2", "G3", "G4"]);
    var leftLines = 0, leftPoints = 0;
    gids = doc.queryAllEntities(false, false);
    for (gi = 0; gi < gids.length; gi++) {
        ge = doc.queryEntity(gids[gi]);
        if (isNull(ge)) { continue; }
        if (CsTags.get(ge, "RawShot") !== "") { leftLines++; }
        if (CsTags.get(ge, "RawStation") !== "") { leftPoints++; }
    }
    ok(leftLines === 0 && leftPoints === 0,
        "eraseStations leaves no ghost orphans (" + leftLines + " lines, " +
        leftPoints + " points)");
```

Adapt the `CsDraw.survey` call to the exact signature the surrounding harness
already uses — `CsDraw.survey(survey, resolved, originStation, originPos, seqBase)`.
The line above passes `ghostSurvey` as the first argument; write it as
`CsDraw.survey(ghostSurvey, aGhost, "G1", new RVector(0, 0), 0)`.

- [ ] **Step 2: Run to verify red**

```bash
./tests/run_all.sh
```

Expected: unit failures on `ghostDrawn`, the tag counts, and possibly `undefined`
arithmetic.

- [ ] **Step 3: Draw the ghost**

In `CsDraw.survey`, after the splay-drawing block and before the return, add:

```javascript
    // The AS-SURVEYED ghost. When the resolved object came from
    // CsAdjust, `raw` holds the pre-adjustment network -- draw it grey
    // and dashed on CTRL-RAW so turning that layer on shows exactly
    // what the adjustment moved and by how much. This is the "shown"
    // half of "shown and reversible"; the reversible half needs no code
    // at all, because the raw readings live in XDATA and were never
    // touched.
    var ghostDrawn = 0;
    var rawResolved = (resolved.raw === undefined) ? null : resolved.raw;
    if (rawResolved !== null && rawResolved.stations !== undefined) {
        var rawAt = function(stationName) {
            var rp = rawResolved.stations[stationName];
            return new RVector(rp.x + offX, rp.y + offY);
        };
        CsLayers.withLayerOn(doc, di, CsLayers.RAW, function() {
            var gop = new RAddObjectsOperation();
            gop.setText("As-surveyed ghost");
            for (var gj = 0; gj < rawResolved.legs.length; gj++) {
                var gleg = rawResolved.legs[gj];
                if (gleg.shot.excludeFromPlot) {
                    continue;
                }
                if (!rawResolved.stations.hasOwnProperty(gleg.from) ||
                        !rawResolved.stations.hasOwnProperty(gleg.to)) {
                    continue;
                }
                CsDraw.shotLine(doc, gop, rawAt(gleg.from), rawAt(gleg.to),
                    gleg.from, gleg.to, CsLayers.RAW,
                    { RawShot: gleg.from + "->" + gleg.to });
                ghostDrawn++;
            }
            for (var gname in rawResolved.stations) {
                if (!rawResolved.stations.hasOwnProperty(gname)) {
                    continue;
                }
                CsDraw.markPoint(doc, gop, rawAt(gname), CsLayers.RAW,
                    { RawStation: gname });
            }
            di.applyOperation(gop);
        });
    }
```

Two things to check against the file as it stands, because both are existing local
conventions this block borrows:

- `offX` / `offY` are the offset variables `CsDraw.survey` already computes for the
  wall runs (memory: "offset-corrected via offX/offY"). Use the same names the
  function uses; if they are named differently, follow the file.
- `CsDraw.shotLine` and the point-drawing helper: use whatever `CsDraw.survey`
  already calls for leg lines and station points, with the tag object as its last
  argument. If the point helper is not named `markPoint`, use the real name — the
  station-drawing loop earlier in the same function shows it.

Add to the returned object:

```javascript
        ghostDrawn: ghostDrawn,
```

and mention it in the function's `\return` doc line.

- [ ] **Step 4: Add the erase rules**

In `CsDraw.eraseStations`, after the last existing `if (!kill)` block and before the
kill is acted on, add:

```javascript
        if (!kill) {
            v = CsTags.get(e, "RawStation");
            if (v !== "" && inSet[v] === true) { kill = true; }
        }
        if (!kill) {
            v = CsTags.get(e, "RawShot");
            if (v !== "") {
                // "A1->A2": either end being replaced replaces the
                // ghost leg, the same rule the real leg lines follow.
                var rawEnds = v.split("->");
                if (inSet[rawEnds[0]] === true ||
                        inSet[rawEnds[rawEnds.length - 1]] === true) {
                    kill = true;
                }
            }
        }
```

- [ ] **Step 5: Run to verify green**

```bash
./tests/run_all.sh
```

Expected: `ALL TESTS PASSED`.

- [ ] **Step 6: Commit**

```bash
git add scripts/CaveSurvey/Core/CsDraw.js tests/js_unit.js
git commit -m "feat: draw the as-surveyed ghost on CTRL-RAW, and erase it with its stations"
```

**AS BUILT (2026-08-21).** The ghost landed as designed. Five departures from
the draft above, one of them a pre-existing bug the task uncovered.

**1. `markPoint` does not exist, and `shotLine` was the wrong helper.** The
station-drawing loop uses `CsDraw.station`, which writes a `Station` tag and a
label — exactly what a ghost must never carry. The real primitive is
`CsDraw.addPoint(doc, op, layerName, pos)`, which returns an untagged entity for
the caller to tag and then add; the splay-tip loop (`CsDraw.js`, the
`SplayName` block) is the shape to copy. `offX` / `offY` were right as drafted.

**2. Ghost lines are drawn with `CsDraw.addLine(..., "RawShot", ...)`, not
`CsDraw.shotLine`.** `shotLine` sets `Shot="<from>-><to>"` as its primary tag,
so the drafted call would have given every ghost leg a `Shot` tag alongside its
`RawShot`. Two places in `tests/js_unit.js` build a `legByShot[shotTag] = entity`
map and would then have keyed a real leg to a ghost at as-surveyed coordinates;
`eraseStations`' own `Shot` rule would half-own the ghost as well. The spec's
"two positions under one name" argument is about stations, but it applies
verbatim to legs. Ghosts now carry `RawShot` / `RawStation` and nothing else.

`CsRevise.surveyFromDocument` is safe either way — it gates on a `Distance` tag,
which the ghost never carries — and this is pinned by an assertion that
reconstruction still finds four shots, not eight.

**3. `CsBind.SUITE_TAGS` was deliberately NOT extended.** Every
`isSuiteGeometry` call site is gated on `CsBind.isLineworkLayer` first, and
`CTRL-` is in `NEVER_LINEWORK_PREFIXES`, so a ghost is unreachable from there by
construction. Adding `RawShot` / `RawStation` to `SUITE_TAGS` would only create a
new hazard: a user's traced polyline that picked up a stray ghost tag would stop
being adoptable and stop being moved by a revision.

**4. THE PRE-EXISTING BUG: this build refuses DELETES on an off layer, not just
adds.** The plan knew adds were dropped; deletes are too, and the engine is loud
about it:

```
Warning:  RTransaction::deleteObject: entity not editable (locked or hidden layer)
Warning:  RDocumentInterface::applyOperation: transaction failed
```

The refused object is dropped while the rest of the operation lands, so
`eraseStations` returned a plausible non-zero count and left the entity behind.
This was already broken for `CTRL-HIDDEN` before any ghost existed: every redraw
orphaned the old `excludeFromPlot` legs and drew a second copy beside them. A
test now pins `CTRL-HIDDEN` specifically, independent of the ghost.

The fix is generic rather than a `CTRL-RAW` special case: `eraseStations`
collects the off layers its kill list touches and nests `CsLayers.withLayerOn`
around the one delete operation, so a future off layer needs no edit here.
Locked layers are deliberately NOT unlocked — a lock is something the surveyor
did on purpose, and an entity on one survives the erase.

**5. The RawShot kill rule is either-end, and the draft's justification for it
was wrong.** The draft comment said either-end is "the same rule the real leg
lines follow"; the real leg rule is BOTH ends, precisely so a tie-in shot from an
older survey keeps its line. Either-end is still right for the ghost, for a
different reason: a real leg is the drawing's only record of that shot, while a
ghost leg carries no data at all and the redraw regenerates it from the whole
reconstructed survey. Keeping it would leave a line pointing at a coordinate
that just moved, and then a duplicate beside the fresh one. Both halves are
pinned: a partial erase of `G1` alone takes both ghost legs touching it, and a
full erase-then-redraw cycle leaves 8 entities on `CTRL-RAW`, not 16.

**Also folded in beyond the brief.** `CTRL-RAW` is created lazily by the ghost
block via `CsLayers.ensure`, not added to `ensureSurveyLayers` — it was never in
`ensureSurveyLayers`, and following `TEXT-NOTES` and the wall layers keeps an
always-empty layer out of every plain survey. And `RebuildSurveyData.shotCount`
plus the `CsReport` "Shots drawn" line both had to learn `tiesDrawn`: moving ties
out of `shotsDrawn` would otherwise have silently under-reported every
two-entrance cave. `ghostDrawn` is deliberately excluded from `shotCount` — the
ghost is a second picture of shots already counted. Task 8's own ties block is
unaffected; it adds separate `Control tie ...` lines from `resolved.ties`.

---

### Task 6: `CsBind` never binds linework to a ghost

**Goal:** Ghost station points can never enter the linework binding index, by tag naming and by an explicit layer skip.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsBind.js` (`stationIndex`)
- Test: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `CsBind.stationIndex` returns no entry for any entity on `CTRL-RAW`, even one carrying a `Station` tag
- [ ] the existing binding tests still pass unchanged

**Verify:** `./tests/run_all.sh` → `ALL TESTS PASSED`

**Steps:**

- [ ] **Step 1: Write the failing test**

In the `CsBind` document-level test section of `tests/js_unit.js`, add:

```javascript
    // A ghost point must never enter the binding index. The RawStation
    // tag name already keeps it out; this pins the belt-and-braces
    // layer skip, because stationIndex queries EVERY entity and one
    // careless future tag would otherwise let a traced wall bind to a
    // phantom.
    var ghostOp = new RAddObjectsOperation();
    ghostOp.setText("ghost decoy");
    CsLayers.ensureSurveyLayers(doc, di);
    CsLayers.withLayerOn(doc, di, CsLayers.RAW, function() {
        var decoy = new RPointEntity(doc,
            new RPointData(new RVector(500, 500)));
        decoy.setLayerId(doc.getLayerId(CsLayers.RAW));
        CsTags.set(decoy, "Station", "DECOY");
        ghostOp.addObject(decoy);
        di.applyOperation(ghostOp);
    });
    var idx = CsBind.stationIndex(doc);
    var decoyFound = false;
    for (var bi = 0; bi < idx.length; bi++) {
        if (idx[bi].name === "DECOY") { decoyFound = true; }
    }
    ok(decoyFound === false,
        "stationIndex skips CTRL-RAW even for a Station-tagged entity");
```

- [ ] **Step 2: Run to verify red**

```bash
./tests/run_all.sh
```

Expected: `stationIndex skips CTRL-RAW even for a Station-tagged entity` fails.

- [ ] **Step 3: Add the skip**

In `CsBind.stationIndex`, immediately after `var e = doc.queryEntity(ids[i]);` and
its null guard, before any tag is read:

```javascript
        // CTRL-RAW carries the as-surveyed GHOST: points that sit
        // within the misclosure of the real stations. A traced wall
        // that bound to one would be moved by the next revision
        // against a phantom with no survey meaning, and a ghost
        // carrying a real name would put two positions under one name
        // in this index. The RawStation tag name already keeps them
        // out; this skip is the guard that survives a future tag
        // rename.
        if (CsBind.layerNameOf(doc, e) === CsLayers.RAW) {
            continue;
        }
```

If `CsBind` has no layer-name helper, use the same expression the file's existing
layer gate uses (the one consulting `CsRevise.isWorldFixedLayer`) — follow the local
idiom rather than adding a second way to read a layer name.

- [ ] **Step 4: Run to verify green**

```bash
./tests/run_all.sh
```

Expected: `ALL TESTS PASSED`.

- [ ] **Step 5: Commit**

```bash
git add scripts/CaveSurvey/Core/CsBind.js tests/js_unit.js
git commit -m "fix: linework can never bind to an as-surveyed ghost point"
```

---

### Task 7: Wire the call sites

**Goal:** Every tool that resolves a survey now resolves-and-adjusts, and `CsRevise` adjusts both sides of its before/after comparison.

**Files:**
- Modify: `scripts/CaveSurvey/SurveyNotebook/SurveyNotebook.js:587`, `:722`, `:1366`
- Modify: `scripts/CaveSurvey/ImportCaveSurvey/ImportCaveSurvey.js:131`
- Modify: `scripts/CaveSurvey/SurveyStats/SurveyStats.js:38`
- Modify: `scripts/CaveSurvey/RebuildSurveyData/RebuildSurveyData.js:178`
- Modify: `scripts/CaveSurvey/Core/CsRevise.js:1665-1666`
- Test: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] each of the six tool call sites goes through `CsAdjust.resolveAndAdjust` with the same resolve options it passed before
- [ ] `CsRevise.apply` adjusts `oldResolved` and `newResolved` with identical options, so `similarityFit` never reads the adjustment as the revision
- [ ] `CsRevise.apply`'s georeference probe at `:1636` stays a plain `CsNetwork.resolve` — it answers connectivity, not geometry
- [ ] the georeferenced station is passed as `opts.pinned` wherever the caller knows it
- [ ] the revision report's `loopsBefore` / `loopsAfter` still show FingerprintCave going 4.21 → 0.74 ft
- [ ] **added after Task 1b:** no call site passes a placeholder `z` for `opts.anchor`.
      `ImportCaveSurvey.js` and both `SurveyNotebook.js` sites currently always pass a
      numeric z, often `0.0`, so Task 1b's "omitted z falls back to the anchored
      station's own control elevation" protection never fires for the real callers. If
      an anchored station is also `*fix`ed with a real absolute elevation, the
      rebase-to-zero bug survives through those paths. Each site must either omit `z`
      when it has no genuine elevation to supply, or pass the control elevation it
      means. A test must cover at least one of those call paths with a fixed,
      absolute-datum anchor station.

**Verify:** `./tests/run_all.sh` → `ALL TESTS PASSED`

**Steps:**

- [ ] **Step 1: Write the failing test**

Add to the `CsRevise` document-level test section of `tests/js_unit.js`:

```javascript
    // Both sides of a revision comparison must be adjusted the same
    // way. Adjusting only one makes similarityFit read the adjustment
    // itself as part of the revision and misclassify a rigid change.
    var revSurvey = CsModel.newSurvey();
    revSurvey.shots.push(shotOf("R1", "R2", 10, 0));
    revSurvey.shots.push(shotOf("R2", "R3", 10, 90));
    revSurvey.shots.push(shotOf("R3", "R1", 12.81, 218.66));
    var rRev = CsAdjust.resolveAndAdjust(revSurvey, {},
        { enabled: true, sigmaTape: 1, sigmaAngle: 0 });
    var revised = CsRevise.reviseDeclination(revSurvey, 0, 2.0, "user");
    var rRevised = CsAdjust.resolveAndAdjust(revised, {},
        { enabled: true, sigmaTape: 1, sigmaAngle: 0 });
    var fit = CsRevise.similarityFit(rRev.stations, rRevised.stations);
    var revExtent = CsAdjust.extentOf(rRev.stations);
    ok(fit.residual < 1e-6 * Math.max(revExtent, 1),
        "a declination revision stays RIGID when both sides are adjusted " +
        "(residual " + fit.residual + ")");
    near(fit.theta, -2.0 * Math.PI / 180.0, 1e-6,
        "the rigid rotation is the declination delta, sign per CsRevise.applyFit");
```

- [ ] **Step 2: Run to verify red**

```bash
node tests/js_unit.js
```

Expected: the rigid-residual assertion fails, because adjusting rotates by a
least-squares fit that a raw comparison does not see. (If it happens to pass, the
test is still the regression guard for the wiring below — proceed.)

- [ ] **Step 3: Wire the six tool call sites**

Each is a one-line change. In `SurveyNotebook.js:587`:

```javascript
    var resolved = CsAdjust.resolveAndAdjust(survey, {});
```

`SurveyNotebook.js:722`:

```javascript
    var resolved = CsAdjust.resolveAndAdjust(survey, { anchor: anchor });
```

`SurveyNotebook.js:1366`:

```javascript
    var resolved = CsAdjust.resolveAndAdjust(merged, { anchor: anchor });
```

`ImportCaveSurvey.js:131`:

```javascript
    var resolved = CsAdjust.resolveAndAdjust(survey, { anchor: anchor });
```

`SurveyStats.js:38`:

```javascript
    var resolved = CsAdjust.resolveAndAdjust(survey, {});
```

`RebuildSurveyData.js:178` — keep the existing options object, just change the call:

```javascript
    var resolved = CsAdjust.resolveAndAdjust(survey, {
        // ... the existing options, unchanged
    });
```

- [ ] **Step 4: Record the options on the trip-0 anchor**

In `CsDraw.survey`, where the trip-0 anchor's metadata tags are written (the block
that writes `StartNote` / `StartLrud` / the legacy `Survey*` block), add the
adjustment record so a redraw reproduces this geometry:

```javascript
        // What this drawing was adjusted with, so reopening it and
        // pressing Draw reproduces the same geometry instead of
        // silently re-solving under today's settings.
        var adjTags = CsAdjust.tagsFor({
            enabled: resolved.adjusted === true,
            sigmaTape: resolved.summary !== undefined ?
                resolved.summary.sigmaTape : CsAdjust.DEFAULT_SIGMA_TAPE,
            sigmaAngle: resolved.summary !== undefined ?
                resolved.summary.sigmaAngle : CsAdjust.DEFAULT_SIGMA_ANGLE
        });
        CsTags.set(anchorEntity, "Adjustment", adjTags.Adjustment);
        CsTags.set(anchorEntity, "SigmaTape", adjTags.SigmaTape);
        CsTags.set(anchorEntity, "SigmaAngle", adjTags.SigmaAngle);
```

Use the local variable name that block already has for the anchor entity.

- [ ] **Step 5: Adjust both sides in `CsRevise.apply`**

Replace lines 1665-1666:

```javascript
    var oldResolved = CsNetwork.resolve(recon.survey, { anchor: anchor });
    var newResolved = CsNetwork.resolve(newSurvey, { anchor: anchor });
```

with:

```javascript
    // BOTH sides, identically adjusted. Adjusting one and not the other
    // makes similarityFit read the adjustment as part of the revision:
    // a pure declination change stops classifying as rigid and the
    // drawing gets erased and redrawn, taking untagged hand-traced
    // walls with it. The options come from the DRAWING's record, not
    // today's settings, for the same reason a redraw does.
    var adjustOpts = CsAdjust.optionsFromTags(recon.adjustTags || {});
    if (geoName !== null && geoName !== undefined && geoName !== "") {
        adjustOpts.pinned = [geoName];
    }
    var oldResolved = CsAdjust.resolveAndAdjust(recon.survey,
        { anchor: anchor }, adjustOpts);
    var newResolved = CsAdjust.resolveAndAdjust(newSurvey,
        { anchor: anchor }, adjustOpts);
```

Leave the georeference probe at line 1636 as a plain `CsNetwork.resolve`: it asks
whether a name resolves at all and where the reconstruction frame put it. Both are
connectivity questions, and adjusting them would make the drag measurement depend on
the solve.

In `CsRevise.surveyFromDocument`, read the three tags off the trip-0 anchor and
return them as `adjustTags` alongside `survey` / `anchorName` / `anchorPos` /
`legacy`, so `apply` can use the drawing's own record:

```javascript
        adjustTags: {
            Adjustment: CsTags.get(anchorEntity, "Adjustment"),
            SigmaTape: CsTags.get(anchorEntity, "SigmaTape"),
            SigmaAngle: CsTags.get(anchorEntity, "SigmaAngle")
        },
```

Use the local name that function already has for the trip-0 anchor entity. Update
the function's `\return` doc comment to list `adjustTags`.

- [ ] **Step 6: Run the whole suite**

```bash
./tests/run_all.sh
```

Expected: `ALL TESTS PASSED`. If the FingerprintCave revision fixture fails, check
first that `loopsBefore` / `loopsAfter` still read `resolved.loops` — those must be
the as-surveyed numbers coming through unchanged, per Task 2's honesty rule.

- [ ] **Step 7: Commit**

```bash
git add scripts/CaveSurvey/SurveyNotebook/SurveyNotebook.js scripts/CaveSurvey/ImportCaveSurvey/ImportCaveSurvey.js scripts/CaveSurvey/SurveyStats/SurveyStats.js scripts/CaveSurvey/RebuildSurveyData/RebuildSurveyData.js scripts/CaveSurvey/Core/CsRevise.js scripts/CaveSurvey/Core/CsDraw.js tests/js_unit.js
git commit -m "feat: every tool resolves-and-adjusts, and revisions compare like with like"
```

**AS BUILT (2026-08-21).** All six call sites wired and every acceptance
criterion met. FingerprintCave still prints `4.208174679593278` as-surveyed and
`0.7378205847170148` revised, digit for digit, because `loopsBefore` /
`loopsAfter` read `resolved.loops` and `CsAdjust` copies those through
untouched. `./tests/run_all.sh` → `ALL TESTS PASSED`, `46/46 parsed`,
`### UNIT OK 1928 assertions` (was 1887; node 988, was 981). Seven departures
from the draft above, five of them forced by evidence:

1. **Two of the drafted Step-1 test's calls do not exist.**
   `CsRevise.similarityFit` takes ONE argument -- an array of
   `{old, nu}` pairs, not two station maps -- and returns `maxResidual`,
   not `residual`; and `CsRevise.reviseDeclination` mutates its survey in
   place and returns `{delta, diverged, mixed}`, so
   `var revised = CsRevise.reviseDeclination(...)` would have handed a
   summary object to the next resolve. The landed test builds the fixture
   twice and compares through `CsRevise.classifyChange`, which is what
   `apply` actually calls -- the drafted test would have exercised a
   different code path even if it had compiled.

2. **The drafted test passes with no production change, and that is
   itself the evidence.** Both sides adjusted IS rigid, before and after
   the wiring, so a bare regression guard proves nothing on its own. What
   pins the trap is the assertion added beside it: the SAME revision with
   one side adjusted and the other raw classifies as NON-rigid. That pair
   is the argument.

3. **THE REAL RED TEST WAS VERTICAL, not horizontal.** `apply`'s rigid
   path rewrites every station's `Elevation` tag from
   `newResolved.stations[...].z`. With the drawing drawn adjusted and
   `apply` still resolving raw, a pure declination revision -- which
   cannot change an elevation at all -- snapped the whole cave back to
   its as-surveyed heights: measured at Z3, `0.5788272588897678` becoming
   `1.7364817766693033`. That is the geometry moving under the surveyor
   without a word, through the axis nobody was watching. A test pins it.

4. **`RebuildSurveyData` had to take the DRAWING's options, which the
   draft did not ask for.** Its whole job is repair -- "already tag
   schema v3, nothing inferred" is its own message -- and it erases every
   station's marks and redraws them. Solving under today's global setting
   instead moved a station by 0.1696 ft in answer to a request to fix
   tags; measured, and now a failing test if it comes back. Same argument
   applies to `SurveyNotebook.drawMergedSurvey` (which redraws an
   existing drawing) and to `SurveyStats` (whose Depth is measured over
   resolved elevations and would otherwise disagree with the map printed
   beside it). The rule that fell out, and that the comments state at
   each site: **a tool that CREATES geometry takes the current settings
   and lets `CsDraw.survey` record them; a tool that REPRODUCES or
   REPORTS ON existing geometry takes the drawing's record.** The three
   creating sites (`refresh`, `drawSurveyInner`, `ImportCaveSurvey`) pass
   no `adjustOpts` at all, exactly as drafted.

5. **`CsRevise.adjustTagsOn(entity)` is new, and `surveyFromDocument`
   reads the record through it.** `SurveyStats` has a document but no
   reconstruction, so without a shared reader the three tag names would
   have been spelled out twice -- which is the drift this whole feature
   exists to prevent, relocated to the tag layer. One writer
   (`CsDraw.survey`), one name-owning reader, and `optionsFromTags` still
   the only thing that interprets a blank field.

6. **`CsPick.startPointFromSelection` now returns `elevation`, and
   `SurveyNotebook.selectionElevation` is gone.** Its docstring argued
   against "teaching CsPick a field only the datum fix needs" -- but
   `ImportCaveSurvey` needed the same answer, and its own placeholder was
   an unconditional `z: 0.0`. The field is null (never 0) when the picked
   entity records no elevation, and the three anchor sites pass it
   straight through so `CsNetwork.resolve`'s Task 1b fallback can fire.
   The one place that still coerces to a number is
   `merged.fixed[firstPage]` in `drawMergedSurvey`: that is a `survey.fixed`
   CONTROL coordinate with no "unspecified" state, and 0 is the honest
   reading of "nothing is known about this new trip's height" for the
   disconnected passage that is the only case resolve honours a fixed
   seed in. Commented as a deliberate difference.

7. **`opts.pinned` shipped in Task 2 with no test at all.** Task 7 is its
   first caller, so it is pinned here: an explicitly pinned station
   overrides the `notHonored` exclusion and does not move, and a name the
   network has never heard of is skipped rather than pinned into
   existence (which matters, because `apply` may pass a geo station whose
   point was deleted from the drawing). The `apply` wiring itself is
   pinned by watching the two calls: exactly two, identical options
   strings, and `"Z2"` -- a georeferenced station deliberately NOT the
   anchor -- present in the pin list.

**Not tested, and why.** The four tool files are GUI code. The syntax
stage parses them inside CaveCAD's engine (`46/46`), which proves they
parse and nothing more. Two of the six call sites are reachable headlessly
and are driven end to end -- `SurveyNotebook.drawSurveyInner` (with only
`sheetSurvey` stubbed; the selection, the pick, the elevation lookup, the
resolve and the draw are real) and `RebuildSurveyData.rebuild`. The other
four -- `SurveyNotebook.refresh` (dock widget), `drawMergedSurvey`'s new
`adjustOpts` argument (covered by the existing notebook-linework test only
on the unadjusted path), `ImportCaveSurvey` (file dialog) and
`SurveyStats` (title-block dialogs) -- are wired by inspection only.

**Found in passing, NOT fixed (out of scope, and untestable cheaply).**
`AzimuthTraverse.js:102` sets `currentZ = 0.0` unconditionally, and every
station it draws records `Elevation` from that running total. When the
traverse CONTINUES from a selected existing station (`startExists`, set
at `:52`), that station may sit on an absolute datum -- so a passage added
to a cave whose entrance is at 1250 ft is recorded 1250 ft too low, and a
later Rebuild or revision reads those tags as the truth. The same bug
family as `anchorZOf`, through a seventh door. The fix material now
exists (`sel.elevation`), but the tool is one interactive loop over
`getText`/`getDouble` and testing it means scripting those globals --
a task of its own, filed rather than done half-way.

---

### Task 8: `CsReport` says what happened

**Goal:** The report states what the adjustment did and reports horizontal error beside 3D, in the suite's existing plain-language voice.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsReport.js` (`drawSummary`, `statsSummary`)
- Test: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] with adjustment on, the draw summary states the worst station shift and how many stations moved
- [ ] with adjustment off or non-convergent, the summary says so instead of claiming an adjustment
- [ ] a non-convergence warning appears verbatim in the report
- [ ] each loop line reports horizontal error as well as 3D
- [ ] control ties are reported separately from loops, without a percent
- [ ] the ghost layer is named in the report, so a user can find it

**Verify:** `node tests/js_unit.js` → `### UNIT OK <n> assertions`

**Steps:**

- [ ] **Step 1: Write the failing test**

Append to the report section of `tests/js_unit.js`:

```javascript
var adjDrawn = { stationsDrawn: 5, shotsDrawn: 4, closuresDrawn: 1,
    wallsDrawn: 0, splaysDrawn: 0, ghostDrawn: 5, skipped: 0 };
var adjText = CsReport.drawSummary(sq, asq, adjDrawn, []);
ok(adjText.indexOf("Adjusted") >= 0, "the report says the survey was adjusted");
ok(adjText.indexOf("CTRL-RAW") >= 0, "the report names the ghost layer");
ok(adjText.indexOf(asq.summary.worstStation) >= 0,
    "the report names the station that moved most");
ok(adjText.indexOf("horizontal") >= 0,
    "loop lines report horizontal error too");

var offText = CsReport.drawSummary(sq, CsAdjust.unadjusted(rsq), adjDrawn, []);
ok(offText.indexOf("Adjusted") < 0,
    "an unadjusted draw does not claim an adjustment");
ok(offText.indexOf("as surveyed") >= 0,
    "an unadjusted draw says the misclosure is still on the closing leg");

var stuckText = CsReport.drawSummary(sq, stuck, adjDrawn, []);
ok(stuckText.indexOf("did not converge") >= 0,
    "a non-convergent solve says so in the report");

var tieText = CsReport.drawSummary(tie, rtie, adjDrawn, []);
ok(tieText.indexOf("Control tie") >= 0,
    "a component tie is reported as a tie, not a loop");
```

- [ ] **Step 2: Run to verify red**

```bash
node tests/js_unit.js
```

Expected: eight failures on the missing report text.

- [ ] **Step 3: Extend `drawSummary`**

In `CsReport.drawSummary`, replace the loop-reporting block with:

```javascript
    for (var i = 0; i < resolved.loops.length; i++) {
        var loop = resolved.loops[i];
        lines.push("Loop " + loop.from + " to " + loop.to + ": closes " +
            loop.error.toFixed(2) + " off over " +
            loop.traverseLength.toFixed(1) + " surveyed (" +
            loop.percent.toFixed(2) + "%)" +
            (loop.percent <= 1.0 ? " -- good" : "") +
            " [horizontal " + loop.horizontal.toFixed(2) +
            ", vertical " + loop.vertical.toFixed(2) + "]");
    }

    // Control ties are not loops: two separately fixed components
    // joined by a leg. The gap is a real check against the fixed
    // coordinates, but there is no ring, so no percentage of a
    // traverse length can be quoted for it.
    var ties = resolved.ties || [];
    for (i = 0; i < ties.length; i++) {
        var tieItem = ties[i];
        lines.push("Control tie " + tieItem.from + " to " + tieItem.to +
            ": " + tieItem.error.toFixed(2) + " between fixed points " +
            "[horizontal " + tieItem.horizontal.toFixed(2) +
            ", vertical " + tieItem.vertical.toFixed(2) + "]");
    }

    // What the adjustment did -- or plainly that none was made, so a
    // reader is never left guessing which centreline they are looking
    // at.
    if (resolved.adjusted === true) {
        var sum = resolved.summary;
        lines.push("Adjusted by least squares: " + sum.movedCount +
            " station" + (sum.movedCount === 1 ? "" : "s") + " moved, " +
            "most of all " + sum.worstStation + " at " +
            CsReport.length(sum.worstShift, survey.distanceUnit) +
            " (" + sum.iterations + " iteration" +
            (sum.iterations === 1 ? "" : "s") + ").");
        lines.push("The as-surveyed centreline is on layer CTRL-RAW, " +
            "switched off -- turn it on to see exactly what moved.");
        lines.push("Held fixed: " + (sum.pinned.length > 0 ?
            sum.pinned.join(", ") : "nothing"));
    } else if (resolved.summary !== undefined &&
            resolved.summary.warning !== undefined) {
        lines.push("WARNING -- " + resolved.summary.warning);
    } else if (resolved.loops.length > 0) {
        lines.push("Not adjusted: the misclosure is still on the closing " +
            "leg, as surveyed.");
    }
```

`resolved.adjusted` is `undefined` for a plain `CsNetwork.resolve` result, which
falls into the last branch — a raw resolve with loops correctly reports itself as
unadjusted, and one without loops says nothing at all.

- [ ] **Step 4: Report the worst loop's components in `statsSummary`**

In `CsReport.statsSummary`, extend the worst-loop line:

```javascript
    if (stats.worstLoop !== null) {
        lines.push("Worst loop closure: " + stats.worstLoop.percent.toFixed(2) +
            "% (" + stats.worstLoop.from + " to " + stats.worstLoop.to +
            ", horizontal " + stats.worstLoop.horizontal.toFixed(2) +
            ", vertical " + stats.worstLoop.vertical.toFixed(2) + ")");
    }
```

- [ ] **Step 5: Run to verify green**

```bash
node tests/js_unit.js
```

Expected: `### UNIT OK <n> assertions`, n increased by 8.

- [ ] **Step 6: Commit**

```bash
git add scripts/CaveSurvey/Core/CsReport.js tests/js_unit.js
git commit -m "feat: report what the adjustment did, and split horizontal from vertical error"
```

---

### Task 9: Full verification and publish

**Goal:** Both engines green including the publish gate, and the suite published.

**Files:**
- Modify: `README.md` (feature list, if it enumerates tools/features)
- Modify: `scripts/CaveSurvey/CaveSurvey.js` or wherever the add-on version string lives

**Acceptance Criteria:**
- [ ] `./tests/run_all.sh --publish` passes
- [ ] the unit tests pass inside CaveCAD's own engine, not only node
- [ ] the version is bumped and the README mentions adjustment
- [ ] `tools/publish.sh` installs cleanly

**Verify:** `./tests/run_all.sh --publish` → `ALL TESTS PASSED -- including publish checks`

**Steps:**

- [ ] **Step 1: Both engines, publish gate on**

```bash
./tests/run_all.sh --publish
```

Expected: `ALL TESTS PASSED -- including publish checks`. If CaveCAD is absent the
runner falls back to node and says so — that is NOT sufficient here, since the
authoritative engine is the one the add-on ships into. Run it against
`/Applications/CaveCAD.app` before calling this done.

- [ ] **Step 2: Bump the version and note the feature**

Find the version string:

```bash
grep -rn "2\.[0-9]\+\.[0-9]\+" README.md scripts/CaveSurvey/CaveSurvey.js | head
```

Bump the minor version (this is a feature) and add a README line naming
least-squares loop closure adjustment, the `CTRL-RAW` ghost, and the two settings.

- [ ] **Step 3: Publish**

```bash
./tools/publish.sh
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: bump version for loop closure adjustment"
```

- [ ] **Step 5: GUI verification (manual, in CaveCAD)**

The suite's standing lesson is that headless green does not mean the GUI works —
`include()` basename dedupe and the edition-folder path both shipped as
"undefined in the GUI while every test passed". Check by hand, in this order:

1. Open a drawing with a loop, run SurveyNotebook → Draw. The report should state
   the adjustment, the moved-station count, and name `CTRL-RAW`.
2. Turn `CTRL-RAW` on. A grey dashed ghost should appear beside the drawn
   centerline, offset by the misclosure and closing nowhere.
3. Draw again. The ghost must be REPLACED, not doubled.
4. Trace a wall across two stations, then revise the declination. The wall must move
   with the survey and must not snap to a ghost point.
5. Open Survey Stats. The worst-loop line should still quote the AS-SURVEYED
   percentage, not 0.00%.

Report what you see rather than assuming; steps 1 and 5 are the two that would
silently look right while being wrong.

---

## Performance note recorded 2026-08-21: CG iteration count on chain-like networks

Task 2's solver measured 3,000 stations / 14 loops at 35ms with **2,038 iterations**, and
4,000 stations at 77ms. That iteration count is expected rather than alarming: conjugate
gradient on a graph Laplacian converges in roughly O(sqrt(condition number)) iterations,
and a cave network is chain-like — long passages with few cross-connections — which is
the worst-conditioned shape there is. Iterations therefore scale with passage length, and
per-iteration cost scales with station count, so wall time grows roughly quadratically.

Extrapolated, a 20,000-station system is on the order of seconds under node and worse
under QCAD's older non-JIT engine. Nobody has hit that yet and the in-suite bound (500ms
at 4,000) will catch a regression, so this is recorded, not scheduled.

**If it ever needs fixing, the right fix is not a better preconditioner — it is a
different formulation.** The network is a spanning tree plus k extra edges, and k is the
loop count. Solving in the cycle space makes the unknowns the k loop-flow corrections
rather than the 3n station coordinates: a dense k×k system, where k is tens even for a
large cave system, independent of station count. That is the classical loop-based network
adjustment, and it would turn seconds into microseconds. It is a rewrite of
`CsAdjust.adjust`'s core, not a tuning change, which is why it is a note here rather than
a task — the current solver is correct, and correct-and-fast-enough beats a rewrite
nobody needs yet.

---

## Self-review

**Spec coverage.** Section 1 (math) → Task 2. Section 2 (return shape, honesty rule)
→ Task 2. Section 3 (settings, persistence, CsRevise interaction) → Tasks 3 and 7.
Section 4 (ghost, CsBind hazard) → Tasks 4, 5, 6. Section 5 (ties, error components)
→ Task 1. Section 6 (files, tests) → spread across all, verified in Task 9. Nothing
in the spec is unimplemented.

**Out of scope, deliberately absent:** anisotropic covariance, B5 blunder
detection/reporting, `excludeFromLength` in `CsStats`, per-leg residuals surfaced in
the report, splay adjustment. `residuals` is computed in Task 2 but no task surfaces
it — that is the decision, not an omission.

**Type consistency.** `CsAdjust.adjust` / `CsAdjust.unadjusted` /
`CsAdjust.resolveAndAdjust` all return the same field set. `summary.rmsShift`
(not `totalCorrection`) is used in Task 2's code, Task 8's report, and the spec
after Task 1 Step 9 patches it. `resolved.raw` is set in Task 2, read in Task 5.
`resolved.ties` is created in Task 1, defaulted in Task 2's two return paths, read
in Task 8. `drawn.ghostDrawn` is produced in Task 5 and consumed in Task 8's test
fixture. `CsLayers.RAW` is defined in Task 4 and used in Tasks 5 and 6.

**Known soft spots, flagged rather than papered over.** Task 5 and Task 6 both
depend on local names inside large files (`offX`/`offY`, the point-drawing helper,
`CsBind`'s layer-name idiom, the trip-0 anchor entity variable). Each step says to
follow the file's existing convention rather than inventing a name, because those
call sites could not be quoted exactly without reading the surrounding function.
