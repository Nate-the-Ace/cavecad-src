# Suggest Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A "Suggest split" popup that proposes which people and stops go on each team (with locks, hard limits, preferences, a preview, Apply and Undo).

**Architecture:** A pure engine `Core/CsTeamSplit.js` (plus a small `CsTripPlan.routeTightness` helper) computes a deterministic proposal from the survey, the current teams, the directory and lock ticks; the panel adds a Suggest button, a QDialog with lock tables and a preview, and Apply/Undo built on the existing team data layer.

**User decisions (already made):** stops AND people both; locks for anything assigned by hand; popup with a preview, Apply, Undo suggestion; all six rules (hard: vertical, squeeze; preferences: first aid, leader, balance, schedule fit); "proceed unattended ... get to something I can test myself".

Spec (authoritative): `docs/superpowers/specs/2026-09-29-suggest-split-design.md`. Repo `~/Documents/github/cavecad-tools`, branch `legacy-map`.

## Conventions every task follows

- ES5 only. New Core files: `Cs` prefix, listed in `CsAll.js` AND the CORE list in `tests/js_unit.js`.
- Tests: `ok`/`eqs`; prefix `ss`; blocks above the `// Report.` banner; write first, watch fail (report honestly if it aborts).
- Suites (background, stdin closed, read the log): `cd ~/Documents/github/cavecad-tools && /Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/js_unit.js "$PWD" </dev/null > /tmp/unit-ss.log 2>&1` -> `### UNIT OK <n> assertions` (baseline 8549); same for `tests/js_syntax.js` (`### SYNTAX OK`); `python3 -m unittest discover -s tests` (`OK (skipped=5)`).
- **NEVER build real Qt widgets in a headless test** (crash at exit, macOS crash dialog for Nathan): use plain fake objects; the coordinator verifies widgets live. Before and after each unit run check `ls -lt ~/Library/Logs/DiagnosticReports | grep -i cavecad | head -2` for a NEW .ips (newest today, `CaveCAD-2026-09-29-193559.ips`, is old).
- **Implementers never launch, quit or restart the CaveCAD GUI** (Nathan's real session may hold unsaved work); only `-no-gui` runs. Never touch the real `people.json`.
- **Dock-build rule:** inside any `build*` function never call `child()`, a `setXText()` accessor or anything reaching the dock via `ensureDock`. The popup is built on click. Never `deleteLater()` script-built widgets; hide and rename.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. No push, no release.

---

### Task 1: The split engine

**Goal:** `CsTeamSplit.suggest` and `CsTripPlan.routeTightness` implement the spec's algorithm as pure, tested functions.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsTeamSplit.js`
- Modify: `scripts/CaveSurvey/Core/CsTripPlan.js` (add `routeTightness`), `scripts/CaveSurvey/Core/CsAll.js`, `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `CsTripPlan.routeTightness(survey, plan)` returns the narrowest passage width on the plan's route in INCHES (using the same width rule as `tightWarnings`, converting the survey unit), or null when no width is known.
- [ ] `CsTeamSplit.suggest(input)` returns the spec's output shape for the spec's input shape, following the spec's algorithm (time model via `CsTripPlan.build` with a per-stop-set cache; greedy seed then deterministic move/swap improvement capped at 200 passes; locked stops and people never move; hard vertical and squeeze limits; first-aid, leader, balance and schedule warnings; `teamCount` above the current count adds "Team N" teams whose days copy the last team's).
- [ ] Deterministic (same input twice -> deep-equal output); never throws on degenerate input (no free stops, no free people, fewer people than teams, unreachable stop, empty directory, unknown skills/limits).
- [ ] `feasible` is false exactly when a hard warning exists.
- [ ] Improvement is real: on a fixture where the greedy seed is unbalanced, the final maximum team time is lower than the seed's.

**Verify:** unit suite -> `### UNIT OK <n> assertions`

**Steps:**
- [ ] Read `Core/CsTripPlan.js` (`graph`, `shortest`, `order`, `build`, `tightWarnings`, `config`), `Core/CsTeams.js`, `Core/CsPeople.js` (`SKILLS`, skill ids: `vertical`, `first_aid`, `cpr`, `wfr`, `leader`), `Core/CsPitch.js`.
- [ ] Write failing `ss engine:` tests for every acceptance bullet and every case listed in the spec's Tests section (engine part), using `tpSurvey`/`tpResolved` and purpose-built fixtures with a pitch and LRUD widths.
- [ ] Implement; run suites; commit `feat: split engine (CsTeamSplit)` (and `feat: CsTripPlan.routeTightness` if separate).

---

### Task 2: The popup, preview, Apply and Undo

**Goal:** The panel offers Suggest split with lock tables, a preview, Apply and Undo suggestion.

**Files:**
- Modify: `scripts/CaveSurvey/ExpeditionPlanner/ExpeditionPlanner.js`, `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `Suggest split...` (`ExpeditionPlannerSuggest`) and `Undo suggestion` (`ExpeditionPlannerSuggestUndo`, disabled until Apply, cleared by the next manual team edit or drawing change) sit beside Add team / Remove team.
- [ ] Popup `ExpeditionPlannerSuggestDialog` per the spec: team-count spin box (min = current count, max 8), Objectives table (Lock, Stop, Currently) with the station picker to add stops, People table (Lock, Person, Skills, Squeeze, Currently) for everyone ticked Going, `Free everything`, Suggest, read-only preview, Apply, Close. Lock ticks default on when assigned, off when free. Apply enabled only after a proposal. Every widget has an objectName (`ExpeditionPlannerSuggest_<Field>`).
- [ ] Pure helpers with fakes: `suggestInput(state, tickStates, teamCount)`, `suggestPreviewText(result)` (hard warnings marked "!"), `applySuggestion(result)` (snapshots `state.suggestUndo`, creates added teams via `CsTeams.copyOf(last, "Team N")`, sets members and stops per team in proposed order through the data layer, saves, rebuilds sections, returns the snapshot), `undoSuggestion()` (restores the snapshot exactly, removing teams the suggestion added, saves, rebuilds).
- [ ] Apply then Undo restores the exact prior teams (deep-equal incl. ids); a second Undo is a no-op; a manual edit after Apply disables Undo.
- [ ] No real widgets in headless tests; dock-build guard test still green; popup built on click.

**Verify:** unit, syntax, python suites green; live checks by the coordinator.

**Steps:**
- [ ] Read `ExpeditionPlanner.js` (team sections, `buildPersonDialog` pattern, data layer functions, `rebuildTeamSections`, fake-Qt `tmFakeQt` in `tests/js_unit.js`) and `Core/CsTeamSplit.js` from Task 1.
- [ ] Failing `ss panel:` tests with fakes, implement, suites, commit `feat: Suggest split popup with preview, Apply and Undo`.

---

### Task 3: Docs, version, publish, live verification

**Files:** `docs/handbook/pages/expedition-planner.html`, `VERSION` (0.9.198.0 -> 0.9.199.0), `tests/test_addon.py` if a table line needs it.

**Acceptance Criteria:**
- [ ] Handbook "Suggest split" section per the spec; suites green; `./tools/publish.sh` run; installed folder matches the repo.
- [ ] Live on the scratch copy (coordinator): popup opens with filled tables, Suggest gives a preview, hard warnings show, Apply writes teams and Build cards works, Undo restores, restart restores, no new crash report.
