# Legacy maps, and the confidence ladder

Inherited mapping projects: scanned finished maps that carry their own
scale bar and north arrow, and field sketches that carry nothing at all.
The suite has never had a place for either, because every tool in it
presumes the map was derived from measurements.

The answer is not a "legacy" flag. It is a **ladder** that a piece of
passage climbs as evidence arrives, and everything the suite says about
that passage keys off which rung it is on.

## The ladder

| Rung | Means | Scale and position come from |
| --- | --- | --- |
| `TRACED` | ink traced off an old map or sketch | the source's own evidence: its scale bar, one stated distance, several scribbled distances, or nothing |
| `TIED` | the same ink, anchored to the real world | two or more known points (GPS'd entrances, features on an aerial) fixing scale, rotation and position |
| `SURVEYED` | measured passage | the survey |

`SUPERSEDED` is **not a rung**. It is a retirement flag: traced ink that
measured survey has replaced. A `TRACED` line and a `TIED` line can each
be superseded, and superseding is not promotion.

Promotion is an operation, not a re-import. When two GPS'd points arrive
for a cave whose map was traced years ago, the source is re-fitted onto
them and everything pointing at it climbs from `TRACED` to `TIED` in one
edit. `SURVEYED` is not reached by promotion: measured survey is new ink
that supersedes the old, piece by piece, over the years a resurvey
actually takes.

## Where a rung lives

**On the scan.** A legacy source IS a scanned map or sketch, and that
scan is already an entity the suite places, tracks and browses. The
source record rides on the scan image entity as XDATA: its rung, the
evidence that calibrated it, who drew the original and when, and a short
id. Traced entities carry only a `SourceId`.

This follows the pattern the drawing already uses for document-level
facts -- `ProfileBox` on the band rectangle, `GeoLat`/`GeoLon` on the
anchor station. `CsStore` is the dead path, not the pattern (its own
header says so).

**The default costs nothing.** No source tag plus a station binding
means `SURVEYED`. Every drawing that exists today is already correct
under this scheme: no migration, no upgrade pass, and the thirty-odd
caves on the shelf do not change meaning the day this ships.

### The override rule

An entity with no rung tag inherits its source's rung. An override
writes **both a rung and a reason**, never one without the other, and
Check Map grows a row listing every entity whose rung disagrees with its
source's. That is what keeps "two places to look" enumerable rather than
silent -- the failure mode of any inherit-with-override scheme is a
value nobody can explain, and a required reason is the cheapest
prevention.

## Calibration evidence

What scaled a source is recorded, not just the resulting number,
because the number's worth is entirely the evidence behind it.

| Evidence | What the caver does | What it fixes |
| --- | --- | --- |
| `scalebar` | picks the two ends of the printed bar, types what it says | scale |
| `distance` | picks two points, types one real distance | scale |
| `distances` | several stated distances at once | scale, plus the disagreement between them -- reported, never averaged away silently |
| `points` | two or more real-world points | scale, rotation and position (this is what makes a source `TIED`) |
| `none` | nothing | nothing. The source is `TRACED` and **unscaled** |

North comes separately: picked off the map's own north arrow, or
declared as up the page, or -- for a `TIED` source -- implied by the
points.

**An unscaled source is a first-class outcome, not a failure.** Some
sketches have no honest scale and never will. They come in as drawn
shapes claiming no scale, every tool refuses to report a length for
them, and a sheet built from one says NOT TO SCALE rather than printing
a bar that lies.

## Scope

Three projects. This spec is project 1.

1. **Calibrate and trace.** Place the scan, calibrate it by whatever
   evidence exists, record the source, and tag traced ink with it.
   Delivers the resurvey base and the archive.
2. **The tools tell the truth.** Survey Stats, the title block, Check
   Map, Build Legend and Sheet Setup learn what a rung means: estimates
   rather than measurements, no UIS grade for traced passage, provenance
   in place of a surveyed length, NOT TO SCALE where that is honest.
   Unbuildable until 1 exists.
3. **The GPS tie.** Promotion from `TRACED` to `TIED`. Deferred until
   the coordinates exist.

Supersession tracking -- marking stretches replaced, and reporting "62%
of the 1987 map has been resurveyed" -- belongs to project 2, because it
is a thing a tool SAYS.

## Architecture

| File | Job | Pure? |
| --- | --- | --- |
| `Core/CsProvenance.js` | the ladder: the rungs, what each permits, inherit-and-override, what may be claimed about each | yes |
| `Core/CsCalibrate.js` | scale and north from evidence; the disagreement between several stated distances | yes |
| `Core/CsSource.js` | source records on the scan entity; the active source; promotion | no -- document |
| `LegacyMap/` | the tool: place a scan, calibrate it, make the source | no |

Tracing itself is unchanged. Feature Trace, the Symbol Palette and Area
Fill already route by WHERE a stroke lands; they gain one thing -- a
stroke over a legacy scan is stamped with that scan's `SourceId`. That
keeps the muscle memory and adds no second tracing path. A second
Feature Trace is exactly the drift that moving `CsShapeLine.dress` into
Core was meant to prevent.

## What this must never do

Fabricate a survey. A tempting third option was to synthesise stations
along a traced centreline so the existing tools would run unchanged.
Those stations would carry XDATA indistinguishable from measured ones,
and in five years nobody could tell which cave had been surveyed. The
same discipline as the elevation-datum family of bugs this suite has
closed five doors on: a value that LOOKS like a measurement and is not
is worse than no value.

## Tests

`CsProvenance` and `CsCalibrate` are pure and belong to
`tests/js_unit.js`: the ladder's rules, the inherit-and-override
resolution, the refusal to claim a length for an unscaled source, and
the calibration arithmetic including the disagreement report.

`CsSource` needs a real document and belongs to a
`tests/legacy_map_run.js`, following `tests/sketch_import_run.js`.

Every new Core file goes in **both** `Core/CsAll.js` and the list in
`tests/js_unit.js` (or its `CORE_FILES_NOT_LOADED` with the reason) --
`tests/test_addon.py` enforces both directions.
