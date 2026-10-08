# Linetype Maker — design

Date: 2026-09-28. Status: approved by Nathan ("A phased per C"; build with
minimal input).

## Goal

A CaveCAD tool that makes, edits and imports linetypes of three kinds —
**regular** (dash/gap/dot), **text** (a string drawn into the pattern) and
**shaped** (a glyph drawn into the pattern) — stored as TRUE DXF linetypes,
so a line stays one entity with a linetype assigned.

## Decisions

| Decision | Choice | Reason |
|---|---|---|
| Storage | Native DXF complex LTYPE | one entity per line; text linetypes open in any CAD |
| Glyph source | Draw in CaveCAD **and** import | Nathan has existing linetypes to reuse |
| Import formats | .lin, .shp, .shx, linetypes in a DXF | all four requested (DWG: only if the build can open it) |
| Library home | shipped set in the template; customs in `~/Documents/Cave/linetypes/`; pushed into the open drawing | the Symbol Palette lost a custom symbol within a day when customs lived in the template, because publish.sh replaces it |
| Glyph travel | embedded in each drawing | a Drive-shared cave must render on a friend's CaveCAD |
| Phasing | Phase 1 dashes+text, Phase 2 shapes | proves the DXF round trip before glyph machinery sits on it |
| Shaped Lines | untouched | its flip-side / closed-pit logic is not a linetype |

Out of scope: exploded-to-geometry export for non-CaveCAD recipients; a .shx
*compiler* (other CAD programs see only the dash skeleton of shape linetypes).

## Engine facts (read 2026-09-28, cavecad-src branch `cavecad`)

- `RLinetypePattern::setPatternString` parses complex `[...]` elements fully
  (text, style, S/R/X/Y) but returns false unless
  `RPluginLoader::hasPlugin("DWG")` — `src/core/RLinetypePattern.cpp:446`.
  CaveCAD has no DWG plugin, so every complex linetype is refused today.
- `updateShapes()` (~758) draws an element as a **shape** when its style ends
  `.shx`/`.shp` (`RFontList::get(style)->getShape(text)`), otherwise as
  **text** through `RTextRenderer` with the style used as the font name.
- JS bindings already expose `setPatternString`, `setShapeTextAt`,
  `setShapeTextStyleAt`, `setShapeScaleAt`, `updateShapes`, `getShapeAt`
  (qcadjsapi `rlinetypepattern_wrapper.h`) — no binding regeneration needed.
- dxflib: `DL_LinetypeData` holds only name/description/flags/dash count/
  length; the reader (`DL_Dxf::handleLinetypeData`) keeps only code 49; the
  writer emits `49` + `74 0` per dash. `RDxfExporter::writeLinetype`
  (`src/io/dxf/RDxfExporter.cpp:608`) passes dash lengths only.
- Table order on write: LTYPE (≈line 150) before STYLE (≈line 195). Handles
  are sequential (`DL_Writer::handle()`), so an LTYPE's 340 pointer to a STYLE
  handle must be reserved before the LTYPE table is written.
- On read, LTYPE records arrive before STYLE records, so 340 → style → font
  must be resolved after `dxflib.in()` returns (`RDxfImporter::importFile`).
- `DL_StyleData` does not carry the record handle (code 5); `DL_Dxf::
  addTextStyle` must be taught to read it.
- DXF code in `plugins/libcavecaddxf.dylib`; core in
  `debug/libcavecadcore.dylib`. Deploy = copy both into
  `/Applications/CaveCAD.app` then `codesign --force --deep --sign -`.
- dxflib line limit is fixed (0.6.0.1) but every new writer path still gets a
  long-value test.

## DXF encoding (per LTYPE element, after its `49`)

`74` flags (bit 1 = rotation absolute, bit 2 = text, bit 4 = shape);
`75` shape number (0 for text); `340` STYLE handle; `46` scale;
`50` rotation (degrees); `44`/`45` X/Y offset; `9` text string (text only).
Written only for elements that carry text/shape; plain dashes keep `74 0`.

The STYLE record a text element points at is `CS_LT_<FONT>` with primary font
file `<font>` (the font name the pattern names, e.g. `standard`); for shape
elements the file is `<shapefile>.shx` and the STYLE flag 1 (shape file) is set.

## Phase 1 — dashes + text

### Unit 1 — engine round trip (C++, cavecad-src)

- Remove the DWG gate at `RLinetypePattern.cpp:446`.
- dxflib: `DL_LinetypeData` gains a per-dash element vector; reader collects
  74/75/340/46/50/44/45/9 after each 49; writer emits them. `DL_StyleData`
  gains `handle` (read from 5; written when non-zero).
- `RDxfImporter`: keeps the raw elements per linetype; after `in()`, resolves
  340 → style record → font, and rebuilds each pattern with the complex parts
  (`setShapeTextAt`, `setShapeTextStyleAt`, scale, rotation, offset,
  `updateShapes`).
- `RDxfExporter`: before the LTYPE table, collect every style a linetype
  names, reserve handles for `CS_LT_*` STYLE records, write LTYPE elements
  with those handles, then append the `CS_LT_*` records to the STYLE table.
- VERSION bump, rebuild, deploy, re-sign.

### Unit 2 — `Core/CsLinetype.js` (pure)

- Model `{name, description, elements:[{kind:"dash"|"gap"|"dot"|"text"|"shape",
  length, text, style, scale, rotation, x, y}]}`.
- `toPattern`/`fromPattern` ⇄ .lin pattern strings; `parseLin`/`writeLin`
  for whole .lin files; `validate` → problems list.
- Node + engine js_unit coverage.

### Unit 3 — `Core/CsLinetypeStore.js` (engine)

- Library = template linetypes merged with the personal library
  `~/Documents/Cave/linetypes/CaveCustomLinetypes.lin` (customs win).
- `applyToDocument(doc, model)` adds or replaces an `RLinetype` in a document.
- `saveCustom(model)` writes the personal library only.
- Template pour pushes every custom linetype into the new drawing.

### Unit 4 — Linetype Maker dock (`LinetypeMaker` tool)

- Dock built hidden in `init()` and found by objectName; wiring per the
  add-on conventions; Qt widgets only.
- Library list (custom rows marked), name/description, element table
  (kind, length, text, style, scale, rotation, X, Y; add/remove/move),
  engine-rendered preview of a sample polyline, problems line from `validate`.
- Buttons: New, Duplicate, Delete (custom only), Save, Apply to Drawing,
  Import….

### Unit 5 — Import

- `.lin` via `CsLinetype.parseLin`; `.dxf` opened offscreen and its linetypes
  read back. Checkbox pick list; name clashes → rename/replace/skip.

### Unit 6 — handbook page + README row

## Phase 2 — shapes

### Unit 7 — `Core/CsShapeFont.js`

- CXF read/write with named glyphs; starter set (tick, double tick, chevron,
  dot, scallop, arrow, cross) shipped with the add-on.
- "Save selection as shape": selected lines/arcs/polylines normalized around a
  picked base point into `~/Documents/Cave/linetypes/CaveCustomShapes.cxf`,
  font list reloaded.

### Unit 8 — glyph embedding

- Glyphs used by a drawing's shape linetypes serialized into a document-level
  blob (layer XDATA dies on save), chunked well under the line limit, written
  when a linetype is applied or edited (the add-on save hook is inert).
- On open, glyphs registered with `RFontList` before the first regen. Test:
  open on a font list that lacks them; shapes still draw.

### Unit 9 — .shp / .shx importers

- Shared byte-code interpreter (vector length/direction bytes, special codes
  0–14) feeding CXF glyphs; `.shp` text parser, `.shx` binary reader
  (`AutoCAD-86 shapes 1.0/1.1`) via QTextStream Latin1.

### Unit 10 — engine shape elements

- `74` bit 4, `75` shape number, STYLE flagged shape-file; importer maps shape
  number → name via the embedded font.

## Testing

- `tests/linetype_roundtrip_run.js` (engine): text linetype → save DXF →
  reopen → pattern string and element values equal; hand-written DXF with a
  complex LTYPE read correctly; long text value survives.
- js_unit: CsLinetype (and later CsShapeFont) pure tests.
- `tests/linetype_maker_run.js` (engine): apply to drawing, library merge,
  template pour carries customs.
- Live over the MCP bridge: dock opens, preview renders, a line drawn with a
  text linetype survives save + reopen.
- Each phase ends with a 0.9.X patch bump and publish.sh.

## As-built (Phase 1, 0.9.182.0 + engine 0.9.5.0, 2026-09-28)

- **Engine traps found**: dxflib treated group code 9 as a record boundary
  everywhere, so an LTYPE's own text ended its record; now scoped to non-LTYPE
  records. R2000 `writeStyle` left code 3 empty (font only in ACAD XDATA);
  linetype styles now also write `<font>.shx` in code 3. ezdxf reads the
  output as a complex linetype with a resolving 340.
- **Script trap**: `doc.queryLinetype(name)` for a missing name returns a
  live-looking wrapper (`getId()` undefined), not null. Existence is read from
  `getLinetypeNames()` (`CsLinetypeStore.hasLinetype`).
- **Side effect of removing the DWG gate**: QCAD's stock complex linetypes
  (GAS_LINE, HOT_WATER_SUPPLY, ZIGZAG, ...) now parse and draw their text in
  every drawing; shape ones (ZIGZAG, `ltypeshp.shx`) draw only if that font
  exists.
- **Library**: template linetypes are not read; the picker lists the personal
  library, then the open drawing's own linetypes. The action does not require
  a document (the library is edited without one); Apply refuses a sheet.
- **Import dialog**: tick list only; a clash says "(replaces yours)" and
  ticking replaces. No rename step.
- **Menu**: 452/45 (`linetypemaker`, `ltm`); 452/50 was Symbol Palette's.
- **Live-verified** over the MCP bridge: dock built at startup, panel loads a
  linetype, `CS_WATER` applied to a new cave map draws its W's along a line.
