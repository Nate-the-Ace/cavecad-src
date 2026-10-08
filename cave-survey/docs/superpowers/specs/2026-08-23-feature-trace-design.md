# Feature Trace — Design

Date: 2026-08-23
Status: approved design, not yet implemented
Depends on `2026-08-23-profile-in-plan-drawing-design.md`, whose
`CsLayers.frameOf` is the frame test this tool consumes. Feature Trace is the
FIFTH frame-aware consumer, joining the four that spec's §5 names.

## 1. What this is

A freehand tracing tool for cave features. The caver holds the left button and
drags along a wall in the scanned sketch; the tool samples the drag, resamples
it to one point per foot, reduces it to the control points the curve actually
needs, and lays a spline on the correct feature layer.

Two problems it solves, and the second is the reason it is worth building:

1. **Tracing a wall by clicking spline fit points is slow and lumpy.** A caver
   traces hundreds of feet of passage per sketch.
2. **The plan and the elevation now live in one drawing.** "Current layer" is
   a coin flip, and a mistrace puts elevation linework on a plan layer where it
   binds to whatever plan station happens to sit nearby in absolute
   coordinates. The tool makes the target explicit and the frame checked.

## 2. User decisions

- Freehand drag-sample, not click-then-densify.
- Output is a fitted spline with REDUCED control points, not one fit point per
  foot. A 400-point spline is a polyline wearing a costume.
- A docked panel is the only surface. No per-feature menu commands.
- Panel button labels are bare inside frame-labelled groups (`Ceiling`, not
  `Profile Ceiling`). Layer names keep the `PROFILE-` prefix unchanged.
- A frame mismatch is REFUSED, never auto-corrected to the other frame's
  equivalent.
- `BREAKDOWN-BOUNDARY` keeps no profile twin. In section the breakdown outline
  IS the boundary.
- Accepted losses from the panel-only choice: no command-line aliases, no
  assignable keyboard shortcuts.

## 3. Files

| File | Holds |
|---|---|
| `Core/CsTrace.js` | ALL the math. Resample, reduce, fit, and the point→frame region test. No document or GUI dependency in the pure functions, so the headless harness calls them directly. |
| `FeatureTrace/FeatureTrace.js` | The folder-named tool: the menu action, the dock construction, and the panel's own state. The `SurveyNotebook.js` shape. |
| `FeatureTrace/FeatureTraceRun.js` | The interactive drag action. Unwidgeted — reachable only from the panel. |
| `Core/CsLayers.js` | No new layers. Verified: every target this tool writes to already exists with a `DEFAULTS` row. |

`Cs` prefix on the Core file matching its global, per the basename-dedupe
convention: QCAD's `include()` dedupes by basename and would silently skip a
`Trace.js`.

## 4. The trace pipeline

Ordered; each step feeds the next.

1. **Capture.** `mousePressEvent` arms, `mouseMoveEvent` samples while the left
   button is held, `mouseReleaseEvent` commits — the shape stock
   `scripts/Draw/Line/LineFreehand/LineFreehand.js` already proves in this
   build (GPLv3, same licence as the fork; derive with attribution).
   `event.getModelPosition()` gives drawing coordinates directly.

   We add what LineFreehand lacks: a threshold. It pushes EVERY move event.
   We keep a sample only once the cursor has moved ~6 px ON SCREEN, computed as
   `6 / view.getFactor()` in model units. Screen-space deliberately: a fixed
   1 ft drawing threshold is sub-pixel when zoomed out (flooding points) and
   lags a foot behind the cursor when zoomed in.

2. **Resample.** Convert the captured path to fixed arc-length spacing of 1 ft,
   expressed in DRAWING units via `CsUnits`, so a metric cave gets 0.3048 m
   rather than 1 unit. This is where "a control point every foot" lives.

3. **Reduce.** Ramer–Douglas–Peucker with a per-feature tolerance. A straight
   passage collapses to a handful of points; a scalloped wall keeps many. This
   is what makes the output a spline rather than a costumed polyline.

4. **Fit.** `RSpline` through the survivors as fit points, degree 3.

5. **Emit.** `CsLayers.ensure` the target, then add inside
   `CsLayers.withLayerOn` — switching the feature layer off to see the scan
   underneath is the expected workflow, and this build drops adds on an off
   layer with no error at all.

**Preview draws the captured polyline, not the fitted spline.** `updatePreview()`
fires on every sampled move; re-running resample→reduce→fit each time buys
nothing a caver can see mid-drag and makes the tool feel heavy.

Steps 2–4 are pure functions on `CsTrace`.

## 5. Frame awareness

Three parts. Feature Trace is the fifth consumer in the profile-in-plan §5 list.

**Frame is derived, never declared.** A panel row carries only a layer
constant. Its frame comes from `CsLayers.frameOf(row.layer)`. No `frame:
"profile"` field anywhere — that is the second spelling of the question §3
exists to prevent.

**A region test, because the row only guards the layer.** Separate buttons stop
you writing plan walls onto a profile layer. Nothing stops you arming `Ceiling`
and dragging up in the plan: right layer, geometry hundreds of feet from
anything it describes, bound to the wrong stations.

`CsTrace.frameAt(doc, point)` answers it, by unioning the bounding boxes of
every entity whose layer answers `"profile"` to `CsLayers.frameOf` — deriving
from the one frame test rather than restating it. Entities, not
`CsProfileDraw.regionOrigin(doc)`: the marker gives a point and not an extent,
and the caver's own traced linework legitimately grows the region past the
generated band bounds. It degrades correctly — no profile-frame entities means
no region, so every point answers `"plan"`. Gutter clicks resolve to plan,
matching `frameOf`'s own deliberate "unrecognised → plan" bias.

**Refuse, don't auto-correct.** Mouse-down outside the armed row's frame is
rejected before any geometry exists, with a message naming both frames. No
guessing at an equivalent: plan `Walls` maps to ceiling or floor ambiguously,
and a guess writes real geometry. `mouseReleaseEvent` re-checks that the WHOLE
captured path stayed in frame and discards the run if it did not — a wall
crossing the gutter is meaningless in either view, and the cost is one re-drag.

## 6. The panel

A `QDockWidget` in `Qt.RightDockWidgetArea`, following `SurveyNotebook`'s dock
exactly, including its two load-bearing details:

- **Built during `init()` and left hidden.** The main window's `restoreState()`
  runs after add-on init and can only place a dock that already exists. Get the
  order wrong and the panel silently never remembers where it was.
- **Per-control degradation.** Every widget construction and `connect` wrapped;
  refusals collect into a `problems` list and the rest of the panel works. The
  bridge has no `QTableWidget`; nothing here needs one.

```
Feature Trace
──────────────────────────────────────────────
Cursor frame:   PLAN
Interval [1.0] ft     Smoothing [Medium  ▾]
──────────────────────────────────────────────
 Plan
   [ Surveyed Walls          ]
   [ Inferred Walls          ]
   [ Breakdown               ]
   [ Breakdown Boundary      ]
   [ Entrance                ]
 Profile
   [ Ceiling                 ]
   [ Floor                   ]
   [ Inferred Walls          ]
   [ Breakdown               ]
   [ Entrance            ⚠ off ]
──────────────────────────────────────────────
Last trace: PROFILE-CEILING — 34 sampled, 9 kept
```

Two `QGroupBox`es give the visual split, and the group header carries the frame
— which is why the buttons inside can be bare.

**The armed target MUST be visibly checked.** Panel-only means the target lives
in module state on `FeatureTrace`, which is exactly the invisible-mode failure
that per-feature commands were meant to prevent. The panel answers that
objection only if it shows which row is armed. A checkable button group, not a
label.

Three more things the panel makes visible, each converting a silent failure
this suite keeps re-fighting:

- **Layer-off marker per row.** Read `isOff()` and mark the button. Otherwise an
  hour of tracing lands nowhere and nothing says so.
- **Profile group disabled when the drawing has no elevation**, reason in the
  tooltip — better than a refused click that reads as a broken button.
- **Live cursor-frame readout**, so the wrong-region trace is prevented rather
  than rejected.

## 7. Targets

Plan frame:

| Button | Constant |
|---|---|
| Surveyed Walls | `WALLS_SURVEYED` |
| Inferred Walls | `WALLS_INFERRED` |
| Breakdown | `BREAKDOWN` |
| Breakdown Boundary | `BREAKDOWN_BOUNDARY` |
| Entrance | `ENTRANCE` |

Profile frame:

| Button | Constant |
|---|---|
| Ceiling | `PROFILE_TRACED_CEILING` |
| Floor | `PROFILE_TRACED_FLOOR` |
| Inferred Walls | `PROFILE_WALLS_INFERRED` |
| Breakdown | `PROFILE_BREAKDOWN` |
| Entrance | `PROFILE_ENTRANCE` |

The asymmetries are the geometry's, not the naming rule's: `Walls` has no
profile twin because in an elevation the walls ARE the ceiling and floor lines,
and `Ceiling`/`Floor` have no plan twin for the same reason.

## 8. Wiring

Two `RGuiAction`s, each alone on its own script file so
`RGuiAction.getByScriptFile` disambiguates:

- `FeatureTrace.js` — menu entry "Feature Trace", widgeted onto
  `CaveSurveyMenu` and `CaveSurveyToolBar`, `setRequiresDocument(false)`.
  `beginEvent` toggles dock visibility. Group sort order 450, sort order unique.
- `FeatureTraceRun.js` — the drag action. No widget names; never in a menu. A
  panel button sets `FeatureTrace.target`, then looks the action up and calls
  `di.setCurrentAction(new FeatureTraceRun(guiAction))`, the stock
  `scripts/File/Print/Print.js` pattern. Passing the real action rather than
  `null` keeps EAction off its unexercised null-`guiAction` paths.

## 9. Traps

- **The constant-name trap.** `CsLayers.PROFILE_FLOOR` is the GENERATED
  `CTRL-PROFILE-FLOOR`; `CsLayers.PROFILE_TRACED_FLOOR` is the traced one. A
  one-word slip puts hand-tracing onto generator-owned geometry that the next
  `erase()` eats — and it looks like it worked until the next redraw. Guarded by
  test, §10.
- **Origin translation is free, and that is an argument for the registry
  names.** `CsProfileDraw.translateRegion` moves everything on profile-frame
  layers when the region moves, hand-drawn included, so traces travel with the
  band at no cost here. Only because `PROFILE-` classifies as profile: a trace
  on a hand-invented `MY-PROFILE-WALLS` classifies as PLAN, stays put, and
  detaches from the band it described.
- **Binding is free and frame-correct.** `CsBind` already gates on `frameOf`, so
  profile traces bind to profile stations. Do NOT tag at draw time; the existing
  `CsBind.tagEntities` sweep picks new linework up, and tagging here would
  double-bind.
- **Vertical exaggeration does NOT scale the sample interval.** At 2x, one
  drawing unit of Y in the band is half a foot of cave. The interval and the RDP
  tolerance govern curve smoothness on the sheet, not measurement, so both stay
  in drawing units — deliberately, with a comment saying so, or someone later
  "fixes" it by dividing by exaggeration and makes profile traces lumpy.
- **Elevation datum.** Traced picks carry z from the pick coordinate. Plan
  features sit at z=0 correctly, but nothing may rebase a cave on an absolute
  datum. Verification task: trace on a band in an absolute-datum cave and
  confirm no z reaches `CsProfileBind`'s reading of it.
- **Undo.** One trace is one operation, except where `withLayerOn` has to
  toggle; then three. The toggles no-op when the layer is on.
- **Snap crosses frames and we cannot stop it.** QCAD's snap knows nothing about
  frames, so entity-snap in the band can grab a plan-frame entity at the same
  absolute coordinate. Out of scope; known.

## 10. Testing

Headless, on the pure `CsTrace` functions:

- Resample: known path → known spacing, in both ft and m drawings.
- Reduce: a straight line collapses to 2 points; a sine keeps a bounded count.
- Fit: every fit point lies on the input within tolerance.
- `frameAt`: fixtures place plan and profile geometry at deliberately
  OVERLAPPING absolute coordinates and prove the answer is right in BOTH
  directions — the same fixture shape the profile-in-plan spec §10 calls the
  real risk.
- Every panel row's target satisfies `CsBind.isLineworkLayer` — false for any
  `CTRL-` name, so the `PROFILE_FLOOR`/`PROFILE_TRACED_FLOOR` slip becomes a
  named test failure instead of lost work.
- Every panel row's `frameOf` matches the group it sits in.
- Refusal is a refusal: after a rejected cross-frame drag, entity count is
  unchanged.

Under CaveCAD, not node: drag capture, the dock, and the layer-off marker.

Standing conventions apply unchanged: a rising assertion count is not coverage
(delete the behaviour, confirm a NAMED test fails, report which mutation each
test kills); no bundled assertion with substring matching; off layers refuse
adds, deletes AND modifies; comparators must be total orders because this
engine's sort is unstable.

## 11. Build order

1. `CsTrace.js` with its headless tests. No GUI.
2. `FeatureTraceRun.js` driving ONE hardcoded target, to prove drag capture,
   preview and emit end-to-end in the app.
3. `FeatureTrace.js`: the dock, the full row table, the frame guard, the
   armed-target indicator and the layer-off markers.

Nothing built in step 2 is thrown away in step 3.

## 12. What this deliberately does not do

- **Edit an existing trace.** Re-tracing replaces; there is no point-drag mode.
  QCAD's own spline editing already handles a fitted spline.
- **Snap the trace ends to each other or to stations.** Wall runs meeting
  exactly is a cartographer's judgement, not something to guess at.
- **Trace from a raster automatically.** Edge detection over a scan is a
  different feature with a different failure mode.
- **Command aliases or shortcuts.** A consequence of the panel-only decision,
  recorded here so it reads as a choice and not an omission.
