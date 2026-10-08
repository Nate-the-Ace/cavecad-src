# Profile In The Plan Drawing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the extended elevation out of a sibling file and into the plan drawing, segregated by a complete dedicated layer set, so one document holds one survey model and the Survey Notebook can edit it.

**Architecture:** One function — `CsLayers.frameOf(layerName)` → `"plan"` | `"profile"` | `"sheet"` — is the only place that knows which view a layer belongs to. Four shipped consumers (`CsBind`, `RebuildSurveyData`, `CsDraw.eraseStations`, the warp tools) ask it instead of pattern-matching their own way. Generated profile geometry keeps a leading `CTRL-` so `CsBind`'s existing prefix gate refuses it for free; traceable profile layers must not. The profile region's origin is recomputed below the plan's extents each draw, and the delta translates every profile-frame entity — generated and hand-drawn alike — in the same undo step.

**Tech Stack:** QCAD/CaveCAD ECMAScript add-on. ECMAScript 5 dialect only — `var`, `function`, string concatenation; no `let`/`const`, arrow functions, template literals, `Object.assign`, or trailing commas. Tests: `tests/js_unit.js` (runs under node AND `CaveCAD -no-gui`, reporting DIFFERENT totals), `tests/test_addon.py` (Python stdlib, structural), headless CaveCAD driver scripts, all via `tests/run_all.sh`.

**User decisions (already made):**
- "i think we can segragate the linework by making all dedicated profile layers for everything. that would let us focus on either plan or profile easily by only targeting linework on those layers."
- `RebuildSurveyData`: "have it ignore the PROFILE layers".
- Linework binding: "have it only touch the appropriate layers for the linework."
- The profile origin is RECOMPUTED below the plan's extents on each draw (chosen over a fixed stored anchor, with the sketch-translation cost accepted and designed for).
- The sibling file is replaced ENTIRELY; `CsProfileFile.js` is deleted, no export command kept.
- Vertical exaggeration stays and auto-stamps the region when it is not 1.0.
- Geometric write-back (drag a ceiling line to change the data) is a FOLLOW-ON spec, not in this plan.
- No migration needed: "there are no existing projects that use this software productively. not until i declare a full publish release."

**Spec:** `docs/superpowers/specs/2026-08-23-profile-in-plan-drawing-design.md`

---

## Baseline before any work

`./tests/run_all.sh --publish` → `ALL TESTS PASSED -- including publish checks`, 6 stages.
node **1598** assertions, CaveCAD **2721** assertions (the merge of the splay-recovery and leg-index branches raised these), structural **23** tests. Compare each engine against its OWN baseline; they differ because some blocks are guarded by `if (!IS_NODE)`.

---

## File Structure

| File | Responsibility after this plan |
| --- | --- |
| `scripts/CaveSurvey/Core/CsLayers.js` | The frame test `frameOf`, the profile-frame layer constants, and their `DEFAULTS`. The single source of which view a layer belongs to. |
| `scripts/CaveSurvey/Core/CsProfileDraw.js` | Draws to profile-frame layers only. Gains the region origin, the whole-region translation, and the exaggeration stamp. |
| `scripts/CaveSurvey/Core/CsBind.js` | `stationIndex` becomes frame-scoped; an entity binds only within its own frame. |
| `scripts/CaveSurvey/Core/CsDraw.js` | `profileNow` draws into the CURRENT document. All sibling-file handling removed. |
| `scripts/CaveSurvey/RebuildSurveyData/RebuildSurveyData.js` | Unchanged in behaviour; gains a test proving it ignores profile-frame stations and labels. |
| `scripts/CaveSurvey/AlignImage/AlignImage.js` | Restricted to plan-frame layers. |
| `scripts/CaveSurvey/GenerateProfile/GenerateProfile.js` | Draws into the current document; no sibling resolve/commit/reveal. |
| `scripts/CaveSurvey/Core/CsProfileFile.js` | **DELETED.** |
| `templates/NSS_Cave_Template_PLAN.dxf` | Gains the whole profile-frame layer set. |
| `templates/NSS_Cave_Template_PROFILE.dxf` | KEPT (a structural test pins it, and it stays a valid standalone sheet) but its view layers are renamed to the profile frame. |
| `tools/add_profile_frame_layers.js` | New one-shot, idempotent, reading `CsLayers.DEFAULTS` — never its own copy of the appearance table. |
| `tests/profile_file_roundtrip.js` | **DELETED** along with its `run_all.sh` stage. |

---

## Conventions every task must follow

Each of these was a real defect in the elevation work. They are not style preferences.

- **ES5 only.** `var`, `function`, string concatenation. No `let`/`const`, arrow functions, template literals, trailing commas.
- **`Cs` prefix on every Core file** matching its global. `include()` dedupes by BASENAME, so `ProfileDraw.js` would be silently skipped. A structural test enforces it.
- **A RISING ASSERTION COUNT IS NOT COVERAGE.** Reviews on this code found 11-of-18 and 20-of-34 mutations surviving a fully green suite. For every acceptance criterion: DELETE the behaviour, run the suite, confirm a NAMED test fails, and report which mutation each test kills.
- **Mutation-test `CsDraw`, `CsReport`, `CsProfileDraw`, `CsBind` and the tools under CaveCAD, not node.** node never loads them; a node-only round cannot touch them at all.
- **No bundled assertion with substring matching.** One assertion once passed on text from an entirely different feature. Exact strings, one claim each.
- **Off layers refuse adds, deletes AND MODIFIES**, silently. Anything touching a layer that may be off wraps the work in `CsLayers.withLayerOn`; anything MODIFYING user linework needs `CsRevise.withOffLayersOn`, which sweeps every layer holding entities.
- **This engine's `Array.prototype.sort` is UNSTABLE.** A comparator returning 0 for two distinct items diverges between engines invisibly.
- **Never let a missing measurement become a number.** Seven doors in that family have been found in this codebase. A fabricated coordinate is worse than a refusal.
- **Comments explain WHY and a false comment is worse than none.** Several shipped in the elevation work and had to be corrected.

---

## Task 1: The frame test and the profile-frame layer constants

**Goal:** One function answers which view any layer belongs to, and the profile frame gets its full set of layer names.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsLayers.js`
- Modify: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `CsLayers.frameOf(name)` returns exactly `"plan"`, `"profile"` or `"sheet"` for every name in the registry, and `"plan"` for an unknown name (the safe default: an unrecognised layer is treated as plan, so a stray layer can never be swept by a profile-scoped operation)
- [ ] `BORDER`, `TITLE-BLOCK`, `LEGEND`, `SCALE-BAR`, `0` and `Defpoints` answer `"sheet"`
- [ ] Every generated profile layer keeps a LEADING `CTRL-` — `CTRL-PROFILE-SHOTS`, `CTRL-PROFILE-STATIONS`, `CTRL-PROFILE-STATION-LABELS`, `CTRL-PROFILE-SPLAYS`, `CTRL-PROFILE-LRUD`, plus the existing `CTRL-PROFILE-FLOOR`/`-CEILING` — and `CsBind.isLineworkLayer` returns FALSE for each, with no change to `CsBind`
- [ ] Every traceable profile layer does NOT start with `CTRL-` — `PROFILE-CEILING`, `PROFILE-FLOOR`, `PROFILE-WALLS-INFERRED`, `PROFILE-TEXT-NOTES`, `PROFILE-TEXT-LABELS`, `PROFILE-BREAKDOWN`, `PROFILE-ENTRANCE` — and `CsBind.isLineworkLayer` returns TRUE for each
- [ ] Every new layer has a `CsLayers.DEFAULTS` entry
- [ ] No layer name answers two frames, asserted by iterating the whole registry
- [ ] The docblock warns about the naming trap this creates: `CsLayers.PROFILE_CEILING` is the GENERATED layer `CTRL-PROFILE-CEILING`, while `CsLayers.PROFILE_TRACED_CEILING` is the hand-traced `PROFILE-CEILING`. They are one word apart and mean opposite things — one is previsualization the generator owns and erases, the other is the user's work that must never be erased. Same for floor
- [ ] A test asserts the CTRL-prefix rule is load-bearing: for each generated profile layer, `isLineworkLayer` must be false — so a future rename that drops the prefix fails here rather than silently making generated geometry bindable

**Verify:** `node tests/js_unit.js` → `### UNIT OK` above 1598; `./tests/run_all.sh` → `ALL TESTS PASSED`

**Steps:**

- [ ] **Step 1: Write the failing tests.** Append to `tests/js_unit.js`:

```javascript
// ---------------------------------------------------------------------
// CsLayers.frameOf -- the single frame test
// ---------------------------------------------------------------------

(function() {
    eqs(CsLayers.frameOf(CsLayers.SHOTS), "plan", "CTRL-SHOTS is plan");
    eqs(CsLayers.frameOf(CsLayers.WALLS_SURVEYED), "plan", "WALLS-SURVEYED is plan");
    eqs(CsLayers.frameOf(CsLayers.PROFILE_FLOOR), "profile",
        "CTRL-PROFILE-FLOOR is profile");
    eqs(CsLayers.frameOf(CsLayers.PROFILE_SHOTS), "profile",
        "CTRL-PROFILE-SHOTS is profile");
    eqs(CsLayers.frameOf("PROFILE-CEILING"), "profile",
        "the traced ceiling layer is profile");
    eqs(CsLayers.frameOf(CsLayers.BORDER), "sheet", "BORDER is sheet");
    eqs(CsLayers.frameOf(CsLayers.TITLE_BLOCK), "sheet", "TITLE-BLOCK is sheet");
    eqs(CsLayers.frameOf(CsLayers.SCALE_BAR), "sheet", "SCALE-BAR is sheet");
    eqs(CsLayers.frameOf(CsLayers.LEGEND), "sheet", "LEGEND is sheet");
    eqs(CsLayers.frameOf("0"), "sheet", "layer 0 is sheet");
    eqs(CsLayers.frameOf("Defpoints"), "sheet", "Defpoints is sheet");

    // An unknown layer defaults to PLAN, deliberately: a profile-scoped
    // sweep must never pick up a layer nobody classified.
    eqs(CsLayers.frameOf("SOMEONES-OWN-LAYER"), "plan",
        "an unknown layer defaults to plan, never profile");
    eqs(CsLayers.frameOf(""), "plan", "an empty name defaults to plan");
    eqs(CsLayers.frameOf(null), "plan", "null defaults to plan");
}());

(function() {
    // THE LOAD-BEARING RULE. Generated profile geometry must stay
    // ineligible for binding, and it stays ineligible only because the
    // name begins CTRL-. If a rename ever drops that prefix, the
    // generator's own output becomes bindable and movable, and this
    // assertion is what says so.
    var generated = [CsLayers.PROFILE_FLOOR, CsLayers.PROFILE_CEILING,
        CsLayers.PROFILE_SHOTS, CsLayers.PROFILE_STATIONS,
        CsLayers.PROFILE_STATION_LABELS, CsLayers.PROFILE_SPLAYS,
        CsLayers.PROFILE_LRUD];
    var i;
    for (i = 0; i < generated.length; i++) {
        ok(generated[i].indexOf("CTRL-") === 0,
            generated[i] + " begins CTRL- (the binding gate depends on it)");
        ok(CsBind.isLineworkLayer(generated[i]) === false,
            generated[i] + " is NOT bindable linework");
        eqs(CsLayers.frameOf(generated[i]), "profile",
            generated[i] + " is in the profile frame");
    }

    var traceable = ["PROFILE-CEILING", "PROFILE-FLOOR",
        "PROFILE-WALLS-INFERRED", "PROFILE-TEXT-NOTES",
        "PROFILE-TEXT-LABELS", "PROFILE-BREAKDOWN", "PROFILE-ENTRANCE"];
    for (i = 0; i < traceable.length; i++) {
        ok(traceable[i].indexOf("CTRL-") !== 0,
            traceable[i] + " does NOT begin CTRL-");
        ok(CsBind.isLineworkLayer(traceable[i]) === true,
            traceable[i] + " IS bindable linework -- it is traced by hand");
        eqs(CsLayers.frameOf(traceable[i]), "profile",
            traceable[i] + " is in the profile frame");
    }
}());

(function() {
    // every registry layer answers exactly one frame, and has a default
    var seen = {}, missing = [], bad = [];
    for (var k in CsLayers) {
        if (!CsLayers.hasOwnProperty(k) || typeof CsLayers[k] !== "string") {
            continue;
        }
        var name = CsLayers[k];
        var f = CsLayers.frameOf(name);
        if (f !== "plan" && f !== "profile" && f !== "sheet") {
            bad.push(name + "=" + f);
        }
        if (seen.hasOwnProperty(name) && seen[name] !== f) {
            bad.push(name + " answers two frames");
        }
        seen[name] = f;
        if (f !== "sheet" && !CsLayers.DEFAULTS.hasOwnProperty(name)) {
            missing.push(name);
        }
    }
    eqs(bad.join(","), "", "no layer answers a bad or doubled frame");
    eqs(missing.join(","), "", "every non-sheet registry layer has a DEFAULTS row");
}());
```

- [ ] **Step 2: Run to verify it fails.** `node tests/js_unit.js` → FAIL, `CsLayers.frameOf is not a function`.

- [ ] **Step 3: Implement.** In `scripts/CaveSurvey/Core/CsLayers.js`, add the constants beside the existing `PROFILE_FLOOR`/`PROFILE_CEILING`:

```javascript
// The profile frame's own control layers. EVERY ONE BEGINS "CTRL-",
// and that is load-bearing rather than cosmetic: CsBind's
// NEVER_LINEWORK_PREFIXES already refuses that prefix, so generated
// profile geometry stays ineligible for binding and moving with no
// change to CsBind at all. Drop the prefix and the generator's own
// output becomes bindable -- a test in js_unit.js asserts this.
CsLayers.PROFILE_SHOTS = "CTRL-PROFILE-SHOTS";
CsLayers.PROFILE_STATIONS = "CTRL-PROFILE-STATIONS";
CsLayers.PROFILE_STATION_LABELS = "CTRL-PROFILE-STATION-LABELS";
CsLayers.PROFILE_SPLAYS = "CTRL-PROFILE-SPLAYS";
CsLayers.PROFILE_LRUD = "CTRL-PROFILE-LRUD";

// The profile frame's traceable layers -- what a caver draws on an
// elevation. These must NOT begin "CTRL-", for the mirror of the
// reason above: hand-traced profile linework has to stay bindable so
// it moves when the survey does.
CsLayers.PROFILE_TRACED_CEILING = "PROFILE-CEILING";
CsLayers.PROFILE_TRACED_FLOOR = "PROFILE-FLOOR";
CsLayers.PROFILE_WALLS_INFERRED = "PROFILE-WALLS-INFERRED";
CsLayers.PROFILE_TEXT_NOTES = "PROFILE-TEXT-NOTES";
CsLayers.PROFILE_TEXT_LABELS = "PROFILE-TEXT-LABELS";
CsLayers.PROFILE_BREAKDOWN = "PROFILE-BREAKDOWN";
CsLayers.PROFILE_ENTRANCE = "PROFILE-ENTRANCE";
```

Add their `DEFAULTS` rows, mirroring each plan-frame twin's appearance so the two views read alike (e.g. `"PROFILE-BREAKDOWN": ["white", "CONTINUOUS", "Weight000"]` matching `BREAKDOWN`), and the generated pair keeping the faint dashed treatment already used by `CTRL-PROFILE-FLOOR`.

Then the frame test:

```javascript
// Layers that belong to the SHEET rather than to either view: one
// drawing prints as one sheet, and a plan with an elevation below it is
// ordinary cave cartography, so these are shared on purpose.
CsLayers.SHEET_LAYERS = ["0", "Defpoints", "BORDER", "TITLE-BLOCK",
    "LEGEND", "SCALE-BAR"];

/**
 * Which view a layer belongs to: "plan", "profile" or "sheet".
 *
 * THE ONLY PLACE THIS QUESTION IS ANSWERED. CsBind, RebuildSurveyData,
 * eraseStations and the warp tools all ask here rather than each
 * matching a prefix their own way -- those are shipped plan-view files,
 * and a second spelling of "is this profile?" is how they start
 * disagreeing about the same layer.
 *
 * An unrecognised name answers "plan", deliberately. The dangerous
 * mistake is a profile-scoped sweep picking up a layer nobody
 * classified -- a user's own layer, or one a future feature adds -- so
 * the default is the frame that owns the drawing's origin.
 */
CsLayers.frameOf = function(layerName) {
    if (layerName === undefined || layerName === null) {
        return "plan";
    }
    var name = String(layerName);
    var i;
    for (i = 0; i < CsLayers.SHEET_LAYERS.length; i++) {
        if (name === CsLayers.SHEET_LAYERS[i]) {
            return "sheet";
        }
    }
    // Both spellings of the profile frame: CTRL-PROFILE-* for generated
    // geometry, PROFILE-* for what is traced by hand.
    if (name.indexOf("CTRL-PROFILE-") === 0 || name.indexOf("PROFILE-") === 0) {
        return "profile";
    }
    return "plan";
};
```

- [ ] **Step 4: Run to verify it passes.** `node tests/js_unit.js`, then the CaveCAD engine, then `./tests/run_all.sh`.

- [ ] **Step 5: Mutation-test each criterion.** Delete the `SHEET_LAYERS` loop → the sheet assertions fail. Change `CTRL-PROFILE-SHOTS` to `PROFILE-SHOTS` → the CTRL-prefix assertion AND the `isLineworkLayer` assertion both fail. Make `frameOf` default to `"profile"` → the unknown-layer assertion fails. Report which test killed which.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(CsLayers): one frame test, and the profile frame's own layers" -- scripts/CaveSurvey/Core/CsLayers.js tests/js_unit.js
```

---

## Task 2: The templates and the structural tests

**Goal:** The plan template carries the whole profile-frame layer set, the PROFILE template's own view layers are renamed into that frame, and the structural tests pin both.

**Files:**
- Create: `tools/add_profile_frame_layers.js`
- Modify: `templates/NSS_Cave_Template_PLAN.dxf` and `templates/NSS_Cave_Template_PROFILE.dxf` (by running that tool)
- Modify: `tests/test_addon.py`

**Acceptance Criteria:**
- [ ] The PLAN template contains every profile-frame layer in the registry
- [ ] The PROFILE template's view layers are renamed to the profile frame, so a drawing started from it never carries plan-frame layer names
- [ ] The one-shot tool reads `CsLayers.DEFAULTS` through `CsLayers.ensure` and carries NO appearance table of its own — the drift this closes was a real finding
- [ ] Running the tool twice reports skip and leaves the file byte-identical, asserted by an automated test that shells out to CaveCAD twice
- [ ] A structural test asserts every layer `CsProfileDraw.LAYERS()` names exists in the PLAN template, derived by parsing that function rather than by a hand-maintained list
- [ ] A structural test asserts NO view layer name appears in both frames — the collision this whole plan exists to remove
- [ ] `test_both_templates_are_present` still passes; the PROFILE template is kept, not deleted

**Verify:** `python3 -m unittest discover -s tests` → OK with 2+ new tests; `./tests/run_all.sh` → `ALL TESTS PASSED`

**Steps:**

- [ ] **Step 1: Write the failing structural tests** in `tests/test_addon.py`, following the existing `parse_defaults_table()` source-scraping style:

```python
    def test_plan_template_has_every_profile_frame_layer(self):
        """The elevation now draws into the plan drawing, so every layer
        it needs must be in the plan template -- not invented at runtime
        with whatever defaults happen to apply.
        """
        registry = self.layer_registry()
        plan = self.template_layers("NSS_Cave_Template_PLAN.dxf")
        profile_frame = set(n for n in registry
                            if n.startswith("PROFILE-")
                            or n.startswith("CTRL-PROFILE-"))
        self.assertTrue(profile_frame, "no profile-frame layers in the registry")
        missing = profile_frame - plan
        self.assertEqual(missing, set(),
                         "profile-frame layers absent from the PLAN "
                         "template: %s" % sorted(missing))

    def test_no_view_layer_is_shared_between_frames(self):
        """The collision this design removes: one drawing cannot have a
        layer that means northing in one place and along-passage
        distance in another.
        """
        registry = self.layer_registry()
        sheet = {"0", "Defpoints", "BORDER", "TITLE-BLOCK", "LEGEND",
                 "SCALE-BAR"}
        both = set()
        for name in registry:
            if name in sheet:
                continue
            if name.startswith("CTRL-PROFILE-"):
                twin = "CTRL-" + name[len("CTRL-PROFILE-"):]
            elif name.startswith("PROFILE-"):
                twin = name[len("PROFILE-"):]
            else:
                continue
            # the twin existing is fine and expected; the same NAME
            # answering two frames is what must never happen
            if CsLayersFrame(name) == CsLayersFrame(twin):
                both.add(name)
        self.assertEqual(both, set(),
                         "layers whose profile and plan names collide: %s"
                         % sorted(both))
```

Add a small `CsLayersFrame(name)` helper in the test file that reimplements `frameOf`'s prefix rules in Python — deliberately a second, independent implementation, so the test disagrees with the JS if either drifts.

- [ ] **Step 2: Run to verify they fail.** `python3 -m unittest discover -s tests` → FAIL naming the absent profile-frame layers.

- [ ] **Step 3: Write the one-shot tool** `tools/add_profile_frame_layers.js`, modelled exactly on the existing `tools/add_profile_layers.js` (read it first): include `Core/CsLayers.js`, build its list as `[CsLayers.PROFILE_SHOTS, ...]` — names only, never appearances — call `CsLayers.ensure(doc, di, name)` per layer, skip when `doc.hasLayer(name)`, and export through the dxflib filter helper. Keep its `### ADD PROFILE FRAME LAYERS OK` / `FAIL` markers. It runs against BOTH templates: adding the profile frame to the plan template, and renaming the profile template's view layers into the frame.

- [ ] **Step 4: Run it twice.** Expected first: `ok  <path> -- N layer(s) added`. Expected second: `skip  <path> -- every layer already present`, with the file's bytes unchanged.

- [ ] **Step 5: Add the idempotence and add-path test** to `tests/test_addon.py`, following `TestAddProfileLayersToolIdempotence`: strip the layers from a throwaway copy, run once and assert the exact `ok` line, parse the resulting LAYER table and assert each layer's colour, linetype and lineweight equals its `CsLayers.DEFAULTS` row, then run again and assert the exact skip line plus byte equality.

- [ ] **Step 6: Mutation-test.** Delete a layer from the tool's list → the add-path test fails on the count. Give the tool its own hardcoded appearance instead of `DEFAULTS` → the appearance comparison fails. Revert the template → the plan-template test fails.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(templates): the plan template carries the profile frame" -- tools/add_profile_frame_layers.js templates/ tests/test_addon.py
```

---

## Task 3: The generator draws into the profile frame

**Goal:** Every entity `CsProfileDraw` creates lands on a profile-frame layer, so the two views no longer share a single layer name.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsProfileDraw.js` (`LAYERS()` at ~:53, and the draw calls at ~:269, :318, :326, :332, :367)
- Modify: `tests/profile_draw_roundtrip.js`

**Acceptance Criteria:**
- [ ] `CsProfileDraw.LAYERS()` names only profile-frame layers, asserted via `CsLayers.frameOf` over the whole returned list
- [ ] Centerline legs land on `CTRL-PROFILE-SHOTS`, station points on `CTRL-PROFILE-STATIONS`, station labels on `CTRL-PROFILE-STATION-LABELS`, flat splay ticks on `CTRL-PROFILE-SPLAYS`, band captions on `PROFILE-TEXT-LABELS`, ceiling runs on `CTRL-PROFILE-CEILING`, floor runs on `CTRL-PROFILE-FLOOR` — each asserted by reading the entity's layer name back
- [ ] `erase()`'s ownership test still requires tag AND layer membership, now against the profile-frame list
- [ ] A hand-drawn line on `PROFILE-CEILING` still survives regeneration; a generated line promoted onto `PROFILE-CEILING` still survives (both behaviours already tested — they must keep passing against the new layer names)
- [ ] No entity the generator creates lands on any layer whose `frameOf` is `"plan"`, asserted by sweeping every created entity

**Verify:** `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/profile_draw_roundtrip.js "$PWD"` → `### PROFILE DRAW OK`

**Steps:**

- [ ] **Step 1: Write the failing assertion** in `tests/profile_draw_roundtrip.js` — a sweep proving the generator never touches a plan-frame layer:

```javascript
// ---- nothing the generator draws may land in the plan frame --------
(function() {
    var ids = doc.queryAllEntities(false, false);
    var offenders = [];
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || !CsProfileBind.isProfileGeometry(e)) {
            continue;
        }
        var lname = doc.getLayerName(e.getLayerId());
        if (CsLayers.frameOf(lname) !== "profile") {
            offenders.push(lname);
        }
    }
    eqs(offenders.join(","), "",
        "every entity the generator drew is on a profile-frame layer");
}());
```

- [ ] **Step 2: Run to verify it fails.** Expected: the offenders list names `CTRL-SHOTS`, `CTRL-STATIONS`, `CTRL-STATION-LABELS`, `CTRL-SPLAYS` and `TEXT-LABELS`.

- [ ] **Step 3: Implement.** Change `CsProfileDraw.LAYERS()` to return the profile-frame set, and each draw call to its profile-frame layer:

```javascript
CsProfileDraw.LAYERS = function() {
    return [CsLayers.PROFILE_SHOTS, CsLayers.PROFILE_STATIONS,
        CsLayers.PROFILE_STATION_LABELS, CsLayers.PROFILE_SPLAYS,
        CsLayers.PROFILE_FLOOR, CsLayers.PROFILE_CEILING,
        CsLayers.PROFILE_TEXT_LABELS];
};
```

and correspondingly `CsLayers.SHOTS` → `CsLayers.PROFILE_SHOTS`, `CsLayers.STATIONS` → `CsLayers.PROFILE_STATIONS`, `CsLayers.STATION_LABELS` → `CsLayers.PROFILE_STATION_LABELS`, `CsLayers.SPLAYS` → `CsLayers.PROFILE_SPLAYS`, `CsLayers.TEXT_LABELS` → `CsLayers.PROFILE_TEXT_LABELS` at the five call sites.

- [ ] **Step 4: Update the existing per-kind layer assertions** to the new names, and re-run.

- [ ] **Step 5: Mutation-test.** Point ceiling runs at `CsLayers.PROFILE_FLOOR` → the per-kind assertion fails. Point legs back at `CsLayers.SHOTS` → the frame sweep fails. Report both.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(CsProfileDraw): draw into the profile frame, not the plan's layers" -- scripts/CaveSurvey/Core/CsProfileDraw.js tests/profile_draw_roundtrip.js
```

---

## Task 4: `CsBind` binds only within a frame

**Goal:** A line traced on the elevation can never bind to a plan station, and vice versa — even when the two sit near each other in absolute coordinates.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsBind.js` (`stationIndex` at ~:643, and its four call sites at ~:816, :961, :1103, :1499)
- Modify: `scripts/CaveSurvey/Core/CsProfileBind.js`
- Modify: `tests/js_unit.js`, `tests/profile_draw_roundtrip.js`

**Why this is the real work.** Two coordinate frames now share one model space. `CsBind.stationsInBox` and `marginFor` bind by ABSOLUTE proximity, so without a frame filter a ceiling line traced at (120, -400) will happily bind to whatever plan station happens to lie nearest — silently, and the resulting move will drag it somewhere meaningless. The profile is placed below the plan, so plan and profile coordinates are guaranteed to be *near each other* at the boundary.

**Acceptance Criteria:**
- [ ] `CsBind.stationIndex(doc, frame)` returns only stations whose own layer is in the named frame; called with no frame it returns the plan frame, so existing callers are unchanged in behaviour
- [ ] Each of the four existing call sites passes the frame belonging to the entity or operation it is serving
- [ ] `CsBind.bindEntity` refuses to bind an entity to a station in a different frame — asserted directly, not merely implied by which index was passed
- [ ] `CsProfileBind.stationIndex` keeps its run-qualified keys and its layer-membership requirement, and is the profile frame's index
- [ ] **The frame-crossing fixture:** a plan station and a profile station placed at deliberately OVERLAPPING absolute coordinates, with a line traced beside each. Each line binds to its own frame's station and NEITHER binds across. Asserted in both directions
- [ ] A traced plan wall still binds and moves exactly as it does today — the regression floor for shipped behaviour

**Verify:** `./tests/run_all.sh --publish` → `ALL TESTS PASSED`, with the frame-crossing assertions named in the output

**Steps:**

- [ ] **Step 1: Write the failing frame-crossing test.** In `tests/js_unit.js` (pure parts) and `tests/profile_draw_roundtrip.js` (document parts). The essential shape, in the document test:

```javascript
// ---- frame crossing: the hazard same-drawing introduces -----------
// A plan station and a profile station at coordinates only 2 units
// apart, each with a line traced beside it. Absolute proximity alone
// cannot tell them apart -- only the frame can.
(function() {
    var op = new RAddObjectsOperation();
    CsLayers.ensure(doc, di, CsLayers.STATIONS);
    CsLayers.ensure(doc, di, CsLayers.PROFILE_STATIONS);
    CsLayers.ensure(doc, di, CsLayers.WALLS_SURVEYED);
    CsLayers.ensure(doc, di, CsLayers.PROFILE_TRACED_CEILING);

    var planPt = CsDraw.addPoint(doc, op, CsLayers.STATIONS,
        new RVector(100, 100));
    CsTags.set(planPt, "Station", "P1");
    op.addObject(planPt, false);

    var profPt = CsDraw.addPoint(doc, op, CsLayers.PROFILE_STATIONS,
        new RVector(102, 100));
    CsTags.set(profPt, "ProfileStation", "Q1");
    CsTags.set(profPt, "ProfileRun", "Q");
    op.addObject(profPt, false);

    var planLine = new RLineEntity(doc, new RLineData(
        new RVector(100, 100), new RVector(110, 105)));
    planLine.setLayerId(doc.getLayerId(CsLayers.WALLS_SURVEYED));
    op.addObject(planLine, false);

    var profLine = new RLineEntity(doc, new RLineData(
        new RVector(102, 100), new RVector(112, 105)));
    profLine.setLayerId(doc.getLayerId(CsLayers.PROFILE_TRACED_CEILING));
    op.addObject(profLine, false);
    di.applyOperation(op);

    var planIdx = CsBind.stationIndex(doc, "plan");
    var profIdx = CsProfileBind.stationIndex(doc);

    var planNames = [], profNames = [], i;
    for (i = 0; i < planIdx.length; i++) { planNames.push(planIdx[i].name); }
    for (i = 0; i < profIdx.length; i++) { profNames.push(profIdx[i].name); }

    eqs(planNames.join(","), "P1",
        "the plan index holds ONLY the plan station");
    eqs(profNames.join(","), "Q/Q1",
        "the profile index holds ONLY the profile station, run-qualified");

    // and the binding itself, in both directions
    CsBind.tagEntities(doc, di, CsBind.planAutoBind(doc, {}).entries);
    eqs(CsTags.get(doc.queryEntity(planLine.getId()),
        CsBind.STATIONS_TAG), "P1",
        "the plan-frame line bound to P1 and NOT to the profile station");

    CsProfileBind.claim(doc, di);
    eqs(CsTags.get(doc.queryEntity(profLine.getId()),
        CsBind.STATIONS_TAG), "Q/Q1",
        "the profile-frame line bound to Q/Q1 and NOT to the plan station");
}());
```

- [ ] **Step 2: Run to verify it fails.** Expected: the plan index contains both stations (it walks `Station`-tagged points regardless of layer, and after Task 3 the profile point carries `ProfileStation`, so check what actually happens and report it — if the plan index is already clean because of the tag difference, the FAILING assertion will be the reverse direction or the bind result, and that is the one that matters).

- [ ] **Step 3: Implement the frame parameter.**

```javascript
/**
 * Station positions for one FRAME, as a binding index.
 *
 * \param frame "plan" (default) or "profile" -- which view's stations
 *              to index. Omitted means plan, so every existing caller
 *              keeps its behaviour unchanged.
 *
 * WHY A FRAME AT ALL. Since the elevation moved into the plan drawing,
 * two coordinate frames share one model space: plan X/Y are easting and
 * northing, profile X is distance along the passage. This index feeds
 * stationsInBox/marginFor, which match by ABSOLUTE proximity -- and the
 * profile region sits directly below the plan, so the two frames are
 * guaranteed to be near each other at their boundary. Without the
 * filter, a ceiling line traced on the elevation binds to whichever
 * plan station happens to lie nearest and is then dragged somewhere
 * meaningless by the next revision.
 */
CsBind.stationIndex = function(doc, frame) {
    var want = (frame === undefined || frame === null) ? "plan" : frame;
    ...
    // inside the existing entity loop, after the layer name is known:
    if (CsLayers.frameOf(CsBind.layerNameOf(doc, e)) !== want) {
        continue;
    }
    ...
};
```

Then pass the frame at each of the four call sites, deriving it from the entity being bound where there is one (`CsLayers.frameOf(CsBind.layerNameOf(doc, entity))`) rather than hardcoding — an entity is always bound within its own frame.

- [ ] **Step 4: Add the cross-frame refusal inside `bindEntity`**, so the guarantee does not depend on every caller passing the right index:

```javascript
    // Belt to the frame-scoped index's braces: even handed a mixed
    // index, an entity never binds outside its own frame.
    var entFrame = CsLayers.frameOf(CsBind.layerNameOf(doc, entity));
```

and filter the candidate list by `CsLayers.frameOf` of each candidate station's layer.

- [ ] **Step 5: Run both engines and the full suite.**

- [ ] **Step 6: Mutation-test.** Remove the frame filter from `stationIndex` → the index-contents assertions fail. Remove the refusal in `bindEntity` → the bind-result assertions fail. Pass `"profile"` where a plan frame is meant at one call site → the plan regression assertion fails. Report all three.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(CsBind): bind within a frame, never across one" -- scripts/CaveSurvey/Core/CsBind.js scripts/CaveSurvey/Core/CsProfileBind.js tests/js_unit.js tests/profile_draw_roundtrip.js
```

---

## Task 5: Prove `RebuildSurveyData` and `eraseStations` ignore the profile

**Goal:** Turn two "it happens to work" properties into asserted ones, because both are consequences of naming rather than of code.

**Files:**
- Modify: `tests/js_unit.js` (or a headless driver if the rebuild path needs a real document — check which the existing rebuild tests use and follow it)

**Why no production change.** `RebuildSurveyData` compares layer ids (`lid === stLayer`, `lid === lbLayer`), so once profile stations live on `CTRL-PROFILE-STATIONS` they never match and are ignored — for free. `eraseStations` keys on `Station`/`LRUDName`/`SplayName` while profile geometry carries the `Profile*` namespace. Both are correct today by construction. Neither is tested, and both would break silently if a later change converged the names. The user's decision — "have it ignore the PROFILE layers" — is satisfied by the rename; this task is what keeps it satisfied.

**Acceptance Criteria:**
- [ ] A drawing holding BOTH a plan survey and a drawn profile rebuilds to exactly the plan survey: the same station count, the same shot count, and the same coordinates as the identical drawing without a profile
- [ ] Profile station LABELS are not read as plan stations — the label path matters most, since profile labels carry the same station names at entirely different coordinates
- [ ] `eraseStations` on a plan station removes its plan geometry and leaves every profile-frame entity intact, asserted by count and by tag
- [ ] Each assertion fails if the layer names are made to converge — demonstrate by mutation, e.g. by pointing `CsProfileDraw` back at `CsLayers.STATIONS`

**Verify:** `./tests/run_all.sh --publish` → `ALL TESTS PASSED`

**Steps:**

- [ ] **Step 1: Write the tests.** They pass immediately against correct code, so the ONLY evidence they are worth anything is the mutation in step 2 — do not skip it, or this task delivers nothing.

```javascript
// ---- the rebuild sees the plan survey and nothing else ------------
(function() {
    // one drawing, both views: draw the plan survey, then the elevation
    var planOnly = CsTags.surveyFromDocument(docPlanOnly);
    var withProfile = CsTags.surveyFromDocument(docWithProfile);

    eqs(String(withProfile.shots.length), String(planOnly.shots.length),
        "a drawn elevation adds NO shots to what the rebuild recovers");
    var namesA = CsModel.stationNames(planOnly).join(",");
    var namesB = CsModel.stationNames(withProfile).join(",");
    eqs(namesB, namesA,
        "and no stations -- the profile's labels carry the same names at "
        + "different coordinates, which is the trap");
}());

// ---- erasing a plan station leaves the elevation alone ------------
(function() {
    var beforeProfile = countProfileFrameEntities(doc);
    var removed = CsDraw.eraseStations(doc, ["A2"]);
    ok(removed > 0, "the plan station's own geometry was removed");
    eqs(String(countProfileFrameEntities(doc)), String(beforeProfile),
        "every profile-frame entity survived erasing a PLAN station");
}());
```

where `countProfileFrameEntities` walks `doc.queryAllEntities(false, false)` and counts those whose layer answers `CsLayers.frameOf(...) === "profile"`.

- [ ] **Step 2: Mutate to prove the tests bite.** Temporarily point `CsProfileDraw.LAYERS()`'s station entry back at `CsLayers.STATIONS`, run, and confirm the rebuild test fails with a station count including the profile's. Restore. Then temporarily make profile station points carry `Station` instead of `ProfileStation`, confirm the `eraseStations` test fails, restore. Report both.

- [ ] **Step 3: Commit**

```bash
git commit -m "test: pin that the rebuild and erase paths ignore the profile frame" -- tests/
```

---

## Task 6: The warp tools stay in the plan frame

**Goal:** Warping a plan to fit an aerial photograph cannot reach the elevation.

**Files:**
- Modify: `scripts/CaveSurvey/AlignImage/AlignImage.js`
- Modify: `tests/js_unit.js` or the appropriate headless driver

**Why.** This is the objection that made a sibling file the original choice: a plan-wide transform is meaningless applied to an elevation, and a tag cannot stop a transform. A frame-scoped selection can — the same mechanism as Tasks 4 and 5, which is the argument for having exactly one frame test.

**Acceptance Criteria:**
- [ ] Any operation that moves, rotates, scales or warps a selection on the plan's behalf excludes profile-frame entities
- [ ] A fixture with a drawn profile, warped via AlignImage's own fit, leaves every profile-frame entity at exactly its original coordinates — asserted per entity at 1e-9, not by count
- [ ] Plan-frame behaviour is unchanged: the same warp on the same plan geometry produces byte-identical results to before this task
- [ ] Read `AlignImage.js` first and find EVERY place it collects entities to transform; if there is more than one, all of them are covered, and the report says how many there were

**Verify:** `./tests/run_all.sh --publish` → `ALL TESTS PASSED`

**Steps:**

- [ ] **Step 1: Audit.** `grep -n "queryAllEntities\|getSelectedEntities\|transform\|rotate\|scale" scripts/CaveSurvey/AlignImage/AlignImage.js` and write down every collection point. Report the list BEFORE editing — if any of them cannot be frame-scoped without changing plan behaviour, say so and stop.

- [ ] **Step 2: Write the failing test** — profile entities' coordinates captured before a warp, compared after.

- [ ] **Step 3: Implement** the frame filter at each collection point, via `CsLayers.frameOf`.

- [ ] **Step 4: Mutation-test.** Remove the filter → the per-entity coordinate assertions fail.

- [ ] **Step 5: Commit**

```bash
git commit -m "fix(AlignImage): a plan warp does not reach the elevation" -- scripts/CaveSurvey/AlignImage/AlignImage.js tests/
```

---

## Task 7: The switch — draw into the current document, and delete the sibling file

**Goal:** The elevation is drawn into the plan drawing at a region below it, the region translates when its origin moves, and `CsProfileFile.js` is gone.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsProfileDraw.js`
- Modify: `scripts/CaveSurvey/Core/CsDraw.js` (`profileNow` at ~:1050, `profile` at ~:970)
- Modify: `scripts/CaveSurvey/GenerateProfile/GenerateProfile.js`
- Modify: `scripts/CaveSurvey/Core/CsAll.js`
- Delete: `scripts/CaveSurvey/Core/CsProfileFile.js`, `tests/profile_file_roundtrip.js`
- Modify: `tests/run_all.sh` (remove that stage), `tests/README.md`

**Acceptance Criteria:**
- [ ] `CsDraw.profileNow` draws into the document it is given — no sibling path, no off-screen document, no export, no reveal
- [ ] The region origin is recomputed from the plan's extents on each draw, placed below them with a documented gutter
- [ ] Every drawn coordinate is offset by that origin. `CsProfileDraw`'s existing `at(x, y)` helper applies only the band's `zOffset` today; it must apply the region origin as well, so band coordinates (X from 0, Y at true elevation) land in the region rather than on top of the plan. Assert a drawn coordinate equals `origin + bandCoordinate + zOffset`, not just that it moved
- [ ] The PREVIOUS origin is stored on the drawing, and when it changes the delta translates every profile-frame entity — generated AND hand-drawn — inside the SAME undo step as the redraw
- [ ] The translation runs inside `CsRevise.withOffLayersOn`: it MODIFIES user linework, which may sit on a layer the user switched off to sketch undisturbed, and this build refuses modifies on an off layer as silently as adds and deletes
- [ ] The translation is a single vector applied to a frame-scoped selection — NOT a per-entity similarity fit. No fitting, no residuals, no refusals. Say so in the comment, because the cross-file version needed the fit and the next reader will assume this does too
- [ ] A test: sketch on the profile, extend the survey southward so the plan's extents grow, redraw, and assert the sketch moved by EXACTLY the origin delta and still sits where it did relative to the geometry it described
- [ ] `CsProfileFile` is referenced nowhere — `grep -rn CsProfileFile scripts/ tests/` returns nothing
- [ ] Opening the drawing and loading it into the Survey Notebook finds the survey: the "No survey shots found in this drawing" dialog is no longer reachable from a drawing that has a survey
- [ ] The suite has 5 stages, not 6, and `tests/README.md` says so

**Verify:** `./tests/run_all.sh --publish` → `ALL TESTS PASSED`, 5 stages

**Steps:**

- [ ] **Step 1: Write the failing translation test** in `tests/profile_draw_roundtrip.js`:

```javascript
// ---- the region moves, and the sketch moves with it ---------------
(function() {
    // draw, sketch on the elevation, then grow the plan southward so the
    // recomputed origin moves, and redraw.
    var before = CsProfileDraw.render(doc, di, built, {});
    var originBefore = CsProfileDraw.regionOrigin(doc);

    CsLayers.ensure(doc, di, CsLayers.PROFILE_TRACED_CEILING);
    var op = new RAddObjectsOperation();
    var sketch = new RLineEntity(doc, new RLineData(
        new RVector(originBefore.x + 5, originBefore.y + 3),
        new RVector(originBefore.x + 15, originBefore.y + 4)));
    sketch.setLayerId(doc.getLayerId(CsLayers.PROFILE_TRACED_CEILING));
    op.addObject(sketch, false);
    di.applyOperation(op);
    var id = sketch.getId();
    var startBefore = doc.queryEntity(id).getStartPoint();

    // a new shot heading south grows the plan's extents
    survey.shots.push(shotOf("A3", "A4", 200, 180, 0));
    var res2 = CsNetwork.resolve(survey, {});
    CsProfileDraw.render(doc, di, CsProfile.build(survey, res2, {}), {});

    var originAfter = CsProfileDraw.regionOrigin(doc);
    var dx = originAfter.x - originBefore.x;
    var dy = originAfter.y - originBefore.y;
    ok(Math.abs(dy) > 1e-9, "the origin really did move (dy " + dy + ")");

    var startAfter = doc.queryEntity(id).getStartPoint();
    near(startAfter.x - startBefore.x, dx, 1e-9,
        "THE SKETCH MOVED BY EXACTLY THE ORIGIN DELTA IN X");
    near(startAfter.y - startBefore.y, dy, 1e-9,
        "THE SKETCH MOVED BY EXACTLY THE ORIGIN DELTA IN Y");
}());
```

- [ ] **Step 2: Run to verify it fails.** Expected: `CsProfileDraw.regionOrigin is not a function`.

- [ ] **Step 3: Implement the origin and the translation.** `CsProfileDraw.regionOrigin(doc)` reads the stored origin; `CsProfileDraw.computeOrigin(doc)` derives the new one from the plan frame's extents plus a gutter; `CsProfileDraw.translateRegion(doc, di, dx, dy)` moves every profile-frame entity by one vector inside `CsRevise.withOffLayersOn`. `render` calls them in the order: read stored origin → compute new origin → translate by the delta if it moved → store the new origin → erase → draw. Translating BEFORE the erase and draw means the generated geometry is redrawn at the new origin anyway and only the sketch actually needs the move; state that in the comment.

- [ ] **Step 4: Rip out the sibling file.** Delete `Core/CsProfileFile.js` and `tests/profile_file_roundtrip.js`, remove the `run_all.sh` stage, drop the include from `CsAll.js`, and simplify `CsDraw.profileNow` to draw into the passed document. `GenerateProfile.js` loses its resolve/commit/reveal and its refusal paths that were about the sibling; keep the refusals that are still real (no survey in the drawing).

- [ ] **Step 5: Run both engines and the full suite.** Confirm 5 stages and that `grep -rn CsProfileFile scripts/ tests/` is empty.

- [ ] **Step 6: Mutation-test.** Skip the translation → the delta assertions fail. Translate outside `withOffLayersOn` and switch the tracing layer off in the fixture → the sketch does not move and the assertion fails. Store the origin but never update it → the second redraw's delta is wrong. Report all three.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(profile): the elevation lives in the plan drawing" -- scripts/CaveSurvey/ tests/ docs/
```

---

## Task 8: The exaggeration stamp

**Goal:** An exaggerated elevation says so, in the drawing, so nobody measures it with the sheet's scale bar.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsProfileDraw.js`
- Modify: `tests/profile_draw_roundtrip.js`

**Acceptance Criteria:**
- [ ] With `CaveSurvey/ProfileVerticalExaggeration` at its default 1.0, NO stamp is drawn
- [ ] At any other value the region carries a text entity reading exactly `VERTICAL EXAGGERATION 2x -- NOT TO SHEET SCALE` (with the actual factor), on `PROFILE-TEXT-LABELS`, tagged so `erase()` removes it on the next redraw
- [ ] The factor is formatted so 2.0 reads `2x` and 1.5 reads `1.5x` — assert both
- [ ] The stamp is asserted by exact string read back via `getPlainText()`, not by substring
- [ ] All text goes through `CsDraw.addText`, so the stamp is capitalised by the suite's own chokepoint rather than by hand

**Verify:** `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/profile_draw_roundtrip.js "$PWD"` → `### PROFILE DRAW OK`

**Steps:**

- [ ] **Step 1: Write the failing tests** — one fixture at 1.0 asserting no stamp entity exists, one at 2.0 and one at 1.5 asserting the exact text.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** in `CsProfileDraw.band` or beside the band caption, using `CsDraw.addText` and a `ProfileExaggerationStamp` tag added to `CsProfileDraw.TAGS`.
- [ ] **Step 4: Mutation-test.** Draw the stamp unconditionally → the 1.0 fixture fails. Format 2.0 as `2.0x` → the exact-string assertion fails.
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(CsProfileDraw): an exaggerated elevation says so" -- scripts/CaveSurvey/Core/CsProfileDraw.js tests/profile_draw_roundtrip.js
```

---

## Task 9: The regression floor, and the GUI gate

**Goal:** Prove a drawing with no profile is untouched by any of this, then verify in the running application what no test can settle.

**USER-ORDERED GATE — NON-SKIPPABLE.** This task was requested by the user in the current conversation. It MUST NOT be closed by walking around it, by declaring it "verified inline", or by substituting a cheaper check. Close only after every item in `acceptanceCriteria` has been re-validated independently, with output captured.

**Files:**
- Modify: `tests/js_unit.js` (the regression fixture)
- Modify: `scripts/CaveSurvey/VERSION`, `README.md` as the release requires

**Acceptance Criteria:**
- [ ] For a drawing with NO profile, plan-view output is byte-identical to the pre-change baseline: every station coordinate, every closure, every wall run, dumped at 17 significant digits and diffed against the same dump taken at the commit before Task 1. Any difference is a regression, not an improvement
- [ ] `./tests/run_all.sh --publish` → `ALL TESTS PASSED -- including publish checks`
- [ ] Observed in the running application: the elevation appears below the plan in the SAME drawing, on profile-frame layers
- [ ] Observed: switching off `CTRL-PROFILE-SHOTS` hides the elevation's centerline and leaves the plan's visible — the segregation working, from the user's side
- [ ] Observed: the Survey Notebook loads the survey from this drawing (the "No survey shots found" dialog does not appear), a shot is edited, and BOTH views redraw
- [ ] Observed: one Ctrl-Z after a redraw returns the drawing to where the user expects
- [ ] Observed: a line traced on `PROFILE-CEILING` survives a redraw, and moves when its stations move
- [ ] Observed: extending the survey southward moves the region and carries the traced line with it
- [ ] Observed: AlignImage's warp on the plan leaves the elevation untouched

**Verify:** `./tests/run_all.sh --publish` → `ALL TESTS PASSED -- including publish checks`, plus written notes for each observed item

**Steps:**

- [ ] **Step 1: Capture the baseline BEFORE anything else in this task.** `git stash` or a scratch checkout at the commit preceding Task 1, run a probe dumping plan geometry for a fixture with branches, closures, ties and two anchors at 17 digits, and save it outside the repo.
- [ ] **Step 2: Dump the same probe at HEAD and diff.** Zero differences, or stop and report.
- [ ] **Step 3: Publish for testing.** `./tools/publish.sh --version 0.5.0.0` (bump so the loaded build is unambiguous; the previous zip stays in `~/Documents/Cave/releases/`).
- [ ] **Step 4: Work the observed list** in the running application, writing down what was seen for each item. Anything that fails: report it, do not fix it inside this gate.
- [ ] **Step 5: Commit**

```bash
git commit -m "chore: 0.5.0.0 -- the elevation lives in the plan drawing" -- scripts/CaveSurvey/VERSION README.md
```

---

## Known constraints inherited from the elevation work

Recorded so no task rediscovers them.

- **An elevation cannot represent azimuth.** Distance, inclination, U and D are recoverable from its geometry; bearing never is. The plan frame owns the horizontal truth permanently.
- **`CsProfile.build` is quadratic in the survey TOTAL**, and after the leg index the dominant term is `CsModel.lrudForStation`'s full scan of `survey.shots` per station inside `bandWallRuns` — 78-92% of build time. `CaveSurvey/ProfileAutoMaxStations` stays at 3000 (about half a second) until that is hoisted.
- **Rotation in the linework mover:** reusing `CsRevise.similarityFit` means a traced line spanning a corrected leg tilts by the FULL inclination correction when bound to that leg's two endpoints. That is the user's explicit decision. This plan's region translation is NOT that mover and cannot tilt anything.
- **`CsTags.surveyFromDocument` now recovers splays** (`498c87b`), so a drawing rebuilt from its own tags carries the splay-derived walls the profile needs.
