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

### 3D View "needs a newer CaveCAD" -- CI builds had no `cave3d` global (C++ plugin patch)
- Cause: the 3D panel is C++ (`RCave3dBridge`), reached from scripts through a global `cave3d` that must be registered in qcadjsapi's `RScriptHandlerJs::init`. A local build had that edit in a local qcadjsapi; CI clones upstream `qcad/qcadjsapi` at a pinned commit plus `tools/qcadjsapi-cavecad.patch`, which only renamed things, so every CI-built app lacked `cave3d` and `cave3dRun` warned "3D View needs a newer CaveCAD".
- Fix: `tools/qcadjsapi-cavecad.patch` now also adds `#include "RCave3dBridge.h"` and registers `cave3d` (`RCave3dBridge::getInstance()`, CppOwnership set BEFORE `newQObject` so the engine's GC cannot delete the shared singleton) beside `qApp`. Checked: the whole patch applies cleanly to the pinned upstream commit (`git apply --check`). NOT compiled or run here. It changes the jsapi plugin, so it needs a FULL build on every platform (the Mac test fast path correctly refuses it).

### (app script) -- hardening viewport selection (second step)
- A NEW blank layout's viewports select fine; only the older layout (with sheet furniture) did not, so the old layout's items or state were catching the click. Besides `pickFix` (below), the Layout tab's Viewports panel now has **Select viewport**: a list of the layout's viewports (with their scales); picking one selects it, no clicking involved (`LayoutTabs.selectViewportMenu`). Untested in app.

### (app script) -- clicking inside a viewport selects it again
- Reported: on a layout, plain clicks do not select either viewport (Select All and double-click-through still work; the double click uses the same pick, so the viewport IS the closest thing at the click on a double click). Cause not found by reading. `LayoutTabs.pickFix` (called from `DefaultAction` when a click is released): a click inside a viewport selects that viewport unless something is really drawn within 4 px of the cursor; anything else that won the pick is passed over and named in the console ("Click passed over a ... on layer ... to reach the viewport"). Untested in app; the console line tells which sheet item was catching the click.
- VP Freeze (Layer Manager) was confirmed working by the user; the earlier "not working" was the unselectable viewport.

### (app script) -- Layer Manager: VP Freeze column placed after Freeze
- Reported: viewport-specific layer visibility "not working". The VP Freeze column exists (shown only while one viewport is selected or edited through) but was the LAST column, off the right edge of a docked palette. `RLayerTreeQt.applyColumnVisibility` now moves it to sit right after Freeze. Separate open problem: plain clicks cannot select viewports on a layout (Select All and double-click-through still work); cause not found yet (see conversation: suspects are block-style sheet items catching the click).

### 0.9.215.15 -- Sketch Scans: bottom buttons no longer stretched
- Reported (screenshot): the Plan/Profile/Cross Section tab buttons took far too much height. `SketchScans.js makePage` now puts a stretch on an empty last grid row and 4 px row spacing, and the tab widget has a Maximum vertical size policy, so the scan list and preview get the spare room. Untested in app (needs a Mac/other build; script-only, so the Mac fast path applies).

### CI -- Windows and Linux test builds with the tools (`desktop-test.yml`)
- New hand-started workflow: builds Windows x64+ARM64 (`windows.yml`) and Linux x86_64+aarch64 (`linux.yml`) from the branch, adds the tools, marks each package `app_commit: dev` (updater stays out) and uploads artifacts `cavecad-windows-test`, `cavecad-linux-test`, `cavecad-linux-arm-test`. It publishes nothing: no release, no `app-base`, no `latest.json` (those platform workflows only store a base on the `cavecad` branch). `assemble.yml` is the public path and is NOT used for tests.
- First run (run 37849911042, commit 78f888c7, tools 0.9.215.14): **all jobs succeeded in 32 min 2 s** (21:53:44Z-22:25:46Z). Linux x86_64 and aarch64 were done in ~10 min; Windows x64 ~26 min and Windows ARM64 ~31 min (the cavecadjsapi plugin step takes 11-14 min on Windows; ARM's updater test took 8.5 min). Artifacts: `cavecad-windows-test` (CaveCAD-windows-x64-test.zip, CaveCAD-windows-arm64-test.zip), `cavecad-linux-test` (CaveCAD-linux-x86_64-test.AppImage), `cavecad-linux-arm-test` (CaveCAD-linux-aarch64-test.AppImage). The "store-base" job was skipped, so nothing went to app-base / latest-build.
- The workflow was first started by a temporary `push` trigger (a brand-new workflow cannot be dispatched until GitHub has seen it run); the trigger was removed again in the next commit, so it is hand-started only. Next runs: Actions > Windows and Linux test build > Run workflow (dispatch works now).

### CI -- faster Mac test builds (no tools bump)
- Baseline (full test builds, runs 16/17): about 9-9.5 minutes. Biggest steps: cavecadjsapi plugin ~4 min, qtjsapi ~1.5, CaveCAD compile ~2 (ccache), Package ~1.7, Qt install ~0.6.
- `macos-test.yml`: a `plan` job decides FAST or FULL. FAST (only scripts/data/tools/docs changed since the last full test build) reuses that build's compiled app from the internal `test-app-base` release, replaces its scripts (stripped as the packaging step does), adds the tools and re-signs. FULL (anything else, no base yet, or the `full` input ticked) compiles as before and then stores the bare app as the new base. Test builds only; published builds are untouched.
- `macos.yml`: the Qt install is cached (`actions/cache`).
- Measured: FULL build 12 min 11 s (run 37842056754; earlier full builds were 9-9.5 min -- the cavecadjsapi plugin step swings between 3 and 5 min on the hosted runners); Qt cache hit saved ~25 s (restore 9 s vs install 33 s). FAST path 1 min 57 s (run 37843975870, nothing compiled, same commit family).
- The first full build with this workflow failed at the disk-image step twice with no message (`hdiutil create -quiet` hid it); a retry loop and visible output were added and the next full build passed. Cause unknown -- if it returns, the log now shows hdiutil's own message and free disk.
- Rules of thumb: script/tool/doc/data-only change -> FAST (~2 min); any C++, CMake, plugin, packaging-script or workflow change to macos.yml -> FULL (~10-12 min). Tick "Force a full build" when in doubt.

### 0.9.215.14 -- attached drawings are placed by entrance location, not raw file coordinates
- Cause of the "cave won't line up" complaint: every cave file has its own arbitrary local origin; Set Location only records lat/lon (only Pick on Drawing moves a cave). Attach used to put everything at 0,0.
- `CsGeoProject.drawingPointAtLatLon` (inverse of `latLonAtDrawingPoint`), `CsXref.offsetByLocation` (pure), `frameOf`, `placement`; `CsXref.attach` uses it unless `opts.at` is given; the Attach dialog has "Place it by its entrance location" (default on); the result says whether it was placed by location or at 0,0 and why. Update keeps each reference where it is.
- Both drawings need a georeference (GeoLat/GeoLon with the pinned drawing point GeoDrawX/Y, else the station's position); north is assumed up in both. Pure tests in `tests/js_unit.js`. Untested in app.

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
