# Callout (Multileader) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give CaveCAD the multileader QCAD never shipped — a text note bound to
one or more arrows that stays bound through edits — plus a floor-aware spot
elevation variant.

**Architecture:** A linked pair. A real `RTextEntity` and real `RLeaderEntity`
objects joined by a shared `CalloutId` in `CsTags` XDATA. One pure
`CsCallout.reflow` solves the leader geometry from the text's current bounding
box; it is driven both by a startup transaction listener (live glue, undo-grouped
into the user's own edit) and by a manual `CsCalloutSync` command. Reflow
rewrites leader polylines ONLY and never writes to the text, which is what keeps
QCAD's native text editor, grips and property editor working unchanged.
`CsElevation` samples passage FLOOR elevation along the survey alignment from
LRUD `D` plus down-classified splays.

**Tech Stack:** QCAD/CaveCAD 3.33 ECMAScript add-on API (Community edition only
— nothing Pro). `RLeaderEntity`, `RTextEntity`, `RTransactionListenerAdapter`,
`RAddObjectsOperation.setTransactionGroup`. Tests are the suite's existing
dual-runner (`tests/js_unit.js` under both node and CaveCAD's own engine).

**Spec:** `docs/superpowers/specs/2026-08-23-callout-multileader-design.md`
(committed as `8343a59`). Read it before Task 1 — every decision below traces to
a numbered section there.

**User decisions (already made):**
- "I want the mleader to be flexible and text editable after commit... otherwise
  it's of no use." All four edits must survive commit: edit text content, move
  the text, move an arrow tip, add/remove branches.
- Approach A — linked pair with live glue via transaction listener — plus a
  `CsCalloutSync` repair path.
- General drafting tool first; survey-tag prefill is a later hook, not v1.
- Two commands: one for pure text, one for elevation.
- Elevation comes from interpolation along the survey alignment, not from
  drawing z at the picked point.
- "the elevation label [must] represent the floor of the passage, not just the
  calc'd elevation of the survey line... aware of the D dimension from the LRUDs
  of adjacent stations."
- Multi-value D (`2/6`) takes the SHALLOWEST reading — walkable floor. Diverges
  from `CsProfile` on purpose.
- Missing D falls back to the survey-line elevation, VISIBLY labelled as such.
- Down-splays contribute floor evidence, like they do in the profile.
- Lidar/entrance-elevation is a SEPARATE spec. `CsElevation` is built as the
  primitive that work will consume; this plan does not implement lidar.

---

## Status: SHIPPED in 0.7.0.0

Delivered and pushed 2026-08-24. The plan was followed loosely from Task 5 on:
the caver drove the remaining shape interactively (single-pick workflow, curved
leaders, the text flip, elevation folded into the existing tool AND a dedicated
two-click tool), so several planned tasks were superseded rather than executed as
written. CsCalloutElev in particular was planned as a separate command, argued
down to a style on the existing one, then reinstated as a two-click tool for the
repetitive case -- both routes now exist.

**Reviews owed and not run:** Tasks 5, 8 and 9 were due full two-stage review
under the policy below. They received hand-testing by the owner instead, which
caught more than a review would have -- the freeze, the 0,0 placement, the style
dropdown not sticking, the page-only refresh. The owner elected to skip the
review pass on 2026-08-24. Recorded rather than quietly dropped.

## Review policy for this run

Agreed with the user after Task 3. Not uniform, on purpose — review effort goes
where a silent failure is expensive and the unit tests are thin.

| Tasks | Review | Why |
|---|---|---|
| 4, 5, 8, 9 | full two-stage (spec, then quality) | Document and undo semantics, and the GUI commands. This is where unit tests cover least and a defect reaches a caver's drawing. |
| 7 | full two-stage | The floor-elevation math. A wrong number here is a wrong elevation on a published cave map, and the tests are the plan author's own, so they can be wrong in the same direction as the code. |
| 3, 6, 10 | single combined pass | Mechanical, and already guarded by tests that exist. |

What the reviews have actually caught so far, for whoever is deciding whether to
keep paying for them: a docblock claiming `nextId` rejects non-numeric input when
`parseInt("3abc")` is 3; two untested operators in `reflow` (`<=` tie-break and
the `dimasz > 0` threshold), both since mutation-verified; and confirmation that
the tip round-trip through `applyReflow` cannot drift. Task 3's own colour
inversion was caught by the coordinator, not by a review.

## Engine facts this plan depends on

All probed against the INSTALLED binary `/Applications/CaveCAD.app` on
2026-08-24, not the source tree — the app is behind `cavecad-src` and reading
source has sunk a design in this repo before (`RCopyOperation.setSelectionOnly`).

Confirmed present and constructible: `RTransactionListenerAdapter` (with a
connectable `transactionUpdated`), `addTransactionListener` /
`removeTransactionListener`, `RTransaction.getAffectedObjects` /
`getPropertyChanges` / `getGroup` / `setGroup`,
`RAddObjectsOperation.setTransactionGroup` / `getTransactionGroup`, `RLeaderData`
with `setArrowHead` / `hasArrowHead` / `appendVertex` / `setDimasz` /
`setDimscale`, `RTextData` with `getBoundingBox` / `getHeight` /
`getAlignmentPoint`, `RChangePropertyOperation`.

Confirmed BEHAVIORALLY (not by setter existence): two `RAddObjectsOperation`s
sharing a transaction group collapse into ONE undo — 2 entities went to 0 on a
single `di.undo()`, while the ungrouped control went 2 to 1.

**Corrections found by ACTUALLY RUNNING the engine during Task 4.** Both were
errors in this plan, from reading source rather than probing:

- **`RDeleteObjectsOperation.deleteObject` takes ONE argument, not two.** This
  plan originally wrote `deleteObject(entity, doc)`; the engine prints
  `Too many arguments, ignoring 1` on every call. Every other caller in this
  repo passes one (`CsStore`, `CsProfileDraw`, `CsDraw`, `ScatterBreakdown`,
  `BuildLegend`, `AerialBasemap`). Fixed throughout this plan.
- **A test harness must use INDIRECT eval: `(0, eval)(src)`, not `eval(src)`.**
  Direct eval inside a `loadRepoScript` helper scopes every `Cs*` global into
  that function, so they vanish the moment it returns —
  `ReferenceError: CsLayers is not defined`. `tests/profile_draw_roundtrip.js`
  already carries a comment about exactly this. A harness also needs the
  `isNull` shim AND `getDocument = function() { return doc; }`, because
  `CsTags.commit` falls through to `CsStore.migrate(getDocument(), di)` and a
  null there throws `Cannot call method 'hasLayer' of null`.
- **TAG BEFORE ADDING, never after.** `CsDraw.js:10` states the convention:
  `setCustomProperty` BEFORE adding, then `op.addObject(entity, false)`.
  `CsTags.commit` applies its OWN `RModifyObjectsOperation` and takes no
  transaction group, so tagging after the add makes a grouped write NON-ATOMIC:
  undoing the group reverts the add but leaves the tagging transaction
  uncorrelated, and the document keeps an UNTAGGED leader that `members()` can
  no longer see. Caught by the DXF round-trip test, which failed with
  "both leaders are still found by the same tag (expected 2, got 1)" while an
  entity-COUNT assertion passed. `CsTags.commit` remains correct for Task 8's
  `refreshElev`, which modifies an entity already in the document.
- **Undo grouping is sensitive to ENTITY OBJECT IDENTITY, not just to the
  transaction group.** Probed while verifying the fix above: two
  `RAddObjectsOperation`s sharing a group collapse into one undo, and an
  UNGROUPED `RModifyObjectsOperation` sandwiched between two same-group adds
  does NOT break that merge (3 entities → 1 on a single undo). So "a stray
  ungrouped modify" is not by itself the hazard. What actually broke was
  tagging a FRESHLY RE-QUERIED wrapper — `doc.queryEntity(addedId)` — rather
  than the original in-script entity object. Tagging the same reference you
  added, even after the add, did not reproduce the bug. Do not conclude from
  this that tag-after-add is safe: it is fragile in a way that depends on which
  wrapper you hold, which is exactly why the suite's rule is the simple one —
  tag the object, then add it, once.
- **Assert composition, not counts.** The undo-grouping test originally checked
  only `queryAllEntities().length`, which is why the untagged-leader state slipped
  through. Any assertion about a callout surviving an operation must go through
  `CalloutWrite.members` and count TAGGED members.

Second probe round, same day, of the API this plan actually calls:

- `RLeaderData(polyline, true)` constructs with `hasArrowHead() === true` and
  `countVertices()` / `getVertexAt(i)` both working. The two-argument form is
  what builds a leader; do not append vertices to a default-constructed one.
- `RTextData.setTextHeight` exists. **`setHeight` is `undefined`** — the obvious
  name is the wrong one.
- `doc.getKnownVariable(handle, default)` needs a NUMERIC default.
  `getKnownVariable(RS.DIMASZ, null)` returns `undefined` and prints
  `RJSHelper::js2cpp_QVariant: no wrapper`; `getKnownVariable(RS.DIMASZ, 0)`
  returns 0. The one-argument form also returns `undefined`. Handles:
  `RS.DIMASZ` 24, `RS.DIMSCALE` 53, `RS.DIMTXT` 73. A fresh memory document
  answers 0 for all three, so **0 must be read as "unset" and fall back**, never
  used as a length.
- Present: `doc.getLayerId` / `getLayerName` / `queryLayer` /
  `queryLayerEntities` / `querySelectedEntities`, `RDeleteObjectsOperation`
  with `deleteObject`, `RTextEntity` / `RLeaderEntity` with `setLayerId` and
  `getData`.

**If any task finds one of these missing, STOP and report — do not work around
it.** A silent workaround is how the previous design died.

## File Structure

| File | Responsibility |
|---|---|
| `scripts/CaveSurvey/Core/CsCallout.js` | PURE: style table, id allocation, reflow geometry, label formatting, collect/members. No document writes. |
| `scripts/CaveSurvey/Core/CsElevation.js` | PURE: floor sampling along the alignment. `floorWalkable`, evidence gathering, interpolation, line fallback. |
| `scripts/CaveSurvey/Callout/Callout.js` | `CsCallout` command + its `init`. Picks, prompts, writes entities. |
| `scripts/CaveSurvey/Callout/Callout.svg` | Toolbar/menu icon. |
| `scripts/CaveSurvey/Callout/CalloutWrite.js` | QCAD-context writes shared by all three commands and the listener: build entities, apply a reflow, tag, delete. |
| `scripts/CaveSurvey/Callout/CalloutListener.js` | Live glue. Not a menu tool, registers no `RGuiAction`. |
| `scripts/CaveSurvey/CalloutElev/CalloutElev.js` | `CsCalloutElev` command + its `init`. |
| `scripts/CaveSurvey/CalloutElev/CalloutElev.svg` | Icon. |
| `scripts/CaveSurvey/CalloutSync/CalloutSync.js` | `CsCalloutSync` command + its `init`. |
| `scripts/CaveSurvey/CalloutSync/CalloutSync.svg` | Icon. |
| `scripts/CaveSurvey/CaveSurvey.js` | MODIFY: install the listener once at startup. |
| `scripts/CaveSurvey/Core/CsLayers.js` | MODIFY: six callout style layers + `DEFAULTS` rows. |
| `scripts/CaveSurvey/Core/CsAll.js` | MODIFY: `include` both new Core files. **Enforced** — see below. |
| `templates/NSS_Cave_Template_PLAN.dxf` | MODIFY (Task 3, mechanically): every `CsLayers` registry layer must already exist in the shipped template — `test_registry_layers_exist_in_plan_template` has no on-demand exemption. Do NOT hand-edit. Run `tools/sync_template_layers.js` against the installed CaveCAD. It re-serialises the whole DXF (~8900 lines of handle renumbering), so verify layer count and entity count before and after rather than reading the diff. Appearance is resolved at CREATION only, so changing a `DEFAULTS` colour after a sync means reverting the DXF and re-syncing, not re-running over the existing layers. |
| `tests/js_unit.js` | MODIFY: load the two new Core files; add their test blocks. |

**Purity discipline, inherited from `CsProfileDraw.js`:** `CsCallout.js` and
`CsElevation.js` must be loadable and callable under plain node. They therefore
take and return PLAIN objects (`{x, y}`), never `RVector`, and never touch a
document. Everything QCAD-shaped lives in `CalloutWrite.js`, which the unit tests
do not load. This is what makes the geometry testable at all.

**Every new Core file MUST be registered in `Core/CsAll.js`.** A structural test,
`test_every_core_file_is_included_by_csall`, fails the moment a `Core/*.js` file
exists that `CsAll.js` does not `include`. Found the hard way in Task 1: the file
list said `CsCallout.js` + `js_unit.js`, and `run_all.sh` section 1 went red until
`CsAll.js` was updated too. Add the include in the SAME relative position as the
`CORE_FILES` entry. This applies to `CsCallout.js` (Task 1) and `CsElevation.js`
(Task 7); `CsLayers.js` already exists and needs no new registration.

**Basename safety:** QCAD's `include()` dedupes by BASENAME and skips the
duplicate silently, invisibly to headless tests. `Callout.js`, `CalloutElev.js`,
`CalloutSync.js`, `CalloutWrite.js`, `CalloutListener.js`, `CsCallout.js`,
`CsElevation.js` — all verified zero-collision against `cavecad-src/scripts` on
2026-08-24. Suite-internal includes MUST be `includeBasePath`-relative.

---

### Task 1: CsCallout data model, styles and id allocation

**Goal:** The pure vocabulary every later task speaks — tag keys, the style
table, and a collision-free `CalloutId` allocator.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsCallout.js`
- Modify: `tests/js_unit.js` (add to `CORE_FILES`, add test block)

**Acceptance Criteria:**
- [ ] `CsCallout.KEY` names every XDATA key as a constant; no later task
      hard-codes a tag string.
- [ ] `CsCallout.STYLES` maps all six style names to a layer name.
- [ ] `CsCallout.nextId([...existing ids])` returns a string id greater than
      every existing one, and `"1"` for an empty list.
- [ ] `nextId` ignores non-numeric junk in the input list rather than throwing.
- [ ] File loads under node with no QCAD symbols referenced at load time.

**Verify:** `node tests/js_unit.js` → `### UNIT OK <n> assertions`

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `tests/js_unit.js`, before the `// Report.` block:

```javascript
// ---------------------------------------------------------------------
// CsCallout -- data model
// ---------------------------------------------------------------------

(function() {
    eqs(CsCallout.KEY.ID, "CalloutId", "CsCallout.KEY.ID");
    eqs(CsCallout.KEY.ROLE, "CalloutRole", "CsCallout.KEY.ROLE");
    eqs(CsCallout.KEY.KIND, "CalloutKind", "CsCallout.KEY.KIND");
    eqs(CsCallout.KEY.STYLE, "CalloutStyle", "CsCallout.KEY.STYLE");
    eqs(CsCallout.KEY.SIDE, "CalloutSide", "CsCallout.KEY.SIDE");
    eqs(CsCallout.KEY.ELEV_BASIS, "ElevBasis", "CsCallout.KEY.ELEV_BASIS");

    // every style resolves to a layer
    var names = ["hazard", "dig", "equipment", "name", "elevation",
                 "elevation-line"];
    for (var i = 0; i < names.length; i++) {
        ok(typeof CsCallout.STYLES[names[i]] === "string" &&
           CsCallout.STYLES[names[i]].length > 0,
           "CsCallout.STYLES has a layer for " + names[i]);
    }

    // id allocation
    eqs(CsCallout.nextId([]), "1", "nextId on an empty drawing");
    eqs(CsCallout.nextId(["1", "2", "3"]), "4", "nextId after 1..3");
    eqs(CsCallout.nextId(["7"]), "8", "nextId is max+1, not count+1");
    eqs(CsCallout.nextId(["2", "", "abc", "5"]), "6",
        "nextId ignores junk rather than throwing");
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/js_unit.js`
Expected: FAIL — `CsCallout is not defined`

- [ ] **Step 3: Write the implementation**

Create `scripts/CaveSurvey/Core/CsCallout.js`:

```javascript
/**
 * CsCallout -- the pure engine behind the Cave Survey callout
 * (multileader) tools.
 *
 * QCAD has no multileader. Its RLeaderEntity is a polyline plus an
 * arrowHead flag with NO text member, so a callout here is a LINKED
 * PAIR: one RTextEntity and one RLeaderEntity per branch, joined by a
 * shared CalloutId in CsTags XDATA.
 *
 * THIS FILE IS PURE. It takes and returns plain {x, y} objects, never
 * RVector, and never touches a document -- which is what lets
 * tests/js_unit.js run it under node. Every QCAD-shaped write lives in
 * Callout/CalloutWrite.js. Do not import a QCAD symbol here.
 */
function CsCallout() {}

/**
 * XDATA keys, under the CsTags "CaveSurvey" group. Nothing outside
 * this table may hard-code a tag string: a typo in a literal is a
 * silent orphan, and an orphaned member is a leader that no longer
 * reflows.
 */
CsCallout.KEY = {
    ID: "CalloutId",
    ROLE: "CalloutRole",
    KIND: "CalloutKind",
    STYLE: "CalloutStyle",
    SIDE: "CalloutSide",
    ELEV_BASIS: "ElevBasis",
    ELEV_FROM: "ElevFrom",
    ELEV_TO: "ElevTo",
    ELEV_FRACTION: "ElevFraction",
    ELEV_VALUE: "ElevValue",
    ELEV_MULTI: "ElevMulti"
};

CsCallout.ROLE_TEXT = "text";
CsCallout.ROLE_LEADER = "leader";
CsCallout.KIND_TEXT = "text";
CsCallout.KIND_ELEV = "elev";
CsCallout.BASIS_FLOOR = "floor";
CsCallout.BASIS_LINE = "line";

/** Style name -> layer. A callout member goes on its STYLE's layer,
 *  never on the current layer: a note drawn onto WALLS-SURVEYED
 *  silently becomes wall linework on the next layer-driven operation. */
CsCallout.STYLES = {
    "hazard": "NOTES-HAZARD",
    "dig": "NOTES-DIG",
    "equipment": "NOTES-EQUIPMENT",
    "name": "NOTES-NAME",
    "elevation": "NOTES-ELEVATION",
    "elevation-line": "NOTES-ELEVATION-LINE"
};

CsCallout.STYLE_DEFAULT = "name";

/**
 * The next free CalloutId, as a string, given every id already in the
 * drawing.
 *
 * Max-plus-one, NOT count-plus-one: deleting callout 2 of 3 and then
 * placing a new one must not hand out "3" again and silently weld the
 * new text to the old leader. Junk entries (empty string, non-numeric)
 * are ignored rather than thrown on -- a hand-edited DXF is a thing
 * that happens, and refusing to place a callout because of one bad tag
 * elsewhere in the drawing is worse than skipping it.
 */
CsCallout.nextId = function(existing) {
    var max = 0;
    var list = existing || [];
    for (var i = 0; i < list.length; i++) {
        var n = parseInt(list[i], 10);
        if (!isNaN(n) && n > max) {
            max = n;
        }
    }
    return String(max + 1);
};
```

- [ ] **Step 4: Register the file with the test harness**

In `tests/js_unit.js`, add to the `CORE_FILES` array. Order matters only in that
`CsCallout` must load before its test block runs; put it after
`"scripts/CaveSurvey/Core/CsProfileDraw.js"`:

```javascript
    "scripts/CaveSurvey/Core/CsCallout.js",
```

- [ ] **Step 5: Run tests both ways**

Run: `node tests/js_unit.js`
Expected: PASS — `### UNIT OK <n> assertions`

Run: `./tests/run_all.sh`
Expected: all sections OK. The CaveCAD engine run is the AUTHORITATIVE one —
this suite has had two defects invisible to node and visible only in the real
engine (`RegExp.prototype.source` over-escaping, fit-point splines).

- [ ] **Step 6: Commit**

```bash
git add scripts/CaveSurvey/Core/CsCallout.js tests/js_unit.js
git commit -m "feat(CsCallout): the callout data model, styles and id allocator"
```

---

### Task 2: CsCallout.reflow — the leader geometry

**Goal:** Given a text box and N tip points, produce the polyline vertices for
every branch. This is the heart of the feature and the only reason the callout
stays glued.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsCallout.js`
- Modify: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `CsCallout.reflow(box, tips, opts)` returns
      `{side, landing: {x, y}, branches: [[{x,y}, ...]]}`.
- [ ] Side is chosen by mean tip x against box center x when `opts.side` is
      `"auto"`, and obeyed when pinned to `"left"` or `"right"`.
- [ ] The landing attaches at the VERTICAL MIDDLE of the box's near side, not
      the first-line baseline.
- [ ] Each branch is exactly three points: tip, elbow, landing end.
- [ ] Landing length falls back to a text-height multiple when `dimasz`/
      `dimscale` are absent.
- [ ] Zero tips returns zero branches without throwing.
- [ ] A tip inside the text box still produces a valid three-point branch.

**Verify:** `node tests/js_unit.js` → `### UNIT OK <n> assertions`

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `tests/js_unit.js`:

```javascript
// ---------------------------------------------------------------------
// CsCallout.reflow -- leader geometry
// ---------------------------------------------------------------------

(function() {
    // a 20-wide, 4-tall text box sitting with its lower-left at (100, 50)
    var box = { x1: 100, y1: 50, x2: 120, y2: 54 };
    var mid = 52;   // vertical middle of the box

    // --- tips to the LEFT of the text -> landing on the left side ----
    var r = CsCallout.reflow(box, [{ x: 60, y: 40 }],
                             { side: "auto", dimasz: 2, dimscale: 1 });
    eqs(r.side, "left", "reflow: tips left of text -> left landing");
    near(r.landing.x, 100, 1e-9, "reflow: landing sits on the box's left edge");
    near(r.landing.y, mid, 1e-9,
        "reflow: landing at the box's VERTICAL MIDDLE, not its baseline");
    eqs(r.branches.length, 1, "reflow: one tip -> one branch");
    eqs(r.branches[0].length, 3, "reflow: a branch is tip, elbow, landing end");
    near(r.branches[0][0].x, 60, 1e-9, "reflow: branch starts at the tip");
    near(r.branches[0][0].y, 40, 1e-9, "reflow: branch starts at the tip (y)");
    // elbow is landing-length away from the box, at landing height
    near(r.branches[0][1].x, 98, 1e-9, "reflow: elbow one landing out");
    near(r.branches[0][1].y, mid, 1e-9, "reflow: elbow at landing height");
    near(r.branches[0][2].x, 100, 1e-9, "reflow: branch ends at the landing");

    // --- tips to the RIGHT -> landing flips ---------------------------
    var rr = CsCallout.reflow(box, [{ x: 200, y: 90 }],
                              { side: "auto", dimasz: 2, dimscale: 1 });
    eqs(rr.side, "right", "reflow: tips right of text -> right landing");
    near(rr.landing.x, 120, 1e-9, "reflow: right landing on the box's right edge");
    near(rr.branches[0][1].x, 122, 1e-9, "reflow: right elbow one landing out");

    // --- pinned side overrides the geometry ---------------------------
    var rp = CsCallout.reflow(box, [{ x: 60, y: 40 }],
                              { side: "right", dimasz: 2, dimscale: 1 });
    eqs(rp.side, "right", "reflow: pinned side beats the auto choice");
    near(rp.landing.x, 120, 1e-9, "reflow: pinned right lands right");

    // --- multi-branch: all branches share one landing ------------------
    var rm = CsCallout.reflow(box, [{ x: 60, y: 40 }, { x: 55, y: 70 },
                                    { x: 70, y: 20 }],
                              { side: "auto", dimasz: 2, dimscale: 1 });
    eqs(rm.branches.length, 3, "reflow: three tips -> three branches");
    for (var i = 0; i < 3; i++) {
        near(rm.branches[i][2].x, rm.landing.x, 1e-9,
            "reflow: branch " + i + " ends at the shared landing x");
        near(rm.branches[i][2].y, rm.landing.y, 1e-9,
            "reflow: branch " + i + " ends at the shared landing y");
    }

    // --- dimasz absent -> fall back to a text-height multiple ---------
    var rf = CsCallout.reflow(box, [{ x: 60, y: 40 }],
                              { side: "auto", dimasz: null, dimscale: null });
    ok(Math.abs(rf.branches[0][1].x - rf.landing.x) > 0,
        "reflow: no dimasz still produces a non-zero landing");
    near(Math.abs(rf.branches[0][1].x - rf.landing.x), 4 * 0.5, 1e-9,
        "reflow: landing falls back to half the box height ... " +
        "box is 4 tall, so 2");

    // --- degenerate inputs -------------------------------------------
    var rz = CsCallout.reflow(box, [], { side: "auto", dimasz: 2, dimscale: 1 });
    eqs(rz.branches.length, 0, "reflow: no tips -> no branches, no throw");

    var ri = CsCallout.reflow(box, [{ x: 110, y: 52 }],
                              { side: "auto", dimasz: 2, dimscale: 1 });
    eqs(ri.branches[0].length, 3,
        "reflow: a tip INSIDE the text box still yields a valid branch");
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/js_unit.js`
Expected: FAIL — `CsCallout.reflow is not a function`

- [ ] **Step 3: Write the implementation**

Append to `scripts/CaveSurvey/Core/CsCallout.js`:

```javascript
/**
 * Solve the leader geometry for one callout.
 *
 * \param box  the text's bounding box as {x1, y1, x2, y2}, x1 < x2 and
 *             y1 < y2 -- plain numbers, NOT an RBox (this file is pure)
 * \param tips [{x, y}] one arrow tip per branch, possibly empty
 * \param opts {side: "auto"|"left"|"right",
 *              dimasz: number|null, dimscale: number|null}
 * \return {side, landing: {x, y}, branches: [[{x,y},{x,y},{x,y}]]}
 *
 * WHY THE LANDING ATTACHES AT THE VERTICAL MIDDLE and not at the first
 * line's baseline (which is the more AutoCAD-ish choice): these notes
 * get EDITED. A caver adds a second line to "bad air" and a
 * baseline-attached landing jumps by a full line height, so every arrow
 * in the callout visibly swings. Middle attachment moves by half a line
 * instead, and moves the same amount whichever end the line was added
 * to. The cost is that a tall multi-line note's arrow leaves from the
 * middle of the block rather than beside its first line; that reads
 * fine on a map and does not move when the note is reworded.
 */
CsCallout.reflow = function(box, tips, opts) {
    var o = opts || {};
    var list = tips || [];

    var height = Math.abs(box.y2 - box.y1);
    var centerX = (box.x1 + box.x2) / 2.0;
    var midY = (box.y1 + box.y2) / 2.0;

    // Landing length. dimasz x dimscale is the arrow size the drawing's
    // dimension style already uses, so a callout matches the sheet's
    // other annotation. Absent either, half the text height: a fixed
    // number would be wrong at every scale but one, and this drawing's
    // text height IS its scale, expressed.
    var landingLen;
    if (o.dimasz !== null && o.dimasz !== undefined &&
            o.dimscale !== null && o.dimscale !== undefined &&
            o.dimasz > 0 && o.dimscale > 0) {
        landingLen = o.dimasz * o.dimscale;
    } else {
        landingLen = height * 0.5;
    }

    // Side. "auto" compares the mean tip x against the box centre: the
    // landing should leave the text TOWARD the thing being pointed at,
    // or the leader crosses its own text.
    var side = o.side;
    if (side !== "left" && side !== "right") {
        var sum = 0;
        for (var i = 0; i < list.length; i++) {
            sum += list[i].x;
        }
        var meanX = (list.length > 0) ? (sum / list.length) : centerX;
        side = (meanX <= centerX) ? "left" : "right";
    }

    var landing = {
        x: (side === "left") ? box.x1 : box.x2,
        y: midY
    };
    var elbowX = (side === "left") ?
        (landing.x - landingLen) : (landing.x + landingLen);

    var branches = [];
    for (var k = 0; k < list.length; k++) {
        branches.push([
            { x: list[k].x, y: list[k].y },
            { x: elbowX, y: landing.y },
            { x: landing.x, y: landing.y }
        ]);
    }

    return { side: side, landing: landing, branches: branches };
};
```

- [ ] **Step 4: Run tests both ways**

Run: `node tests/js_unit.js`
Expected: PASS

Run: `./tests/run_all.sh`
Expected: all sections OK.

- [ ] **Step 5: Commit**

```bash
git add scripts/CaveSurvey/Core/CsCallout.js tests/js_unit.js
git commit -m "feat(CsCallout): reflow, the geometry that keeps a leader on its text"
```

---

### Task 3: The six callout style layers

**Goal:** `CsLayers` knows the callout layers, so a drawing without the template
still gets sane colors and no callout ever lands on the current layer.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsLayers.js`
- Modify: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] Six new `CsLayers` name constants, one per `CsCallout.STYLES` value.
- [ ] Each has a `CsLayers.DEFAULTS` row of `[colorName, linetype, weightKey]`.
- [ ] Every layer named in `CsCallout.STYLES` has a `DEFAULTS` row — asserted by
      test, so adding a style later without a layer fails loudly.
- [ ] `CsLayers.ensureCalloutLayers(doc, di)` exists and ensures all six.

**Verify:** `node tests/js_unit.js` → `### UNIT OK <n> assertions`

**Steps:**

**This task's guard test is load-bearing, not a formality.** `CsCallout.STYLES`
(Task 1) and `CsLayers.DEFAULTS` (this task) each type the same six layer-name
string literals, in two files, independently — `CsCallout.js` loads BEFORE
`CsLayers.js`, so it cannot reference `CsLayers.NOTES_HAZARD` without becoming a
lazy function. Between Task 1 landing and this task landing, a typo in either
table is silently uncaught. The `for...in` cross-check below is what closes that
window. Do not weaken it to a spot check of one or two styles.

- [ ] **Step 1: Write the failing test**

Append to `tests/js_unit.js`:

```javascript
// ---------------------------------------------------------------------
// Callout style layers
// ---------------------------------------------------------------------

(function() {
    // Every style must resolve to a layer that CsLayers can actually
    // create. A style whose layer has no DEFAULTS row gets created with
    // fallback appearance, which is how a hazard note ends up looking
    // like a station tick.
    for (var name in CsCallout.STYLES) {
        if (!CsCallout.STYLES.hasOwnProperty(name)) {
            continue;
        }
        var layer = CsCallout.STYLES[name];
        ok(CsLayers.DEFAULTS.hasOwnProperty(layer),
            "CsLayers.DEFAULTS has a row for callout layer " + layer +
            " (style " + name + ")");
        var row = CsLayers.DEFAULTS[layer];
        ok(row && row.length === 3,
            "CsLayers.DEFAULTS[" + layer + "] is [color, linetype, weight]");
    }

    eqs(typeof CsLayers.ensureCalloutLayers, "function",
        "CsLayers.ensureCalloutLayers exists");

    // The fallback style must differ visibly from the real one: a
    // line-basis elevation label that looks identical to a floor label
    // is the whole failure this design set out to avoid.
    ok(CsCallout.STYLES["elevation"] !== CsCallout.STYLES["elevation-line"],
        "the elevation fallback has its OWN layer, not the floor layer");
    ok(CsLayers.DEFAULTS[CsCallout.STYLES["elevation-line"]][0] !==
       CsLayers.DEFAULTS[CsCallout.STYLES["elevation"]][0],
        "the elevation fallback layer is a different COLOR");
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/js_unit.js`
Expected: FAIL — `CsLayers.DEFAULTS has a row for callout layer NOTES-HAZARD`

- [ ] **Step 3: Add the constants**

In `scripts/CaveSurvey/Core/CsLayers.js`, beside the other name constants
(near `CsLayers.TEXT_NOTES`):

```javascript
// Callout (multileader) layers, one per CsCallout style. Callout
// members go here and never on the current layer -- a note drawn onto
// WALLS-SURVEYED becomes wall linework the next time anything works by
// layer.
CsLayers.NOTES_HAZARD = "NOTES-HAZARD";
CsLayers.NOTES_DIG = "NOTES-DIG";
CsLayers.NOTES_EQUIPMENT = "NOTES-EQUIPMENT";
CsLayers.NOTES_NAME = "NOTES-NAME";
CsLayers.NOTES_ELEVATION = "NOTES-ELEVATION";
CsLayers.NOTES_ELEVATION_LINE = "NOTES-ELEVATION-LINE";
```

- [ ] **Step 4: Add the DEFAULTS rows**

In the `CsLayers.DEFAULTS` table:

```javascript
    // Callout layers. Hazard is red because it is the one a caver must
    // not miss. ELEVATION-LINE is deliberately a DIFFERENT colour from
    // ELEVATION: it carries a survey-line elevation standing in for an
    // unmeasured floor, and it must not be mistakable for the real
    // thing on a plot.
    "NOTES-HAZARD": ["red", "CONTINUOUS", "Weight025"],
    "NOTES-DIG": ["yellow", "CONTINUOUS", "Weight018"],
    "NOTES-EQUIPMENT": ["cyan", "CONTINUOUS", "Weight018"],
    "NOTES-NAME": ["white", "CONTINUOUS", "Weight018"],
    "NOTES-ELEVATION": ["green", "CONTINUOUS", "Weight018"],
    "NOTES-ELEVATION-LINE": ["gray", "DASHED", "Weight009"],
```

- [ ] **Step 5: Add the ensure helper**

Beside `CsLayers.ensureSurveyLayers`:

```javascript
/** Ensure every callout style layer exists. Called by each callout
 *  command before it writes, so a drawing that never saw the template
 *  still gets the right appearance. */
CsLayers.ensureCalloutLayers = function(doc, di) {
    CsLayers.ensure(doc, di, CsLayers.NOTES_HAZARD);
    CsLayers.ensure(doc, di, CsLayers.NOTES_DIG);
    CsLayers.ensure(doc, di, CsLayers.NOTES_EQUIPMENT);
    CsLayers.ensure(doc, di, CsLayers.NOTES_NAME);
    CsLayers.ensure(doc, di, CsLayers.NOTES_ELEVATION);
    CsLayers.ensure(doc, di, CsLayers.NOTES_ELEVATION_LINE);
};
```

- [ ] **Step 6: Run tests both ways**

Run: `node tests/js_unit.js`
Expected: PASS

Run: `./tests/run_all.sh`
Expected: all sections OK.

- [ ] **Step 7: Commit**

```bash
git add scripts/CaveSurvey/Core/CsLayers.js tests/js_unit.js
git commit -m "feat(CsLayers): six callout style layers, fallback visibly unlike floor"
```

---

### Task 4: CalloutWrite — the QCAD-context write layer

**Goal:** One place that turns pure reflow output into entities and operations.
All three commands and the listener call it, so there is exactly one definition
of what a callout looks like in a document.

**Files:**
- Create: `scripts/CaveSurvey/Callout/CalloutWrite.js`
- Create: `tests/callout_write.js`
- Modify: `tests/run_all.sh`

**Acceptance Criteria:**
- [ ] `CalloutWrite.existingIds(doc)` returns every `CalloutId` in the drawing.
- [ ] `CalloutWrite.members(doc, id)` returns `{text: entity|null, leaders: []}`.
- [ ] `CalloutWrite.create(doc, di, spec)` adds a tagged text plus one tagged
      leader per tip, on the style's layer, and returns the new id.
- [ ] `CalloutWrite.applyReflow(doc, di, id, group)` rewrites the leaders and
      passes `group` through to `setTransactionGroup` when non-null.
- [ ] Entity ids are learned by DIFFING the id set, never by
      `ids[ids.length - 1]`.
- [ ] **The whole round trip survives a DXF save/load** — export, reimport, and
      find the callout again BY ITS TAGS: same id, text role, both leader roles,
      style, and the reopened callout still reflows. This is the single most
      load-bearing test in the task: the link between a text and its leaders is
      XDATA and nothing else, so if it does not persist, every saved callout
      decays into an unrelated text and some loose arrows on reopen, and no
      in-memory test would notice. Use the `RFileExporterRegistry`
      dxflib-filter idiom already in `tests/js_unit.js` around line 13864.

**Verify:** `./tests/run_all.sh` → the `callout_write` section prints
`### CALLOUT-WRITE OK`

**Steps:**

- [ ] **Step 1: Write the failing integration test**

Create `tests/callout_write.js`. This one CANNOT run under node — it needs a real
document — so it follows the pattern of `tests/profile_draw_roundtrip.js` and runs
only in CaveCAD's engine.

```javascript
// callout_write.js -- CalloutWrite against a real document.
//
//   /Applications/CaveCAD.app/Contents/MacOS/CaveCAD \
//       -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/callout_write.js "$PWD"
//
// Prints "### CALLOUT-WRITE OK <n>" or "### CALLOUT-WRITE FAIL".

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

function loadRepoScript(rel) {
    var file = new QFile(repoRoot + "/" + rel);
    if (!file.open(QIODevice.ReadOnly | QIODevice.Text)) {
        throw new Error("cannot open " + rel);
    }
    var stream = new QTextStream(file);
    var src = stream.readAll();
    file.close();
    eval(src);
}

var FILES = [
    "scripts/CaveSurvey/Core/CsUnits.js",
    "scripts/CaveSurvey/Core/CsTags.js",
    "scripts/CaveSurvey/Core/CsStore.js",
    "scripts/CaveSurvey/Core/CsLayers.js",
    "scripts/CaveSurvey/Core/CsCallout.js",
    "scripts/CaveSurvey/Callout/CalloutWrite.js"
];
for (var fi = 0; fi < FILES.length; fi++) {
    loadRepoScript(FILES[fi]);
}

var passed = 0;
var failures = [];
function ok(c, what) { if (c) { passed++; } else { failures.push(what); } }
function eqs(a, b, what) {
    ok(a === b, what + " (expected " + b + ", got " + a + ")");
}
function near(a, b, tol, what) {
    ok(Math.abs(a - b) <= tol,
        what + " (expected " + b + " +/- " + tol + ", got " + a + ")");
}

var di = new RDocumentInterface(new RDocument(new RMemoryStorage(),
                                              new RSpatialIndexNavel()));
var doc = di.getDocument();
CsLayers.ensureCalloutLayers(doc, di);

// --- an empty drawing has no ids -------------------------------------
eqs(CalloutWrite.existingIds(doc).length, 0,
    "existingIds on an empty drawing");

// --- create ----------------------------------------------------------
var id = CalloutWrite.create(doc, di, {
    text: "bad air",
    position: { x: 100, y: 50 },
    tips: [{ x: 60, y: 40 }, { x: 55, y: 70 }],
    style: "hazard",
    kind: CsCallout.KIND_TEXT,
    height: 4.0
});
ok(id !== null && id !== undefined && String(id).length > 0,
    "create returns an id");
eqs(CalloutWrite.existingIds(doc).length, 1,
    "the drawing now reports exactly one callout id");

var m = CalloutWrite.members(doc, id);
ok(m.text !== null, "members finds the text");
eqs(m.leaders.length, 2, "members finds one leader per tip");
eqs(CsTags.get(m.text, CsCallout.KEY.ROLE), CsCallout.ROLE_TEXT,
    "the text carries role=text");
eqs(CsTags.get(m.text, CsCallout.KEY.STYLE), "hazard",
    "the text carries its style");
eqs(CsTags.get(m.leaders[0], CsCallout.KEY.ROLE), CsCallout.ROLE_LEADER,
    "a leader carries role=leader");
eqs(CsTags.get(m.leaders[0], CsCallout.KEY.ID), String(id),
    "a leader carries the SAME id as its text");

// --- layer discipline: never the current layer ------------------------
eqs(doc.getLayerName(m.text.getLayerId()), CsLayers.NOTES_HAZARD,
    "the text landed on its STYLE's layer");
eqs(doc.getLayerName(m.leaders[0].getLayerId()), CsLayers.NOTES_HAZARD,
    "the leader landed on its style's layer too");

// --- entity count actually changed (an op can 'succeed' and add nothing)
var onLayer = doc.queryLayerEntities(
    doc.getLayerId(CsLayers.NOTES_HAZARD), true);
eqs(onLayer.length, 3, "three entities on the hazard layer: 1 text + 2 leaders");

// --- applyReflow rewrites leaders and leaves the text alone -----------
var textBefore = CsTags.get(m.text, CsCallout.KEY.ID);
CalloutWrite.applyReflow(doc, di, id, null);
var m2 = CalloutWrite.members(doc, id);
eqs(m2.leaders.length, 2, "reflow kept one leader per branch");
eqs(CsTags.get(m2.text, CsCallout.KEY.ID), textBefore,
    "reflow did not disturb the text's tags");

// --- undo grouping passes through -------------------------------------
// Two grouped applies must collapse to a single undo.
var before = doc.queryAllEntities(false, true).length;
CalloutWrite.applyReflow(doc, di, id, 4242);
CalloutWrite.applyReflow(doc, di, id, 4242);
di.undo();
eqs(doc.queryAllEntities(false, true).length, before,
    "two group-4242 reflows collapse into ONE undo");

var out;
if (failures.length === 0) {
    out = "### CALLOUT-WRITE OK " + passed;
} else {
    out = "### CALLOUT-WRITE FAIL " + failures.length + " of " +
        (passed + failures.length) + "\n";
    for (var k = 0; k < failures.length; k++) {
        out += "  FAIL: " + failures[k] + "\n";
    }
}
print(out);
```

- [ ] **Step 2: Run test to verify it fails**

```bash
/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/callout_write.js "$PWD"
```

Expected: FAIL — `cannot open scripts/CaveSurvey/Callout/CalloutWrite.js`

- [ ] **Step 3: Write the implementation**

Create `scripts/CaveSurvey/Callout/CalloutWrite.js`:

```javascript
/**
 * CalloutWrite -- every QCAD-context write a callout needs.
 *
 * The pure geometry lives in Core/CsCallout.js. This file is the only
 * place that constructs entities, applies operations or reads a
 * document, so there is exactly ONE definition of what a callout looks
 * like in a drawing -- shared by all three commands and the listener.
 *
 * NOT loaded by tests/js_unit.js (it cannot run under node).
 * tests/callout_write.js covers it in CaveCAD's own engine.
 */
function CalloutWrite() {}

/** Every CalloutId present in the drawing, as strings, deduped. */
CalloutWrite.existingIds = function(doc) {
    var out = [];
    var seen = {};
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var cid = CsTags.get(e, CsCallout.KEY.ID);
        if (cid !== "" && !seen.hasOwnProperty(cid)) {
            seen[cid] = true;
            out.push(cid);
        }
    }
    return out;
};

/** The members of one callout: {text: entity|null, leaders: [entity]}. */
CalloutWrite.members = function(doc, id) {
    var want = String(id);
    var res = { text: null, leaders: [] };
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || CsTags.get(e, CsCallout.KEY.ID) !== want) {
            continue;
        }
        var role = CsTags.get(e, CsCallout.KEY.ROLE);
        if (role === CsCallout.ROLE_TEXT) {
            res.text = e;
        } else if (role === CsCallout.ROLE_LEADER) {
            res.leaders.push(e);
        }
    }
    return res;
};

/** The text's bounding box as the plain {x1,y1,x2,y2} CsCallout wants. */
CalloutWrite.boxOf = function(textEntity) {
    var b = textEntity.getBoundingBox();
    var c1 = b.getCorner1();
    var c2 = b.getCorner2();
    return {
        x1: Math.min(c1.x, c2.x), y1: Math.min(c1.y, c2.y),
        x2: Math.max(c1.x, c2.x), y2: Math.max(c1.y, c2.y)
    };
};

/**
 * Place a new callout. Returns its id.
 *
 * \param spec {text, position: {x,y}, tips: [{x,y}], style, kind,
 *              height, tags: {extra XDATA} }
 *
 * The ids of the entities just added are learned by DIFFING the id set:
 * queryAllEntities is NOT insertion-ordered, so ids[ids.length-1] is
 * arbitrary and only looks correct on an empty document.
 */
CalloutWrite.create = function(doc, di, spec) {
    var style = spec.style || CsCallout.STYLE_DEFAULT;
    var layerName = CsCallout.STYLES[style] || CsCallout.STYLES[
        CsCallout.STYLE_DEFAULT];
    CsLayers.ensure(doc, di, layerName);

    var id = CsCallout.nextId(CalloutWrite.existingIds(doc));

    // --- the text ----------------------------------------------------
    var before = CalloutWrite.idSet(doc);

    var textData = new RTextData();
    textData.setText(spec.text);
    textData.setPosition(new RVector(spec.position.x, spec.position.y));
    textData.setTextHeight(spec.height);
    var textEntity = new RTextEntity(doc, textData);
    textEntity.setLayerId(doc.getLayerId(layerName));

    CsLayers.withLayerOn(doc, di, layerName, function() {
        var op = new RAddObjectsOperation();
        op.addObject(textEntity, false);
        di.applyOperation(op);
    });

    var added = CalloutWrite.newIds(doc, before);
    if (added.length !== 1) {
        // An operation that "succeeded" may have added nothing: a
        // LOCKED or FROZEN layer refuses silently and withLayerOn
        // covers OFF only.
        throw new Error("callout text was not added -- layer " +
            layerName + " may be locked or frozen");
    }
    var textId = added[0];
    var text = doc.queryEntity(textId);

    var tags = {};
    tags[CsCallout.KEY.ID] = id;
    tags[CsCallout.KEY.ROLE] = CsCallout.ROLE_TEXT;
    tags[CsCallout.KEY.KIND] = spec.kind || CsCallout.KIND_TEXT;
    tags[CsCallout.KEY.STYLE] = style;
    tags[CsCallout.KEY.SIDE] = "auto";
    if (spec.tags) {
        for (var k in spec.tags) {
            if (spec.tags.hasOwnProperty(k)) {
                tags[k] = spec.tags[k];
            }
        }
    }
    CsTags.commit(di, text, tags);

    // --- the leaders -------------------------------------------------
    CalloutWrite.writeLeaders(doc, di, id, spec.tips, style, layerName, null);

    return id;
};

/** The current entity id set, as a {id: true} map. */
CalloutWrite.idSet = function(doc) {
    var m = {};
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        m[ids[i]] = true;
    }
    return m;
};

/** Ids present now that were not in `before`. */
CalloutWrite.newIds = function(doc, before) {
    var out = [];
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        if (!before.hasOwnProperty(ids[i])) {
            out.push(ids[i]);
        }
    }
    return out;
};

/**
 * Delete this callout's leaders and write one per tip, reflowed against
 * the text's CURRENT box. `group` is a transaction group id or null.
 */
CalloutWrite.writeLeaders = function(doc, di, id, tips, style, layerName,
        group) {
    var m = CalloutWrite.members(doc, id);
    if (m.text === null) {
        return;
    }

    var side = CsTags.get(m.text, CsCallout.KEY.SIDE);
    var geom = CsCallout.reflow(CalloutWrite.boxOf(m.text), tips, {
        side: (side === "" ? "auto" : side),
        dimasz: CalloutWrite.dimVar(doc, RS.DIMASZ),
        dimscale: CalloutWrite.dimVar(doc, RS.DIMSCALE)
    });

    CsLayers.withLayerOn(doc, di, layerName, function() {
        // out with the old
        if (m.leaders.length > 0) {
            var del = new RDeleteObjectsOperation();
            for (var d = 0; d < m.leaders.length; d++) {
                del.deleteObject(m.leaders[d]);
            }
            if (group !== null && group !== undefined) {
                del.setTransactionGroup(group);
            }
            di.applyOperation(del);
        }

        // in with the new
        for (var b = 0; b < geom.branches.length; b++) {
            var before = CalloutWrite.idSet(doc);
            var pl = new RPolyline();
            var pts = geom.branches[b];
            for (var p = 0; p < pts.length; p++) {
                pl.appendVertex(new RVector(pts[p].x, pts[p].y));
            }
            var data = new RLeaderData(pl, true);   // true = arrowHead
            var ent = new RLeaderEntity(doc, data);
            ent.setLayerId(doc.getLayerId(layerName));

            var op = new RAddObjectsOperation();
            op.addObject(ent, false);
            if (group !== null && group !== undefined) {
                op.setTransactionGroup(group);
            }
            di.applyOperation(op);

            var added = CalloutWrite.newIds(doc, before);
            if (added.length === 1) {
                var live = doc.queryEntity(added[0]);
                var t = {};
                t[CsCallout.KEY.ID] = String(id);
                t[CsCallout.KEY.ROLE] = CsCallout.ROLE_LEADER;
                t[CsCallout.KEY.STYLE] = style;
                CsTags.commit(di, live, t);
            }
        }
    });
};

/**
 * Reflow an existing callout in place: read its current tips off its
 * current leaders, then rewrite them against the text's current box.
 *
 * A leader's tip is its FIRST vertex (reflow emits tip, elbow, landing),
 * which is what lets a caver drag the tip grip and have the elbow
 * follow rather than the other way round.
 */
CalloutWrite.applyReflow = function(doc, di, id, group) {
    var m = CalloutWrite.members(doc, id);
    if (m.text === null || m.leaders.length === 0) {
        return;
    }
    var style = CsTags.get(m.text, CsCallout.KEY.STYLE) ||
        CsCallout.STYLE_DEFAULT;
    var layerName = CsCallout.STYLES[style] ||
        CsCallout.STYLES[CsCallout.STYLE_DEFAULT];

    var tips = [];
    for (var i = 0; i < m.leaders.length; i++) {
        var v = m.leaders[i].getData().getVertexAt(0);
        tips.push({ x: v.x, y: v.y });
    }
    CalloutWrite.writeLeaders(doc, di, id, tips, style, layerName, group);
};

/**
 * One dimension variable, or null when the drawing has not set it.
 *
 * The default MUST be numeric: getKnownVariable(handle, null) returns
 * undefined and prints "RJSHelper::js2cpp_QVariant: no wrapper", and
 * the one-argument form returns undefined too. 0 comes back for an
 * unset variable, and 0 is not a usable length -- so it maps to null
 * and lets CsCallout.reflow's text-height fallback carry it.
 */
CalloutWrite.dimVar = function(doc, handle) {
    var v = doc.getKnownVariable(handle, 0);
    if (v === null || v === undefined || v <= 0) {
        return null;
    }
    return v;
};

/**
 * Text height for a new callout: the drawing's own DIMTXT, so a note
 * matches the sheet's other annotation at whatever scale it plots. Lives
 * here rather than on any one command because all of them need it.
 */
CalloutWrite.textHeight = function(doc) {
    var h = CalloutWrite.dimVar(doc, RS.DIMTXT);
    return (h === null) ? 2.5 : h;   // 2.5 is a last resort, not a default
};

/** Strip callout tags off an entity, leaving it as ordinary geometry. */
CalloutWrite.unlink = function(di, entity) {
    var t = {};
    t[CsCallout.KEY.ID] = "";
    t[CsCallout.KEY.ROLE] = "";
    CsTags.commit(di, entity, t);
};
```

- [ ] **Step 4: Register the test with the runner**

In `tests/run_all.sh`, add a section modelled on the existing ones:

```bash
run_section "callout_write" "### CALLOUT-WRITE OK" tests/callout_write.js
```

Match the exact shape the neighbouring sections use — read them first; the
runner's helper name and argument order in this repo take precedence over the
line above.

- [ ] **Step 5: Run the test**

```bash
./tests/run_all.sh
```

Expected: `### CALLOUT-WRITE OK <n>` and every other section still OK.

The dimension-variable handles are already confirmed (`RS.DIMASZ` 24,
`RS.DIMSCALE` 53) — see "Engine facts". What is NOT settled is whether the
Pitfall Cave fixture actually sets them; if `CalloutWrite.dimVar` returns null
there, that is correct behaviour and the text-height fallback carries it. Do NOT
invent a fixed number to paper over it.

- [ ] **Step 6: Commit**

```bash
git add scripts/CaveSurvey/Callout/CalloutWrite.js tests/callout_write.js tests/run_all.sh
git commit -m "feat(CalloutWrite): one definition of a callout in a document"
```

---

### Task 5: The CsCallout command

**Goal:** A caver can place a text callout with one or more arrows from the menu.

**Files:**
- Create: `scripts/CaveSurvey/Callout/Callout.js`
- Create: `scripts/CaveSurvey/Callout/Callout.svg`

**Acceptance Criteria:**
- [ ] `CsCallout` appears in the Cave Survey menu and toolbar, and runs from the
      command line as `cscal`.
- [ ] Prompts: pick tip (repeatable), pick text position, enter text, pick style.
- [ ] Placing a callout with three tips yields one text and three leaders sharing
      an id.
- [ ] Escape steps back one state; escape at the first state cancels cleanly with
      nothing added.
- [ ] The command never calls `RGuiAction.trigger()` from inside a lifecycle
      event.

**Verify:** Launch CaveCAD, open `testdata`'s Pitfall Cave drawing, run `cscal`,
place a two-branch note. Then `./tests/run_all.sh` → all sections OK.

**Steps:**

**`reflow` returns `side` and `landing`, which nothing outside `CsCallout.js`
reads yet.** Task 4's `writeLeaders` consumes only `geom.branches`. Code review on
Task 2 flagged this as potential dead API surface. Use them here for the live
placement preview — showing the landing and its chosen side while the caver is
still picking is exactly what they are for. If this command ends up not needing
them, say so in the task report so they can be pruned deliberately rather than
left as decoration.

- [ ] **Step 1: Read the reference implementation**

Read `scripts/CaveSurvey/AlignImage/AlignImage.js` end to end. It is the suite's
reference interactive tool: `Tool.State` enum, `initState()` with
`setCommandPrompt` / `setLeftMouseTip` / `setRightMouseTip`, `pickCoordinate`
with a `preview` flag, `escapeEvent` stepping back one state, `enterEvent`
finishing. Match its shape — deviating from it is what makes a tool feel unlike
the rest of the suite.

- [ ] **Step 2: Write the command**

Create `scripts/CaveSurvey/Callout/Callout.js`. The skeleton, with the parts that
are specific to this tool filled in and the interactive plumbing following
`AlignImage.js`:

```javascript
/**
 * CsCallout -- place a text note bound to one or more leader arrows.
 *
 * QCAD has no multileader; this is it. The text stays a real
 * RTextEntity so the native editor and grips keep working, and
 * CalloutListener keeps the arrows glued to it afterwards.
 */
include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");
include(includeBasePath + "/CalloutWrite.js");

function Callout(guiAction) {
    EAction.call(this, guiAction);
    this.tips = [];
    this.position = null;
    this.noteText = "";
    this.style = CsCallout.STYLE_DEFAULT;
    this.setUiOptions("Callout.ui");   // omit if no .ui file is used
}

Callout.prototype = new EAction();

Callout.State = {
    PickingTip: 0,
    PickingPosition: 1
};

Callout.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    var doc = this.getDocument();
    if (isNull(doc)) {
        this.terminate();
        return;
    }
    CsLayers.ensureCalloutLayers(doc, this.getDocumentInterface());
    this.setState(Callout.State.PickingTip);
};

Callout.prototype.setState = function(state) {
    EAction.prototype.setState.call(this, state);
    this.setCrosshairCursor();
    var appWin = RMainWindowQt.getMainWindow();
    if (state === Callout.State.PickingTip) {
        var tipMsg = (this.tips.length === 0) ?
            qsTr("Pick what the arrow points at") :
            qsTr("Pick another arrow target, or press Enter for the note");
        this.setCommandPrompt(tipMsg);
        this.setLeftMouseTip(tipMsg);
        this.setRightMouseTip(EAction.trCancel);
    } else {
        this.setCommandPrompt(qsTr("Pick where the note text goes"));
        this.setLeftMouseTip(qsTr("Position of the note text"));
        this.setRightMouseTip(EAction.trBack);
    }
    appWin.setStatusTip("");
};

Callout.prototype.coordinateEvent = function(event) {
    var pos = event.getModelPosition();
    if (this.state === Callout.State.PickingTip) {
        this.tips.push({ x: pos.x, y: pos.y });
        this.setState(Callout.State.PickingTip);   // allow another
        return;
    }
    this.position = { x: pos.x, y: pos.y };
    this.finish();
};

Callout.prototype.enterEvent = function() {
    if (this.state === Callout.State.PickingTip && this.tips.length > 0) {
        this.setState(Callout.State.PickingPosition);
        return;
    }
    EAction.prototype.enterEvent.call(this);
};

Callout.prototype.escapeEvent = function() {
    if (this.state === Callout.State.PickingPosition) {
        this.setState(Callout.State.PickingTip);
        return;
    }
    if (this.tips.length > 0) {
        this.tips.pop();
        this.setState(Callout.State.PickingTip);
        return;
    }
    EAction.prototype.escapeEvent.call(this);
};

/** Ask for the note text and the style, then write the callout. */
Callout.prototype.finish = function() {
    var di = this.getDocumentInterface();
    var doc = this.getDocument();

    var asked = Callout.askForNote(this.style);
    if (asked === null) {
        this.terminate();
        return;
    }

    CalloutWrite.create(doc, di, {
        text: asked.text,
        position: this.position,
        tips: this.tips,
        style: asked.style,
        kind: CsCallout.KIND_TEXT,
        height: CalloutWrite.textHeight(doc)
    });

    this.terminate();
};

/**
 * The note text and style. Returns {text, style} or null if cancelled.
 *
 * QDialog + exec() works in this bridge (SurveyNotebook's dialogs are
 * the precedent), but QTableWidget does not exist and QTreeWidget /
 * QListWidget are NOT constructible -- `new QTreeWidget()` returns a
 * convincing stub whose every real method is undefined. So this is
 * QLineEdit / QLabel / QPushButton only, the same shape SurveyNotebook
 * uses for the same reason. Every construction is wrapped: a bridge
 * without QDialog must degrade to a single-line prompt, not crash.
 *
 * Note the addWidget(w, 0, 0) arity -- this bridge wants the extra
 * arguments.
 */
Callout.askForNote = function(currentStyle) {
    var result = null;
    var styleNames = [];
    for (var sn in CsCallout.STYLES) {
        if (CsCallout.STYLES.hasOwnProperty(sn)) {
            styleNames.push(sn);
        }
    }

    try {
        var dlg = new QDialog(getMainWindow());
        dlg.windowTitle = qsTr("Callout");
        var layout = new QVBoxLayout();

        layout.addWidget(new QLabel(qsTr(
            "Note text. It stays an ordinary text entity, so you can\n" +
            "edit it later by double-clicking it -- the arrows follow.")),
            0, 0);

        var edit = new QLineEdit();
        layout.addWidget(edit, 0, 0);

        layout.addWidget(new QLabel(qsTr("Style:")), 0, 0);
        var styleRow = new QHBoxLayout();
        var chosen = { name: currentStyle || CsCallout.STYLE_DEFAULT };
        var buttons = [];
        for (var i = 0; i < styleNames.length; i++) {
            var b = new QPushButton(styleNames[i]);
            try {
                b.checkable = true;
                b.checked = (styleNames[i] === chosen.name);
            } catch (eChk) {
                // not checkable in this bridge: it still clicks, and a
                // click is all we actually need
            }
            styleRow.addWidget(b, 0, 0);
            buttons.push({ button: b, name: styleNames[i] });
        }
        layout.addLayout(styleRow, 0);

        var bar = new QHBoxLayout();
        var okBtn = new QPushButton(qsTr("Place"));
        var cancelBtn = new QPushButton(qsTr("Cancel"));
        bar.addStretch(1);
        bar.addWidget(okBtn, 0, 0);
        bar.addWidget(cancelBtn, 0, 0);
        layout.addLayout(bar, 0);
        dlg.setLayout(layout);

        for (var k = 0; k < buttons.length; k++) {
            (function(entry) {
                try {
                    entry.button.clicked.connect(function() {
                        chosen.name = entry.name;
                        for (var j = 0; j < buttons.length; j++) {
                            try {
                                buttons[j].button.checked =
                                    (buttons[j].name === entry.name);
                            } catch (eSet) {
                                // cosmetic only
                            }
                        }
                    });
                } catch (eCon) {
                    // a style that cannot be selected is a lost option,
                    // not a broken command
                }
            })(buttons[k]);
        }

        okBtn.clicked.connect(function() { dlg.accept(); });
        cancelBtn.clicked.connect(function() { dlg.reject(); });

        // Decisions happen AFTER exec() returns, while the widgets are
        // certainly still alive.
        if (dlg.exec() !== 0) {
            var typed = edit.text;
            if (typed !== null && typed !== undefined &&
                    String(typed).length > 0) {
                result = { text: String(typed), style: chosen.name };
            }
        }
        return result;
    } catch (eDlg) {
        // No QDialog in this bridge. The text is the half that cannot be
        // done any other way, so ask for that much and take the default
        // style.
        try {
            var typed2 = QInputDialog.getText(null, qsTr("Callout"),
                qsTr("Note text:"));
            if (typed2 !== null && typed2 !== undefined &&
                    String(typed2).length > 0) {
                return { text: String(typed2),
                         style: currentStyle || CsCallout.STYLE_DEFAULT };
            }
        } catch (eIn) {
            // nothing available: place nothing rather than place junk
        }
        return null;
    }
};

Callout.init = function(basePath) {
    var action = new RGuiAction(qsTr("Callout"),
                                RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/Callout.js");
    action.setIcon(basePath + "/Callout.svg");
    action.setStatusTip(qsTr("A note bound to one or more arrows, " +
        "which stays bound when you edit or move the text"));
    action.setDefaultCommands(["cscallout", "cscal"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(88);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
```

Fill in `Callout.askForNote` against `SurveyNotebook.js`'s dialog code. Do NOT
leave it unimplemented — the command cannot work without it.

- [ ] **Step 3: Draw the icon**

Create `scripts/CaveSurvey/Callout/Callout.svg` — a 24x24 SVG showing a short
horizontal landing with an arrow leaving it diagonally, plus two text lines.
Match the stroke weights of the existing suite icons (copy one and edit it).

- [ ] **Step 4: Verify by hand in the app**

Launch CaveCAD. Confirm:
- "Callout" appears in the Cave Survey menu at the right position (after the
  tool at sortOrder 85, before nothing else).
- `cscal` on the command line starts it.
- Pick two tips, press Enter, pick a text position, type a note, choose
  "hazard": one text and two arrows appear, on `NOTES-HAZARD`.
- Escape at the first prompt cancels with nothing added to the drawing.

If the menu entry does NOT appear, the cause is almost always the wiring
(§9 of the spec): a wrong `setWidgetNames`, a duplicate
`(groupSortOrder, sortOrder)`, or a `setScriptFile` not pointing at its own file.
It fails silently with no error.

- [ ] **Step 5: Run the suite**

```bash
./tests/run_all.sh
```

Expected: all sections OK.

- [ ] **Step 6: Commit**

```bash
git add scripts/CaveSurvey/Callout/
git commit -m "feat(Callout): place a note bound to one or more arrows"
```

---

### Task 6: The CsCalloutSync command

**Goal:** Reflow every callout in the drawing (or the selection) on demand. This
makes the tool usable BEFORE the listener exists, and stays the repair path for
files edited where the listener never loaded.

**Files:**
- Create: `scripts/CaveSurvey/CalloutSync/CalloutSync.js`
- Create: `scripts/CaveSurvey/CalloutSync/CalloutSync.svg`
- Modify: `tests/callout_write.js`

**Acceptance Criteria:**
- [ ] `cscsync` reflows all callouts when nothing is selected, and only the
      selected callouts when there is a selection.
- [ ] Reports a count of callouts reflowed, and separately a count it could NOT
      touch, via `QMessageBox.information` (not `handleUserMessage`).
- [ ] A callout whose text was moved by native tools has its leaders land back on
      the text — asserted by test.
- [ ] A locked or frozen style layer is reported, not silently skipped.
- [ ] Geometry reflow ONLY. Spec §8.3's other half — re-deriving elevation
      labels from their stored source — lands in Task 8 Step 8, because it needs
      `CsElevation`, which does not exist until Task 7. Not forgotten, sequenced.

**Verify:** `./tests/run_all.sh` → `### CALLOUT-WRITE OK` including the new
moved-text assertions.

**Steps:**

- [ ] **Step 1: Write the failing test**

Append to `tests/callout_write.js`, before the report block:

```javascript
// --- the move-the-text case, which is the whole point ----------------
// Move the text with an ordinary modify operation, exactly as QCAD's
// own grip drag would, then sync and confirm the leaders followed.
(function() {
    var mm = CalloutWrite.members(doc, id);
    var td = mm.text.getData();
    var oldPos = td.getPosition();
    td.setPosition(new RVector(oldPos.x + 300, oldPos.y + 120));
    mm.text.setData(td);
    var mop = new RModifyObjectsOperation();
    mop.addObject(mm.text, false);
    di.applyOperation(mop);

    CalloutWrite.applyReflow(doc, di, id, null);

    var after = CalloutWrite.members(doc, id);
    var box = CalloutWrite.boxOf(after.text);
    for (var i = 0; i < after.leaders.length; i++) {
        var vs = after.leaders[i].getData();
        var last = vs.getVertexAt(vs.countVertices() - 1);
        ok(last.x >= box.x1 - 1e-6 && last.x <= box.x2 + 1e-6,
            "leader " + i + " lands on the MOVED text's edge, not its old one");
        ok(last.y >= box.y1 - 1e-6 && last.y <= box.y2 + 1e-6,
            "leader " + i + " lands within the moved text's vertical span");
    }

    // and the tip did NOT move: the arrow still points at the cave
    var tip = after.leaders[0].getData().getVertexAt(0);
    ok(tip.x < box.x1, "the arrow TIP stayed put while the text moved");
})();
```

- [ ] **Step 2: Run test to verify it fails or passes**

```bash
./tests/run_all.sh
```

If `applyReflow` from Task 4 is correct, this passes immediately — that is fine
and expected; the assertions exist to PIN the behaviour, and this task's real
work is the command. If it fails, fix `applyReflow` before writing the command.

- [ ] **Step 3: Write the command**

Create `scripts/CaveSurvey/CalloutSync/CalloutSync.js`:

```javascript
/**
 * CsCalloutSync -- reflow callouts on demand.
 *
 * Two jobs. It is the repair path for a drawing edited where
 * CalloutListener never loaded (an older build, or a file that came
 * from someone else), and it re-derives elevation labels whose stored
 * source now resolves differently -- which is how a "line" fallback
 * label upgrades itself to a real floor label once D is entered on a
 * later trip.
 */
include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");
include(includeBasePath + "/../Callout/CalloutWrite.js");

function CalloutSync(guiAction) {
    EAction.call(this, guiAction);
}

CalloutSync.prototype = new EAction();

CalloutSync.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    if (isNull(doc)) {
        this.terminate();
        return;
    }
    var report = CalloutSync.run(doc, di);
    // handleUserMessage cannot show multi-line text: CommandLine.js
    // wraps in <span> and Qt collapses every newline to a space.
    QMessageBox.information(RMainWindowQt.getMainWindow(),
        qsTr("Callout Sync"), report);
    this.terminate();
};

/**
 * Reflow the selected callouts, or every callout when nothing is
 * selected. Returns a human-readable multi-line report.
 *
 * Counts entities on the target layer before and after rather than
 * trusting the operation: LOCKED and FROZEN layers refuse writes
 * SILENTLY, di.applyOperation reports nothing useful, and
 * CsLayers.withLayerOn covers OFF only. A callout that could not be
 * rewritten must be NAMED, not quietly skipped -- a stale leader on a
 * plotted map is the exact failure this tool exists to prevent.
 */
CalloutSync.run = function(doc, di) {
    var ids = CalloutSync.targetIds(doc);
    var done = 0;
    var refused = [];

    for (var i = 0; i < ids.length; i++) {
        var id = ids[i];
        var m = CalloutWrite.members(doc, id);
        if (m.text === null) {
            refused.push(id + " (no text -- orphaned leaders)");
            continue;
        }
        var style = CsTags.get(m.text, CsCallout.KEY.STYLE) ||
            CsCallout.STYLE_DEFAULT;
        var layerName = CsCallout.STYLES[style] ||
            CsCallout.STYLES[CsCallout.STYLE_DEFAULT];
        var lay = doc.queryLayer(layerName);
        if (!isNull(lay) && CsLayers.refusesEdits(lay)) {
            refused.push(id + " (layer " + layerName + " refuses edits)");
            continue;
        }

        var wanted = m.leaders.length;
        CalloutWrite.applyReflow(doc, di, id, null);
        var got = CalloutWrite.members(doc, id).leaders.length;
        if (got !== wanted) {
            refused.push(id + " (wrote " + got + " of " + wanted +
                " leaders)");
        } else {
            done++;
        }
    }

    var msg = qsTr("Reflowed %1 callout(s).").arg(done);
    if (refused.length > 0) {
        msg += "\n\n" + qsTr("Could not update:") + "\n  " +
            refused.join("\n  ");
    }
    return msg;
};

/** Selected callout ids, or every id when nothing is selected. */
CalloutSync.targetIds = function(doc) {
    var selected = doc.querySelectedEntities();
    if (selected.length === 0) {
        return CalloutWrite.existingIds(doc);
    }
    var seen = {};
    var out = [];
    for (var i = 0; i < selected.length; i++) {
        var e = doc.queryEntity(selected[i]);
        if (isNull(e)) {
            continue;
        }
        var cid = CsTags.get(e, CsCallout.KEY.ID);
        if (cid !== "" && !seen.hasOwnProperty(cid)) {
            seen[cid] = true;
            out.push(cid);
        }
    }
    return out;
};

CalloutSync.init = function(basePath) {
    var action = new RGuiAction(qsTr("Callout Sync"),
                                RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/CalloutSync.js");
    action.setIcon(basePath + "/CalloutSync.svg");
    action.setStatusTip(qsTr("Re-attach callout arrows to their text, " +
        "and refresh elevation labels"));
    action.setDefaultCommands(["cscalloutsync", "cscsync"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(92);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
```

- [ ] **Step 4: Draw the icon**

Create `CalloutSync.svg` — the Callout icon with a small circular-arrow refresh
glyph. Copy `Callout.svg` and add the glyph.

- [ ] **Step 5: Verify by hand**

In CaveCAD: place a callout, drag its text well away with the native grip, run
`cscsync`. The arrows must snap back onto the text with their tips unmoved. Then
lock the `NOTES-HAZARD` layer and run it again — the callout must be listed under
"Could not update", not silently skipped.

- [ ] **Step 6: Run the suite and commit**

```bash
./tests/run_all.sh
git add scripts/CaveSurvey/CalloutSync/ tests/callout_write.js
git commit -m "feat(CalloutSync): reflow callouts on demand, and name what it could not touch"
```

---

### Task 7: CsElevation — floor sampling along the alignment

**Goal:** The pure answer to "what is the floor elevation at this point", from
LRUD `D` and down-splays, with an honest fallback and no fabricated zeros.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsElevation.js`
- Modify: `tests/js_unit.js`
- Modify: `scripts/CaveSurvey/Core/CsAll.js` (enforced by a structural test)

**Acceptance Criteria:**
- [ ] `CsElevation.floorWalkable(lrud)` returns the SHALLOWEST of a multi-value
      `D`, the single value when there is one, `0` for `P`, and `null` when the
      reading is absent.
- [ ] `CsElevation.sampleFloor(survey, resolved, point, opts)` returns
      `{z, basis, from, to, fraction, multi}` or `null`.
- [ ] Returns `null` when no leg is within tolerance.
- [ ] `basis === "floor"` when floor evidence exists; interpolates linearly
      between the two bracketing evidence points.
- [ ] `basis === "line"` when D is null at both ends and no floor splay
      classifies in — returning the survey-line z, NEVER 0.
- [ ] A down-splay between the stations shifts the answer.
- [ ] A splay with no inclination on record is IGNORED, not treated as flat.
- [ ] `multi` is true when the governing station's `D` had extra readings.

**Verify:** `node tests/js_unit.js` → `### UNIT OK <n> assertions`, and
`./tests/run_all.sh` all OK.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `tests/js_unit.js`. Build the survey with the same helpers the existing
network/profile blocks in that file use — read those blocks first and reuse their
fixture construction rather than inventing a second style.

```javascript
// ---------------------------------------------------------------------
// CsElevation -- floor, not centreline
// ---------------------------------------------------------------------

(function() {
    // --- floorWalkable ------------------------------------------------
    // parseLrudEntry gives {value: max, all: [every reading] | null}.
    // The callout wants the SHALLOWEST: a caver stands on the 2, the 6
    // is a pit below. CsProfile deliberately wants the deepest.
    eqs(CsElevation.floorWalkable(CsModel.parseLrudEntry("2/6")), 2,
        "floorWalkable: 2/6 is walkable at 2, not at the pit bottom");
    eqs(CsElevation.floorWalkable(CsModel.parseLrudEntry("6/2")), 2,
        "floorWalkable: order in the cell does not matter");
    eqs(CsElevation.floorWalkable(CsModel.parseLrudEntry("3")), 3,
        "floorWalkable: a single reading is itself");
    eqs(CsElevation.floorWalkable(CsModel.parseLrudEntry("P")), 0,
        "floorWalkable: P is a REAL zero -- floor at the survey line");
    eqs(CsElevation.floorWalkable(CsModel.parseLrudEntry("")), null,
        "floorWalkable: an empty cell is unknown, NOT zero");
    eqs(CsElevation.floorWalkable(CsModel.parseLrudEntry("--")), null,
        "floorWalkable: -- is unknown, NOT zero");

    // and the divergence from CsProfile is intentional and pinned:
    var e = CsModel.parseLrudEntry("2/6");
    eqs(e.value, 6, "parseLrudEntry.value is the DEEPEST (what CsProfile uses)");
    eqs(CsElevation.floorWalkable(e), 2,
        "floorWalkable is the SHALLOWEST -- the two disagree ON PURPOSE");
})();
```

Then the `sampleFloor` block. The fixture uses THREE stations, sampled on the
`A2`->`A3` leg, because LRUD attaches to the shot whose `to` is the station
(`CsModel.lrudForStation`) — a first station's LRUD lives in `survey.startLrud`
instead, and sampling a leg whose both endpoints get LRUD the ordinary way keeps
the fixture about floors rather than about that special case.

```javascript
(function() {
    // A1 --100--> A2 --100--> A3, the second leg climbing 10.
    // D: A2 reads 5, A3 reads 3. Anchor A1 at z=1000 so the numbers are
    // absolute-datum, like a real cave.
    var INC10 = Math.asin(0.1) * 180.0 / Math.PI;   // dz = 10 over 100

    function fixture(opts) {
        var o = opts || {};
        var sv = CsModel.newSurvey();

        var s1 = shotOf("A1", "A2", 100, 90, 0);
        s1.down = (o.d2 === undefined) ? 5 : o.d2;
        s1.downAll = (o.d2All === undefined) ? null : o.d2All;

        var s2 = shotOf("A2", "A3", 100, 90, INC10);
        s2.down = (o.d3 === undefined) ? 3 : o.d3;
        s2.downAll = (o.d3All === undefined) ? null : o.d3All;

        sv.shots.push(s1);
        sv.shots.push(s2);

        if (o.splay) {
            var sp = shotOf("A2", "", o.splay.distance, 90,
                            o.splay.inclination);
            sp.splay = true;
            sv.shots.push(sp);
        }

        var res = CsNetwork.resolve(sv,
            { anchor: { name: "A1", x: 0, y: 0, z: 1000 } });
        return { survey: sv, resolved: res };
    }

    function midOf(res, from, to) {
        var a = res.stations[from], b = res.stations[to];
        return { x: (a.x + b.x) / 2.0, y: (a.y + b.y) / 2.0 };
    }

    // --- mid-leg: floor is the interpolated line minus interpolated D --
    var fx = fixture({});
    var a2 = fx.resolved.stations["A2"], a3 = fx.resolved.stations["A3"];
    var lineMid = (a2.z + a3.z) / 2.0;

    var sm = CsElevation.sampleFloor(fx.survey, fx.resolved,
                                     midOf(fx.resolved, "A2", "A3"),
                                     { tolerance: 5 });
    ok(sm !== null, "sampleFloor: a point on a leg samples");
    eqs(sm.basis, "floor", "sampleFloor: LRUD present -> basis floor");
    eqs(sm.from, "A2", "sampleFloor: names the from station");
    eqs(sm.to, "A3", "sampleFloor: names the to station");
    near(sm.fraction, 0.5, 1e-6, "sampleFloor: records position along the leg");
    near(sm.z, lineMid - 4.0, 1e-6,
        "sampleFloor: mid-leg floor is mid line z minus mid D (5 and 3 -> 4)");
    ok(sm.z < lineMid,
        "sampleFloor: the FLOOR is below the survey line -- the whole point");
    eqs(sm.multi, false, "sampleFloor: single-value D is not multi");

    // --- at a station, that station's own floor -----------------------
    var at = CsElevation.sampleFloor(fx.survey, fx.resolved,
                                     { x: a3.x, y: a3.y }, { tolerance: 5 });
    near(at.z, a3.z - 3.0, 1e-6, "sampleFloor: at A3, floor is its z minus 3");

    // --- out of tolerance -> null, not a guess ------------------------
    eqs(CsElevation.sampleFloor(fx.survey, fx.resolved,
                                { x: a2.x, y: a2.y + 900 }, { tolerance: 5 }),
        null, "sampleFloor: nothing within tolerance returns null");

    // --- the fallback -------------------------------------------------
    var bare = fixture({ d2: null, d3: null });
    var fb = CsElevation.sampleFloor(bare.survey, bare.resolved,
                                     midOf(bare.resolved, "A2", "A3"),
                                     { tolerance: 5 });
    ok(fb !== null, "sampleFloor: no D at all still answers");
    eqs(fb.basis, "line", "sampleFloor: no floor evidence -> basis line");
    var bLine = (bare.resolved.stations["A2"].z +
                 bare.resolved.stations["A3"].z) / 2.0;
    near(fb.z, bLine, 1e-6,
        "sampleFloor: the fallback is the SURVEY LINE z");
    ok(fb.z !== 0,
        "sampleFloor: the fallback is never a fabricated zero -- " +
        "a 0 here would rebase an absolute-datum cave");

    // --- a down splay is evidence and moves the answer ----------------
    // 20 ft at -40 deg from A2: dz = -12.9, well below A2's D of 5, so a
    // floor sampled near A2 must drop toward it.
    var wsp = fixture({ splay: { distance: 20, inclination: -40 } });
    var sp = CsElevation.sampleFloor(wsp.survey, wsp.resolved,
                                     midOf(wsp.resolved, "A2", "A3"),
                                     { tolerance: 5 });
    ok(sp !== null && sp.basis === "floor",
        "sampleFloor: a down splay is floor evidence");
    ok(sp.z < sm.z,
        "sampleFloor: a down splay between the stations LOWERS the floor " +
        "(got " + sp.z + ", LRUD-only was " + sm.z + ")");

    // --- a splay with no inclination is not evidence at all -----------
    // CsTraverse.offset refuses it, which is a strict superset of the
    // "no inclination" case -- so it must never reach classifySplay and
    // never plant a phantom point at centreline.
    var nsp = fixture({ splay: { distance: 20, inclination: null } });
    var ni = CsElevation.sampleFloor(nsp.survey, nsp.resolved,
                                     midOf(nsp.resolved, "A2", "A3"),
                                     { tolerance: 5 });
    near(ni.z, sm.z, 1e-6,
        "sampleFloor: a no-inclination splay is IGNORED, not read as flat");

    // --- multi: label the walkable floor, flag the pit ----------------
    var pit = fixture({ d3: 20, d3All: [3, 20] });
    var pf = CsElevation.sampleFloor(pit.survey, pit.resolved,
                                     { x: a3.x, y: a3.y }, { tolerance: 5 });
    near(pf.z, pit.resolved.stations["A3"].z - 3.0, 1e-6,
        "sampleFloor: 3/20 labels the WALKABLE 3, not the pit bottom 20");
    eqs(pf.multi, true, "sampleFloor: flags that a pit drops below this floor");
})();
```


- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/js_unit.js`
Expected: FAIL — `CsElevation is not defined`

- [ ] **Step 3: Write the implementation**

Create `scripts/CaveSurvey/Core/CsElevation.js`:

```javascript
/**
 * CsElevation -- elevation at an arbitrary point along the survey
 * alignment.
 *
 * PURE. Plain {x, y} in, plain values out, no document. Loadable and
 * callable under node, which is what lets tests/js_unit.js cover it.
 *
 * Built as a primitive, not just as CsCalloutElev's helper: the
 * forthcoming entrance-elevation + lidar work needs exactly this
 * "elevation at a point on the alignment" question answered, and must
 * call in here rather than growing a second, drifting copy.
 */
function CsElevation() {}

/**
 * The WALKABLE floor offset below the survey line at a station, from a
 * parsed LRUD Down entry.
 *
 * THE SHALLOWEST reading, where CsProfile uses parseLrudEntry's own
 * `value` (the DEEPEST). This divergence is deliberate and must not be
 * "unified" -- the two answer different questions:
 *
 *   - CsProfile draws the passage ENVELOPE. A pit belongs inside it, so
 *     the deepest reading is right there.
 *   - A callout labels WHERE A CAVER STANDS. A station reading 2/6 has
 *     walkable floor at 2 with a pit dropping to 6; labelling that spot
 *     1234' when 1234' is the bottom of a pit is wrong on a map
 *     somebody navigates by.
 *
 * Same shape of intentional asymmetry as CsProfile.classifySplay's
 * plan-vs-elevation dead zone (see its docblock) -- and the same
 * instruction: do not make them agree.
 *
 * null in, null out: an absent reading is UNKNOWN, not zero. `P` parses
 * to a real 0 and stays 0, meaning the floor is at the survey line.
 *
 * \param entry a CsModel.parseLrudEntry result for the Down field
 * \return number or null
 */
CsElevation.floorWalkable = function(entry) {
    if (entry === null || entry === undefined) {
        return null;
    }
    if (entry.all !== null && entry.all !== undefined &&
            entry.all.length > 0) {
        var min = entry.all[0];
        for (var i = 1; i < entry.all.length; i++) {
            if (entry.all[i] < min) {
                min = entry.all[i];
            }
        }
        return min;
    }
    if (entry.value === null || entry.value === undefined) {
        return null;
    }
    return entry.value;
};

CsElevation.DEFAULT_TOLERANCE = 10.0;

/**
 * Floor elevation at `point`.
 *
 * \param survey   the CsModel survey (LRUD and splay lookup)
 * \param resolved CsNetwork.resolve() result -- {stations, legs, ...}
 * \param point    {x, y} in drawing coordinates
 * \param opts     {tolerance: number, tapeMode: CsTraverse.SLOPE|
 *                  HORIZONTAL, flatSplayDeg: number}
 * \return {z, basis: "floor"|"line", from, to, fraction, multi} or null
 *
 * null means NO ANSWER -- no leg within tolerance. The caller must
 * abort and say so; it must never substitute a number.
 *
 * basis "line" means the survey-line elevation is standing in because
 * no floor evidence exists at all. That is a DIFFERENT ANSWER, not a
 * degraded one, and CsCalloutElev renders it differently on purpose.
 */
CsElevation.sampleFloor = function(survey, resolved, point, opts) {
    var o = opts || {};
    var tol = (o.tolerance === null || o.tolerance === undefined) ?
        CsElevation.DEFAULT_TOLERANCE : o.tolerance;
    var tapeMode = o.tapeMode;

    var hit = CsElevation.nearestLeg(resolved, point, tol);
    if (hit === null) {
        return null;
    }

    var a = resolved.stations[hit.from];
    var b = resolved.stations[hit.to];
    var lineZ = a.z + (b.z - a.z) * hit.fraction;

    var evidence = CsElevation.floorEvidence(survey, resolved, hit, o);
    if (evidence.points.length === 0) {
        return {
            z: lineZ, basis: CsCallout.BASIS_LINE,
            from: hit.from, to: hit.to, fraction: hit.fraction,
            multi: false
        };
    }

    return {
        z: CsElevation.interpolate(evidence.points, hit.fraction, lineZ),
        basis: CsCallout.BASIS_FLOOR,
        from: hit.from, to: hit.to, fraction: hit.fraction,
        multi: evidence.multi
    };
};
```

Then the three helpers, in the same file:

```javascript
/**
 * The resolved leg nearest `point`, or null when none is within `tol`.
 *
 * \return {from, to, fraction, distance} -- fraction 0 at `from`,
 *         1 at `to`, clamped, so a point beyond a leg's end reports
 *         that end rather than extrapolating off it.
 */
CsElevation.nearestLeg = function(resolved, point, tol) {
    var best = null;
    var legs = resolved.legs || [];

    for (var i = 0; i < legs.length; i++) {
        var leg = legs[i];
        var a = resolved.stations[leg.from];
        var b = resolved.stations[leg.to];
        if (a === undefined || b === undefined) {
            continue;   // a leg whose ends did not resolve is not a leg
        }

        var dx = b.x - a.x;
        var dy = b.y - a.y;
        var len2 = dx * dx + dy * dy;

        var t;
        if (len2 === 0) {
            t = 0.0;    // a zero-length leg: the station itself
        } else {
            t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2;
            if (t < 0.0) { t = 0.0; }
            if (t > 1.0) { t = 1.0; }
        }

        var px = a.x + dx * t;
        var py = a.y + dy * t;
        var d = Math.sqrt((point.x - px) * (point.x - px) +
                          (point.y - py) * (point.y - py));

        if (d <= tol && (best === null || d < best.distance)) {
            best = { from: leg.from, to: leg.to, fraction: t, distance: d };
        }
    }
    return best;
};

/**
 * Floor evidence along one leg, in along-passage order.
 *
 * \return {points: [{t, z}] sorted by t, multi: bool}
 *
 * Same shape as the profile's floor run (CsProfile.bandWallRuns): the
 * endpoints' LRUD floor points plus every down-classified splay, each
 * placed by how far along the leg it sits. Interpolating between
 * ADJACENT evidence rather than just between the two stations is what
 * lets a splay into a floor pocket actually change the answer.
 */
CsElevation.floorEvidence = function(survey, resolved, hit, opts) {
    var o = opts || {};
    var tapeMode = o.tapeMode;
    var points = [];
    var multi = false;

    var ends = [{ name: hit.from, t: 0.0 }, { name: hit.to, t: 1.0 }];
    var a = resolved.stations[hit.from];
    var b = resolved.stations[hit.to];
    var legDx = b.x - a.x;
    var legDy = b.y - a.y;
    var legLen2 = legDx * legDx + legDy * legDy;

    // --- the endpoints' own LRUD -------------------------------------
    for (var e = 0; e < ends.length; e++) {
        var st = resolved.stations[ends[e].name];
        if (st === undefined) {
            continue;
        }
        var lrud = CsModel.lrudForStation(survey, ends[e].name);
        if (lrud === null) {
            continue;
        }
        // lrudForStation hands back already-parsed fields, so rebuild
        // the parseLrudEntry shape floorWalkable expects.
        var d = CsElevation.floorWalkable({ value: lrud.down,
                                            all: lrud.downAll });
        if (d === null) {
            continue;
        }
        points.push({ t: ends[e].t, z: st.z - d });
        if (lrud.downAll !== null && lrud.downAll !== undefined &&
                lrud.downAll.length > 1) {
            multi = true;
        }
    }

    // --- down splays from either endpoint ----------------------------
    var byStation = CsLrud.splaysByStation(survey);
    for (var k = 0; k < ends.length; k++) {
        var host = resolved.stations[ends[k].name];
        if (host === undefined) {
            continue;
        }
        var sps = byStation[ends[k].name] || [];
        for (var j = 0; j < sps.length; j++) {
            var sp = sps[j];

            // CsTraverse.offset refuses a shot with no distance, no
            // effective azimuth OR no inclination -- a strict superset
            // of "no inclination on record". This is the ONLY correct
            // place to drop an unusable splay: falling through to
            // classifySplay would read it as "flat" and plant a phantom
            // floor point at exactly centreline, which is the
            // fabrication the whole guard exists to stop.
            var off = CsTraverse.offset(sp, tapeMode);
            if (off === null) {
                continue;
            }
            if (CsProfile.classifySplay(sp, o.flatSplayDeg) !== "floor") {
                continue;
            }

            var t;
            if (legLen2 === 0) {
                t = ends[k].t;
            } else {
                t = ends[k].t +
                    ((off.dx * legDx + off.dy * legDy) / legLen2);
                if (t < 0.0) { t = 0.0; }
                if (t > 1.0) { t = 1.0; }
            }
            points.push({ t: t, z: host.z + off.dz });
        }
    }

    points.sort(function(p, q) { return p.t - q.t; });
    return { points: points, multi: multi };
};

/**
 * Linear interpolation over sorted floor evidence.
 *
 * Outside the evidence range the nearest entry's z is returned rather
 * than an extrapolation: past the last measurement the honest answer is
 * "as far as anyone measured, this", not a projected slope nobody saw.
 */
CsElevation.interpolate = function(points, t, fallbackZ) {
    if (points.length === 0) {
        return fallbackZ;
    }
    if (t <= points[0].t) {
        return points[0].z;
    }
    var last = points[points.length - 1];
    if (t >= last.t) {
        return last.z;
    }
    for (var i = 1; i < points.length; i++) {
        var lo = points[i - 1];
        var hi = points[i];
        if (t <= hi.t) {
            var span = hi.t - lo.t;
            if (span === 0) {
                return hi.z;
            }
            return lo.z + (hi.z - lo.z) * ((t - lo.t) / span);
        }
    }
    return last.z;
};
```

- [ ] **Step 4: Register with the harness AND with CsAll.js**

Two registrations, both required. Add to `CORE_FILES` in `tests/js_unit.js`,
AFTER `CsProfile.js` (it calls `CsProfile.classifySplay`) and after
`CsCallout.js` (it uses `CsCallout.BASIS_*`):

```javascript
    "scripts/CaveSurvey/Core/CsElevation.js",
```

Then add the matching include to `scripts/CaveSurvey/Core/CsAll.js`, in the same
relative position:

```javascript
include(includeBasePath + "/CsElevation.js");
```

Skipping the second one turns `run_all.sh` section 1 red via
`test_every_core_file_is_included_by_csall`. This bit Task 1.

**Files** for this task therefore also includes:
`Modify: scripts/CaveSurvey/Core/CsAll.js`

- [ ] **Step 5: Run tests both ways**

Run: `node tests/js_unit.js` → PASS
Run: `./tests/run_all.sh` → all OK

- [ ] **Step 6: Commit**

```bash
git add scripts/CaveSurvey/Core/CsElevation.js tests/js_unit.js
git commit -m "feat(CsElevation): floor elevation from LRUD and splays, never a fabricated zero"
```

---

### Task 8: The CsCalloutElev command

**Goal:** Pick a point, get a floor-elevation callout — visibly marked when it
had to fall back to the survey line.

**Files:**
- Create: `scripts/CaveSurvey/CalloutElev/CalloutElev.js`
- Create: `scripts/CaveSurvey/CalloutElev/CalloutElev.svg`
- Modify: `scripts/CaveSurvey/Core/CsCallout.js` (label formatting)
- Modify: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `CsCallout.elevLabel(sample, suffix)` renders `1234.5'` for a floor basis,
      `~1234.5' LINE` for a line basis, and appends ` (pit)` when `multi`.
- [ ] `cselev` places a callout whose text is that label, on the style's layer —
      `elevation` for a floor basis, `elevation-line` for a line basis.
- [ ] The label is editable before commit.
- [ ] A `null` sample aborts with a `QMessageBox` naming why, and adds nothing.
- [ ] `ElevBasis` / `ElevFrom` / `ElevTo` / `ElevFraction` / `ElevValue` /
      `ElevMulti` are written as XDATA.
- [ ] `CalloutSync.refreshElev` upgrades a `line`-basis label to `floor` once D
      exists, INCLUDING moving it to the `elevation` layer.
- [ ] A hand-edited label is never overwritten by a sync.

**Verify:** `node tests/js_unit.js` → PASS for the label tests, plus a hand run
in CaveCAD against the Pitfall Cave fixture.

**Steps:**

- [ ] **Step 1: Write the failing label tests**

Append to `tests/js_unit.js`:

```javascript
// ---------------------------------------------------------------------
// CsCallout.elevLabel
// ---------------------------------------------------------------------

(function() {
    eqs(CsCallout.elevLabel({ z: 1234.51, basis: "floor", multi: false }, "'"),
        "1234.5'", "elevLabel: a floor elevation is just the number");
    eqs(CsCallout.elevLabel({ z: 1234.51, basis: "floor", multi: true }, "'"),
        "1234.5' (pit)",
        "elevLabel: multi tells the reader a pit drops below this floor");
    eqs(CsCallout.elevLabel({ z: 1234.51, basis: "line", multi: false }, "'"),
        "~1234.5' LINE",
        "elevLabel: a line-basis label says so, so a plot cannot mislead");
    eqs(CsCallout.elevLabel({ z: -12.4, basis: "floor", multi: false }, " m"),
        "-12.4 m", "elevLabel: negative elevations and a metric suffix");
    eqs(CsCallout.elevLabel(null, "'"), null,
        "elevLabel: no sample, no label -- never a fabricated string");
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/js_unit.js`
Expected: FAIL — `CsCallout.elevLabel is not a function`

- [ ] **Step 3: Implement the formatter**

Append to `scripts/CaveSurvey/Core/CsCallout.js`:

```javascript
/**
 * The text of an elevation callout.
 *
 * A "line" basis label must be UNMISTAKABLE. It carries a survey-line
 * elevation standing in for a floor nobody measured, and on a plotted
 * map an unmarked one reads as surveyed fact. Hence both a tilde and
 * the word LINE, plus its own layer and colour (CsCallout.STYLES).
 *
 * `multi` means the governing D had more than one reading: this is the
 * walkable floor and there is a pit below it. The reader gets told.
 */
CsCallout.elevLabel = function(sample, suffix) {
    if (sample === null || sample === undefined ||
            sample.z === null || sample.z === undefined) {
        return null;
    }
    var sfx = (suffix === null || suffix === undefined) ? "" : suffix;
    var n = (Math.round(sample.z * 10) / 10).toFixed(1);
    if (sample.basis === CsCallout.BASIS_LINE) {
        return "~" + n + sfx + " LINE";
    }
    return n + sfx + (sample.multi ? " (pit)" : "");
};

/** The style an elevation sample should be drawn in. */
CsCallout.elevStyle = function(sample) {
    return (sample && sample.basis === CsCallout.BASIS_LINE) ?
        "elevation-line" : "elevation";
};
```

- [ ] **Step 4: Write the command**

Create `scripts/CaveSurvey/CalloutElev/CalloutElev.js`, following `Callout.js`'s
shape. The differences that matter:

```javascript
CalloutElev.prototype.coordinateEvent = function(event) {
    var pos = event.getModelPosition();
    var doc = this.getDocument();
    var di = this.getDocumentInterface();

    var survey = CsTags.surveyFromDocument(doc);
    var resolved = CsNetwork.resolve(survey, {});
    var sample = CsElevation.sampleFloor(survey, resolved,
                                         { x: pos.x, y: pos.y }, {});

    if (sample === null) {
        // No leg within tolerance. Say so and place NOTHING -- a
        // guessed elevation on a cave map is worse than no label.
        // QMessageBox, not handleUserMessage: that cannot show
        // multi-line text.
        QMessageBox.information(RMainWindowQt.getMainWindow(),
            qsTr("Callout Elevation"),
            qsTr("No survey leg within range of that point.\n\n" +
                 "Elevation callouts interpolate along the survey " +
                 "alignment, so the arrow tip has to be near a shot."));
        this.terminate();
        return;
    }

    var style = CsCallout.elevStyle(sample);
    var label = CsCallout.elevLabel(sample, CalloutWrite.suffixFor(doc));

    // editable before commit -- a caver who knows the real floor wins
    var edited = CalloutElev.askForLabel(label, sample);
    if (edited === null) {
        this.terminate();
        return;
    }

    var extra = {};
    extra[CsCallout.KEY.ELEV_BASIS] = sample.basis;
    extra[CsCallout.KEY.ELEV_FROM] = sample.from;
    extra[CsCallout.KEY.ELEV_TO] = sample.to;
    extra[CsCallout.KEY.ELEV_FRACTION] = String(sample.fraction);
    extra[CsCallout.KEY.ELEV_VALUE] = String(sample.z);
    extra[CsCallout.KEY.ELEV_MULTI] = sample.multi ? "1" : "";

    CalloutWrite.create(doc, di, {
        text: edited,
        position: this.position,
        tips: [{ x: pos.x, y: pos.y }],
        style: style,
        kind: CsCallout.KIND_ELEV,
        height: CalloutWrite.textHeight(doc),
        tags: extra
    });
    this.terminate();
};
```

The pick order is tip first (it is what gets sampled), then text position — so
`CalloutElev`'s state machine is the mirror of `Callout`'s: sample on the first
pick, place on the second. Store the sample on `this` between the two picks.
Write the unit suffix helper as `CalloutWrite.suffixFor(doc)`, off the drawing's
own unit via `CsUnits` — on `CalloutWrite` rather than on either command, because
BOTH `CsCalloutElev` and `CsCalloutSync` need it, and a command reaching into a
sibling command's file is how a silent include failure gets introduced. Write
`CalloutElev.askForLabel(label, sample)` as a `QDialog` following
`Callout.askForNote`, prefilled with `label` and showing the basis, so a caver can
see they are about to place a line-basis fallback before they commit it.

Wiring: commands `["cscalloutelev", "cselev"]`, `setSortOrder(90)`,
`setGroupSortOrder(450)`, widget names
`["CaveSurveyMenu", "CaveSurveyToolBar"]`.

- [ ] **Step 5: Draw the icon**

`CalloutElev.svg` — the Callout icon with a small level/datum triangle glyph.

- [ ] **Step 6: Verify by hand against the fixture**

Open the Pitfall Cave test survey in `testdata`. Run `cselev` and confirm:
- A point mid-passage gives a floor elevation BELOW the survey-line elevation at
  that point (check against `sst` / Survey Stats, which reports station
  elevations).
- A station whose D is `--` in the fixture yields a `~... LINE` label on
  `NOTES-ELEVATION-LINE`, in a visibly different colour.
- A point far off any passage refuses with the message and adds nothing.
- A station with a multi-value D shows ` (pit)`.

- [ ] **Step 7: Teach CalloutSync to refresh elevation labels**

This closes spec §8.3's second half. A `line`-basis label must UPGRADE itself to
a real floor label once someone enters `D` on a later trip — otherwise the map
keeps saying "we never measured this" after somebody did, and the tool quietly
becomes a liar.

Add to `scripts/CaveSurvey/CalloutSync/CalloutSync.js`:

```javascript
/**
 * Re-derive one elevation callout's text from its stored source.
 *
 * Returns "unchanged", "upgraded", "downgraded", "restyled", "updated"
 * or "lost", for the caller's report. A caver who EDITED the label by
 * hand keeps their edit: a stored ElevValue that no longer matches the
 * text means a human overrode it, and overwriting that would throw away
 * the one reading somebody actually stood on the floor to take.
 */
CalloutSync.refreshElev = function(doc, di, id, survey, resolved, suffix) {
    var m = CalloutWrite.members(doc, id);
    if (m.text === null ||
            CsTags.get(m.text, CsCallout.KEY.KIND) !== CsCallout.KIND_ELEV) {
        return "unchanged";
    }

    var storedBasis = CsTags.get(m.text, CsCallout.KEY.ELEV_BASIS);
    var storedValue = CsTags.get(m.text, CsCallout.KEY.ELEV_VALUE);
    var storedMulti = CsTags.get(m.text, CsCallout.KEY.ELEV_MULTI) === "1";

    // Hand-edited? Then it is not ours to rewrite.
    var expected = CsCallout.elevLabel({
        z: parseFloat(storedValue), basis: storedBasis, multi: storedMulti
    }, suffix);
    var current = m.text.getData().getText();
    if (expected !== null && current !== expected) {
        return "unchanged";
    }

    var from = CsTags.get(m.text, CsCallout.KEY.ELEV_FROM);
    var to = CsTags.get(m.text, CsCallout.KEY.ELEV_TO);
    var fraction = parseFloat(
        CsTags.get(m.text, CsCallout.KEY.ELEV_FRACTION));
    if (from === "" || to === "" || isNaN(fraction)) {
        return "lost";
    }

    var a = resolved.stations[from];
    var b = resolved.stations[to];
    if (a === undefined || b === undefined) {
        // the leg this label was sampled on is gone from the survey
        return "lost";
    }
    var point = { x: a.x + (b.x - a.x) * fraction,
                  y: a.y + (b.y - a.y) * fraction };

    var sample = CsElevation.sampleFloor(survey, resolved, point, {});
    if (sample === null) {
        return "lost";
    }

    var label = CsCallout.elevLabel(sample, suffix);
    var style = CsCallout.elevStyle(sample);
    var oldStyle = CsTags.get(m.text, CsCallout.KEY.STYLE);

    var outcome = "unchanged";
    if (storedBasis === CsCallout.BASIS_LINE &&
            sample.basis === CsCallout.BASIS_FLOOR) {
        outcome = "upgraded";
    } else if (storedBasis === CsCallout.BASIS_FLOOR &&
            sample.basis === CsCallout.BASIS_LINE) {
        // D was removed or the leg changed. Say so rather than keep
        // showing a floor number nothing supports any more.
        outcome = "downgraded";
    } else if (label !== current) {
        outcome = "updated";
    } else if (style !== oldStyle) {
        outcome = "restyled";
    } else {
        return "unchanged";
    }

    // The label text, then the layer, then the tags. The layer move
    // matters as much as the text: an upgraded label still sitting on
    // NOTES-ELEVATION-LINE reads as a fallback on the plot.
    var layerName = CsCallout.STYLES[style];
    CsLayers.ensure(doc, di, layerName);
    CsLayers.withLayerOn(doc, di, layerName, function() {
        var td = m.text.getData();
        td.setText(label);
        m.text.setData(td);
        var op = new RModifyObjectsOperation();
        op.addObject(m.text, false);
        di.applyOperation(op);
    });

    var t = {};
    t[CsCallout.KEY.ELEV_BASIS] = sample.basis;
    t[CsCallout.KEY.ELEV_VALUE] = String(sample.z);
    t[CsCallout.KEY.ELEV_MULTI] = sample.multi ? "1" : "";
    t[CsCallout.KEY.STYLE] = style;
    CsTags.commit(di, m.text, t);

    return outcome;
};
```

Then call it from `CalloutSync.run`, resolving the survey ONCE for the whole run
rather than per callout — `CsNetwork.resolve` over a real cave is not something to
do in a loop:

```javascript
    // once, before the loop -- and only if there is an elev callout to
    // refresh, since resolving a network the drawing does not need is
    // pure cost
    var survey = null, resolved = null, suffix = null;
    var counts = { upgraded: 0, downgraded: 0, updated: 0,
                   restyled: 0, lost: 0 };
```

and inside the loop, after the geometry reflow:

```javascript
        if (CsTags.get(m.text, CsCallout.KEY.KIND) === CsCallout.KIND_ELEV) {
            if (survey === null) {
                survey = CsTags.surveyFromDocument(doc);
                resolved = CsNetwork.resolve(survey, {});
                suffix = CalloutWrite.suffixFor(doc);
            }
            var what = CalloutSync.refreshElev(doc, di, id, survey,
                                               resolved, suffix);
            if (counts.hasOwnProperty(what)) {
                counts[what]++;
            }
        }
```

Report every non-zero count in the message, and list the `lost` ones by id — a
label whose leg vanished from the survey is exactly the thing a caver needs to go
look at by hand.

- [ ] **Step 8: Test the upgrade path**

Append to `tests/callout_write.js`. This is the assertion spec §11 asks for, and
it is the one that proves the fallback is a temporary state rather than a
permanent lie:

```javascript
// --- a line-basis label upgrades once D arrives -----------------------
(function() {
    // A drawing whose station has no D: the label must come out as a
    // line-basis fallback...
    // (build the survey entities per tests/generate_profile_run.js's
    // fixture construction, place an elev callout with cselev's own code
    // path via CalloutWrite.create + the ElevBasis tags, then add D to
    // the station's XDATA and run CalloutSync.refreshElev)
    var before = CsTags.get(txt, CsCallout.KEY.ELEV_BASIS);
    eqs(before, "line", "starts as a line-basis fallback");
    eqs(doc.getLayerName(txt.getLayerId()), CsLayers.NOTES_ELEVATION_LINE,
        "and on the fallback layer");

    // ... and after D is entered, it upgrades itself
    var outcome = CalloutSync.refreshElev(doc, di, id, survey, resolved, "'");
    eqs(outcome, "upgraded", "refreshElev reports the upgrade");
    var after = CalloutWrite.members(doc, id).text;
    eqs(CsTags.get(after, CsCallout.KEY.ELEV_BASIS), "floor",
        "the basis is now floor");
    eqs(doc.getLayerName(after.getLayerId()), CsLayers.NOTES_ELEVATION,
        "and it MOVED to the real elevation layer -- an upgraded label " +
        "left on the fallback layer still reads as a fallback on a plot");
    ok(after.getData().getText().indexOf("LINE") < 0,
        "the LINE marker is gone from the text");
})();

// --- a hand-edited label is never overwritten -------------------------
(function() {
    // set the text to something a caver typed, then refresh
    var td = txt2.getData();
    td.setText("1234.5' (I measured this)");
    txt2.setData(td);
    var mop = new RModifyObjectsOperation();
    mop.addObject(txt2, false);
    di.applyOperation(mop);

    eqs(CalloutSync.refreshElev(doc, di, id2, survey, resolved, "'"),
        "unchanged", "a hand-edited label is left alone");
    eqs(CalloutWrite.members(doc, id2).text.getData().getText(),
        "1234.5' (I measured this)",
        "the caver's own words survive a sync");
})();
```

Build the station entities with the same construction
`tests/generate_profile_run.js` uses — read it first and reuse its helpers rather
than inventing a third fixture style in this repo.

- [ ] **Step 9: Run the suite and commit**

```bash
./tests/run_all.sh
git add scripts/CaveSurvey/CalloutElev/ scripts/CaveSurvey/CalloutSync/ scripts/CaveSurvey/Core/CsCallout.js tests/js_unit.js tests/callout_write.js
git commit -m "feat(CalloutElev): label the floor, and say so when it is only the line"
```

---

### Task 9: CalloutListener — the live glue

**Goal:** Edits made with QCAD's own tools keep the callout together, inside the
user's own undo step. This is the task that delivers the user's actual
requirement, and it lands last, on a reflow core already proven by Tasks 4-8.

> **USER-ORDERED GATE — NON-SKIPPABLE.** This task was requested by the user in
> the current conversation. It MUST NOT be closed by walking around it, by
> declaring it "verified inline", or by substituting a cheaper check. Close only
> after every item in `acceptanceCriteria` has been re-validated independently,
> with output captured.

The user's requirement was "flexible and text editable after commit... otherwise
it's of no use". Step 5's ten-row checklist IS that requirement, and no unit test
covers rows 2, 4 or 9. Those three decide whether this design is correct or
actively dangerous to a caver's drawing.

**Files:**
- Create: `scripts/CaveSurvey/Callout/CalloutListener.js`
- Modify: `scripts/CaveSurvey/CaveSurvey.js`

**Acceptance Criteria:**
- [ ] Installed once at startup; a second install does not stack a second
      listener.
- [ ] Editing a callout's text reflows its leaders, and ONE undo reverts both.
- [ ] Moving a callout's text reflows its leaders; the tips stay put.
- [ ] Deleting the text deletes the orphaned leaders.
- [ ] Deleting the LAST leader leaves the text in place as ordinary text, with
      its callout tags stripped.
- [ ] A transaction touching nothing with a `CalloutId` returns without querying
      the spatial index or collecting stations.
- [ ] The handler never retains the `document` argument.

**Verify:** Hand-verified in CaveCAD against the Pitfall Cave fixture, per the
checklist in Step 5. There is no unit test — this needs a live document
interface, and the suite's harness cannot provide one.

**Steps:**

- [ ] **Step 1: Write the listener**

Create `scripts/CaveSurvey/Callout/CalloutListener.js`:

```javascript
/**
 * CalloutListener -- keeps a callout's arrows on its text while the
 * caver edits with QCAD's OWN tools.
 *
 * This is the whole reason the linked-pair design works. Because reflow
 * never writes to the text, the native double-click editor, grips and
 * property editor all keep functioning; this listener is what notices
 * they were used.
 *
 * Not a menu tool. Registers no RGuiAction. Installed once from
 * CaveSurvey.js.
 */
function CalloutListener() {}

CalloutListener.installed = false;

/** Re-entrancy guard. Reflow writes a transaction, which fires this
 *  listener again; without the flag that recurses until the stack
 *  blows. */
CalloutListener.busy = false;

CalloutListener.install = function() {
    if (CalloutListener.installed) {
        return;
    }
    var appWin = RMainWindowQt.getMainWindow();
    if (isNull(appWin) || isNull(appWin.addTransactionListener)) {
        return;   // headless: nothing to listen to
    }
    var adapter = new RTransactionListenerAdapter();
    appWin.addTransactionListener(adapter);
    adapter.transactionUpdated.connect(CalloutListener.onTransaction);
    CalloutListener.installed = true;
};

/**
 * NEVER retain `document`. A freed RDocument cannot be detected --
 * isNull() and isDeleted() both keep reporting false because RDocument
 * is not a QObject -- and the next real call on one exits 139 rather
 * than throwing, so a try/catch buys nothing. Caching this argument on
 * the module, or capturing it in a closure that outlives the callback,
 * is a segfault waiting for the caver to close a drawing.
 */
CalloutListener.onTransaction = function(document, transaction) {
    if (CalloutListener.busy) {
        return;
    }
    if (isNull(document) || isNull(transaction)) {
        return;
    }

    var objIds = transaction.getAffectedObjects();
    if (objIds.length === 0) {
        return;
    }

    // Cheap gate. This runs on EVERY transaction in the drawing, so it
    // reads XDATA off already-loaded objects and gets out. It must not
    // query the spatial index, collect stations, or resolve a network.
    var touched = {};
    var orphanTexts = [];
    var any = false;
    for (var i = 0; i < objIds.length; i++) {
        var e = document.queryEntity(objIds[i]);
        if (isNull(e)) {
            continue;
        }
        var cid = CsTags.get(e, CsCallout.KEY.ID);
        if (cid === "") {
            continue;
        }
        any = true;
        touched[cid] = true;
    }
    if (!any) {
        return;
    }

    var di = document.getDocumentInterface ?
        document.getDocumentInterface() : EAction.getDocumentInterface();
    if (isNull(di)) {
        return;
    }

    var group = transaction.getGroup();

    CalloutListener.busy = true;
    try {
        for (var id in touched) {
            if (!touched.hasOwnProperty(id)) {
                continue;
            }
            CalloutListener.reconcile(document, di, id, group);
        }
    } finally {
        // finally, not a trailing assignment: an exception here must
        // not leave the listener permanently deaf.
        CalloutListener.busy = false;
    }
};

/**
 * Bring one callout back into a consistent state.
 *
 * The two deletion cases are asymmetric ON PURPOSE:
 *   - text gone  -> the leaders are orphans. Delete them. An arrow
 *                   pointing at nothing is not information.
 *   - last leader gone -> the TEXT SURVIVES, as ordinary text with its
 *                   callout tags stripped. A note without an arrow is
 *                   still a note, and deleting a caver's words because
 *                   they deleted an arrow would be destroying data they
 *                   did not ask to lose.
 */
CalloutListener.reconcile = function(doc, di, id, group) {
    var m = CalloutWrite.members(doc, id);

    if (m.text === null) {
        if (m.leaders.length > 0) {
            var del = new RDeleteObjectsOperation();
            for (var i = 0; i < m.leaders.length; i++) {
                del.deleteObject(m.leaders[i]);
            }
            if (group !== null && group !== undefined) {
                del.setTransactionGroup(group);
            }
            di.applyOperation(del);
        }
        return;
    }

    if (m.leaders.length === 0) {
        CalloutWrite.unlink(di, m.text);
        return;
    }

    CalloutWrite.applyReflow(doc, di, id, group);
};
```

- [ ] **Step 2: Install it at startup**

In `scripts/CaveSurvey/CaveSurvey.js`, inside `init(basePath)` after the menu and
toolbar getters have run:

```javascript
    // Callout live glue. No menu entry: this is not a tool, it is what
    // keeps callouts intact while the caver uses QCAD's own editors.
    include(basePath + "/Callout/CalloutListener.js");
    CalloutListener.install();
```

Match the include style the file already uses for its other includes — read them
first; `includeBasePath`-relative is required, and an `include("scripts/...")`
path resolves only against the app bundle and fails silently from a per-user
install.

- [ ] **Step 3: Confirm the reflow is undo-grouped**

Extend `tests/callout_write.js` with an assertion that a reflow carrying a group
id collapses with a preceding operation in the same group — the mechanism the
listener depends on. (Task 4 already asserts two grouped reflows collapse; this
adds the mixed case of a foreign operation plus a reflow.)

```javascript
(function() {
    var before = doc.queryAllEntities(false, true).length;
    var g = 9911;

    // a "user edit": move the text, in group g
    var mm = CalloutWrite.members(doc, id);
    var td = mm.text.getData();
    td.setPosition(new RVector(10, 10));
    mm.text.setData(td);
    var mop = new RModifyObjectsOperation();
    mop.addObject(mm.text, false);
    mop.setTransactionGroup(g);
    di.applyOperation(mop);

    // the listener's reflow, same group
    CalloutWrite.applyReflow(doc, di, id, g);

    di.undo();
    eqs(doc.queryAllEntities(false, true).length, before,
        "a user edit and its reflow collapse into ONE undo step");
})();
```

Run: `./tests/run_all.sh` → `### CALLOUT-WRITE OK`

- [ ] **Step 4: Verify the cheap-gate cost**

Add a temporary `print()` counter to `onTransaction` recording how often it runs
and how often it gets past the gate. Draw fifty ordinary lines in a drawing that
contains three callouts. The gate must be passed zero times. Remove the counter
before committing.

- [ ] **Step 5: Hand-verification checklist**

In CaveCAD, with the Pitfall Cave fixture open. Every item must pass:

| # | Action | Expected |
|---|---|---|
| 1 | Double-click a callout's text, add a second line, commit | Leaders reflow to the taller box; landing stays at the vertical middle |
| 2 | Ctrl+Z once, immediately after #1 | BOTH the text change and the reflow revert. Not two undos. |
| 3 | Drag the text with its grip to the far side of the drawing | Leaders follow; every arrow TIP stays where it was |
| 4 | Ctrl+Z once, after #3 | Text and leaders both return |
| 5 | Drag one leader's tip grip to a new target | That arrow re-points; the text does not move; the other arrows do not move |
| 6 | Delete the text | Its leaders vanish with it |
| 7 | Delete every leader of a callout, one at a time | The text REMAINS, as ordinary text. Re-running `cscsync` does not resurrect leaders or report it as broken. |
| 8 | Draw fifty unrelated lines | No perceptible lag; no callout changes |
| 9 | Open a second drawing, then close the first | No crash. (This is the freed-`RDocument` hazard — the listener must not have retained anything.) |
| 10 | Run `cscsync` after all of the above | Reports the right count and lists nothing as refused |

Record the result of each row in the commit message or a follow-up docs note. If
row 2, 4 or 9 fails, STOP — those are the three that make this design either
correct or dangerous, and none of them has a unit test behind it.

- [ ] **Step 6: Commit**

```bash
git add scripts/CaveSurvey/Callout/CalloutListener.js scripts/CaveSurvey/CaveSurvey.js tests/callout_write.js
git commit -m "feat(CalloutListener): keep callouts glued through native edits, in one undo step"
```

---

### Task 10: Package, document and version

**Goal:** The three commands ship in a packaged add-on, and the next reader knows
what was built and what was hand-verified.

**Files:**
- Modify: `tools/make_package.sh` or `tools/package-files` (whichever enumerates
  shipped folders — read both)
- Modify: `VERSION`
- Create: `docs/superpowers/plans/2026-08-24-callout-multileader-notes.md`

**Acceptance Criteria:**
- [ ] A packaged build contains all three tool folders, both new Core files, and
      `CalloutWrite.js` / `CalloutListener.js`.
- [ ] Installing the package into CaveCAD shows all three menu entries.
- [ ] `VERSION` bumped.
- [ ] The notes file records the Task 9 hand-verification results and any engine
      surprise found on the way.

**Verify:** Build the package, install it per `tools/publish.sh`, restart
CaveCAD, confirm the three menu entries and run `cscal` once.

**Steps:**

- [ ] **Step 1: Check how packaging enumerates files**

Read `tools/make_package.sh` and `tools/package-files/`. If the packager globs
`scripts/CaveSurvey/*/`, the three new folders come along free and only the Core
files may need listing. Confirm rather than assume — a tool missing from a
package fails silently in exactly the same way a mis-wired one does.

- [ ] **Step 2: Add whatever the packager needs**

Make the minimum change that gets all seven new files into the built package.

- [ ] **Step 3: Build and install**

```bash
./tools/make_package.sh
./tools/publish.sh
```

Restart CaveCAD. Confirm "Callout", "Callout Elevation" and "Callout Sync" all
appear in the Cave Survey menu, in sort order 88/90/92.

- [ ] **Step 4: Bump VERSION**

Follow the convention of the last two bumps (`git log --oneline -- VERSION`).

- [ ] **Step 5: Write the notes file**

Record: the Task 9 checklist results row by row; the actual `dimasz`/`dimscale`
variable handles used; anything the running engine did differently from the
source tree. This is the file the next person reads before touching callouts.

- [ ] **Step 6: Commit**

```bash
git add VERSION tools/ docs/superpowers/plans/2026-08-24-callout-multileader-notes.md
git commit -m "chore: <version> -- callouts, a multileader QCAD never had"
```

---

## Open item for the user, at Task 8

Not blocking — Task 8 ships a working default either way, and this is cosmetic.

**The pit marker's wording.** The spec settled that a multi-value D must tell the
reader a pit drops below the labelled floor, but not what it should SAY. Task 8
implements `1234.5' (pit)`. If you would rather see `1234.5' +pit`,
`1234.5' (pit below)`, or a symbol, say so and it is a one-line change to
`CsCallout.elevLabel` plus its test. Nothing else in the plan depends on it.

## Deliberately not in this plan

- Lidar and entrance-elevation. Separate spec. `CsElevation.sampleFloor` is the
  primitive that work will call.
- Survey-tag prefill for `CsCallout` (auto-filling a note from a tagged
  station's XDATA). Spec §13, later hook.
- DXF round-trip as a real multileader. Other CAD sees a text and some leaders;
  the link lives in XDATA and survives through CaveCAD only.
- Auto-placement or collision avoidance. The caver picks where the text goes.
- Refactoring `CsProfile` to share `floorWalkable`. It must NOT share it — the
  two floor definitions differ on purpose (spec §6.3).
