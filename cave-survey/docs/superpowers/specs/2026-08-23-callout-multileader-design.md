# Callout (Multileader) — Design

Date: 2026-08-23
Status: approved design, not yet implemented. NOT YET COMMITTED — another
session held the repo when this was written; commit on the user's go-ahead.
Reuses `CsProfile.classifySplay` / `CsProfile.FLAT_SPLAY_DEG` and
`CsModel.parseLrudEntry`. Deliberately diverges from `CsProfile`'s floor
definition — see §6.3, and do not "fix" it.

Engine probed 2026-08-24 against the INSTALLED binary
(`/Applications/CaveCAD.app`, dated Aug 19), not the source tree — the app is
behind `cavecad-src` and source is documentation of a future build.
Confirmed present AND working: `RTransactionListenerAdapter` (constructs,
`transactionUpdated` connects), `addTransactionListener` /
`removeTransactionListener`, `RTransaction.getAffectedObjects` /
`getPropertyChanges` / `getGroup` / `setGroup`,
`RAddObjectsOperation.setTransactionGroup`, `RLeaderData` with
`setArrowHead` / `appendVertex` / `setDimasz` / `setDimscale`, `RTextData`
with `getBoundingBox` / `getHeight` / `getAlignmentPoint`.
Undo grouping was verified BEHAVIORALLY, not by the setter's existence: two
grouped `RAddObjectsOperation`s collapse to a single undo (2 entities → 0),
while the ungrouped control undoes one at a time (2 → 1).

## 1. What this is

Two annotation commands and one shared engine, giving CaveCAD the multileader
it does not have.

QCAD ships no multileader. What it has:

- `Draw > Dimension > Leader` — `RLeaderEntity` is a polyline plus an
  `arrowHead` bool and `dimasz`/`dimscale`
  (`cavecad-src/src/entity/RLeaderData.h:199`). No text member of any kind.
- `Misc > Draw > Leader from Selected Text` (`lftxt`) and
  `Misc > Draw > Text Aligned Leader` (`tal`) — both draw an arrow near a text
  and then forget about it. Two unrelated entities afterward.

So there is no landing/shoulder generation, no text bound to a leader, no
move-one-move-both, and no multi-branch. On a cave map that gets re-issued per
survey trip, unlinked callouts drift: the text moves, the arrow does not, and
the plot ships pointing at the wrong passage.

`EntityCustom` exists as an enum constant only
(`cavecad-src/src/core/RS.h:282`) with no ECMA class behind it, so a genuine
single-entity multileader cannot be built in script. The design works with
that constraint instead of against it.

Two commands, because a note and a spot elevation are different jobs:

- `CsCallout` — freeform text note with one or more arrows.
- `CsCalloutElev` — spot elevation of the PASSAGE FLOOR at the arrow tip,
  derived from LRUD and splays, not from the survey line.

## 2. User decisions

- Flexibility bar is the whole point. All four must survive commit: edit the
  text content, move the text, move an arrow tip, add or remove branches.
  A callout that freezes on commit is worthless.
- Linked pair, not a block. Text stays a real `RTextEntity` so the native
  double-click editor, grips and property editor keep working untouched.
- Live glue via a transaction listener, PLUS a manual `CsCalloutSync` repair
  path for files edited where the listener never loaded.
- General drafting tool first. Survey-aware prefill is a later hook, not v1.
- Elevation comes from interpolation along the survey alignment, not from
  drawing z at the picked point.
- The elevation label means THE FLOOR — walkable floor, not centerline.
- Multi-value D (`2/6`) takes the SHALLOWEST reading: walkable floor. This
  disagrees with `CsProfile` on purpose (§6.3).
- Missing D falls back to the survey-line elevation, VISIBLY LABELLED as such.
  Never silently, never as 0.
- Down-splays contribute floor evidence, same as they do in the profile.

## 3. Files

New, under `scripts/CaveSurvey/`. One folder per menu tool, named exactly
after the tool, holding `<Tool>.js` and `<Tool>.svg` — the suite's fixed
layout. There are NO `*Init.js` files: wiring is a `Tool.init =
function(basePath)` at the bottom of each tool's own file (§9).

    Core/CsCallout.js            pure engine: build, reflow, collect, members
    Core/CsElevation.js          floor sampling along the alignment
    Callout/Callout.js           CsCallout command + its init
    Callout/Callout.svg
    Callout/CalloutListener.js   live glue, installed at startup
    CalloutElev/CalloutElev.js   CsCalloutElev command + its init
    CalloutElev/CalloutElev.svg
    CalloutSync/CalloutSync.js   CsCalloutSync command + its init
    CalloutSync/CalloutSync.svg

Modified:

    CaveSurvey.js           listener install
    Core/CsLayers.js        the six callout style layers

`CalloutListener.js` shares the `Callout` folder rather than taking one of its
own: it is not a menu tool and registers no `RGuiAction`.

Basename check — QCAD's `include()` DEDUPES BY BASENAME and skips the
duplicate silently, invisibly to headless tests. `Callout.js`,
`CalloutElev.js`, `CalloutSync.js`, `CsCallout.js`, `CsElevation.js`: zero
collisions against `cavecad-src/scripts`, verified 2026-08-24. Suite-internal
includes must be `includeBasePath`-relative.

`Core/CsElevation.js` is written as a standalone consumer of the resolved
survey. The forthcoming entrance-elevation + lidar work needs the same
"elevation at an arbitrary point along the alignment" primitive and should
call into this module rather than growing a second one.

## 4. Data model

Every member carries `CsTags` XDATA under group `CaveSurvey`
(`Core/CsTags.js:36`). The shared id is the whole mechanism — there is no
side table and no registry object in the drawing.

| Key             | On       | Meaning                                       |
|-----------------|----------|-----------------------------------------------|
| `CalloutId`     | both     | shared id joining one text to N leaders       |
| `CalloutRole`   | both     | `text` \| `leader`                            |
| `CalloutKind`   | text     | `text` \| `elev`                              |
| `CalloutStyle`  | both     | preset name; drives layer and color           |
| `CalloutSide`   | text     | `auto` \| `left` \| `right`                   |
| `ElevBasis`     | text     | `floor` \| `line` (elev kind only)            |
| `ElevFrom`      | text     | from-station name of the sampled leg          |
| `ElevTo`        | text     | to-station name of the sampled leg            |
| `ElevFraction`  | text     | 0..1 position along that leg                  |
| `ElevValue`     | text     | last computed elevation                       |
| `ElevMulti`     | text     | `1` when the governing D had extra readings   |

Styles: `hazard`, `dig`, `equipment`, `name`, `elevation`,
`elevation-line`. The last is the visibly-degraded fallback of §6.4.

`CalloutId` generation: a document-scoped counter derived from the highest
existing `CalloutId` at command start. Not a timestamp — two callouts placed
in the same second must not collide, and the id appears in test fixtures.

## 5. Reflow geometry

`CsCallout.reflow(doc, id)` is pure: it reads the current state of the text
and the tip points, and returns the operation that rewrites the leader
polylines. It computes nothing else and mutates nothing directly.

Inputs: the text entity's bounding box and insertion point, plus one tip
point per leader member.

1. Landing (shoulder) segment is horizontal. Length = `dimasz × dimscale`,
   falling back to a text-height multiple when the dimension style gives
   neither.
2. Side = mean tip x compared against text-box center x, unless `CalloutSide`
   is pinned to `left`/`right`.
3. The landing attaches at the vertical MIDDLE of the text box's near side.
   Not the first-line baseline: baseline attachment shifts visibly when a
   caver adds a second line to a note, and these notes get edited.
4. Each branch is a polyline: tip → elbow → landing end, `arrowHead` true.
5. **Reflow rewrites leader polylines only. It never writes to the text
   entity.** That single rule is what keeps every native text interaction
   working, and it is the reason this design beats a block-with-attribute.

## 6. Floor elevation sampling

`CsElevation.sampleFloor(survey, resolved, point)` returns
`{z, basis, from, to, fraction, multi}` or `null`.

### 6.1 Locate

Project `point` onto the nearest resolved leg within tolerance. No leg in
range → `null`. The caller aborts; it does not guess a leg.

### 6.2 Floor evidence along the leg

Build an along-passage-ordered list of floor evidence, the same shape as the
profile's floor run (`Core/CsProfile.js:1787`):

- **Each endpoint station**: floor z = `stationZ - floorWalkable`.
- **Each down-splay from either station**: classified with
  `CsProfile.classifySplay(shot, CsProfile.FLAT_SPLAY_DEG)`, reusing the
  existing dead zone rather than inventing a threshold. Only `"floor"`
  classifies in. Splay floor z = `stationZ + distance × sin(inc)`, positioned
  at its along-passage projection.
- A splay with NO inclination on record is SKIPPED OUTRIGHT. It must not ride
  in as `"flat"` at centerline — the exact trap the docblock at
  `Core/CsProfile.js:1763` warns about.

Interpolate linearly between the two evidence entries bracketing the picked
position. `basis: "floor"`.

### 6.3 floorWalkable — the deliberate divergence

`CsModel.parseLrudEntry` (`Core/CsModel.js:526`) returns `value` = the MAX of
a multi-value entry and `all` = every reading (`null` when there was only
one). `P` parses to 0. `""` and `"--"` parse to `null`.

    floorWalkable = (all !== null) ? Math.min.apply(null, all) : value

`CsProfile` uses `value` — the DEEPEST reading — for its floor line. This
module uses the SHALLOWEST. That is not an inconsistency to clean up. The two
answer different questions:

- The profile draws the passage ENVELOPE. A pit belongs inside it.
- A callout labels WHERE A CAVER STANDS. A `2/6` station has walkable floor at
  2 with a pit dropping to 6; labelling that spot at 6 is wrong on a map
  someone navigates by.

The helper is named `floorWalkable`, not `floorZ`, and carries a docblock
saying all of the above — same guard style as the plan/elevation splay
asymmetry note at `Core/CsProfile.js:1757`. Anyone who "unifies" the two
floor definitions breaks one of them.

`multi` is set true when the governing station's `all` held more than one
reading, so the label can tell the reader a pit exists below the number.

### 6.4 Null D fallback

D is `null` at both endpoints and no floor splay classified in → return the
interpolated SURVEY-LINE z with `basis: "line"`.

Never 0. `D = 0` is a real reading meaning the floor is at the survey line —
`CsLrud.tickEnd` (`Core/CsLrud.js:34`) already draws that null-vs-0 line
correctly and this module honors the same split. A fabricated 0 here would be
the seventh door in the elevation-datum bug family.

The fallback is not silent. It changes what gets drawn (§8.2).

## 7. Live glue

`Callout/CalloutListener.js`, installed once at startup from `CaveSurvey.js`.

    var adapter = new RTransactionListenerAdapter();
    EAction.getMainWindow().addTransactionListener(adapter);
    adapter.transactionUpdated.connect(handler);

Working precedent:
`cavecad-src/scripts/Misc/Examples/ListenerExamples/ExTransactionListener/ExTransactionListener.js:40`.

Handler:

1. Bail immediately if a module-level re-entrancy flag is set. Reflow writes a
   transaction, which re-enters this handler.
2. Walk `transaction.getAffectedObjects()`. Bail fast when no affected object
   carries a `CalloutId` — the common case for every unrelated edit in the
   drawing, so this test must be cheap.
3. For each affected `CalloutId`, run `CsCallout.reflow` and apply the
   operation with
   `op.setTransactionGroup(transaction.getGroup())`
   (`cavecad-src/src/core/ROperation.h:102`). The reflow lands in the user's
   own undo step: one Ctrl+Z undoes the text edit and its reflow together, not
   two.
4. Deletion:
   - text deleted → delete the orphaned leaders.
   - last leader deleted → **the text survives, as plain text.** A note
     without an arrow is still a note. Its callout XDATA is stripped so it
     stops being a half-callout.

## 8. Commands

### 8.1 CsCallout / `cscal`

Pick tip. Optionally pick further tips for extra branches. Pick text
position. Type the note (multiline). Pick style. Commit places the text plus
one leader per tip, all sharing a fresh `CalloutId`.

### 8.2 CsCalloutElev / `cselev`

Pick tip. Sample with `CsElevation.sampleFloor`.

| Result           | Label                    | Style             |
|------------------|--------------------------|-------------------|
| `floor`          | `1234.5'`                | `elevation`       |
| `floor` + multi  | `1234.5'` + pit marker   | `elevation`       |
| `line`           | `~1234.5' LINE`          | `elevation-line`  |
| `null`           | nothing placed           | —                 |

`null` aborts with a message naming why (no leg in tolerance). No label.

The formatted value is editable before commit — a caver who knows the real
floor overrides it. Elevation formatting goes through `CsUnits`.

### 8.3 CsCalloutSync / `cscsync`

Reflows every callout in the drawing, or in the selection. Also re-derives
`elev`-kind text from the stored `ElevFrom`/`ElevTo`/`ElevFraction`, which
means a `basis: "line"` fallback label UPGRADES ITSELF to a real floor label
once D gets entered on a later trip — and re-styles from `elevation-line` to
`elevation` when it does.

Same pure `reflow` core as the listener. One geometry definition, two callers.

## 9. Wiring

**Flat menu. The suite has no submenus.** Every tool attaches directly to
`CaveSurveyMenu` and `CaveSurveyToolBar` with `setGroupSortOrder(450)` and a
sort order unique across the entire suite. An earlier draft of this spec
invented a `Cave Survey > Annotate` submenu — no such mechanism is in use, and
a tool wired to a non-existent widget name does not appear at all, silently.

Per tool, at the bottom of its own file:

    Tool.init = function(basePath) {
        var action = new RGuiAction(qsTr("..."),
                                    RMainWindowQt.getMainWindow());
        action.setRequiresDocument(true);
        action.setScriptFile(basePath + "/<Tool>.js");
        action.setIcon(basePath + "/<Tool>.svg");
        action.setStatusTip(qsTr("..."));
        action.setDefaultCommands([...]);
        action.setGroupSortOrder(450);
        action.setSortOrder(<n>);
        action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
    };

| Tool            | Commands   | sortOrder |
|-----------------|------------|-----------|
| `CsCallout`     | `cscal`    | 88        |
| `CsCalloutElev` | `cselev`   | 90        |
| `CsCalloutSync` | `cscsync`  | 92        |

Sort orders in use at 0.6.1.0: 5, 15, 20, 30, 40, 45, 52, 60, 70, 75, 78, 85.
A duplicate `(groupSortOrder, sortOrder)` displaces another tool. The three
aliases collide with nothing existing.

`CsLayers` gains the six style layers. Callout members are placed on the
style's layer, never the current layer. `new RLayer(...)` takes
`(document, name, frozen, locked, color, linetypeId, lineweight, off)` — `off`
is LAST, `frozen` is THIRD. Passing an off-state where it reads naturally
makes the layer FROZEN and visible, which then refuses every edit for a reason
the caller never intended.

## 10. Traps

1. **Elevation datum.** Any z that defaults to 0 rebases an absolute-datum
   cave. `sampleFloor` returns `null` or an explicit `basis`, never a
   fabricated number. §6.4.
2. **Listener recursion.** Reflow writes a transaction, which fires the
   listener. The re-entrancy flag is not optional.
3. **Two-step undo.** Without `setTransactionGroup`, every text edit needs two
   undos and users will call the tool broken. §7.3.
4. **Floor definition drift.** §6.3. Named and docblocked so it survives the
   next reader.
5. **No-inclination splays.** Skipped before classification, not after. §6.2.
6. **Plugin wiring.** §9. Silent menu disappearance.
7. **Listener cost.** The affected-objects test runs on every transaction in
   the document. It reads XDATA on already-loaded objects and returns early;
   it must not query the spatial index or collect stations.
8. **A FREED `RDocument` CANNOT BE DETECTED AND TOUCHING ONE SEGFAULTS.**
   `isNull()` and `isDeleted()` both keep reporting false, and the next real
   call exits 139 rather than throwing, so try/catch buys nothing. The
   listener is long-lived and its handler receives a `document` argument —
   it must NOT retain that reference, cache it on the module, or capture it
   in a closure that outlives the callback. Re-resolve per invocation and
   compare document names to notice a change.
9. **`EAction.handleUserMessage` cannot show multi-line text** — the command
   line escapes with `RS.escape` and wraps in `<span>`, so Qt parses it as
   rich text and every newline collapses to a space. The `CsCalloutElev`
   abort message (§8.2) and any `CsCalloutSync` summary use
   `QMessageBox.information`, per `SheetCheck.js` / `SurveyStats.js`.
10. **LOCKED and FROZEN layers refuse operations SILENTLY**, and
    `CsLayers.withLayerOn` covers OFF only. `di.applyOperation` reports
    nothing useful either way. `CsCalloutSync` over a whole drawing will meet
    locked style layers: count entities on the target layer before and after
    rather than trusting the operation, and report what it could not touch.
11. **`queryAllEntities` is NOT insertion-ordered.** `ids[ids.length-1]` to
    find "the entity just added" is arbitrary and only appears to work on an
    empty document. `CsCallout.build` must diff the id set before and after,
    or query by layer, to learn the ids it needs to tag.

## 11. Testing

Pure core, under `tests/`, matching the existing suite pattern:

- `reflow`: text left of tips, text right of tips, side pinned against the
  geometry, multiline text, single branch, three branches, tip coincident with
  the text box.
- `floorWalkable`: single value, `2/6` → 2, `P` → 0, `""` → null, `"--"` →
  null.
- `sampleFloor`: mid-leg interpolation, exactly at a station, D null at one
  end, D null at both ends → `basis: "line"`, floor splay between stations
  shifting the result, no-inclination splay ignored, point outside tolerance →
  `null`, `multi` set from a multi-value D.
- `CsCalloutSync`: a `line`-basis label upgrading to `floor` after D is added,
  including the style change.

Listener behavior — undo grouping, recursion guard, deletion cascade — is
verified by hand against the Pitfall Cave fixture in `testdata`. It needs a
live document interface, so it is not unit-testable in this harness. That
limit is stated rather than faked with a mock that proves nothing.

## 12. Build order

1. `Core/CsCallout.js` reflow + data model, with tests. No commands yet.
2. `CsCallout` command + wiring. Placement works; nothing follows edits yet.
3. `CsCalloutSync`. Now edits are repairable manually — usable product.
4. `Core/CsElevation.js` + tests.
5. `CsCalloutElev` command + wiring.
6. `CalloutListener.js`. Live glue last, on a reflow core already proven by
   steps 1–5.

Each step is shippable. The listener is the riskiest piece and lands on top of
tested foundations rather than underneath them.

## 13. What this deliberately does not do

- No single-entity multileader. Not possible in script (§1).
- No AutoCAD MLEADER style objects, no dimension-style integration beyond
  reading `dimasz`/`dimscale`.
- No DXF round-trip as a multileader. Exported files carry a text and some
  leaders; other CAD sees exactly that. The link lives in XDATA and survives
  round-trip through CaveCAD only.
- No survey-tag prefill on `CsCallout` in v1. Later hook.
- No lidar. Entrance elevation and lidar sampling are their own spec;
  `CsElevation` is built to be their consumer-facing primitive.
- No auto-placement or collision avoidance. The caver picks where text goes.
