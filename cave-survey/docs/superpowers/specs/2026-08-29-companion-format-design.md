# The companion file — design (2026-08-29)

A single JSON file written beside every cave drawing, carrying the whole
survey and the whole of what the drawing knows *about* the survey, at
full precision and with no length limits.

Extension **`.cavecad`** (Nathan, 2026-08-29), so `PITFALL CAVE.dxf` is
accompanied by `PITFALL CAVE.cavecad`. Nothing here is built.

## Why a new file at all

Two facts, both established by measurement rather than assumption.

**Every interchange format is lossy, and each in a different place.**
`docs/format-fidelity.md` measures it: Compass loses the elevation datum
outright, Walls collapses four trips into one and drops every team,
Survex and Therion cannot express a struck-out shot, CSV keeps the
geometry perfectly and almost nothing else, and only Compass keeps the
held-fixed flag. Of the several readings behind a `5/10` LRUD entry
(`leftAll`/`rightAll`/`upAll`/`downAll`), only the suite's own CSV
dialect keeps them — its notebook shorthand is the one column format
with anywhere to put a second number, and Compass, Walls, Survex and
Therion all drop back to a single reading.

**The DXF is the only complete copy, and it is complete only in
CaveCAD.** The tag schema (v3, 60 keys) holds more than any interchange
format, but it persists because of fork patch 0005: upstream QCAD's free
dxflib writer never serialized custom properties, and its importer's
`importXData` was a `TODO`. A CaveCAD DXF opened and re-saved by stock
QCAD, AutoCAD, or anything else keeps the geometry and can drop the 1001
groups. The map survives; the survey model does not, silently.

And the tag store has a hard ceiling that is already shaping the design
of the suite. `CsStationOrder.js` caps its `AlignedStations` tag at 800
characters and says why: "dxflib dies at 1024 chars/line, so no
unbounded tag, ever (the RevisionLog lesson)". `RevisionLog` was retired
entirely for the same reason (Nathan, 2026-08-27). `CsBind`'s
`LineworkStations` and `CsDraw`'s `ExcludedShots`/`UnplacedShots` are
unbounded by construction and live under the same ceiling.

A sidecar file has no such ceiling, no APPID negotiation, no foreign
writer to survive, and no rounding. That is the whole argument.

## What it is, and is not

**Is:** the authoritative, lossless record of the survey and of every
decision the suite made about it. If the DXF's XDATA were stripped
tomorrow, this file plus the geometry would rebuild the drawing's survey
exactly, including the frame it was drawn in.

**Is not:**

- *Not a replacement for the DXF.* Geometry and cartography — traced
  walls, shaped lines, callout leaders, the sheet — stay in the drawing.
  DXF prints anywhere and opens anywhere; that is worth keeping and this
  file does not compete with it.
- *Not an interchange format.* Compass, Walls, Survex, Therion and CSV
  exist to talk to other people's software. This talks to CaveCAD.
- *Not a package.* Package Cave Project still assembles the zip; this
  file becomes one of the things it puts in it.

## Container

**One pretty-printed JSON file, UTF-8, LF.**

JSON was verified working in CaveCAD's own script engine before this was
written — `JSON.parse`, `JSON.stringify`, two-space indentation, and
full double precision (`512345.6712345678` survives a round trip
exactly). The engine trap that pushed the *legacy* store away from JSON
was MTEXT treating braces as formatting groups (`CsStore.js`); that
applies to text stored inside a drawing, not to a file on disk.

One file rather than a zip: it must be greppable, diffable, and
readable by a caver with a text editor, and it syncs through Drive as a
single object.

**Determinism is a requirement, not a nicety.** Keys are written in the
order this spec lists them, arrays in survey order, numbers with
JavaScript's own shortest round-trip representation. Writing the same
survey twice produces byte-identical files, so a diff between two
versions of a cave shows what actually changed. This is testable, and
the tests below test it.

## Shape

```
{
  "format":     { ... }    what this file is
  "cave":       { ... }    which cave, which drawing
  "privacy":    { ... }    sanitized or full, stated in the file
  "survey":     { ... }    the complete CsModel survey
  "adjustment": { ... }    how the drawn coordinates were produced
  "drawing":    { ... }    what the drawing knows about the survey
  "extra":      { ... }    anything a future version added (preserved)
}
```

### `format`

```json
{ "format": { "name": "cavecad-companion", "version": 1,
              "generator": "Cave Survey Tools 0.9.17.1",
              "written": "2026-08-29T04:12:00Z" } }
```

`version` is a single integer. A reader that meets a higher one refuses
the file and says so rather than guessing; a reader that meets a lower
one migrates. No minor version: a change either breaks readers or does
not, and "does not" needs no number.

### `cave`

```json
{ "cave": { "name": "PITFALL CAVE",
            "drawing": "PITFALL CAVE.dxf",
            "distanceUnit": "ft",
            "pairing": { "stations": 71, "entities": 1284 } } }
```

`pairing` is a weak fingerprint of the drawing this file was written
from — not a checksum, deliberately. A drawing gains and loses entities
constantly as the map is drawn, so a strict hash would report "mismatch"
every day and be ignored within a week. Counts let a reader say *"this
companion was written when the drawing had 71 stations and it now has
84 — it is older than the drawing"*, which is the only claim worth
making automatically. Anything stronger is a job for the user.

### `privacy`

```json
{ "privacy": { "sanitized": true, "omitted": ["survey.fixed", "drawing.geo"] } }
```

Stated in the file, not inferred from what is missing. The rules are
`CsPackage.sanitizeSurvey`'s, unchanged: a sanitized file carries no
`survey.fixed` and no `drawing.geo`, and the cave's shape is not the
secret. `omitted` names what was left out so a reader can tell "no
control was recorded" from "control was removed" — a distinction the
interchange formats cannot express at all, and the reason a caver
opening a sanitized file does not conclude the survey was never tied in.

### `survey`

The whole `CsModel` survey, field for field, at full precision.

```json
{ "survey": {
    "name": "", "caveName": "PITFALL CAVE", "date": "2026-03-14",
    "team": "N. SCHONEGG, R. WEBB", "instruments": "",
    "declination": -4.66, "declinationSource": "IGRF-14",
    "distanceUnit": "ft",
    "startNote": "", "startLrud": null,
    "fixed": { "A1": { "x": 0.0, "y": 0.0, "z": 812.4 } },
    "trips": [
      { "name": "ENTRANCE SERIES", "date": "2026-03-14",
        "team": "N. SCHONEGG, R. WEBB", "instruments": "",
        "declination": -4.66, "declinationSource": "IGRF-14",
        "distanceUnit": "ft", "startNote": "", "startLrud": null }
    ],
    "shots": [
      { "from": "A1", "to": "A2",
        "distance": 28.5, "azimuth": 209.66, "inclination": -11.0,
        "backAzimuth": null, "backInclination": null,
        "left": null, "right": null, "up": null, "down": null,
        "leftAll": null, "rightAll": null, "upAll": null, "downAll": null,
        "splay": false, "excludeFromPlot": false, "excludeFromAll": false,
        "excludeFromLength": false, "noAdjust": false,
        "notes": "STEEP MUD SLOPE",
        "trip": 0, "seq": 0, "declination": -4.66 }
    ] } }
```

Points where this beats every interchange format:

- **`leftAll`/`rightAll`/`upAll`/`downAll`** — the several readings
  behind one LRUD entry. Only the suite's own CSV dialect keeps these,
  and CSV keeps almost nothing else.
- **`seq`** — the shot's position within its own trip, which is the
  notebook's row order. `CsRevise` reconstructs by sorting on
  `(trip, ShotSeq)`; Compass and Survex both regroup shots into per-trip
  blocks and lose it.
- **Per-shot `declination`** alongside the true `azimuth`, so the
  original magnetic reading is recoverable exactly rather than by
  subtracting a trip average.
- **Every flag**, including `noAdjust` and `excludeFromAll`, which only
  Compass keeps and no other format can even say.
- **No rounding.** The writers all use `toFixed(2)`. This does not.

`trip` stays an integer index into `trips`, not a fingerprint — the same
reasoning `CsBind` gives for binding linework by trip id: a `date|team`
fingerprint "goes stale the moment a date typo or a team spelling is
corrected", and correcting those is exactly what the revision framework
is for.

### `adjustment`

```json
{ "adjustment": { "mode": "leastSquares", "sigmaTape": 0.05,
                  "sigmaAngle": 1.0,
                  "anchor": { "station": "A1", "x": 0.0, "y": 0.0, "z": 812.4 } } }
```

The record `CsDraw.survey` stamps on the trip-0 anchor
(`Adjustment`/`SigmaTape`/`SigmaAngle`) plus the anchor itself. With
this, `survey`, and `CsAdjust.resolveAndAdjust`, the drawn station
coordinates are reproducible exactly — which is what makes the file a
real backup of the drawing's survey rather than a description of it.

### `drawing`

What the drawing knows about the survey, keyed by things that mean
something rather than by entity handles. **Handles are not usable across
files** — the DXF exporter renumbers them on save, which is precisely
why `CsStore` keyed its legacy records by geometry instead.

```json
{ "drawing": {
    "stations": { "A1": { "x": 0.0, "y": 0.0, "z": 812.4, "seq": 0 } },
    "geo": { "station": "A1", "lat": 38.4795, "lon": -86.4381 },
    "profile": { "origin": {...}, "runs": [ { "run": "A", "zOffset": 0.0,
                 "box": { "minX": 0, "minY": 0, "maxX": 0, "maxY": 0 } } ] },
    "wallRuns": [ { "layer": "WALLS-INFERRED", "index": 0,
                    "stations": ["A3", "A4", "A5"] } ],
    "linework": [ { "key": "polyline:1234.5678:987.6543",
                    "trip": 1, "stations": ["A3", "A4", "A5"] } ],
    "callouts": [ { "id": "9f2c...", "kind": "elevation", "role": "text",
                    "style": "...", "side": "L" } ],
    "scans":    [ { "file": "trip1-p1.jpg", "alignedStations": [ ... ] } ],
    "excludedShots": [ ... ], "unplacedShots": [ ... ] } }
```

Three notes on the keys:

- **`stations`** duplicates what `survey` + `adjustment` can recompute.
  Deliberate: it is the cheap insurance. If a future change to
  `CsAdjust` shifts a solve by a hair, the file still says where the
  cave was actually drawn, and the discrepancy is visible instead of
  silent.
- **`linework`** is the one place a geometry key is unavoidable, because
  a hand-traced wall has no name. It uses `CsStore.geoKey`'s existing
  form — entity type plus position to four decimals, midpoint for lines,
  bounding-box centre otherwise — because that scheme is already proven
  in this codebase against a real DXF round trip. It is a *hint*: on
  read, a key that matches nothing is reported, never guessed at. The
  drawing's own `LineworkTrip`/`LineworkStations` tags remain the
  primary record; this is the copy that survives a foreign save.
- **`callouts`** need no such trick — `CalloutId` is already a `CsUuid`,
  stable by construction.

`scans.alignedStations` and `excludedShots`/`unplacedShots` are written
**in full**. In the drawing they live under the 1024-character dxflib
line limit — `AlignedStations` is capped at 800 characters and drops the
rest. Here there is no cap, which makes this file the complete record of
those three specifically.

### `extra`

Anything a future version writes that this version does not know. **A
reader must preserve unknown keys through a read-modify-write** rather
than dropping them, so an older CaveCAD opening a newer cave's file and
saving it does not quietly strip what it did not understand. This is the
one rule that keeps a versioned format from eating its own data during a
staged rollout.

## When it is written

**On every save** (Nathan, 2026-08-29), plus by hand and into a package.

### The sequence, and why it is in this order

A save produces two files, and the companion must describe the drawing
that was actually written — so it is written *after* the DXF, from the
final corrected filename:

1. The DXF is written (`di.exportFile`). If that fails, nothing else
   happens: a companion describing a drawing that was not saved is worse
   than no companion.
2. `NAME.cavecad` -> `NAME.cavecad.bak`, one generation, replacing any
   previous `.bak`.
3. The new companion is written to `NAME.cavecad.tmp`, then renamed over
   `NAME.cavecad`.

Step 3 is a rename rather than a direct write so that a crash or a full
disk mid-write cannot destroy both generations at once: the old file
stays whole until the new one is complete on disk, and a leftover
`.tmp` is a visible symptom rather than a truncated companion that
parses to half a cave.

### The `.bak`

Straight into `CsBackup`, which as of 2026-08-29 keeps datestamped
generations in the cave project's own `backup/` folder:

```
Pitfall Cave/backup/Pitfall Cave.cavecad.2026-08-29_041200.bak
```

beside the drawing's own generations, pruned by the same keep count.
`CsBackup.backupNameFor` already handles any extension, so the companion
needs no scheme of its own — it calls `CsBackup.copyPrevious(path)` and
gets the whole thing.

The Drive exemption that used to sit in `CsBackup` is gone as of the
same change, so nothing special is needed here either. The reasoning
that removed it applies doubly to this file:

- The user never *looks* at this file, so a wrong one produces no
  visible symptom. A gutted drawing is obvious on screen; a companion
  written from that same gutted drawing is silent until the day it is
  needed. Drive's history is a manual rollback through a web UI, bounded
  to 100 revisions or 30 days — fine as a backstop, useless as the only
  guard against a failure nobody noticed.
- It is kilobytes of JSON, not megabytes of DXF. The clutter and churn
  argument that justified skipping Drive for drawings does not survive
  the size difference.

Both were argued when the exemption was dropped; the second one is the
companion's specifically.

### The mechanism

**A fork patch to `scripts/File/Save/Save.js` and `SaveAs/SaveAs.js`**,
in the shape patch 0005 already established — it edits both files for
exactly this kind of reason.

Not the add-on's own `Save.prototype` wrapper, for a reason recorded in
this repo: `CsBackup.js` measured that patching `Save.prototype.save`
from add-on init "installs cleanly, reports success, and never runs",
because QCAD builds its actions in a separate script context
(`RScriptHandlerJs::createActionDocumentLevel`), and it explicitly notes
that `CsCave.installSaveHook` "uses the same mechanism and is very
likely just as inert". Whether that suspicion is true is **still
unmeasured** (see the open questions) — but the fork has to change for
the file association anyway, and patching the save script directly is
reliable whichever way that measurement lands.

The patch calls one add-on entry point and nothing more:
`CsCompanion.writeBeside(fileName)`, guarded so that a failure to write
the companion never fails the save, and reported once per session if it
does — the same "a broken guard says so without nagging" rule
`CsBackup.warnedThisSession` already follows.

### Also written by

- **`Write Companion File`** (`cavecompanion`), an explicit tool, so the
  file can be regenerated without saving.
- **Package Cave Project**, staged into the zip, sanitized or full with
  everything else.

## Tests

- **`tests/js_unit.js`** — pure: model → JSON → model is field-for-field
  identical, including `leftAll` and every flag; writing twice is
  byte-identical; unknown keys survive a read-modify-write; a sanitized
  file omits `fixed` and `geo` and says which in `privacy.omitted`; a
  file declaring a higher `format.version` is refused rather than
  half-read.
- **`tests/companion_roundtrip.js`** — engine: draw PITFALL CAVE, write
  the DXF *and* the companion, reopen both, and assert the reconstructed
  survey matches the original — the comparison
  `tools/format_fidelity.js` already performs, pointed at this pair.
  Then strip the DXF's XDATA and assert the companion alone still
  rebuilds the survey and the drawn frame.
- **`tools/format_fidelity.js`** gains a sixth column. It should report
  zero differences in every row. That is the acceptance criterion for
  the whole format, and the reason to build it on top of a harness that
  already knows how to find losses.

## Registering `.cavecad` with the OS

Asked for on 2026-08-29: double-clicking a `.cavecad` should open
CaveCAD. Surveyed against the fork source; nothing below is built.

### What the app claims today: nothing, on macOS

`src/run/Info.plist` has **no `CFBundleDocumentTypes` and no
`UTExportedTypeDeclarations`**. CaveCAD claims no file type at all on
macOS today — not even `.dxf`. Linux is the only platform where an
association already exists: `cavecad.desktop` carries
`MimeType=application/dxf;image/vnd.dxf;`. No Windows installer exists in
the repo (no `.iss`, `.nsi`, or `.wxs`), so there is nothing to add a
registration to yet.

### macOS

1. **Declare the type.** `UTExportedTypeDeclarations` with identifier
   `org.cavecad.companion` (matching the existing bundle id
   `org.cavecad.CaveCAD`), conforming to `public.json` and `public.data`,
   with `UTTypeTagSpecification` -> `public.filename-extension` =
   `cavecad`. Exported rather than imported: this type is ours.
2. **Claim it.** A `CFBundleDocumentTypes` entry naming
   `LSItemContentTypes = org.cavecad.companion`, `CFBundleTypeRole =
   Editor`, `LSHandlerRank = Owner`, and an icon in `Resources`.
3. **Wire the build.** The bundle currently uses Qt's stock plist
   template (`src/run/.qt/info_plist/CaveCAD/Info.plist`, full of
   `${MACOSX_BUNDLE_*}` substitutions). Adding types means shipping our
   own `Info.plist.in` and pointing `MACOSX_BUNDLE_INFO_PLIST` at it from
   `src/run/CMakeLists.txt`, keeping every existing substitution.
4. **Register.** Launch Services picks it up when the bundle is in
   `/Applications`; force with
   `/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f /Applications/CaveCAD.app`.

Editing `Info.plist` invalidates any code signature. Local unsigned
builds are unaffected; a signed distribution has to sign after the edit,
not before.

**Claiming `.dxf` as well is available in the same block and deliberately
not proposed here.** Becoming the system handler for DXF would take that
association away from whatever holds it now, on every machine that
installs CaveCAD. That is a decision about someone's whole desktop, not
about this feature.

### Linux

Add a shared-mime-info package —
`support/org.cavecad.CaveCAD.mime.xml` — declaring
`application/vnd.cavecad+json` with a `<glob pattern="*.cavecad"/>` and a
`<magic>` match on the `"format"` key, installed to
`/usr/share/mime/packages` with `update-mime-database` run afterward.
Then append that type to `cavecad.desktop`'s existing `MimeType=` line,
and ship an icon named after the MIME type.

### Windows

Nothing to do until an installer exists. When one does:
`HKCR\.cavecad` -> a ProgID, and `HKCR\CaveCAD.Companion\shell\open\command`
-> `"path\to\cavecad.exe" "%1"`, plus `DefaultIcon`.

### Making the open actually do something

A registration only tells the OS which app to launch. What CaveCAD does
with the path is a second, smaller change — and the companion is not a
drawing, so the sensible behaviour is: **opening `X.cavecad` opens
`X.dxf` beside it.**

Every path a file can arrive by — the command line, a macOS double-click
(`QFileOpenEvent`, `AutoStart.js:183` and `:764`), and a message from a
second instance — funnels into one function: `openFiles()` in
`scripts/library.js:3397`. A redirect there is roughly ten lines: for any
argument ending in `.cavecad`, substitute the sibling `.dxf` when it
exists, and warn plainly when it does not ("this is a survey companion
file; its drawing is missing") rather than handing a JSON file to the DXF
importer.

That redirect has to live in the fork, because `library.js` is
application source. **So the fork changes for this feature regardless of
how the save hook question below resolves** — which is why the save call
belongs in the same patch rather than in a wrapper whose reliability our
own source disputes.

### Effort

One patch to the fork (plist template + CMake wiring + the `openFiles`
redirect + the save call), a rebuild, and `lsregister -f`. The Linux MIME
files are additive and cost little. Windows waits for an installer.

## Open questions

1. ~~**Does `CsCave.installSaveHook` actually fire?**~~ **ANSWERED
   2026-08-29: no.** `probe/CsSaveProbe` wrapped `Save.prototype.save`,
   `SaveAs.prototype.save` and `RDocumentInterface.prototype.exportFile`
   on top of the suite's own hook and watched a real GUI save of Truitt
   Cave. Probe armed 08:15:43; the drawing was written 08:15:56; the
   probe log did not grow. Nothing fired — not even the JS binding for
   `exportFile`, so the save does not traverse that binding from the
   action's context either. `CsBackup`'s prediction was right and
   `installSaveHook` is inert, which means everything it does on save has
   never run: `pointAtScans`, `CsShelf.registerSaved`,
   `ensureProjectFolders` (so `backup/` never appears on save) and
   `writePreview`. The preview files that do exist come from
   `CaveShelf.captureThumbnailSoon`, on its own timer.

   So the companion's on-save write is a fork patch, not a question. So
   is `backup/`, and so are the other four.

2. **Should `.dxf` also be claimed on macOS?** See above; it is a
   desktop-wide decision, not a feature decision.
3. **Revision history.** A sidecar has no tag-length ceiling, so the
   history retired with `RevisionLog` on 2026-08-27 could live here at
   full length. That was retired for a storage reason that no longer
   applies, but it was still your decision, so it is not in the shape
   above — say the word and it becomes a `revisions` array.
4. **Does `drawing.linework` earn its geometry key?** It is the only
   fuzzy thing in an otherwise exact file. Dropping it costs the
   linework-to-trip binding *only* where the DXF's own tags were
   destroyed by a foreign save — which is the case this file exists for,
   so I have kept it. Worth a second opinion.
