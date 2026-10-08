# Incremental Notebook Draw

Date: 2026-09-04
Status: implemented and measured 2026-09-04

## The complaint

Adding one trip in the Survey Notebook and pressing Draw redraws the
ENTIRE cave. On a cave with any history that is slow, and the work is
almost all wasted: the other trips end up exactly where they already
were.

## Measured, not guessed

`tests/../scratch bench` (a synthetic cave, one chain, LRUD on every
station, headless so no repaint is included):

| cave | entities | Draw total | recon | positions | planAutoBind | erase | draw (of which profile) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 60 stations | 819 | 0.60 s | 19 | 14+19 | 35 | 50 | 463 (280) |
| 275 stations | 3663 | 2.10 s | 90 | 65+65 | 170 | 257 | 1450 (691) |
| 800 stations | 10551 | 6.35 s | 288 | 185+204 | 485 | 968 | 4208 (1989) |

Everything scales with the whole cave, not with the page. The GUI adds
repaint on top of these numbers.

## What is actually redrawn for no reason

When a page ADDS a trip that ties into the existing survey at one
station and closes no new loop, the merged solve puts every existing
station exactly where it already is. In that case the whole-cave work
is pure waste:

- erasing and redrawing every station, label, LRUD tick, splay and leg,
- `CsBind.planAutoBind` + `CsRevise.moveLinework`, which exist to carry
  hand-traced linework along when the survey MOVES,
- the second `CsRevise.stationPositions` pass, which exists to find out
  whether it moved,
- re-committing the geo anchor, which is only at risk because the erase
  deletes the point it rides on.

## The design

Draw keeps today's whole-cave path as the general case and gains a fast
path it takes only when it can prove the fast path is equivalent.

### The gate (in `SurveyNotebook.drawMergedSurvey`)

After the merged solve, before anything is erased:

1. Read the drawn positions (`CsRevise.stationPositions`) -- already
   done today for the linework frame.
2. Compare every EXISTING drawn station against its merged-solve
   position. Any station off by more than the linework tolerance
   (`CsRevise.positionsMoved`'s own epsilon, scaled to the survey's
   extent) means the survey moved: take the full path.
3. The page's own trip must be the only trip whose stations change,
   and the replaced trip's dropped stations must all belong to it.
4. Anything unexpected -- no anchor, a page that renamed the trip-0
   anchor, a legacy drawing -- takes the full path.

A `Redraw All` entry in the notebook's `...` menu forces the full path
on demand, which is also the reconciliation for the divergences below.

### The fast path

The suite already draws a page and nothing else: that is exactly what
the notebook's own no-reconstruction branch does today
(`eraseStations(pageNames)` then `CsDraw.survey(pageSurvey, ...)`). The
fast path reuses that shape, with two differences:

- the survey handed to `CsDraw.survey` carries the MERGED trip list, so
  the page's stations are tagged with their real trip id rather than 0,
- `resolved` is the merged solve FILTERED to the page's stations, so the
  page lands exactly where the whole-cave solve would have put it.

`CsDraw.survey` gains an options bag for this:

    CsDraw.survey(survey, resolved, originStation, originPos, seqBase,
                  {partial: true, profileSurvey: merged,
                   profileResolved: resolved})

`partial` means "this draw covers part of a drawing that already holds
the rest", and it changes exactly three things:

- the legacy drawing-level mirror (`SurveyName`/`SurveyDate`/
  `Declination`, the `ExcludedShots`/`UnplacedShots` blobs) is written
  ONLY when this draw actually contains trip 0's anchor. Without this
  the page's first station would claim to be the drawing's trip-0
  anchor and the reconstruction would find two.
- the profile is built from `profileSurvey`/`profileResolved` (the whole
  merged cave) rather than from the page, because the extended
  elevation is a whole-cave product and rebuilding it from one page
  would erase the other bands.
- nothing else. The geometry loop, the tags, the wall runs and the
  undo step are unchanged.

### Divergences, accepted and documented

A partial draw is not byte-identical to a full redraw:

- a wall run that used to pass THROUGH the tie-in station is left whole,
  where a full redraw would split it there (a new branch makes that
  station a junction). Same points, one polyline instead of two.
- the tie-in station's own LRUD tick keeps the azimuth it was drawn
  with, rather than being re-oriented by the new leg.

Both are cosmetic, both are stable, and `Redraw All` reconciles them.
They are the price of not redrawing a cave to add fifteen shots to it.

## Tests

- `tests/js_unit.js`: the gate's pure half -- which stations a merged
  solve moves, and the resolved-subset filter.
- `tests/edit_trip_run.js`'s sibling, a new engine stage: draw a
  multi-trip fixture, add a trip through the fast path, and assert the
  drawing reconstructs to the SAME survey as the same page drawn
  through the full path -- same trips, same shots, same station
  positions, same trip ids -- and that a page which moves the survey
  refuses the fast path.

## What it measured, once built

Same page, same fixture, both paths (headless, `bench_partial.js`):

| cave | full Draw | incremental Draw |
| --- | --- | --- |
| 60 stations | 624 ms | 459 ms (26% faster) |
| 275 stations | 2213 ms | 1447 ms (35% faster) |
| 800 stations | 6394 ms | 4007 ms (37% faster) |

In the GUI, on a clean single-tab A/B over an 80-station cave: full
34.8 s, incremental 23.5 s (32% faster).

## Where the rest of the time goes -- measured, not fixed

The GUI is 20-100x slower than headless for the SAME draw, and the
profile is most of it. On a clean 24-station drawing:

- first draw 11.1 s, of which `CsDraw.profile` 7.2 s. The cold cost is
  layer creation: 53 profile run-variant layers, one
  `applyOperation` each, each one a layer-list refresh and a view
  regeneration in the GUI.
- redraw of the same survey (layers already there) 3.3 s, of which
  `CsProfileDraw.render` 2.0 s and its `erase` 0.9 s.

The same work headless is ~0.15 s. So the remaining lever is not the
plan geometry -- it is the extended elevation, which is rebuilt whole on
every Draw.

Batching the layer visibility toggles (`CsLayers.withLayersOn`, now used
by `CsProfileDraw.withOwnLayersOn`, `CsRevise.withOffLayersOn` and
`CsBind`) turns ~87 toggle operations per render into two. It measured
no change on this fixture -- the cost is in the entity churn, not the
toggles -- but it is strictly fewer transactions per redraw, and fewer
undo entries, so it stays.

### The next step, deliberately not taken today

Render the profile per BAND: erase and redraw only the bands whose runs
changed, keyed on the `ProfileRun` tag every profile entity already
carries. It is gated on the region origin being unchanged
(`CsProfileDraw.computeOrigin` moves the whole region when the plan's
extents grow) and needs its own answer for `CsProfileBind`'s linework
following. That is a feature in its own right, with its own equivalence
test, and it should not ride along on this one.
