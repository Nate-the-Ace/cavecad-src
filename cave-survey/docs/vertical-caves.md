# Vertical caves — what was wrong, what is fixed, what is left

Started 2026-09-20, after an audit asking a question the suite had never
been asked: *does any of this work in a cave that is mostly air?*

The short answer was no, and the reason was not a missing feature. It
was that **every geometry rule in the Core that asks "which way does the
passage run here" answers from a bearing, and on a pitch there is no
bearing.** The needle is noise, the caver is hanging on a rope, and the
compass column of the notes holds a dash or a formality.

None of it threw. `cos(90 degrees)` is 6.1e-17 rather than 0, `atan2` of
two rounding errors is a confident bearing of due north, and a plan
projection of zero divides fine and prints fine. It flowed downstream,
got drawn, and looked like a map. Seven thousand assertions over a
horizontal fixture never asked.

Pit caves are not a niche. Most long horizontal caves have vertical in
them, and every one of the bugs below fires the first time a drawing
contains a rope.

## The fixtures

`testdata/PlumblinePit.*` — 380 ft deep in 148 ft of plan extent, four
pitches, an aven, a shaft that is nearly a duplicate of its neighbour,
and a control tie whose misclosure is almost entirely vertical. 22
numbered pitfalls, inventoried in `PlumblinePit_MANIFEST.md`.

It does not replace Pitfall Cave. Pitfall is 2400 ft of horizontal
passage carrying the parser, validator and network traps; this is the
one that carries the traps only a pitch can spring. The two fail for
different reasons and are audited separately, so a run says which kind
of cave broke.

**`testdata/StairstepCave.*`** — the mixed one, added when the per-piece
layout rule made "which kind of cave is this" a question nothing asks.
4138 ft long, 246 ft deep, 655 ft across: a vertical entrance series
into a long wandering upper level, a staircase of four small drops down
to a lower streamway wandering the other way *directly beneath it in
plan*, and an aven closing a loop that runs down a pitch and back up.
Ten numbered traps in its manifest.

Its point is the boundary. Pitfall's trunk folds by 0.42 and Plumbline's
pieces by under 0.01 — nothing was ever near `CsChunk.FOLD_LIMIT`.
Stairstep's upper trunk folds **0.25** and unrolls; its lower streamway
folds **0.23** and stays projected. Two pieces of the same kind of
passage, either side of the line, in one drawing. If that pair looks
wrong side by side, the number is wrong and this is the cave that says
so.

Three test stages, all pure ECMAScript, all in `tests/run_all.sh`:

| Stage | File | Asks |
|---|---|---|
| 22 | `tests/plumbline_audit.js` | does each of the 22 documented pitfalls still behave? |
| 23 | `tests/plumbline_pipeline.js` | does every pass in the Core return finite geometry over Plumbline AND Stairstep? |
| (in 3) | `tests/js_unit.js`, `plumbline-draw` | does the whole fixture DRAW into a real document? |

Regenerate with `node tools/make_pit_cave.js` and
`node tools/make_mixed_cave.js`. It verifies
its own output and rewrites the manifest's measured numbers, so the
manifest cannot drift from the files it describes.

## Fixed

**A pitch has no plan bearing, and nothing may invent one.**

- `CsLrud.planBearing` refused only an *exact* coincidence, which a
  plumb leg never is. Every pitch grew a way out at both ends: a pit
  foot with one passage read as a THROUGH station and took its passage
  axis from the bisector of the real passage and a rounding error; a
  shaft with two leads read as a JUNCTION and broke its wall runs
  there. Now anything under `CsLrud.COINCIDENT_PLAN` has no bearing.
- `CsModel.lrudForStation` passed the arriving shot's compass column on
  as the bearing the L and R tapes were pulled across. It hands on
  `null` now, and `CsLrud.tickAzimuth` / `tickAzimuthAt` is the one rule
  for which bearing a tick is drawn along: the sighted one, else the
  passage's own direction, else — for a blind shaft, where the only leg
  touching the station is plumb — the direction of the passage at the
  other end of the rope. Failing all three, no tick, never a north one.
- `CsSectionCut` oriented a section due north when the arriving leg gave
  it nothing, and a reader could not tell that from a section that
  really faces north.
- A bearing OMITTED in the file is now carried as `Shot.azimuthOmitted`
  and written back out as a dash. The same omission on a leg that is not
  plumb is still refused — Survex refuses it too, and at 85 degrees a
  100 ft tape still swings 8.7 ft across the map — but the refusal is
  reported instead of a bare `continue` that took the rest of the cave
  with it. The CSV reader had the same hole and a worse one:
  `parseFloat(cell) || 0` could not tell a blank azimuth from a real
  bearing of north, on any leg.
- `CsTraverse.PLUMB_DEG` is the one definition of "this is a pitch".
  `CsValidate` and `CsProfile` had each arrived at 85 and documented
  that they agreed; the near-plumb warning's comparison moved to `>=` so
  the boundary angle falls on the same side of the line in the warning a
  caver reads and in the geometry that acts on it.
- `CsTraverse.offset` in HORIZONTAL tape mode returned `Infinity` on a
  plumb. A held-level tape cannot measure one; it refuses.

**A drawing reconstructed from its own tags came back flat.**

`CsTags.surveyFromDocument` read each leg's distance as the *plan*
distance between two station points and its inclination from an
`Inclination` tag that nothing in this suite has ever written. Every
reconstructed leg came back level, with the tape reading its own
horizontal projection — a fraction of a percent in a horizontal cave,
the whole cave in a vertical one. The elevations were on the drawing the
entire time: dz is a subtraction, the tape is the hypotenuse.
`CsRebuild.toSlopeDistances` skips what the reader already resolved
rather than dividing by cos twice, and its report says which of the two
inferences it used.

**Two more, found on the way and not vertical-specific:**

- `CsModel.ensureTrips` mirrored trip 0's fields down over the survey's,
  erasing a `startLrud` set after the trips existed — silently, on the
  next `ensureTrips`, which is the first thing every writer calls. No
  shot arrives at the first station, so that is the only place its walls
  live: a sinkhole rim or a pitch head exported with no width at all.
- `CsAdjust` modelled a plumbed pitch as horizontally uncertain by
  `distance * sigmaAngle`, exactly like a level passage, so a 187 ft
  free-fall was by a distance the softest leg in any loop it belonged to
  and the adjustment poured the misclosure into it — a rope leaning
  across the map, which on a pit map is the one line a reader knows the
  true attitude of without being told. A plumbed leg's direction came
  off gravity, not a compass: `CsAdjust.PLUMB_SIGMA_ANGLE_DEG`. Still
  one scalar sigma per leg; the scalar now depends on which instrument
  produced the leg's direction, and the data says which.

## The drawing side

Findings from the same audit about what a pit map LOOKS like rather than
whether the geometry is honest.

### Done

**Rigging symbology** (0.9.166–0.9.168). Eight shipped symbols in a
`Rigging` category — bolt, Y-hang, rebelay, deviation, natural anchor,
rope, cable ladder, traverse line — all on `ANCHORS-BOLTS`, the cyan
rigging layer `CsLayers` had reserved since the palette was written with
nothing ever drawing on it. Geometry lives in
`tools/make_rigging_symbols.js` and is re-runnable. Provenance is stated
in `CsSymbols.js`: Therion defines equipment symbols once, in the Slovak
SKBB set, and UIS/NSS have none of their own. Three of the eight agree
with SKBB; the bolt and the rebelay/deviation pair diverge for reasons
written down there. A caver adds their own through **New Symbol...**
under the same category, and `symbol_palette_run` pins that both derived
lists — the category picker and the home-layer picker — still offer it.

**Pitch-depth labels** (0.9.169). `Core/CsPitch.js` finds every pitch
and aven; `CsDraw.survey` labels them where they hang from, as generated
callouts on `NOTES-ANNOTATION`, keyed to the top station so a redraw
takes them with it. A rebelayed drop is ONE pitch — "P 187 ft (62 +
125)", because that is what a caver calls it — and a passage leading off
the rebelay ledge does not split it. An aven is decided by whether
anything carries on at the top, not by which end the tape started at.
Under 10 ft gets no label. Off with `CaveSurvey/PitchLabels`.

**A projected elevation** (0.9.171). `Core/CsProject.js` flattens the
cave's real coordinates onto one chosen vertical plane and returns it
in `CsProfile.build`'s own shape — one band, shaped exactly as
`unrollBand` shapes a run — so `CsProfileDraw` never learns there are
two kinds and the whole frame, erase, binding, box and pitch-label
plumbing is shared. The alternative was a fourth layer frame with its
own erase, binding rules and tag namespace, all to be kept in step
with the profile's by hand.

The default plane is the cave's first principal axis in plan: the
direction it is longest along, which is the plane that throws away
least. A cave with no horizontal extent has none, and says so rather
than fitting an axis to `cos(90)`'s rounding error. An axis is a line,
so 040 and 220 are one answer. The caption names the plane and says
when it was chosen for the caver rather than by them.

A projection draws **every** station and every leg — there is no chain
to pick and nothing to demote — so loops close on the page as they
close in the cave, and every pitch is labelled, including the ones
band-splitting silences in the extended view. Generate Profile asks
which kind and remembers the answer.

**A chunked elevation** (0.9.173). The cave cut into pieces at its
pitches and arranged. `Core/CsChunk.js` splits it — a drop is one
chunk, rebelays included; a passage chunk is a connected piece of
what is left once the pitch legs are taken out of the graph, which is
exactly "the cave you can walk around without rigging". Each piece is
projected onto its *own* plane, which is a freedom the whole-cave
projection does not have and is most of why the pieces read better
than the whole.

Both whole-cave modes pay for their one rule somewhere: extended
displaces its bands off true depth, projected draws things on top of
each other because underground they are. Chunks pay neither.
**Depth is locked** — a chunk slides sideways and never up or down —
so any two depths on the sheet compare by eye. Dotted ties join the
stations two pieces share.

The layout measures a chunk's *drawn* extent, walls included, not its
centreline: Plumbline's entrance drop is a rope with a bell chamber at
the bottom, so its centreline has no width and its splay ring fans 25
ft either side. The first version laid out on centrelines and put the
next piece straight through the chamber — caught by rendering it, and
by nothing else.

A caver's arrangement survives a redraw: each chunk's position is
written onto its own caption (`ProfileChunkOffset`) and read back
before the next draw. Written for every chunk, not only the moved
ones, or a redraw between two drags reflows the pieces that had not
moved.

**Per-piece layout** (0.9.175). The chunked elevation no longer draws
every piece the same way. Each is measured — `CsChunk.foldOf` sums a
piece's along-plane steps and compares them with the span it actually
occupies — and a piece that folds back behind itself past
`CsChunk.FOLD_LIMIT` is unrolled instead of projected. Pitfall's trunk
walks 1424 ft along its plane in 825 ft of page and unrolls; every
piece of Plumbline folds by ≤0.01 and stays projected. Same engine,
opposite answers, nothing declared.

Unrolling needs one path through a piece, so `CsChunk.refine` carves
the branches it cannot carry into their own chunks, tied at the
junction they leave, and repeats until the split is stable. On Pitfall
that turns 7 chunks into 12 and keeps every drawn station on the page.
**A mixed cave is the normal case**, and this is what makes it the
default one.

### Looked at and left

**The extended elevation collapses on a pitch** — its X axis advances
by plan distance, so a plumb advances it by nothing and a run that is
all pitch is a band with no width. Chased, measured, and largely
answered by the two features above rather than by changing it:

- it is *correct*. A rope travels no distance along the passage, and
  drawing it as a vertical line is what an extended elevation means.
- a bare vertical line is now legible, because the pitch label sits
  beside it.
- the frame does not collapse with the band: the caption gives the box
  its width. That was a side effect nobody had written down; it is
  pinned now in `profile_draw_roundtrip`.
- the projected elevation has no bands at all, so for a cave where this
  actually hurts, the answer is to draw the other kind.

What remains is that `CsProfile.layout` displaces a band that merely
*touches* another in elevation. That edge is deliberate, documented and
fuzzed over 20,000 surveys in `CsProfile.GUTTER_MIN`'s own docblock —
"just barely touches" and "just barely clears" are different physical
facts — so it is not a vertical bug and was left alone.

An all-pitch band is now exercised rather than theoretical: it had
never been, because every band in every fixture the suite had contained
some horizontal passage.

### Open

1. **Chunks cannot be dragged from the GUI yet.** The position is
   read, honoured and persisted, and `CsProfileDraw` writes it — but
   nothing yet notices a caver moving a chunk's geometry and updates
   the tag. Today the offsets can only be set by a caller. That is the
   next piece of this feature and it is a listener, not a redesign.

2. **The plan view has no way to show two levels.** A4 sits directly
   above A5 in the fixture, 125 ft apart. Nothing cues depth: no
   depth-graded rendering, no per-level plan insets, no "this passage is
   under that one" convention.

3. **`CsAdjust` is still isotropic.** Weighting a declared plumb by
   gravity rather than by a compass is a real improvement and is not the
   whole answer: a leg's vertical and horizontal variances genuinely
   differ, and the header rules anisotropic covariance out by decision.
   Worth revisiting now that there is a fixture that can measure it.
   **Left deliberately.** The header rules it out by an explicit
   decision, and overturning a documented architectural decision is not
   something to do unsupervised — the gravity weighting was a change
   *within* the existing "one scalar sigma per leg" rule, which is why
   it was fair game and this is not.
