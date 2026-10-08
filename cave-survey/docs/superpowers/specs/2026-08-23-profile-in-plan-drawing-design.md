# The Elevation Moves Into the Plan Drawing — Design

Date: 2026-08-23
Status: approved design, not yet implemented
Supersedes the destination decision in
`2026-08-23-extended-elevation-design.md` §2. Everything that spec says about
the elevation's GEOMETRY — bands per survey run, tie stations, floor and ceiling
from U/D plus splays outside a dead zone, monotone X — stands unchanged.

## 1. Why this changes

The extended elevation shipped into a sibling `<cave>-PROFILE.dxf`. That file
carries only names and positions: its writer emits no `Distance`, `Azimuth` or
`Inclination` at all. So opening a profile and asking the Survey Notebook to
load it answers "No survey shots found in this drawing -- nothing to load," and
it is telling the truth. The profile is a rendering, not a survey.

That is the wrong shape for how the work actually goes. A surveyor wants to
open the drawing, change a number, and see both views follow.

Putting both views in ONE drawing fixes it at the root rather than papering
over it: the survey model already lives in the plan's own entity tags, so there
is one model, the Notebook already reads it, and a redraw updates both views in
one undo step. There is no second file to keep in sync because there is no
second file.

**The constraint that shapes everything else:** an elevation cannot represent
azimuth. Its X is distance along the passage and its Y is elevation. Distance,
inclination, U and D are recoverable from profile geometry; bearing never is.
So the plan frame owns the horizontal truth, permanently.

## 2. User decisions

- Segregate the two views by a COMPLETE dedicated layer set, so either view can
  be worked on by targeting its layers.
- `RebuildSurveyData` ignores profile layers.
- Linework binding only touches the layers belonging to its own view.
- The profile origin is RECOMPUTED below the plan's extents on each draw, so the
  elevation always sits tidily under the current plan.
- The sibling file is replaced entirely; `CsProfileFile.js` goes.
- Vertical exaggeration stays, and stamps the region when it is not 1.0.
- Geometric write-back (drag a ceiling line, change the data) is a FOLLOW-ON
  spec, not part of this.
- No migration path is needed: nothing uses this software productively until a
  full publish release is declared.

## 3. The mechanism: one frame test

`CsLayers.frameOf(layerName)` returns `"plan"`, `"profile"` or `"sheet"`, and is
the ONLY place that knows which view a layer belongs to. Every consumer asks it.

This exists as one function rather than a prefix check scattered across four
files because those four files are shipped plan-view code, and a second spelling
of "is this profile?" is how they start disagreeing. The layer registry is
already the single place layer names live and is already pinned to the templates
by a structural test; the frame test belongs beside it.

`"sheet"` is not a fudge: `BORDER`, `TITLE-BLOCK`, `LEGEND`, `SCALE-BAR`, `0`
and `Defpoints` genuinely belong to both views, because one drawing prints as one
sheet. A plan and an elevation on one sheet is ordinary cave cartography.

## 4. The layer set

Today: 22 layer names are shared between the two templates, 27 are plan-only,
10 are profile-only. Every one of the 22 is a collision in a single drawing.

Two naming rules. The first is load-bearing, not cosmetic:

**Generated previsualization keeps a leading `CTRL-`.** `CTRL-PROFILE-SHOTS`,
`CTRL-PROFILE-STATIONS`, `CTRL-PROFILE-STATION-LABELS`, `CTRL-PROFILE-SPLAYS`,
`CTRL-PROFILE-LRUD`, joining the existing `CTRL-PROFILE-FLOOR` and
`CTRL-PROFILE-CEILING`. `CsBind.NEVER_LINEWORK_PREFIXES` already refuses
`CTRL-`, so generated profile geometry stays ineligible for binding and moving
with no new code. Break this rule and the generator's own output becomes
bindable.

**Traceable layers must NOT start with `CTRL-`.** `PROFILE-CEILING`,
`PROFILE-FLOOR` and `PROFILE-WALLS-INFERRED` already exist; the rest of what a
caver draws on an elevation gets `PROFILE-` twins.

The profile template's layer set migrates into the plan template, and the
structural test pinning the registry to the templates extends to cover the
profile frame.

`NSS_Cave_Template_PROFILE.dxf` itself is KEPT, not deleted. Two reasons: a
structural test asserts both templates are present, and the file remains a valid
standalone elevation sheet if the deliberate one-way export in §9 is ever wanted.
It simply stops being poured into a new document by this feature. Renaming its
layers to the profile frame is still required, so that a drawing started from it
does not carry plan-frame layer names.

## 5. The four consumers that become frame-aware

**`CsBind` — the real work.** It builds its station index per frame and binds an
entity only within the frame its own layer belongs to. Without this, two
coordinate frames share one model space and `stationsInBox`/`marginFor` will
bind a line traced on the elevation to whatever plan station happens to sit
nearby in absolute coordinates. `isLineworkLayer` is already a layer-name gate,
so this extends the shape that is there rather than fighting it.

**`RebuildSurveyData` — nearly free, but assert it.** Its scans already compare
layer ids (`lid === stLayer`, `lid === lbLayer`), so once profile stations live
on `CTRL-PROFILE-STATIONS` they never match and are ignored. That is a
consequence of the rename, not a change — which is exactly why it needs a test
naming it, or a later refactor will quietly reintroduce the collision. Its
label-reading path matters most: profile labels carry the same station names at
entirely different coordinates.

**`CsDraw.eraseStations` — already safe, assert it.** It keys on `Station`,
`LRUDName` and `SplayName`; profile geometry carries the `Profile*` namespace.

**AlignImage and any morph or warp tool — restrict to plan-frame layers.** This
is the same mechanism answering the objection that killed same-drawing before:
warping a plan to fit an aerial photo is meaningless applied to an elevation, and
a tag cannot stop a transform. A frame-scoped selection can.

## 6. Region placement and translation

The origin sits below the plan's extents, recomputed on each draw, and the
previous origin is stored on the drawing — the only new persistent state.

When the origin moves, the delta translates EVERYTHING on profile-frame layers,
generated and hand-drawn alike, inside the same undo step as the redraw. This is
what makes a recomputed origin safe: a survey extended southward moves the
region, and a sketch that did not move with it would detach from the geometry it
described.

Note what this is NOT: it is not the per-entity similarity fit that
`CsRevise.moveLinework` performs across files. It is one vector applied to a
frame-scoped selection — no fitting, no residuals, no refusals. The layer
segregation is what reduces it to that.

## 7. Exaggeration

`CaveSurvey/ProfileVerticalExaggeration` keeps its current behaviour and default
of 1.0. Whenever it is not 1.0, the region carries a stamped caption —
`VERTICAL EXAGGERATION 2x -- NOT TO SHEET SCALE` — on a profile-frame text
layer. One drawing has one scale bar, and an unlabelled exaggerated elevation
beside a 1:1 plan is a measuring trap.

## 8. What gets deleted

`CsProfileFile.js` entirely: off-screen document construction, the
garbage-sibling check, the self-target guard, the reveal policy, and the
open-tab branch that no test has ever executed because `getMdiArea()` is null
headlessly. With it go `tests/profile_file_roundtrip.js` and its `run_all.sh`
stage, and the sibling-path handling inside `CsDraw.profileNow`.

This design is net LESS code than what shipped.

## 9. What this deliberately does not do

- **Geometric write-back.** Dragging a ceiling point does not change `U`. That
  is a follow-on spec, because deciding which drag means which field deserves
  its own attention.
- **Editing azimuth in the elevation.** Not a scoping choice; it is not
  representable there.
- **A separate profile sheet at its own scale.** Replaced entirely was chosen
  over keeping an export command. If that need appears, it returns as a
  deliberate one-way export, never as a file read back in.

## 10. Testing

- **Frame-crossing is the risk.** Fixtures place plan and profile stations at
  deliberately OVERLAPPING absolute coordinates and prove a traced line binds
  only within its own frame, in both directions.
- **A regression floor.** For a drawing with no profile at all, plan-view output
  must be byte-identical to today: every station coordinate, every closure,
  every wall run. Any difference is a regression, not an improvement.
- **The rename must be asserted, not assumed** — `RebuildSurveyData` ignoring
  profile stations is a consequence of layer naming and needs a test that fails
  if the names converge again.
- **Origin translation** carries its own test: sketch, extend the survey
  southward, redraw, and assert the sketch moved by exactly the origin delta and
  still sits where it did relative to the geometry it described.
- Standing conventions from the elevation work apply unchanged: a rising
  assertion count is not coverage (delete the behaviour, confirm a NAMED test
  fails, report which mutation each test kills); mutation-test `CsDraw`,
  `CsReport` and the tools under CaveCAD, which node never loads; no bundled
  assertion with substring matching; off layers refuse adds, deletes AND
  modifies; comparators must be total orders because this engine's sort is
  unstable.
