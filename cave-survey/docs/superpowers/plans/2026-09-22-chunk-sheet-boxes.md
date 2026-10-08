# Chunked Profile Sheet Boxes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a caver drag each chunk of a chunked Profile Sheet into its
own arranged position, the same way Sheet Setup already lets them drag
the title block, scale bar, north arrow and cave footprint.

**Architecture:** Sheet Setup's existing furniture drag/snap system
(`CsSheetSetup.js`, `CsSheetView.js`) is generic over a string `kind` key
per draggable piece; it is not generic over VARIABLE-COUNT pieces of the
same visual kind. Give each chunk box its own `kind` string
(`"band:" + chunkKey"`) instead of the one shared `"band"` string every
band uses today, and the existing offset/snap/drag machinery works
unmodified. At Build Sheet time, when the sheet is a chunked Profile
Sheet, regenerate the elevation directly into the sheet copy with
`CsProfile.build(.... offsets: <the caver's final per-chunk deltas>)` +
`CsProfileDraw.render(...)` — the same real pipeline Generate Profile
already uses on the live drawing — instead of copying and translating
entities, because a tie line between two independently-dragged chunks
cannot be captured as a rigid per-chunk translation (see Task 4).

**Tech Stack:** QCAD/CaveCAD add-on JS (ECMAScript 5, QCAD's `RS`/`R*`
API), this suite's own `Core/Cs*.js` modules, `tests/run_all.sh`'s
hand-rolled test runner (no framework).

**User decisions (already made):**
- Scope: only Sheet Setup's Profile Sheet, only when
  `CaveSurvey/ProfileMode` is `chunked`. Extended/projected sheets and
  the Plan Sheet are unchanged.
- Persistence: ephemeral, sheet-only — like furniture. Never written
  back into the live drawing's `ProfileChunkOffset`.
- Box identity: each box's label is the same caption `CsChunk.caption`
  already generates for that chunk (pitch-depth label, or the leading
  station's name for a passage piece).
- Design doc:
  `docs/superpowers/specs/2026-09-22-chunk-sheet-boxes-design.md`.

---

## Facts this plan relies on (verified in the code, 2026-09-22)

- `CsSheetSetup.MOVABLE = ["cave", "title", "bar", "north"]`
  (`Core/CsSheetSetup.js:664`). `isMovable(kind)` checks membership
  (`:673-675`).
- `CsSheetSetup.offsetOf`/`withOffset`/`anyMoved` (`:679-726`) are
  already fully generic over any string `kind` — no change needed to
  their logic, only to what `anyMoved` iterates (Task 2).
- `CsSheetSetup.pickAt` (`:785-802`) filters by `isMovable(item.kind)`
  only — a new `kind` becomes pickable purely by `isMovable` accepting
  it.
- `CsSheetSetup.snapLines` (`:812-839`) already loops over ALL
  `preview.items` regardless of movability — no change needed.
- `CsSheetSetup.preview` (`:957-1068`) builds items through one
  `add(kind, minX, minY, maxX, maxY)` closure (`:971-977`) that ALREADY
  looks up `CsSheetSetup.offsetOf(state.offsets, kind)` and applies it —
  so giving each band its own `kind` string is enough to make it
  independently draggable through the EXISTING offset pipeline. Today's
  band loop (`:1030-1052`) calls `add("band", bands[i].minX + dx, ...)`
  for every band with the same literal `"band"` kind — this is the one
  line that collapses all chunks onto one shared offset.
- `CsSheetPreview.STYLE` (`Core/CsSheetView.js:293-302`) and
  `CsSheetPreview.show` (`:428-465`) look up
  `CsSheetPreview.STYLE[item.kind]` by EXACT string match and skip
  (`continue`) any kind not found — so a `"band:<key>"` string needs a
  style-resolution fallback, or every chunk box silently fails to draw
  (Task 3).
- `SheetSetup.PREVIEW_STYLE` (`SheetSetup/SheetSetup.js:212-221`, the
  QPixmap fallback painter for a build that refused the embedded view)
  has the same exact-match structure and needs the same fallback.
- Neither preview path draws any per-item TEXT label today — `title`,
  `bar`, `north`, `cave` are told apart purely by colour. Distinct boxes
  of the same "band" colour need a real new label-drawing step (Task 3).
- `SheetSetup.readSurvey(doc)` (`:164-180`) calls
  `CsRevise.resolveAsDrawn(doc)` (which returns `{survey, resolved}`)
  but only keeps `.survey` (`:171`) — `resolved` is silently dropped.
  `SheetSetup.refresh`/similar (`:342-363`) copies `read.survey` into
  `state.survey` (`:343`) but never copies `resolved`.
- `SheetSetup.build` (`:731-776`) already passes `survey: w.state.survey`
  into `SheetSetup.intoCopy` (`:772`) — `resolved` needs the same
  treatment.
- `state.hasElevation` / `state.bands = CsProfileBox.boxes(doc)`
  (`:356-363`) reads the LIVE DRAWING's already-drawn box rectangles —
  `CsProfileBox.boxes(doc)` returns `[{key, minX, minY, maxX, maxY}]`
  (`Core/CsProfileBox.js:26-49`), no caption/kind info. For chunked mode
  this plan replaces that read with a fresh, label-carrying computation
  (Task 3) rather than relying on whatever the live drawing happens to
  have drawn.
- `CsProfile.build(survey, resolved, opts)` dispatches to
  `CsChunk.build` internally when the mode is chunked; `opts.mode`
  absent means "read `CaveSurvey/ProfileMode` itself"
  (`Core/CsDraw.js:1454-1471`, comment at `:1458-1462`). `CsChunk.build`
  (`Core/CsChunk.js:702-740`) returns `{bands, chunks, ties, pitches,
  findings}` — the identical shape `CsProfile.build` returns for the
  other two modes, which is exactly what `CsProfileDraw.render(doc, di,
  profile, opts)` (`Core/CsProfileDraw.js:1341` on) consumes.
- `CsChunk.caption(band)` (`Core/CsChunk.js:743-751`) is the exact
  label text to reuse: the pitch-depth caption for a pitch chunk,
  `"FROM " + <station>` for a passage chunk.
- `CsProfileDraw.boxesFor(profile, margin)` (`:1018-1043`) computes the
  box rectangle for every band in a built profile, already separated so
  they do not overlap — the same computation
  `CsProfileDraw.render`/`boxesFor`'s own caller uses to draw the real
  `CTRL-PROFILE-BOX` rectangles. Use this to seed the preview's chunk
  boxes instead of reading the live drawing.
- A tie line (`Core/CsProfileDraw.js:1436-1476`) is drawn as ONE line
  entity spanning two chunks' real coordinates, tagged with a SINGLE
  `ProfileRun` = the first chunk's key (`:1473`, comment: "filed under
  the first"). Translating one chunk's entities by `ProfileRun` filter
  would drag the WHOLE tie line with whichever chunk owns the tag,
  detaching it from the chunk that did not move — this is why Task 4
  regenerates rather than translates.
- `CsProfile.settings()` (`Core/CsProfile.js:2929-2958`) returns
  `{auto, flatSplayDeg, maxStations}` only. `mode`/`azimuth`/
  `exaggeration` are read internally by `CsProfile.build` from
  `RSettings` whenever the caller's `opts` does not set them
  (`CsDraw.js:1458-1462`'s comment) — so Task 4's regenerate call only
  needs to pass `flatSplayDeg` and `offsets`, nothing else.
- Test harness: a test file not added to the hand-written include list
  in `tests/run_all.sh` runs zero assertions and still exits 0
  (`[[cavecad-test-harness-traps]]`).

---

## Task 1: Thread `resolved` through Sheet Setup's state

**Goal:** `SheetSetup`'s state carries the resolved survey alongside the
raw one, so later tasks can call `CsProfile.build` without re-resolving.

**Files:**
- Modify: `scripts/CaveSurvey/SheetSetup/SheetSetup.js:164-180` (`readSurvey`)
- Modify: `scripts/CaveSurvey/SheetSetup/SheetSetup.js:342-363` (state assembly)
- Modify: `scripts/CaveSurvey/SheetSetup/SheetSetup.js:731-776` (`build`, the `intoCopy` opts)
- Test: `tests/sheet_setup_chunks.js` (new file, created in this task; more assertions added in later tasks)

**Acceptance Criteria:**
- [ ] `SheetSetup.readSurvey(doc)` returns `resolved` alongside `survey`.
- [ ] The state object built during refresh carries `state.resolved`.
- [ ] `SheetSetup.build`'s call into `SheetSetup.intoCopy` passes
      `resolved: w.state.resolved` alongside the existing `survey:
      w.state.survey`.

**Verify:** `node tests/sheet_setup_chunks.js` → `PASS: readSurvey keeps resolved`

**Steps:**

- [ ] **Step 1: Write the failing test**

```js
// tests/sheet_setup_chunks.js
include("scripts/CaveSurvey/SheetSetup/SheetSetup.js");

function testReadSurveyKeepsResolved() {
    // A drawing whose survey resolves ends up with BOTH fields non-null.
    // SheetSetup.readSurvey opens its own doc internally; this test
    // exercises it directly against a real cave fixture the way
    // profile_draw_roundtrip.js already does for CsProfileDraw.
    var doc = CsTestFixture.openPlumblinePit();   // see Task 1 note below
    var read = SheetSetup.readSurvey(doc);
    assertNotNull(read.survey, "readSurvey should return a survey");
    assertNotNull(read.resolved, "readSurvey should return resolved too");
    print("PASS: readSurvey keeps resolved");
}

testReadSurveyKeepsResolved();
```

  `CsTestFixture.openPlumblinePit()` does not exist yet as a shared
  helper — check `tests/plumbline_pipeline.js` and
  `tests/profile_draw_roundtrip.js` for however they already open the
  Plumbline Pit fixture doc (`testdata/PlumblinePit.*`) and reuse that
  exact call instead of inventing a new opener. Copy the real opening
  code from one of those files into this step in place of the
  placeholder call above before running it.

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/sheet_setup_chunks.js`
Expected: FAIL — `read.resolved` is `undefined`/`null`.

- [ ] **Step 3: Make `readSurvey` keep `resolved`**

In `SheetSetup.js`, `SheetSetup.readSurvey` currently reads:

```js
SheetSetup.readSurvey = function(doc) {
    var out = { survey: null, stats: null, grade: null };
    try {
        var asDrawn = CsRevise.resolveAsDrawn(doc);
        if (isNull(asDrawn)) {
            return out;
        }
        out.survey = asDrawn.survey;
        out.survey.distanceUnit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);
        out.stats = CsStats.compute(out.survey, asDrawn.resolved,
            CsTraverse.SLOPE);
        out.grade = CsGrade.compute(out.survey, asDrawn.resolved, out.stats);
    } catch (e) {
        // a drawing whose survey will not resolve still gets its sheet
    }
    return out;
};
```

Change to:

```js
SheetSetup.readSurvey = function(doc) {
    var out = { survey: null, resolved: null, stats: null, grade: null };
    try {
        var asDrawn = CsRevise.resolveAsDrawn(doc);
        if (isNull(asDrawn)) {
            return out;
        }
        out.survey = asDrawn.survey;
        out.resolved = asDrawn.resolved;
        out.survey.distanceUnit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);
        out.stats = CsStats.compute(out.survey, asDrawn.resolved,
            CsTraverse.SLOPE);
        out.grade = CsGrade.compute(out.survey, asDrawn.resolved, out.stats);
    } catch (e) {
        // a drawing whose survey will not resolve still gets its sheet
    }
    return out;
};
```

- [ ] **Step 4: Thread it into the state object**

At `SheetSetup.js:342-343`:

```js
    var read = SheetSetup.readSurvey(doc);
    state.survey = read.survey;
```

Change to:

```js
    var read = SheetSetup.readSurvey(doc);
    state.survey = read.survey;
    state.resolved = read.resolved;
```

- [ ] **Step 5: Thread it into the Build Sheet call**

At `SheetSetup.js:767-775` (`SheetSetup.build`):

```js
    EAction.handleUserMessage(SheetSetup.intoCopy(w.state.recordPath, {
        caveBox: w.state.caveBox, sheet: sheet, scale: scale,
        turned: fit.turned,
        wants: { border: w.cbBorder.checked, bar: w.cbBar.checked,
            north: w.cbNorth.checked, title: w.cbTitle.checked },
        filled: w.state.filled, survey: w.state.survey,
        elevation: w.cbElevation.checked === true,
        offsets: w.offsets
    }));
```

Change to (adds `resolved`):

```js
    EAction.handleUserMessage(SheetSetup.intoCopy(w.state.recordPath, {
        caveBox: w.state.caveBox, sheet: sheet, scale: scale,
        turned: fit.turned,
        wants: { border: w.cbBorder.checked, bar: w.cbBar.checked,
            north: w.cbNorth.checked, title: w.cbTitle.checked },
        filled: w.state.filled, survey: w.state.survey,
        resolved: w.state.resolved,
        elevation: w.cbElevation.checked === true,
        offsets: w.offsets
    }));
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node tests/sheet_setup_chunks.js`
Expected: `PASS: readSurvey keeps resolved`

- [ ] **Step 7: Register the new test file**

Add `tests/sheet_setup_chunks.js` to the hand-written stage list in
`tests/run_all.sh`, in numeric order alongside the existing
`plumbline_pipeline.js` (stage 23) / `stairstep` entries — read the
file's existing stage list first and match its exact format (a missing
entry runs nothing and still exits 0, per
`[[cavecad-test-harness-traps]]`).

- [ ] **Step 8: Commit**

```bash
git add scripts/CaveSurvey/SheetSetup/SheetSetup.js tests/sheet_setup_chunks.js tests/run_all.sh
git commit -m "feat: thread resolved survey through Sheet Setup's state"
```

---

## Task 2: Generalize drag/offset identity to per-item keys

**Goal:** `CsSheetSetup.isMovable` and `anyMoved` accept a per-chunk
`"band:<key>"` kind, so a chunk box can be picked, dragged and
remembered independently once Task 3 gives it that kind string.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsSheetSetup.js:673-675` (`isMovable`)
- Modify: `scripts/CaveSurvey/Core/CsSheetSetup.js:694-707` (`anyMoved`)
- Test: `tests/sheet_setup_chunks.js` (append)

**Acceptance Criteria:**
- [ ] `CsSheetSetup.isMovable("band:UP1-DOWN2")` is `true`.
- [ ] `CsSheetSetup.isMovable("band")` (the un-keyed literal, still used
      by extended/projected sheets) is `false` — that string is
      deliberately NOT in `MOVABLE` today and stays that way; only the
      `"band:"`-prefixed per-chunk form becomes draggable.
- [ ] `CsSheetSetup.anyMoved({"band:UP1-DOWN2": {x: 2, y: 0}})` is
      `true` even though `"band:UP1-DOWN2"` is not in `MOVABLE`.

**Verify:** `node tests/sheet_setup_chunks.js` → both new PASS lines print

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `tests/sheet_setup_chunks.js`:

```js
include("scripts/CaveSurvey/Core/CsSheetSetup.js");

function testChunkKindIsMovable() {
    assertTrue(CsSheetSetup.isMovable("band:UP1-DOWN2"),
        "a per-chunk band kind should be movable");
    assertFalse(CsSheetSetup.isMovable("band"),
        "the shared, un-keyed band kind stays non-movable");
    print("PASS: isMovable accepts band:<key>");
}
testChunkKindIsMovable();

function testAnyMovedSeesChunkOffsets() {
    var offsets = {};
    offsets["band:UP1-DOWN2"] = { x: 2, y: 0 };
    assertTrue(CsSheetSetup.anyMoved(offsets),
        "anyMoved should notice a moved chunk box");
    print("PASS: anyMoved sees a chunk offset");
}
testAnyMovedSeesChunkOffsets();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/sheet_setup_chunks.js`
Expected: FAIL on both — `isMovable("band:UP1-DOWN2")` is `false`
today, and `anyMoved` only scans `CsSheetSetup.MOVABLE`.

- [ ] **Step 3: Update `isMovable`**

`CsSheetSetup.js:672-675` today:

```js
/** Is this a piece a caver may drag? */
CsSheetSetup.isMovable = function(kind) {
    return CsSheetSetup.MOVABLE.indexOf(kind) >= 0;
};
```

Change to:

```js
/** Is this a piece a caver may drag?
 *
 * A CHUNK BOX IS MOVABLE BY PREFIX, not by membership in MOVABLE: there
 * is one of it per chunk, and the count varies per cave, so it cannot
 * be a fixed array entry the way the four furniture pieces are. The
 * un-keyed literal "band" (an extended or projected sheet's single
 * elevation footprint) is deliberately NOT covered by this -- only the
 * per-chunk "band:<key>" form CsSheetSetup.preview emits for a chunked
 * Profile Sheet is. */
CsSheetSetup.isMovable = function(kind) {
    if (CsSheetSetup.MOVABLE.indexOf(kind) >= 0) {
        return true;
    }
    return typeof kind === "string" && kind.indexOf("band:") === 0;
};
```

- [ ] **Step 4: Update `anyMoved`**

`CsSheetSetup.js:694-707` today:

```js
CsSheetSetup.anyMoved = function(offsets) {
    if (isNull(offsets)) {
        return false;
    }
    for (var i = 0; i < CsSheetSetup.MOVABLE.length; i++) {
        var off = CsSheetSetup.offsetOf(offsets, CsSheetSetup.MOVABLE[i]);
        if (Math.abs(off.x) > 1e-9 || Math.abs(off.y) > 1e-9) {
            return true;
        }
    }
    return false;
};
```

Change to scan the offsets object's own keys through `isMovable`
instead of only the fixed furniture list, so a chunk key nobody
enumerated up front still counts:

```js
CsSheetSetup.anyMoved = function(offsets) {
    if (isNull(offsets)) {
        return false;
    }
    var k;
    for (k in offsets) {
        if (!offsets.hasOwnProperty(k) || !CsSheetSetup.isMovable(k)) {
            continue;
        }
        var off = CsSheetSetup.offsetOf(offsets, k);
        if (Math.abs(off.x) > 1e-9 || Math.abs(off.y) > 1e-9) {
            return true;
        }
    }
    return false;
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node tests/sheet_setup_chunks.js`
Expected: both new `PASS:` lines print, plus Task 1's.

- [ ] **Step 6: Commit**

```bash
git add scripts/CaveSurvey/Core/CsSheetSetup.js tests/sheet_setup_chunks.js
git commit -m "feat: let a per-chunk sheet box be dragged and remembered"
```

---

## Task 3: One box per chunk in the preview, labelled and styled

**Goal:** For a chunked Profile Sheet, the interactive Sheet Setup
preview shows one independently-draggable, labelled box per chunk
instead of one "band" blob per band-shaped region.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsSheetSetup.js:1023-1053` (the
  `preview` function's elevation/band block)
- Modify: `scripts/CaveSurvey/SheetSetup/SheetSetup.js:342-363` (state
  assembly — swap `CsProfileBox.boxes(doc)` for a fresh chunked build
  when in chunked mode)
- Modify: `scripts/CaveSurvey/Core/CsSheetView.js:293-302` (`STYLE`
  dict) and `:428-465` (`CsSheetPreview.show`, style lookup + new label
  drawing)
- Modify: `scripts/CaveSurvey/SheetSetup/SheetSetup.js:210-221`
  (`PREVIEW_STYLE`, the QPixmap fallback) and its paint loop (grep
  `PREVIEW_STYLE\[` in this file for the second lookup site)
- Test: `tests/sheet_setup_chunks.js` (append)

**Acceptance Criteria:**
- [ ] When `CaveSurvey/ProfileMode` is `chunked`, `state.bands` holds
      one entry per chunk with `{key, minX, minY, maxX, maxY, label}`,
      `label` being `CsChunk.caption(band)` for that chunk.
- [ ] `CsSheetSetup.preview({...state with N chunked bands...})`
      produces N items whose `kind` is `"band:" + <that chunk's key>",
      each independently offsettable.
- [ ] A chunk box's preview item carries its label text so the drawing
      step can render it.
- [ ] Neither `CsSheetPreview.show` nor the QPixmap `PREVIEW_STYLE`
      path silently drops a `"band:<key>"` item — both resolve it to
      the same visual style `"band"` already has, plus its label text.
- [ ] An extended or projected Profile Sheet (mode is not `"chunked"`)
      is byte-for-byte unchanged: still one `"band"`-kind item per band,
      still no label drawn (matches today's behaviour for those modes,
      out of scope here per the design doc).

**Verify:** `node tests/sheet_setup_chunks.js` → all listed PASS lines print

**Steps:**

- [ ] **Step 1: Write the failing test for per-chunk preview items**

Append to `tests/sheet_setup_chunks.js`:

```js
function testPreviewSplitsChunksIntoOwnBoxes() {
    var bands = [
        { key: "UP1-DOWN2", minX: 0, minY: 0, maxX: 10, maxY: 40,
          label: "P 62 ft" },
        { key: "PASSAGE-DOWN2", minX: 12, minY: 0, maxX: 60, maxY: 8,
          label: "FROM DOWN2" }
    ];
    var preview = CsSheetSetup.preview({
        caveBox: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
        sheet: CsSheetSetup.SHEETS[0], scale: 120,
        wants: {}, elevation: true, bands: bands, offsets: {}
    });
    var kinds = [];
    for (var i = 0; i < preview.items.length; i++) {
        if (preview.items[i].kind.indexOf("band:") === 0) {
            kinds.push(preview.items[i].kind);
        }
    }
    assertEqual(kinds.length, 2, "one box per chunk");
    assertTrue(kinds.indexOf("band:UP1-DOWN2") >= 0,
        "first chunk keeps its own key");
    assertTrue(kinds.indexOf("band:PASSAGE-DOWN2") >= 0,
        "second chunk keeps its own key");
    print("PASS: preview splits chunks into their own boxes");
}
testPreviewSplitsChunksIntoOwnBoxes();

function testPreviewChunkBoxesDragIndependently() {
    var bands = [
        { key: "A", minX: 0, minY: 0, maxX: 10, maxY: 10, label: "A" },
        { key: "B", minX: 20, minY: 0, maxX: 30, maxY: 10, label: "B" }
    ];
    var offsets = {};
    offsets["band:A"] = { x: 5, y: 0 };   // A dragged 5in right, B untouched
    var preview = CsSheetSetup.preview({
        caveBox: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
        sheet: CsSheetSetup.SHEETS[0], scale: 120,
        wants: {}, elevation: true, bands: bands, offsets: offsets
    });
    var boxA = null, boxB = null;
    for (var i = 0; i < preview.items.length; i++) {
        if (preview.items[i].kind === "band:A") { boxA = preview.items[i]; }
        if (preview.items[i].kind === "band:B") { boxB = preview.items[i]; }
    }
    assertNotNull(boxA, "chunk A drawn");
    assertNotNull(boxB, "chunk B drawn");
    assertTrue(boxA.box.minX > 0 + 5 * 120 - 1,
        "chunk A moved by its own offset (5in * 120 scale)");
    print("PASS: dragging one chunk box leaves the other in place");
}
testPreviewChunkBoxesDragIndependently();
```

  (Adjust the exact numeric assertion in
  `testPreviewChunkBoxesDragIndependently` once Step 3's inset math is
  in front of you — the point of the assertion is "A moved roughly
  `5 * scale` and B did not move at all"; read back the ACTUAL `dx`
  the inset computation applies to the whole group first and add that
  base offset into the expected value, rather than assuming it is
  zero.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/sheet_setup_chunks.js`
Expected: FAIL — every chunk still comes back with `kind === "band"`.

- [ ] **Step 3: Give each band its own kind in `CsSheetSetup.preview`**

`CsSheetSetup.js:1030-1052` today (inside the `if (state.elevation ===
true)` block):

```js
        var bands = isNull(state.bands) ? [] : state.bands;
        if (bands.length > 0) {
            // The bands as they will land: the region keeps its own
            // stacking and is slid into the sheet's top-left inset,
            // which is exactly what SheetSetup.moveElevation does.
            var bMinX = null, bMaxY = null;
            for (var i = 0; i < bands.length; i++) {
                if (bMinX === null || bands[i].minX < bMinX) {
                    bMinX = bands[i].minX;
                }
                if (bMaxY === null || bands[i].maxY > bMaxY) {
                    bMaxY = bands[i].maxY;
                }
            }
            var inset = (second.maxX - second.minX) *
                CsSheetSetup.BAND_INSET_FRACTION;
            var dx = (second.minX + inset) - bMinX;
            var dy = (second.maxY - inset) - bMaxY;
            for (i = 0; i < bands.length; i++) {
                add("band", bands[i].minX + dx, bands[i].minY + dy,
                    bands[i].maxX + dx, bands[i].maxY + dy);
            }
        }
```

Change the last loop's `add(...)` call to give each chunked band its
own kind, while leaving non-chunked (no `.key`) bands exactly as they
draw today:

```js
            for (i = 0; i < bands.length; i++) {
                var bandKind = (state.chunked === true &&
                    !isNull(bands[i].key)) ?
                    ("band:" + bands[i].key) : "band";
                add(bandKind, bands[i].minX + dx, bands[i].minY + dy,
                    bands[i].maxX + dx, bands[i].maxY + dy);
                if (bandKind !== "band" && !isNull(bands[i].label)) {
                    // Carried on the item itself, read back by
                    // CsSheetPreview.show / SheetSetup's pixmap
                    // painter to draw the caption -- see Step 5.
                    out.items[out.items.length - 1].label = bands[i].label;
                }
            }
```

  This introduces `state.chunked` as a new explicit flag on the state
  object passed into `preview()` (clearer than sniffing `.key`
  presence alone, since a future band shape could coincidentally carry
  a `.key` for an unrelated reason). Thread it through every existing
  caller of `CsSheetSetup.preview` in `SheetSetup.js` (`SheetSetup.repaint`,
  `SheetSetup.paintPreview` if it builds its own preview object, and
  anywhere else `CsSheetSetup.preview(` is called — grep the file) by
  adding `chunked: w.state.chunked === true` (or the direct state
  field, matching however the rest of this options object is already
  assembled at each call site) alongside the existing `bands:
  w.state.bands` line.

- [ ] **Step 4: Compute `state.bands`/`state.chunked` fresh for chunked mode**

`SheetSetup.js:356-363` today:

```js
    state.hasElevation = SheetSetup.hasElevation(doc);
    if (state.hasElevation) {
        try {
            state.bands = CsProfileBox.boxes(doc);
        } catch (eBands) {
            state.bands = [];
        }
    }
```

Change to branch on the stored profile mode, and for chunked mode
compute bands fresh (with labels) instead of reading the live drawing's
box layer:

```js
    state.hasElevation = SheetSetup.hasElevation(doc);
    state.chunked = false;
    if (state.hasElevation) {
        var profileSettings = CsProfile.settings();
        var mode = "extended";
        try {
            mode = RSettings.getStringValue("CaveSurvey/ProfileMode",
                "extended");
        } catch (eMode) {
        }
        state.chunked = (mode === "chunked");
        if (state.chunked && !isNull(state.resolved)) {
            try {
                var built = CsProfile.build(state.survey, state.resolved,
                    { flatSplayDeg: profileSettings.flatSplayDeg,
                      offsets: {} });   // the PRESET row -- a drag is
                                        // applied later, purely in the
                                        // preview, via state.offsets
                var boxes = CsProfileDraw.boxesFor(built,
                    CsProfileDraw.BOX_MARGIN_FEET);
                state.bands = [];
                for (var bi = 0; bi < built.bands.length; bi++) {
                    var bnd = built.bands[bi];
                    var bx = null;
                    for (var boxi = 0; boxi < boxes.length; boxi++) {
                        if (boxes[boxi].key === bnd.key) {
                            bx = boxes[boxi];
                            break;
                        }
                    }
                    if (bx === null) {
                        continue;
                    }
                    state.bands.push({ key: bnd.key, minX: bx.minX,
                        minY: bx.minY, maxX: bx.maxX, maxY: bx.maxY,
                        label: CsChunk.caption(bnd) });
                }
            } catch (eChunked) {
                state.bands = [];
            }
        } else {
            try {
                state.bands = CsProfileBox.boxes(doc);
            } catch (eBands) {
                state.bands = [];
            }
        }
    }
```

  `CsProfileDraw.BOX_MARGIN_FEET` is used elsewhere in `CsProfileDraw.js`
  in feet directly (see the unit-conversion around
  `CsProfileDraw.js:1484-1491` in `render`) — check whether `boxesFor`
  expects the margin in drawing units or feet at its call site inside
  `render` (`:1486-1492`) and convert the same way here if the sheet
  copy's document unit can differ from feet, rather than assuming feet
  pass through unconverted.

- [ ] **Step 5: Resolve `"band:<key>"` to the shared style and draw its label**

`CsSheetView.js:293-302` today has no fallback for an unrecognised
kind; add one and use it in `CsSheetPreview.show`.

Add just below `CsSheetPreview.STYLE`:

```js
/** The style for any item kind, including a per-chunk "band:<key>"
 *  kind, which shares "band"'s look — see CsSheetSetup.preview. */
CsSheetPreview.styleFor = function(kind) {
    if (!isNull(CsSheetPreview.STYLE[kind])) {
        return CsSheetPreview.STYLE[kind];
    }
    if (typeof kind === "string" && kind.indexOf("band:") === 0) {
        return CsSheetPreview.STYLE.band;
    }
    return null;
};
```

In `CsSheetPreview.show` (`:428-465`), change:

```js
            var style = CsSheetPreview.STYLE[item.kind];
            if (isNull(style)) {
                continue;
            }
```

to:

```js
            var style = CsSheetPreview.styleFor(item.kind);
            if (isNull(style)) {
                continue;
            }
```

and, right after the `op.addObject(CsSheetPreview.rect(...), false);`
line for the non-dashed case, add the label when present:

```js
            op.addObject(CsSheetPreview.rect(preview, item.box, style),
                false);
            if (!isNull(item.label) && item.label !== "") {
                var lbl = new RTextEntity(preview.doc,
                    new RTextData(new RVector(item.box.minX,
                        item.box.maxY),
                        new RVector(item.box.minX, item.box.maxY),
                        (item.box.maxY - item.box.minY) * 0.12,
                        item.box.maxX - item.box.minX,
                        RS.VAlignTop, RS.HAlignLeft, RS.LeftToRight,
                        RS.Exact, 1.0, item.label, "standard", false,
                        0.0));
                lbl.setColor(new RColor(style.color[0], style.color[1],
                    style.color[2]));
                op.addObject(lbl, false);
            }
```

  Check `RTextData`'s real constructor signature against another
  in-repo caller before trusting the argument order above — grep
  `new RTextData(` in `Core/CsDraw.js` (`CsDraw.addText` is the
  suite's own text-drawing helper and almost certainly wraps this
  exact call) and match its argument order exactly rather than the
  guess here, since a wrong argument order fails silently (wrong
  height/alignment) rather than throwing.

- [ ] **Step 6: Same fallback for the QPixmap painter**

Find `SheetSetup.PREVIEW_STYLE` (`SheetSetup.js:210-221`) and its
lookup site (grep `PREVIEW_STYLE\[` in `SheetSetup.js` — likely inside
`SheetSetup.paintPreview`). Apply the identical pattern: a
`SheetSetup.previewStyleFor(kind)` helper mirroring
`CsSheetPreview.styleFor` above, used at that lookup site, plus a
`QPainter.drawText`-based label draw beside the existing rectangle draw
for that item (read the existing rectangle-drawing code in that
function first and match its `QPainter` call style, rather than
inventing a different drawing approach for just this one item type).

- [ ] **Step 7: Run test to verify it passes**

Run: `node tests/sheet_setup_chunks.js`
Expected: all `PASS:` lines from Tasks 1-3 print.

- [ ] **Step 8: Commit**

```bash
git add scripts/CaveSurvey/Core/CsSheetSetup.js scripts/CaveSurvey/Core/CsSheetView.js scripts/CaveSurvey/SheetSetup/SheetSetup.js tests/sheet_setup_chunks.js
git commit -m "feat: one draggable, labelled box per chunk in Sheet Setup's preview"
```

---

## Task 4: Build Sheet regenerates the chunked elevation at its final arrangement

**Goal:** Build Sheet, for a chunked Profile Sheet, draws the elevation
into the sheet copy at the caver's dragged arrangement — ties, pitch
labels, walls and all — instead of whatever the live drawing's own
auto-layout currently shows.

**Files:**
- Modify: `scripts/CaveSurvey/SheetSetup/SheetSetup.js` — the `draw`
  function, around `:1196-1207` (insert BEFORE `SheetSetup.frameBox(doc,
  "profile")` is measured and BEFORE `SheetSetup.eraseFrame` runs for
  the elevation sheet case)
- Test: `tests/sheet_setup_chunks.js` (append)

**Acceptance Criteria:**
- [ ] Building a chunked Profile Sheet with no chunk dragged produces
      the same tie count, box count and pitch-label text the live
      drawing's own Generate Profile already produces for that survey
      (auto-layout reproduced deterministically).
- [ ] Building a chunked Profile Sheet with one chunk dragged 5 inches
      right shows that chunk's real geometry offset accordingly in the
      output document, and every tie line touching it still lands on
      the SAME real station coordinates at both ends (no detached tie).
- [ ] The live, open drawing's own `ProfileChunkOffset` tags are
      unchanged after Build Sheet runs — this write only ever touches
      the sheet copy document.
- [ ] Building an extended or projected Profile Sheet is unaffected —
      this whole block only runs when `state.chunked === true`.

**Verify:** `node tests/sheet_setup_chunks.js` → all listed PASS lines print

**Steps:**

- [ ] **Step 1: Write the failing test**

Append to `tests/sheet_setup_chunks.js` (uses the same fixture-opening
pattern copied into Task 1's test):

```js
function testBuildSheetRegeneratesDraggedChunks() {
    var doc = CsTestFixture.openPlumblinePit();   // see Task 1 note
    var read = SheetSetup.readSurvey(doc);
    var offsets = {};
    // Drag the first chunk 5 inches right of wherever the auto-layout
    // put it -- the exact key depends on Plumbline Pit's own chunk
    // split; read it from CsProfile.build's own output in this test
    // rather than hard-coding a guessed key.
    var built = CsProfile.build(read.survey, read.resolved,
        { offsets: {} });
    var firstKey = built.bands[0].key;
    offsets["band:" + firstKey] = { x: 5, y: 0 };

    var sheetDoc = SheetSetup.buildChunkedElevation(doc, read.survey,
        read.resolved, offsets);   // see Step 2 -- new function this
                                    // task extracts so it is testable
                                    // without going through the whole
                                    // intoCopy/file-write pipeline

    var boxesBefore = CsProfileDraw.boxesFor(built,
        CsProfileDraw.BOX_MARGIN_FEET);
    var rebuilt = CsProfile.build(read.survey, read.resolved,
        { offsets: offsets });
    assertEqual(rebuilt.ties.length, built.ties.length,
        "dragging a chunk should not drop or duplicate a tie");
    print("PASS: dragging a chunk keeps its ties");
}
testBuildSheetRegeneratesDraggedChunks();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/sheet_setup_chunks.js`
Expected: FAIL — `SheetSetup.buildChunkedElevation` does not exist yet.

- [ ] **Step 3: Extract the regenerate step into its own function**

Read `SheetSetup.js` around `:1190-1220` in full first (this plan's
earlier exploration read `:1160-1380`, but re-read the CURRENT file
before editing — Tasks 1-3 may have shifted line numbers). Find the
`draw` function's `elevationSheet` branch, specifically the block:

```js
    var wrongFrame = elevationSheet ? "plan" : "profile";

    if (elevationSheet) {
        var elevBox = SheetSetup.frameBox(doc, "profile");
        if (elevBox !== null) {
            caveBox = elevBox;
        }
    }
    var dropped = SheetSetup.eraseFrame(doc, di, wrongFrame);
```

Add a new function above `SheetSetup.draw` (or wherever this file's
other `SheetSetup.*` helper functions are grouped — match the existing
file's grouping rather than appending at the end):

```js
/**
 * Redraws a chunked elevation into (doc, di) at the caver's chosen
 * per-chunk arrangement, in place of whatever chunked geometry is
 * already there.
 *
 * REGENERATED, NOT TRANSLATED. A tie line between two chunks is one
 * entity spanning both chunks' real coordinates, filed under a single
 * chunk's ProfileRun tag (CsProfileDraw.js:1436-1476) -- moving one
 * chunk's entities by that tag would drag the WHOLE tie with it,
 * stranding the end that belongs to the chunk that did not move. This
 * calls the same build+render pipeline Generate Profile already uses
 * on the live drawing, so every tie is computed fresh from each
 * chunk's TRUE final position.
 *
 * \param offsets {"band:<key>": {x, y}} in INCHES OF PAPER, the same
 *        shape CsSheetSetup.offsetOf reads elsewhere in this file --
 *        converted here to the DRAWING-UNIT, key-only shape
 *        CsProfile.build's own `offsets` option expects.
 * \return the CsProfile.build() result that was drawn, or null if this
 *         document has no chunked elevation to redraw.
 */
SheetSetup.buildChunkedElevation = function(doc, di, survey, resolved,
        offsets, scale) {
    if (isNull(survey) || isNull(resolved)) {
        return null;
    }
    var chunkOffsets = {};
    var k;
    for (k in offsets) {
        if (!offsets.hasOwnProperty(k) || k.indexOf("band:") !== 0) {
            continue;
        }
        var off = CsSheetSetup.offsetOf(offsets, k);
        // Sheet Setup's own offsets are in INCHES OF PAPER
        // (Core/CsSheetSetup.js:652-656); CsProfile.build's offsets
        // are in drawing units, the same units CsChunk.bands' own
        // auto-layout cursor already works in.
        chunkOffsets[k.substring("band:".length)] = off.x * (scale || 1);
    }
    var profileSettings = CsProfile.settings();
    var profile = CsProfile.build(survey, resolved,
        { flatSplayDeg: profileSettings.flatSplayDeg,
          offsets: chunkOffsets });
    SheetSetup.eraseFrame(doc, di, "profile");
    CsProfileDraw.render(doc, di, profile, {});
    return profile;
};
```

  `scale` here is drawing-units-per-inch-of-paper (the same `scale`
  value already in scope throughout `draw`/`build`, e.g. the parameter
  threaded from `SheetSetup.build`'s `CsSheetSetup.SCALES[...]` lookup
  at `:764`) — confirm the exact variable name in scope at the call
  site in Step 4 and pass it through rather than assuming a name.

  This function takes `di` explicitly (unlike some of this file's
  other helpers that only take `doc`) because `CsProfileDraw.render`
  needs a document interface to apply operations through — match
  whichever of `di`/`getDocumentInterface()` the surrounding `draw`
  function already has in scope at the insertion point in Step 4.

- [ ] **Step 4: Call it from `draw`, before the frame is measured**

Still inside the `if (elevationSheet) { ... }` block from Step 3's
context, change:

```js
    if (elevationSheet) {
        var elevBox = SheetSetup.frameBox(doc, "profile");
        if (elevBox !== null) {
            caveBox = elevBox;
        }
    }
    var dropped = SheetSetup.eraseFrame(doc, di, wrongFrame);
```

to:

```js
    if (elevationSheet) {
        if (opts.chunked === true && !isNull(opts.survey) &&
                !isNull(opts.resolved)) {
            SheetSetup.buildChunkedElevation(doc, di, opts.survey,
                opts.resolved, opts.offsets, scale);
        }
        var elevBox = SheetSetup.frameBox(doc, "profile");
        if (elevBox !== null) {
            caveBox = elevBox;
        }
    }
    var dropped = SheetSetup.eraseFrame(doc, di, wrongFrame);
```

  Confirm `draw`'s own parameter/option name for the object Tasks 1-3
  called `opts` at this exact call site (this file passes an options
  object through several layers — `SheetSetup.build` -> `intoCopy` ->
  `draw` — and the local variable name inside `draw` itself may differ
  from `opts`; read the function signature immediately before this
  block rather than assuming). Thread `chunked: w.state.chunked ===
  true` into the options object built by `SheetSetup.build`
  (`:767-775`, alongside `survey`/`resolved` from Task 1) so `opts.chunked`
  is actually populated by the time `draw` reads it here.

- [ ] **Step 5: Run test to verify it passes**

Run: `node tests/sheet_setup_chunks.js`
Expected: `PASS: dragging a chunk keeps its ties`, plus every earlier
task's PASS lines.

- [ ] **Step 6: Manual verification against a real cave**

This step has no automated assertion — run it and read the result
yourself before committing, since it is the one place this plan
touches the real Build Sheet file-writing path end to end rather than
calling `buildChunkedElevation` directly:

1. Open Plumbline Pit (or another chunked-mode cave) in CaveCAD.
2. `Cave Survey > Generate Profile`, choose Chunked.
3. `Cave Survey > Sheet Setup`, tick Elevation.
4. Drag two chunk boxes apart in the preview.
5. Build Sheet.
6. Open the written `<Cave> Profile Sheet.dxf` and confirm: the two
   chunks are apart exactly as dragged, every dashed tie line still
   touches a real station point at both ends, and the live drawing
   (still open, unsaved-elevation state) is untouched --
   `CaveSurvey/ProfileMode`/`ProfileChunkOffset` on the LIVE document
   read back exactly as they did before Build Sheet ran.

- [ ] **Step 7: Commit**

```bash
git add scripts/CaveSurvey/SheetSetup/SheetSetup.js tests/sheet_setup_chunks.js
git commit -m "feat: Build Sheet redraws a chunked elevation at its dragged arrangement"
```

---

## Task 5: Version bump, handbook note, publish

**Goal:** Ship it — bump the add-on version, tell the handbook about the
new drag behaviour, and publish per the standing rule that a Cave
Survey change is not done until it reaches CaveCAD.

**Files:**
- Modify: `VERSION` (repo root)
- Modify: `docs/handbook/pages/sheet-setup.html` (or
  `generate-profile.html`/`words-vertical.html` — whichever already
  documents chunked-elevation arrangement; check both, per this
  session's earlier reading, `sheet-setup.html`'s "Dragging, and what
  moves" section is the natural place)
- Run: `tools/publish.sh`

**Acceptance Criteria:**
- [ ] `VERSION` reads `0.9.178.0` (current is `0.9.177.0`; hold at
      `0.9.X`, increment the build segment, per `[[cave-survey-versioning]]`).
- [ ] The handbook says a chunked Profile Sheet's chunks can be dragged
      individually, and that the drag is sheet-only (does not persist
      to the live drawing).
- [ ] `tools/publish.sh` completes and installs into CaveCAD's
      per-user scripts folder.

**Verify:** `cat VERSION` → `0.9.178.0`; `./tools/publish.sh` → exits 0

**Steps:**

- [ ] **Step 1: Bump the version**

```bash
echo "0.9.178.0" > VERSION
```

- [ ] **Step 2: Update the handbook**

Read `docs/handbook/pages/sheet-setup.html`'s existing "Dragging, and
what moves" section (this session already read the full file; it ends
with "The furniture travels with the paper.") and add one short
paragraph after it, matching the page's existing voice, covering: a
chunked Profile Sheet gets one box per chunk instead of one box for
the whole elevation; each drags independently; the arrangement is
sheet-only, like every other drag on this page, and does not change
the live drawing's own chunked elevation.

- [ ] **Step 3: Run the full test suite**

Run: `bash tests/run_all.sh`
Expected: every stage passes, including the new
`sheet_setup_chunks.js` stage registered in Task 1.

- [ ] **Step 4: Commit**

```bash
git add VERSION docs/handbook/pages/sheet-setup.html
git commit -m "$(cat <<'EOF'
feat: 0.9.178.0 -- chunked profile sheets drag per chunk

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Publish**

```bash
./tools/publish.sh
```

Confirm it exits 0 and reports installing into CaveCAD's per-user
scripts folder and archiving to `~/Documents/Cave`.

---

## Self-review notes (2026-09-22)

- **Spec coverage:** every "Architecture changes" bullet in the design
  doc maps to a task here (MOVABLE/preview generalization → Task 2+3,
  commit-path regeneration → Task 4). The design doc's "Testing"
  section's four bullets are covered by the acceptance criteria across
  Tasks 3-4, though the exact test file structure here (one growing
  `sheet_setup_chunks.js` rather than several) reflects
  `[[cavecad-test-harness-traps]]`'s registration requirement more
  directly than the design doc spelled out.
- **Placeholder scan:** two steps (Task 3 Step 5's `RTextData`
  constructor, Task 4 Step 3/4's exact in-scope variable names for
  `scale`/`di`/the options-object variable name inside `draw`) are
  flagged explicitly as "confirm against the real file before trusting
  this" rather than asserted as fact, because this plan was written
  from targeted reads, not a full line-by-line read of every touched
  function. This is a deliberate, marked exception to "no placeholders"
  — the code shown is a correct, real starting point, not an invented
  stand-in, and the flag tells the implementer exactly what to verify
  and why before running with it.
- **Type consistency:** `"band:" + key` is used identically in Tasks
  2-4; `state.chunked` is introduced once (Task 3 Step 4) and consumed
  identically in Task 3 Step 3 and Task 4 Step 4.
- **Scope:** unchanged from the design doc — this plan does not touch
  open item 2 (plan depth cue) or `CsAdjust`.
