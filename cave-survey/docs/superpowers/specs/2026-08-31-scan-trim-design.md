# Scan Trim -- bounding a sketch before it is placed

Date: 2026-08-31
Status: approved design, not yet planned
Target version: 0.9.39.0 (patch bump; the suite stays at 0.9.X)

## The problem

A scan of a survey page is one image, but it is not always one sketch.
A caver photographs a notebook spread and gets three plan sketches on
it, or one small section drawing floating in the middle of a mostly
empty page. Sketch Scans places the WHOLE page as an image entity, so
the drawing gets the neighbouring sketches too. They overlap adjacent
survey, they cannot be moved independently, and the only remedy today
is to crop the file outside CaveCAD before importing it.

Scan Trim adds a step to the placement flow: bound the sketch you
actually want, and place only that.

## The constraint that shapes everything

`RImageData` (cavecad-src `src/entity/RImageData.h`) carries a file
name, an insertion point, u and v vectors, a pixel size and a fade. It
has NO clip boundary -- DXF's IMAGE clipping is not implemented in this
engine. So a crop cannot be a property of the placed entity.

The alternatives were adding clipping to the fork's C++ image entity
(large, touches renderer and DXF round trip) or writing a cropped
derivative image file and pointing the entity at that. This design
takes the derivative file. Trim is therefore purely a question of
WHICH PIXELS the image entity points at; nothing about placement,
fitting, frames, layers, fade or draw order changes.

## Where the box is drawn

In the existing Scan Shelf preview. That preview is already a real
QCAD view over a throwaway document holding the scan at ONE DRAWING
UNIT PER PIXEL (`SketchScans/ScanView.js`), which is what makes a
mapped model point equal to the pixel under the cursor -- the same
property the station picker already relies on.

`CsScanView` already overrides `mousePressEvent`, `mouseMoveEvent` and
`mouseReleaseEvent` (ScanView.js:67, :168, :198 -- the middle-button
pan), and those overrides are dispatched by the generated shell class,
so a genuine left-drag rubber band is available. No two-click fallback
is needed.

Behaviour:

- Left press starts the box, drag sizes it, release finishes it.
- The rubber band is a rectangle drawn in the throwaway preview
  document and updated on each move event; it is not an entity in the
  user's drawing and never reaches their undo stack.
- The rect is clamped to the image bounds and snapped to whole pixels.
- A box smaller than 20 px on either side is rejected as a stray click,
  leaving the previous state intact rather than trimming to nothing.
- Axis-aligned only. A sketch drawn crooked on the page still lands
  straight in the drawing, because the station fit rotates the placed
  image anyway; a rotatable box would buy tighter margins at the cost
  of resampling the pixels and a much larger picking UI.

## The step in the flow

Trim is not an optional side button. Selecting a scan row arms it:

- A bar under the preview reads
  `Trim: drag a box  ·  [Use whole page]  ·  [Redo box]`.
- Both placement buttons -- "Assign Stations to Scans" and
  "Insert & Align" -- stay disabled until either a box has been drawn
  or Use whole page has been pressed.
- Use whole page is one click and writes no file; the placement uses
  the original scan path exactly as it does today. A single-sketch page
  therefore costs one extra click and nothing else.
- Redo box discards the current box and re-arms the drag.

Trim state is per previewed scan and resets when the preview loads a
different row.

## The derivative file

`QImage.copy(rect)` on the loaded page, saved as PNG:

```
<scans>/Trimmed/<page-base>__TRIMMED_x120_y88_w900_h640.png
```

- Always PNG, lossless, even when the page is a JPG. A trimmed sketch
  is about to be traced over; re-encoding it as JPG for a second time
  is not worth the bytes saved.
- The rect lives IN THE FILENAME. An identical box on the same page
  therefore resolves to a file that already exists and is reused rather
  than written again, and there is no sidecar index that can drift out
  of step with the folder.
- `TRIMMED` in the name and a single `Trimmed/` subfolder are
  deliberate: derivatives are trivially identifiable and the whole
  folder can be deleted to reclaim space, at the cost of the placed
  images going missing until they are re-trimmed.
- `<page-base>` is the page's file name without its extension, with any
  character outside `[A-Za-z0-9._-]` replaced by `_` so a folder-bearing
  relative path cannot escape the Trimmed directory.

### Keeping them out of the shelf

`SketchScans.imageFiles` filters out any relative path whose first
segment is `Trimmed`, or which contains a `/Trimmed/` segment. The
filter goes there and NOT in `CsCave.filesUnder`, which is shared with
the photo tools and has no business knowing about this.

The shelf keeps listing pages, one row per page, exactly as before.

## What the placed entity records

- `SketchScan` keeps the ORIGINAL page's relative path, not the trimmed
  file's. The shelf's completion ticks are bookmarks keyed on the page's
  relative path (`SketchScans.loadBookmarks`), and `placedScales` finds
  our images by the presence of this tag; keeping the page name means a
  trimmed placement still marks its page done and still contributes its
  scale.
- A new `ScanTrim` tag holds `x,y,w,h` in the ORIGINAL page's pixels.
  Absent means the whole page was placed.
- `ScanAnchors` continues to be written in the placed image's own
  pixels, which for a trimmed placement is trimmed space. `ScanTrim` is
  what rebases those anchors back onto the page, which is what the
  revision framework needs to reconstruct or re-fit a placement later.
  Nothing in this change rebases them at read time; the tag exists so
  that a later reader CAN.

Everything else on the entity -- frame tag, frame key, station order,
layer, fade, draw order -- is written exactly as today.

## Every placement path

Four controls consume the selected scan's path, and all four are gated
on the trim choice and read it through ONE accessor,
`SketchScans.effectivePath(rel)`. A path built by hand anywhere else is
a path that will still place the whole page after the caver drew a box.

- `Insert` and `Insert & Align` (`SketchScans.insert`, then Align Image
  for the second) are handed the trimmed path and the rect.
- `Assign Stations to Scans` picks stations on the preview and places
  through `SketchScans.insertFitted`. Because the preview shows the
  trimmed image once a box is set, the picked pixel coordinates are
  already in trimmed space and the fit needs no adjustment.
- `Sketch Section` stages the trimmed image in its bay.

The preview reloads from the trimmed file as soon as a box is set, so
what the caver picks on is always what gets placed.

## Failure

- Unwritable `Trimmed/` folder -- a read-only Drive mount, a permission
  problem, a full disk -- BLOCKS the placement with a message naming the
  path that could not be written. It does not silently fall back to
  placing the whole page, because that would put the very clutter the
  caver was removing into the drawing without saying so.
- A page that `QImage` cannot read fails as it does today, before any
  trim UI is armed.
- `QImage.copy` returning a null image (out-of-memory on a very large
  page) reports the failure and leaves the placement blocked.

## Out of scope

- Multiple crops defined and remembered per page. To take a second
  sketch off the same page, preview the page again and draw another
  box; the derivative-per-rect naming means the second file sits
  alongside the first and both can be placed.
- Rotatable boxes.
- Any change to alignment, fitting, warp, frames or the scan tree.
- Garbage collection of `Trimmed/`. Deleting the folder is the caver's
  call and its consequence is documented above.

## Verification

- A page trimmed to a box places an image whose pixel size equals the
  box, on the right layer, with `SketchScan` still naming the page and
  `ScanTrim` naming the box.
- Use whole page writes nothing into `Trimmed/` and places the original
  path.
- The same box drawn twice on the same page writes one file.
- `Trimmed/` never appears in the Scan Shelf tree.
- A trimmed placement fitted to stations passes the existing
  round-trip check in `insertFitted`: each anchor run back through the
  placed image's own `mapFromImage` lands on its station.
