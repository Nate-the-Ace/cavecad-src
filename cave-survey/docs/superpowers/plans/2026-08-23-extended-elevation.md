# Extended Elevation Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate an extended elevation (developed profile) of the survey into a sibling `<plan>-PROFILE.dxf`, with floor and ceiling lines derived from LRUD and splays, refreshed automatically by every plan draw.

**Architecture:** Three new Core files. `CsProfile.js` is pure — station-name parsing, run grouping, run hierarchy from the shot graph, unroll math, band layout, floor/ceiling run construction — and is unit-tested under both node and CaveCAD's engine. `CsProfileDraw.js` draws a built profile into an explicitly passed `(doc, di)` pair, so it can target a document that is not the current one. `CsProfileFile.js` resolves the sibling document: an already-open tab if there is one, otherwise an off-screen document built from the PROFILE template and exported to disk. `CsDraw.survey` gains one gated call at its end.

**Tech Stack:** QCAD/CaveCAD ECMAScript add-on (ECMAScript 5 dialect — `var` only, no arrow functions, no `let`/`const`, no template literals). Tests: `tests/js_unit.js` (runs under node AND `CaveCAD -no-gui`), `tests/test_addon.py` (Python stdlib, structural), `tests/run_all.sh` (everything).

**User decisions (already made):**
- Extended elevation, not a projected profile. Projected profile stays out of scope.
- Its own file, not the plan drawing and not a block: "it needs to be its own file because we're going to sketch on it as well and all the warping that plan view gets needs to also happen with profiles".
- Auto-regenerated on every draw, no separate command in the normal path.
- Sketched linework must MOVE with the survey, not merely survive: "why can we not move all the linework just like we do with the plan view?"
- Reuse `CsRevise.similarityFit` unchanged, rotation included, rather than a profile-specific fit.
- One profile per survey run, stacked: "all of 'A' survey gets a profile, then 'B' gets one place under that and so on".
- Runs keyed on station name prefix.
- Bands at true elevation with their own X origin.
- Splays feed floor/ceiling by sign of inclination with a near-horizontal dead zone.
- Generated lines on a new `CTRL-` pair; `PROFILE-FLOOR`/`PROFILE-CEILING` left for tracing.
- Spur naming: "A spur is signified by the lowercase letter in the name and it ties to the uppercase station name" — `A13a1`, `A13a2`, tying in at `A13`.
- A spur long enough to matter is promoted by the surveyor to its own letter run (`B1`); no length heuristic in code.

**Spec:** `docs/superpowers/specs/2026-08-23-extended-elevation-design.md`

---

## File Structure

| File | Responsibility |
| --- | --- |
| `scripts/CaveSurvey/Core/CsProfile.js` (new) | Pure. Name parsing, run grouping, hierarchy, chain finding, unroll, band layout, floor/ceiling runs. No `R*` at file scope. |
| `scripts/CaveSurvey/Core/CsProfileDraw.js` (new) | QCAD context. Draws a built profile into an explicit `(doc, di)`; tags; tagged erase. |
| `scripts/CaveSurvey/Core/CsProfileFile.js` (new) | QCAD context. Sibling path, open-tab lookup, off-screen create from template, export, reveal. |
| `scripts/CaveSurvey/Core/CsProfileBind.js` (new) | QCAD context. Binds sketched profile linework to run-qualified stations so a regeneration MOVES it, reusing `CsBind`'s inference and `CsRevise.moveLinework`. |
| `scripts/CaveSurvey/Core/CsLayers.js` | Two new layer constants + defaults. |
| `scripts/CaveSurvey/Core/CsDraw.js` | One gated call at the end of `survey()`. |
| `scripts/CaveSurvey/Core/CsReport.js` | `CsReport.profileSummary`. |
| `scripts/CaveSurvey/GenerateProfile/GenerateProfile.js` + `.svg` (new) | Menu tool: force a rebuild, print the report. |
| `templates/NSS_Cave_Template_PROFILE.dxf` | Gains `CTRL-PROFILE-FLOOR`, `CTRL-PROFILE-CEILING`, `CTRL-LRUD`, `CTRL-SPLAYS`. |
| `tools/add_profile_layers.js` (new) | One-shot, idempotent, adds those layers to the template. |
| `tests/js_unit.js` | Loads `CsProfile.js`; unit tests for every pure function. |
| `tests/test_addon.py` | Scopes the registry/template check; adds a PROFILE-template check. |
| `README.md` | One row in the tool table (a structural test fails without it). |

`CsProfile.js` is deliberately separate from `CsDraw.js` (already 1060 lines) and from the file/tab plumbing, which is the one part that cannot be exercised headlessly.

---

## A note on the history of this branch

Commit `423f9c8`, whose message reads "docs: three tool-wiring facts the Task 10 brief missed",
ALSO contains Task 8's erase-scope fix — 104 lines of `Core/CsProfileDraw.js` and 250 of
`tests/profile_draw_roundtrip.js`. The message is wrong about its own contents.

Cause, recorded because it is a trap anyone running parallel agents in one checkout will hit:
several agents were editing disjoint files concurrently, but they share ONE git index. An agent
had staged its work with `git add`; a `git commit` issued elsewhere with no pathspec then committed
the whole index, sweeping those files into an unrelated commit. The content was verified
byte-identical to what the agent intended and the suite was green at that commit, so nothing is
corrupt — only mislabelled, and the history is not rewritten to hide it.

The fix, applied from that point on: always `git commit -m "..." -- <paths>`, never a bare
`git commit`, whenever more than one writer is active. Better still, serialise writers.

## Conventions every task must follow

Learned the hard way in this repo; violating any of these produces a silent failure, not an error.

- **ECMAScript 5 only.** `var`, `function`, string concatenation. No `let`, `const`, arrow functions, template literals, `Object.assign`, or trailing commas in literals. Both engines are ES5.
- **`Cs` prefix on every Core file**, matching its global. QCAD's `include()` dedupes by BASENAME, so a file named `Profile.js` would be silently skipped. Enforced by a structural test.
- **Off layers refuse every operation** — adds, modifies AND deletes — silently. Anything touching a layer that may be off wraps the work in `CsLayers.withLayerOn(doc, di, name, fn)`.
- **Never default a missing Z to 0.** That silently rebases a cave surveyed to an absolute datum. If a station has no resolved Z, skip it and report it.
- **All text through `CsDraw.addText`**, which capitalises via `CsDraw.caps`. Never capitalise model data.
- **Tag writes via `CsTags.set`**, never `setCustomProperty` directly.
- **Every tool includes BOTH `scripts/EAction.js` AND `scripts/simple.js`.** `getDocument()`,
  `getMainWindow()` and `warning()` all live in `simple.js`, and every shipped tool in this suite
  includes it. Omitting it produces a tool whose globals are undefined depending on load order —
  no error, just a tool that does not work. Also: guard-clause failures use the plain `warning()`
  global (every native tool does), and `QMessageBox.*` takes `getMainWindow()`, not
  `RMainWindowQt.getMainWindow()` — that longer form is for `init()`'s `RGuiAction` only.
- **A TOOL THAT REPORTS ON EXISTING GEOMETRY MUST RESOLVE UNDER THE DRAWING'S OWN ADJUSTMENT
  TAGS**, via `CsAdjust.resolveAndAdjust` with `CsAdjust.optionsFromTags(...)` read off the trip-0
  anchor — the pattern `SurveyStats` already uses and documents. A bare `CsNetwork.resolve` would
  re-solve under today's global settings, so a manually forced profile would disagree with the
  automatically drawn one on any survey with loop closures. Every caller of `CsDraw.survey`
  already resolves-and-adjusts, so the automatic path is adjusted; the manual path must match.
- **NO TOOL'S `run()` IS EXERCISED BY THE SUITE.** `js_unit.js` loads only `Core/`, and
  `test_addon.py` greps source text. So a tool's runtime path — reading the drawing, choosing the
  document, showing the report — is verified by reading unless a task adds a headless script that
  drives it, in the shape of `tests/profile_file_roundtrip.js`. This repo's own history says
  reading is not enough: `include()` basename dedupe and the edition-folder path both shipped as
  "undefined in the GUI while every test passed".
- **`EAction.handleUserMessage` cannot show multi-line text** (newlines collapse). Multi-line output uses `QMessageBox.information`.
- **`CsNetwork.resolve` now reports `anchorZUnknown`.** Closing the sixth elevation-datum door
  meant deciding what an anchor with no elevation DOES. It anchors without one (`z = null`) and
  says so, rather than refusing — refusing would discard the anchor's x/y as well, and that
  file's own comment calls "the caller knows only a plan position" the common case, not an edge
  case. `null` is also already the vocabulary `CsProfile` uses for "no resolved Z". NOT yet
  propagated: a descendant station's `fs.z + of.dz` still treats a null anchor z as 0, which is
  the same larger task as the unguarded non-splay `offset` callers.
- **`.seq` IS NOT WALK ORDER FOR ANCHORED STATIONS.** `CsNetwork.seedFixed` places every
  fixed / `#Fix` / `*fix` station up front, before any traversal, deliberately. So a fixed
  station's low `.seq` records SEEDING, not walking. Any rule of the form "the earlier-seq
  station was already on the ground when this leg was walked" is therefore true only for
  `kind === "new"` legs. For `closure` and `tie` legs BOTH ends were already placed and
  `.seq` carries no parent information at all. Established the hard way in the Task 2
  review, on a two-fixed-entrance cave — the everyday case — where the trunk was adopted
  by a side passage and two runs claimed each other as parent. Every later task that
  reasons from `.seq` must be checked against a multi-anchor survey, not just a
  single-entrance one.
- **CaveCAD's `Array.prototype.sort` is UNSTABLE.** Measured in the Task 1 quality review: a comparator returning 0 for 24 equal elements scrambled them, while node (stable) left them alone. So a comparator that can return 0 for two DISTINCT items produces geometry that differs between engines — and the node tests will never see it. Every comparator in this feature must be a total order: break every tie on something unique (text, index, station name).

Run `./tests/run_all.sh` before every commit. Baseline at plan time: 42/42 files parsed, 2008 assertions, all green.

- **NO BUNDLED `ok()` WITH SUBSTRING MATCHING.** A review found a report assertion that passed
  because text from an ENTIRELY DIFFERENT feature happened to contain the substrings it
  searched for — deleting the line under test changed nothing. `tests/js_unit.js` documents this
  in its own `eqs` docblock; the rule is now explicit. Assert exact strings, one assertion each.
- **MUTATION-TEST `CsDraw` AND `CsReport` UNDER CaveCAD, NOT NODE.** `CsDraw.js` is not loaded
  under node at all, so a node-only mutation round cannot touch it — and 5 of the 7 surviving
  mutations in one review lived exactly there. Any task touching those files must run its
  mutation round in CaveCAD's engine and say that it did.
- **A RISING ASSERTION COUNT IS NOT COVERAGE.** Measured on this feature: Task 3's review
  mutated 18 behaviours and 11 survived a fully green suite; Task 4's mutated 34 and only 14
  died to a named assertion — 41%, including the total-order tiebreak the unstable-sort
  convention exists to protect. For every acceptance criterion: DELETE the behaviour, run the
  suite, confirm a NAMED test fails, and report which mutation each test kills. A test that
  survives its own mutation is decoration, and a predicted assertion delta (Task 4's brief
  said +16, it delivered +25) verifies nothing.
- **DECLARE EVERY DELIBERATE DIVERGENCE FROM PLAN VIEW.** These functions mirror plan-view
  equivalents in `CsLrud`, and the mirroring is never total. Task 4 diverged twice — admitting
  an along-axis splay that plan excludes as centerline (correct: in elevation it is still real
  vertical evidence) and handling closure walls differently (a defect) — while its docblock
  asserted parity in prose. Any task mirroring a plan-view rule must list, in its report AND
  in the code comment, every deliberate difference and why. An unstated divergence reads as a
  bug; a false claim of parity hides a real one.

---

## Task 1: Station name parsing and run grouping

**Goal:** Pure functions that split a station name into run key and sequence, derive a spur's tie station from its name, and group a resolved survey's stations into runs.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsProfile.js`
- Modify: `tests/js_unit.js` (add to `CORE_FILES` after `CsLrud.js`; append test block)

**Acceptance Criteria:**
- [ ] `A20` → run `A`, seq `20`; `A13a1` → run `A13a`, seq `1`; `A13a2b1` → run `A13a2b`, seq `1`; `B1` → run `B`, seq `1`
- [ ] A single-group name (`A`, `12`) keys its own run key and carries no sequence, so it JOINS the run its name is the base of and leads it — a bare `A` is run `A`'s origin station and sorts before `A1`
- [ ] `tieNameOfRun` returns `A13` for run `A13a`, `A13a2` for run `A13a2b`, and `null` for run `A` or `B`
- [ ] Splay names (`A3.1`) are refused by the parser, not misread as stations
- [ ] `groupRuns` returns runs whose members are ordered numerically when sequences are numeric, lexically otherwise
- [ ] Runs are keyed by run key with no station appearing in two runs

**Verify:** `node tests/js_unit.js` → `### UNIT OK <n> assertions`, up 19 from the node baseline of 1052. Note the two engines report DIFFERENT totals — node 1052, CaveCAD 2008 at plan time — because `js_unit.js` guards some blocks with `if (!IS_NODE)`. Compare each engine against its own baseline; a count from one engine says nothing about the other.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `tests/js_unit.js`, before the final summary print:

```javascript
// ---------------------------------------------------------------------
// CsProfile -- name parsing and run grouping
// ---------------------------------------------------------------------

(function() {
    var s = CsProfile.splitName("A20");
    ok(s !== null && s.base === "A" && s.seq === "20", "A20 splits A + 20");
    s = CsProfile.splitName("A13a1");
    ok(s !== null && s.base === "A13a" && s.seq === "1", "A13a1 splits A13a + 1");
    s = CsProfile.splitName("A13a2b1");
    ok(s !== null && s.base === "A13a2b" && s.seq === "1",
        "A13a2b1 splits A13a2b + 1");
    s = CsProfile.splitName("B1");
    ok(s !== null && s.base === "B" && s.seq === "1", "B1 splits B + 1");

    // one group only: the whole name is the base and there is no
    // sequence, so the station JOINS run A as its origin -- it does not
    // become a run of its own
    s = CsProfile.splitName("A");
    eqs(sn(CsProfile.splitName("A")), "A|", "bare A carries no sequence");

    // a splay name is not a station name
    ok(CsProfile.splitName("A3.1") === null, "splay name refused");
    ok(CsProfile.splitName("") === null, "empty name refused");
    ok(CsProfile.splitName(null) === null, "null name refused");

    ok(CsProfile.runKeyOf("A13a1") === "A13a", "runKeyOf A13a1");
    ok(CsProfile.runKeyOf("A20") === "A", "runKeyOf A20");

    ok(CsProfile.tieNameOfRun("A13a") === "A13", "A13a ties A13");
    ok(CsProfile.tieNameOfRun("A13a1") === null,
        "fed a station name instead of a run key, it refuses");
    ok(CsProfile.tieNameOfRun("A13a2b") === "A13a2", "A13a2b ties A13a2");
    ok(CsProfile.tieNameOfRun("A") === null, "letter run has no name-derived tie");
    ok(CsProfile.tieNameOfRun("B") === null, "B has no name-derived tie");
}());

(function() {
    // A1-A3 with a spur off A2, plus a letter run off A3
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("A2", "A3", 10, 0, 0),
        shotOf("A2", "A2a1", 5, 90, 0),
        shotOf("A2a1", "A2a2", 5, 90, 0),
        shotOf("A3", "B1", 8, 45, 0),
        shotOf("B1", "B2", 8, 45, 0)
    ];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);

    ok(g.order.length === 3, "three runs found");
    ok(g.runs["A"].stations.join(",") === "A1,A2,A3", "run A members ordered");
    ok(g.runs["A2a"].stations.join(",") === "A2a1,A2a2", "spur run members");
    ok(g.runs["B"].stations.join(",") === "B1,B2", "letter run members");

    // numeric ordering, not lexical: A10 must follow A9
    var sv2 = CsModel.newSurvey();
    sv2.shots = [
        shotOf("A9", "A10", 10, 0, 0),
        shotOf("A10", "A11", 10, 0, 0)
    ];
    var g2 = CsProfile.groupRuns(CsNetwork.resolve(sv2, {}));
    ok(g2.runs["A"].stations.join(",") === "A9,A10,A11",
        "numeric sequence ordering, not lexical");
}());
```

Add `"scripts/CaveSurvey/Core/CsProfile.js"` to `CORE_FILES` immediately after the `CsLrud.js` entry (CsProfile reads `CsLrud.relativeBearing` and `CsTraverse`, both loaded earlier).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tests/js_unit.js`
Expected: FAIL — `cannot open .../CsProfile.js` from `loadRepoScript`.

- [ ] **Step 3: Write the implementation**

Create `scripts/CaveSurvey/Core/CsProfile.js`:

```javascript
// CsProfile.js -- the extended elevation: unrolling a survey onto one
// horizontal axis, and the floor and ceiling lines that go with it.
//
// Part of the Cave Survey Core library: pure functions. Nothing here
// touches a document, so the whole module runs under plain node.
//
// AN EXTENDED ELEVATION IS NOT A PROJECTED PROFILE. The horizontal
// axis is distance travelled along the passage, so no passage hides
// behind another and every leg draws at its true length. A projected
// profile -- real coordinates flattened onto one vertical plane -- is
// a different tool and writes to a different layer.
//
// ONE BAND PER SURVEY RUN, and a run is decided by the STATION NAME,
// because that is where the surveyor's own intent already lives. Split
// a name into alternating letter and digit groups; the run key is
// every group but the last, the sequence within the run is the last:
//
//   A20       -> run A,        seq 20
//   A13a1     -> run A13a,     seq 1     (a spur, tying in at A13)
//   A13b1     -> run A13b,     seq 1     (a second spur off A13)
//   A13a2b1   -> run A13a2b,   seq 1     (a spur off a spur)
//   B1        -> run B,        seq 1
//
// A lowercase group means a spur, and dropping it gives the station it
// ties to. A spur long enough to deserve promotion becomes its own
// letter run (B1, B2, ...) -- the surveyor's decision, made by typing
// a name. THERE IS NO LENGTH THRESHOLD ANYWHERE IN THIS FILE.
//
// Names decide MEMBERSHIP; the shot GRAPH decides ORDER. A run's
// parent is the run owning the station its first leg ties to. That is
// what makes A13a1 and B1 behave identically -- A13a lands under A
// because its tie station is A13, not because its name looks nested.

var CsProfile = {};

/**
 * Splits a station name into {base, seq} on its trailing group of
 * like characters. Returns null for anything that is not a station
 * name: empty, null, or a splay (which carries a dot).
 *
 * A name with only one group (e.g. "A", "12") has the whole name as its
 * base and no sequence. It therefore JOINS the run its name keys -- a
 * bare "A" is run A's origin station -- and an empty sequence sorts
 * first, because an origin leads its run. Pretending the single group
 * were a sequence instead would put "A" and "B" in one nameless run.
 */
CsProfile.splitName = function(name) {
    if (name === undefined || name === null) {
        return null;
    }
    var s = String(name);
    if (s === "" || s.indexOf(".") >= 0) {
        return null;   // splays are named A3.1 and are not stations
    }
    // groups of digits, of lowercase, of uppercase, or of anything else
    var groups = s.match(/[0-9]+|[a-z]+|[A-Z]+|[^0-9a-zA-Z]+/g);
    if (groups === null || groups.length === 0) {
        return null;
    }
    if (groups.length === 1) {
        return { base: s, seq: "" };
    }
    var seq = groups[groups.length - 1];
    return { base: s.substring(0, s.length - seq.length), seq: seq };
};

/** The run a station belongs to, or null when the name is not one. */
CsProfile.runKeyOf = function(name) {
    var s = CsProfile.splitName(name);
    return (s === null) ? null : s.base;
};

/**
 * The station a run ties in at, read from its own key: drop a
 * trailing lowercase group. "A13a" -> "A13"; "A13a2b" -> "A13a2".
 * null for a letter run (B, A), which has no name-derived tie and
 * must get its parent from the graph.
 *
 * TAKES A RUN KEY, NOT A STATION NAME -- hence the name. Fed a station
 * name it returns null (no trailing lowercase group), which is the
 * same value that legitimately means "letter run, ask the graph", so
 * the mistake would look like an answer. Read call sites as
 * tieNameOfRun(runKeyOf(name)).
 */
CsProfile.tieNameOfRun = function(runKey) {
    if (runKey === undefined || runKey === null) {
        return null;
    }
    var s = String(runKey);
    var m = s.match(/[a-z]+$/);
    if (m === null) {
        return null;
    }
    var tie = s.substring(0, s.length - m[0].length);
    return (tie === "") ? null : tie;
};

/**
 * Sort key for a sequence: numeric sequences compare as numbers so
 * A10 follows A9, everything else compares as text.
 */
CsProfile.seqOrder = function(a, b) {
    var na = /^[0-9]+$/.test(a), nb = /^[0-9]+$/.test(b);
    if (na && nb) {
        return parseInt(a, 10) - parseInt(b, 10);
    }
    if (na !== nb) {
        return na ? -1 : 1;   // numbered stations before lettered ones
    }
    return (a < b) ? -1 : ((a > b) ? 1 : 0);
};

/**
 * Groups a resolved survey's stations into runs.
 *
 * \param resolved CsNetwork.resolve() result
 * \return {
 *   runs:  {runKey: {key, stations: [name] in sequence order}},
 *   order: [runKey] in first-appearance order (resolution order),
 *   ungrouped: [name] station names that are not parseable
 * }
 */
CsProfile.groupRuns = function(resolved) {
    var runs = {}, order = [], ungrouped = [];
    var names = [];
    for (var n in resolved.stations) {
        if (resolved.stations.hasOwnProperty(n)) {
            names.push(n);
        }
    }
    // resolution order, so run order follows the survey rather than
    // whatever order the engine hands properties back in
    names.sort(function(a, b) {
        return resolved.stations[a].seq - resolved.stations[b].seq;
    });

    for (var i = 0; i < names.length; i++) {
        var key = CsProfile.runKeyOf(names[i]);
        if (key === null) {
            ungrouped.push(names[i]);
            continue;
        }
        if (!runs.hasOwnProperty(key)) {
            runs[key] = { key: key, stations: [] };
            order.push(key);
        }
        runs[key].stations.push(names[i]);
    }

    for (var k = 0; k < order.length; k++) {
        runs[order[k]].stations.sort(function(a, b) {
            return CsProfile.seqOrder(CsProfile.splitName(a).seq,
                CsProfile.splitName(b).seq);
        });
    }

    return { runs: runs, order: order, ungrouped: ungrouped };
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tests/js_unit.js`
Expected: PASS — `### UNIT OK` with the assertion count risen by 19.

Then confirm the other engine agrees:

```bash
/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/js_unit.js "$PWD"
```

Expected: the same `### UNIT OK` line.

- [ ] **Step 5: Commit**

```bash
git add scripts/CaveSurvey/Core/CsProfile.js tests/js_unit.js
git commit -m "feat(CsProfile): station names decide which survey run a station is in"
```

---

## Task 2: Run hierarchy from the shot graph

**Goal:** Decide each run's parent, its tie station, and the band order, from the shot graph — with the name-derived tie used only as a cross-check whose disagreement is reported.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsProfile.js`
- Modify: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `adjacency` maps each station to its non-splay, non-closure legs — this is the WALKED-CHAIN graph, consumed by Task 3's chain search
- [ ] `hierarchy` builds its own contact graph instead of using `adjacency`: closure and tie legs DO count as contacts, because a run that touches its parent a second time through a ring must be able to report it
- [ ] Contacts are DIRECTIONAL: a cross-run leg counts only when the other station was resolved earlier (`.seq`) than the run's own station. Without this a root run adopts its own child as parent
- [ ] A spur's parent run and tie station come from the graph
- [ ] When the graph tie disagrees with the name-derived tie, the graph wins and a mismatch record is returned
- [ ] A run touching another run at two stations reports the second as a `secondTie`, whose `otherRun` is the run touched — NOT necessarily the parent, since a second contact can land in a third run
- [ ] The junction is the earliest contact by LEG, ranked new-legs-before-closure/tie — not the earliest-resolved station. The two coincide on a simple fixture and diverge in general, and the leg rule is the correct one: it is where the run was walked in from
- [ ] The first run (no tie at all) is the root; band order is depth-first, siblings ordered by junction distance along the parent
- [ ] The primary root is found by WALKING THE PARENT CHAIN UP from `grouped.order[0]` — never by position in run order. Position is not rootness: `grouped.order[0]`'s own run can acquire a parent (two fixed entrances, six shots, fully connected), and then the real root is reported as disconnected. 535 of 6000 random surveys hit that condition, and this output reaches the user as "orphan runs", telling a surveyor a connected passage is not connected
- [ ] `orphans` means PHYSICALLY DISCONNECTED and nothing else, decided by a raw union-find over every leg in `resolved.legs` regardless of kind, independent of the kind-ranked parent forest. A parentless run that raw connectivity shows IS part of the same cave belongs in a separate `strandedRoots` field. The two demand different actions: "orphan" tells a surveyor to go shoot a connecting leg, which is wrong and wasteful advice for a run whose data is already fine and which merely never got attached as anyone's child
- [ ] A cycle in the parent map — reachable from ordinary data, e.g. a side passage that rejoins where the trunk is numbered onward from the branch — is broken in favour of the earliest-started run, the discarded contact is demoted to a `secondTie`, and the cycle is reported in a `cycles` field. `bandOrder` keeps its own cycle guard as a backstop, so every run is emitted exactly once regardless
- [ ] A named spur whose graph gives it NO contact is reported as a mismatch (expected station from the name, actual `null`) rather than silently treated as a root

**Verify:** `node tests/js_unit.js` → `### UNIT OK` with count risen; no failures

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `tests/js_unit.js`:

```javascript
(function() {
    // A1-A4; spur A2a1-A2a2 off A2; letter run B off A3; B rejoins A4
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("A2", "A3", 10, 0, 0),
        shotOf("A3", "A4", 10, 0, 0),
        shotOf("A2", "A2a1", 5, 90, 0),
        shotOf("A2a1", "A2a2", 5, 90, 0),
        shotOf("A3", "B1", 8, 45, 0),
        shotOf("B1", "A4", 8, 315, 0)
    ];
    var r = CsNetwork.resolve(sv, {});
    var h = CsProfile.hierarchy(CsProfile.groupRuns(r), r);

    ok(h.parents["A"] === null, "A is the root run");
    ok(h.parents["A2a"] === "A", "spur A2a hangs off A");
    ok(h.ties["A2a"] === "A2", "spur A2a ties at A2");
    ok(h.parents["B"] === "A", "letter run B hangs off A");
    ok(h.ties["B"] === "A3", "B ties at the earlier of its two A contacts");
    ok(h.secondTies.length === 1 && h.secondTies[0].run === "B",
        "B's second contact reported -- it arrives through the closure leg");
    ok(h.parents["A2a"] !== undefined && h.parents["A"] === null,
        "a root run does not adopt its own child as parent");
    ok(h.mismatches.length === 0, "no name/graph mismatch here");
    ok(h.order[0] === "A", "root band first");
    ok(h.order.indexOf("A2a") < h.order.indexOf("B"),
        "siblings ordered by junction distance along the parent");
}());

(function() {
    // the spur's name says A13, its first leg really comes off A14
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A13", "A14", 10, 0, 0),
        shotOf("A14", "A13a1", 5, 90, 0)
    ];
    var r = CsNetwork.resolve(sv, {});
    var h = CsProfile.hierarchy(CsProfile.groupRuns(r), r);

    ok(h.ties["A13a"] === "A14", "graph tie wins over the name");
    ok(h.mismatches.length === 1, "mismatch reported");
    ok(h.mismatches[0].run === "A13a" &&
        h.mismatches[0].expected === "A13" &&
        h.mismatches[0].actual === "A14", "mismatch names both stations");
}());
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tests/js_unit.js`
Expected: FAIL — `CsProfile.hierarchy is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `scripts/CaveSurvey/Core/CsProfile.js`:

```javascript
/**
 * Station -> the legs that touch it, closures and splays excluded.
 * THE WALKED-CHAIN GRAPH: its consumer is the chain search that lays
 * out a band (CsProfile.longestChain), which resolves each step through
 * CsProfile.legBetween -- and that skips closures. Letting a closure in
 * here would let a chain include a step legBetween cannot resolve, and
 * the band would stop at it.
 *
 * Run hierarchy does NOT use this graph; it builds its own from
 * resolved.legs, closures included, because a second contact through a
 * ring is exactly the thing it has to report. See hierarchy().
 *
 * \return {stationName: [{leg, other, seq}]} seq = leg index, so
 *         "which contact came first" is answerable
 */
CsProfile.adjacency = function(resolved) {
    var adj = {};
    var add = function(at, other, leg, seq) {
        if (!adj.hasOwnProperty(at)) {
            adj[at] = [];
        }
        adj[at].push({ leg: leg, other: other, seq: seq });
    };
    for (var i = 0; i < resolved.legs.length; i++) {
        var leg = resolved.legs[i];
        if (leg.kind === "closure") {
            continue;
        }
        if (leg.shot !== undefined && leg.shot !== null && leg.shot.splay) {
            continue;
        }
        add(leg.from, leg.to, leg, i);
        add(leg.to, leg.from, leg, i);
    }
    return adj;
};

/**
 * Which run each run hangs off, where it ties in, and what order the
 * bands go in.
 *
 * The parent is decided by the GRAPH: of all legs leaving this run's
 * stations to a station in another run, the earliest-resolved one
 * gives the tie station and the parent run. The name-derived tie
 * (CsProfile.tieNameOfRun) is used only as a cross-check -- when the two
 * disagree the graph wins, because it is the measured fact, and the
 * disagreement is reported as a likely naming blunder.
 *
 * \param grouped CsProfile.groupRuns() result
 * \param resolved CsNetwork.resolve() result
 * \return {
 *   parents:    {runKey: parentRunKey | null},
 *   ties:       {runKey: stationName | null},
 *   order:      [runKey] depth first, siblings by junction distance,
 *   secondTies: [{run, otherStation, otherRun}] further contacts -- otherRun
 *               is the run TOUCHED, not necessarily the parent: a second
 *               contact can land in a third run,
 *   mismatches: [{run, expected, actual}] name vs graph,
 *   orphans:    [runKey] runs with no determinable parent
 * }
 */
CsProfile.hierarchy = function(grouped, resolved) {
    var adj = CsProfile.adjacency(resolved);
    var parents = {}, ties = {}, secondTies = [], mismatches = [];
    var orphans = [];
    var runOf = {};
    var i, k;

    for (i = 0; i < grouped.order.length; i++) {
        var run = grouped.runs[grouped.order[i]];
        for (k = 0; k < run.stations.length; k++) {
            runOf[run.stations[k]] = run.key;
        }
    }

    // CONTACTS USE A DIFFERENT GRAPH FROM adjacency(), deliberately.
    // Closure and tie legs count here: a closure is a real surveyed
    // shot, and a run that touches its parent a second time through a
    // ring (B1-A4 closing B1-A3-A4) has to be able to report that
    // second contact -- excluded, secondTies can never populate at all.
    // adjacency() stays closure-free because ITS consumer is the chain
    // search, which resolves each step through CsProfile.legBetween --
    // and that skips closures too, so a chain routed through a leg
    // legBetween cannot find would truncate its own band.
    var contactLegs = [];
    for (i = 0; i < resolved.legs.length; i++) {
        var cl = resolved.legs[i];
        if (cl.shot !== undefined && cl.shot !== null && cl.shot.splay) {
            continue;
        }
        contactLegs.push({ from: cl.from, to: cl.to, seq: i });
    }

    var seqOf = function(name) {
        var st = resolved.stations[name];
        return (st === undefined || st === null || st.seq === undefined ||
            st.seq === null) ? Number.MAX_VALUE : st.seq;
    };

    for (i = 0; i < grouped.order.length; i++) {
        var key = grouped.order[i];
        var stations = grouped.runs[key].stations;
        var inRun = {};
        for (k = 0; k < stations.length; k++) {
            inRun[stations[k]] = true;
        }
        var contacts = [];
        for (k = 0; k < contactLegs.length; k++) {
            var cg = contactLegs[k];
            var mine = null, other = null;
            if (inRun[cg.from] === true) {
                mine = cg.from;
                other = cg.to;
            } else if (inRun[cg.to] === true) {
                mine = cg.to;
                other = cg.from;
            } else {
                continue;
            }
            var otherRun = runOf[other];
            if (otherRun === undefined || otherRun === key) {
                continue;
            }
            // DIRECTION MATTERS, and getting it wrong inverts the whole
            // hierarchy. A2 is adjacent to A2a1, so a symmetric scan
            // makes run A -- the root -- adopt its own child A2a as its
            // parent. The parent side is the station that was already on
            // the ground when this leg was walked, and resolution order
            // is exactly that record.
            if (seqOf(other) >= seqOf(mine)) {
                continue;
            }
            contacts.push({
                station: other,
                parentRun: otherRun,
                seq: cg.seq
            });
        }
        // seq here is the leg's index in resolved.legs, unique per leg,
        // and one leg cannot contribute two contacts to the same run
        // (both endpoints in this run is skipped above) -- so this
        // comparator can never return 0 for distinct entries, which is
        // required of every comparator here: this engine's sort is not
        // stable.
        contacts.sort(function(a, b) { return a.seq - b.seq; });

        if (contacts.length === 0) {
            // the root run, or a run in its own disconnected component
            parents[key] = null;
            ties[key] = null;
            if (i > 0) {
                orphans.push(key);
            }
            continue;
        }

        parents[key] = contacts[0].parentRun;
        ties[key] = contacts[0].station;
        for (k = 1; k < contacts.length; k++) {
            if (contacts[k].station === contacts[0].station) {
                continue;   // the same junction reached twice, not a second tie
            }
            secondTies.push({
                run: key,
                otherStation: contacts[k].station,
                parentRun: contacts[k].parentRun
            });
        }

        var expected = CsProfile.tieNameOfRun(key);
        if (expected !== null && expected !== ties[key]) {
            mismatches.push({
                run: key,
                expected: expected,
                actual: ties[key]
            });
        }
    }

    return {
        parents: parents,
        ties: ties,
        order: CsProfile.bandOrder(grouped, parents, ties, resolved),
        secondTies: secondTies,
        mismatches: mismatches,
        orphans: orphans
    };
};

/**
 * Depth-first band order. Siblings are ordered by how far along their
 * parent they tie in, measured by the tie station's resolution order
 * (seq) -- along-distance itself is not known until the parent has
 * been unrolled, and seq is monotone along a chain, so it gives the
 * same answer without the circular dependency.
 *
 * A run whose parent never gets placed (a disconnected component) is
 * appended at the end rather than dropped.
 */
CsProfile.bandOrder = function(grouped, parents, ties, resolved) {
    var children = {}, roots = [];
    var i, key;

    for (i = 0; i < grouped.order.length; i++) {
        key = grouped.order[i];
        var p = parents[key];
        if (p === null || p === undefined || !grouped.runs.hasOwnProperty(p)) {
            roots.push(key);
            continue;
        }
        if (!children.hasOwnProperty(p)) {
            children[p] = [];
        }
        children[p].push(key);
    }

    var seqOfTie = function(runKey) {
        var t = ties[runKey];
        if (t === null || t === undefined ||
                !resolved.stations.hasOwnProperty(t)) {
            return Number.MAX_VALUE;
        }
        return resolved.stations[t].seq;
    };
    for (key in children) {
        if (children.hasOwnProperty(key)) {
            children[key].sort(function(a, b) {
                var d = seqOfTie(a) - seqOfTie(b);
                if (d !== 0) {
                    return d;
                }
                // two runs leaving the SAME station tie here, and this
                // engine's sort is unstable -- without a second key the
                // band order would differ between runs of the same
                // drawing. Run key is unique, so it ends the tie.
                return (a < b) ? -1 : ((a > b) ? 1 : 0);
            });
        }
    }

    var out = [], seen = {};
    var walk = function(runKey) {
        if (seen[runKey]) {
            return;   // a cycle in the parent map cannot loop us forever
        }
        seen[runKey] = true;
        out.push(runKey);
        var kids = children[runKey] || [];
        for (var c = 0; c < kids.length; c++) {
            walk(kids[c]);
        }
    };
    for (i = 0; i < roots.length; i++) {
        walk(roots[i]);
    }
    // anything unreached (parent cycle, or parent in another component)
    for (i = 0; i < grouped.order.length; i++) {
        if (!seen[grouped.order[i]]) {
            walk(grouped.order[i]);
        }
    }
    return out;
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tests/js_unit.js`
Expected: PASS, count risen by 13.

- [ ] **Step 5: Commit**

```bash
git add scripts/CaveSurvey/Core/CsProfile.js tests/js_unit.js
git commit -m "feat(CsProfile): the graph decides band order, the name only cross-checks it"
```

---

## Task 3: Chain finding and unrolling one band

**Goal:** Turn one run into a band: the longest chain of its stations, prefixed by its tie station, unrolled left to right with along-passage X and true-elevation Y.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsProfile.js`
- Modify: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `longestChain` returns the longest simple path through a run's own stations
- [ ] Equal-length candidates are broken deterministically: lowest station sequence first, then highest — a one-leg spur off an interior station must not decide the band by iteration order
- [ ] Stations in the run but off that chain are returned as `omitted`
- [ ] A band's first point is its tie station at X = 0; the tie leg is part of the band
- [ ] The tie may attach to the MIDDLE of the chain, not only an endpoint — a run surveyed both ways from its junction (`A3→B1`, then `B1→B2→B3` and `B1→B5→B6`) puts its tie contact interior. Assuming an endpoint collapses the band to a single point and silently discards every station and leg in the run. Find where the tie actually attaches, take the longer arm from there, and report the shorter arm's stations in `omitted`
- [ ] Horizontal step per leg = `d·cos(inc)`; vertical position is each station's RESOLVED Z. Do NOT also state this as `d·sin(inc)`: the two agree only for unadjusted `new` legs. They diverge ~13% on the closure legs the tie step deliberately admits (that leg's rise is misclosure the resolved Z has already absorbed) and by a hair after `CsAdjust`. Resolved Z is the choice — it matches plan view and is what a revision must be reproducible against
- [ ] A leg doubling back in plan still advances X (extended, not projected)
- [ ] A PITCH puts two stations on the same X, and that is correct: at inclination ±90 the plan distance is 0 (~-1.8e-15 in floating point, so `Math.abs` is load-bearing or X steps backwards) and the leg draws as a pure vertical of its full tape. A zero-distance leg — including a shot with a missing tape, which resolves to distance 0 — draws as a coincident pair. Floor/ceiling and drawing both have to cope with coincident X and zero-length legs
- [ ] Y is the station's resolved Z, never a defaulted 0; a station with no resolved Z ends the band and is reported. `datum` stays null in that case rather than becoming 0 — a fabricated datum is the elevation-datum trap
- [ ] The TIE step resolves through `CsProfile.tieLegBetween`, which admits closure legs, while every interior step keeps using `legBetween`. The tie edge was chosen by `hierarchy`, whose contact graph admits closures, so refusing one here produced a silently short band — the exact failure the adjacency/legBetween invariant exists to prevent
- [ ] Vertical exaggeration scales Y about the band's own datum, never X

**Verify:** `node tests/js_unit.js` → `### UNIT OK`, count risen

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `tests/js_unit.js`:

```javascript
(function() {
    // A1 -> A2 -> A3 level, then A3 -> A4 down at 45 degrees.
    // A2 also carries a dead-end A2 -> A5 that is IN run A but off
    // the longest chain.
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("A2", "A3", 10, 90, 0),
        shotOf("A3", "A4", 10, 90, -45),
        shotOf("A2", "A5", 3, 180, 0)
    ];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    var h = CsProfile.hierarchy(g, r);
    var band = CsProfile.unrollBand(g.runs["A"], null, r, h, {});

    ok(band.stations[0].name === "A1", "root band starts at its own first station");
    near(band.stations[0].x, 0, 1e-9, "first station at X 0");
    near(band.stations[1].x, 10, 1e-9, "level leg advances X by its length");
    near(band.stations[2].x, 20, 1e-9, "second level leg advances X again");

    // 10 ft at -45 deg: plan 7.0711, rise -7.0711
    near(band.stations[3].x, 20 + 7.0710678, 1e-5, "sloped leg advances by plan");
    near(band.stations[3].y, -7.0710678, 1e-5, "sloped leg drops by rise");

    // the drawn leg length is the slope distance, which is the point
    var dx = band.stations[3].x - band.stations[2].x;
    var dy = band.stations[3].y - band.stations[2].y;
    near(Math.sqrt(dx * dx + dy * dy), 10, 1e-5, "leg draws at slope length");

    ok(band.omitted.indexOf("A5") >= 0, "off-chain station reported omitted");
    ok(band.legs.length === 3, "three legs in the band");

    // A5-A2-A3-A4 is exactly as long as A1-A2-A3-A4, so without a
    // tie-break the band's contents would depend on iteration order
    ok(band.stations[0].name === "A1",
        "equal-length chains resolve to the lower station sequence");
}());

(function() {
    // the second tie-break: equal length, equal lowest sequence, so the
    // lower HIGHEST sequence wins -- A13-A14-A15 over A13-A14-A99
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A13", "A14", 10, 0, 0),
        shotOf("A14", "A15", 10, 0, 0),
        shotOf("A14", "A99", 3, 270, 0)
    ];
    var r = CsNetwork.resolve(sv, {});
    var found = CsProfile.longestChain(
        CsProfile.groupRuns(r).runs["A"], r);
    ok(found.chain.join(",") === "A13,A14,A15",
        "lower highest sequence wins (got " + found.chain.join(",") + ")");
    ok(found.omitted.join(",") === "A99", "A99 reported omitted");
}());

(function() {
    // doubling back in plan must still advance X
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("A2", "A3", 10, 180, 0)   // straight back over A1
    ];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    var band = CsProfile.unrollBand(g.runs["A"], null, r,
        CsProfile.hierarchy(g, r), {});
    near(band.stations[2].x, 20, 1e-9, "extended elevation never doubles back");
}());

(function() {
    // a spur band opens with its tie station at X 0
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A1", "A2", 10, 0, 0),
        shotOf("A2", "A2a1", 6, 90, 0),
        shotOf("A2a1", "A2a2", 6, 90, 0)
    ];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    var h = CsProfile.hierarchy(g, r);
    var band = CsProfile.unrollBand(g.runs["A2a"], h.ties["A2a"], r, h, {});

    ok(band.stations[0].name === "A2", "spur band opens at its tie station");
    near(band.stations[0].x, 0, 1e-9, "tie station at X 0");
    near(band.stations[1].x, 6, 1e-9, "tie leg is drawn in the band");
    ok(band.legs.length === 2, "tie leg plus the spur's own leg");
    ok(band.tie === "A2", "band records its tie");
}());

(function() {
    // elevation datum: a cave anchored at 1200 must profile at 1200
    var sv = CsModel.newSurvey();
    sv.shots = [shotOf("A1", "A2", 10, 0, 0)];
    var r = CsNetwork.resolve(sv, { anchor: { name: "A1", x: 0, y: 0, z: 1200 } });
    var g = CsProfile.groupRuns(r);
    var band = CsProfile.unrollBand(g.runs["A"], null, r,
        CsProfile.hierarchy(g, r), {});
    near(band.stations[0].y, 1200, 1e-9, "profile keeps the absolute datum");
    near(band.datum, 1200, 1e-9, "band datum is its own first elevation");

    // exaggeration scales about the datum, and leaves X alone
    var sv2 = CsModel.newSurvey();
    sv2.shots = [shotOf("A1", "A2", 10, 0, -45)];
    var r2 = CsNetwork.resolve(sv2, {});
    var b2 = CsProfile.unrollBand(CsProfile.groupRuns(r2).runs["A"], null, r2,
        CsProfile.hierarchy(CsProfile.groupRuns(r2), r2),
        { exaggeration: 2.0 });
    near(b2.stations[1].y, -7.0710678 * 2.0, 1e-5, "Y doubled");
    near(b2.stations[1].x, 7.0710678, 1e-5, "X untouched by exaggeration");
}());
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tests/js_unit.js`
Expected: FAIL — `CsProfile.longestChain is not a function` / `unrollBand is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `scripts/CaveSurvey/Core/CsProfile.js`:

```javascript
/** The numeric value of a station's sequence, or a large number when
 *  it is not numeric -- so lettered sequences sort after numbered. */
CsProfile.seqNumOf = function(name) {
    var s = CsProfile.splitName(name);
    if (s === null || !/^[0-9]+$/.test(s.seq)) {
        return Number.MAX_VALUE;
    }
    return parseInt(s.seq, 10);
};

/**
 * Is `path` a better chain than `best`? Longer wins. Equal length is
 * broken by the LOWEST station sequence in the path, then by the
 * highest -- so A1-A2-A3-A4 beats A9-A2-A3-A4, and A13-A14-A15 beats
 * A13-A14-A99.
 *
 * WHY A TIE-BREAK IS REQUIRED, not a nicety: a spur one leg long off
 * an interior station produces an alternative path of EXACTLY the same
 * length as the main chain, so "longest wins" alone leaves the band's
 * contents decided by object iteration order. That is a band that
 * changes shape between runs for no reason the user did anything to.
 */
CsProfile.betterChain = function(path, best) {
    if (path.length !== best.length) {
        return path.length > best.length;
    }
    if (path.length === 0) {
        return false;
    }
    var stat = function(list) {
        var lo = Number.MAX_VALUE, hi = -1;
        for (var i = 0; i < list.length; i++) {
            var v = CsProfile.seqNumOf(list[i]);
            if (v < lo) { lo = v; }
            if (v > hi) { hi = v; }
        }
        return { lo: lo, hi: hi };
    };
    var a = stat(path), b = stat(best);
    if (a.lo !== b.lo) {
        return a.lo < b.lo;
    }
    if (a.hi !== b.hi) {
        return a.hi < b.hi;
    }
    // Still tied: decide on the station names themselves rather than on
    // which one the walk happened to reach first. Search order is not a
    // property a band's contents should depend on.
    return path.join(",") < best.join(",");
};

/**
 * The longest simple path through one run's own stations.
 *
 * Runs are chains in practice, so an exhaustive depth-first search
 * from every member is affordable and exact -- no heuristic to be
 * wrong about. Cost is bounded by the run's own size, not the survey's.
 *
 * \return {chain: [name], omitted: [name]} omitted = run members not
 *         on the chain, in sequence order
 */
CsProfile.longestChain = function(run, resolved) {
    var adj = CsProfile.adjacency(resolved);
    var inRun = {};
    var i;
    for (i = 0; i < run.stations.length; i++) {
        inRun[run.stations[i]] = true;
    }

    var best = [];
    var walk = function(at, visited, path) {
        path.push(at);
        if (CsProfile.betterChain(path, best)) {
            best = path.slice(0);
        }
        var links = adj[at] || [];
        for (var k = 0; k < links.length; k++) {
            var nxt = links[k].other;
            if (!inRun[nxt] || visited[nxt]) {
                continue;
            }
            visited[nxt] = true;
            walk(nxt, visited, path);
            visited[nxt] = false;
        }
        path.pop();
    };
    for (i = 0; i < run.stations.length; i++) {
        var visited = {};
        visited[run.stations[i]] = true;
        walk(run.stations[i], visited, []);
    }

    var onChain = {};
    for (i = 0; i < best.length; i++) {
        onChain[best[i]] = true;
    }
    var omitted = [];
    for (i = 0; i < run.stations.length; i++) {
        if (!onChain[run.stations[i]]) {
            omitted.push(run.stations[i]);
        }
    }

    // orient the chain by sequence: a survey reads from its low
    // numbers outward, so the band should too
    if (best.length >= 2) {
        var a = CsProfile.splitName(best[0]);
        var b = CsProfile.splitName(best[best.length - 1]);
        if (a !== null && b !== null &&
                CsProfile.seqOrder(a.seq, b.seq) > 0) {
            best.reverse();
        }
    }

    return { chain: best, omitted: omitted };
};

/**
 * The leg joining two named stations, or null. Closures excluded for
 * the same reason adjacency excludes them.
 */
CsProfile.legBetween = function(a, b, resolved) {
    for (var i = 0; i < resolved.legs.length; i++) {
        var leg = resolved.legs[i];
        if (leg.kind === "closure") {
            continue;
        }
        if ((leg.from === a && leg.to === b) ||
                (leg.from === b && leg.to === a)) {
            return leg;
        }
    }
    return null;
};

/**
 * Unrolls one run into a band.
 *
 * X advances by each leg's PLAN distance (d * cos inc) and Y is the
 * station's resolved Z, so the drawn leg length is its slope distance
 * and every leg appears at true length. X only ever increases: a
 * passage that doubles back in plan does not double back here, which
 * is what "extended" means.
 *
 * The band OPENS AT ITS TIE STATION, at X = 0, so the leg joining the
 * run to its parent is drawn inside this band. Without that, the tie
 * leg belongs to no band at all and vanishes from the profile.
 *
 * \param run      one grouped run {key, stations}
 * \param tie      the tie station name, or null for the root run
 * \param resolved CsNetwork.resolve() result
 * \param hier     CsProfile.hierarchy() result (unused today; passed so
 *                 callers need not special-case, and so a future
 *                 orientation rule has it to hand)
 * \param opts     {exaggeration: number (default 1), tapeMode}
 *
 * \return {
 *   key, tie, datum,
 *   stations: [{name, x, y, z}],
 *   legs:     [{shot, from, to, fromX, fromY, toX, toY}],
 *   omitted:  [name] run members off the chain,
 *   stopped:  name | null -- station with no resolved Z that ended it
 * }
 */
CsProfile.unrollBand = function(run, tie, resolved, hier, opts) {
    opts = opts || {};
    var exag = (opts.exaggeration === undefined ||
        opts.exaggeration === null) ? 1.0 : opts.exaggeration;
    var tapeMode = opts.tapeMode || CsTraverse.SLOPE;

    var found = CsProfile.longestChain(run, resolved);
    var chain = found.chain.slice(0);
    if (tie !== null && tie !== undefined &&
            resolved.stations.hasOwnProperty(tie)) {
        // the chain end nearer the tie leads, so the tie leg is real
        if (chain.length >= 2 &&
                CsProfile.legBetween(tie, chain[chain.length - 1], resolved) !== null &&
                CsProfile.legBetween(tie, chain[0], resolved) === null) {
            chain.reverse();
        }
        chain.unshift(tie);
    }

    var zOf = function(name) {
        var st = resolved.stations[name];
        if (st === undefined || st.z === undefined || st.z === null) {
            return null;   // NEVER 0: that would rebase an absolute datum
        }
        return st.z;
    };

    // NO FALLBACK TO 0. A null datum means the chain's head has no
    // resolved elevation, and substituting 0 there would rebase a cave
    // surveyed to an absolute datum -- the bug family this codebase has
    // been bitten by five times. datum stays null; the loop below reads
    // the same zOf(chain[0]) on its first iteration and stops, so no
    // NaN ever reaches yOf.
    var datum = (chain.length > 0) ? zOf(chain[0]) : null;
    var yOf = function(z) {
        return datum + (z - datum) * exag;
    };

    var stations = [], legs = [], stopped = null;
    var x = 0.0;
    for (var i = 0; i < chain.length; i++) {
        var name = chain[i];
        var z = zOf(name);
        if (z === null) {
            stopped = name;
            break;
        }
        if (i > 0) {
            var leg = CsProfile.legBetween(chain[i - 1], name, resolved);
            if (leg === null) {
                stopped = name;   // chain broken: stop, do not invent a link
                break;
            }
            var o = CsTraverse.offset(leg.shot, tapeMode);
            x += Math.abs(o.plan);
            legs.push({
                shot: leg.shot,
                from: chain[i - 1],
                to: name,
                fromX: stations[stations.length - 1].x,
                fromY: stations[stations.length - 1].y,
                toX: x,
                toY: yOf(z)
            });
        }
        stations.push({ name: name, x: x, y: yOf(z), z: z });
    }

    return {
        key: run.key,
        tie: (tie === undefined) ? null : tie,
        datum: datum,
        stations: stations,
        legs: legs,
        omitted: found.omitted,
        stopped: stopped
    };
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tests/js_unit.js`
Expected: PASS, count risen by 18.

- [ ] **Step 5: Commit**

```bash
git add scripts/CaveSurvey/Core/CsProfile.js tests/js_unit.js
git commit -m "feat(CsProfile): unroll a run into a band, tie station and all"
```

---

## Task 4: Floor and ceiling lines

**Goal:** Build floor and ceiling polylines for a band from U/D plus splays, with the near-horizontal dead zone, the along-passage ordering rule, and honest breaks.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsProfile.js`
- Modify: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] Ceiling point at `z + U`, floor at `z − D`; `null` produces no point; `0` produces a point at the station
- [ ] A splay above the dead zone joins the ceiling, below joins the floor, inside it joins neither and is returned as a flat tick
- [ ] Dead zone default is 10°, configurable, and boundary values are classified as flat
- [ ] A splay's X = its station's X + the along-passage projection of its plan offset; within a line, points are ordered by that projection with the LRUD tick at 0 leading ties
- [ ] WHERE THERE IS NO PASSAGE DIRECTION, THERE IS NO PROJECTION. Two live cases: a band with no legs at all (one station, or stopped at index 1), and a station reached by a PLUMB leg, whose compass reading is noise. In both the projection is 0 and the splay sits at its station's X — never projected against a fabricated azimuth. Falling back to 0° projects against due north: measured, a one-station band with splays at 0/90/180 spread ±6.43 ft along a direction nobody surveyed
- [ ] A wall run must never reverse in X. At a pitch the X advance is ~0, so a backward splay at the pitch bottom would otherwise land before the pitch-top station's points — measured as a run going 10 → 7.95 → 10.0 → 12.05. Monotone X is the defining property of an extended elevation
- [ ] `unrollBand` RECORDS `exaggeration` and `tapeMode` on the band it returns, and `bandWallRuns` reads them from the band rather than taking them again as options. Measured failure of the alternative: a band built with exaggeration 5 whose walls used the default put the ceiling BELOW its own station (station y 8.68, ceiling y 4.74). An invariant asking every caller to pass the same value twice will be broken, and every remaining task is a caller
- [ ] Runs break at junction stations (3+ non-splay legs), at closure legs, and at stations with no vertical evidence
- [ ] At a closure leg the run flushes BEFORE the closure's landing station, so that station contributes NO wall points — exactly what `CsLrud.wallRuns` does in plan, and plan view is the reference. The geometry is the reason: a closure leg draws at a length that is not its tape reading, so wall points hung across it would be squeezed onto a leg whose length is not a measurement
- [ ] Runs of fewer than 2 points are dropped

**Verify:** `node tests/js_unit.js` → `### UNIT OK`, count risen

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `tests/js_unit.js`:

```javascript
(function() {
    ok(CsProfile.classifySplay(shotOf("A1", "", 5, 0, 40), 10) === "ceiling",
        "steep up splay joins the ceiling");
    ok(CsProfile.classifySplay(shotOf("A1", "", 5, 0, -40), 10) === "floor",
        "steep down splay joins the floor");
    ok(CsProfile.classifySplay(shotOf("A1", "", 5, 0, 3), 10) === "flat",
        "shallow splay joins neither");
    ok(CsProfile.classifySplay(shotOf("A1", "", 5, 0, 10), 10) === "flat",
        "the dead zone boundary is flat, not ceiling");
    ok(CsProfile.classifySplay(shotOf("A1", "", 5, 0, -10), 10) === "flat",
        "boundary below is flat too");
    ok(CsProfile.classifySplay(shotOf("A1", "", 5, 0, 11), 10) === "ceiling",
        "just outside the dead zone counts");
}());

(function() {
    // A1 -> A2 -> A3, level, each station 4 up and 2 down
    var sv = CsModel.newSurvey();
    var s1 = shotOf("A1", "A2", 10, 0, 0);
    s1.up = 4; s1.down = 2;
    var s2 = shotOf("A2", "A3", 10, 0, 0);
    s2.up = 4; s2.down = 2;
    sv.shots = [s1, s2];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    var h = CsProfile.hierarchy(g, r);
    var band = CsProfile.unrollBand(g.runs["A"], null, r, h, {});
    var w = CsProfile.bandWallRuns(band, sv, r, {});

    ok(w.ceiling.length === 1, "one ceiling run");
    ok(w.ceiling[0].length >= 2, "ceiling run has at least two points");
    near(w.ceiling[0][0].y, 4, 1e-9, "ceiling sits U above the station");
    near(w.floor[0][0].y, -2, 1e-9, "floor sits D below the station");
    near(w.ceiling[0][0].x, band.stations[1].x, 1e-9,
        "the LRUD point sits at its own station's X");
}());

(function() {
    // zero and null: 0 is a point at the station, null is no point
    var sv = CsModel.newSurvey();
    var s1 = shotOf("A1", "A2", 10, 0, 0);
    s1.up = 0; s1.down = null;
    var s2 = shotOf("A2", "A3", 10, 0, 0);
    s2.up = 0; s2.down = null;
    sv.shots = [s1, s2];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    var band = CsProfile.unrollBand(g.runs["A"], null, r,
        CsProfile.hierarchy(g, r), {});
    var w = CsProfile.bandWallRuns(band, sv, r, {});
    near(w.ceiling[0][0].y, 0, 1e-9, "U of 0 is a ceiling point at the station");
    ok(w.floor.length === 0, "null D draws no floor at all");
}());

(function() {
    // splays: one up, one down, one flat -- and along-passage ordering.
    // The legs carry U/D as well, so each line has an LRUD point at
    // every station: without that, a run of one point is dropped and
    // there is nothing to assert about ordering.
    var sv = CsModel.newSurvey();
    var s1 = shotOf("A1", "A2", 10, 0, 0);
    s1.up = 6; s1.down = 6;
    var s2 = shotOf("A2", "A3", 10, 0, 0);
    s2.up = 6; s2.down = 6;
    var up = splayOf("A2", 5, 0, 60);      // forward and up
    var down = splayOf("A2", 5, 180, -60); // backward and down
    var flat = splayOf("A2", 5, 90, 0);    // sideways, level
    sv.shots = [s1, s2, up, down, flat];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    var band = CsProfile.unrollBand(g.runs["A"], null, r,
        CsProfile.hierarchy(g, r), {});
    var w = CsProfile.bandWallRuns(band, sv, r, {});

    ok(w.flat.length === 1 && w.flat[0].station === "A2",
        "the level splay is a flat tick, in neither line");

    // A2 contributes its U point and the up splay; A3 its U point.
    // A1 has no LRUD (nothing arrives at it) so it contributes nothing.
    ok(w.ceiling.length === 1, "one ceiling run (got " + w.ceiling.length + ")");
    ok(w.ceiling[0].length === 3,
        "A2 tick + A2 up splay + A3 tick (got " + w.ceiling[0].length + ")");

    var a2x = band.stations[1].x, a3x = band.stations[2].x;
    // 5 ft at 60 deg up: plan 2.5, forward along the passage
    near(w.ceiling[0][0].x, a2x, 1e-9, "the LRUD point leads, at its station");
    near(w.ceiling[0][1].x, a2x + 2.5, 1e-5,
        "the forward up splay sits its plan projection past the station");
    ok(w.ceiling[0][1].x < a3x, "and still short of the next station");

    // X must be non-decreasing along the run, or the wall zigzags
    var sorted = true;
    for (var i = 1; i < w.ceiling[0].length; i++) {
        if (w.ceiling[0][i].x < w.ceiling[0][i - 1].x - 1e-9) { sorted = false; }
    }
    ok(sorted, "ceiling points are ordered along the passage");

    // the backward down splay lands BEFORE its station's floor tick
    ok(w.floor[0][0].x < a2x, "a backward splay lands before its station");
}());

(function() {
    // a junction ends a run rather than guessing across it
    var sv = CsModel.newSurvey();
    var mk = function(f, t, az) {
        var s = shotOf(f, t, 10, az, 0);
        s.up = 3; s.down = 3;
        return s;
    };
    sv.shots = [mk("A1", "A2", 0), mk("A2", "A3", 0), mk("A3", "A4", 0),
        mk("A2", "A2a1", 90)];
    var r = CsNetwork.resolve(sv, {});
    var g = CsProfile.groupRuns(r);
    var band = CsProfile.unrollBand(g.runs["A"], null, r,
        CsProfile.hierarchy(g, r), {});
    var w = CsProfile.bandWallRuns(band, sv, r, {});

    // A1 has no LRUD, so it breaks an empty run. A2 is a junction (three
    // legs touch it) and ends its own run at one point, which is dropped
    // for being shorter than a line. A3-A4 is the surviving run -- and
    // the point of the test is that A2 is NOT joined to it.
    ok(w.ceiling.length === 1,
        "one surviving ceiling run (got " + w.ceiling.length + ")");
    ok(w.ceiling[0].length === 2, "and it is A3-A4 only");
    near(w.ceiling[0][0].x, band.stations[2].x, 1e-9,
        "the run starts at A3, not at the junction");

    // without the junction, the same survey gives ONE run of three
    var sv2 = CsModel.newSurvey();
    sv2.shots = [mk("A1", "A2", 0), mk("A2", "A3", 0), mk("A3", "A4", 0)];
    var r2 = CsNetwork.resolve(sv2, {});
    var g2 = CsProfile.groupRuns(r2);
    var w2 = CsProfile.bandWallRuns(
        CsProfile.unrollBand(g2.runs["A"], null, r2,
            CsProfile.hierarchy(g2, r2), {}), sv2, r2, {});
    ok(w2.ceiling.length === 1 && w2.ceiling[0].length === 3,
        "no junction: A2-A3-A4 is one run of three");
}());
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tests/js_unit.js`
Expected: FAIL — `CsProfile.classifySplay is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `scripts/CaveSurvey/Core/CsProfile.js`:

```javascript
/** Default half-width of the near-horizontal dead zone, in degrees. */
CsProfile.FLAT_SPLAY_DEG = 10.0;

/**
 * Which line a splay belongs to: "ceiling", "floor", or "flat".
 *
 * WHY THE DEAD ZONE EXISTS, when the plan walls have no steepness
 * filter at all: in plan every splay has a real horizontal projection,
 * so every splay is a real wall hit. In elevation a near-horizontal
 * splay is still a real wall hit, but it says nothing about where the
 * floor or the ceiling is -- letting a 2-degree, 30-foot splay into
 * either line would drag that line to almost centerline level. It is
 * drawn as its own tick instead, so the evidence stays visible without
 * bending a line it does not describe.
 */
CsProfile.classifySplay = function(shot, deadDeg) {
    var dead = (deadDeg === undefined || deadDeg === null) ?
        CsProfile.FLAT_SPLAY_DEG : deadDeg;
    var inc = CsTraverse.effectiveInclination(shot);
    if (inc === null || inc === undefined) {
        return "flat";
    }
    if (Math.abs(inc) <= dead) {
        return "flat";
    }
    return (inc > 0) ? "ceiling" : "floor";
};

/**
 * Floor and ceiling polylines for one unrolled band, plus the flat
 * splay ticks.
 *
 * Per station: the LRUD point (ceiling at z+U, floor at z-D; null
 * draws nothing, 0 draws a point at the station) and every splay that
 * classifies onto that line. A splay's X is its station's X plus the
 * along-passage projection of its plan offset, and points within a
 * line are ordered by that projection with the LRUD point at 0
 * leading its ties -- the same rule CsLrud.stationWallPoints uses, so
 * plan and profile order wall evidence identically.
 *
 * Breaks: a junction station (three or more non-splay legs), a
 * closure leg, and a station with no vertical evidence at all. Each
 * break starts a new polyline rather than inventing a connection.
 *
 * \return {ceiling: [[{x,y}]], floor: [[{x,y}]],
 *          flat: [{x, y, station, name}]}
 */
CsProfile.bandWallRuns = function(band, survey, resolved, opts) {
    opts = opts || {};
    var dead = (opts.flatSplayDeg === undefined ||
        opts.flatSplayDeg === null) ?
        CsProfile.FLAT_SPLAY_DEG : opts.flatSplayDeg;
    var exag = (opts.exaggeration === undefined ||
        opts.exaggeration === null) ? 1.0 : opts.exaggeration;
    var tapeMode = opts.tapeMode || CsTraverse.SLOPE;

    var splays = CsLrud.splaysByStation(survey);
    var counts = CsLrud.legCounts(resolved.legs);

    var yOf = function(z) {
        return band.datum + (z - band.datum) * exag;
    };

    var ceilingRuns = [], floorRuns = [], flat = [];
    var ceiling = [], floor = [];

    var flush = function() {
        if (ceiling.length >= 2) {
            ceilingRuns.push(ceiling);
        }
        if (floor.length >= 2) {
            floorRuns.push(floor);
        }
        ceiling = [];
        floor = [];
    };

    // the leg that ARRIVED at each station in this band, for the
    // passage azimuth a splay's side and projection are measured from
    var arrivalAt = {};
    for (var li = 0; li < band.legs.length; li++) {
        arrivalAt[band.legs[li].to] = band.legs[li];
        if (arrivalAt[band.legs[li].from] === undefined) {
            arrivalAt[band.legs[li].from] = band.legs[li];
        }
    }

    for (var i = 0; i < band.stations.length; i++) {
        var st = band.stations[i];
        var lrud = CsModel.lrudForStation(survey, st.name);
        var arrival = arrivalAt[st.name];
        var passageAz = (arrival === undefined) ? 0.0 :
            CsTraverse.effectiveAzimuth(arrival.shot);
        var azRad = passageAz * Math.PI / 180.0;
        var alongX = Math.sin(azRad), alongY = Math.cos(azRad);

        var cEntries = [], fEntries = [];

        if (lrud !== null && lrud !== undefined) {
            if (lrud.up !== null && lrud.up !== undefined) {
                cEntries.push({ p: { x: st.x, y: yOf(st.z + lrud.up) },
                    t: 0.0, order: -1 });
            }
            if (lrud.down !== null && lrud.down !== undefined) {
                fEntries.push({ p: { x: st.x, y: yOf(st.z - lrud.down) },
                    t: 0.0, order: -1 });
            }
        }

        var sps = splays[st.name] || [];
        for (var k = 0; k < sps.length; k++) {
            var sp = sps[k];
            var o = CsTraverse.offset(sp, tapeMode);
            var t = o.dx * alongX + o.dy * alongY;
            var point = { x: st.x + t, y: yOf(st.z + o.dz) };
            var side = CsProfile.classifySplay(sp, dead);
            if (side === "ceiling") {
                cEntries.push({ p: point, t: t, order: k });
            } else if (side === "floor") {
                fEntries.push({ p: point, t: t, order: k });
            } else {
                flat.push({ x: point.x, y: point.y, station: st.name,
                    name: st.name + "." + (k + 1) });
            }
        }

        var byAlong = function(a, b) {
            if (a.t < b.t) { return -1; }
            if (a.t > b.t) { return 1; }
            return a.order - b.order;
        };
        cEntries.sort(byAlong);
        fEntries.sort(byAlong);

        var isJunction = (counts[st.name] > 2);
        var noEvidence = (cEntries.length === 0 && fEntries.length === 0);

        for (k = 0; k < cEntries.length; k++) {
            ceiling.push(cEntries[k].p);
        }
        for (k = 0; k < fEntries.length; k++) {
            floor.push(fEntries[k].p);
        }

        // A closure leg arriving here ends the runs for the same reason
        // the plan walls end at one: a second arrival is not a
        // continuation of the passage as walked.
        //
        // The leg's kind CANNOT be read off band.legs -- unrollBand
        // pushes {shot, from, to, fromX, fromY, toX, toY} and no kind --
        // so a check like `arrival.kind === "closure"` compares
        // undefined and silently never fires. Look the kind up instead,
        // and keep this lookup separate from the passage-azimuth map:
        // that one falls back to the band's opening station, and a
        // closure landing elsewhere must not inherit that fallback.
        var closureHere = false;
        if (arrival !== undefined && arrival !== null) {
            var kindLeg = CsProfile.tieLegBetween(arrival.from, arrival.to,
                resolved);
            closureHere = (kindLeg !== null && kindLeg.kind === "closure");
        }

        if (isJunction || noEvidence || closureHere) {
            flush();
        }
    }
    flush();

    return { ceiling: ceilingRuns, floor: floorRuns, flat: flat };
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tests/js_unit.js`
Expected: PASS, count risen by 16.

- [ ] **Step 5: Commit**

```bash
git add scripts/CaveSurvey/Core/CsProfile.js tests/js_unit.js
git commit -m "feat(CsProfile): floor and ceiling from U/D and the splays that mean something"
```

---

## Task 5: Band layout and the whole-profile build

**Goal:** One entry point that turns a survey plus its resolve into a laid-out profile: every band, its Z offset where elevation spans collide, and every finding worth reporting.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsProfile.js`
- Modify: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `CsProfile.build(survey, resolved, opts)` returns bands in band order, each with its walls and its `zOffset`
- [ ] `build` constructs the adjacency graph ONCE and passes it to every band. Rebuilding it per band is O(runs × legs) and measured at 60% of total build time on a 401-run survey — `longestChain` takes an optional prebuilt graph for exactly this
- [ ] A band whose elevation span (walls included) clears every placed band keeps `zOffset` 0
- [ ] A band that would collide is pushed below the lowest placed band, and its `zOffset` is negative. The gutter comes from a LOW ORDER STATISTIC of band heights (nearest-rank, index `ceil(0.25n)-1`), floored at `GUTTER_MIN` — not the median, and not the moved band's own height. Both of those were tried and measured. Own height: a band of 2000 beside one of 4 left a 2000-unit hole. Median: at two bands of heights [4, 2000] the median IS 1002, so the gutter was 501 and the 4-unit band got a blank gutter 125× its own height — the median only tames an outlier once tall bands are a strict minority, and two runs is the commonest small-cave shape. The low quantile anchors the separation to the SMALL bands, which are the ones a big gutter ruins: the same [4, 2000] case now gives 5 — NOT the moved band's own height. Measured failure of that original rule: a band of height 2000 beside a neighbour of height 4 left a 2000-unit hole and shoved everything below it off the page. A gutter is a separation, not a geometric quantity; it should scale with the profile's typical band, and a big band deserves more room, not more empty space around it. Median rather than mean so one deep pit does not inflate every gap
- [ ] The honest coverage invariant, in two parts: no leg is drawn in more than one band, AND every leg that is NOT drawn has at least one endpoint in some band's `omitted` list. "Exactly one band" stopped being true when the interior-tie fix began demoting a run's shorter arm — those legs are deliberately in no band, because drawing them would need a second copy of a station that was never surveyed. What matters is that nothing vanishes unexplained
- [ ] `findings.undrawn` names every leg the profile did NOT draw, with a reason (closure, cross-run tie, demoted arm, after-stop). Measured need: a plain three-shot loop `A1→A2→A3→A1` drops its closure leg with EVERY findings list empty — a surveyed leg vanishing with nothing saying so. And the union of `omitted`, `stopped`, `orphans`, `strandedRoots` and `secondTies` does not reconstruct it: 17% of 20,000 random surveys have an undrawn leg that appears in none of them. This is the field the drawing tasks need most
- [ ] `build` hoists `CsLrud.splaysByStation` and `CsLrud.legCounts` too, not just the adjacency graph. Measured on a 401-run survey: those two were rebuilt once per band, 22.8% and 21.7% of a 276 ms build — 45% together, the same waste the adjacency criterion cites at 60%
- [ ] `build` constructs the adjacency graph ONCE into its own options object, and must NOT write it onto the caller's `opts`: `CsDraw.survey` calls `build` on every redraw, and a graph cached onto a reused options object would outlive the `resolved` it was built from
- [ ] Findings collected: omitted stations, tie mismatches, second ties, orphan runs (physically disconnected), stranded roots (parentless but connected), stations with no resolved Z — and for each stopped band its `stoppedReason` (`"no-z"` vs `"no-leg"`), since those ask different things of the reader

**Verify:** `node tests/js_unit.js` → `### UNIT OK`, count risen

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `tests/js_unit.js`:

```javascript
(function() {
    // two runs at the same elevation: the second must be pushed down
    var sv = CsModel.newSurvey();
    var mk = function(f, t, az) {
        var s = shotOf(f, t, 10, az, 0);
        s.up = 2; s.down = 2;
        return s;
    };
    sv.shots = [mk("A1", "A2", 0), mk("A2", "A3", 0),
        mk("A2", "B1", 90), mk("B1", "B2", 90)];
    var r = CsNetwork.resolve(sv, {});
    var p = CsProfile.build(sv, r, {});

    ok(p.bands.length === 2, "two bands built");
    ok(p.bands[0].key === "A", "A is first");
    ok(p.bands[0].zOffset === 0, "the first band sits at true elevation");
    ok(p.bands[1].zOffset < 0, "the colliding band is pushed down");

    // every leg lands in exactly one band
    var seen = {}, total = 0;
    for (var b = 0; b < p.bands.length; b++) {
        for (var l = 0; l < p.bands[b].legs.length; l++) {
            var leg = p.bands[b].legs[l];
            var key = leg.from + "->" + leg.to;
            var rev = leg.to + "->" + leg.from;
            ok(seen[key] === undefined && seen[rev] === undefined,
                "leg " + key + " drawn once only");
            seen[key] = true;
            total++;
        }
    }
    ok(total === 4, "all four legs drawn, none lost");
}());

(function() {
    // findings are collected, not silently dropped
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A13", "A14", 10, 0, 0),
        shotOf("A14", "A13a1", 5, 90, 0),
        shotOf("A14", "A15", 10, 0, 0),
        shotOf("A14", "A99", 3, 270, 0)
    ];
    var r = CsNetwork.resolve(sv, {});
    var p = CsProfile.build(sv, r, {});
    ok(p.findings.mismatches.length === 1, "tie mismatch survives into findings");
    ok(p.findings.omitted.length >= 1, "off-chain station reported");
}());
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tests/js_unit.js`
Expected: FAIL — `CsProfile.build is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `scripts/CaveSurvey/Core/CsProfile.js`:

```javascript
/**
 * The vertical span a band occupies, walls included, before any
 * offset. Returns null when the band drew nothing.
 */
CsProfile.bandSpan = function(band) {
    var lo = null, hi = null;
    var note = function(y) {
        if (lo === null || y < lo) { lo = y; }
        if (hi === null || y > hi) { hi = y; }
    };
    var i, k;
    for (i = 0; i < band.stations.length; i++) {
        note(band.stations[i].y);
    }
    for (i = 0; i < band.ceiling.length; i++) {
        for (k = 0; k < band.ceiling[i].length; k++) {
            note(band.ceiling[i][k].y);
        }
    }
    for (i = 0; i < band.floor.length; i++) {
        for (k = 0; k < band.floor[i].length; k++) {
            note(band.floor[i][k].y);
        }
    }
    for (i = 0; i < band.flat.length; i++) {
        note(band.flat[i].y);
    }
    return (lo === null) ? null : { lo: lo, hi: hi };
};

/**
 * Assigns each band its zOffset in place.
 *
 * A band whose span clears every band already placed keeps offset 0
 * and reads at TRUE elevation. A band that would collide is pushed
 * below the lowest placed band, by its own height as a gutter, and
 * records the offset so the drawing can label it -- a displaced band
 * that did not say so would misinform a reader about depth.
 *
 * Degenerate bands (a single station, or all one elevation) still get
 * a gutter, from GUTTER_MIN, or two bands would land on one line.
 */
CsProfile.GUTTER_MIN = 5.0;

CsProfile.layout = function(bands) {
    var placedLo = null, placedHi = null;
    for (var i = 0; i < bands.length; i++) {
        var span = CsProfile.bandSpan(bands[i]);
        if (span === null) {
            bands[i].zOffset = 0.0;
            continue;
        }
        if (placedLo === null) {
            bands[i].zOffset = 0.0;
            placedLo = span.lo;
            placedHi = span.hi;
            continue;
        }
        var clears = (span.lo > placedHi) || (span.hi < placedLo);
        if (clears) {
            bands[i].zOffset = 0.0;
            placedLo = Math.min(placedLo, span.lo);
            placedHi = Math.max(placedHi, span.hi);
            continue;
        }
        var height = span.hi - span.lo;
        var gutter = Math.max(height, CsProfile.GUTTER_MIN);
        bands[i].zOffset = (placedLo - gutter) - span.hi;
        placedLo = span.lo + bands[i].zOffset;
    }
    return bands;
};

/**
 * The whole profile: every band, laid out, with its walls and the
 * findings a report should print.
 *
 * \param opts {exaggeration, flatSplayDeg, tapeMode}
 * \return {
 *   bands: [band] in band order, each an unrollBand result plus
 *          {ceiling, floor, flat, zOffset},
 *   findings: {omitted, mismatches, secondTies, orphans, strandedRoots,
 *              stopped, ungrouped}
 * }
 */
CsProfile.build = function(survey, resolved, opts) {
    opts = opts || {};
    var grouped = CsProfile.groupRuns(resolved);
    var hier = CsProfile.hierarchy(grouped, resolved);

    var bands = [];
    var omitted = [], stopped = [];
    for (var i = 0; i < hier.order.length; i++) {
        var key = hier.order[i];
        var run = grouped.runs[key];
        if (run === undefined) {
            continue;
        }
        var band = CsProfile.unrollBand(run, hier.ties[key], resolved,
            hier, opts);
        var walls = CsProfile.bandWallRuns(band, survey, resolved, opts);
        band.ceiling = walls.ceiling;
        band.floor = walls.floor;
        band.flat = walls.flat;
        band.parent = hier.parents[key];
        band.zOffset = 0.0;
        bands.push(band);

        for (var k = 0; k < band.omitted.length; k++) {
            omitted.push(band.omitted[k]);
        }
        if (band.stopped !== null) {
            stopped.push(band.stopped);
        }
    }

    CsProfile.layout(bands);

    return {
        bands: bands,
        findings: {
            omitted: omitted,
            mismatches: hier.mismatches,
            secondTies: hier.secondTies,
            orphans: hier.orphans,
            strandedRoots: hier.strandedRoots,
            stopped: stopped,
            ungrouped: grouped.ungrouped
        }
    };
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tests/js_unit.js`
Expected: PASS, count risen by 11.

Then both engines:

```bash
./tests/run_all.sh
```

Expected: `ALL TESTS PASSED`.

- [ ] **Step 5: Commit**

```bash
git add scripts/CaveSurvey/Core/CsProfile.js tests/js_unit.js
git commit -m "feat(CsProfile): lay the bands out and report what did not fit"
```

---

## Task 5b: Stop `CsTraverse.offset` laundering absent measurements into geometry

**Goal:** A shot with a missing distance or inclination must not silently become a coordinate. Fix it once, upstream, where both plan view and the profile read it.

**Why this is its own task, and why it comes before anything draws.** `CsTraverse.offset` computes `plan = shot.distance * Math.cos(incRad)`. In JavaScript `null * Math.cos(x)` is `0`, and `undefined * Math.cos(x)` is `NaN`. So a splay with no distance draws AT its station — a wall point asserting the wall is exactly here — and a splay with no inclination draws level. `undefined` is worse: NaN coordinates, which until now died quietly in pure math and from the next task onward would reach `RVector`, the DXF writer, and the drawing itself.

This is the sibling of the elevation-datum trap: not a wrong number, a FABRICATED one, presented with the same confidence as a measurement. It is upstream of the profile, it affects `CsLrud.wallRuns` and `CsDraw`'s splay rays identically today, and the honest fix is one guard rather than eleven per-task ones. Found by the Task 4 review, which confirmed plan view launders it the same way.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsTraverse.js`
- Modify: `scripts/CaveSurvey/Core/CsLrud.js` (skip, rather than place, an unmeasurable splay)
- Modify: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `CsTraverse.offset` returns null — not a coordinate — when `distance` or the effective inclination/azimuth is null, undefined, or not finite. A caller must be forced to notice
- [ ] Every existing caller handles that null by SKIPPING the shot, and none of them substitutes a zero. Audit and fix each call site rather than assuming
- [ ] `CsLrud.stationWallPoints` and `CsLrud.wallRuns` skip an unmeasurable splay instead of placing a wall point at the station — a wall point at the station asserts "the wall is here", which is a measurement nobody made
- [ ] `CsProfile.bandWallRuns` likewise, including the flat-tick path: no tick from an absent inclination
- [ ] `CsDraw.survey` does not draw a splay ray for an unmeasurable splay, and reports it
- [ ] A shot with `distance: 0` is NOT affected: zero is a measurement (the wall is at the station, the station is on the wall) and must keep working exactly as it does now. This is the distinction the whole task turns on
- [ ] The reports name what was skipped, so a surveyor sees the gap rather than a confident wrong line
- [ ] No NaN can reach any coordinate: assert directly, in both plan and profile paths

**Verify:** `./tests/run_all.sh` → `ALL TESTS PASSED`, with new named tests for each criterion and a mutation report

**Steps:**

- [ ] **Step 1: Audit every caller before changing anything.** `grep -rn "CsTraverse.offset\|reverseOffset" scripts/ tests/` and write down, per call site, what it does with the result today and what skipping would mean there. Report the list before editing — if any call site cannot tolerate a null, say so and stop.

- [ ] **Step 2: Write the failing tests.** For `offset`: null/undefined/NaN distance and inclination each return null; `distance: 0` still returns a real zero-length offset; a normal shot is unchanged. For `CsLrud`: an unmeasurable splay contributes no wall point. For `CsProfile`: no wall point and no flat tick. Assert `isFinite` on every coordinate produced by a fixture containing a broken shot.

- [ ] **Step 3: Guard `offset`.** Return null on unusable input, and record in the docblock exactly why zero is different from absent — `null * cos = 0` is the trap, in one line, so nobody re-introduces it.

- [ ] **Step 4: Fix each call site** to skip and count rather than place. Keep the counts in the existing report shapes.

- [ ] **Step 5: Run both engines and the full suite**, then mutation-test each new behaviour and report which test kills which mutation.

- [ ] **Step 6: Commit**

```bash
git add scripts/CaveSurvey/Core/CsTraverse.js scripts/CaveSurvey/Core/CsLrud.js scripts/CaveSurvey/Core/CsProfile.js scripts/CaveSurvey/Core/CsDraw.js tests/js_unit.js
git commit -m "fix(CsTraverse): an absent measurement is not a coordinate"
```

**What the audit found, recorded because it changes where the real bug lives.** The guard
above is the contract `CsTraverse.offset` should have had, and it is now enforced and tested.
But it is UNREACHABLE from real data today: every shot-producing path — all four format
parsers and the Survey Notebook editor — already substitutes `0.0` for a blank distance,
azimuth or inclination before a shot object exists. So the live, reachable form of this bug
family is one layer upstream, where a missing inclination becomes a level shot and a missing
azimuth becomes due north. That is suite-wide rather than profile-specific, it touches
parsers whose round-trip tests are load-bearing, and it is tracked separately rather than
folded in here.

Also recorded: `CsNetwork`, `CsAdjust` and `CsStats` call `offset` only on non-splay
main-traverse legs, and were deliberately left unguarded. Making them handle a null offset
means deciding what an unresolvable main-traverse leg does to loop closure, misclosure and
the least-squares solver — a larger question than this task, and one that cannot be answered
by adding a null check.

**Three anchors for whoever writes the upstream parser task**, found by the review of this one
and recorded so the audit does not have to be repeated:

- `Core/Format/CsWalls.js:281-286` — Walls encodes "not measured" as `--`, and the reader turns
  that into `distance = 0.0`. So Walls' ABSENT and Walls' MEASURED ZERO are the same value
  today, and `CsTraverse` now documents zero as "the wall is at the station".
- `Core/Format/CsCompass.js:163-168` — Compass's `-999` sentinel is applied to BACKSIGHTS via
  `isMissingReading` but not to the foresight azimuth or inclination.
- **The real cost, which is not written down anywhere else:** `CsNetwork.js:468/512/520`,
  `CsAdjust.js:506/616` and `CsStats.js:33` dereference `CsTraverse.offset`'s result
  unconditionally. The day the parsers stop fabricating zeros, those three files begin throwing
  `TypeError` and take the ENTIRE plan-view draw down with them, naming neither the shot nor the
  station. The upstream fix is therefore not a one-file change, and the brief must say so.

**A sixth door in the elevation-datum family, found by this review.** `CsNetwork.js:176`:
`anchorEffectiveZ = survey.fixed[opts.anchor.name].z || 0.0`, with a fifteen-line comment
directly above it arguing that defaulting an absent Z to 0 rebases an absolute-datum cave. The
`else` branch at `:178` does the same. Not live today — every current writer of `survey.fixed`
sets `z` — but it is in the file the profile's elevations ultimately come from, and five doors
of this family have already been found and closed.

**A caution specific to this task.** It touches plan view, which is shipped and in use. Any change in what plan draws for a survey with complete data is a REGRESSION, not an improvement — the whole point is that nothing changes except that fabricated geometry stops appearing. Say explicitly in your report whether any existing test's expected values had to change, and if any did, why that was not a regression.

---

## Task 6: Layers, the PROFILE template, and the structural tests

**Goal:** Register the two generated-line layers, add them and the LRUD/splay layers to the PROFILE template, and make the structural tests pin profile layers to the profile template instead of failing on the plan one.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsLayers.js`
- Create: `tools/add_profile_layers.js`
- Modify: `templates/NSS_Cave_Template_PROFILE.dxf` (by running that tool)
- Modify: `tests/test_addon.py`

**Acceptance Criteria:**
- [ ] `CsLayers.PROFILE_FLOOR` = `"CTRL-PROFILE-FLOOR"` and `CsLayers.PROFILE_CEILING` = `"CTRL-PROFILE-CEILING"`, both in `CsLayers.DEFAULTS` as gray/DASHED/Weight000
- [ ] The PROFILE template contains `CTRL-PROFILE-FLOOR`, `CTRL-PROFILE-CEILING`, `CTRL-LRUD`, `CTRL-SPLAYS`
- [ ] `tools/add_profile_layers.js` is idempotent — a second run reports `skip` and changes nothing
- [ ] `test_registry_layers_exist_in_plan_template` passes: profile-only layers are exempted there
- [ ] A new test asserts the profile-only layers exist in the PROFILE template
- [ ] `./tests/run_all.sh` green

**Verify:** `./tests/run_all.sh` → `ALL TESTS PASSED`

**Steps:**

- [ ] **Step 1: Write the failing structural tests**

In `tests/test_addon.py`, replace the body of `test_registry_layers_exist_in_plan_template` and add a companion test:

```python
    # Profile-only layers belong to the PROFILE template, and the wall
    # run layers are created on demand -- neither is a plan-template
    # omission. Everything else the registry names must be there.
    PROFILE_ONLY = {"CTRL-PROFILE-FLOOR", "CTRL-PROFILE-CEILING"}
    CREATED_ON_DEMAND = {"CTRL-LRUD-WALL-LEFT", "CTRL-LRUD-WALL-RIGHT"}

    def test_registry_layers_exist_in_plan_template(self):
        registry = self.layer_registry()
        plan = self.template_layers("NSS_Cave_Template_PLAN.dxf")
        missing = registry - plan - self.CREATED_ON_DEMAND - self.PROFILE_ONLY
        self.assertEqual(missing, set(),
                         "layers in Core/CsLayers.js but not the plan "
                         "template: %s" % sorted(missing))

    def test_profile_layers_exist_in_profile_template(self):
        """The elevation generator draws to these; a template without
        them means the layers get invented at runtime with whatever
        defaults, which is exactly the drift this class exists to stop.
        """
        profile = self.template_layers("NSS_Cave_Template_PROFILE.dxf")
        needed = self.PROFILE_ONLY | {"CTRL-LRUD", "CTRL-SPLAYS"}
        missing = needed - profile
        self.assertEqual(missing, set(),
                         "layers the profile generator draws to but the "
                         "PROFILE template lacks: %s" % sorted(missing))
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m unittest tests.test_addon -v -k profile_layers`
Expected: FAIL — `layers the profile generator draws to but the PROFILE template lacks: ['CTRL-LRUD', 'CTRL-PROFILE-CEILING', 'CTRL-PROFILE-FLOOR', 'CTRL-SPLAYS']`

- [ ] **Step 3: Add the layers to the registry**

In `scripts/CaveSurvey/Core/CsLayers.js`, after the `LRUD_WALL_RIGHT` line:

```javascript
CsLayers.PROFILE_FLOOR = "CTRL-PROFILE-FLOOR";
CsLayers.PROFILE_CEILING = "CTRL-PROFILE-CEILING";
```

and in `CsLayers.DEFAULTS`, beside the wall-run entries:

```javascript
    "CTRL-PROFILE-FLOOR": ["gray", "DASHED", "Weight000"],
    "CTRL-PROFILE-CEILING": ["gray", "DASHED", "Weight000"],
```

Generated profile lines are previsualization, exactly like the plan's inferred walls: faint, dashed, and on a `CTRL-` layer that `CsBind.isLineworkLayer` refuses to treat as traceable linework. `PROFILE-FLOOR` and `PROFILE-CEILING` (no `CTRL-` prefix) stay empty in the template and ARE bindable, which is what makes hand-traced profile lines follow a revision.

- [ ] **Step 4: Write the one-shot template tool**

Create `tools/add_profile_layers.js`:

```javascript
// add_profile_layers.js -- one-shot, idempotent: adds the layers the
// extended elevation generator draws to into the PROFILE template.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tools/add_profile_layers.js "$PWD"
//
// Same shape as tools/upcase_template_text.js: an off-screen document,
// a modification, an export back over the same file. Safe to re-run --
// a layer already present is left alone and the file is not rewritten.

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) { return true; }
        try { if (typeof v.isNull === "function") { return v.isNull(); } } catch (e) {}
        return false;
    };
}

// name -> [colorName, linetype, lineweight]
var WANTED = [
    ["CTRL-PROFILE-FLOOR", "gray", "DASHED", RLineweight.Weight000],
    ["CTRL-PROFILE-CEILING", "gray", "DASHED", RLineweight.Weight000],
    ["CTRL-LRUD", "pink", "CONTINUOUS", RLineweight.Weight025],
    ["CTRL-SPLAYS", "gray", "CONTINUOUS", RLineweight.Weight000]
];

/** The DXF writer that persists custom properties: see the plan's
 *  Task 7 note. Lowest canExport score wins, and the dxflib factory
 *  scores 1 for a filter naming it against 100 for a bare .dxf. */
function dxfLibFilter() {
    var filters = RFileExporterRegistry.getFilterStrings();
    for (var i = 0; i < filters.length; i++) {
        if (String(filters[i]).indexOf("dxflib") >= 0) {
            return filters[i];
        }
    }
    return "";   // no dxflib writer in this build; let the registry choose
}

function addLayers(path) {
    var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
    var di = new RDocumentInterface(doc);
    if (di.importFile(path, "", false) !== RDocumentInterface.IoErrorNoError) {
        print("FAIL  cannot read " + path);
        return false;
    }

    var op = new RAddObjectsOperation();
    var added = 0;
    for (var i = 0; i < WANTED.length; i++) {
        var name = WANTED[i][0];
        if (doc.hasLayer(name)) {
            continue;
        }
        var layer = new RLayer(doc, name, false, false,
            new RColor(WANTED[i][1]), doc.getLinetypeId(WANTED[i][2]),
            WANTED[i][3]);
        op.addObject(layer);
        added++;
    }

    if (added === 0) {
        print("skip  " + path + " -- every layer already present");
        return true;
    }
    di.applyOperation(op);

    if (di.exportFile(path, dxfLibFilter()) !== true) {
        print("FAIL  cannot write " + path);
        return false;
    }
    print("ok    " + path + " -- " + added + " layer(s) added");
    return true;
}

var target = repoRoot + "/templates/NSS_Cave_Template_PROFILE.dxf";
if (!addLayers(target)) {
    print("### ADD PROFILE LAYERS FAIL");
} else {
    print("### ADD PROFILE LAYERS OK");
}
```

- [ ] **Step 5: Run it, twice, and confirm idempotence**

```bash
/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tools/add_profile_layers.js "$PWD"
```

Expected first run: `ok    .../NSS_Cave_Template_PROFILE.dxf -- 4 layer(s) added` then `### ADD PROFILE LAYERS OK`
Expected second run: `skip  ... -- every layer already present`

- [ ] **Step 6: Run the tests to verify they pass**

Run: `./tests/run_all.sh`
Expected: `ALL TESTS PASSED`

- [ ] **Step 7: Commit**

```bash
git add scripts/CaveSurvey/Core/CsLayers.js tools/add_profile_layers.js templates/NSS_Cave_Template_PROFILE.dxf tests/test_addon.py
git commit -m "feat(CsLayers): profile floor and ceiling layers, pinned to the profile template"
```

---

## Task 7: The sibling document

**Goal:** Resolve the profile document — the already-open tab if there is one, otherwise a document built from the PROFILE template — and export it with the writer that actually persists custom properties.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsProfileFile.js`
- Modify: `tests/js_unit.js` (pure-path tests only: path derivation and filter choice)
- Create: `tests/profile_file_roundtrip.js` (headless QCAD-only: export, reimport, tags survive)

**Acceptance Criteria:**
- [ ] `CsProfileFile.siblingPath("/x/Cave.dxf")` → `/x/Cave-PROFILE.dxf`; the suffix is preserved and a path already ending in `-PROFILE` is returned unchanged
- [ ] `CsProfileFile.siblingPath("")` and `null` return `null` — an unsaved drawing has no sibling
- [ ] `CsProfileFile.openTabFor(path)` returns the `{doc, di}` of a matching open tab, comparing absolute paths, or `null`
- [ ] `CsProfileFile.dxfFilter()` returns the filter string containing `dxflib`, or `""` when none exists
- [ ] `CsProfileFile.resolve(planPath)` returns `{doc, di, created, offscreen, path}`, never throws, and reports why on failure
- [ ] Round-trip test proves a custom property written into the sibling file survives export and reimport

**Verify:** `./tests/run_all.sh` and then the round-trip script:
`/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/profile_file_roundtrip.js "$PWD"` → `### PROFILE FILE OK`

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `tests/js_unit.js` (only the pure half — the tab and document work needs a real engine and is covered by the round-trip script):

```javascript
(function() {
    ok(CsProfileFile.siblingPath("/x/Cave.dxf") === "/x/Cave-PROFILE.dxf",
        "sibling path beside the plan");
    ok(CsProfileFile.siblingPath("/x/y/Big Cave.dxf") ===
        "/x/y/Big Cave-PROFILE.dxf", "spaces in the name survive");
    ok(CsProfileFile.siblingPath("/x/Cave-PROFILE.dxf") ===
        "/x/Cave-PROFILE.dxf", "the profile file is its own sibling");
    ok(CsProfileFile.siblingPath("") === null, "unsaved drawing has no sibling");
    ok(CsProfileFile.siblingPath(null) === null, "null path has no sibling");
}());
```

Add `"scripts/CaveSurvey/Core/CsProfileFile.js"` to `CORE_FILES` after `CsProfile.js`. The file's document half must therefore not touch `R*` at file scope — same rule every Core file follows.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tests/js_unit.js`
Expected: FAIL — `cannot open .../CsProfileFile.js`.

- [ ] **Step 3: Write the implementation**

Create `scripts/CaveSurvey/Core/CsProfileFile.js`:

```javascript
// CsProfileFile.js -- finding (or making) the drawing the extended
// elevation lives in.
//
// Part of the Cave Survey Core library. The pure half (siblingPath) runs
// anywhere; everything else is QCAD context and says so.
//
// WHY THE PROFILE IS ITS OWN FILE: an extended elevation's X axis is
// distance along the passage, not northing. Every global operation that
// means something on a plan -- rotate to grid north, scale, morph onto
// an aerial -- means nothing applied to an elevation, and a window
// select or a layer-wide edit in a shared drawing catches both. The
// profile is also going to be SKETCHED ON, which rules out hiding it in
// a block: block editing hides the rest of the sheet, and every
// existing tool queries model space, so block contents would go stale
// with no redraw able to clean them.
//
// WHERE IT DRAWS, in order of preference:
//
//   an open tab   if the sibling file is already open, we draw straight
//                 into that tab's document interface. The user sees it
//                 update, undo works there, and their own unsaved
//                 sketching is not clobbered by a file rewritten
//                 underneath them.
//   off screen    otherwise: a memory document from the PROFILE
//                 template, drawn into, exported to the sibling path,
//                 then revealed in a tab.
//
// Tab enumeration is exactly what library.js's own openFiles() does --
// mdiArea.subWindowList(), then getDocument() on each child -- so this
// is a supported path, not a trick. RMdiChildQt also exposes
// getDocumentInterface(), which is the piece that lets us DRAW there.

var CsProfileFile = {};

CsProfileFile.SUFFIX = "-PROFILE";

/**
 * The profile file that belongs beside a plan drawing. Pure.
 *
 * null when there is no path at all: an unsaved drawing has nowhere to
 * put a sibling, and inventing a location would scatter files into
 * whatever the working directory happens to be.
 */
CsProfileFile.siblingPath = function(planPath) {
    if (planPath === undefined || planPath === null) {
        return null;
    }
    var p = String(planPath);
    if (p === "") {
        return null;
    }
    var dot = p.lastIndexOf(".");
    var slash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
    var stem = (dot > slash) ? p.substring(0, dot) : p;
    var ext = (dot > slash) ? p.substring(dot) : ".dxf";
    if (stem.length >= CsProfileFile.SUFFIX.length &&
            stem.substring(stem.length - CsProfileFile.SUFFIX.length) ===
            CsProfileFile.SUFFIX) {
        return p;   // already the profile file
    }
    return stem + CsProfileFile.SUFFIX + ext;
};

/**
 * The DXF writer that persists custom properties. QCAD context only.
 *
 * THIS CHOICE IS LOAD BEARING. RFileExporterRegistry picks the LOWEST
 * canExport score, and RDxfExporterFactory scores 1 for a filter naming
 * "dxflib" against 100 for a bare .dxf. NOTE, verified three ways after
 * this was written: in THIS fork it makes no difference -- only one DXF
 * exporter is registered and instantiate() never sees the name filter,
 * so exportFile(path, "") reaches the same writer. The tags persist
 * because this fork's only DXF writer emits XDATA, NOT because we named
 * the filter. Keep naming it as declared intent, but do not reason from
 * it: whoever debugs a lost tag will be looking in the wrong place.
 * The writer CaveCAD taught to emit custom
 * properties as XDATA. Exported by any other writer, every profile tag
 * on every entity is silently dropped and the next regeneration cannot
 * find its own previous output to erase.
 */
CsProfileFile.dxfFilter = function() {
    try {
        var filters = RFileExporterRegistry.getFilterStrings();
        for (var i = 0; i < filters.length; i++) {
            if (String(filters[i]).indexOf("dxflib") >= 0) {
                return filters[i];
            }
        }
    } catch (e) {
        // no registry in this context: let the caller pass "" through
    }
    return "";
};

/**
 * The open tab showing a given file, or null. QCAD context only.
 *
 * \return {doc, di} or null
 */
CsProfileFile.openTabFor = function(path) {
    if (path === null || path === undefined || path === "") {
        return null;
    }
    try {
        var appWin = RMainWindowQt.getMainWindow();
        if (isNull(appWin)) {
            return null;
        }
        var children = appWin.getMdiArea().subWindowList();
        var want = new QFileInfo(path).absoluteFilePath();
        for (var i = 0; i < children.length; i++) {
            var doc = children[i].getDocument();
            if (isNull(doc)) {
                continue;
            }
            var have = new QFileInfo(doc.getFileName()).absoluteFilePath();
            if (have === want) {
                return { doc: doc, di: children[i].getDocumentInterface() };
            }
        }
    } catch (e) {
        // headless, or a bridge without the MDI area: fall through
    }
    return null;
};

/** The PROFILE template, wherever this install keeps it. QCAD only. */
CsProfileFile.templatePath = function() {
    var candidates = [
        includeBasePath + "/../Templates/NSS_Cave_Template_PROFILE.dxf",
        RSettings.getStringValue("CaveSurvey/ProfileTemplatePath", ""),
        QDir.homePath() +
            "/Documents/Cave/templates/NSS_Cave_Template_PROFILE.dxf"
    ];
    for (var i = 0; i < candidates.length; i++) {
        if (candidates[i] !== "" && new QFileInfo(candidates[i]).exists()) {
            return candidates[i];
        }
    }
    return null;
};

/**
 * The document to draw the profile into. QCAD context only.
 *
 * \param planPath the plan drawing's file name (doc.getFileName())
 * \return {
 *   doc, di,          the document to draw into, or null on failure
 *   path,             the sibling path
 *   offscreen,        true when doc/di must be exported and destroyed
 *   created,          true when the file did not exist before
 *   reason            why doc is null, in words, when it is
 * }
 */
CsProfileFile.resolve = function(planPath) {
    var path = CsProfileFile.siblingPath(planPath);
    if (path === null) {
        return { doc: null, di: null, path: null, offscreen: false,
            created: false,
            reason: "the drawing has no file name yet -- save it and " +
                "the profile will be written beside it" };
    }

    var open = CsProfileFile.openTabFor(path);
    if (open !== null) {
        return { doc: open.doc, di: open.di, path: path,
            offscreen: false, created: false, reason: null };
    }

    var exists = new QFileInfo(path).exists();
    var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var di = new RDocumentInterface(doc);
    var source = exists ? path : CsProfileFile.templatePath();
    if (source === null) {
        destr(di);
        return { doc: null, di: null, path: path, offscreen: false,
            created: false,
            reason: "NSS_Cave_Template_PROFILE.dxf not found beside the " +
                "add-on or in Documents/Cave/templates" };
    }
    if (di.importFile(source, "", false) !==
            RDocumentInterface.IoErrorNoError) {
        destr(di);
        return { doc: null, di: null, path: path, offscreen: false,
            created: false, reason: "could not read " + source };
    }

    return { doc: doc, di: di, path: path, offscreen: true,
        created: !exists, reason: null };
};

/**
 * Writes an off-screen profile document to its path and disposes of it.
 * QCAD context only. Returns true on success.
 */
CsProfileFile.commit = function(resolved) {
    if (resolved.doc === null || !resolved.offscreen) {
        return resolved.doc !== null;   // an open tab needs no export
    }
    var okWritten = false;
    try {
        okWritten = (resolved.di.exportFile(resolved.path,
            CsProfileFile.dxfFilter()) === true);
    } catch (e) {
        okWritten = false;
    }
    try {
        destr(resolved.di);
    } catch (e2) {
        // disposal is a nicety; the export already happened
    }
    return okWritten;
};

/** Shows the profile file in a tab, without stealing an existing one. */
CsProfileFile.reveal = function(path) {
    try {
        openFiles([path], false);
    } catch (e) {
        // no GUI (headless run): nothing to reveal
    }
};
```

- [ ] **Step 4: Write the round-trip proof**

Create `tests/profile_file_roundtrip.js`:

```javascript
// profile_file_roundtrip.js -- proves the profile file keeps its tags.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/profile_file_roundtrip.js "$PWD"
//
// The whole regeneration scheme rests on this: profile geometry is
// found again by its tags, so a writer that drops custom properties
// would leave every past profile undeletable and every redraw would
// double it. Verified, not assumed -- see CsProfileFile.dxfFilter.

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

loadRepoScript("scripts/CaveSurvey/Core/CsTags.js");
loadRepoScript("scripts/CaveSurvey/Core/CsProfileFile.js");

var failures = [];
function ok(cond, what) {
    if (!cond) { failures.push(what); }
}

var tmp = QDir.tempPath() + "/cs_profile_roundtrip.dxf";
new QFile(tmp).remove();

// write a tagged line into a fresh document, export, reimport, read back
var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);
var op = new RAddObjectsOperation();
var line = new RLineEntity(doc,
    new RLineData(new RVector(0, 0), new RVector(10, 5)));
CsTags.set(line, "ProfileShot", "A1->A2");
CsTags.set(line, "ProfileRun", "A");
op.addObject(line, false);
di.applyOperation(op);

var filter = CsProfileFile.dxfFilter();
ok(filter.indexOf("dxflib") >= 0,
    "a dxflib DXF writer is registered (got: '" + filter + "')");
ok(di.exportFile(tmp, filter) === true, "export succeeded");
destr(di);

var back = new RDocument(new RMemoryStorage(), createSpatialIndex());
var backDi = new RDocumentInterface(back);
ok(backDi.importFile(tmp, "", false) === RDocumentInterface.IoErrorNoError,
    "reimport succeeded");

var ids = back.queryAllEntities(false, false);
var foundShot = null, foundRun = null;
for (var i = 0; i < ids.length; i++) {
    var e = back.queryEntity(ids[i]);
    if (isNull(e)) { continue; }
    var v = CsTags.get(e, "ProfileShot");
    if (v !== null && v !== "") {
        foundShot = v;
        foundRun = CsTags.get(e, "ProfileRun");
    }
}
ok(foundShot === "A1->A2", "ProfileShot survived the round trip (got " +
    foundShot + ")");
ok(foundRun === "A", "ProfileRun survived too (got " + foundRun + ")");
destr(backDi);
new QFile(tmp).remove();

// sibling path derivation, in the real engine as well as node
ok(CsProfileFile.siblingPath("/x/Cave.dxf") === "/x/Cave-PROFILE.dxf",
    "sibling path in the CaveCAD engine");

if (failures.length === 0) {
    print("### PROFILE FILE OK");
} else {
    for (i = 0; i < failures.length; i++) {
        print("FAIL  " + failures[i]);
    }
    print("### PROFILE FILE FAIL");
}
```

- [ ] **Step 5: Run both to verify they pass**

Run: `node tests/js_unit.js`
Expected: PASS, count risen by 5.

Run:
```bash
/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/profile_file_roundtrip.js "$PWD"
```
Expected: `### PROFILE FILE OK`

If instead the dxflib assertion fails, STOP and report: the whole tagging scheme depends on it and no later task can compensate.

- [ ] **Step 6: Add it to the suite runner**

In `tests/run_all.sh`, beside the existing QCAD-engine invocations, add a section that runs `tests/profile_file_roundtrip.js` the same way and fails the run on `### PROFILE FILE FAIL` or a missing `### PROFILE FILE OK`. Follow the exact pattern the file already uses for `js_unit.js` — same binary flags, same marker grep, same exit handling.

- [ ] **Step 7: Commit**

```bash
git add scripts/CaveSurvey/Core/CsProfileFile.js tests/js_unit.js tests/profile_file_roundtrip.js tests/run_all.sh
git commit -m "feat(CsProfileFile): the profile's own drawing, and the writer that keeps its tags"
```

---

## Task 8: Drawing a built profile

**Goal:** Draw a `CsProfile.build` result into an explicitly passed document, tagged so a later regeneration can find and replace exactly its own output — and nothing else.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsProfileDraw.js`
- Modify: `tests/js_unit.js` (pure helpers only)
- Create: `tests/profile_draw_roundtrip.js` (headless: draw, sketch, redraw)

**Acceptance Criteria:**
- [ ] `CsProfileDraw.render(doc, di, profile, opts)` draws every band: centerline legs, station points and labels, floor and ceiling polylines, a tick for each near-horizontal splay, and a band label
- [ ] No separate U/D tick and no splay ray is drawn: the U/D measurement is already the first point of its run and a ceiling/floor splay is already a vertex in one, so a second copy would double the sheet's linework for no new information
- [ ] Every entity carries `ProfileRun`, plus its own specific tag from the namespace table
- [ ] A band with a non-zero `zOffset` has that offset applied to every Y it draws, and its label says so
- [ ] `CsProfileDraw.erase(doc, di)` removes an entity only when it is BOTH `Profile*`-tagged AND on a layer in `CsProfileDraw.LAYERS()`. Tag alone is not enough, and the difference is a realistic user action: the obvious cartographer move is to take a generated `CTRL-PROFILE-CEILING` polyline you like and change its layer to `PROFILE-CEILING` to keep it rather than retracing it. XDATA is per-entity and survives a layer change, so a tag-only test destroys that promoted line on the next draw. With the layer condition it stays put and the generator draws a fresh one beside it
- [ ] A test asserts WHICH LAYER each kind of generated entity lands on. Drawing every ceiling run onto `PROFILE_FLOOR` instead left a whole suite green — and that split is the entire payload of the layers task
- [ ] The generated run polylines' `ProfileRun` tag is asserted, not just the flat tick's — Task 11 keys its binding index on `ProfileRun`
- [ ] `ProfileZOffset` is asserted as WRITTEN on a displaced band's caption, not only as absent on an undisplaced one — sketched linework survives, including linework on `PROFILE-FLOOR`/`PROFILE-CEILING`
- [ ] Drawing twice produces the same entity count as drawing once (no duplication)
- [ ] Layers created via `CsLayers.ensure` when the document lacks them, AND both the erase and the add wrapped in `CsLayers.withLayerOn` over the whole layer set. None of these layers ships off, but a user switches `CTRL-PROFILE-CEILING` off precisely in order to trace over it — and this build silently refuses adds AND deletes on an off layer, so the old run survives while the new one is dropped, or a second copy lands beside it. Measured by toggling the layer between two renders
- [ ] Every `Profile*`-tagged entity also carries `ProfileRun`, INCLUDING the station text label — `CsDraw.addText` takes only one tag, so the label needs tagging after the fact, the same pattern `CsDraw.survey` uses for its `Trip*` tags
- [ ] A band with zero stations (stopped at its first station) has `datum === null`. The label's Y must be an explicit constant, documented as NOT a survey-data default, and its text must name the station and reason rather than reading as a normal band. CORRECTION TO AN EARLIER CLAIM IN THIS PLAN: that was a refactor, not a bug fix. `null + TEXT_HEIGHT*4` evaluates to the same number as `0.0 + TEXT_HEIGHT*4`, so nothing was ever drawn at a wrong height — a mutation using `band.datum` directly survives precisely because it is an equivalent mutant. What improved is that the code no longer DEPENDS on null-coercion. The elevation-datum convention is the place where an inflated claim is most expensive, so it is corrected here
- [ ] `zOffset` is actually applied to drawn geometry — assert a real drawn COORDINATE, not just counts and tags. A full test suite once passed with `zOffset` never applied at all, because nothing checked a coordinate

**Verify:** `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/profile_draw_roundtrip.js "$PWD"` → `### PROFILE DRAW OK`

Note: `CsProfileDraw.render` takes `(doc, di)` explicitly rather than calling `getDocument()`. That is not a style preference — the profile is in a sibling drawing that is usually not the current one, and `getDocument()` would draw the elevation on top of the plan.

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `tests/profile_draw_roundtrip.js`:

```javascript
// profile_draw_roundtrip.js -- draw a profile, sketch on it, draw again.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/profile_draw_roundtrip.js "$PWD"
//
// The two claims that matter for a file the user draws on:
//   1. regeneration replaces the generator's own output, not the
//      user's -- a hand-drawn wall is still there afterwards;
//   2. regeneration does not DOUBLE the generator's output.

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

var CORE = ["CsUnits", "CsCave", "CsGeoProject", "CsAngles", "CsIgrfCoeffs",
    "CsGeomag", "CsModel", "CsTraverse", "CsNetwork", "CsAdjust", "CsLrud",
    "CsValidate", "CsStats", "CsGrade", "CsTags", "CsLayers", "CsDraw",
    "CsProfile", "CsProfileDraw"];
for (var c = 0; c < CORE.length; c++) {
    loadRepoScript("scripts/CaveSurvey/Core/" + CORE[c] + ".js");
}

var failures = [];
function ok(cond, what) {
    if (!cond) { failures.push(what); }
}

function shotOf(from, to, d, az, inc, u, dn) {
    var s = CsModel.newShot();
    s.from = from; s.to = to; s.distance = d; s.azimuth = az;
    s.inclination = inc || 0;
    s.up = (u === undefined) ? null : u;
    s.down = (dn === undefined) ? null : dn;
    return s;
}

var sv = CsModel.newSurvey();
sv.shots = [
    shotOf("A1", "A2", 10, 0, 0, 4, 2),
    shotOf("A2", "A3", 10, 0, -10, 4, 2),
    shotOf("A2", "A2a1", 6, 90, 0, 3, 1)
];
var resolved = CsNetwork.resolve(sv, {});
var profile = CsProfile.build(sv, resolved, {});

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);

var first = CsProfileDraw.render(doc, di, profile, {});
ok(first.bandsDrawn === 2, "two bands drawn (got " + first.bandsDrawn + ")");
ok(first.legsDrawn === 3, "three legs drawn (got " + first.legsDrawn + ")");
var afterFirst = doc.queryAllEntities(false, false).length;
ok(afterFirst > 0, "the profile actually put entities in the document");

// the user sketches a wall on a traceable layer
CsLayers.ensure(doc, di, "PROFILE-CEILING");
var op = new RAddObjectsOperation();
var sketch = new RLineEntity(doc,
    new RLineData(new RVector(0, 5), new RVector(20, 6)));
sketch.setLayerId(doc.getLayerId("PROFILE-CEILING"));
op.addObject(sketch, false);
di.applyOperation(op);
var sketchId = sketch.getId();
ok(sketchId > 0, "the sketch landed");

// regenerate
var second = CsProfileDraw.render(doc, di, profile, {});
ok(second.bandsDrawn === 2, "redraw drew the same two bands");

ok(!isNull(doc.queryEntity(sketchId)),
    "THE SKETCH SURVIVED REGENERATION");

var afterSecond = doc.queryAllEntities(false, false).length;
ok(afterSecond === afterFirst + 1,
    "redraw replaced its own output instead of doubling it (was " +
    afterFirst + " + 1 sketch, now " + afterSecond + ")");

destr(di);

if (failures.length === 0) {
    print("### PROFILE DRAW OK");
} else {
    for (var i = 0; i < failures.length; i++) {
        print("FAIL  " + failures[i]);
    }
    print("### PROFILE DRAW FAIL");
}
```

- [ ] **Step 2: Run it to verify it fails**

Run:
```bash
/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/profile_draw_roundtrip.js "$PWD"
```
Expected: FAIL — `cannot open scripts/CaveSurvey/Core/CsProfileDraw.js`.

- [ ] **Step 3: Write the implementation**

Create `scripts/CaveSurvey/Core/CsProfileDraw.js`:

```javascript
// CsProfileDraw.js -- putting a built extended elevation into a drawing.
//
// Part of the Cave Survey Core library. QCAD context only: every
// function here takes the document and interface EXPLICITLY, because
// the profile lives in a sibling drawing that is usually not the
// current one -- getDocument() would draw the profile on top of the
// plan.
//
// TAG NAMESPACE. Profile geometry carries Profile* tags, a namespace of
// its own, so that plan-side scanners (CsDraw.eraseStations,
// RebuildSurveyData, CsRevise) can never mistake an elevation for a
// plan even if the two drawings are one day merged. erase() keys on
// exactly this namespace, which is what makes regeneration replace the
// generator's own output and leave hand-drawn work alone.
//
//   ProfileRun         every entity of a band: its run key
//   ProfileStation     station point and its label
//   ProfileShot        centerline leg, "A1->A2"
//   ProfileSplay       splay ray, tip, or flat tick
//   ProfileFloorRun    generated floor polyline
//   ProfileCeilingRun  generated ceiling polyline
//   ProfileBandLabel   the band's caption
//   ProfileZOffset     on the caption: the datum shift, when displaced

var CsProfileDraw = {};

CsProfileDraw.TAGS = ["ProfileRun", "ProfileStation", "ProfileShot",
    "ProfileSplay", "ProfileFloorRun", "ProfileCeilingRun",
    "ProfileBandLabel", "ProfileZOffset"];

/** Layers the profile writes to, created if the drawing lacks them. */
CsProfileDraw.LAYERS = function() {
    return [CsLayers.SHOTS, CsLayers.STATIONS, CsLayers.STATION_LABELS,
        CsLayers.LRUD, CsLayers.SPLAYS, CsLayers.PROFILE_FLOOR,
        CsLayers.PROFILE_CEILING, CsLayers.TEXT_LABELS];
};

/**
 * Erases every entity this module drew, and only those.
 *
 * Any Profile* tag marks an entity as ours. Nothing else is touched:
 * hand-drawn linework on PROFILE-FLOOR / PROFILE-CEILING carries no
 * Profile* tag, so it is invisible to this scan -- which is the whole
 * reason the generated lines went onto CTRL- layers of their own.
 *
 * Off layers refuse deletes as silently as they refuse adds in this
 * build, so the delete runs inside withLayerOn for each layer that
 * might be off; without that the entities survive and the next render
 * doubles them.
 *
 * \return number of entities removed
 */
CsProfileDraw.erase = function(doc, di) {
    var victims = [];
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        for (var t = 0; t < CsProfileDraw.TAGS.length; t++) {
            var v = CsTags.get(e, CsProfileDraw.TAGS[t]);
            if (v !== null && v !== "") {
                victims.push(ids[i]);
                break;
            }
        }
    }
    if (victims.length === 0) {
        return 0;
    }
    var op = new RDeleteObjectsOperation();
    op.setText("Erase generated profile");
    for (i = 0; i < victims.length; i++) {
        var ent = doc.queryEntity(victims[i]);
        if (!isNull(ent)) {
            op.deleteObject(ent);
        }
    }
    di.applyOperation(op);
    return victims.length;
};

/**
 * Draws a whole built profile.
 *
 * \param profile CsProfile.build() result
 * \param opts    {labelBands: bool (default true)}
 * \return {bandsDrawn, legsDrawn, stationsDrawn, ceilingRuns,
 *          floorRuns, splaysDrawn, flatTicks, erased}
 */
CsProfileDraw.render = function(doc, di, profile, opts) {
    opts = opts || {};
    var layers = CsProfileDraw.LAYERS();
    for (var l = 0; l < layers.length; l++) {
        CsLayers.ensure(doc, di, layers[l]);
    }

    var erased = CsProfileDraw.erase(doc, di);

    var counts = { bandsDrawn: 0, legsDrawn: 0, stationsDrawn: 0,
        ceilingRuns: 0, floorRuns: 0, flatTicks: 0, erased: erased };

    var op = new RAddObjectsOperation();
    op.setText("Draw extended elevation");

    for (var b = 0; b < profile.bands.length; b++) {
        CsProfileDraw.band(doc, op, profile.bands[b], counts, opts);
        counts.bandsDrawn++;
    }

    di.applyOperation(op);
    return counts;
};

/** One band, into an operation already open. */
CsProfileDraw.band = function(doc, op, band, counts, opts) {
    var dz = band.zOffset || 0.0;
    var at = function(x, y) {
        return new RVector(x, y + dz);
    };
    var runTag = { ProfileRun: band.key };
    var i;

    for (i = 0; i < band.legs.length; i++) {
        var leg = band.legs[i];
        CsDraw.addLine(doc, op, CsLayers.SHOTS,
            at(leg.fromX, leg.fromY), at(leg.toX, leg.toY),
            "ProfileShot", leg.from + "->" + leg.to, runTag);
        counts.legsDrawn++;
    }

    for (i = 0; i < band.stations.length; i++) {
        var st = band.stations[i];
        var pt = CsDraw.addPoint(doc, op, CsLayers.STATIONS, at(st.x, st.y));
        CsTags.set(pt, "ProfileStation", st.name);
        CsTags.set(pt, "ProfileRun", band.key);
        op.addObject(pt, false);
        counts.stationsDrawn++;

        CsDraw.addText(doc, op, CsLayers.STATION_LABELS, st.name,
            at(st.x, st.y + CsDraw.TEXT_HEIGHT * 1.5), RS.HAlignCenter,
            "ProfileStation", st.name);
    }

    for (i = 0; i < band.ceiling.length; i++) {
        CsProfileDraw.run(doc, op, CsLayers.PROFILE_CEILING,
            band.ceiling[i], at, "ProfileCeilingRun",
            band.key + "." + (i + 1), band.key);
        counts.ceilingRuns++;
    }
    for (i = 0; i < band.floor.length; i++) {
        CsProfileDraw.run(doc, op, CsLayers.PROFILE_FLOOR,
            band.floor[i], at, "ProfileFloorRun",
            band.key + "." + (i + 1), band.key);
        counts.floorRuns++;
    }

    for (i = 0; i < band.flat.length; i++) {
        var f = band.flat[i];
        var half = CsDraw.TEXT_HEIGHT;
        CsDraw.addLine(doc, op, CsLayers.SPLAYS,
            at(f.x, f.y - half), at(f.x, f.y + half),
            "ProfileSplay", f.name, runTag);
        counts.flatTicks++;
    }

    if (opts.labelBands !== false) {
        CsProfileDraw.label(doc, op, band, at);
    }
};

/** One generated polyline. */
CsProfileDraw.run = function(doc, op, layerName, points, at, tagKey,
        tagValue, runKey) {
    if (points.length < 2) {
        return;
    }
    // vertices go into the DATA, then the data into the entity -- the
    // same order CsDraw's wall runs use; there is no appendVertex on
    // the entity in this bridge
    var data = new RPolylineData();
    for (var i = 0; i < points.length; i++) {
        data.appendVertex(at(points[i].x, points[i].y));
    }
    var pl = new RPolylineEntity(doc, data);
    pl.setLayerId(doc.getLayerId(layerName));
    CsTags.set(pl, tagKey, tagValue);
    CsTags.set(pl, "ProfileRun", runKey);
    op.addObject(pl, false);
};

/**
 * The band's caption: its run, and -- when the band had to be pushed
 * off true elevation to clear another -- by how much. A displaced band
 * that did not say so would misinform a reader about depth, so the
 * offset is both written and tagged.
 */
CsProfileDraw.label = function(doc, op, band, at) {
    var text = band.key + " SURVEY";
    if (band.tie !== null && band.tie !== undefined && band.tie !== "") {
        text += " (FROM " + band.tie + ")";
    }
    var dz = band.zOffset || 0.0;
    if (Math.abs(dz) > 1e-9) {
        text += " -- SHOWN " + Math.abs(dz).toFixed(1) +
            (dz < 0 ? " BELOW" : " ABOVE") + " TRUE ELEVATION";
    }
    var y = (band.stations.length > 0) ? band.stations[0].y : band.datum;
    var label = CsDraw.addText(doc, op, CsLayers.TEXT_LABELS, text,
        at(0, y + CsDraw.TEXT_HEIGHT * 4.0), RS.HAlignLeft,
        "ProfileBandLabel", band.key);
    CsTags.set(label, "ProfileRun", band.key);
    if (Math.abs(dz) > 1e-9) {
        CsTags.set(label, "ProfileZOffset", String(dz));
    }
};
```

- [ ] **Step 4: Run it to verify it passes**

Run:
```bash
/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/profile_draw_roundtrip.js "$PWD"
```
Expected: `### PROFILE DRAW OK`

- [ ] **Step 5: Add it to the suite runner**

Add `tests/profile_draw_roundtrip.js` to `tests/run_all.sh` the same way Task 7 added the file round-trip: same binary flags, marker grep on `### PROFILE DRAW OK`, run fails on the FAIL marker.

- [ ] **Step 6: Commit**

```bash
git add scripts/CaveSurvey/Core/CsProfileDraw.js tests/profile_draw_roundtrip.js tests/run_all.sh
git commit -m "feat(CsProfileDraw): draw the elevation, replace only what it drew before"
```

---

## Task 9: Hook it into the plan draw, plus settings and the report

**Goal:** Every plan draw refreshes the profile, with settings to steer it and a report line for everything the profile could not show.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsDraw.js` (end of `CsDraw.survey`)
- Modify: `scripts/CaveSurvey/Core/CsReport.js`
- Modify: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `CsProfile.settings()` reads `CaveSurvey/ProfileAuto` (default true), `CaveSurvey/ProfileVerticalExaggeration` (default 1.0), `CaveSurvey/ProfileFlatSplayDeg` (default 10), `CaveSurvey/ProfileAutoMaxStations` (default 3000)
- [ ] Above `ProfileAutoMaxStations` the AUTOMATIC pass is skipped and the report says so, naming the manual command. Measured reason: the chain search is quadratic in run length and CaveCAD's engine runs it ~7x slower than node — ~470 ms for one 1000-station run, ~2 s at 2000 — and this runs on every draw. A draw that silently takes seconds longer is worse than one that says why it declined. The manual `GenerateProfile` command is never gated
- [ ] `CsDraw.survey` calls `CsDraw.profile(survey, resolved)` at its end, after `CsStore.migrate`, and includes the outcome in its return value as `profile`
- [ ] With `ProfileAuto` false, nothing is opened, written, or created
- [ ] An unsaved plan drawing produces `{skipped: true, reason: "..."}` and no file
- [ ] The profile pass never throws into the plan draw: a failure is caught, reported, and the plan draw still returns normally
- [ ] `CsReport.profileSummary(profile, outcome)` prints bands, legs, floor/ceiling runs, flat ticks, omitted stations, tie mismatches, second ties, orphan runs, and any station with no resolved Z

**Verify:** `node tests/js_unit.js` → `### UNIT OK`; then `./tests/run_all.sh` → `ALL TESTS PASSED`

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `tests/js_unit.js`:

```javascript
(function() {
    // the report must name every finding, or a silent omission looks
    // like a complete profile
    var sv = CsModel.newSurvey();
    sv.shots = [
        shotOf("A13", "A14", 10, 0, 0),
        shotOf("A14", "A13a1", 5, 90, 0),
        shotOf("A14", "A99", 3, 270, 0)
    ];
    var r = CsNetwork.resolve(sv, {});
    var p = CsProfile.build(sv, r, {});
    var text = CsReport.profileSummary(p, {
        path: "/x/Cave-PROFILE.dxf", created: true,
        counts: { bandsDrawn: 2, legsDrawn: 3, stationsDrawn: 4,
            ceilingRuns: 0, floorRuns: 0, flatTicks: 0, erased: 0 }
    });

    ok(text.indexOf("Cave-PROFILE.dxf") >= 0, "report names the file");
    ok(text.indexOf("A13a") >= 0, "report names the mismatching run");
    ok(text.indexOf("A99") >= 0, "report names the omitted station");
    ok(text.length > 0, "report is not empty");

    var skipped = CsReport.profileSummary(null,
        { skipped: true, reason: "the drawing has no file name yet" });
    ok(skipped.indexOf("no file name") >= 0,
        "a skipped profile says why in words");
}());

(function() {
    var s = CsProfile.settings();
    ok(s.exaggeration === 1.0 || typeof s.exaggeration === "number",
        "exaggeration is a number");
    ok(typeof s.flatSplayDeg === "number", "dead zone is a number");
    ok(typeof s.auto === "boolean", "auto is a boolean");
}());
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tests/js_unit.js`
Expected: FAIL — `CsReport.profileSummary is not a function`.

- [ ] **Step 3: Add the settings reader**

Append to `scripts/CaveSurvey/Core/CsProfile.js`:

```javascript
/**
 * The settings in force. Reads RSettings when there is one and falls
 * back to the defaults under node, so the pure tests can call it.
 *
 * ProfileAuto defaults TRUE: the user asked for the profile to be a
 * product of drawing, not a command to remember.
 */
CsProfile.settings = function() {
    var auto = true, exag = 1.0, dead = CsProfile.FLAT_SPLAY_DEG;
    try {
        auto = RSettings.getBoolValue("CaveSurvey/ProfileAuto", true);
        exag = RSettings.getDoubleValue(
            "CaveSurvey/ProfileVerticalExaggeration", 1.0);
        dead = RSettings.getDoubleValue("CaveSurvey/ProfileFlatSplayDeg",
            CsProfile.FLAT_SPLAY_DEG);
    } catch (e) {
        // no RSettings (node): the defaults above stand
    }
    if (!(exag > 0)) {
        exag = 1.0;   // a zero or negative exaggeration would flatten the cave
    }
    if (!(dead >= 0)) {
        dead = CsProfile.FLAT_SPLAY_DEG;
    }
    return { auto: auto, exaggeration: exag, flatSplayDeg: dead };
};
```

- [ ] **Step 4: Add the report**

Append to `scripts/CaveSurvey/Core/CsReport.js`:

```javascript
/**
 * What the extended elevation drew, and what it could not show.
 *
 * The findings half is the point: a profile that quietly dropped a
 * side lead or drew a spur at the wrong junction looks exactly like a
 * complete one. Everything omitted is named.
 */
CsReport.profileSummary = function(profile, outcome) {
    var lines = [];
    if (outcome !== undefined && outcome !== null && outcome.skipped) {
        lines.push("Profile: not written -- " + outcome.reason + ".");
        return lines.join("\n");
    }
    if (profile === null || profile === undefined) {
        return "Profile: nothing to draw.";
    }

    var c = (outcome && outcome.counts) ? outcome.counts : {};
    var where = (outcome && outcome.path) ? outcome.path : "the profile drawing";
    lines.push("Profile " + (outcome && outcome.created ? "created" : "updated") +
        ": " + where);
    lines.push("  " + (c.bandsDrawn || 0) + " band(s), " +
        (c.legsDrawn || 0) + " leg(s), " + (c.stationsDrawn || 0) +
        " station(s)");
    lines.push("  " + (c.ceilingRuns || 0) + " ceiling run(s), " +
        (c.floorRuns || 0) + " floor run(s), " + (c.flatTicks || 0) +
        " level splay tick(s)");
    // level splays are counted, not hidden: a splay inside the dead
    // zone contributed nothing to either line, and a reader who cannot
    // see how many there were cannot judge whether the dead zone is
    // set sensibly for this cave

    var f = profile.findings;
    var i;
    if (f.mismatches.length > 0) {
        for (i = 0; i < f.mismatches.length; i++) {
            lines.push("  CHECK the name: run " + f.mismatches[i].run +
                " reads as a spur of " + f.mismatches[i].expected +
                " but ties in at " + f.mismatches[i].actual +
                " -- drawn at the surveyed junction");
        }
    }
    if (f.omitted.length > 0) {
        lines.push("  off the main chain, not drawn: " + f.omitted.join(", "));
    }
    if (f.secondTies.length > 0) {
        for (i = 0; i < f.secondTies.length; i++) {
            lines.push("  run " + f.secondTies[i].run +
                " also touches " + f.secondTies[i].otherStation +
                " (drawn as a tie line, not a second band)");
        }
    }
    if (f.orphans.length > 0) {
        // Disconnected means exactly that: no leg of any kind reaches
        // the rest of the cave. This one IS actionable -- a connecting
        // shot is missing.
        lines.push("  no connection to the rest of the survey, a tie " +
            "shot is missing: " + f.orphans.join(", "));
    }
    if (f.strandedRoots !== undefined && f.strandedRoots.length > 0) {
        // Connected, but not attached as anyone's child. The data is
        // fine and nothing needs surveying -- the band simply starts its
        // own stack. Saying "no connection" here would send someone
        // hunting for a shot that already exists.
        lines.push("  connected, but drawn as its own band rather than " +
            "hanging off another: " + f.strandedRoots.join(", "));
    }
    if (f.stopped.length > 0) {
        // stoppedReason distinguishes "this station has no elevation"
        // from "no leg reaches it" -- a reader can act on the first and
        // only the second points at a gap in the drawn chain.
        for (i = 0; i < f.stopped.length; i++) {
            var st = f.stopped[i];
            var why = (st.reason === "no-leg") ?
                "no leg reaches it" : "no resolved elevation";
            lines.push("  band stopped at " + st.station + ": " + why);
        }
    }
    if (f.ungrouped.length > 0) {
        lines.push("  station names that could not be read as a run: " +
            f.ungrouped.join(", "));
    }
    return lines.join("\n");
};
```

- [ ] **Step 5: Hook the plan draw**

In `scripts/CaveSurvey/Core/CsDraw.js`, immediately after the `CsStore.migrate(doc, di);` line near the end of `CsDraw.survey`, and before its `return`:

```javascript
    // The extended elevation is a PRODUCT of drawing, not a command to
    // remember: every notebook Draw, import and revision redraw
    // refreshes the sibling profile file. Gated by CaveSurvey/
    // ProfileAuto (default true). Wrapped whole: a profile that cannot
    // be written must never take the plan draw down with it -- the plan
    // is the drawing the user is looking at.
    var profileOutcome = { skipped: true, reason: "profile pass not run" };
    try {
        profileOutcome = CsDraw.profile(survey, resolved);
    } catch (eProfile) {
        profileOutcome = { skipped: true,
            reason: "profile pass failed: " + eProfile };
    }
```

and add `profile: profileOutcome` to the returned object.

Then add the function itself, after `CsDraw.survey`:

```javascript
/**
 * Refreshes the sibling extended elevation for the CURRENT drawing.
 *
 * Everything document-shaped happens here; the geometry is CsProfile's
 * and the drawing is CsProfileDraw's. The one thing this function owns
 * is the decision about WHERE: an already-open profile tab is drawn
 * into directly (so the user's own view updates and their undo still
 * works), and otherwise the file is built off screen and revealed.
 *
 * \return {skipped, reason} or {path, created, counts, profile}
 */
CsDraw.profile = function(survey, resolved) {
    var settings = CsProfile.settings();
    if (!settings.auto) {
        return { skipped: true,
            reason: "CaveSurvey/ProfileAuto is off" };
    }

    var planPath = getDocument().getFileName();
    var target = CsProfileFile.resolve(planPath);
    if (target.doc === null) {
        return { skipped: true, reason: target.reason };
    }

    var built = CsProfile.build(survey, resolved, {
        exaggeration: settings.exaggeration,
        flatSplayDeg: settings.flatSplayDeg
    });
    var counts = CsProfileDraw.render(target.doc, target.di, built, {});

    var written = CsProfileFile.commit(target);
    if (!written) {
        return { skipped: true,
            reason: "could not write " + target.path };
    }
    if (target.created) {
        CsProfileFile.reveal(target.path);
    }

    return { path: target.path, created: target.created,
        counts: counts, profile: built };
};
```

`CsDraw.js` must `include` nothing new — `CsAll.js` is what loads the Core, so add `CsProfile.js`, `CsProfileFile.js` and `CsProfileDraw.js` there, after `CsLrud.js` and before `CsDraw.js`, matching the existing order.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node tests/js_unit.js`
Expected: PASS, count risen by 8.

Run: `./tests/run_all.sh`
Expected: `ALL TESTS PASSED`

- [ ] **Step 7: Commit**

```bash
git add scripts/CaveSurvey/Core/CsProfile.js scripts/CaveSurvey/Core/CsReport.js scripts/CaveSurvey/Core/CsDraw.js scripts/CaveSurvey/Core/CsAll.js tests/js_unit.js
git commit -m "feat(CsDraw): every plan draw refreshes the sibling elevation"
```

---

## Task 10: The Generate Profile tool

**Goal:** A menu tool that forces a rebuild and shows the report, wired the way every tool in this suite must be wired or it vanishes from the menu silently.

**Files:**
- Create: `scripts/CaveSurvey/GenerateProfile/GenerateProfile.js`
- Create: `scripts/CaveSurvey/GenerateProfile/GenerateProfile.svg`
- Modify: `README.md` (tool table row — a structural test fails without it)

**Acceptance Criteria:**
- [ ] Folder name matches the tool name; both `.js` and `.svg` present
- [ ] `setSortOrder(75)` — free between Survey Stats (70) and Build Legend (78); group sort order 450 like every other tool
- [ ] Command aliases `genprofile` / `gp`, both listed in the README table row
- [ ] Rebuilds from the drawing's own survey model (`CsTags.surveyFromDocument`), so it works without the notebook being open
- [ ] Multi-line report shown via `QMessageBox.information`, never `EAction.handleUserMessage`
- [ ] `./tests/run_all.sh` green, including the README-vs-tools structural test

**Verify:** `./tests/run_all.sh` → `ALL TESTS PASSED`

**Steps:**

- [ ] **Step 1: Add the README row (the failing structural check)**

In `README.md`, in the `## The tools` table, after the Survey Stats row:

```markdown
| Generate Profile | `gp` | Rebuild the extended elevation beside the plan: one band per survey run, floor and ceiling lines from LRUD and splays. Normally happens on its own with every draw -- this forces it and prints what it could not show. |
```

- [ ] **Step 2: Run the structural test to verify it fails**

Run: `python3 -m unittest tests.test_addon -v`
Expected: FAIL — the README advertises `gp`, which no shipped tool declares.

- [ ] **Step 3: Write the tool**

Create `scripts/CaveSurvey/GenerateProfile/GenerateProfile.js`:

```javascript
// GenerateProfile.js -- force a rebuild of the extended elevation.
//
// The profile normally refreshes itself with every plan draw
// (CsDraw.profile, gated by CaveSurvey/ProfileAuto), so this tool
// exists for the two cases that gate cannot cover: the setting is off,
// or the user wants to SEE the report -- which names every side lead
// left out, every spur whose name disagrees with its surveyed
// junction, and every station with no resolved elevation.

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function GenerateProfile(guiAction) {
    EAction.call(this, guiAction);
}

GenerateProfile.prototype = new EAction();

GenerateProfile.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    GenerateProfile.run();
    this.terminate();
};

GenerateProfile.run = function() {
    var doc = getDocument();
    if (isNull(doc)) {
        return;
    }

    // From the DRAWING, not from a notebook that may not be open: the
    // survey model lives on the entities (goal B6), so a profile can be
    // rebuilt from any drawing the suite has ever drawn.
    var survey = CsTags.surveyFromDocument(doc);
    if (survey === null || survey.shots.length === 0) {
        EAction.handleUserWarning("Generate Profile: this drawing holds " +
            "no survey data to profile.");
        return;
    }

    var settings = CsProfile.settings();
    var resolved = CsNetwork.resolve(survey, {});
    var target = CsProfileFile.resolve(doc.getFileName());
    if (target.doc === null) {
        EAction.handleUserWarning("Generate Profile: " + target.reason + ".");
        return;
    }

    var built = CsProfile.build(survey, resolved, {
        exaggeration: settings.exaggeration,
        flatSplayDeg: settings.flatSplayDeg
    });
    var counts = CsProfileDraw.render(target.doc, target.di, built, {});
    if (!CsProfileFile.commit(target)) {
        EAction.handleUserWarning("Generate Profile: could not write " +
            target.path + ".");
        return;
    }
    CsProfileFile.reveal(target.path);

    var text = CsReport.profileSummary(built, {
        path: target.path, created: target.created, counts: counts
    });
    // handleUserMessage collapses newlines (RS.escape does not convert
    // them and the result is parsed as rich text), so a multi-line
    // report has to be a message box -- SurveyStats does the same.
    try {
        QMessageBox.information(RMainWindowQt.getMainWindow(),
            qsTr("Generate Profile"), text);
    } catch (e) {
        EAction.handleUserMessage(text.replace(/\n/g, "  "));
    }
};

GenerateProfile.init = function(basePath) {
    var action = new RGuiAction(qsTr("Generate Profile"),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/GenerateProfile.js");
    action.setIcon(basePath + "/GenerateProfile.svg");
    action.setStatusTip(qsTr("Rebuild the extended elevation beside the plan"));
    action.setDefaultCommands(["genprofile", "gp"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(75);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
```

- [ ] **Step 4: Draw the icon**

Create `scripts/CaveSurvey/GenerateProfile/GenerateProfile.svg` — a side view: a centerline with a ceiling line above and a floor line below.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
  <polyline points="2,7 7,5 12,8 17,6 22,8" fill="none" stroke="#444" stroke-width="1.6"/>
  <polyline points="2,12 7,12 12,13 17,12 22,13" fill="none" stroke="#888" stroke-width="1" stroke-dasharray="3,2"/>
  <polyline points="2,18 7,19 12,17 17,20 22,18" fill="none" stroke="#444" stroke-width="1.6"/>
</svg>
```

Match the existing icons' size and stroke weight; compare against `SurveyStats/SurveyStats.svg` and adjust if it reads heavier or lighter than its neighbours in the toolbar.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `./tests/run_all.sh`
Expected: `ALL TESTS PASSED` — including the README table check and the structural checks on folder layout, `Cs` prefixes, and add-on wiring.

- [ ] **Step 6: Commit**

```bash
git add scripts/CaveSurvey/GenerateProfile README.md
git commit -m "feat(GenerateProfile): force the elevation and show what it could not draw"
```

---

## Task 11: Sketched linework moves with the survey

**Goal:** When a regeneration moves a station, hand-drawn profile linework moves with it — the same guarantee the plan has, through the same mover.

**Why it needs its own module.** `CsBind` binds a plan sketch by matching its vertices against `Station`/`LRUDName`/`SplayName`-tagged geometry (`CsBind.stationIndex`). The profile drawing has none of those tags — its station points carry `ProfileStation` — so plan binding would find nothing and every profile sketch would fall back to the trip, or to nothing. And a profile station name is not unique within the drawing: a tie station appears once in its own band and once at the origin of every band hanging off it. Binding therefore keys on **run-qualified** names (`A/A2`), which is also exactly the key `CsRevise.moveLinework` needs, since it does nothing but look names up in two maps.

**What is reused unchanged:** `CsRevise.moveLinework` (and through it `CsRevise.similarityFit`, rotation and all, per the user's decision), plus `CsBind`'s pure inference — `stationsForPoints`, `pointsOf`, `boxOf`, `boxOfPoints`, `marginFor`, `stationsInBox`, `encodeStations`, `decodeStations`, `epsilonFor`, `isLineworkLayer`, `hasLineworkTags`, `isSuiteGeometry`. Only the index is new.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsProfileBind.js`
- Modify: `scripts/CaveSurvey/Core/CsProfileDraw.js` (render reads positions before erasing, moves after drawing)
- Modify: `scripts/CaveSurvey/Core/CsAll.js`
- Modify: `tests/profile_draw_roundtrip.js` (extend: prove the sketch MOVED, not merely survived)

**Acceptance Criteria:**
- [ ] `CsProfileBind.stationIndex(doc)` returns `[{name, x, y}]` with `name` run-qualified (`"A/A2"`), built from `ProfileStation` + `ProfileRun` tags
- [ ] `CsProfileBind.key(run, station)` is the single definition of that composite, used by the index, the binder and the position maps — no second spelling anywhere
- [ ] `CsProfileBind.claim(doc, di)` tags untagged linework-layer entities with `LineworkStations` holding run-qualified names, and never touches an entity carrying a `Profile*` tag
- [ ] `CsProfileBind.positions(doc)` reads the CURRENT profile station positions as `{key: {x, y}}` — the "before" frame
- [ ] `CsProfileDraw.positionsOf(profile)` returns the "after" frame from built bands, `zOffset` included
- [ ] THE MOVE MUST RUN INSIDE `CsRevise.withOffLayersOn`, NOT `CsProfileDraw.withOwnLayersOn`. The move MODIFIES the sketch, which lives on `PROFILE-FLOOR`/`PROFILE-CEILING` — layers deliberately NOT in `CsProfileDraw.LAYERS()`. This build refuses MODIFIES on an off layer as silently as adds and deletes, so if the user has hidden their tracing layer — the exact workflow that motivated the off-layer protection — the move is silently dropped and the sketch stays behind while the survey moves under it. `CsRevise.withOffLayersOn` already sweeps every layer holding entities, which is what is needed: Task 11 cannot know which layers a user chose to trace on, so widening `withOwnLayersOn` is the wrong fix
- [ ] `render` order is: claim → read before-positions → erase → draw → move. Read after the erase and the before-frame is gone; move before the draw and there is nothing to move toward
- [ ] The move is skipped entirely when `CsRevise.positionsMoved` reports nothing moved (a redraw that only adds a band must not cost an undo step)
- [ ] Tolerance and the moved test both come from `CsRevise.positionsExtent`/`positionsMoved` — no second definition of drawing size in this module
- [ ] A sketched line bound to two stations follows a survey change that shifts those stations, and its move is reported in `counts.linework`
- [ ] An unbound sketch (drawn nowhere near any station) is left where it is and named in `counts.unmoved`

**Verify:** `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/profile_draw_roundtrip.js "$PWD"` → `### PROFILE DRAW OK`

**Steps:**

- [ ] **Step 1: Write the failing test**

Append to `tests/profile_draw_roundtrip.js`, before its final marker print (and add `"CsRevise"`, `"CsBind"`, `"CsProfileBind"` to that file's `CORE` list, `CsRevise` before `CsBind` — `CsBind`'s layer gate consults `CsRevise.isWorldFixedLayer` when it is loaded):

```javascript
// ---- the sketch must MOVE, not merely survive ----------------------
(function() {
    var sv2 = CsModel.newSurvey();
    sv2.shots = [
        shotOf("A1", "A2", 10, 0, 0, 4, 2),
        shotOf("A2", "A3", 10, 0, 0, 4, 2)
    ];
    var res2 = CsNetwork.resolve(sv2, {});
    var built = CsProfile.build(sv2, res2, {});

    var d2 = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var i2 = new RDocumentInterface(d2);
    CsProfileDraw.render(d2, i2, built, {});

    // trace a ceiling line snapped onto the generated ceiling points of
    // A2 and A3: exact coincidence, which is the strong binding signal
    var bandA = built.bands[0];
    var p2 = null, p3 = null;
    for (var i = 0; i < bandA.stations.length; i++) {
        if (bandA.stations[i].name === "A2") { p2 = bandA.stations[i]; }
        if (bandA.stations[i].name === "A3") { p3 = bandA.stations[i]; }
    }
    CsLayers.ensure(d2, i2, "PROFILE-CEILING");
    var op2 = new RAddObjectsOperation();
    var traced = new RLineEntity(d2, new RLineData(
        new RVector(p2.x, p2.y + 4), new RVector(p3.x, p3.y + 4)));
    traced.setLayerId(d2.getLayerId("PROFILE-CEILING"));
    op2.addObject(traced, false);
    i2.applyOperation(op2);
    var tracedId = traced.getId();

    // now the survey changes: the first leg was really 20 ft, so
    // everything downstream slides 10 ft along the profile
    sv2.shots[0].distance = 20;
    var res3 = CsNetwork.resolve(sv2, {});
    var rebuilt = CsProfile.build(sv2, res3, {});
    var counts = CsProfileDraw.render(d2, i2, rebuilt, {});

    var after = d2.queryEntity(tracedId);
    ok(!isNull(after), "the traced line still exists after regeneration");
    if (!isNull(after)) {
        var moved = after.getStartPoint();
        near(moved.x, p2.x + 10, 0.001,
            "THE TRACED LINE MOVED WITH ITS STATIONS (x " + moved.x +
            ", expected " + (p2.x + 10) + ")");
    }
    ok(counts.linework !== undefined && counts.linework.moved >= 1,
        "the move is reported (" + JSON.stringify(counts.linework) + ")");
    destr(i2);
}());
```

This test needs `near` and a `shotOf` taking U/D; the file already defines both from Task 8.

- [ ] **Step 2: Run it to verify it fails**

Run:
```bash
/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/profile_draw_roundtrip.js "$PWD"
```
Expected: FAIL — `cannot open scripts/CaveSurvey/Core/CsProfileBind.js`.

- [ ] **Step 3: Write the binder**

Create `scripts/CaveSurvey/Core/CsProfileBind.js`:

```javascript
// CsProfileBind.js -- which profile stations a hand-drawn line belongs
// to, so that a regeneration MOVES it instead of leaving it behind.
//
// Part of the Cave Survey Core library. QCAD context only.
//
// The plan already solves this problem (CsBind + CsRevise.moveLinework)
// and this module changes exactly one thing about it: the INDEX. Plan
// binding matches a sketch's vertices against Station / LRUDName /
// SplayName tagged geometry; a profile drawing carries none of those,
// its station points carry ProfileStation. Point the same inference at
// a different index and the whole apparatus works here.
//
// WHY THE KEYS ARE RUN-QUALIFIED. A station name is not unique in a
// profile drawing: a tie station appears once in its own band and again
// at the origin of every band hanging off it, at different coordinates.
// "A2" alone cannot say which copy a sketch was traced against, so
// every key here is run + "/" + station. CsRevise.moveLinework does
// nothing but look names up in two maps, so a composite key costs it
// nothing -- both frames simply have to agree, which is why key() is
// the only place the composite is spelled.

var CsProfileBind = {};

/** The one spelling of a profile station's key. */
CsProfileBind.key = function(run, station) {
    return String(run) + "/" + String(station);
};

/**
 * Profile station positions as a binding index: [{name, x, y}] with
 * run-qualified names, which is the shape CsBind's inference expects.
 */
CsProfileBind.stationIndex = function(doc) {
    var out = [];
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || typeof e.getPosition !== "function") {
            continue;
        }
        var station = CsTags.get(e, "ProfileStation");
        if (station === null || station === "") {
            continue;
        }
        var run = CsTags.get(e, "ProfileRun");
        var pos;
        try {
            pos = e.getPosition();
        } catch (e2) {
            continue;
        }
        if (isNull(pos)) {
            continue;
        }
        out.push({ name: CsProfileBind.key(run, station),
            x: pos.x, y: pos.y });
    }
    return out;
};

/**
 * The CURRENT positions of every profile station, keyed the same way:
 * moveLinework's "before" frame.
 *
 * Read from the DRAWING, not from a rebuild, because the drawing is
 * the only record of where the sketch was traced against -- the survey
 * that produced those coordinates no longer exists once it has been
 * revised. Same reasoning as CsBind's, one file over.
 */
CsProfileBind.positions = function(doc) {
    var index = CsProfileBind.stationIndex(doc);
    var out = {};
    for (var i = 0; i < index.length; i++) {
        // first writer wins: a station drawn twice under one run key
        // would be a bug in the draw, not something to average away
        if (!out.hasOwnProperty(index[i].name)) {
            out[index[i].name] = { x: index[i].x, y: index[i].y };
        }
    }
    return out;
};

/**
 * Tags untagged linework in the profile drawing with the stations it
 * was traced against. Returns {tagged, skipped}.
 *
 * Runs BEFORE the erase, from the mover's own vantage point -- the same
 * guarantee CsBind's revision-time pass gives in plan, and for the same
 * reason: it needs no listener to have been armed and it works on a
 * drawing made before any of this existed.
 */
CsProfileBind.claim = function(doc, di) {
    var result = { tagged: 0, skipped: 0 };
    if (typeof CsBind === "undefined") {
        return result;
    }
    var index = CsProfileBind.stationIndex(doc);
    if (index.length === 0) {
        return result;
    }
    var epsilon = CsBind.epsilonFor(doc);
    var op = new RModifyObjectsOperation();
    op.setText("Bind traced profile linework");
    var any = false;

    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        // our own output is never linework, whatever layer it landed on
        if (CsProfileBind.isProfileGeometry(e)) {
            continue;
        }
        if (!CsBind.isLineworkLayer(CsBind.layerNameOf(doc, e))) {
            continue;
        }
        if (CsBind.hasLineworkTags(e)) {
            continue;   // already claimed, by this pass or an earlier one
        }
        var pts = CsBind.pointsOf(e);
        var names = CsBind.stationsForPoints(pts, index, epsilon);
        if (names.length === 0) {
            names = CsBind.stationsInBox(CsBind.boxOfPoints(pts), index,
                CsBind.marginFor(index));
        }
        if (names.length === 0) {
            result.skipped++;
            continue;
        }
        CsTags.set(e, CsBind.STATIONS_TAG, CsBind.encodeStations(names));
        op.addObject(e, false);
        any = true;
        result.tagged++;
    }
    if (any) {
        di.applyOperation(op);
    }
    return result;
};

/** True for anything CsProfileDraw drew. */
CsProfileBind.isProfileGeometry = function(entity) {
    for (var t = 0; t < CsProfileDraw.TAGS.length; t++) {
        var v = CsTags.get(entity, CsProfileDraw.TAGS[t]);
        if (v !== null && v !== "") {
            return true;
        }
    }
    return false;
};
```

- [ ] **Step 4: Rework render to claim, remember, erase, draw, move**

In `scripts/CaveSurvey/Core/CsProfileDraw.js`, add the "after" frame reader:

```javascript
/**
 * Where every station WILL be once this profile is drawn, keyed the way
 * CsProfileBind keys them: moveLinework's "after" frame.
 */
CsProfileDraw.positionsOf = function(profile) {
    var out = {};
    for (var b = 0; b < profile.bands.length; b++) {
        var band = profile.bands[b];
        var dz = band.zOffset || 0.0;
        for (var i = 0; i < band.stations.length; i++) {
            var st = band.stations[i];
            out[CsProfileBind.key(band.key, st.name)] =
                { x: st.x, y: st.y + dz };
        }
    }
    return out;
};
```

and replace `render`'s body between the layer loop and the erase with the full order:

```javascript
    // ORDER MATTERS, and each step is only correct in this position:
    //   claim   untagged sketch is bound while the OLD geometry it was
    //           traced against is still in the drawing to match against
    //   before  the old station positions are read for the same reason
    //   erase   only now can the generator's own output go
    //   draw    the new geometry lands
    //   move    the sketch is carried to the new positions
    var claimed = { tagged: 0, skipped: 0 };
    var before = {};
    try {
        claimed = CsProfileBind.claim(doc, di);
        before = CsProfileBind.positions(doc);
    } catch (eBind) {
        // binding is an improvement on leaving the sketch behind, not a
        // precondition for drawing a profile at all
        claimed = { tagged: 0, skipped: 0, error: String(eBind) };
    }

    var erased = CsProfileDraw.erase(doc, di);
```

and after `di.applyOperation(op);`, before the return:

```javascript
    counts.claimed = claimed;
    counts.linework = { moved: 0, unmoved: [] };
    try {
        var after = CsProfileDraw.positionsOf(profile);
        // the tolerance basis and the "did anything actually move"
        // question both already have one tested answer in CsRevise --
        // a second spelling here is how a cave in feet and the same
        // cave in metres start deciding differently
        var extent = CsRevise.positionsExtent(after);
        if (CsRevise.positionsMoved(before, after, extent) > 0) {
            counts.linework = CsRevise.moveLinework(doc, di, before, after,
                {}, extent);
        }
    } catch (eMove) {
        counts.linework = { moved: 0, unmoved: ["move failed: " + eMove] };
    }
```

Skipping the move when nothing moved is not just an optimisation: a redraw that merely ADDS a band disturbs no existing station, and moving linework then would spend the user an undo step for an event that did not happen. The Survey Notebook's Draw guards its own call the same way.

Empty `tripStations` is passed deliberately: the trip fallback exists for a plan sketch that snapped to nothing, and in a profile the trip's stations have no single position to fall back to — several bands may hold the same station. An unbound profile sketch stays where it is and is named in `unmoved`, which is the honest answer.

Add `CsProfileBind.js` to `CsAll.js` after `CsProfileDraw.js`, and note the load order: `CsProfileBind` calls into `CsBind` and `CsRevise`, both of which load earlier in `CsAll`.

- [ ] **Step 5: Run it to verify it passes**

Run:
```bash
/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/profile_draw_roundtrip.js "$PWD"
```
Expected: `### PROFILE DRAW OK`, including `THE TRACED LINE MOVED WITH ITS STATIONS`.

Then the whole suite: `./tests/run_all.sh` → `ALL TESTS PASSED`.

- [ ] **Step 6: Commit**

```bash
git add scripts/CaveSurvey/Core/CsProfileBind.js scripts/CaveSurvey/Core/CsProfileDraw.js scripts/CaveSurvey/Core/CsAll.js tests/profile_draw_roundtrip.js
git commit -m "feat(CsProfileBind): traced profile linework follows the survey"
```

---

## Task 12: GUI verification and publish

**Goal:** Confirm in the running application what headless tests cannot claim, then publish.

**USER-ORDERED GATE — NON-SKIPPABLE.** Headless green is not the same claim as working: in this repo `include()` basename dedupe and the edition-folder path both shipped as "undefined in the GUI while every test passed". Close only after every item below has been observed in the running application, with what was seen written down.

**Files:**
- Modify: `scripts/CaveSurvey/CaveSurvey.js` version constant, if the suite carries one
- Modify: `README.md` (version, if it names one)

**Acceptance Criteria:**
- [ ] `Generate Profile` appears in the Cave Survey menu and the toolbar, with its icon
- [ ] Typing `gp` on the command line runs it
- [ ] On a saved plan drawing with a survey: a `<plan>-PROFILE.dxf` appears beside the plan and opens in a second tab
- [ ] The profile shows one band per survey run, stacked, each opening at its tie station
- [ ] Floor and ceiling lines are present, dashed and faint, on `CTRL-PROFILE-FLOOR` / `CTRL-PROFILE-CEILING`
- [ ] Drawing a line by hand on `PROFILE-CEILING`, then redrawing from the notebook, leaves that line in place and does not double the generated geometry
- [ ] After a change that moves stations (correct one shot's distance in the notebook and redraw), a hand-traced profile line MOVES with the stations it was traced against
- [ ] Saving the profile tab and reopening it keeps the generated geometry erasable (its tags survived the save)
- [ ] `./tests/run_all.sh --publish` green

**Verify:** `./tests/run_all.sh --publish` → `ALL TESTS PASSED`, plus written notes for each GUI item above

**Steps:**

- [ ] **Step 1: Launch and check the menu**

```bash
open ~/Applications/CaveCAD.app
```

Open the Cave Survey menu. Confirm `Generate Profile` is listed between `Survey Stats` and `Build Legend`, with an icon. Note what you see. If it is missing, the cause is almost always the add-on wiring: folder name, `setScriptFile` path, or a duplicate `(groupSortOrder, sortOrder)`.

- [ ] **Step 2: Profile a real survey**

Open a saved cave drawing that holds survey data — or import one from `testdata/` and save it — then run `gp`. Confirm: the sibling file appears beside the plan on disk, opens in a tab, and shows bands. Write down the band count and what the report said.

- [ ] **Step 3: Prove the sketch survives, in the application**

On the profile tab, draw a line on layer `PROFILE-CEILING` by hand. Switch to the plan tab, redraw the survey from the Survey Notebook, and switch back. Confirm the hand-drawn line is still there and the generated lines were replaced rather than doubled (select all on `CTRL-PROFILE-CEILING` and check the count in the status bar before and after).

- [ ] **Step 4: Prove the tags survive a save**

Save the profile tab. Close it. Reopen it. Run `gp` again. Confirm the previously generated geometry is erased and replaced, not duplicated — if it duplicates, the tags did not survive the save and the writer choice in `CsProfileFile.dxfFilter` is the place to look.

- [ ] **Step 5: Publish**

```bash
./tests/run_all.sh --publish
```

Then bump the version and publish per `tools/publish.sh`, following whatever the repo's existing release commits do (`a02a863` is the most recent example).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: publish the extended elevation generator"
```

---

## Known limitations, recorded deliberately

These are choices, not omissions. Each is listed here so a later reader does not "fix" one by accident.

- **Multi-reading LRUD (`upAll`/`downAll`) is not used.** A side recorded "5/10" describes a ledge; the profile draws only the outer `up`/`down`. Plan walls have the same limit today, so fixing one without the other would make them disagree.
- **`survey.startLrud` is not drawn.** The first station of a survey carries its LRUD in `startLrud` rather than on an arriving shot, and `CsModel.lrudForStation` finds LRUD by `shot.to`. `CsLrud.wallRuns` has this same gap in plan (recorded, not a regression); the profile inherits it rather than diverging.
- **Sketched linework can be tilted by a revision.** `CsRevise.similarityFit` is reused unchanged by user decision. Rotation is meaningful in plan and not in an elevation, so a differential station move can be absorbed as a small tilt. If that is ever observed, the fix is a fit with theta pinned to zero — not a new mover.
- **Projected profile is a different tool.** `PROFILE-PROJECTED` stays empty; nothing here writes to it.
- **No length heuristic decides spur versus branch.** The surveyor's naming decides, always.

- **Parent assignment is two-phase, and phase 2 walks runs in REVERSE band order.**
  Phase 1 uses only `kind === "new"` legs with the directional seq test; cycles among
  those are genuine (both runs really do arrive from the other) and are broken and
  reported. Phase 2 then fills in still-parentless runs from `closure`/`tie` contacts,
  skipping any candidate that is already a descendant — so an ordinary loop closure
  produces NO cycle report, because that junction is already recorded from the other
  side. Phase 2 must iterate latest-anchored-first against the LIVE parent map, not a
  phase-1 snapshot: where a tie joins two separately fixed components, neither end has a
  phase-1 parent to freeze, and only processing the later one first lets the descendant
  check see anything at all — but note precisely what that order buys. CYCLE SAFETY DOES
  NOT DEPEND ON IT: phase 2 only ever adds an edge from a parentless run to a candidate
  that is not its descendant, and a parentless run is the root of its own tree, so the
  candidate is provably in a different tree and the edge merges two trees. The forest
  stays a forest under ANY iteration order — verified over 4000 random surveys, zero
  cycles. What the order decides is DIRECTION: forward order lets the natural root claim
  a later run as its parent and the tree comes out upside down. Do not "optimise" this
  loop believing cycles are the risk; the risk is an inverted tree. The descendant check
  is mutation-verified as load-bearing.
- **A survey anchored inside a spur makes that spur the root band.** The directional
  contact test asks which station was already placed when a leg was walked, so if
  resolution starts inside `A13a` then `A13a` is the root and the trunk `A` becomes its
  child, tying in at the anchor. Verified in Task 2 against a real fixture: no crash, no
  cycle in the parent map, every run appears exactly once in the
  band order. This is self-consistent — the first-placed run is the root, and the band
  order then starts where the survey started — and is decided behaviour, not an accident.
- **The tie edge is resolved by station PAIR, not by leg identity.** `unrollBand` re-searches
  for a leg between the tie station and the chain rather than being handed the leg
  `hierarchy` actually chose. That is benign only because of an ordering property of
  `CsNetwork.resolve`: a pair carrying a `new` or `tie` leg is always emitted before a
  second leg on that pair can be classified `closure`, so the re-search's first match
  always agrees with `hierarchy`'s new-before-closure ranking. Neither file states that
  property. The durable fix is for `hierarchy` to return the tie leg alongside the tie
  station, but that changes a return contract Task 2 settled after three rounds, so it is
  recorded here rather than done.
- **Punctuation in a station name silently becomes part of the run key.** `splitName`
  treats a run of non-alphanumerics as a fourth group class, so `A-1` keys run `A-`,
  `A'1` keys `A'`, and `A 1` keys `"A "` — a typo makes its own run rather than being
  refused. Only the dot is rejected, because a dot means splay. Catching typos would
  need a whitelist of legal name shapes, which is a naming-policy decision, not a
  profile decision. Recorded from the Task 1 spec review.
- **A name can be a station and a run key at once.** With `A1` and `A1a1` both present,
  `A1` is a station in run `A` and simultaneously the key of run `A1`. Nothing keys
  bands and stations in one namespace — profile linework keys are run-qualified
  (`CsProfileBind.key`) precisely so this cannot collide — but any future code that
  keys them together must qualify them too.
