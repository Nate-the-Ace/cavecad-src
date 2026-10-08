# Cross-section Layer Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give cross sections a standardised, registered, templated set of layers — and a `section` frame the whole suite understands — so the Feature Trace Cross Section group fills with real tiles and the eventual generator has somewhere to draw.

**Architecture:** Sections become the suite's THIRD frame, built exactly like the second one. `CsLayers` gains the constants and their `DEFAULTS` appearance rows; `CsLayers.frameOf` gains a `section` answer keyed on the `CTRL-SECTION-`/`SECTION-` prefixes; `tools/sync_template_layers.js` puts every new registry layer into the plan template. The `CTRL-` half is generator-owned and erased on redraw, the unprefixed half is the caver's own tracing — the split `PROFILE-*` already uses. One deliberate departure from the profile precedent: hand-traced section linework is registered but NOT yet bindable, because `CsBind` indexes stations per frame and a section frame has a single station rather than a chain.

**Tech Stack:** QCAD/CaveCAD ECMAScript add-on, `tools/sync_template_layers.js`, `tests/run_all.sh` (Python unittest + headless CaveCAD drivers + node).

**User decisions (already made):**
- "we just added cross sections, so we need to make a plan to add them to the dxf template and get standardized leyers for anything we'd need for cross section support." — this plan.
- "Cross Section should go on the left" — the Feature Trace group's cell, already shipped (`aabc2df`). This plan fills that group.
- "we're giving up on the cross section grid, forget that i wanted it. the cross section callout is a much better solution." — SUPERSEDES the earlier grid decision from the same session. Sections are placed on a leader beside their station, not in a grid under the elevation. Does not change this plan: the layer set is the same either way, and `CTRL-SECTION-BOX` is still the frame a callout's block occupies.

**Specs:** `docs/superpowers/specs/2026-08-29-cross-section-design.md` (the generator; unapproved, and this plan deliberately does not depend on its open questions) and `docs/superpowers/specs/2026-08-29-frame-aware-scan-shelf-design.md` (whose Task 3 also wanted `CTRL-SECTION-SCAN` — see Coordination below).

**Scope:** Layers, frame classification, template, and the Feature Trace tiles. NOT the section generator, NOT section frames on the sheet, NOT binding section linework.

---

## Coordination with the held scan plan

`docs/superpowers/plans/2026-08-29-frame-aware-scan-shelf.md` Task 3 adds `CTRL-PROFILE-SCAN` **and** `CTRL-SECTION-SCAN`, plus the same `frameOf` `section` answer. Whichever plan runs second must not add them twice.

**This plan owns the section half.** When the scan plan runs, its Task 3 shrinks to `CTRL-PROFILE-SCAN` alone and drops its `frameOf` step, since Task 1 here already did it. If the scan plan runs FIRST, Task 1 here becomes "verify and extend" rather than "add". Check `grep -n 'CTRL-SECTION-SCAN' scripts/CaveSurvey/Core/CsLayers.js` before starting Task 1 and take whichever branch matches.

---

## The layer set

Generated, generator-owned, erased and rebuilt on every redraw. All `CTRL-` prefixed, so `CsBind.NEVER_LINEWORK_PREFIXES` excludes them from binding for free:

| Layer | Contents | Appearance |
|---|---|---|
| `CTRL-SECTION-BOX` | the frame rectangle, tag `SectionBox=<key>`. LOCKED, like `CTRL-PROFILE-BOX` | `["gray", "CONTINUOUS", "Weight000"]` |
| `CTRL-SECTION-OUTLINE` | the outline through measured points | `["gray", "CONTINUOUS", "Weight025"]` |
| `CTRL-SECTION-SPLAYS` | the splay rays, so the evidence shows | `["gray", "CONTINUOUS", "Weight000"]` |
| `CTRL-SECTION-STATIONS` | the station dot and its centreline cross | `["red", "CONTINUOUS", "Weight025"]` |
| `CTRL-SECTION-TEXT-LABELS` | "A–A′", the scale, the station name | `["red", "CONTINUOUS", "Weight025"]` |
| `CTRL-SECTION-SCAN` | an inserted section sketch (see Coordination) | `["gray", "CONTINUOUS", "Weight000"]` |

Hand-traced, the caver's own work, never touched by a redraw. Deliberately NOT `CTRL-` prefixed, mirroring `PROFILE-CEILING` and its siblings:

| Layer | What a caver draws on it | Appearance (mirrors its plan/profile twin) |
|---|---|---|
| `SECTION-WALLS` | the passage outline in the slice | `["white", "CONTINUOUS", "Weight035"]` |
| `SECTION-WALLS-INFERRED` | outline where nothing was measured | `["white", "DASHED", "Weight025"]` |
| `SECTION-CEILING` | ceiling detail | `["white", "CONTINUOUS", "Weight025"]` |
| `SECTION-FLOOR` | floor detail | `["white", "CONTINUOUS", "Weight025"]` |
| `SECTION-BREAKDOWN` | breakdown in section | `["white", "CONTINUOUS", "Weight000"]` |

**`CROSS-SECTION-MARKERS` is NOT in this set and stays plan-framed.** It is the mark IN THE PLAN saying where a section was cut. It does not start with `SECTION-`, so the prefix test leaves it alone — but that is a coincidence worth a test, because a future `SECTION-MARKERS` would silently change frames.

**Open, and worth your answer before Task 1 runs:** the five traced layers above are my reading of what a caver draws in a section, mirroring the profile's five. If a section only ever gets an outline and breakdown in your practice, say so and Task 1 registers three instead of five. Registering a layer nobody draws on is clutter in every drawing's layer list; the cost of adding one later is one registry line plus a template sync.

---

## Task 1: The registry — constants, appearance, and a third frame

**Goal:** Every section layer exists in `CsLayers` with its appearance, and `CsLayers.frameOf` answers `section` for both spellings.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsLayers.js` (constants near `:70-111`, `DEFAULTS` near `:172-196`, `LOCKED` at `:307`, `frameOf` at `:268-285`)
- Modify: `tests/js_unit.js`
- Modify: `tests/test_addon.py`

**Acceptance Criteria:**
- [ ] Every layer in the two tables above has a `CsLayers.*` constant and a `DEFAULTS` row.
- [ ] `CsLayers.LOCKED` includes `CTRL-SECTION-BOX`.
- [ ] `CsLayers.frameOf` answers `"section"` for `CTRL-SECTION-OUTLINE` and for `SECTION-WALLS`.
- [ ] `CsLayers.frameOf("CROSS-SECTION-MARKERS") === "plan"`.
- [ ] `CsLayers.frameOf` still answers `"plan"` for an unrecognised layer and `"profile"` for `PROFILE-CEILING`.
- [ ] `test_addon.py` pins each new constant AND its `DEFAULTS` row — the registry-vs-template comparison shrinks on both sides when a constant is deleted, so it cannot catch that alone.

**Verify:** `node tests/js_unit.js` → `### UNIT OK <n> assertions`, and `python3 -m unittest discover -s tests` → OK

**Steps:**

- [ ] **Step 1: Check the Coordination branch**

Run: `grep -n 'CTRL-SECTION-SCAN\|"section"' scripts/CaveSurvey/Core/CsLayers.js`

If `CTRL-SECTION-SCAN` and the `section` branch of `frameOf` are already there, the scan plan ran first: skip the parts of Steps 3 and 5 that duplicate them and add only what is missing.

- [ ] **Step 2: Write the failing assertions in `tests/js_unit.js`**

Find the existing `CsLayers.frameOf` block and add:

```javascript
    eqs(CsLayers.frameOf("CTRL-SECTION-OUTLINE"), "section",
        "CsLayers.frameOf: generated section geometry is section-framed");
    eqs(CsLayers.frameOf("SECTION-WALLS"), "section",
        "CsLayers.frameOf: hand-traced section linework is section-framed");
    eqs(CsLayers.frameOf("CROSS-SECTION-MARKERS"), "plan",
        "CsLayers.frameOf: the plan's own cut marks stay plan-framed");
    eqs(CsLayers.frameOf("PROFILE-CEILING"), "profile",
        "CsLayers.frameOf: the profile frame is unchanged");
    eqs(CsLayers.frameOf("SOMEBODYS-OWN-LAYER"), "plan",
        "CsLayers.frameOf: an unknown layer still defaults to plan");
    ok(CsLayers.refusesEditsByName === undefined ||
            CsLayers.LOCKED["CTRL-SECTION-BOX"] === true,
        "CsLayers.LOCKED: the section box is locked like the profile box");
```

- [ ] **Step 3: Run and watch it fail**

Run: `node tests/js_unit.js`
Expected: FAIL on `generated section geometry is section-framed` — it answers `plan` today.

- [ ] **Step 4: Add the constants**

In `scripts/CaveSurvey/Core/CsLayers.js`, after the profile block (around `:82`):

```javascript
// ---------------------------------------------------------------------
// THE SECTION FRAME -- cross sections, the suite's third view.
//
// Same split as the profile frame, for the same reasons: the CTRL- half
// is generated, owned by the section tool, and erased and redrawn on
// every rebuild; the unprefixed half is the caver's own tracing and is
// never touched. Getting a layer on the wrong side of that line is what
// the NAMING TRAP note above is about.
//
// CROSS-SECTION-MARKERS is deliberately NOT here. It is the mark in the
// PLAN saying where a section was cut, so it belongs to the plan frame,
// and its name not starting "SECTION-" is what keeps it there.
// ---------------------------------------------------------------------
CsLayers.SECTION_BOX = "CTRL-SECTION-BOX";
CsLayers.SECTION_OUTLINE = "CTRL-SECTION-OUTLINE";
CsLayers.SECTION_SPLAYS = "CTRL-SECTION-SPLAYS";
CsLayers.SECTION_STATIONS = "CTRL-SECTION-STATIONS";
CsLayers.SECTION_TEXT_LABELS = "CTRL-SECTION-TEXT-LABELS";
CsLayers.SECTION_SCAN = "CTRL-SECTION-SCAN";

// The section frame's traceable layers -- what a caver draws in a
// section. NOT "CTRL-" prefixed, so they stay eligible for binding the
// day sections learn to bind (see CsBind, and Task 3 of this plan for
// why they are held out of it until then).
CsLayers.SECTION_WALLS = "SECTION-WALLS";
CsLayers.SECTION_WALLS_INFERRED = "SECTION-WALLS-INFERRED";
CsLayers.SECTION_CEILING = "SECTION-CEILING";
CsLayers.SECTION_FLOOR = "SECTION-FLOOR";
CsLayers.SECTION_BREAKDOWN = "SECTION-BREAKDOWN";
```

- [ ] **Step 5: Add the `DEFAULTS` rows and the lock**

In `CsLayers.DEFAULTS`, beside the profile rows:

```javascript
    "CTRL-SECTION-BOX": ["gray", "CONTINUOUS", "Weight000"],
    "CTRL-SECTION-OUTLINE": ["gray", "CONTINUOUS", "Weight025"],
    "CTRL-SECTION-SPLAYS": ["gray", "CONTINUOUS", "Weight000"],
    "CTRL-SECTION-STATIONS": ["red", "CONTINUOUS", "Weight025"],
    "CTRL-SECTION-TEXT-LABELS": ["red", "CONTINUOUS", "Weight025"],
    "CTRL-SECTION-SCAN": ["gray", "CONTINUOUS", "Weight000"],
    "SECTION-WALLS": ["white", "CONTINUOUS", "Weight035"],
    "SECTION-WALLS-INFERRED": ["white", "DASHED", "Weight025"],
    "SECTION-CEILING": ["white", "CONTINUOUS", "Weight025"],
    "SECTION-FLOOR": ["white", "CONTINUOUS", "Weight025"],
    "SECTION-BREAKDOWN": ["white", "CONTINUOUS", "Weight000"],
```

and extend the lock registry:

```javascript
CsLayers.LOCKED = { "CTRL-PROFILE-BOX": true, "CTRL-SECTION-BOX": true };
```

- [ ] **Step 6: Teach `frameOf` the third frame**

In `CsLayers.frameOf`, immediately after the profile check and before the `return "plan"`:

```javascript
    // The section frame, both spellings, the same way. CROSS-SECTION-
    // MARKERS does not match either prefix and stays with the plan,
    // which is where the cut mark belongs -- there is a test for that,
    // because a layer later named SECTION-MARKERS would change frames
    // with no other edit.
    if (name.indexOf("CTRL-SECTION-") === 0 || name.indexOf("SECTION-") === 0) {
        return "section";
    }
```

- [ ] **Step 7: Pin the constants in `tests/test_addon.py`**

Following `test_registry_defines_profile_control_layers` exactly:

```python
    def test_registry_defines_section_layers(self):
        """Same mutation gap as the profile control layers: the registry
        comparison never asserts a constant EXISTS, so deleting one
        shrinks both sides and passes. These are the layers the section
        tool draws on and the caver traces on; a missing one means a
        section lands somewhere nobody looks.
        """
        with open(os.path.join(ADDON, "Core", "CsLayers.js")) as fh:
            source = fh.read()
        for constant, layer in [
                ("SECTION_BOX", "CTRL-SECTION-BOX"),
                ("SECTION_OUTLINE", "CTRL-SECTION-OUTLINE"),
                ("SECTION_SPLAYS", "CTRL-SECTION-SPLAYS"),
                ("SECTION_STATIONS", "CTRL-SECTION-STATIONS"),
                ("SECTION_TEXT_LABELS", "CTRL-SECTION-TEXT-LABELS"),
                ("SECTION_SCAN", "CTRL-SECTION-SCAN"),
                ("SECTION_WALLS", "SECTION-WALLS"),
                ("SECTION_WALLS_INFERRED", "SECTION-WALLS-INFERRED"),
                ("SECTION_CEILING", "SECTION-CEILING"),
                ("SECTION_FLOOR", "SECTION-FLOOR"),
                ("SECTION_BREAKDOWN", "SECTION-BREAKDOWN")]:
            self.assertIn('CsLayers.%s = "%s";' % (constant, layer), source)
            self.assertIn('"%s": [' % layer, source)
```

- [ ] **Step 8: Both suites green**

Run: `node tests/js_unit.js` → `### UNIT OK <n> assertions`
Run: `python3 -m unittest discover -s tests` → OK, **except** `test_registry_layers_exist_in_plan_template`, which MUST now fail: the registry has eleven layers the template does not. That failure is the handoff to Task 2 — confirm it names the eleven and move on.

- [ ] **Step 9: Commit**

```bash
git add scripts/CaveSurvey/Core/CsLayers.js tests/js_unit.js tests/test_addon.py && git commit -m "feat(CsLayers): the section frame, its layers and their appearance

Cross sections become the suite's third frame, built like the second:
a generated CTRL- half the tool owns and erases, and an unprefixed half
the caver traces on. CROSS-SECTION-MARKERS stays plan-framed -- it is
the cut mark in the plan, not the section -- and there is a test for
that, because a layer later named SECTION-MARKERS would move frames
with no other edit.

The template test now fails by design; the next commit syncs it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: The template carries them

**Goal:** A fresh drawing offers every section layer in its Layer list, with the right appearance, before anything has been drawn.

**Files:**
- Modify: `templates/NSS_Cave_Template_PLAN.dxf` (via `tools/sync_template_layers.js`)

**Acceptance Criteria:**
- [ ] `test_registry_layers_exist_in_plan_template` passes again, with no exemption added.
- [ ] Every new layer's colour, linetype and lineweight in the template match its `DEFAULTS` row — the sync tool reads `DEFAULTS` through `CsLayers.ensure()` rather than carrying its own copy, so this follows from Task 1 being right.
- [ ] `test_plan_template_has_every_profile_frame_layer` still passes (the profile frame is untouched).

**Verify:** `python3 -m unittest discover -s tests -v` → OK, no failures, no new skips

**Steps:**

- [ ] **Step 1: Read the sync tool's own header**

Read `tools/sync_template_layers.js` for its exact invocation and what it reports. It is the only supported way to put a registry layer in the template — hand-editing the DXF is how the appearance and the registry drift apart.

- [ ] **Step 2: Run it**

Run: `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tools/sync_template_layers.js "$PWD"`
Expected: it reports the eleven layers added to `templates/NSS_Cave_Template_PLAN.dxf`.

- [ ] **Step 3: Confirm the template test recovers**

Run: `python3 -m unittest discover -s tests -v`
Expected: OK. If `test_registry_layers_exist_in_plan_template` still fails, the sync did not write — do NOT add an exemption to the test. The exemption set was deliberately removed once already; re-adding one is how a layer goes missing from the template again.

- [ ] **Step 4: Eyeball the diff**

Run: `git diff --stat templates/NSS_Cave_Template_PLAN.dxf`
Expected: additions only. A sync that rewrote existing layer records has changed something it was not asked to.

- [ ] **Step 5: Commit**

```bash
git add templates/NSS_Cave_Template_PLAN.dxf && git commit -m "feat(templates): the plan template carries the section layers

Universal layers belong in the template -- a fresh drawing's Layer list
should offer them before anything is drawn, not conjure them on first
use. Synced with tools/sync_template_layers.js so their appearance
comes from CsLayers.DEFAULTS rather than a second copy.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Section linework is not bindable YET, and says so

**Goal:** Stop a revision from trying to move hand-traced section linework with plan or profile logic, which would move it wrongly rather than not at all.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsBind.js` (`isLineworkLayer`, `:97-118`)
- Modify: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `CsBind.isLineworkLayer("SECTION-WALLS") === false`, with a comment naming the reason and the condition for removing the exclusion.
- [ ] `CsBind.isLineworkLayer("PROFILE-CEILING") === true` and `isLineworkLayer("WALLS-SURVEYED") === true` — the plan and profile frames are unchanged.
- [ ] `CsBind.isLineworkLayer("CTRL-SECTION-OUTLINE") === false` (already true via the `CTRL-` prefix; asserted so the two reasons do not get confused).

**Verify:** `node tests/js_unit.js` → `### UNIT OK <n> assertions`

**Steps:**

- [ ] **Step 1: Understand why this task exists**

`CsBind.indexStations(frame)` takes `"plan"` or `"profile"` and indexes that frame's station chain. A section frame has ONE station, not a chain, so there is nothing for the existing binding maths to bind against. With section layers registered and no exclusion, `isLineworkLayer("SECTION-WALLS")` returns true and a revision would treat section tracing as plan linework — moving a caver's section by a passage correction that has nothing to do with it. Not binding is correct until sections have their own binding rule; binding wrongly is not.

- [ ] **Step 2: Write the failing test in `tests/js_unit.js`**

In the existing `CsBind` block:

```javascript
    ok(CsBind.isLineworkLayer("SECTION-WALLS") === false,
        "CsBind: section linework is not bindable yet");
    ok(CsBind.isLineworkLayer("SECTION-BREAKDOWN") === false,
        "CsBind: nor is section breakdown");
    ok(CsBind.isLineworkLayer("CTRL-SECTION-OUTLINE") === false,
        "CsBind: generated section geometry is excluded by its prefix");
    ok(CsBind.isLineworkLayer("PROFILE-CEILING") === true,
        "CsBind: the profile frame still binds");
    ok(CsBind.isLineworkLayer("WALLS-SURVEYED") === true,
        "CsBind: the plan frame still binds");
```

- [ ] **Step 3: Run and watch it fail**

Run: `node tests/js_unit.js`
Expected: FAIL on `section linework is not bindable yet` — it returns true today.

- [ ] **Step 4: Add the exclusion**

In `CsBind.isLineworkLayer`, after the prefix loop and before the `CsRevise` check:

```javascript
    // SECTIONS DO NOT BIND YET, and that is a deliberate hold rather
    // than an oversight. CsBind.indexStations takes a frame and indexes
    // its station CHAIN; a section frame has one station and no chain,
    // so there is nothing here for the existing maths to bind against.
    // Returning true would not leave section tracing alone -- it would
    // move it by whatever correction the passage got, which is worse
    // than not moving it at all. Remove this the day sections have a
    // binding rule of their own, together with its test.
    if (typeof CsLayers !== "undefined" &&
            typeof CsLayers.frameOf === "function" &&
            CsLayers.frameOf(name) === "section") {
        return false;
    }
```

- [ ] **Step 5: Run — it must pass**

Run: `node tests/js_unit.js`
Expected: `### UNIT OK <n> assertions`.

- [ ] **Step 6: Full suite**

Run: `./tests/run_all.sh`
Expected: every section OK. The profile-draw round trip exercises binding hardest — if it moved, this exclusion caught more than section layers.

- [ ] **Step 7: Commit**

```bash
git add scripts/CaveSurvey/Core/CsBind.js tests/js_unit.js && git commit -m "fix(CsBind): hold section linework out of binding until it has a rule

indexStations indexes a frame's station chain, and a section frame has
one station and no chain -- so binding section tracing today would move
it by a correction that has nothing to do with it. Not moving it is the
honest answer until sections bind on their own terms.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: The Cross Section group fills with tiles

**Goal:** The Feature Trace group that currently shows a placeholder shows real, armable tiles.

**Files:**
- Modify: `scripts/CaveSurvey/FeatureTrace/FeatureTrace.js` (`FeatureTrace.ROWS`, `:59-70`)
- Modify: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `FeatureTrace.ROWS` gains one entry per traced section layer, using the `CsLayers.*` constants rather than string literals.
- [ ] The Cross Section group renders those tiles and not the placeholder, and the placeholder still appears for a frame with no rows.
- [ ] Clicking a section tile arms that layer — `FeatureTrace.armLayer` is unchanged and frame-agnostic; assert the row's layer is what gets armed.
- [ ] Labels fit the tiles: each goes through `FeatureTrace.wrapLabel` at `CELL_CHARS` as every other tile does.

**Verify:** `node tests/js_unit.js` → `### UNIT OK <n> assertions`, then a live look after Task 5 publishes

**Steps:**

- [ ] **Step 1: Add the rows**

In `FeatureTrace.ROWS`, after the profile entries:

```javascript
    { label: "Walls", layer: CsLayers.SECTION_WALLS },
    { label: "Inferred Walls", layer: CsLayers.SECTION_WALLS_INFERRED },
    { label: "Ceiling", layer: CsLayers.SECTION_CEILING },
    { label: "Floor", layer: CsLayers.SECTION_FLOOR },
    { label: "Breakdown", layer: CsLayers.SECTION_BREAKDOWN }
```

The group builder selects rows by `CsLayers.frameOf(row.layer)`, so nothing else in `FeatureTrace` needs to know sections exist — which is the whole point of the frame answer added in Task 1.

- [ ] **Step 2: Assert the group is populated in `tests/js_unit.js`**

In the existing `FeatureTrace` block:

```javascript
    (function() {
        var sectionRows = 0;
        for (var i = 0; i < FeatureTrace.ROWS.length; i++) {
            if (CsLayers.frameOf(FeatureTrace.ROWS[i].layer) === "section") {
                sectionRows++;
            }
        }
        eqs(sectionRows, 5,
            "FeatureTrace.ROWS: the section frame has its five tiles");
    })();
```

- [ ] **Step 3: Run**

Run: `node tests/js_unit.js`
Expected: `### UNIT OK <n> assertions`.

- [ ] **Step 4: Syntax and full suite**

Run: `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/js_syntax.js "$PWD"` → `### SYNTAX OK`
Run: `./tests/run_all.sh` → every section OK.

- [ ] **Step 5: Commit**

```bash
git add scripts/CaveSurvey/FeatureTrace/FeatureTrace.js tests/js_unit.js && git commit -m "feat(FeatureTrace): the Cross Section group gets its tiles

Five traced section layers, selected into the group by frameOf like
every other row -- FeatureTrace itself needed no knowledge that a third
frame exists, which is what the frame answer bought.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Publish and look at it

**Goal:** The layers are in a real drawing's Layer list and the tiles are real buttons, confirmed on screen rather than inferred.

**Files:**
- Modify: `VERSION` (0.9.20.0 → 0.9.21.0)

**Acceptance Criteria:**
- [ ] `./tests/run_all.sh --publish` passes every section including the publish-only checks.
- [ ] `tools/publish.sh` installs cleanly and the installed `CsLayers.js` contains the section constants.
- [ ] In a restarted CaveCAD on a real cave: the Feature Trace Cross Section group shows five tiles; a new drawing from the template lists every section layer; `CTRL-SECTION-BOX` is locked.
- [ ] Arming a section tile and tracing lands geometry on that layer.

**Verify:** `./tests/run_all.sh --publish` → no `did not pass`, then the live checks above

**Steps:**

- [ ] **Step 1: Bump the version**

```bash
printf '0.9.21.0\n' > VERSION
```

Hold at 0.9.X, patch series, until a public release is approved.

- [ ] **Step 2: Full suite with publish checks**

Run: `./tests/run_all.sh --publish`
Expected: every section OK. The publish-only checks cover toolbar icons and status tips; nothing here adds a tool, so they should be unaffected.

- [ ] **Step 3: Publish**

Run: `./tools/publish.sh`
Then: `grep -c 'CTRL-SECTION-BOX' ~/Library/Application\ Support/QCAD/CaveCAD/scripts/CaveSurvey/Core/CsLayers.js`
Expected: non-zero — the installed copy, not just the repo.

- [ ] **Step 4: Look at it, in a restarted CaveCAD**

Quit CaveCAD completely, restart, then check each of the four live criteria above. The MCP bridge (`cavecad_eval`, `cavecad_screenshot`) drives this without leaving the session if it is enabled; otherwise it is an eyes-on check.

- [ ] **Step 5: Commit**

```bash
git add VERSION && git commit -m "chore: 0.9.21.0 -- cross sections have their layers

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Out of scope, named so they stay out

- The section generator itself (`CsSection`, `CsSectionDraw`, `CsSectionBox`, the Cross Section tool) — `docs/superpowers/specs/2026-08-29-cross-section-design.md`, still unapproved with four open questions.
- Where section frames sit on the sheet. Decided in conversation (a grid below the elevation) but not built, and not needed for layers.
- Per-section layer variants. `CsLayerVariants` generalises to a section token for free — token last, so `frameOf` and the `CTRL-` binding gate both keep working — but nothing needs it until sections can be traced into individually.
- Binding section linework (Task 3 holds it out deliberately).
- `PROFILE-PROJECTED`, which stays empty for the future projected view.
