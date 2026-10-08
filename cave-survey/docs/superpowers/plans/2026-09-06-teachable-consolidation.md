# Teachable Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Cave Survey menu from 24 flat entries into 18 entries grouped into 6 named workflow stages, and add the teaching layer (a lesson cave, a written curriculum, and an in-app guided first run) that lets a student who has never used CAD draw a cave map start to finish.

**Architecture:** Six tool merges, each done the same way -- lift the shared logic into a `Core/Cs*.js` engine file, build one new tool folder that calls those engines, delete the old tool folders outright. Menu staging rides on an engine behaviour already present in CaveCAD: `RGuiAction::addToWidget` inserts a separator automatically whenever an action arrives carrying a `groupSortOrder` not yet in the widget (`src/core/RGuiAction.cpp:762`), and `fixSeparators` hides the trailing one. So assigning one `groupSortOrder` per stage produces a sectioned menu with no new UI code. The teaching layer is built last, on the final menu, so no lesson text is written twice.

**Tech Stack:** QCAD/CaveCAD ECMAScript add-on (`scripts/CaveSurvey/`), Qt widget bindings via the QCAD JS bridge, Python stdlib structural tests (`tests/test_addon.py`), headless engine suites driven by `CaveCAD -no-gui -autostart`, live GUI verification through the `cavecad` MCP bridge (`bridge/`).

**User decisions (already made):**
- Scope: "All of the above + in-app guided first run" -- the six merges, the staged menu, a student curriculum, a demo lesson cave, and a guided first-run panel inside CaveCAD.
- Compatibility: "Hard remove" -- old menu entries AND old typed commands (`et`, `cel`, `csync`, `sks`, `ali`, `sc`, `rsd`, `rsl`) are deleted, not aliased.
- Testing gate per task: "Headless + live + student dry run" -- `tests/run_all.sh --publish` green, a live GUI check through the cavecad MCP bridge on the Pitfall fixture, and Nathan personally running the merged tool once as a beginner would.

---

## Baseline facts this plan was written against

Verified in the working tree at `~/Documents/github/cavecad-tools`, branch `v2`, VERSION `0.9.51.0`:

- 24 tool folders under `scripts/CaveSurvey/` (a folder is a tool if and only if it contains `<Folder>.js`; `Core/` is a library and has none).
- Every tool registers with `action.setGroupSortOrder(450)` and a unique `action.setSortOrder(N)`, then `action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"])`. Nothing calls `EAction.addGuiActionTo`, so the `addSeparator` argument there is not the mechanism available to us -- `groupSortOrder` is.
- `tests/test_addon.py` (1456 lines) enumerates tool folders from disk and cross-checks: unique `(groupSortOrder, sortOrder)` pairs, an icon per tool, a status tip per tool (publish-only), a `setDefaultCommands` per tool, every include target existing, every `Core/` file being `Cs`-prefixed and included by `CsAll.js`, and every tool appearing in the README table (and no README row without a tool).
- `tests/run_all.sh` runs 21 stages; 17 need the real engine at `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD` and print SKIP without it. `--publish` turns a missing engine into a failure and enables the icon/status-tip checks.
- `tools/make_package.sh` holds `PARKED_TOOLS="TripFocus"` -- folders named there are stripped from a build. A parked tool must be absent from the README table (`test_a_parked_tool_is_absent_from_the_readme_table`).
- Clean engine seams already exist for the merges: `CsRestyle.ensureAndApply(doc, di)` returns `{changed, total, added}`; `RebuildSurveyData.rebuild(doc, di)` returns `{warning, dialog, message}`; `CalloutSync.run(doc, di)` returns a report string; `aerialBasemapRun()`, `surfaceContoursRun()`, `editTripRun()` are plain no-argument functions called from `beginEvent`.
- The `cavecad` MCP bridge exposes `cavecad_status`, `cavecad_eval`, `cavecad_screenshot`. Its hard rule: never call a modal `exec()` from an eval -- probe dialogs with `show()`, inspect, `close()`.

## The test-file preamble, written once

Five tasks add a headless engine suite. Every one of them opens with the same preamble, and no task repeats it -- extract it once, in Task 3, and copy it verbatim into each later suite:

```bash
sed -n '1,60p' tests/callout_sync.js > /tmp/cs-suite-preamble.txt
cat /tmp/cs-suite-preamble.txt
```

That block resolves the repository root from `RSettings.getOriginalArguments()` (the root is the last argument), includes `Core/CsAll.js` relative to it, opens a document interface on `templates/NSS_Cave_Template_PLAN.dxf`, and draws a fixture survey into it through `CsDraw.survey`. Where a later suite's steps say "same preamble as tests/callout_sync.js", paste that block and change only the fixture file it loads. The contract each suite ends on is the same too: print `### <NAME> OK` on success, or `FAILURES:` followed by the list -- `run_all.sh` greps for the OK token and nothing else.

## Final menu, after this plan

| Stage (`groupSortOrder`) | `sortOrder` | Entry | Origin |
| --- | --- | --- | --- |
| 450 Start here | 10 | Start Here... | NEW (Task 10) |
| 450 | 20 | Caves... | CaveShelf, unchanged |
| 450 | 30 | New Cave Map | CaveTemplate, unchanged |
| 451 Survey data | 10 | Survey Notebook | SurveyNotebook + EditTrip (Task 8) |
| 451 | 20 | Import Cave Survey | unchanged |
| 451 | 30 | Export Cave Survey | unchanged |
| 452 Draw the map | 10 | Feature Trace | unchanged |
| 452 | 20 | Decorate Selection | ShapedLines, unchanged |
| 452 | 30 | Scatter Breakdown | unchanged |
| 452 | 40 | Cross Section | CrossSection + SketchSection (Task 5) |
| 453 Put a reference under the map | 10 | Sketch Scans | SketchScans + AlignImage (Task 6) |
| 453 | 20 | Surface Data | AerialBasemap + SurfaceContours (Task 7) |
| 454 Finish the sheet | 10 | Survey Stats | unchanged |
| 454 | 20 | Generate Profile | unchanged |
| 454 | 30 | Build Legend | unchanged |
| 454 | 40 | Callout | Callout + CalloutElev (Task 4) |
| 455 Fix and share | 10 | Repair Drawing | RebuildSurveyData + RestyleLayers + CalloutSync (Task 3) |
| 455 | 20 | Package Cave Project... | unchanged |

Deleted outright: `EditTrip`, `CalloutElev`, `CalloutSync`, `SketchSection`, `AlignImage`, `RebuildSurveyData`, `RestyleLayers`, `SurfaceContours`. Deleted commands: `et`, `edittrip`, `cel`, `calloutelev`, `cscalloutelev`, `cselev`, `csync`, `calloutsync`, `cscalloutsync`, `cscsync`, `sks`, `sketchsection`, `ali`, `alignimage`, `sc`, `surfacecontours`, `rsd`, `rebuildsurveydata`, `rsl`, `restylelayers`.

**Explicitly out of scope:** the `Cave Lines` toolbar owned by ShapedLines (`lgf`, `lgc`, `pte`, `fst`, `rst`, `slp`, `shf`, `shs`). One button per NSS symbol is already the teachable shape; it is not in the Cave Survey menu and this plan does not touch it.

## File structure

New `Core/` engine files (pure-ish logic lifted out of tool files so the merged tools stay thin, and so `js_unit.js` can reach them):

- `Core/CsRebuild.js` -- `CsRebuild.rebuild(doc, di)`, lifted verbatim from `RebuildSurveyData.rebuild`.
- `Core/CsCalloutSync.js` -- `CsCalloutSync.run(doc, di)`, lifted verbatim from `CalloutSync.run`.
- `Core/CsRepair.js` -- `CsRepair.run(doc, di, opts)`, composes the three repair passes and returns one report.
- `Core/CsSurfaceData.js` -- `CsSurfaceData.basemap(...)` / `CsSurfaceData.contours(...)` wrappers over what AerialBasemap and SurfaceContours already do.
- `Core/CsGuide.js` -- lesson step model, progress detection, progress persistence.

New tool folders: `RepairDrawing/`, `SurfaceData/`, `StartHere/`.
Modified tool folders: `Callout/`, `CrossSection/`, `SketchScans/`, `SurveyNotebook/`, and every tool file's `init()` for its stage number.
Deleted tool folders: the eight listed above.
New docs: `docs/LESSONS.md`. New tooling: `tools/make_lesson_cave.js`.
New tests: `tests/repair_drawing_run.js`, `tests/surface_data_run.js`, `tests/callout_elev_mode.js`, `tests/section_merge_run.js`, `tests/guide_progress.js`, plus new cases inside `tests/test_addon.py`.

---

### Task 1: Lock the menu down with a test before changing it

**Goal:** A structural test that asserts the exact menu -- every tool's stage, position and command names -- so every later task's menu change is a deliberate edit to one table rather than a silent drift.

**Files:**
- Modify: `tests/test_addon.py` (add a new TestCase class at the end, before the `if __name__` block)

**Acceptance Criteria:**
- [ ] `MENU` table in the test lists all 24 current tools with their current `(groupSortOrder, sortOrder)` and their current command list
- [ ] Test fails loudly if a tool folder exists that the table does not name, or the table names a tool that does not exist
- [ ] Test fails if any tool's registered stage/position/commands differ from the table
- [ ] Suite is green against the tree as it stands today, before any merge

**Verify:** `python3 -m unittest tests.test_addon -v -k Menu` -> `OK`

**Steps:**

- [ ] **Step 1: Read how the existing tests scrape a tool's registration**

Run: `sed -n '370,400p' tests/test_addon.py`
Expected: the helpers `find_int(source, "action.setGroupSortOrder")` and `tool_source(name)` -- reuse both, do not write new scrapers.

- [ ] **Step 2: Write the failing test**

Append to `tests/test_addon.py`, above any `if __name__ == "__main__":` line:

```python
# The menu, as one table. Every tool's stage (groupSortOrder), position
# within the stage (sortOrder) and typed commands. A merge is meant to
# edit THIS and the tool together; a merge that edits only the tool
# fails here, which is the point.
#
# Stages: 450 start, 451 survey data, 452 draw, 453 reference,
# 454 finish, 455 fix and share.
MENU = {
    "CaveShelf":         (450, 1,  ["caves"]),
    "CaveTemplate":      (450, 5,  ["newcavemap", "ncm"]),
    "SurveyNotebook":    (450, 15, ["surveynotebook", "snb"]),
    "EditTrip":          (450, 16, ["edittrip", "et"]),
    "ImportCaveSurvey":  (450, 20, ["importcavesurvey", "ics"]),
    "ExportCaveSurvey":  (450, 21, ["exportcavesurvey", "ecs"]),
    "ShapedLines":       (450, 30, ["shapedlines", "shl"]),
    "ScatterBreakdown":  (450, 40, ["scatterbreakdown", "scb"]),
    "FeatureTrace":      (450, 45, ["featuretrace", "ft"]),
    "CrossSection":      (450, 46, ["crosssection", "cxs"]),
    "SketchSection":     (450, 47, ["sketchsection", "sks"]),
    "AerialBasemap":     (450, 52, ["aerialbasemap", "ab"]),
    "SurfaceContours":   (450, 54, ["surfacecontours", "sc"]),
    "SketchScans":       (450, 56, ["sketchscans", "ss"]),
    "AlignImage":        (450, 60, ["alignimage", "ali"]),
    "SurveyStats":       (450, 70, ["surveystats", "sst"]),
    "GenerateProfile":   (450, 75, ["generateprofile", "gp"]),
    "BuildLegend":       (450, 78, ["buildlegend", "bl"]),
    "RebuildSurveyData": (450, 85, ["rebuildsurveydata", "rsd"]),
    "Callout":           (450, 88, ["callout", "cal", "cscallout", "cscal"]),
    "CalloutElev":       (450, 90, ["calloutelev", "cel", "cscalloutelev", "cselev"]),
    "CalloutSync":       (450, 92, ["calloutsync", "csync", "cscalloutsync", "cscsync"]),
    "RestyleLayers":     (450, 94, ["restylelayers", "rsl"]),
    "PackageCave":       (450, 95, ["packagecave", "pc"]),
}


class TestMenuTable(unittest.TestCase):
    """The menu is a table, and the table is the spec."""

    def test_every_tool_is_in_the_table(self):
        missing = sorted(set(tool_names()) - set(MENU))
        self.assertEqual([], missing,
                         "tool folder exists but is not in MENU: %s" % missing)

    def test_table_names_no_tool_that_does_not_exist(self):
        extra = sorted(set(MENU) - set(tool_names()))
        self.assertEqual([], extra,
                         "MENU names a tool that does not exist: %s" % extra)

    def test_each_tool_registers_the_stage_and_position_in_the_table(self):
        for name, (group, order, _cmds) in sorted(MENU.items()):
            source = tool_source(name)
            self.assertEqual(
                group, find_int(source, "action.setGroupSortOrder"),
                "%s is in the wrong menu stage" % name)
            self.assertEqual(
                order, find_int(source, "action.setSortOrder"),
                "%s is in the wrong position within its stage" % name)

    def test_each_tool_registers_the_commands_in_the_table(self):
        for name, (_group, _order, cmds) in sorted(MENU.items()):
            source = tool_source(name)
            match = re.search(r"setDefaultCommands\(\[(.*?)\]\)", source, re.S)
            self.assertIsNotNone(match, "%s sets no commands" % name)
            found = re.findall(r'"([^"]+)"', match.group(1))
            self.assertEqual(cmds, found,
                             "%s registers the wrong commands" % name)
```

- [ ] **Step 3: Check the helpers this test assumes actually exist under those names**

Run: `grep -n "def tool_names\|def tool_source\|def find_int" tests/test_addon.py`
Expected: three definitions. If any is named differently in the file, rename the calls in the test above to match -- do not add a duplicate helper.

- [ ] **Step 4: Run the test against today's tree**

Run: `python3 -m unittest tests.test_addon -v -k Menu`
Expected: `OK` (4 tests). A failure here means the table transcription is wrong, not the code -- fix the table.

- [ ] **Step 5: Run the whole structural suite so nothing else regressed**

Run: `python3 -m unittest discover -s tests -v 2>&1 | tail -5`
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add tests/test_addon.py
git commit -m "test: pin the Cave Survey menu as a table before consolidating it"
```

---

### Task 2: Stage the menu

**Goal:** The menu reads as the workflow: six named stages, separated, in the order a student works. No tool merges yet -- only stage numbers change, so a failure here is unambiguous.

**USER-ORDERED GATE -- NON-SKIPPABLE.** This task was requested by the user in the current conversation. It MUST NOT be closed by walking around it, by declaring it "verified inline", or by substituting a cheaper check. Close only after every item in the acceptance criteria has been re-validated independently, with output captured.

**Files:**
- Modify: all 24 `scripts/CaveSurvey/<Tool>/<Tool>.js` (`setGroupSortOrder` and `setSortOrder` lines only)
- Modify: `tests/test_addon.py` (the `MENU` table)
- Modify: `README.md` (reorder the tool table into the same six stages, with a stage heading row per stage)

**Acceptance Criteria:**
- [ ] Every tool carries one of `450, 451, 452, 453, 454, 455` and the position from the table below
- [ ] `TestMenuTable` passes against the new table
- [ ] Live GUI: the Cave Survey menu shows 5 visible separators (the 6th, trailing, is hidden by `fixSeparators`) and entries appear in stage order
- [ ] README tool table is in the same order as the menu, with the stage names as headings

**Verify:** `./tests/run_all.sh --publish` -> `ALL TESTS PASSED`

**Steps:**

- [ ] **Step 1: Update the `MENU` table in `tests/test_addon.py` to the target staging**

Replace the `MENU` dict written in Task 1 with:

```python
MENU = {
    # 450 -- start here
    "CaveShelf":         (450, 20, ["caveshelf", "caves"]),
    "CaveTemplate":      (450, 30, ["newcavemap", "ncm"]),
    # 451 -- survey data
    "SurveyNotebook":    (451, 10, ["surveynotebook", "snb"]),
    "ImportCaveSurvey":  (451, 20, ["importcavesurvey", "ics"]),
    "ExportCaveSurvey":  (451, 30, ["exportcavesurvey", "ecs"]),
    "EditTrip":          (451, 40, ["edittrip", "et"]),
    # 452 -- draw the map
    "FeatureTrace":      (452, 10, ["featuretrace", "ft"]),
    "ShapedLines":       (452, 20, ["shapedlines", "shl"]),
    "ScatterBreakdown":  (452, 30, ["scatterbreakdown", "scb"]),
    "CrossSection":      (452, 40, ["crosssection", "cxs"]),
    "SketchSection":     (452, 50, ["sketchsection", "sks"]),
    # 453 -- put a reference under the map
    "SketchScans":       (453, 10, ["sketchscans", "ss"]),
    "AlignImage":        (453, 20, ["alignimage", "ali"]),
    "AerialBasemap":     (453, 30, ["aerialbasemap", "ab"]),
    "SurfaceContours":   (453, 40, ["surfacecontours", "sc"]),
    # 454 -- finish the sheet
    "SurveyStats":       (454, 10, ["surveystats", "sst"]),
    "GenerateProfile":   (454, 20, ["generateprofile", "gp", "genprofile"]),
    "BuildLegend":       (454, 30, ["buildlegend", "bl"]),
    "Callout":           (454, 40, ["callout", "cal", "cscallout", "cscal"]),
    "CalloutElev":       (454, 50, ["calloutelev", "cel", "cscalloutelev", "cselev"]),
    # 455 -- fix and share
    "RebuildSurveyData": (455, 10, ["rebuildsurveydata", "rsd"]),
    "RestyleLayers":     (455, 20, ["restylelayers", "rsl"]),
    "CalloutSync":       (455, 30, ["calloutsync", "csync", "cscalloutsync", "cscsync"]),
    "PackageCave":       (455, 40, ["packagecave", "pc", "pkgcave"]),
}
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `python3 -m unittest tests.test_addon -v -k Menu`
Expected: FAIL, ~22 assertion errors of the form `450 != 451 : SurveyNotebook is in the wrong menu stage`.

- [ ] **Step 3: Edit each tool's two registration lines to match**

For every tool in the table, change exactly the two lines in its `init()`:

```js
    action.setGroupSortOrder(451);
    action.setSortOrder(10);
```

Leave every other line -- `setScriptFile`, `setIcon`, `setStatusTip`, `setDefaultCommands`, `setWidgetNames` -- untouched. There are 24 files; the test names every one that is still wrong, so re-run it as you go.

- [ ] **Step 4: Run the test to verify it passes**

Run: `python3 -m unittest tests.test_addon -v -k Menu`
Expected: `OK`

- [ ] **Step 5: Reorder the README tool table into the six stages**

In `README.md`, under `## The tools`, split the single table into six, each preceded by a stage heading and one sentence naming when a student reaches it:

```markdown
### 1. Start here

You are opening CaveCAD for the first time, or starting a cave that does not exist yet.

| Tool | Command | What it does |
| --- | --- | --- |
| Caves | `caves` | ... (row moved unchanged) |
```

Move rows only. Do not reword any `What it does` cell in this task -- README wording is Task 11, and mixing the two makes the diff unreadable.

- [ ] **Step 6: Run the README consistency tests**

Run: `python3 -m unittest tests.test_addon -v -k readme`
Expected: `OK` -- `test_every_tool_appears_in_the_readme_table` and `test_readme_table_advertises_no_tool_that_does_not_exist` both still pass across the split tables. If the test parses a single table only, widen its regex to accept several tables rather than re-merging the README.

- [ ] **Step 7: Full headless suite**

Run: `./tests/run_all.sh --publish 2>&1 | tail -20`
Expected: `ALL TESTS PASSED`

- [ ] **Step 8: Live GUI check through the MCP bridge**

Publish the build and restart CaveCAD:

```bash
./tools/publish.sh
```

Then, with CaveCAD running, use the `cavecad` MCP tool `cavecad_eval` with this script (it only reads -- no modal `exec()`):

```js
var menu = RMainWindowQt.getMainWindow().findChild("CaveSurveyMenu");
var out = [];
var acts = menu.actions();
for (var i = 0; i < acts.length; i++) {
    out.push(acts[i].isSeparator()
        ? (acts[i].visible ? "---- separator ----" : "(hidden separator)")
        : acts[i].text);
}
out.join("\n");
```

Expected: entries in the Step 1 table order, with a visible separator between each stage and exactly one hidden separator at the end.

- [ ] **Step 9: Student dry run (Nathan)**

Open the Cave Survey menu cold and read it top to bottom. The question being answered is only: does the order match the order you would teach in? Note any entry you would move. If any move, edit the table and repeat from Step 3 before committing.

- [ ] **Step 10: Commit**

```bash
git add scripts/CaveSurvey tests/test_addon.py README.md
git commit -m "feat: group the Cave Survey menu into six named workflow stages"
```

---

### Task 3: Merge the three repair tools into Repair Drawing

**Goal:** One `Repair Drawing` entry replaces `Rebuild Survey Data`, `Restyle Layers` and `Callout Sync` -- a single dialog with a checkbox per pass and one combined report, so the answer to "which one do I run?" stops being "all three, in an order nobody documented".

**USER-ORDERED GATE -- NON-SKIPPABLE.** This task was requested by the user in the current conversation. It MUST NOT be closed by walking around it, by declaring it "verified inline", or by substituting a cheaper check. Close only after every item in the acceptance criteria has been re-validated independently, with output captured.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsRebuild.js`, `scripts/CaveSurvey/Core/CsCalloutSync.js`, `scripts/CaveSurvey/Core/CsRepair.js`
- Create: `scripts/CaveSurvey/RepairDrawing/RepairDrawing.js`, `RepairDrawing.svg`, `RepairDrawing-inverse.svg`
- Create: `tests/repair_drawing_run.js`
- Modify: `scripts/CaveSurvey/Core/CsAll.js`, `scripts/CaveSurvey/Callout/CalloutListener.js`, `tests/callout_sync.js`, `tests/js_unit.js`, `tests/run_all.sh`, `tests/test_addon.py`, `README.md`
- Delete: `scripts/CaveSurvey/RebuildSurveyData/`, `scripts/CaveSurvey/RestyleLayers/`, `scripts/CaveSurvey/CalloutSync/`

**Acceptance Criteria:**
- [ ] `CsRepair.run(doc, di, opts)` runs the selected passes in the order rebuild -> restyle -> callout sync and returns `{lines: [...], changed: bool}`
- [ ] Dialog defaults to all three passes checked; unchecking one skips it and its line says so
- [ ] `tests/callout_sync.js` passes against `CsCalloutSync.run` with no behaviour change
- [ ] `rsd`, `rsl`, `csync` and their long forms are gone -- typing one gives CaveCAD's unknown-command response
- [ ] New headless suite `repair_drawing_run.js` drives the tool's own run path on the Pitfall fixture

**Verify:** `./tests/run_all.sh --publish` -> `ALL TESTS PASSED`

**Steps:**

- [ ] **Step 1: Lift the two engines into `Core/`, unchanged**

```bash
cd ~/Documents/github/cavecad-tools/scripts/CaveSurvey
git mv RebuildSurveyData/RebuildSurveyData.js Core/CsRebuild.js
git mv CalloutSync/CalloutSync.js Core/CsCalloutSync.js
```

In `Core/CsRebuild.js`: delete the `function RebuildSurveyData(guiAction)` constructor, the `.prototype` lines, `rebuildSurveyDataRun()` and `RebuildSurveyData.init`. Keep the analysis functions. Rename the namespace object and every reference to it:

```bash
sed -i '' 's/\bRebuildSurveyData\b/CsRebuild/g' Core/CsRebuild.js
```

Add the namespace declaration at the top, after the file comment, because the constructor that used to create it is gone:

```js
var CsRebuild = {};
```

Do the same for `Core/CsCalloutSync.js`: delete the constructor, `.prototype` lines, `beginEvent` and `init`; keep `run` and its helpers; `sed -i '' 's/\bCalloutSync\b/CsCalloutSync/g'`; add `var CsCalloutSync = {};` at the top.

- [ ] **Step 2: Write `Core/CsRepair.js`**

```js
/**
 * CsRepair.js
 *
 * The three repair passes, run together and reported together.
 *
 * They were three menu entries once, which meant the honest answer to
 * "which one do I run?" was "all three, in this order" -- an order
 * nobody had written down. The order matters: rebuild first, because a
 * legacy drawing's tags have to be current before anything reads them;
 * restyle second, because rebuild can add layers; callout sync last,
 * because a restyle can move a note's layer out from under its arrows.
 */
var CsRepair = {};

/**
 * \param opts Object with boolean rebuild, restyle, callouts. A missing
 *             key means run that pass -- the dialog's default is all three.
 * \return {lines: Array of String, changed: Boolean}
 */
CsRepair.run = function(doc, di, opts) {
    if (isNull(opts)) {
        opts = {};
    }
    var lines = [];
    var changed = false;

    if (opts.rebuild !== false) {
        var r = CsRebuild.rebuild(doc, di);
        if (r.warning !== "") {
            lines.push(qsTr("Survey data: ") + r.warning);
        } else if (r.dialog !== "") {
            lines.push(qsTr("Survey data: ") + r.dialog);
            changed = true;
        } else {
            lines.push(qsTr("Survey data: ") + r.message);
            changed = true;
        }
    } else {
        lines.push(qsTr("Survey data: skipped."));
    }

    if (opts.restyle !== false) {
        var s = CsRestyle.ensureAndApply(doc, di);
        if (s.changed.length === 0 && s.added === 0) {
            lines.push(qsTr("Layers: already match the palette."));
        } else {
            lines.push(qsTr("Layers: %1 restyled, %2 added.")
                .arg(s.changed.length).arg(s.added));
            changed = true;
        }
    } else {
        lines.push(qsTr("Layers: skipped."));
    }

    if (opts.callouts !== false) {
        lines.push(qsTr("Callouts: ") + CsCalloutSync.run(doc, di));
        changed = true;
    } else {
        lines.push(qsTr("Callouts: skipped."));
    }

    return { lines: lines, changed: changed };
};
```

- [ ] **Step 3: Register the three new Core files with `CsAll.js`**

`test_every_core_file_is_included_by_csall` fails otherwise. Order matters -- `CsRepair` uses `CsRebuild`, `CsRestyle` and `CsCalloutSync`, so it is included after all three. Add after the existing `CsRestyle` include:

```js
include(includeBasePath + "/CsRebuild.js");
include(includeBasePath + "/CsCalloutSync.js");
// After CsRebuild, CsCalloutSync and CsRestyle: CsRepair calls all three.
include(includeBasePath + "/CsRepair.js");
```

- [ ] **Step 4: Point the callout listener at the moved engine**

Run: `grep -rn "CalloutSync" scripts/CaveSurvey/`
Expected: hits in `Callout/CalloutListener.js` and nowhere else after the moves. Change each `CalloutSync.` to `CsCalloutSync.` and delete any `include(...CalloutSync/CalloutSync.js)` -- `CsAll.js` loads it now.

- [ ] **Step 5: Write the new tool**

Create `scripts/CaveSurvey/RepairDrawing/RepairDrawing.js`:

```js
/**
 * RepairDrawing.js
 *
 * One entry for the three things that fix a drawing rather than draw in
 * it. The passes live in Core/CsRepair.js; this is the dialog and the
 * report.
 */
include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function RepairDrawing(guiAction) {
    EAction.call(this, guiAction);
}

RepairDrawing.prototype = new EAction();

RepairDrawing.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    repairDrawingRun();
    this.terminate();
};

function repairDrawingRun() {
    var doc = getDocument();
    if (isNull(doc)) {
        warning(qsTr("Repair Drawing: no active drawing document."));
        return;
    }
    var di = getDocumentInterface();

    var dlg = new QDialog(getMainWindow());
    dlg.windowTitle = qsTr("Repair Drawing");
    var layout = new QVBoxLayout();
    layout.addWidget(new QLabel(
        qsTr("Runs on the whole drawing. Nothing is moved or deleted.")),
        0, 0);

    var cbRebuild = new QCheckBox(
        qsTr("Survey data -- re-read the survey from the drawing's tags, "
           + "and bring an old drawing's tags up to date"));
    var cbRestyle = new QCheckBox(
        qsTr("Layers -- add any layer this drawing is missing, and put "
           + "the rest back on the current palette"));
    var cbCallouts = new QCheckBox(
        qsTr("Callouts -- put every note's arrows back on the note"));
    cbRebuild.checked = true;
    cbRestyle.checked = true;
    cbCallouts.checked = true;
    layout.addWidget(cbRebuild, 0, 0);
    layout.addWidget(cbRestyle, 0, 0);
    layout.addWidget(cbCallouts, 0, 0);

    var buttons = new QDialogButtonBox(QDialogButtonBox.Ok
                                     | QDialogButtonBox.Cancel);
    // .clicked/.accepted are signals on the wrapper; connect, do not assign.
    buttons.accepted.connect(dlg, "accept");
    buttons.rejected.connect(dlg, "reject");
    layout.addWidget(buttons, 0, 0);
    dlg.setLayout(layout);

    if (dlg.exec() !== QDialog.Accepted) {
        dlg.destroy();
        return;
    }
    var opts = {
        rebuild: cbRebuild.checked,
        restyle: cbRestyle.checked,
        callouts: cbCallouts.checked
    };
    dlg.destroy();

    var report = CsRepair.run(doc, di, opts);

    // QMessageBox, not handleUserMessage: the command line escapes the
    // text and wraps it in a <span>, so Qt reads it as rich text and
    // every newline collapses to a space.
    try {
        QMessageBox.information(getMainWindow(), qsTr("Repair Drawing"),
            report.lines.join("\n"));
    } catch (e) {
        EAction.handleUserMessage(report.lines[0]);
    }
}

RepairDrawing.init = function(basePath) {
    var action = new RGuiAction(qsTr("Repair Drawing"),
                                RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/RepairDrawing.js");
    action.setIcon(basePath + "/RepairDrawing.svg");
    action.setStatusTip(qsTr("Fix a drawing that is out of date or out "
        + "of step: survey tags, layer palette, callout arrows"));
    action.setDefaultCommands(["repairdrawing", "rep"]);
    action.setGroupSortOrder(455);
    action.setSortOrder(10);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
```

- [ ] **Step 6: Make the icons**

```bash
cd ~/Documents/github/cavecad-tools/scripts/CaveSurvey
cp RebuildSurveyData/RebuildSurveyData.svg RepairDrawing/RepairDrawing.svg
cp RebuildSurveyData/RebuildSurveyData-inverse.svg RepairDrawing/RepairDrawing-inverse.svg
```

If `RebuildSurveyData-inverse.svg` does not exist, list the folder and copy whichever inverse variant is there; `test_every_icon_is_parseable_svg` only requires valid SVG at the referenced path.

- [ ] **Step 7: Register the tool with the menu host**

`test_every_sibling_tool_is_included_and_initialised` requires it. Run `grep -n "RestyleLayers" scripts/CaveSurvey/CaveSurvey.js` to find how siblings are wired (if the host discovers folders automatically there will be no hit -- then nothing to do here). If there is an explicit list, replace the three deleted names with `RepairDrawing` in it.

- [ ] **Step 8: Delete the three old tools**

```bash
cd ~/Documents/github/cavecad-tools
git rm -r scripts/CaveSurvey/RebuildSurveyData scripts/CaveSurvey/RestyleLayers scripts/CaveSurvey/CalloutSync
```

- [ ] **Step 9: Update the menu table**

In `tests/test_addon.py`, delete the `RebuildSurveyData`, `RestyleLayers` and `CalloutSync` rows and add:

```python
    "RepairDrawing":     (455, 10, ["repairdrawing", "rep"]),
```

and renumber `PackageCave` to `(455, 20, ["packagecave", "pc", "pkgcave"])`.

- [ ] **Step 10: Repoint the existing callout-sync suite**

Run: `grep -n "CalloutSync" tests/callout_sync.js`
Then: `sed -i '' 's/\bCalloutSync\b/CsCalloutSync/g' tests/callout_sync.js` and fix any `include` in it that points at the deleted folder to `Core/CsCalloutSync.js`.

Run: `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/callout_sync.js "$PWD"`
Expected: `### CALLOUT-SYNC OK`

- [ ] **Step 11: Write the new headless suite**

Create `tests/repair_drawing_run.js`, modelled on `tests/callout_sync.js` (read that file first for the harness preamble it uses -- document creation, the `### NAME OK` contract, and the exit call):

```js
// repair_drawing_run.js -- drives CsRepair.run against a real document
// built from the Pitfall fixture, with each pass on and off.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/repair_drawing_run.js "$PWD"

// ... same preamble as tests/callout_sync.js: resolve repoRoot from
// RSettings.getOriginalArguments(), include Core/CsAll.js, open a
// document interface on templates/NSS_Cave_Template_PLAN.dxf, draw
// testdata/PitfallCave.dat into it ...

var failures = [];
function check(what, cond) {
    if (!cond) { failures.push(what); }
}

var all = CsRepair.run(doc, di, {});
check("all three passes report a line", all.lines.length === 3);
check("all three passes changed something", all.changed === true);

var none = CsRepair.run(doc, di,
    { rebuild: false, restyle: false, callouts: false });
check("skipping every pass changes nothing", none.changed === false);
check("a skipped pass says so",
      none.lines.join(" ").indexOf("skipped") !== -1);

var one = CsRepair.run(doc, di,
    { rebuild: false, restyle: true, callouts: false });
check("a single pass still reports all three lines", one.lines.length === 3);

if (failures.length === 0) {
    print("### REPAIR DRAWING OK");
} else {
    print("FAILURES:\n  " + failures.join("\n  "));
}
```

- [ ] **Step 12: Wire the suite into the runner**

In `tests/run_all.sh`, copy the CalloutSync stage block, change the script name, the banner text and the success token to `### REPAIR DRAWING OK`, then renumber every `N/21` banner to `N/22` -- the count is in the banner text of every stage and in `tests/README.md`.

Run: `./tests/run_all.sh 2>&1 | grep -c "/22"`
Expected: `22`

- [ ] **Step 13: Full headless suite**

Run: `./tests/run_all.sh --publish 2>&1 | tail -20`
Expected: `ALL TESTS PASSED`

- [ ] **Step 14: Live GUI check**

`./tools/publish.sh`, restart CaveCAD, open the Pitfall test cave. Through `cavecad_eval`, probe the dialog without blocking the GUI (never `exec()` from an eval):

```js
var found = [];
var dlg = new QDialog(RMainWindowQt.getMainWindow());
// Build the same three checkboxes the tool builds, to prove the widget
// classes exist in this build's bridge -- a wrapper-only widget is the
// GUI-only failure the headless suites cannot see.
var cb = new QCheckBox("probe");
found.push("QCheckBox " + (cb.checked === false));
var bb = new QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel);
found.push("QDialogButtonBox " + (typeof bb.accepted === "object"));
dlg.close();
found.join(", ");
```
Expected: `QCheckBox true, QDialogButtonBox true`.

Then run the tool for real from the menu and capture the result with `cavecad_screenshot`.

Then confirm the commands are gone:

```js
var gone = ["rsd", "rsl", "csync", "rebuildsurveydata", "restylelayers",
            "calloutsync"];
var still = [];
for (var i = 0; i < gone.length; i++) {
    if (!isNull(RGuiAction.getByCommand(gone[i]))) { still.push(gone[i]); }
}
still.length === 0 ? "all removed" : "STILL PRESENT: " + still.join(",");
```
Expected: `all removed`

- [ ] **Step 15: Student dry run (Nathan)**

Open a cave that needs repair. Run `Repair Drawing` once, reading only the dialog text. Answer: could a student tell, from the three checkbox labels alone, what each one does and whether it is safe? Note any wording that needed prior knowledge; fix the labels before committing.

- [ ] **Step 16: Commit**

```bash
git add -A scripts/CaveSurvey tests README.md
git commit -m "feat: merge Rebuild Survey Data, Restyle Layers and Callout Sync into Repair Drawing"
```

---

### Task 4: Merge Elevation Callout into Callout

**Goal:** One `Callout` entry. Where the text comes from -- typed, or read as a floor elevation at a picked point -- becomes a choice inside the tool instead of a second menu entry.

**USER-ORDERED GATE -- NON-SKIPPABLE.** This task was requested by the user in the current conversation. It MUST NOT be closed by walking around it, by declaring it "verified inline", or by substituting a cheaper check. Close only after every item in the acceptance criteria has been re-validated independently, with output captured.

**Files:**
- Modify: `scripts/CaveSurvey/Callout/Callout.js`
- Create: `tests/callout_elev_mode.js`
- Modify: `tests/run_all.sh`, `tests/test_addon.py`, `README.md`
- Delete: `scripts/CaveSurvey/CalloutElev/`

**Acceptance Criteria:**
- [ ] `Callout` opens on a source choice: "Type the note" (default) or "Floor elevation here"
- [ ] Elevation mode reproduces `CalloutElev` exactly: reads the floor from LRUD and splays via `CsCallout.elevLabel`/`CsCallout.elevStyle`, and stamps `LINE` on the label when it fell back to the survey line
- [ ] `cel`, `calloutelev`, `cscalloutelev`, `cselev` are gone
- [ ] `tests/callout_write.js` still passes unchanged

**Verify:** `./tests/run_all.sh --publish` -> `ALL TESTS PASSED`

**Steps:**

- [ ] **Step 1: Read both tools' state machines before touching either**

Run: `sed -n '1,80p' scripts/CaveSurvey/CalloutElev/CalloutElev.js` and `sed -n '30,120p' scripts/CaveSurvey/Callout/Callout.js`
Expected: two `State` enums and two `initState()` bodies. The merge keeps `Callout.State` and adds the elevation sampling step; it does not invent a new state machine.

- [ ] **Step 2: Write the failing test first**

Create `tests/callout_elev_mode.js`, modelled on `tests/callout_write.js`:

```js
// callout_elev_mode.js -- the elevation source inside Callout produces
// the same label CalloutElev used to, including the LINE fallback.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/callout_elev_mode.js "$PWD"

// ... same preamble as tests/callout_write.js ...

var failures = [];
function check(what, cond) { if (!cond) { failures.push(what); } }

// A point inside measured LRUD: label reads the floor, no LINE marker.
var atFloor = Callout.sampleElevation(doc, resolved, pointInPassage);
check("floor sample has a basis", !isNull(atFloor.basis));
check("floor sample is not the survey line",
      atFloor.basis !== CsCallout.BASIS_LINE);
check("label carries no LINE marker",
      CsCallout.elevLabel(atFloor, "").indexOf("LINE") === -1);

// A point with no LRUD to read: falls back to the line and says so.
var atLine = Callout.sampleElevation(doc, resolved, pointWithoutLrud);
check("fallback basis is the survey line",
      atLine.basis === CsCallout.BASIS_LINE);
check("fallback label says LINE",
      CsCallout.elevLabel(atLine, "").indexOf("LINE") !== -1);

if (failures.length === 0) {
    print("### CALLOUT ELEV MODE OK");
} else {
    print("FAILURES:\n  " + failures.join("\n  "));
}
```

- [ ] **Step 3: Run it and watch it fail**

Run: `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/callout_elev_mode.js "$PWD"`
Expected: FAIL -- `Callout.sampleElevation is not a function`.

- [ ] **Step 4: Move the sampling function across**

In `CalloutElev/CalloutElev.js`, find the function that turns a picked point into an elevation sample (the one whose result is passed to `CsCallout.elevLabel`). Copy it into `Callout/Callout.js` as `Callout.sampleElevation = function(doc, resolved, point) {...}`, unchanged apart from the name. Verify the exact name of the constant used for the fallback basis before relying on it:

Run: `grep -n "BASIS_FLOOR\|BASIS_LINE" scripts/CaveSurvey/Core/CsCallout.js`
Expected: both constants defined. If they are named differently, use the real names in both the test and the tool.

- [ ] **Step 5: Add the source choice to the tool's opening state**

At the top of `Callout.prototype.beginEvent`, before the first pick, ask once:

```js
    // Which source the note's text comes from. Two clicks either way --
    // this only decides whether the first click is a point to READ or a
    // place to PUT the note.
    var sourceDlg = new QDialog(getMainWindow());
    sourceDlg.windowTitle = qsTr("Callout");
    var v = new QVBoxLayout();
    var typed = new QRadioButton(qsTr("Type the note"));
    var elev = new QRadioButton(qsTr("Floor elevation here"));
    typed.checked = true;
    v.addWidget(typed, 0, 0);
    v.addWidget(elev, 0, 0);
    var bb = new QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel);
    bb.accepted.connect(sourceDlg, "accept");
    bb.rejected.connect(sourceDlg, "reject");
    v.addWidget(bb, 0, 0);
    sourceDlg.setLayout(v);
    if (sourceDlg.exec() !== QDialog.Accepted) {
        sourceDlg.destroy();
        this.terminate();
        return;
    }
    this.elevationMode = elev.checked;
    sourceDlg.destroy();
```

Then, in the state that handles the first picked coordinate, branch: in elevation mode call `Callout.sampleElevation` and build the text with `CsCallout.elevLabel(sample, suffix)` and the style with `CsCallout.elevStyle(sample)`; otherwise keep the existing typed-text path untouched.

- [ ] **Step 6: Run the test to verify it passes**

Run: `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/callout_elev_mode.js "$PWD"`
Expected: `### CALLOUT ELEV MODE OK`

- [ ] **Step 7: Delete the old tool and update the tables**

```bash
git rm -r scripts/CaveSurvey/CalloutElev
```

In `tests/test_addon.py`, delete the `CalloutElev` row. In `tests/run_all.sh`, add the new stage block (success token `### CALLOUT ELEV MODE OK`) and renumber the banners to `/23`.

- [ ] **Step 8: Full headless suite**

Run: `./tests/run_all.sh --publish 2>&1 | tail -20`
Expected: `ALL TESTS PASSED`

- [ ] **Step 9: Live GUI check**

`./tools/publish.sh`, restart, open the Pitfall cave. Place one typed callout and one elevation callout from the menu. Screenshot both. Then verify the removed commands with the `RGuiAction.getByCommand` probe from Task 3 Step 14, with the list `["cel", "calloutelev", "cscalloutelev", "cselev"]`.
Expected: `all removed`

- [ ] **Step 10: Student dry run (Nathan)**

Place one of each. Answer: does the two-option dialog read as a choice a beginner can make without knowing what LRUD is? If "Floor elevation here" needs a sentence of explanation, add it as a label under the radio buttons before committing.

- [ ] **Step 11: Commit**

```bash
git add -A scripts/CaveSurvey tests README.md
git commit -m "feat: fold Elevation Callout into Callout as a text source"
```

---

> **Revised 2026-09-06, before dispatch.** The plan assumed `SketchSection/` was one 2169-line file to be folded into `CrossSection.js`. It is three, with clean namespaces already: `SketchSection.js` (715, opens the bay), `SectionCapture.js` (918, closes it), `SectionEdit.js` (536, reopens a placed section). Merging them into one file would produce ~2400 lines and destroy a separation that is already correct. So the merge is at the MENU, not in the source: the three files move into `CrossSection/` as siblings, keep their namespaces (`SketchSection` renamed `SectionBay`, since it is no longer a tool), and lose only their three `init()` menu registrations. `CrossSection.js` grows a route dialog and the bay panel and stays under ~400 lines. Reopening a placed section becomes the dialog's third route rather than a hunt for the right click target.

### Task 5: Merge Sketch Section into Cross Section

**Goal:** One `Cross Section` entry with two ways to get a section -- cut it from the survey, or trace a scanned one -- and a small modeless panel that appears while a tracing bay is open, so `Capture Section` and `Edit Sketch` stop being commands a student has to know exist.

**USER-ORDERED GATE -- NON-SKIPPABLE.** This task was requested by the user in the current conversation. It MUST NOT be closed by walking around it, by declaring it "verified inline", or by substituting a cheaper check. Close only after every item in the acceptance criteria has been re-validated independently, with output captured.

**Files:**
- Modify: `scripts/CaveSurvey/CrossSection/CrossSection.js`
- Create: `scripts/CaveSurvey/CrossSection/SectionBayPanel.js`
- Create: `tests/section_merge_run.js`
- Modify: `scripts/CaveSurvey/SketchScans/SketchScans.js` (its "Sketch Section" button now calls into CrossSection), `tests/section_sketch_run.js`, `tests/run_all.sh`, `tests/test_addon.py`, `README.md`
- Delete: `scripts/CaveSurvey/SketchSection/` (after moving its logic to `Core/CsSectionBay.js` and `CrossSection/`)

**Acceptance Criteria:**
- [ ] `Cross Section` opens on a choice: "Cut it from the survey" (default) or "Trace a scanned section"
- [ ] Tracing opens the same bay `SketchSection` opened -- locked frame, scan, dashed LRUD ghost -- with no behaviour change; `tests/section_sketch_run.js` passes
- [ ] While a bay is open, a modeless panel offers `Capture` and `Cancel`; capture does what `skc` did, including the "nothing traced yet" refusal
- [ ] Reopening a placed sketched section (what `ske` did) is reachable by picking the placed block with `Cross Section` active
- [ ] `sks`, `skc`, `ske`, `sketchsection` are gone

**Verify:** `./tests/run_all.sh --publish` -> `ALL TESTS PASSED`

**Steps:**

- [ ] **Step 1: Map what SketchSection actually owns before moving anything**

Run: `grep -nE "^SketchSection\.[a-zA-Z]+ = function|setDefaultCommands" scripts/CaveSurvey/SketchSection/SketchSection.js`
Expected: `SketchSection.run(scanPath, station, calibration, scanSize)`, `SketchSection.init`, plus the capture and edit entry points and their command registrations. Write the list into the commit message later; it is the checklist for Steps 3-5.

- [ ] **Step 2: Write the failing test**

Create `tests/section_merge_run.js`:

```js
// section_merge_run.js -- both section routes live behind CrossSection,
// and the bay panel's capture path refuses an empty bay.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/section_merge_run.js "$PWD"

// ... same preamble as tests/section_sketch_run.js ...

var failures = [];
function check(what, cond) { if (!cond) { failures.push(what); } }

check("CrossSection owns the cut route",
      isFunction(CrossSection.cutFromSurvey));
check("CrossSection owns the trace route",
      isFunction(CrossSection.openBay));
check("CrossSection owns capture", isFunction(CrossSection.captureBay));
check("CrossSection owns reopen", isFunction(CrossSection.reopenPlaced));
check("SketchSection is gone", typeof SketchSection === "undefined");

var bay = CrossSection.openBay(doc, di, scanPath, "A3", null, null);
check("a bay opened", !isNull(bay));
var empty = CrossSection.captureBay(doc, di, bay);
check("capturing an empty bay is refused", empty.ok === false);
check("the refusal explains itself", empty.message.length > 0);

if (failures.length === 0) {
    print("### SECTION MERGE OK");
} else {
    print("FAILURES:\n  " + failures.join("\n  "));
}
```

- [ ] **Step 3: Run it and watch it fail**

Run: `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/section_merge_run.js "$PWD"`
Expected: FAIL -- `CrossSection.openBay is not a function`.

- [ ] **Step 4: Move the bay logic across**

Move every function from `SketchSection/SketchSection.js` that is not the EAction wiring into `CrossSection/CrossSection.js`, renaming the three entry points to `CrossSection.openBay`, `CrossSection.captureBay`, `CrossSection.reopenPlaced`. Anything that is pure geometry rather than tool flow goes to `Core/CsSectionBay.js` instead -- that file already exists and already holds `GAP`, `MARGIN` and `STEP`. Keep the existing `CrossSection` cut path as `CrossSection.cutFromSurvey`.

- [ ] **Step 5: Add the route choice**

In `CrossSection.prototype.beginEvent`, ask the same two-radio-button question as Task 4 Step 5 (same widget code, different labels):

```js
    var cut = new QRadioButton(qsTr("Cut it from the survey"));
    var trace = new QRadioButton(qsTr("Trace a scanned section"));
    cut.checked = true;
```

"Cut it from the survey" runs the existing two-click flow untouched. "Trace a scanned section" asks for the station and the scan, then calls `CrossSection.openBay`.

- [ ] **Step 6: Write the bay panel**

Create `scripts/CaveSurvey/CrossSection/SectionBayPanel.js`:

```js
/**
 * SectionBayPanel.js
 *
 * The two buttons that used to be commands. A bay is a mode -- something
 * is open and has to be closed -- and a mode with no visible way out is
 * the thing a beginner gets stuck in.
 *
 * Modeless on purpose: the caver traces with QCAD's own tools while it
 * is up, so it must never take the focus or block the document.
 */
var SectionBayPanel = {};

SectionBayPanel.dock = undefined;

SectionBayPanel.show = function(doc, di, bay) {
    var appWin = RMainWindowQt.getMainWindow();
    if (isNull(SectionBayPanel.dock)) {
        SectionBayPanel.dock = new QDockWidget(qsTr("Section bay"), appWin);
        SectionBayPanel.dock.objectName = "SectionBayPanel";
        var w = new QWidget();
        var v = new QVBoxLayout();
        v.addWidget(new QLabel(
            qsTr("Trace the section inside the frame, then press Capture.")),
            0, 0);
        var capture = new QPushButton(qsTr("Capture"));
        var cancel = new QPushButton(qsTr("Cancel"));
        v.addWidget(capture, 0, 0);
        v.addWidget(cancel, 0, 0);
        w.setLayout(v);
        SectionBayPanel.dock.setWidget(w);
        appWin.addDockWidget(Qt.RightDockWidgetArea, SectionBayPanel.dock);
        capture.clicked.connect(function() {
            var res = CrossSection.captureBay(doc, di, bay);
            if (!res.ok) {
                EAction.handleUserMessage(res.message);
                return;
            }
            SectionBayPanel.hide();
        });
        cancel.clicked.connect(function() {
            CrossSection.cancelBay(doc, di, bay);
            SectionBayPanel.hide();
        });
    }
    SectionBayPanel.dock.visible = true;
};

SectionBayPanel.hide = function() {
    if (!isNull(SectionBayPanel.dock)) {
        SectionBayPanel.dock.visible = false;
    }
};
```

Have `CrossSection.openBay` call `SectionBayPanel.show(doc, di, bay)` on success. Add `CrossSection.cancelBay(doc, di, bay)` if SketchSection had no equivalent -- it removes the frame, the scan and the ghost in one transaction, exactly as `captureBay` does before placing.

- [ ] **Step 7: Repoint SketchScans**

Run: `grep -n "SketchSection" scripts/CaveSurvey/SketchScans/SketchScans.js`
Expected: the "Sketch Section" button handler. Change its call to `CrossSection.openBay(...)` and its `include` to `includeBasePath + "/../CrossSection/CrossSection.js"`.

- [ ] **Step 8: Delete the old tool and update the tables**

```bash
git rm -r scripts/CaveSurvey/SketchSection
```
Delete the `SketchSection` row from `MENU`; renumber nothing else (CrossSection already sits at `(452, 40)`).

- [ ] **Step 9: Run both section suites**

Run: `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/section_sketch_run.js "$PWD"`
Expected: `### SECTION SKETCH OK` -- unchanged behaviour is the point; if this needed edits beyond renaming `SketchSection.` to `CrossSection.`, the move changed behaviour and must be corrected.

Run: `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/section_merge_run.js "$PWD"`
Expected: `### SECTION MERGE OK`

- [ ] **Step 10: Wire the new suite in and run everything**

Add the stage block to `tests/run_all.sh` (token `### SECTION MERGE OK`), renumber banners to `/24`.

Run: `./tests/run_all.sh --publish 2>&1 | tail -20`
Expected: `ALL TESTS PASSED`

- [ ] **Step 11: Live GUI check**

`./tools/publish.sh`, restart, open the Pitfall cave. Take one cut section and one traced section end to end. Screenshot the bay with the panel docked. Confirm the panel is modeless by drawing a line with QCAD's own line tool while it is open. Then run the removed-command probe with `["sks", "skc", "ske", "sketchsection"]`.
Expected: `all removed`

- [ ] **Step 12: Student dry run (Nathan)**

Trace one scanned section from the menu, using only what is on screen. Answer: was it obvious how to finish, and how to get out without finishing? That is the whole reason the panel exists; if either was unclear, fix the panel's wording before committing.

- [ ] **Step 13: Commit**

```bash
git add -A scripts/CaveSurvey tests README.md
git commit -m "feat: fold Sketch Section into Cross Section, with a bay panel instead of commands"
```

---

### Task 6: Fold Align Image into Sketch Scans

**Goal:** One entry for putting a scan under the drawing. `Align Image` becomes what it already is inside Sketch Scans -- the fitting step -- reachable for a file that is not in the cave's `scans/` folder.

**USER-ORDERED GATE -- NON-SKIPPABLE.** This task was requested by the user in the current conversation. It MUST NOT be closed by walking around it, by declaring it "verified inline", or by substituting a cheaper check. Close only after every item in the acceptance criteria has been re-validated independently, with output captured.

**Files:**
- Modify: `scripts/CaveSurvey/SketchScans/SketchScans.js`
- Create: `scripts/CaveSurvey/SketchScans/ScanAlign.js` (AlignImage's transform machinery, moved)
- Modify: `tests/align_image_frame.js`, `tests/test_align_math.js`, `tests/test_addon.py`, `README.md`
- Delete: `scripts/CaveSurvey/AlignImage/`

**Acceptance Criteria:**
- [ ] Sketch Scans panel gains an `Add a scan from elsewhere...` button that file-picks, inserts, and runs the same fit
- [ ] `ScanAlign` exposes the moved functions under their old names (`applyAffine`, `applyAffineToImage`, and the interactive picker), so `tests/align_image_frame.js` and `tests/test_align_math.js` pass with only the namespace renamed
- [ ] `ali`, `alignimage` are gone
- [ ] `Align Image` no longer appears in the menu or the README

**Verify:** `./tests/run_all.sh --publish` -> `ALL TESTS PASSED`

**Steps:**

- [ ] **Step 1: Confirm the fit code is already shared**

Run: `grep -n "CsScanFit" scripts/CaveSurvey/SketchScans/*.js scripts/CaveSurvey/AlignImage/AlignImage.js`
Expected: both use `Core/CsScanFit.js`. If SketchScans does NOT use it, this task is a genuine merge rather than a re-exposure -- read both paths fully before writing code, and keep `CsScanFit` as the single fit implementation.

- [ ] **Step 2: Move the tool file**

```bash
cd ~/Documents/github/cavecad-tools/scripts/CaveSurvey
git mv AlignImage/AlignImage.js SketchScans/ScanAlign.js
sed -i '' 's/\bAlignImage\b/ScanAlign/g' SketchScans/ScanAlign.js
```

In `ScanAlign.js`, keep the `Transform`-derived interactive class (it is the reference implementation for interactive tools in this suite -- do not flatten it), and delete only `ScanAlign.init`, since it no longer owns a menu entry.

- [ ] **Step 3: Include it from the panel and add the button**

In `SketchScans.js`, add `include(includeBasePath + "/ScanAlign.js");` beside the existing sibling includes, and add to the panel's button row:

```js
    w.elsewhereButton = new QPushButton(qsTr("Add a scan from elsewhere..."));
    w.elsewhereButton.toolTip = qsTr(
        "Insert and fit a scan that is not in this cave's scans folder.");
    w.elsewhereButton.clicked.connect(function() {
        var path = QFileDialog.getOpenFileName(
            RMainWindowQt.getMainWindow(),
            qsTr("Pick a scan"), "",
            qsTr("Images (*.png *.jpg *.jpeg *.tif *.tiff)"));
        if (isNull(path) || path.length === 0) {
            return;
        }
        ScanAlign.insertAndFit(path);
    });
```

Add `ScanAlign.insertAndFit(path)` as a thin function wrapping what `ScanAlign`'s `beginEvent` did after its own file pick -- do not duplicate the fitting logic.

- [ ] **Step 4: Repoint the two align tests**

```bash
cd ~/Documents/github/cavecad-tools
sed -i '' 's/\bAlignImage\b/ScanAlign/g' tests/align_image_frame.js tests/test_align_math.js
grep -rn "AlignImage" tests/ scripts/ || echo "no references left"
```
Expected: `no references left`. Fix any include path in those tests that still points at the deleted folder.

- [ ] **Step 5: Delete the tool folder and update the table**

```bash
git rm -r scripts/CaveSurvey/AlignImage
```
Delete the `AlignImage` row from `MENU`; renumber `AerialBasemap` to `(453, 20)` and `SurfaceContours` to `(453, 30)`.

- [ ] **Step 6: Run the align suites, then everything**

Run: `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/align_image_frame.js "$PWD"`
Expected: `### ALIGN IMAGE FRAME OK`

Run: `./tests/run_all.sh --publish 2>&1 | tail -20`
Expected: `ALL TESTS PASSED`

- [ ] **Step 7: Live GUI check**

`./tools/publish.sh`, restart, open the Pitfall cave. Insert a scan from the panel's normal route and one via `Add a scan from elsewhere...`; both must end fitted. Screenshot. Run the removed-command probe with `["ali", "alignimage"]`.
Expected: `all removed`

- [ ] **Step 8: Student dry run (Nathan)**

Put a scan under the drawing without touching the menu bar. Answer: is everything a student needs on the Sketch Scans panel now, or did you reach for something that is no longer there?

- [ ] **Step 9: Commit**

```bash
git add -A scripts/CaveSurvey tests README.md
git commit -m "feat: fold Align Image into the Sketch Scans panel"
```

---

### Task 7: Merge Aerial Basemap and Surface Contours into Surface Data

**Goal:** One `Surface Data` entry for everything that comes from above ground, with imagery and contours as two switches driven by the same geo station.

**USER-ORDERED GATE -- NON-SKIPPABLE.** This task was requested by the user in the current conversation. It MUST NOT be closed by walking around it, by declaring it "verified inline", or by substituting a cheaper check. Close only after every item in the acceptance criteria has been re-validated independently, with output captured.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsSurfaceData.js`
- Create: `scripts/CaveSurvey/SurfaceData/SurfaceData.js`, `SurfaceData.svg`, `SurfaceData-inverse.svg`
- Create: `tests/surface_data_run.js`
- Modify: `scripts/CaveSurvey/Core/CsAll.js`, `tests/run_all.sh`, `tests/test_addon.py`, `README.md`
- Delete: `scripts/CaveSurvey/AerialBasemap/`, `scripts/CaveSurvey/SurfaceContours/`

**Acceptance Criteria:**
- [ ] One dialog with two checkboxes -- aerial imagery, surface contours -- both defaulting on
- [ ] Both refuse the same way when the drawing has no geo station, once, before either does any network work
- [ ] `CsSurfaceData.run(doc, di, opts)` returns `{lines: [...], ok: bool}`
- [ ] `ab`, `aerialbasemap`, `sc`, `surfacecontours` are gone; the tool answers to `surfacedata` and `sd`

**Verify:** `./tests/run_all.sh --publish` -> `ALL TESTS PASSED`

**Steps:**

- [ ] **Step 1: Find the shared precondition**

Run: `grep -n "geo\|Geo" scripts/CaveSurvey/AerialBasemap/AerialBasemap.js scripts/CaveSurvey/SurfaceContours/SurfaceContours.js | head -20`
Expected: both resolve the drawing's geo anchor, probably via `CsGeoProject`. Note the exact call; the merged tool checks it once, up front.

- [ ] **Step 2: Move both engines into one Core file**

```bash
cd ~/Documents/github/cavecad-tools/scripts/CaveSurvey
git mv AerialBasemap/AerialBasemap.js Core/CsSurfaceData.js
```

In `Core/CsSurfaceData.js`: add `var CsSurfaceData = {};` at the top, delete the EAction wiring (`function AerialBasemap`, `.prototype`, `.init`), rename `aerialBasemapRun` to `CsSurfaceData.basemap = function(doc, di) {...}` returning a report string instead of calling `EAction.handleUserMessage`. Then append the body of `surfaceContoursRun` from `SurfaceContours/SurfaceContours.js` as `CsSurfaceData.contours = function(doc, di) {...}`, same treatment, along with every helper it needs. Add the composer:

```js
/**
 * \param opts Object with boolean imagery, contours. Missing means yes.
 * \return {lines: Array of String, ok: Boolean}
 */
CsSurfaceData.run = function(doc, di, opts) {
    if (isNull(opts)) {
        opts = {};
    }
    // Checked ONCE, before either pass: both need the geo anchor, and a
    // student who has not set one should be told that before anything
    // reaches for the network.
    var anchor = CsGeoProject.anchorOf(doc);
    if (isNull(anchor)) {
        return {
            ok: false,
            lines: [qsTr("This drawing has no location yet. Set one in "
                + "Survey Notebook > Declination, then run this again.")]
        };
    }

    var lines = [];
    if (opts.imagery !== false) {
        lines.push(qsTr("Aerial: ") + CsSurfaceData.basemap(doc, di));
    } else {
        lines.push(qsTr("Aerial: skipped."));
    }
    if (opts.contours !== false) {
        lines.push(qsTr("Contours: ") + CsSurfaceData.contours(doc, di));
    } else {
        lines.push(qsTr("Contours: skipped."));
    }
    return { ok: true, lines: lines };
};
```

Verify the anchor accessor's real name before relying on it:

Run: `grep -nE "^CsGeoProject\.[a-zA-Z]+ = function" scripts/CaveSurvey/Core/CsGeoProject.js`
Expected: the function that returns the drawing's geo station; use its actual name in place of `anchorOf`.

- [ ] **Step 3: Write the tool**

Create `scripts/CaveSurvey/SurfaceData/SurfaceData.js` using the Task 3 `RepairDrawing.js` file as the template -- same EAction shape, same dialog construction, same `QMessageBox` report. Differences: two checkboxes (`Aerial photograph of the surface`, `Surface elevation contours`), title `Surface Data`, status tip `Put the surface above the cave into the drawing: aerial photograph, elevation contours, or both`, commands `["surfacedata", "sd"]`, `setGroupSortOrder(453)`, `setSortOrder(20)`. When `CsSurfaceData.run` returns `ok: false`, show its single line and stop.

- [ ] **Step 4: Icons and includes**

```bash
cp AerialBasemap/AerialBasemap.svg SurfaceData/SurfaceData.svg
cp AerialBasemap/AerialBasemap-inverse.svg SurfaceData/SurfaceData-inverse.svg
```
Add `include(includeBasePath + "/CsSurfaceData.js");` to `Core/CsAll.js`, after `CsGeoProject`.

- [ ] **Step 5: Write the test**

Create `tests/surface_data_run.js`, same preamble pattern as Task 3's:

```js
var failures = [];
function check(what, cond) { if (!cond) { failures.push(what); } }

// A drawing with no geo anchor: one refusal, no network work.
var bare = CsSurfaceData.run(docWithoutAnchor, di, {});
check("no anchor is refused", bare.ok === false);
check("the refusal is one line", bare.lines.length === 1);
check("the refusal says where to set a location",
      bare.lines[0].indexOf("Declination") !== -1);

// An anchored drawing, both passes off: reports both as skipped.
var skipped = CsSurfaceData.run(docWithAnchor, di,
    { imagery: false, contours: false });
check("anchored drawing is accepted", skipped.ok === true);
check("both passes report skipped",
      skipped.lines.join(" ").split("skipped").length === 3);

if (failures.length === 0) {
    print("### SURFACE DATA OK");
} else {
    print("FAILURES:\n  " + failures.join("\n  "));
}
```

Both passes are switched off deliberately: imagery and contours fetch from the network, and a test suite must not depend on a tile server being up. The fetching paths keep whatever coverage they have today.

- [ ] **Step 6: Delete the two tools, update tables, wire the suite**

```bash
git rm -r scripts/CaveSurvey/AerialBasemap scripts/CaveSurvey/SurfaceContours
```
In `MENU`: delete both rows, add `"SurfaceData": (453, 20, ["surfacedata", "sd"])`. Add the stage block to `tests/run_all.sh` (token `### SURFACE DATA OK`), renumber banners to `/25`.

- [ ] **Step 7: Full headless suite**

Run: `./tests/run_all.sh --publish 2>&1 | tail -20`
Expected: `ALL TESTS PASSED`

- [ ] **Step 8: Live GUI check**

`./tools/publish.sh`, restart. On a drawing with no geo station, run `Surface Data` and confirm the single refusal. On the Pitfall cave with its station set, run it with both boxes ticked and screenshot the result. Removed-command probe: `["ab", "aerialbasemap", "sc", "surfacecontours"]`.
Expected: `all removed`

- [ ] **Step 9: Student dry run (Nathan)**

Run it on a drawing with no location set. Answer: does the refusal tell a beginner exactly what to do next, in words they have already met in the menu? It names `Survey Notebook > Declination` -- confirm that is still where a location gets set after Task 8.

- [ ] **Step 10: Commit**

```bash
git add -A scripts/CaveSurvey tests README.md
git commit -m "feat: merge Aerial Basemap and Surface Contours into Surface Data"
```

---

### Task 8: Fold Edit Trip into Survey Notebook

**Goal:** The Notebook already shows trips; make its trip header editable and delete the separate entry, so trip metadata is corrected where it is displayed.

**USER-ORDERED GATE -- NON-SKIPPABLE.** This task was requested by the user in the current conversation. It MUST NOT be closed by walking around it, by declaring it "verified inline", or by substituting a cheaper check. Close only after every item in the acceptance criteria has been re-validated independently, with output captured.

**Files:**
- Modify: `scripts/CaveSurvey/SurveyNotebook/SurveyNotebook.js`
- Create: `scripts/CaveSurvey/SurveyNotebook/TripEdit.js` (EditTrip's dialog, moved)
- Modify: `tests/edit_trip_run.js`, `tests/test_addon.py`, `README.md`
- Delete: `scripts/CaveSurvey/EditTrip/`

**Acceptance Criteria:**
- [ ] Notebook's `...` menu gains `Edit this trip...`, opening the moved dialog for the loaded trip
- [ ] The dialog still edits by trip identity (not by date-and-team match), and still refuses to delete a trip a later trip ties into
- [ ] `tests/edit_trip_run.js` passes with only the namespace renamed
- [ ] `et`, `edittrip` are gone

**Verify:** `./tests/run_all.sh --publish` -> `ALL TESTS PASSED`

**Steps:**

- [ ] **Step 1: Confirm the identity-edit engine is already shared**

Run: `grep -n "CsTripEdit" scripts/CaveSurvey/EditTrip/EditTrip.js scripts/CaveSurvey/SurveyNotebook/*.js`
Expected: `EditTrip` is a dialog over `Core/CsTripEdit.js` (769 lines). Only the dialog moves; the engine stays where it is.

- [ ] **Step 2: Move the dialog**

```bash
cd ~/Documents/github/cavecad-tools/scripts/CaveSurvey
git mv EditTrip/EditTrip.js SurveyNotebook/TripEdit.js
sed -i '' 's/\bEditTrip\b/TripEdit/g' SurveyNotebook/TripEdit.js
```
Delete `TripEdit.init` and the `EAction` wiring; keep `editTripRun` renamed to `TripEdit.open = function(tripId) {...}`, taking the trip to edit rather than asking for one when the Notebook already knows it. Keep the no-argument path (ask which trip) for the case where nothing is loaded.

- [ ] **Step 3: Add the menu item to the Notebook**

Run: `grep -n "moreMenu.addAction" scripts/CaveSurvey/SurveyNotebook/SurveyNotebook.js`
Expected: the existing `...` menu actions (`Import File...`, `Export File...`, `Load from drawing`, `Redraw All`). Add beside them:

```js
    w.editTripAction = w.moreMenu.addAction(qsTr("Edit this trip..."));
    w.editTripAction.triggered.connect(function() {
        TripEdit.open(SurveyNotebook.loadedTripId());
    });
```

Add `SurveyNotebook.loadedTripId()` returning the id of the trip the page was loaded from, or `undefined` when the page was typed fresh -- check first whether the Notebook already tracks this under another name:

Run: `grep -n "tripId\|loadedTrip" scripts/CaveSurvey/SurveyNotebook/SurveyNotebook.js | head`

Add `include(includeBasePath + "/TripEdit.js");` beside the Notebook's other sibling includes.

- [ ] **Step 4: Repoint the test**

```bash
cd ~/Documents/github/cavecad-tools
sed -i '' 's/\bEditTrip\b/TripEdit/g' tests/edit_trip_run.js
```
Fix its include to `SurveyNotebook/TripEdit.js`.

Run: `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/edit_trip_run.js "$PWD"`
Expected: `### EDIT TRIP RUN OK` (use whatever token that file already prints)

- [ ] **Step 5: Delete the tool and update the table**

```bash
git rm -r scripts/CaveSurvey/EditTrip
```
Delete the `EditTrip` row from `MENU`.

- [ ] **Step 6: Full headless suite**

Run: `./tests/run_all.sh --publish 2>&1 | tail -20`
Expected: `ALL TESTS PASSED`

- [ ] **Step 7: Live GUI check**

`./tools/publish.sh`, restart, open the Pitfall cave. In the Notebook, `Load from drawing`, then `Edit this trip...`, change the team, apply. Confirm through `cavecad_eval` that the trip count did not change (the old bug this replaced was forking a trip into a duplicate):

```js
var doc = csDoc();
CsModel.tripsOf(doc).length;
```
Expected: the same number before and after the edit. Confirm the accessor's real name first with `grep -nE "^CsModel\.[a-zA-Z]+ = function" scripts/CaveSurvey/Core/CsModel.js`.

Removed-command probe: `["et", "edittrip"]`. Expected: `all removed`.

- [ ] **Step 8: Student dry run (Nathan)**

Correct a trip's date from inside the Notebook. Answer: was it findable without knowing it used to be its own tool?

- [ ] **Step 9: Commit**

```bash
git add -A scripts/CaveSurvey tests README.md
git commit -m "feat: fold Edit Trip into the Survey Notebook's trip menu"
```

---

### Task 9: The lesson cave

**Goal:** A generated, invented cave the curriculum can be taught against -- small enough to survey in one sitting, rich enough to need every stage of the menu.

**Files:**
- Create: `tools/make_lesson_cave.js`
- Create: `testdata/LessonCave.dat`, `testdata/LessonCave_MANIFEST.md`
- Modify: `tests/test_addon.py` (a case asserting the fixture exists and carries no real coordinates)

**Acceptance Criteria:**
- [ ] Four trips, under 40 stations, one loop that closes, one open end, one passage needing a cross section, one breakdown zone
- [ ] Every coordinate invented; the manifest says so in its first line
- [ ] Generator runs headless and is idempotent -- running twice gives byte-identical output
- [ ] `tools/make_lesson_cave.js` writes into `~/Documents/Cave/lesson` by default, like `make_demo_caves.js` writes into `~/Documents/Cave/demo`

**Verify:** `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tools/make_lesson_cave.js "$PWD"` -> `### LESSON CAVE WRITTEN`

**Steps:**

- [ ] **Step 1: Read the existing generator**

Run: `sed -n '1,80p' tools/make_demo_caves.js`
Expected: the argument convention (`RSettings.getOriginalArguments()`, repo root last), the privacy note, and that surveys are drawn through `CsDraw.survey` so real tag schema v3 lands in the drawing. Follow all three.

- [ ] **Step 2: Write the generator**

Create `tools/make_lesson_cave.js`. Header comment first, stating plainly that every station, bearing and coordinate is invented and that real cave locations never go in test data. Then four trips:

```js
// Trip 1 -- the entrance run. A student's first Notebook page.
//   A1 -> A6, gentle descent, all six stations LRUD'd.
// Trip 2 -- the side lead. Ties into A3, ends at an open end (B4),
//   so the shelf has something to show as "stopped at".
// Trip 3 -- the loop. Leaves A6, rejoins B2, so Survey Stats has a
//   real closure to report and a student sees a loop close.
// Trip 4 -- the big room. Wide LRUD and splays, so there is something
//   worth a cross section and a breakdown zone worth scattering.
var TRIPS = [
    { name: "Entrance run", date: "2026-03-14", team: "Lesson team",
      shots: [
        // from, to, distance, azimuth, inclination, L, R, U, D
        ["A1", "A2", 8.4,  92,  -4, 1.2, 2.0, 3.0, 0.5],
        ["A2", "A3", 11.2, 88,  -6, 1.5, 1.8, 2.5, 0.4]
        // ... continue to A6
      ] }
    // ... trips 2-4
];
```

Write the file to `testdata/LessonCave.dat` in Compass format via the suite's own writer (find it with `grep -n "Compass" scripts/CaveSurvey/Core/CsFormats*.js` or the format registry), then build the cave folder and drawing through `CsDraw.survey` the way `make_demo_caves.js` does. Print `### LESSON CAVE WRITTEN` on success.

- [ ] **Step 3: Run it twice and diff**

```bash
QCAD=/Applications/CaveCAD.app/Contents/MacOS/CaveCAD
$QCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tools/make_lesson_cave.js "$PWD"
cp testdata/LessonCave.dat /tmp/lesson-1.dat
$QCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tools/make_lesson_cave.js "$PWD"
diff /tmp/lesson-1.dat testdata/LessonCave.dat && echo "idempotent"
```
Expected: `idempotent`

- [ ] **Step 4: Write the manifest**

Create `testdata/LessonCave_MANIFEST.md`, modelled on `testdata/PitfallCave_MANIFEST.md`. First line: `Every station, bearing and coordinate in this cave is invented.` Then a table of the four trips and what each one exists to teach.

- [ ] **Step 5: Add the structural test**

In `tests/test_addon.py`:

```python
class TestLessonCave(unittest.TestCase):
    """The teaching fixture, and the privacy rule it exists under."""

    def test_the_lesson_cave_ships(self):
        for name in ("LessonCave.dat", "LessonCave_MANIFEST.md"):
            self.assertTrue(
                os.path.exists(os.path.join(TESTDATA, name)),
                "%s is missing -- run tools/make_lesson_cave.js" % name)

    def test_the_manifest_says_the_cave_is_invented(self):
        path = os.path.join(TESTDATA, "LessonCave_MANIFEST.md")
        with open(path) as handle:
            first = handle.readline()
        self.assertIn("invented", first.lower())
```

Confirm the `TESTDATA` constant exists with `grep -n "TESTDATA" tests/test_addon.py`; if it does not, define it beside the existing `ADDON` constant.

- [ ] **Step 6: Run the structural suite**

Run: `python3 -m unittest tests.test_addon -v -k Lesson`
Expected: `OK`

- [ ] **Step 7: Commit**

```bash
git add tools/make_lesson_cave.js testdata/LessonCave.dat testdata/LessonCave_MANIFEST.md tests/test_addon.py
git commit -m "feat: add the lesson cave fixture and its generator"
```

---

### Task 10: The student curriculum

**Goal:** One document that walks a reader who has never used CAD from opening CaveCAD to a packaged cave project, against the lesson cave, in the order the staged menu now reads.

**Files:**
- Create: `docs/LESSONS.md`
- Modify: `README.md` (a link to it, near the top)
- Modify: `tests/test_addon.py` (a case keeping the lessons and the menu in step)

**Acceptance Criteria:**
- [ ] Six lessons, one per menu stage, each naming the exact menu entry it uses
- [ ] Every menu entry appears in at least one lesson; no lesson names an entry that does not exist
- [ ] No lesson assumes prior CAD vocabulary; a term used for the first time is defined in the sentence that uses it
- [ ] Each lesson ends with `You should now see:` and a checkable description

**Verify:** `python3 -m unittest tests.test_addon -v -k Lessons` -> `OK`

**Steps:**

- [ ] **Step 1: Write the test first, so the document cannot drift from the menu**

In `tests/test_addon.py`:

```python
class TestLessons(unittest.TestCase):
    """The curriculum and the menu are one thing in two files."""

    def _lessons(self):
        with open(os.path.join(ROOT, "docs", "LESSONS.md")) as handle:
            return handle.read()

    def test_every_menu_entry_is_taught(self):
        text = self._lessons()
        titles = {name: tool_title(name) for name in MENU}
        untaught = sorted(n for n, t in titles.items() if t not in text)
        self.assertEqual([], untaught,
                         "menu entries no lesson mentions: %s" % untaught)

    def test_every_lesson_ends_with_a_checkable_result(self):
        text = self._lessons()
        lessons = text.split("\n## ")[1:]
        for lesson in lessons:
            self.assertIn("You should now see:", lesson,
                          "a lesson has no checkable result: %s"
                          % lesson.splitlines()[0])
```

Add the helper if it is not already there:

```python
def tool_title(name):
    """The menu text a tool registers, e.g. 'Repair Drawing'."""
    match = re.search(r'new RGuiAction\(qsTr\("([^"]+)"', tool_source(name))
    return match.group(1) if match else name
```

- [ ] **Step 2: Run it and watch it fail**

Run: `python3 -m unittest tests.test_addon -v -k Lessons`
Expected: FAIL -- `FileNotFoundError: docs/LESSONS.md`

- [ ] **Step 3: Write the document**

Create `docs/LESSONS.md` with this skeleton, one `##` per stage, filling each with the real clicks:

```markdown
# Learning CaveCAD

Six lessons. Each one is a stage of the Cave Survey menu, in the order the
menu lists them, and each one takes about twenty minutes. You need no
previous CAD experience: everything you have to know is here.

Work against the lesson cave. Generate it once:

    CaveCAD -no-gui -autostart tools/make_lesson_cave.js .

## Lesson 1 -- Start here

A **drawing** is one file holding one cave map. **Caves...** is the window
CaveCAD opens on: every cave this machine knows about...

You should now see: the Caves window listing Lesson Cave, with four trips.

## Lesson 2 -- Survey data
...
## Lesson 3 -- Draw the map
...
## Lesson 4 -- Put a reference under the map
...
## Lesson 5 -- Finish the sheet
...
## Lesson 6 -- Fix and share
...
```

Rules while writing, enforced by review rather than by test: no sentence uses a CAD word (layer, entity, block, polyline, snap, XDATA) before a sentence defines it; every instruction names the menu entry in bold exactly as it appears; no lesson refers forward.

- [ ] **Step 4: Run the test to verify it passes**

Run: `python3 -m unittest tests.test_addon -v -k Lessons`
Expected: `OK`

- [ ] **Step 5: Link it from the README**

Under the opening paragraph of `README.md`:

```markdown
New to CaveCAD, or to CAD at all? Start with [the lessons](docs/LESSONS.md) --
six stages, one cave, about two hours.
```

- [ ] **Step 6: Commit**

```bash
git add docs/LESSONS.md README.md tests/test_addon.py
git commit -m "docs: add the six-lesson curriculum, pinned to the menu by test"
```

---

### Task 11: Start Here -- the in-app guided first run

**Goal:** A panel that shows the six lessons inside CaveCAD, ticks each one off as the student's drawing actually reaches that state, and opens on first launch.

**USER-ORDERED GATE -- NON-SKIPPABLE.** This task was requested by the user in the current conversation. It MUST NOT be closed by walking around it, by declaring it "verified inline", or by substituting a cheaper check. Close only after every item in the acceptance criteria has been re-validated independently, with output captured.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsGuide.js`
- Create: `scripts/CaveSurvey/StartHere/StartHere.js`, `StartHere.svg`, `StartHere-inverse.svg`
- Create: `tests/guide_progress.js`
- Modify: `scripts/CaveSurvey/Core/CsAll.js`, `scripts/CaveSurvey/CaveShelf/CaveShelf.js` (offer it on first run), `tests/run_all.sh`, `tests/test_addon.py`, `README.md`, `docs/LESSONS.md`

**Acceptance Criteria:**
- [ ] Six steps, worded identically to the six `docs/LESSONS.md` headings, kept in step by test
- [ ] Each step's done-ness is *detected from the drawing*, not from a button the student presses: e.g. step 2 is done when the drawing holds at least one trip, step 5 when it holds a legend
- [ ] Progress persists per cave, in `RSettings` under `CaveSurvey/Guide/<caveId>`
- [ ] Panel opens automatically on a machine that has never opened a cave, and never again once dismissed; the setting `CaveSurvey/Guide/ShowOnStart` turns it back on
- [ ] Clicking a step tells the student which menu entry to use; it does not run the tool for them

**Verify:** `./tests/run_all.sh --publish` -> `ALL TESTS PASSED`

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `tests/guide_progress.js`:

```js
// guide_progress.js -- the guide reads progress off the drawing, and
// its steps match the lessons document.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/guide_progress.js "$PWD"

// ... same preamble as tests/repair_drawing_run.js ...

var failures = [];
function check(what, cond) { if (!cond) { failures.push(what); } }

check("six steps", CsGuide.STEPS.length === 6);

// A brand new drawing from the template: nothing but step 1 is done.
var fresh = CsGuide.progress(emptyDoc);
check("a new drawing has step 1 done", fresh[0] === true);
check("a new drawing has step 2 undone", fresh[1] === false);

// The lesson cave drawn in: the survey step is done.
var drawn = CsGuide.progress(lessonDoc);
check("a drawn survey completes step 2", drawn[1] === true);

// The step titles are the lesson titles, exactly.
var lessons = readTextFile(repoRoot + "/docs/LESSONS.md");
for (var i = 0; i < CsGuide.STEPS.length; i++) {
    check("lesson heading exists for step " + (i + 1),
          lessons.indexOf("## " + CsGuide.STEPS[i].title) !== -1);
}

if (failures.length === 0) {
    print("### GUIDE PROGRESS OK");
} else {
    print("FAILURES:\n  " + failures.join("\n  "));
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/guide_progress.js "$PWD"`
Expected: FAIL -- `CsGuide is not defined`

- [ ] **Step 3: Write the engine**

Create `scripts/CaveSurvey/Core/CsGuide.js`:

```js
/**
 * CsGuide.js
 *
 * The six lessons, as something the drawing can be asked about.
 *
 * Progress is DETECTED, never declared: a step is done when the drawing
 * actually holds what that step produces. A checklist the student ticks
 * by hand teaches the checklist; one that ticks itself teaches the map.
 */
var CsGuide = {};

// Titles are the headings of docs/LESSONS.md, verbatim -- a test holds
// the two files together.
CsGuide.STEPS = [
    { title: "Lesson 1 -- Start here",
      hint: "Cave Survey > Caves...",
      done: function(doc) { return !isNull(doc); } },
    { title: "Lesson 2 -- Survey data",
      hint: "Cave Survey > Survey Notebook",
      done: function(doc) { return CsModel.tripsOf(doc).length > 0; } },
    { title: "Lesson 3 -- Draw the map",
      hint: "Cave Survey > Feature Trace",
      done: function(doc) { return CsGuide.hasOn(doc, CsLayers.WALL); } },
    { title: "Lesson 4 -- Put a reference under the map",
      hint: "Cave Survey > Sketch Scans",
      done: function(doc) { return CsGuide.hasImage(doc); } },
    { title: "Lesson 5 -- Finish the sheet",
      hint: "Cave Survey > Build Legend",
      done: function(doc) { return CsGuide.hasOn(doc, CsLayers.LEGEND); } },
    { title: "Lesson 6 -- Fix and share",
      hint: "Cave Survey > Package Cave Project...",
      done: function(doc) { return CsGuide.packaged(doc); } }
];

/** True when the named layer exists and holds at least one entity. */
CsGuide.hasOn = function(doc, layerName) {
    if (isNull(doc) || !doc.hasLayer(layerName)) {
        return false;
    }
    return doc.queryLayerEntities(doc.getLayerId(layerName), true).length > 0;
};

/** True when any raster image has been placed. */
CsGuide.hasImage = function(doc) {
    if (isNull(doc)) {
        return false;
    }
    return doc.queryAllEntities(false, true, RS.EntityImage).length > 0;
};

/**
 * The cave this drawing belongs to, or undefined for a drawing that is
 * not in a cave folder. Delegates -- CsCave already answers this; the
 * grep in the step below confirms the accessor's real name.
 */
CsGuide.caveIdOf = function(doc) {
    if (isNull(doc)) {
        return undefined;
    }
    try {
        return CsCave.idOf(doc);
    } catch (e) {
        return undefined;
    }
};

/** True when this cave has a zip in the depot. */
CsGuide.packaged = function(doc) {
    var id = CsGuide.caveIdOf(doc);
    if (isNull(id)) {
        return false;
    }
    var depot = new QDir(QDir.homePath() + "/Documents/Cave/depot");
    var hits = depot.entryList([id + "*.zip"], QDir.Files);
    return hits.length > 0;
};

/** \return Array of six Booleans, one per step. */
CsGuide.progress = function(doc) {
    var out = [];
    for (var i = 0; i < CsGuide.STEPS.length; i++) {
        var ok = false;
        // A detector that throws on an odd drawing must not take the
        // panel with it -- an undone step is the safe answer.
        try {
            ok = CsGuide.STEPS[i].done(doc) === true;
        } catch (e) {
            ok = false;
        }
        out.push(ok);
    }
    return out;
};
```

Before running this, confirm the three borrowed names really exist -- `CsModel.tripsOf`, `CsLayers.WALL`, `CsLayers.LEGEND`, and the real name behind `CsCave.idOf`, which `CsGuide.caveIdOf` delegates to:

Run: `grep -nE "^CsModel\.[a-zA-Z]+ = function" scripts/CaveSurvey/Core/CsModel.js | head` and `grep -nE "WALL|LEGEND" scripts/CaveSurvey/Core/CsLayers.js | head` and `grep -nE "^CsCave\.[a-zA-Z]+ = function" scripts/CaveSurvey/Core/CsCave.js | head`
Expected: real names for all four. Substitute the real ones; do not add shims.

- [ ] **Step 4: Write the panel**

Create `scripts/CaveSurvey/StartHere/StartHere.js`: a `QDockWidget` named `StartHerePanel`, one row per step (a `QLabel` carrying a tick or a bullet, plus the title), a `QLabel` under the selected row showing that step's `hint`, and a footer `QCheckBox` `Show this when CaveCAD opens`. Rebuild the rows from `CsGuide.progress(getDocument())` on show and whenever the document changes. Register it:

```js
StartHere.init = function(basePath) {
    var action = new RGuiAction(qsTr("Start Here..."),
                                RMainWindowQt.getMainWindow());
    action.setRequiresDocument(false);
    action.setScriptFile(basePath + "/StartHere.js");
    action.setIcon(basePath + "/StartHere.svg");
    action.setStatusTip(qsTr("The six lessons, and how far through them "
        + "this cave has got"));
    action.setDefaultCommands(["starthere", "sh"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(10);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
```

`setRequiresDocument(false)` on purpose: the panel has to be reachable before there is a drawing, which is exactly when a student needs it.

- [ ] **Step 5: Open it on a first run**

In `CaveShelf/CaveShelf.js`, where the shelf decides what to show, add: if `RSettings.getBoolValue("CaveSurvey/Guide/ShowOnStart", true)` and the shelf has no caves registered, show the Start Here panel too. Writing `false` to that key when the footer checkbox is cleared is what makes it never come back.

- [ ] **Step 6: Icons, includes, tables**

Draw or copy `StartHere.svg` and `StartHere-inverse.svg`. Add `include(includeBasePath + "/CsGuide.js");` to `Core/CsAll.js` after `CsLayers` and `CsModel`. Add to `MENU`:

```python
    "StartHere":         (450, 10, ["starthere", "sh"]),
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/guide_progress.js "$PWD"`
Expected: `### GUIDE PROGRESS OK`

- [ ] **Step 8: Wire the suite in and run everything**

Add the stage block to `tests/run_all.sh` (token `### GUIDE PROGRESS OK`), renumber banners to `/26`, update the stage count in `tests/README.md`.

Run: `./tests/run_all.sh --publish 2>&1 | tail -20`
Expected: `ALL TESTS PASSED`

- [ ] **Step 9: Live GUI check**

`./tools/publish.sh`. Simulate a first run:

```bash
defaults delete org.qcad.CaveCAD CaveSurvey.Guide.ShowOnStart 2>/dev/null || true
```
(Confirm the real settings domain first with `defaults domains | tr ',' '\n' | grep -i cave`.)

Restart CaveCAD with no caves registered. Expected: the Start Here panel opens beside the shelf. Screenshot it. Then open the lesson cave and confirm through `cavecad_eval` that steps tick themselves:

```js
CsGuide.progress(csDoc()).join(",");
```
Expected: `true,true,...` with the steps the lesson cave has actually reached marked true and the rest false.

- [ ] **Step 10: Student dry run (Nathan)**

Do Lesson 1 and Lesson 2 from a cold start, using only the panel and the menu -- no README. Answer: did the panel ever tell you something you could not act on, and did any step tick before you had really done it? A step that ticks early is worse than one that never ticks.

- [ ] **Step 11: Commit**

```bash
git add -A scripts/CaveSurvey tests docs README.md
git commit -m "feat: add the Start Here guided first run, ticking itself off the drawing"
```

---

### Task 12: Documentation sync and release

**Goal:** README, lessons and package agree with the shipped menu, and the suite goes out as one version.

**Files:**
- Modify: `README.md`, `docs/LESSONS.md`, `tests/README.md`, `VERSION`

**Acceptance Criteria:**
- [ ] README's six tables carry the final 18 entries with rewritten `What it does` cells -- no cell mentions a deleted tool or a deleted command
- [ ] `tests/README.md` stage count and stage list match `run_all.sh`
- [ ] `VERSION` reads `0.9.52.0`
- [ ] `./tools/publish.sh` installs and CaveCAD's Help > About reports `Cave Survey Tools 0.9.52.0`

**Verify:** `./tests/run_all.sh --publish` -> `ALL TESTS PASSED`

**Steps:**

- [ ] **Step 1: Sweep the docs for names that no longer exist**

```bash
cd ~/Documents/github/cavecad-tools
grep -nE "Edit Trip|Elevation Callout|Callout Sync|Sketch Section|Align Image|Aerial Basemap|Surface Contours|Rebuild Survey Data|Restyle Layers|\`et\`|\`cel\`|\`csync\`|\`sks\`|\`ali\`|\`sc\`|\`rsd\`|\`rsl\`" README.md docs/LESSONS.md
```
Expected: no output. Every hit is a rewrite -- the merged tool's row now has to say what the old row said, in the merged tool's words.

- [ ] **Step 2: Bump the version**

The suite holds at `0.9.X` until a public release is approved, so this is a patch bump, not a minor one:

```bash
echo "0.9.52.0" > VERSION
```

- [ ] **Step 3: Full publish-gated suite**

Run: `./tests/run_all.sh --publish 2>&1 | tail -20`
Expected: `ALL TESTS PASSED`

- [ ] **Step 4: Publish and check the reported version**

```bash
./tools/publish.sh
```
Restart CaveCAD. Through `cavecad_eval`: `CaveSurvey.getVersion(RSettings.getValue("CaveSurvey/AddOnPath", ""));`
Expected: `0.9.52.0`

- [ ] **Step 5: Commit**

```bash
git add README.md docs/LESSONS.md tests/README.md VERSION
git commit -m "docs: sync the documentation to the consolidated menu, 0.9.52.0"
```

---

## Self-review notes

- **Spec coverage.** Six merges: Tasks 3-8. Staged menu: Task 2, pinned by Task 1. Curriculum: Task 10. Demo cave: Task 9. In-app guided first run: Task 11. Hard removal of commands: verified in each merge task's live GUI step with the `RGuiAction.getByCommand` probe. Per-task gate of headless + live + student dry run: every merge task carries all three.
- **Ordering.** Task 1 before everything (the menu table is what makes later diffs legible). Task 2 before the merges (a merge then only deletes a row from a stage). Tasks 9-11 last, because the curriculum and the guide name menu entries that only exist in their final form after Task 8.
- **Known risk, called out rather than hidden.** Task 5 is the largest: `SketchSection` is 2169 lines against `CrossSection`'s 237, and the modeless bay panel is new UI. If it overruns, it can be split -- move the logic and delete the tool first, add the panel second -- but the commands stay removed either way, so a split leaves a version where capture is reachable only from the panel. Do not split it in a way that leaves no way to close a bay.
- **Corrected in flight (Task 1).** Three command lists in the plan's tables were transcribed short. The real ones: `CaveShelf` also answers to `caveshelf`, `GenerateProfile` also to `genprofile`, `PackageCave` also to `pkgcave`. The Task 2 table above carries the corrections; the helper the tests use is `tool_dirs()`, not `tool_names()`.
- **Assumption stated.** Several steps call functions by their likely names (`CsGeoProject.anchorOf`, `CsModel.tripsOf`, `CsLayers.WALL`, `CsLayers.LEGEND`). Each such step carries a `grep` to confirm the real name first. Substitute the real name; never add a shim to make the plan's guess true.
