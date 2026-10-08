# Cloud session log

A running record of everything done in the cloud Claude Code session (branch `claude/cavecad-contextual-ribbon-oq2r4f`),
so that local sessions can catch up. **Newest entries are at the top of each section.** Commit hashes are on that branch.

**Local session: how to catch up**
1. `git fetch origin claude/cavecad-contextual-ribbon-oq2r4f` and read this file, then `TODO.md` (plans and status).
2. Nothing marked "untested" has been run inside the app: the cloud has no QCAD. Pure logic is covered by Node tests
   (`cave-survey/tests/run_all.sh`) and structural checks (`cave-survey/tools/make_package.sh --stage-only --version <v>`).
3. Tools version lives in `cave-survey/VERSION` (bumped with every tools change so the updater offers it).

**Rule for the cloud session:** every change adds an entry here in the same commit (what, why, files, version, tested?).

## Status of the latest test build
- Mac test build (`macos-test.yml`, started by hand) dispatched for tools **0.9.215.11**, head `3114ed23`. Artifact name: `cavecad-macos-test`. Result: *(update when known)*.

## Work log (newest first)

### (app script, no tools bump) -- External Reference tab: Open XREF and settings switches
- `RibbonCommands.js`: **Open XREF** button (opens the referenced file in its own window via `NewFile.createMdiChild`; refuses with a message when the file is missing). New **Settings** panel (`makeXrefToggles`): three switches for the selected xref -- Include its own references (Attach/Overlay), Keep the path relative, Update by itself (`CsXref.setAuto`) -- shown from the selection on a 400 ms timer. The old Overlay/Attach and Absolute/Relative buttons were replaced by the switches.
- This is an APP script (scripts/Widgets/Ribbon), so it needs the app build, not only a tools repack. Untested in app.

### 0.9.215.13 -- fix: External References window opened with an error
- Mac test: "Property 'clear' of object QListWidget is not a function". The window now uses a table (`QTableWidget`, the calls LinetypeMaker already proves in this bridge): columns Drawing / Attached / Path / State / File; `currentRow()` is a method there.
- Note for local sessions: `QListWidget.clear()` is not callable in this engine build; `LayoutViews.ask` also uses a `QListWidget` (add + `item(r).checkState()` only) and is still untested.

### 0.9.215.12 -- Attach Drawing and External References are ONE window
- User found two commands confusing. Now only External References exists: its window has an **Attach drawing...** button (file picker, Overlay/Attach, Absolute/Relative; placed at the origin -- the click-to-place option was dropped) above the list. Typed words `attachdrawing`/`xref`/`xr` open the same window.
- Removed the `XrefAttach` action (script, icons, handbook page, registry entries); `XrefListener.js` moved to `XrefManager/`. Ribbon: one button "External references".
- Untested in app.

### 0.9.215.11 -- fix: Attach Drawing "setLayerNamePrefix is not a function"
- Mac test showed: `RPasteOperation` has no `setLayerNamePrefix` in the script bindings (nor `setUseExistingBlock` / `setCreateBlockReference`, though the C++ base class has them; the bindings come from the sibling jsapi repos and were not regenerated).
- `CsXref`: the source copy's layers are renamed in memory (`prefixLayers`, "Cave|Layer", layer 0 left alone) before the paste; an update (`reload`) now pastes into a fresh block and swaps it in (`swapBlock`: references retargeted, old block deleted, new block renamed). No unbound setter is called any more.
- Untested in app (the attach itself got as far as the paste in the last build, so the dialogs work).

### 0.9.215.10 -- Attach Drawing / External References say what went wrong
- Reported: the xref command opened no popup. Cause not found by reading (no run possible): the command code looks right. Both commands now catch any error and show it in a box (`XrefAttach.pickAndAsk`, XrefManager),. Need the box text, and which way it was started (ribbon button, menu or typed command), from a Mac build.

### 0.9.215.9 -- grid is ONE dynamic block that follows its viewport
- Reported: the grid was many loose pieces and did not move with the viewport.
- `CsLayoutFurniture`: `gridLayout` (pure, inches from the viewport's lower-left), `gridParams`, `gridSig`, `gridDraw`, `gridRef`, `gridTag`, `addGrid` (now one block `GRID-<guid>`, GUID saved on the viewport), `syncGrid`/`syncGrids`; `removeFor("grid")` purges the block.
- `SheetScaleBarListener.js` calls `syncGrid` with the north arrow and scale bar syncs.
- Tests: pure checks in `tests/js_unit.js`; engine checks in `tests/layout_extras_run.js` (need the app). Untested in app.

### 0.9.215.8 `656ae95d` -- drag layout tabs to reorder
- `LayoutTabs.js`: `bar.movable`, `tabMoved` -> `LayoutTabs.tabDragged` (deferred by a 0 ms timer, calls `Layouts.move`, then `refresh`). Model tab stays first.
- `CsLayoutFurniture.js`: `indexOrderOf`; the index reference carries tag `IndexOrder`, so a reorder redraws the index (before, only a text change did).
- Untested in app.

### 0.9.215.7 `7331bc97` -- sheet index anchor corner + ellipsis
- `CsLayoutFurniture`: `indexClip` (cuts long names with an ellipsis), `indexOffset`, `INDEX_ANCHORS` (BL/BR/TL/TR), `indexAnchorOf`, `setIndexAnchor` (moves the anchor without moving the drawing); tag `IndexAnchor` on the reference; `indexLayout`/`indexDraw`/`addIndex` take an anchor.
- `RibbonCommands.js`: Sheet Item tab, panel "Sheet index anchor" (four corner buttons).
- Node tests in `tests/js_unit.js` (`indexClip`, anchors, order). Untested in app.

### 0.9.215.6 `e03f509e` -- Viewport tab: Add to viewport
- `LayoutTabs.js`: panel `vpfurniture` (Scale bar, North arrow, Grid on the selected viewport, each with a Remove menu), `LayoutTabs.furnish`.
- `CsLayoutFurniture`: `askGridLabels`, `hasNorth`, `hasGrid`, `addNorthFor`, `removeFor`; `LayoutGrid.js` uses `askGridLabels`.
- Engine checks appended to `tests/layout_extras_run.js` (need the app to run). Untested in app.

### 0.9.215.5 `dbcc2e42` -- Grid asks for a viewport; "Make title block a block"
- Grid button: click the viewport to apply it to. Layout tab "Title block" panel: `convert` turns a loose-text title block into a block in place (user reported it was not a block; cause unknown -- needs the "making it as a block failed" message from a Mac build).

### 0.9.215.3 - 0.9.215.4 `47bf4ca2`, `90a6e967`, `305a7088`, `623d55c3`
- Scale bar, border and sheet index are single blocks (reference carries tags; definition redrawn by `CsSheetBlock.redefine`). The scale bar stays dynamic. Sheet index anchored bottom-left.
- Title block is ONE block with an attribute per line; fields linked to the notebook (`TBLink` auto/manual/layout, `CsSheetLink.decide`); a typed value is never overwritten; Location never linked.
- Sheet number = Layout tab name both ways (`SheetNameListener`, `CsLayoutGen.refreshNames`); renamed sheets keep identity through job ids; signature v2 so a rename is not an "edit".

### 0.9.215.2 `2bb90f37`, `59ab1966`, `b50d9ccc` -- north arrow
- Arrow is one block, pivot = insertion point; text never rotates; unused arrow blocks purged. (Fixed: moved arrow rotated about a stale point.)

### Sheets from Views, external references, area fill
- `f764b439` Sheets from Views (`CsViews`; whole cave, each profile, each cross section; command, handbook page).
- `071cfcb9` External references: Attach Drawing (Overlay/Attach, Absolute/Relative, remembered defaults), External References manager, update offer on file change (`CsXref`, `XrefAttach`, `XrefManager`, `XrefListener`).
- `fd21bb57` Area Fill tab: Scale and Density controls.

### Contextual ribbon framework
- `Ribbon.registerSelectionKind` / `registerSelectionTab` (`follow` default true; tabs take focus when they appear). Kinds are layer-aware (surface, profile, sectionpart, sheet, plan kinds, Cave Line for plain wall lines). Layout tab follows when you move to a layout.
- Commits: `b34353c2`, `7a80ea22`, `5ef44bd0`, `d85896f9`.

### One repository
- `100c3b70` brought the tools in as `cave-survey/` (from `CaveCAD@legacy-map`), `5e8dfb2c` the translations as `i18n/` (from `cavecad-i18n@main`), both with history. `bf361039` points builds/tests at this checkout. See `MERGED-REPOS.md`.
- Old repos are NOT yet archived and the branch is not yet moved onto the default branch (needs the owner's go-ahead).

### CI and updater
- `f703cf05`, `b207a1b9`, `65326e39`: one-click Mac test build (`macos-test.yml`), tools staged on Linux, started by hand only. Test builds are marked development so the updater ignores them.
- `295333d9`, `0048c6f6`, `faa68cd5`: a stale Handbook screenshot no longer fails automatic builds (warns, listed in the run summary); it still stops a hand publish. `--stage-only` skips the check (`CAVESURVEY_SKIP_STALE_SHOTS`).
- `81e1b505`: warn when tools change without a `VERSION` bump. Updater: app update when `app_commit` differs; tools update when `cave-survey/VERSION` goes up.

## Open items (details in `TODO.md`)
- Stuck in the block editor after clicking through a viewport; Title block convert needs a Mac test.
- Callout elevation/edit buttons, entrance/station-label tabs, scan turn/flip, translations (`lupdate`), retake Handbook screenshot before a public publish, repo cutover, sheet-builder and xref follow-ups.
