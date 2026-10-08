# Linework Binding Implementation Plan

**Goal:** Hand-drawn linework and blocks move with the survey they were traced against, including on the non-rigid revision path.

**Spec:** `docs/superpowers/specs/2026-08-20-linework-binding-design.md`

**Architecture:** A new Core module `CsBind.js` owns the pure binding logic (which stations an entity belongs to) and the tag read/write. A transaction listener tags what you draw while a session is armed. `CsRevise.apply`'s non-rigid path moves tagged linework by a fit over its own stations. An adopt action tags what is already there.

**User decisions (already made):**
- Capture by auto-tagging while a session is armed (explicit arming; adopt action is the fixup).
- On a non-rigid change each entity follows its OWN stations' local fit.
- Retroactive adoption is an on-demand action with a preview.
- Linework carries the integer trip id, never the `date|team` fingerprint.
- No rubber-sheeting: an entity moves as one rigid piece or is reported.

**Conventions that bite here:**
- Core files are `Cs`-prefixed and define a matching global (enforced by the structural test); `include()` dedupes by basename.
- Entity writes: construct/mutate, then `op.addObject(entity, false)`; tags only via `CsTags.set/get`; committing tags on an existing entity needs `CsTags.commit`.
- OFF layers silently refuse adds, modifies AND deletes — wrap in `CsLayers.withLayerOn`.
- Tests: `./tests/run_all.sh --publish`. Baseline at plan time: 1295 assertions, 44/44 parsed.
- Nathan has deferred the general test BACKFILL, but new pure logic here gets real assertions — that is what keeps the erase hazard from regressing.

---

### Task 1: CsBind.js — pure binding logic

**Files:** create `scripts/CaveSurvey/Core/CsBind.js`; modify `scripts/CaveSurvey/Core/CsAll.js` (include), `tests/js_unit.js` (CORE_FILES + assertions).

**Acceptance criteria:**
- `CsBind.TRIP_TAG = "LineworkTrip"`, `CsBind.STATIONS_TAG = "LineworkStations"`.
- `CsBind.isLineworkLayer(layerName)` — false for any `CTRL-*` layer, false for `TB_*`, false for `CsRevise.WORLD_FIXED_LAYERS` members, true otherwise. This is the single gate deciding what may ever be tagged or moved.
- `CsBind.stationsForPoints(points, stationIndex, epsilon)` — pure: given candidate points and an index of `{name, x, y}`, returns the names coinciding within epsilon. No document access.
- `CsBind.stationsInBox(box, stationIndex, margin)` — pure proximity fallback.
- `CsBind.encodeStations(names)` / `decodeStations(text)` — the `"A|B|C"` form, matching `WallRunStations`.
- Node-loadable (no file-scope `R*`), added to `CORE_FILES`.
- Assertions: coincidence within/outside epsilon; duplicate names collapse; LRUD/splay suffix stripping (`A3.L` and `A3.2` both yield `A3`); empty inputs return empty; encode/decode round-trip including a station name containing a space.

**Verify:** `./tests/run_all.sh --publish` green; count rises by the new assertions.

---

### Task 2: Document-side binding + the adopt action

**Files:** modify `scripts/CaveSurvey/Core/CsBind.js`, `tests/js_unit.js`.

**Acceptance criteria:**
- `CsBind.stationIndex(doc)` — one scan collecting station points, LRUD tips and splay tips into `{name, x, y}` with suffixes stripped.
- `CsBind.pointsOf(entity)` — vertices for lines/polylines, insertion point for block references, position for points, endpoints for arcs; `[]` for anything unsupported (never throw).
- `CsBind.bindEntity(doc, entity, tripId, index)` — computes the station set per the spec's ordered rules and returns `{stations, source}` where source is `"snap"`, `"proximity"` or `"trip"`; does NOT write.
- `CsBind.tagEntities(doc, di, entries)` — one `RModifyObjectsOperation` writing `LineworkTrip`/`LineworkStations`, honoring `CsLayers.withLayerOn` for any off layer holding entities.
- `CsBind.adoptable(doc, tripId)` — every untagged entity on a linework layer with its computed binding, for the preview.
- Doc-test assertions (in the `!IS_NODE` block): a polyline snapped to two LRUD tips binds `"snap"` to those two stations; a polyline near stations but snapped to none binds `"proximity"`; a stray line far from everything binds `"trip"` with no stations; an entity on `CTRL-SHOTS`, on `TB_TEST` and on `CTRL-AERIAL` is never adoptable.

**Verify:** `./tests/run_all.sh --publish` green.

---

### Task 3: THE HAZARD — eraseStations must never delete linework

**Files:** modify `scripts/CaveSurvey/Core/CsDraw.js`, `tests/js_unit.js`.

**Acceptance criteria:**
- `CsDraw.eraseStations` explicitly ignores `LineworkTrip` and `LineworkStations`, with a comment stating why: generated wall runs are ours to replace, traced linework is the user's work and deleting it is unrecoverable.
- Assertion that pins it: a drawing with a traced polyline tagged `LineworkStations` covering stations that ARE being erased survives `eraseStations` intact, while a `WallRunStations` polyline over the same stations is removed. This test is the guard against a future edit "tidying" the two tags together.

**Verify:** `./tests/run_all.sh --publish` green; the new assertion fails if the ignore is removed (check by reverting it once).

---

### Task 4: Move tagged linework on the non-rigid path

**Files:** modify `scripts/CaveSurvey/Core/CsRevise.js`, `scripts/CaveSurvey/Core/CsReport.js`, `tests/js_unit.js`.

**Acceptance criteria:**
- After the non-rigid redraw, every entity on a linework layer carrying either tag is moved per the spec: fit over its own stations' old→new positions; single station translates; no resolvable station falls back to a fit over its trip's stations; nothing available leaves it and records it.
- Reuses `CsRevise.similarityFit` and the existing rotate/scale/move idiom. Runs inside the same operation as the redraw where possible, otherwise its own, and never on the rigid path.
- Report gains `lineworkMoved` (count) and `lineworkUnmoved` (names, capped for display); `CsReport.revisionSummary` states both, and on unmoved entities keeps the existing re-trace warning — it is now the honest fallback rather than the default.
- Doc tests: two-trip drawing, traced polyline snapped to trip 1's tips, revise trip 1 only → non-rigid, the polyline's vertices land on the fit predicted from those stations (1e-6), trip-0 linework untouched; a polyline whose stations were all deleted reports as unmoved and is not damaged; a `CTRL-AERIAL` entity and a `TB_*` entity never move.

**Verify:** `./tests/run_all.sh --publish` green.

---

### Task 5: Arming + the transaction listener

**Files:** modify `scripts/CaveSurvey/Core/CsBind.js`, `scripts/CaveSurvey/SurveyNotebook/SurveyNotebook.js`.

**Acceptance criteria:**
- `CsBind.arm(tripId)` / `CsBind.disarm()` / `CsBind.armedTrip()`. Installing the listener uses `RTransactionListenerAdapter` + `appWin.addTransactionListener` and connects `transactionUpdated` (see the stock example at `scripts/Misc/Examples/ListenerExamples/ExTransactionListener/`); install once, never twice.
- On each transaction: newly added entities on linework layers that carry no survey tags and no linework tags get bound and tagged with the armed trip. Entities on `CTRL-*`, `TB_*` and world-fixed layers are skipped.
- **Re-entrancy guard:** `CsBind.suppress()` / `resume()` wrap the suite's own drawing (`CsDraw.survey`, `CsRevise.apply`, the adopt action) so our own geometry is never tagged as linework. Prove it: drawing a survey while armed tags nothing.
- Notebook: a toggle in the action row that arms with the page's current trip and shows armed state; disarms on Clear and when the trip changes. Tooltip explains that what you draw while armed will move with that trip.
- Notebook: an "Adopt linework..." entry that previews `CsBind.adoptable` counts by source (`snap`/`proximity`/`trip`), asks, then tags. The action row is already crowded — put the two behind one entry if that reads better, and say which you chose.
- Verify the listener empirically in a scratch harness: add an entity while armed → tagged; while disarmed → untagged; while suppressed → untagged.

**Verify:** `./tests/run_all.sh --publish` green, 44/44 parsed.

---

### Task 6: Gate, docs, publish

**Acceptance criteria:**
- `./tests/run_all.sh --publish` → ALL TESTS PASSED.
- README's Survey Notebook row mentions linework binding; the spec's "not in scope" list still accurate.
- Memory updated (`cave-survey-revision-framework`) with the linework tags, the erase hazard and the arming model.
- ASK NATHAN before `tools/publish.sh`.

---

## Risks

- **Deleting user work.** Task 3 is the one that must not be wrong. Its assertion is the guard.
- **Tagging our own geometry.** The suppression guard in Task 5; a survey draw while armed must tag nothing.
- **Listener lifetime.** A listener installed twice double-tags; installed and never removed keeps firing after the notebook closes. Install once, and disarm rather than uninstall.
- **Silent over-claiming.** Auto-tagging claims construction lines too. The adopt preview and the explicit arming toggle are the mitigations; a mis-claimed entity is corrected by re-adopting, never by hand-editing tags.
