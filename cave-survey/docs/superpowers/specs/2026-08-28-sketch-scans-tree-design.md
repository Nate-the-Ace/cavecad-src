# Sketch Scans folder tree — design

2026-08-28. Approved by Nathan in session before build.

## Problem

Since 0.9.10.0 Sketch Scans lists a cave's scans recursively, but as one
flat list of relative paths. Real caves nest scans per trip
(`scans/2025 Scans/9-7-25 Survey Scans/page.jpg`), and a cave with many
trips makes a long list. Nathan wants the folder hierarchy visible and
collapsible, so folders he is not working from get out of the way.

## Constraints (engine truths, all probed live)

- `new QTreeWidget()` / `new QListWidget()` are WRAPPER-ONLY stubs in
  this bridge — not constructible. QTableWidget is real. Same finding
  recorded in CaveShelf.js, Callout.js, PackageCave.js.
- QTableWidget wrapper has working `setRowHidden`, `isRowHidden`,
  `cellClicked`; QTableWidgetItem has `setFlags`, `setFont`.
- So the tree is SIMULATED: one-column table, folder rows with a
  `▾`/`▸` glyph and indentation, collapse = hiding descendant rows.

## Decisions (Nathan's answers)

- **All expanded on open.** Nothing hidden by surprise; collapse by hand.
- **Real nesting**, both folder levels shown; collapsing a year folder
  hides the whole year. No chain compression.
- **Collapsed state remembered per cave** across dialog opens, in
  RSettings (dialog closes after every insert, so state must survive).

## Shape

New Core file `Core/CsScanTree.js` — the pure half, node-testable:

- `CsScanTree.rowsOf(files)` — files = `CsCave.filesUnder` output
  (sorted relative paths). Returns rows in display order:
  `{kind: "folder"|"file", rel, depth, label}`. Folder rows emitted
  when first seen walking the sorted paths; depth = ancestor count;
  label = last path segment.
- `CsScanTree.isHidden(row, collapsedSet)` — hidden iff ANY strict
  ancestor folder is in the set. Gives standard tree semantics for
  free: expanding a parent re-hides nothing that a still-collapsed
  child folder owns.
- `CsScanTree.ancestorsOf(rel)` — the folder prefixes of a relative
  path.
- `CsScanTree.parseCollapsed(json)` / `serializeCollapsed(map)` —
  the settings value is one JSON object
  `{<scans abs path>: [collapsed relative folder paths]}` under key
  `CaveSurvey/SketchScansCollapsed`. Unparseable reads as empty.
  On save, entries for folders that no longer exist are dropped.

`SketchScans.js` renders: builds the table from `rowsOf`, keeps the
rows array parallel to table indices.

- Folder row: bold, `▾ `/`▸ ` prefix, indented two spaces per depth
  level, no tooltip; selecting it clears the preview pane.
- File row: filename only (context comes from ancestors), indented,
  tooltip + preview as today.
- Single click (cellClicked) or double click on a folder row toggles
  it: flip set membership, rewrite glyph, re-apply `setRowHidden`
  over all rows. Double click on a FILE row still inserts-and-aligns.
- `selectedFile()` returns null on folder rows, so Insert / Insert &
  Align refuse them silently (buttons no-op, same as no selection).
- Count label counts files, not folders.
- Collapsed set loaded before build, saved on every dialog exit path.

## Degradation

All Qt calls that the stock engine might lack stay in try/catch, house
style. A bridge without `setRowHidden` leaves the list flat and fully
expanded — glyph clicks do nothing, nothing crashes. The tool already
refuses engines without RImageData before any of this runs.

## Tests

Pure half in tests/js_unit.js, node-runnable: rowsOf nesting/depths/
order, top-level-only files, isHidden under parent and nested collapse,
ancestorsOf, settings JSON round-trip and bad-JSON fallback. Existing
engine-only filesUnder tests unchanged. GUI verify via the MCP bridge:
collapse hides rows, expand honors nested collapsed state, insert still
lands tagged on CTRL-SCAN, persistence survives reopen.
