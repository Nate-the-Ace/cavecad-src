# Chunked profile sheet boxes

2026-09-22. Closes open item 1 in `docs/vertical-caves.md` ("Chunks cannot
be dragged from the GUI yet") -- reframed during design, not solved as
originally scoped.

## The reframe

The open item as written asked for dragging a chunk's drawn geometry on
the live elevation, with a listener that notices the move and writes it
back into `ProfileChunkOffset`. That requires a live-document drag
listener, and this suite has already measured that pattern as unreliable
here -- see `[[cavecad-save-hook-inert]]`: an add-on's own prototype
wrappers have never once fired on a plain GUI save.

Sheet Setup already solves the adjacent problem -- a caver arranging
pieces on a page before committing to paper -- with a pattern proven safe:
a scratch `RMemoryStorage` document, an embedded `RGraphicsViewQt`
(`CsSheetView`), snap-to-edge/snap-to-centre dragging remembered in
inches of paper, and nothing written to the real drawing until **Build
Sheet** runs. Furniture (title block, scale bar, north arrow) and the
cave's own footprint already work this way.

The decision: a caver never needs to rearrange the chunked elevation on
the *working drawing* -- only on the *plotted sheet*, exactly the same
scope furniture already has. So this feature is not "make the live
elevation draggable." It is "give a chunked Profile Sheet one box per
chunk instead of one box for the whole cave," inside the tool that
already does exactly that kind of arranging.

## Scope

- Only `Cave Survey > Sheet Setup`, only the Profile Sheet, only when
  `CaveSurvey/ProfileMode` is `chunked`. The Plan Sheet and a non-chunked
  Profile Sheet are unchanged -- one "cave" box, as today.
- Ephemeral, like furniture. A caver's drag inside Sheet Setup affects
  only the sheet it builds. It is never written back into the live
  drawing's `ProfileChunkOffset`, and reopening Sheet Setup later starts
  the chunks back at their auto-layout position. Two arrangements can
  exist (the working elevation's own auto-row layout, and whatever a
  caver composed for the last plotted sheet) and that is accepted, not a
  bug -- the same way a furniture drag today does not change where
  anything sits in the working drawing.
- Not in scope: open item 2 (plan-view depth cue for stacked levels,
  separate spec), and `CsAdjust`'s isotropic weighting, which
  `docs/vertical-caves.md` rules out by an explicit architectural
  decision this feature does not revisit.

## What a chunk box is

- **Identity**: each box carries the same caption `CsProfileDraw`
  already generates for that chunk on the live elevation -- a pitch's
  depth label (`P 187 ft (62 + 125)`) for a drop or aven, the leading
  station's name for a passage piece. No new naming scheme.
- **Geometry**: box width and along-plane position come from
  `CsChunk.extentOf` on that chunk's band -- the same measured, walls-
  included extent the live elevation's own auto-layout already uses
  (`CsChunk.bands`, `Core/CsChunk.js`). Box height/vertical position
  comes from the band's own depth range, and is fixed -- depth is
  locked for a chunk everywhere else in this suite and stays locked
  here: a chunk box may only slide sideways in the preview, never up or
  down.
- **Starting position**: `CsChunk.bands(survey, resolved, chunks, {})`
  with no caver offsets, once, to seed the same auto-layout row a caver
  already sees on first Generate Profile. Matches "the first draw puts
  the pieces in a row" from `generate-profile.html`.
- **Final content**: Build Sheet does not copy and translate entities.
  It calls `CsChunk.bands(survey, resolved, chunks, {offsets})` again,
  this time with the caver's final per-chunk sideways deltas, and feeds
  the result through the same drawing routine `CsProfileDraw` already
  uses for the live elevation -- ties, pitch labels, walls, all of it --
  targeted at the sheet's own document. This is the existing, already-
  correct pipeline; nothing about chunk *geometry* is reinvented, only
  where its `offsets` map comes from.

## Architecture changes

1. **`CsSheetSetup.MOVABLE`** (today a fixed four-entry array: `cave`,
   `title`, `bar`, `north`) becomes sheet-dependent. For a chunked
   Profile Sheet: `title`, `bar`, `north`, plus one `chunk:<key>` per
   chunk, in place of the single `cave` entry. Every other sheet keeps
   the array as it is today.
2. **`CsSheetSetup.preview`** builds its item list with one hand-written
   `add()` call per named piece today. The chunk group needs a loop
   instead, since chunk count varies per cave (Pitfall Cave chunks to
   12 pieces per `docs/vertical-caves.md`). The four furniture `add()`
   calls are untouched.
3. **`CsSheetPreview.STYLE`** (`Core/CsSheetView.js`) and
   **`SheetSetup.PREVIEW_STYLE`** (the QPixmap fallback, `SheetSetup.js`)
   need a style entry for a chunk box, visually distinct from furniture,
   labelled with its caption per above.
4. **Snap and drag bookkeeping** (`CsSheetSetup.pickAt` / `snapLines` /
   `snapMove`, `SheetSetup.dragTo`, the `w.offsets` map) already operate
   generically on `{kind, box}` pairs and a `kind` string key --
   confirmed no structural change needed here, only that `chunk:<key>`
   values now flow through where `cave` used to be the only non-
   furniture kind.
5. **`SheetSetup.build` / `SheetSetup.draw`** (the commit path) needs a
   branch: when the sheet being built is a chunked Profile Sheet, skip
   the existing single-block copy-and-translate used for `cave`, and
   instead call `CsChunk.bands` with the caver's final offsets and hand
   the result to `CsProfileDraw`'s drawing routine targeted at the
   sheet's `RDocumentInterface`. The sheet's own overall placement (the
   "paper slides under it" placement every sheet already has) still
   applies once, to the assembly as a whole; each chunk's box offset is
   on top of that, exactly as `chunkOffset` already composes with a
   chunked elevation's own overall position on the live drawing.

## Testing

A new stage in `tests/run_all.sh`, `sheet_setup_chunks.js`:

- Chunk counts of 0 (no pitches -- falls back to today's single-box
  behaviour), 1, and N (Plumbline Pit, Pitfall Cave) all produce a
  `MOVABLE` list and preview with the right box count.
- A box's starting position matches `CsChunk.bands`' own auto-layout
  cursor for that chunk.
- Dragging and snapping two boxes together, then Build Sheet, produces
  the same tie lines, pitch labels and wall geometry the live elevation
  draws for those two chunks, just repositioned by the caver's deltas.
- Build Sheet never writes `ProfileChunkOffset` (or any tag) onto the
  live, open drawing -- only onto entities in the sheet's own scratch/
  output document.

Must be added to the hand-written test-include list per
`[[cavecad-test-harness-traps]]` -- a missing file passes silently
rather than failing.

## Assumptions made without the user present

Design was interrupted mid-brainstorm when the user stepped away with
"work automatically." These calls were made to keep moving rather than
block on questions with nobody there to answer them; flag for review
when Nathan is back:

- Depth axis is locked (matches every other chunk-depth rule in the
  suite already, very low risk).
- New chunk-box visual style is a plain labelled rectangle, no attempt
  to sketch the chunk's actual passage outline in the cheap interactive
  preview (matches how furniture and the existing `cave` footprint are
  already simplified in `CsSheetView`'s scratch-doc preview, per the
  explore agent's finding that the preview draws simplified boxes, not
  full detail).
- `chunk:<key>` as the `MOVABLE` kind string -- arbitrary choice, easy to
  rename if it collides with anything.
