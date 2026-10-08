# What survives each interchange format

Measured, not asserted. Reproduce with:

```
node tools/format_fidelity.js            the table
node tools/format_fidelity.js --detail   plus an example of every difference
```

The subject is PITFALL CAVE (`tools/make_test_cave.js`): 141 shots, 65 of
them splays, 71 stations, four trips — two sharing a date and differing
only in team — two loops, two fixed stations, a duplicated disagreeing
leg, a surface leg, a leg held fixed against adjustment, a struck-out
leg, and per-shot declination that changes mid-trip. The baseline is the
generator's own `CsModel` survey, with no file in the middle: a baseline
read back from a file would already have lost whatever that format
cannot say, and every other format would then score against a
handicapped original.

## The short answer

| | Compass `.dat` | Walls `.srv` | Survex `.svx` | Therion `.th` | CSV |
|---|---|---|---|---|---|
| Geometry (every shot, to 0.01) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Station positions after re-resolving | ⚠ entrance drops to 0 | ✅ | ✅ | ✅ | ✅ |
| Splays | ✅ 65 | ✅ 65 | ✅ 65 | ✅ 65 | ✅ 65 |
| Trips (all four) | ✅ | ❌ 1 | ✅ | ✅ | ❌ 1 |
| Trip dates | ✅ | ❌ 1 of 4 | ✅ | ✅ | ❌ 1 of 4 |
| Trip teams | ✅ | ❌ none | ✅ | ✅ | ❌ 1 of 4 |
| Fixed station control | ❌ none | ✅ | ✅ | ✅ | ✅ |
| Cave name | ✅ | ❌ | ❌ | ✅ | ❌ |
| LRUD | ⚠ per station | ✅ | ⚠ per station | ✅ | ⚠ one case |
| LRUD all-readings (`5/10`) | ❌ | ❌ | ❌ | ❌ | ✅ |
| Duplicate / surface flags | ✅ | ❌ | ✅ | ✅ | ❌ |
| Held-fixed flag (`#\|C#`) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Struck-out shot (`#\|X#`) | ✅ | ✅ | ❌ dropped | ❌ dropped | ✅ |
| Per-shot declination | ✅ | ⚠ 5 shots | ✅ | ✅ | ❌ |
| Shot order (notebook rows) | ❌ regrouped | ✅ | ❌ regrouped | ✅ | ✅ |

**Therion `.th` is the highest-fidelity export**, and the only one that
keeps trips, teams, the cave name, per-leg LRUD and the notebook's own
row order together. **Compass `.dat` is the only one that keeps every
flag**, and the only one that loses the elevation datum. **CSV keeps the
geometry perfectly** (worst station movement 0.0000 ft) and little else.

## What every format keeps

The cave itself. In all five, all 141 shots come back with their tape,
azimuth, inclination, backsights and splay status intact to the two
decimal places the writers round to, all 71 stations resolve, and all
five loops are still found. The worst any station moves is **0.0052 ft**
— accumulated rounding, not a lost measurement — except for the Compass
datum case below.

So: for handing a colleague the *shape of the cave*, every format works.
The differences are all in what surrounds the shape.

## Per-format detail

### Compass `.dat` — loses the elevation datum

Compass has no fix directive. Both fixed stations are dropped, and
because the entrance's control carried its elevation (812.40 ft), the
re-read survey rebases the whole cave to zero: **A1 moves 812.400 ft
vertically**. Horizontally nothing moves.

This is the elevation-datum trap in its interchange form. A `.dat`
handed to someone else describes a cave at the right shape and the wrong
height, and nothing in the file says so. If absolute elevations matter,
send Survex, Therion or Walls.

LRUD is stored per station, so two shots arriving at one station share
one reading and the second shot's own numbers are gone (19 values here).
Everything else — four trips, their dates, teams, every flag including
the held-fixed and struck-out ones, per-shot declination — survives.
Shots are regrouped into per-trip blocks, so notebook row order is lost.

### Walls `.srv` — one trip, no teams

Walls has no per-trip header in the subset this suite writes, so all
four trips collapse into one, every team is lost, and only the first
date survives. Flags (duplicate, surface, held-fixed) have no
representation and are dropped, and five shots lose the declination they
were individually read under.

Keeps: geometry, splays, both fixed stations, LRUD per leg, and the
original shot order.

### Survex `.svx` — loses the struck-out shot and the cave name

The one shot flagged "ignore entirely" (`B23→B23X`, `#|X#` in Compass)
has no Survex representation and is written as a comment — so it does
not come back. 141 shots go out, 140 return. That is a deliberate choice
in `CsFormatSurvex.write`, and the better of the two available: written
as an ordinary leg it would come back as *real survey*, adding a station
the surveyor struck out.

The cave name goes out as a `;` comment and is not read back. LRUD is
per station, as in Compass (18 values collapse). The held-fixed flag has
no equivalent. Shots are regrouped into per-trip blocks.

Keeps: all four trips with dates and teams, both fixed stations,
duplicate and surface flags, per-shot declination.

### Therion `.th` — the closest to lossless

Loses exactly two things, both because the format cannot say them: the
struck-out shot (written as a comment, same reasoning as Survex) and the
held-fixed flag.

Keeps everything else, including the things every other format drops
somewhere: four trips with dates and teams, the cave name (via
`-title`), per-leg LRUD with no collapse, both fixed stations, per-shot
declination, and the survey's own shot order.

### CSV — perfect geometry, no context

Station positions come back **exactly** (worst movement 0.0000 ft),
which no other format manages. Everything around them is thin: one trip
instead of four, one date, one team, no cave name, and no per-shot
declination at all — the azimuths are true bearings either way, so the
map is right, but the record of what each leg was read under is gone.

One thing CSV alone keeps: the several readings behind a `5/10` LRUD
entry (`leftAll` and its siblings). Its notebook shorthand is the only
column in any supported format with room for a second number — Compass,
Walls, Survex and Therion all drop back to one reading.

Good for getting numbers into a spreadsheet. Not a survey archive.

## Three defects this exercise found and fixed

Measuring the formats turned up bugs, not just limits.

1. **Trip membership was scrambled on every Survex import.** The Survex
   reader tracked the running trip in `survey.date`/`survey.team`, and
   `CsModel.tripIdFor` calls `ensureTrips`, which unconditionally mirrors
   `trips[0]` back onto those fields. So the first leg of each new trip
   created its trip correctly and, in the same call, reset the running
   state to trip 0's — every following leg fingerprinted as trip 0.
   Importing `testdata/PitfallCave.svx` produced a perfect list of four
   trips with **137 of 141 legs attributed to the entrance trip**. The
   trip count was all anything asserted, which is why it survived this
   long. Both readers now keep their own running state, and
   `tests/js_unit.js` asserts membership by comparing the `.svx` and
   `.dat` fixtures leg for leg — they are the same cave, so their trip
   attribution has to agree.
2. **Therion wrote struck-out shots as ordinary legs**, so `B23X` came
   back as a real station and the cave grew one. Now a comment.
3. **Therion never wrote the duplicate and surface flags**, though the
   format has both and the reader already read them — a surface leg came
   back as ordinary survey and would have been drawn.

## Reading the numbers yourself

`--detail` prints an example of every differing field, which is the
fastest way to tell a format limitation from a defect. Two things in the
harness are worth knowing before trusting its output: shots are matched
by station pair **and occurrence ordinal** (PITFALL CAVE contains a
deliberately duplicated disagreeing leg, and matching on the pair alone
compared both originals against one shot), and trips are compared by
**fingerprint** rather than index (every writer emits trips in
first-appearance order, so index comparison reports a correctly
round-tripped survey as entirely rearranged).
