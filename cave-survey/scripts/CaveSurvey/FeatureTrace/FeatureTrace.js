// FeatureTrace.js -- Feature Trace: the menu entry and the docked panel
// that arms which feature the next drag traces.
//
// The interactive drag lives in FeatureTraceRun.js beside this file.
// QCAD cannot find that file on its own -- AddOn.getAddOns only builds
// an add-on from <dir>/<dir>.js -- so init() below registers it.
//
// Panel shape follows SurveyNotebook's dock, including the two details
// that are load-bearing rather than stylistic: the dock is BUILT during
// init() and left hidden (the main window's restoreState() runs after
// add-on init and can only place a dock that already exists), and every
// widget construction and connect is wrapped so a bridge refusal costs
// one control rather than the whole panel.

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");
include(includeBasePath + "/FeatureTraceRun.js");
// The shaped-line draw action, so this panel can arm a ledge or a
// scallop as readily as a wall: same gesture, same freehand drag, same
// view routing -- the only difference is that ornament comes with it.
// See SHAPED_ROWS below.
include(includeBasePath + "/../ShapedLines/ShapedLinesRun.js");

function FeatureTrace(guiAction) {
    EAction.call(this, guiAction);
}

FeatureTrace.prototype = new EAction();

/** The armed target layer, read by FeatureTraceRun.targetLayer().
 *
 *  Module state, which is only safe because the panel SHOWS which row
 *  is armed. Panel-only means there is no per-feature menu command to
 *  make the choice visible, so the checked button IS the indicator --
 *  see armLayer below. Undefined means "not yet armed", and
 *  targetLayer() falls back to WALLS-SURVEYED. */
FeatureTrace.target = undefined;

// THE CURRENT-LAYER ESCAPE HATCH IS GONE (2026-09-07). It armed a
// sentinel that resolved to whatever layer the drawing was set to, and
// it was removed at Nathan's asking: a panel of features whose last
// button means "not one of these" is a panel arguing with itself, and
// QCAD's own draw tools already trace onto the current layer.

/**
 * The seven traceable features. ONE ROW PER FEATURE, not per view.
 *
 * The panel used to hold fifteen rows -- every feature once for each of
 * plan, profile and section -- inside three group boxes, and pressing
 * the wrong group's button was refused at the cursor. That refusal was
 * the tool asking the caver to say in a button what the drawing already
 * knew: a section bay's frame and a profile band's bounding box both
 * state, in the drawing, exactly which view a point belongs to. So the
 * view is READ from where the stroke lands (FeatureTraceRun.targetLayer)
 * and a feature needs one button.
 *
 * The `layer` is the PLAN-FRAME name, and it is the feature's identity
 * rather than its destination: CsLayers.twinFor turns BREAKDOWN into
 * PROFILE-BREAKDOWN or SECTION-BREAKDOWN at trace time, from the one
 * table that already derives every twin in the registry. A per-view
 * name spelled here would be a second copy of that derivation, free to
 * disagree with it.
 *
 * Layer CONSTANTS, never literals. CsLayers.CTRL_FLOOR is the GENERATED
 * layer and CsLayers.FLOOR the hand-traced one: one word apart,
 * opposite meanings, and tracing onto the generated one would look fine
 * until the next redraw erased the work. A test asserts every row here
 * is a plan-frame linework layer, which is false for anything CTRL-.
 */
FeatureTrace.ROWS = [
    { label: "Surveyed Walls", layer: CsLayers.WALLS_SURVEYED,
      alias: "solid known measured passage edge" },
    { label: "Inferred Walls", layer: CsLayers.WALLS_INFERRED,
      alias: "dashed uncertain guessed sketched edge" },
    { label: "Breakdown", layer: CsLayers.BREAKDOWN,
      alias: "rocks blocks boulders collapse rubble" },
    { label: "Breakdown Boundary", layer: CsLayers.BREAKDOWN_BOUNDARY,
      alias: "rubble field outline extent" },
    { label: "Entrance", layer: CsLayers.ENTRANCE,
      alias: "mouth sink opening" },
    { label: "Ceiling", layer: CsLayers.CEILING,
      alias: "roof overhead" },
    { label: "Floor", layer: CsLayers.FLOOR,
      alias: "sediment bottom" }
];

/**
 * The shaped lines: the same freehand gesture, with NSS ornament
 * generated along the stroke and kept in step with it afterwards.
 *
 * WHY THEY LIVE IN THIS PANEL (Nathan's call, 2026-09-07). They were a
 * toolbar of their own, which made two front doors for one act: a caver
 * tracing a cave draws walls, ledges and flowstone in the same breath,
 * with the same drag, and had to know that six of those live somewhere
 * else. A shaped line IS a traced feature -- it just brings hachures.
 *
 * `style` is the CsShapeLine.STYLES key, and it is what marks a row as
 * shaped: armLayer starts the shaped action for these and the plain
 * one for everything in ROWS. The layer is the STYLE's own spine layer,
 * carried here only so the tile can paint itself in the right colour.
 */
FeatureTrace.SHAPED_ROWS = [
    { label: "Floor Ledge", style: "floorledge",
      alias: "bench step down drop" },
    { label: "Ceiling Ledge", style: "ceilingledge",
      alias: "bench step up overhang" },
    { label: "Pit", style: "pit", alias: "shaft drop hole domepit" },
    { label: "Flowstone", style: "flowstone",
      alias: "calcite drapery cascade" },
    { label: "Rimstone Dam", style: "rimstone",
      alias: "gour pool dam" },
    { label: "Slope", style: "slope", alias: "ramp incline breakdown slope" },
    { label: "Wall Glyphs", style: "glyphs",
      alias: "stone blocks rubble scatter wall ornament symbol" }
];

/**
 * How hard to thin the trace, as a FRACTION of the sample spacing.
 *
 * A fraction and not an absolute distance, so one setting means the
 * same thing in a foot drawing and a metre one.
 *
 * The first scale here was far too loose -- Medium at HALF the interval
 * meant a six-inch tolerance at one point per foot, which flattens the
 * scallops and rock detail that make a cave wall read as a cave wall.
 * Every step is tighter now, listed from least smoothing to most, and
 * the default moved to Fine.
 *
 * "No Smoothing" is a tolerance of zero: every resampled point becomes
 * a control point, which is literally one control point per foot of
 * cave. Only exactly-collinear points drop, so a straight run is still
 * two points rather than a hundred.
 *
 * Note the OTHER lever: reduction can only keep detail the resampling
 * left. At the default one-foot interval, nothing smaller than a foot
 * survives no matter what this is set to. For finer walls, lower the
 * Interval as well.
 */
FeatureTrace.SMOOTHING = [
    { label: "No Smoothing", fraction: 0.0 },
    { label: "Fine", fraction: 0.05 },
    { label: "Medium", fraction: 0.15 },
    { label: "Coarse", fraction: 0.35 }
];

/**
 * The row the panel starts on.
 *
 * NO SMOOTHING, Nathan's call: a caver tracing a wall off a scan is
 * copying a line someone already drew, and thinning it is the tool
 * second-guessing a measurement. Anyone who wants it thinned picks a
 * row.
 *
 * DELIBERATELY NOT the fallback below. This is a starting CHOICE and
 * is allowed to be a tolerance of zero; the fallback is what an
 * unrecognised name lands on, and zero would be wrong there -- see
 * FALLBACK_SMOOTHING.
 */
FeatureTrace.DEFAULT_SMOOTHING = "No Smoothing";

/**
 * The sample interval, in FEET of cave. Fixed.
 *
 * IT USED TO BE A FIELD, and the field is gone (Nathan, 2026-09-07:
 * "we can remove the interval setting and the smoothness, keep it at
 * 1ft and no smoothing"). Both boxes sat at the top of the panel asking
 * a caver to answer two questions about fidelity before they had chosen
 * what they were drawing, and in practice the answer was always the one
 * they are set to here. The values live on so the machinery below reads
 * the same as it always did -- and so a future panel that wants them
 * back has something to bind to.
 */
// RAISED FROM 1.0 TO A QUARTER FOOT, 2026-09-12: Nathan traced against a
// scan and found a foot too coarse. The number itself now lives in
// Core/CsTrace.js so walls, shaped-line spines and area boundaries all
// sample alike -- see CsTrace.INTERVAL_FEET for the measurements behind
// it. This name stays because the panel machinery binds to it.
// READ AT CALL TIME, never assigned here at load time: a tool file can
// be evaluated before Core, and a load-time read of CsTrace would throw
// and cost the whole panel. intervalFeet() below is the accessor.
FeatureTrace.INTERVAL_FEET = null;

/**
 * Where an unrecognised smoothing name lands.
 *
 * SEPARATE FROM DEFAULT_SMOOTHING since the panel's starting row became
 * a zero tolerance. Folding the two together would make a misspelled or
 * stale name silently mean "keep every sampled point" -- the
 * 400-fit-point spline this whole reduction exists to avoid -- which is
 * exactly the failure the fallback was written to stop.
 */
FeatureTrace.FALLBACK_SMOOTHING = "Fine";

/** The fraction for a smoothing name. An unrecognised name falls back
 *  to FALLBACK_SMOOTHING, never to a tolerance of zero. */
FeatureTrace.smoothingFraction = function(name) {
    var i;
    for (i = 0; i < FeatureTrace.SMOOTHING.length; i++) {
        if (FeatureTrace.SMOOTHING[i].label === name) {
            return FeatureTrace.SMOOTHING[i].fraction;
        }
    }
    for (i = 0; i < FeatureTrace.SMOOTHING.length; i++) {
        if (FeatureTrace.SMOOTHING[i].label ===
                FeatureTrace.FALLBACK_SMOOTHING) {
            return FeatureTrace.SMOOTHING[i].fraction;
        }
    }
    return 0.15;
};

/** The dock, and the widgets the panel updates. Module-level singletons
 *  because there is one panel per application window. */
// The panel lives in the Draw dock (see DrawPanel/DrawPanel.js). "Is it on
// screen?" is asked of Draw, which owns it.
FeatureTrace.showing = function() {
    try {
        return (typeof DrawPanel !== "undefined" && DrawPanel.showing());
    } catch (e) {
        return false;
    }
};
FeatureTrace.widgets = undefined;

/**
 * Sets the armed target and makes the panel show it.
 *
 * The showing is not decoration. With no per-feature menu commands, a
 * target held in module state is exactly the invisible mode that
 * separate commands would have prevented; the panel answers that only
 * while it displays which row is armed. Checked buttons, one at a time.
 */
FeatureTrace.armLayer = function(layerName) {
    FeatureTrace.target = layerName;
    FeatureTrace.clearShaped();
    FeatureTrace.refresh();
    // Here and not in the tile's own click handler, so a feature armed
    // from the keyboard counts as used too -- the Recent row is about
    // what the caver is drawing, not about which control they reached
    // for.
    FeatureTrace.noteRecent(FeatureTrace.rowForKey("layer:" + layerName));

    var w = FeatureTrace.widgets;
    if (isNull(w) || isNull(w.buttons)) {
        return;
    }
    for (var i = 0; i < w.buttons.length; i++) {
        try {
            w.buttons[i].button.checked =
                (w.buttons[i].row.layer === layerName);
        } catch (e) {
            // a button the bridge will not let us write back is still
            // armed correctly; only its appearance is wrong
        }
    }
};

/** The sample interval in FEET, from the panel, or 1.0.
 *
 *  Feet and not drawing units, so the field means the same thing in a
 *  metre drawing -- CsTrace.spacingFor converts. A blank or nonsense
 *  entry falls back rather than refusing: a bad number in a text box
 *  must not stop a caver mid-trace. */
FeatureTrace.intervalFeet = function() {
    if (FeatureTrace.INTERVAL_FEET !== null &&
            !isNull(FeatureTrace.INTERVAL_FEET)) {
        return FeatureTrace.INTERVAL_FEET;   // a test or a caller pinned it
    }
    return CsTrace.INTERVAL_FEET;
};

/**
 * How hard a trace is thinned: not at all.
 *
 * See INTERVAL_FEET. No Smoothing was already the panel's starting
 * choice, on the grounds that thinning a traced wall is the tool
 * second-guessing a measurement; with the control gone it is simply
 * what the tool does.
 */
FeatureTrace.toleranceFraction = function() {
    return FeatureTrace.smoothingFraction(FeatureTrace.DEFAULT_SMOOTHING);
};

// THE RUN SELECTOR IS GONE (2026-09-08). A combo offered "from the
// band I draw in" (the default), "not tied to a band", or a named
// band, with Isolate and Show All beside it -- and Nathan's answer was
// that the first of those is the only one he ever meant: "I want
// whatever feature I trace to be tied to the runs by whether they're
// in the bounding box or not."
//
// That IS what the tool was designed to do. The band boxes already know
// which run a stroke lies in (CsProfileBox), which is precisely the
// fact the old per-view buttons were deleted for making a caver
// restate; an override combo was the same mistake in different
// clothes. FeatureTraceRun.targetLayer reads the run off the stroke,
// always. A stroke inside no box lands on the shared layer and
// warnUnclaimedProfile says so.



/** Reports what the last trace cost, so the caver can feel whether the
 *  smoothing suits the passage rather than guessing at a number. */
FeatureTrace.reportTrace = function(layerName, result) {
    var w = FeatureTrace.widgets;
    if (isNull(w) || isNull(w.lastLabel)) {
        return;
    }
    try {
        w.lastLabel.text = (result.extended === true ?
                qsTr("Last: %1 extended -- %2 sampled, %3 kept") :
                qsTr("Last: %1 -- %2 sampled, %3 kept"))
            .arg(layerName).arg(result.sampled).arg(result.kept);
    } catch (e) {
        // a stale readout must never stop a trace
    }
};

/**
 * Writes the cursor's view -- and the layer that view means -- into the
 * panel. Defensive and silent.
 *
 * THE LAYER HALF IS THE SAFETY RAIL. With no per-view buttons, nothing
 * refuses a stroke for being in the wrong view: an elevation wall
 * traced a foot outside the profile region is a perfectly good PLAN
 * wall, and it lands silently. This readout is what makes that visible
 * BEFORE the press -- it changes as the cursor crosses a boundary, so
 * the caver sees WALLS-SURVEYED where they expected
 * PROFILE-WALLS-SURVEYED-A while there is still nothing to undo.
 *
 * `layer` is optional: a caller with no armed feature to resolve (or
 * one that predates this) still gets the view on its own.
 */
FeatureTrace.showCursorFrame = function(frame, layer) {
    var w = FeatureTrace.widgets;
    // The counts are per VIEW, so they change when the cursor crosses
    // into one. Only when it CHANGES: this is called on every mouse
    // move, and counting thirteen layers per move would make the whole
    // application crawl on a real cave -- the same lesson markDirty
    // records about the region scans.
    if (frame !== FeatureTrace.cursorFrame) {
        FeatureTrace.cursorFrame = frame;
        try {
            FeatureTrace.refreshCounts();
        } catch (eCounts) {
        }
    }
    if (isNull(w) || isNull(w.frameLabel)) {
        return;
    }
    try {
        var text = qsTr("Cursor:  %1").arg(String(frame).toUpperCase());
        if (!isNull(layer) && String(layer).length > 0) {
            text += "  --  " + String(layer);
        }
        w.frameLabel.text = text;
    } catch (e) {
        // as above
    }
};

// THE FEATURE TILES ARE A GRID, NOT A LIST.
//
// One full-width button per feature made a column that grew every time
// a feature was added, until telling one entry from the next meant
// reading the whole stack -- and the buttons set the dock's width while
// they were at it. Fixed-size tiles in a grid mean a new feature is
// APPENDED to the next free cell: the panel grows a row for every
// GRID_COLUMNS features rather than for every one, and the shape stays
// scannable.
//
// REVERSED, 2026-09-28 (Nathan): "if a button is showing off a line or
// linetype, it needs to span the full width of that section ... almost
// like a button list." A square tile showed a line as a thumbnail; a
// line is read along its length. So the tiles are ONE column of full-
// width buttons, each carrying a wide strip of its line
// (LIST_ICON_W x LIST_ICON_H) with the name and count under it. The
// Recent strip keeps its compact squares -- it is a row of shortcuts.
FeatureTrace.GRID_COLUMNS = 1;
FeatureTrace.CELL_W = 104;
FeatureTrace.CELL_H = 56;
// 200, not wider: a Draw section in the handbook-sized dock is ~260 px of
// content, and a strip wider than that put a sideways scrollbar under
// Trace (measured 2026-09-28).
FeatureTrace.LIST_ICON_W = 200;
FeatureTrace.LIST_ICON_H = 24;
FeatureTrace.LIST_TILE_H = 64;
/** A Recent entry: the same full-width strip, no words, just tall enough
 *  for the line (Nathan, 2026-09-28: "button list, but no text and more
 *  vertically compact"). The name is on hover. */
FeatureTrace.RECENT_TILE_H = 30;
/** Roughly how many characters fit on one line of a tile. Used only to
 *  break the label -- QPushButton renders "\n" but will not wrap for
 *  itself (probed 2026-08-29). */
FeatureTrace.CELL_CHARS = 40;

/**
 * A label broken over as many lines as it takes, greedily, on spaces.
 * A single word longer than the budget is left alone: a mid-word break
 * is harder to read than an overhang.
 */
FeatureTrace.wrapLabel = function(text, budget) {
    var words = String(text).split(" ");
    var lines = [];
    var line = "";
    for (var i = 0; i < words.length; i++) {
        if (line.length === 0) {
            line = words[i];
        } else if (line.length + 1 + words[i].length <= budget) {
            line += " " + words[i];
        } else {
            lines.push(line);
            line = words[i];
        }
    }
    if (line.length > 0) {
        lines.push(line);
    }
    return lines.join("\n");
};

/**
 * True when a row matches the panel's search text.
 *
 * Matches the LABEL, the layer or style name, and the row's `alias` --
 * the words a caver would type that the label does not contain. A gour
 * is a rimstone dam and a shaft is a pit, and a feature findable by
 * only one of its names is a feature that looks missing. Same promise
 * the Symbol Palette's search makes about NSS and UIS names.
 *
 * An empty needle matches everything, so no-search is not a special
 * case anywhere else.
 *
 * Pure, so the unit tests can hold it to that.
 */
FeatureTrace.matches = function(row, needle) {
    if (isNull(needle) || String(needle).length === 0) {
        return true;
    }
    if (isNull(row)) {
        return false;
    }
    var n = String(needle).toLowerCase();
    var fields = [row.label, row.alias, row.layer, row.style];
    for (var i = 0; i < fields.length; i++) {
        if (isNull(fields[i])) {
            continue;
        }
        if (String(fields[i]).toLowerCase().indexOf(n) !== -1) {
            return true;
        }
    }
    return false;
};

/**
 * Re-packs a section's grid so the tiles still shown sit in the first
 * cells, with no holes where a filtered-out tile used to be.
 *
 * HIDE-ONLY, NOT REBUILD. The Symbol Palette tears its tiles down and
 * builds them again because its catalogue can gain and lose a symbol
 * while the panel is open; this panel's tiles are ROWS and
 * SHAPED_ROWS, two constants, so nothing can go stale behind a hidden
 * button -- and hiding keeps the armed tile's connections and its
 * checked mark intact through a search.
 *
 * `entry.shown === false` is the filtered-out mark. A bridge that
 * refuses removeWidget gets holes in the grid, which reads worse but
 * still filters; \return says which happened.
 */
FeatureTrace.reflow = function(grid, buttons, firstRow) {
    if (isNull(grid) || isNull(buttons)) {
        return false;
    }
    var shown = [];
    var i;
    for (i = 0; i < buttons.length; i++) {
        if (buttons[i].shown !== false) {
            shown.push(buttons[i].button);
        }
    }
    try {
        for (i = 0; i < buttons.length; i++) {
            grid.removeWidget(buttons[i].button);
        }
        for (i = 0; i < shown.length; i++) {
            grid.addWidget(shown[i],
                firstRow + Math.floor(i / FeatureTrace.GRID_COLUMNS),
                i % FeatureTrace.GRID_COLUMNS);
        }
    } catch (e) {
        return false;
    }
    return true;
};

/**
 * Shows the tiles matching the search box and hides the rest.
 *
 * A SECTION WITH NOTHING LEFT IN IT DISAPPEARS, header and all: an
 * empty "Draw a shaped line" heading during a search for "floor" is a
 * heading claiming there is nothing under it while taking the room to
 * say so.
 *
 * A SEARCH OPENS EVERYTHING it does show, and clearing it restores the
 * folds the caver had -- through CsPanel.setOpen, which deliberately
 * does not write to the collapsed set.
 */
FeatureTrace.applyFilter = function() {
    var w = FeatureTrace.widgets;
    if (isNull(w) || isNull(w.sections)) {
        return;
    }
    var needle = "";
    try {
        needle = isNull(w.searchEdit) ? "" : String(w.searchEdit.text).trim();
    } catch (eText) {
    }
    var collapsed = (needle === "") ?
        CsPanel.loadCollapsed(FeatureTrace.COLLAPSED_SETTING) : {};

    for (var s = 0; s < w.sections.length; s++) {
        var sec = w.sections[s];
        var any = false;
        var i;
        for (i = 0; i < sec.buttons.length; i++) {
            var hit = FeatureTrace.matches(sec.buttons[i].row, needle);
            sec.buttons[i].shown = hit;
            if (hit) {
                any = true;
            }
        }
        FeatureTrace.reflow(sec.grid, sec.buttons, sec.firstRow);
        // Visibility AFTER the re-pack: removeWidget leaves a widget
        // parented and visible where it was, so a hidden tile has to be
        // hidden in its own right rather than by being dropped from the
        // layout.
        for (i = 0; i < sec.buttons.length; i++) {
            try {
                sec.buttons[i].button.visible = sec.buttons[i].shown;
            } catch (eVis) {
            }
        }
        try {
            sec.section.box.visible = any;
        } catch (eBox) {
        }
        CsPanel.setOpen(sec.section, sec.title,
            needle === "" ? !(collapsed[sec.title] === true) : true);
    }
};

/** The one group box: every feature, as a grid of fixed-size tiles.
 *
 *  No frame filter and no per-view groups. A tile is a FEATURE, and the
 *  view it draws into is decided by where the caver drags -- see
 *  FeatureTrace.ROWS. `header` is the profile run selector, which sits
 *  inside the box above the tiles because it refines what a profile
 *  stroke lands on rather than choosing it. */
FeatureTrace.buildGroup = function(w, parent, title, header, collapsed) {
    var section = CsPanel.section(parent, title,
        FeatureTrace.COLLAPSED_SETTING, collapsed);
    var box = section.box;
    var inner = new QGridLayout();
    var cell = 0;
    var firstRow = 0;
    if (header !== undefined && header !== null) {
        try {
            inner.addLayout(header, 0, 0, 1, FeatureTrace.GRID_COLUMNS);
            firstRow = 1;
        } catch (eHeader) {
            w.problems.push(title + " header (" + eHeader + ")");
        }
    }

    for (var i = 0; i < FeatureTrace.ROWS.length; i++) {
        var row = FeatureTrace.ROWS[i];
        try {
            var button = FeatureTrace.tileFor(row, true);
            FeatureTrace.connectTileMenu(button, row);
            inner.addWidget(button,
                firstRow + Math.floor(cell / FeatureTrace.GRID_COLUMNS),
                cell % FeatureTrace.GRID_COLUMNS);
            cell++;
            w.buttons.push({ button: button, row: row });
        } catch (e) {
            w.problems.push(row.layer + " (" + e + ")");
        }
    }

    try {
        // One column of list buttons: that column takes the width.
        inner.setColumnStretch(0, 1);
    } catch (eStretch) {
    }

    section.host.setLayout(inner);
    // The grid and where its tiles start, so applyFilter can re-pack it
    // without knowing how it was built.
    section.grid = inner;
    section.firstRow = firstRow;
    return section;
};

/**
 * Every layer a feature can land on: its plan name and its two twins,
 * refined by the selected run where a run is selected.
 *
 * One tile, three destinations -- that IS the tool now, and this is the
 * one place that list is built, so the tooltip, the "(hidden)" marker
 * and anything added later cannot each derive it slightly differently.
 * The frames come from CsLayers.twinFor, which skips a twin the
 * registry refuses (CsLayers.NO_TWIN), so a feature with no section
 * counterpart simply lists two.
 *
 * Pure.
 *
 * The ELEVATION entry is the shared profile layer, not a band's own:
 * which band a stroke lands in is decided by where it is drawn, and
 * nothing here knows where that will be. The tooltip this feeds says
 * where a feature can go, not where the next stroke will end up.
 */
FeatureTrace.destinationsOf = function(base) {
    var frames = ["plan", "profile", "section"];
    var out = [];
    for (var i = 0; i < frames.length; i++) {
        var name = CsLayers.twinFor(base, frames[i]);
        if (name === null) {
            continue;
        }
        out.push(name);
    }
    return out;
};

/**
 * Every layer one tile draws on: its plan-frame layer and both twins.
 *
 * A tile is a FEATURE, and a feature exists in three views; hiding "the
 * breakdown" means hiding it in the plan, the elevation and the
 * sections, because a caver asking to see less does not mean "less,
 * except in the elevation".
 *
 * Shaped tiles carry two layers -- the spine and the ornament -- and
 * for flowstone and friends those differ (the spine lives on a CTRL-
 * layer). Both come, or hiding the feature would leave its skeleton on
 * screen.
 *
 * Pure apart from the registry it reads.
 */
FeatureTrace.layersOfTile = function(entry) {
    var bases = [];
    if (!isNull(entry.style)) {
        var spec = CsShapeLine.STYLES[entry.style];
        if (!isNull(spec)) {
            bases.push(spec.spineLayer);
            if (spec.decorLayer !== spec.spineLayer) {
                bases.push(spec.decorLayer);
            }
        }
    } else if (!isNull(entry.layer)) {
        bases.push(entry.layer);
    }
    var frames = ["plan", "profile", "section"];
    var out = [], seen = {};
    for (var i = 0; i < bases.length; i++) {
        for (var f = 0; f < frames.length; f++) {
            var name = CsLayers.twinFor(bases[i], frames[f]);
            if (name === null || seen[name] === true) {
                continue;
            }
            seen[name] = true;
            out.push(name);
        }
    }
    return out;
};

/** Every layer every tile in the panel draws on -- what "the rest" and
 *  "all of them" mean in the tile menu. Bounded to this panel's own
 *  features on purpose: a caver hiding things from here should not
 *  find their stations or their scans gone too. */
FeatureTrace.allTileLayers = function() {
    var out = [], seen = {}, i, j;
    var rows = FeatureTrace.ROWS.concat(FeatureTrace.SHAPED_ROWS);
    for (i = 0; i < rows.length; i++) {
        var names = FeatureTrace.layersOfTile(rows[i]);
        for (j = 0; j < names.length; j++) {
            if (seen[names[j]] !== true) {
                seen[names[j]] = true;
                out.push(names[j]);
            }
        }
    }
    return out;
};

/** True when every one of `names` that the drawing has is switched on. */
FeatureTrace.layersAreOn = function(doc, names) {
    if (isNull(doc)) {
        return true;
    }
    for (var i = 0; i < names.length; i++) {
        try {
            var lay = doc.queryLayer(names[i]);
            if (!isNull(lay) && lay.isOff()) {
                return false;
            }
        } catch (e) {
        }
    }
    return true;
};

/** Switches a set of layers on or off, in one undo step. */
FeatureTrace.setLayersOn = function(names, on) {
    var doc = null, di = null;
    try {
        doc = EAction.getDocument();
        di = EAction.getDocumentInterface();
    } catch (eEnv) {
        return 0;
    }
    if (isNull(doc) || isNull(di)) {
        return 0;
    }
    var op = new RModifyObjectsOperation();
    var touched = 0;
    for (var i = 0; i < names.length; i++) {
        try {
            var lay = doc.queryLayer(names[i]);
            if (isNull(lay)) {
                continue;   // a layer this drawing has never had
            }
            // ONLY THE ONES THAT HAVE TO CHANGE. Written the other way
            // round at first -- it acted on layers already in the state
            // being asked for, so Hide hid nothing and Show All
            // reported 36 layers it had not touched (2026-09-07).
            if (lay.isOff() === !on) {
                continue;
            }
            lay.setOff(!on);
            op.addObject(lay, false);
            touched++;
        } catch (e) {
        }
    }
    if (touched > 0) {
        try {
            di.applyOperation(op);
        } catch (eApply) {
            return 0;
        }
    }
    return touched;
};

/** Shows only this tile's layers, of the ones this panel draws on. */
FeatureTrace.isolateTile = function(entry) {
    var mine = FeatureTrace.layersOfTile(entry);
    var keep = {};
    var i;
    for (i = 0; i < mine.length; i++) {
        keep[mine[i]] = true;
    }
    var others = [];
    var all = FeatureTrace.allTileLayers();
    for (i = 0; i < all.length; i++) {
        if (keep[all[i]] !== true) {
            others.push(all[i]);
        }
    }
    FeatureTrace.setLayersOn(mine, true);
    var hidden = FeatureTrace.setLayersOn(others, false);
    EAction.handleUserMessage(qsTr("Showing %1 only (%2 other feature " +
        "layer(s) hidden). \"Show All Features\" brings them back.")
        .arg(entry.label).arg(hidden));
};

/**
 * The right-click menu on a feature tile.
 *
 * WHAT IT IS FOR. The Symbol Palette's tiles have had a menu since
 * 0.9.67.0, and Nathan's standing ask is that a panel feature belongs
 * in both panels. What a FEATURE tile can usefully offer is not
 * editing -- these are registry layers, not drawings -- but seeing:
 * a traced cave gets crowded, and the question "show me just the
 * breakdown" was a trip to the layer list.
 *
 * Everything here acts on the tile's layers in ALL THREE VIEWS, and
 * "the rest" means the other tiles in this panel -- never the whole
 * drawing. A caver hiding features should not lose their stations.
 */
FeatureTrace.connectTileMenu = function(button, entry) {
    try {
        button.contextMenuPolicy = Qt.CustomContextMenu;
    } catch (ePolicy) {
        return;
    }
    button.customContextMenuRequested.connect(function(pos) {
        try {
            var doc = null;
            try {
                doc = EAction.getDocument();
            } catch (eDoc) {
                doc = null;
            }
            var mine = FeatureTrace.layersOfTile(entry);
            var on = FeatureTrace.layersAreOn(doc, mine);
            var menu = new QMenu();

            var draw = menu.addAction(qsTr("Draw"));
            draw.triggered.connect(function() {
                if (isNull(entry.style)) {
                    FeatureTrace.armLayer(entry.layer);
                    FeatureTrace.startRun();
                } else {
                    FeatureTrace.armShaped(entry.style);
                }
            });
            menu.addSeparator();

            var toggle = menu.addAction(on ? qsTr("Hide This Feature") :
                qsTr("Show This Feature"));
            toggle.triggered.connect(function() {
                var n = FeatureTrace.setLayersOn(mine, !on);
                EAction.handleUserMessage(qsTr("%1: %2 layer(s) %3.")
                    .arg(entry.label).arg(n)
                    .arg(on ? qsTr("hidden") : qsTr("shown")));
            });

            var only = menu.addAction(qsTr("Show Only This Feature"));
            only.triggered.connect(function() {
                FeatureTrace.isolateTile(entry);
            });

            var all = menu.addAction(qsTr("Show All Features"));
            all.triggered.connect(function() {
                var n = FeatureTrace.setLayersOn(
                    FeatureTrace.allTileLayers(), true);
                EAction.handleUserMessage(qsTr("%1 feature layer(s) " +
                    "brought back.").arg(n));
            });

            try {
                var where = mine.join(", ");
                toggle.toolTip = where;
                only.toolTip = where;
            } catch (eTip) {
            }

            // Kept alive: popup() returns at once and a collected menu
            // vanishes mid-display.
            if (!isNull(FeatureTrace.widgets)) {
                FeatureTrace.widgets.tileMenu = menu;
            }
            menu.popup(button.mapToGlobal(pos));
        } catch (eMenu) {
            // no menu on this bridge: every tile still draws
        }
    });
};

/**
 * Arms the ONE tile a search has left showing, and starts drawing with
 * it. Says so when the search has not narrowed that far.
 *
 * Both kinds of tile: a search for "gour" leaves one shaped tile, and
 * arming it has to start the shaped action rather than the plain one --
 * which is armShaped's job, not a second copy of it here.
 */
FeatureTrace.armFiltered = function() {
    var w = FeatureTrace.widgets;
    if (isNull(w) || isNull(w.sections)) {
        return;
    }
    var only = null;
    var count = 0;
    for (var s = 0; s < w.sections.length; s++) {
        var buttons = w.sections[s].buttons;
        for (var i = 0; i < buttons.length; i++) {
            if (buttons[i].shown === false) {
                continue;
            }
            count++;
            only = buttons[i].row;
        }
    }
    if (count !== 1 || only === null) {
        EAction.handleUserMessage(count === 0 ?
            qsTr("No feature matches that. Try a cave word -- \"gour\", " +
                "\"shaft\", \"boulders\".") :
            qsTr("%1 features still match. Type more of the name, then " +
                "press Return.").arg(count));
        return;
    }
    if (isNull(only.style)) {
        FeatureTrace.armLayer(only.layer);
        FeatureTrace.startRun();
    } else {
        FeatureTrace.armShaped(only.style);
    }
    EAction.handleUserMessage(qsTr("Armed %1. Drag in the drawing to " +
        "trace it.").arg(only.label));
};

/**
 * Clears every armed tile -- the panel's half of Escape.
 *
 * Escape already ends the drawing action; until this existed the tile
 * it was drawing with stayed lit, which is a panel telling the caver
 * they are still armed when they are not. Called from the action's own
 * finishEvent, so it fires however the action ended.
 *
 * The armed TARGET is deliberately left alone. It is what the next
 * press would draw, and the tools read it when they start again -- a
 * caver who presses Escape and then drags again means the feature they
 * were using, not whatever the panel defaults to.
 */
FeatureTrace.disarmTiles = function() {
    var w = FeatureTrace.widgets;
    if (isNull(w)) {
        return;
    }
    var lists = [w.buttons, w.shapedButtons];
    for (var l = 0; l < lists.length; l++) {
        if (isNull(lists[l])) {
            continue;
        }
        for (var i = 0; i < lists[l].length; i++) {
            try {
                lists[l][i].button.checked = false;
            } catch (e) {
            }
        }
    }
};

/** Which view the cursor was last in. The counts on the tiles are of
 *  THIS view: a caver working in the elevation is owed the elevation's
 *  numbers, and a single figure summed over all three would say a
 *  passage is drawn when only its plan is. */
FeatureTrace.cursorFrame = "plan";

/**
 * Re-reads how many of each feature the current view holds, and writes
 * the numbers onto the tiles.
 *
 * WHY A COUNT AT ALL: it makes the panel a completeness check. A
 * passage whose walls are traced and whose floor is not says so in the
 * one place the caver is already looking, rather than after a print.
 *
 * Zero is shown as a dash and not as "0". A dash reads as "none yet",
 * which is the truth about a feature nobody has drawn; a 0 in a column
 * of numbers reads as a measurement.
 *
 * Silent throughout: a panel repaint must never throw into the
 * application, and a count that cannot be taken is worth less than the
 * tile it would break.
 */
FeatureTrace.refreshCounts = function() {
    var w = FeatureTrace.widgets;
    if (isNull(w) || isNull(w.buttons)) {
        return;
    }
    var doc = null;
    try {
        doc = EAction.getDocument();
    } catch (eDoc) {
        doc = null;
    }
    var frame = FeatureTrace.cursorFrame;
    var names = [];
    var forRow = [];
    var i;
    var lists = [w.buttons, w.shapedButtons];
    for (var l = 0; l < lists.length; l++) {
        if (isNull(lists[l])) {
            continue;
        }
        for (i = 0; i < lists[l].length; i++) {
            var row = lists[l][i].row;
            var name = null;
            try {
                if (isNull(row.style)) {
                    name = CsLayers.twinFor(row.layer, frame);
                } else {
                    // A shaped line is counted by its SPINES, never by
                    // its ornament: one ledge is one feature and forty
                    // hachures, and counting the hachures would report
                    // a passage forty times as drawn as it is.
                    var spec = CsShapeLine.STYLES[row.style];
                    name = isNull(spec) ? null :
                        CsShapeLine.layersFor(spec, frame).spine;
                }
            } catch (eName) {
                name = null;
            }
            forRow.push({ entry: lists[l][i], layer: name });
            if (name !== null) {
                names.push(name);
            }
        }
    }
    var counts = {};
    try {
        counts = CsTrace.countOnLayers(doc, names);
    } catch (eCount) {
        counts = {};
    }
    for (i = 0; i < forRow.length; i++) {
        var n = (forRow[i].layer === null) ? 0 :
            (counts[forRow[i].layer] || 0);
        try {
            forRow[i].entry.button.text =
                FeatureTrace.wrapLabel(forRow[i].entry.row.label,
                    FeatureTrace.CELL_CHARS) +
                "\n" + (n === 0 ? "--" : String(n));
        } catch (eText) {
        }
    }
};

/** The settings key holding the last few features armed. */
FeatureTrace.RECENT_SETTING = "CaveSurvey/FeatureTraceRecent";

/**
 * One tile, built the same way wherever it appears.
 *
 * The sections and the Recent row draw the SAME tile -- same picture,
 * same label, same size -- because a caver who has learnt to recognise
 * the flowstone tile must recognise it in both places. Two builders
 * would be two tiles that drift apart the first time one is adjusted.
 *
 * `checkable` is false for a Recent tile: the armed mark belongs to the
 * tile in the section, and two lit copies of one feature would raise
 * the question of which one is armed.
 */
FeatureTrace.tileFor = function(row, checkable, compact) {
    // A TOOL button, not a push button: QPushButton lays icon and text
    // side by side with no way to stack them, so the name ends up cut
    // off next to the picture.
    var button = new QToolButton();
    if (compact !== true) {
        button.text = FeatureTrace.wrapLabel(row.label,
            FeatureTrace.CELL_CHARS);
        try {
            button.toolButtonStyle = Qt.ToolButtonTextUnderIcon;
        } catch (eStyle) {
        }
    }
    button.checkable = (checkable !== false);
    var icon = null;
    // The NAME always leads, compact tile or not: it is what CsPanel's
    // tooltip is built around, and a picture with no name under it was
    // the one case the old mechanical tooltip had to special-case.
    var detail = [];
    if (isNull(row.style)) {
        detail.push(row.layer);
        icon = FeatureTrace.iconForLayer(row.layer, true);
    } else {
        var spec = CsShapeLine.STYLES[row.style];
        detail.push(isNull(spec) ? "" : spec.decorLayer);
        detail.push(qsTr("Drag along the line, then point at the side " +
            "the ornament goes and click."));
        icon = FeatureTrace.iconForStyle(row.style, true);
    }
    button.toolTip = CsPanel.tipHtml(row.label, CsHelp.forFeature(row),
        detail);
    if (icon !== null) {
        try {
            button.icon = icon;
            button.iconSize =
                new QSize(FeatureTrace.LIST_ICON_W, FeatureTrace.LIST_ICON_H);
        } catch (eIcon) {
        }
    }
    try {
        if (compact === true) {
            // A COMPACT tile is the picture alone: a Recent entry, one
            // full-width strip per row, as short as the line allows.
            button.setFixedHeight(FeatureTrace.RECENT_TILE_H);
            button.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed);
        } else {
            // A LIST BUTTON: the full width of the section, a fixed
            // height for the line strip plus name and count.
            button.setFixedHeight(FeatureTrace.LIST_TILE_H);
            button.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed);
        }
    } catch (eSize) {
        // a bridge without setFixedSize gets tiles that stretch; the
        // grid still reads as a grid
    }
    if (isNull(row.style)) {
        FeatureTrace.connectRow(button, row);
    } else {
        FeatureTrace.connectShapedRow(button, row);
    }
    return button;
};

/** The row a recent KEY names, or null when the key names nothing this
 *  panel still has -- a feature removed from ROWS between sessions. */
FeatureTrace.rowForKey = function(key) {
    var i;
    for (i = 0; i < FeatureTrace.ROWS.length; i++) {
        if ("layer:" + FeatureTrace.ROWS[i].layer === key) {
            return FeatureTrace.ROWS[i];
        }
    }
    for (i = 0; i < FeatureTrace.SHAPED_ROWS.length; i++) {
        if ("style:" + FeatureTrace.SHAPED_ROWS[i].style === key) {
            return FeatureTrace.SHAPED_ROWS[i];
        }
    }
    return null;
};

/** The key a row is remembered under. Prefixed, because a layer name
 *  and a style key are different namespaces and nothing stops one
 *  gaining a value the other already has. */
FeatureTrace.keyForRow = function(row) {
    if (isNull(row)) {
        return "";
    }
    return isNull(row.style) ? ("layer:" + row.layer) : ("style:" + row.style);
};

/**
 * Rebuilds the Recent row from what has been armed lately.
 *
 * PINNED ABOVE THE SECTIONS and outside the foldable stack: it is a
 * shortcut to what you are using now, and a shortcut you have to unfold
 * first is not one. It is also not reorderable for the same reason --
 * there is nothing to order, and the row's whole meaning is its order.
 *
 * The row hides itself when there is nothing in it, so a fresh install
 * shows the panel it always showed rather than an empty heading.
 */
FeatureTrace.rebuildRecent = function() {
    var w = FeatureTrace.widgets;
    if (isNull(w) || isNull(w.recentRow)) {
        return;
    }
    var keys = CsPanel.loadRecent(FeatureTrace.RECENT_SETTING);
    CsPanel.clearLayout(w.recentRow);
    var shown = 0;
    for (var i = 0; i < keys.length; i++) {
        var row = FeatureTrace.rowForKey(keys[i]);
        if (row === null) {
            continue;   // a feature that no longer exists
        }
        try {
            w.recentRow.addWidget(
                FeatureTrace.tileFor(row, false, true), 0, 0);
            shown++;
        } catch (eTile) {
            // one tile that will not build must not cost the row
        }
    }
    var visible = (shown > 0);
    try {
        w.recentLabel.visible = visible;
    } catch (eLabel) {
    }
};

/** Notes a feature as just used, and repaints the Recent row. */
FeatureTrace.noteRecent = function(row) {
    try {
        CsPanel.noteRecent(FeatureTrace.RECENT_SETTING,
            FeatureTrace.keyForRow(row));
        FeatureTrace.rebuildRecent();
    } catch (e) {
        // the Recent row is a convenience; arming must not depend on it
    }
};

/** Arms the row and starts a trace. Its own function so the closure
 *  captures ONE row rather than the loop variable. */
FeatureTrace.connectRow = function(button, row) {
    button.clicked.connect(function() {
        FeatureTrace.armLayer(row.layer);
        FeatureTrace.startRun();
    });
};

/** The armed SHAPED style, or null when a plain feature is armed.
 *  Read by nothing but this file -- the shaped action takes its style
 *  from its own prototype, and startShaped sets that. */
FeatureTrace.shapedStyle = undefined;

/**
 * Arms a shaped line and starts its draw action.
 *
 * The two kinds of tile are exclusive: arming one clears the other's
 * checked mark, because exactly one thing happens when the caver drags.
 */
FeatureTrace.armShaped = function(styleKey) {
    FeatureTrace.shapedStyle = styleKey;
    FeatureTrace.target = undefined;
    FeatureTrace.noteRecent(FeatureTrace.rowForKey("style:" + styleKey));
    var w = FeatureTrace.widgets;
    if (!isNull(w)) {
        var i;
        for (i = 0; i < w.buttons.length; i++) {
            try {
                w.buttons[i].button.checked = false;
            } catch (ePlain) {
            }
        }
        for (i = 0; i < w.shapedButtons.length; i++) {
            try {
                w.shapedButtons[i].button.checked =
                    (w.shapedButtons[i].row.style === styleKey);
            } catch (eShaped) {
            }
        }
    }
    FeatureTrace.startShaped(styleKey);
};

/** Clears any armed shaped tile. Called when a plain feature is armed,
 *  so the panel never shows two things armed at once. */
FeatureTrace.clearShaped = function() {
    FeatureTrace.shapedStyle = undefined;
    var w = FeatureTrace.widgets;
    if (isNull(w) || isNull(w.shapedButtons)) {
        return;
    }
    for (var i = 0; i < w.shapedButtons.length; i++) {
        try {
            w.shapedButtons[i].button.checked = false;
        } catch (e) {
        }
    }
};

/** Arms one shaped row. Its own function for connectRow's reason. */
FeatureTrace.connectShapedRow = function(button, row) {
    button.clicked.connect(function() {
        FeatureTrace.armShaped(row.style);
    });
};

/**
 * Hands control to the SHAPED draw action, armed to one style.
 *
 * The per-style subclasses (LedgeFloorDraw and friends) exist so the
 * old toolbar could have one button per style; from here the style is
 * set on the instance instead, which is the same thing the subclass
 * did in three lines. The typed commands still reach the subclasses.
 */
FeatureTrace.startShaped = function(styleKey) {
    var di = EAction.getDocumentInterface();
    if (isNull(di)) {
        return;
    }
    // Already drawing a shaped line? Re-style the running action rather
    // than replacing it: setCurrentAction on the action that is running
    // this very click tears it down under itself, which is a SIGSEGV
    // this suite has paid for once already.
    try {
        var current = di.getCurrentAction();
        if (!isNull(current)) {
            var file = String(current.getGuiAction().getScriptFile());
            if (file.indexOf("ShapedLinesRun.js") !== -1 ||
                    file.indexOf("Draw.js") !== -1) {
                ShapedLinesRun.prototype.styleKey = styleKey;
                return;
            }
        }
    } catch (e) {
    }
    var runAction = RGuiAction.getByScriptFile(
        FeatureTrace.basePath + "/../ShapedLines/ShapedLinesRun.js");
    var action = new ShapedLinesRun(runAction);
    action.styleKey = styleKey;
    di.setCurrentAction(action);
};

/** Where this panel's collapsed sections are remembered. Its own key,
 *  the Symbol Palette's its own -- one caver may want the shaped lines
 *  shut and every symbol category open. */
FeatureTrace.COLLAPSED_SETTING = "CaveSurvey/FeatureTraceCollapsed";

/** The section titles, named once because they are BOTH the heading a
 *  caver reads and the key their collapsed state is filed under. */
FeatureTrace.SEC_FEATURES = "Draw a feature";
FeatureTrace.SEC_SHAPED = "Draw a shaped line";
FeatureTrace.SEC_HOW = "How it draws";

/** Tile icon size, in pixels. Bigger than the Symbol Palette's: a
 *  ledge tile has to show hachures ON one side of a line, which is
 *  three strokes deep before it reads at all. */
FeatureTrace.ICON = 34;

/**
 * The picture on a PLAIN feature's tile: a sample of the line that
 * feature draws, in its own layer's colour and dashedness.
 *
 * The tile is then a legend entry you can draw from -- an inferred wall
 * is dashed in the panel because it is dashed on the map -- and the
 * colour comes from CsLayers.styleOf, the one place layer appearance is
 * resolved, so a tile cannot quietly disagree with the drawing.
 */
FeatureTrace.iconForLayer = function(layerName, wide) {
    try {
        if (wide === true) {
            // a long, gently waving sample: a line read along its length
            var strip = CsTileArt.sampleCurve(40, 60, 0.05);
            return CsTileArt.iconOfClouds([strip], FeatureTrace.LIST_ICON_W,
                CsTileArt.penForLayer(layerName), FeatureTrace.LIST_ICON_H);
        }
        var curve = CsTileArt.sampleCurve(10, 20);
        return CsTileArt.iconOfClouds([curve], FeatureTrace.ICON,
            CsTileArt.penForLayer(layerName));
    } catch (e) {
        return null;
    }
};

/**
 * The picture on a SHAPED tile: a sample stroke with the style's own
 * ornament generated along it, by the same CsShapeLine.prims the
 * drawing uses.
 *
 * GENERATED, NOT DRAWN. A hand-drawn icon of a ledge is a promise about
 * what the tool does; this is the tool doing it, at tile size. Change
 * the hachure spacing tomorrow and every tile changes with it.
 */
FeatureTrace.iconForStyle = function(styleKey, wide) {
    try {
        var spec = CsShapeLine.STYLES[styleKey];
        if (isNull(spec)) {
            return null;
        }
        // The sample is as long as it needs to be to show FOUR of
        // whatever this style repeats, at the style's OWN spacing. A
        // fixed-length sample would have shown a 5 ft ceiling-ledge
        // spacing as two lonely hachures and a 2 ft rimstone as a
        // scribble; stretching the line instead of squeezing the
        // ornament keeps the tile an honest picture of the spacing.
        // A list strip shows ten repeats along a flat, open sample -- a
        // pit's ring squeezed into a strip would be a speck, and its
        // hachures read just as well along an open edge.
        var ring = spec.close === true && wide !== true;
        var feet = wide === true ? Math.max(30, spec.spacingFeet * 10) :
            Math.max(10, spec.spacingFeet * 4);
        var pts = ring ? CsTileArt.sampleRing(feet, 20) :
            CsTileArt.sampleCurve(feet, wide === true ? 60 : 20,
                wide === true ? 0.04 : undefined);
        var side = ring ? CsShapeLine.inwardSide(pts) : 1;
        // Spacing and size are the STYLE's, scaled to the sample: at
        // true cave spacing a 10 ft sample carries three hachures,
        // which is exactly what the tile should show.
        // "glyphs" reads offset/jitter from `extra` rather than the
        // size argument (see CsShapeLine.prims' own header); the seed
        // is FIXED, not CsArea.newSeed(), for the same reason
        // CsTileArt.SCATTER_SEED is fixed -- this is a picture of the
        // PATTERN, and two viewings of one tile must show the same
        // picture.
        var extra = (spec.kind === "glyphs") ? {
            offset: spec.offsetFeet || 0,
            jitterPos: spec.jitterPosFeet || 0,
            jitterRotRad: (spec.jitterRotDeg || 0) * Math.PI / 180,
            jitterScaleFrac: spec.jitterScaleFrac || 0,
            rand: CsArea.rng(424242)
        } : undefined;
        var prims = CsShapeLine.prims(pts, ring, spec,
            side, spec.spacingFeet,
            isNull(spec.sizeFeet) ? 2 : spec.sizeFeet, extra);
        // prims answers { lines, polylines, glyphs }: a line is a PAIR
        // of points, a scallop chain is one bulged polyline
        // ({points, bulges, closed}) rather than a list of arcs, and a
        // glyph is a placement {x, y, angle, scaleMul} with no
        // geometry of its own -- painted below from the actual block's
        // shapes, the same way CsTileArt.iconOfScatter paints an Area
        // Fill tile.
        var clouds = [pts.slice(0)];
        if (ring) {
            clouds[0].push(pts[0]);   // close the ring for painting
        }
        var i, j;
        for (i = 0; i < prims.lines.length; i++) {
            var seg = prims.lines[i];
            if (!isNull(seg) && seg.length >= 2) {
                clouds.push([seg[0], seg[1]]);
            }
        }
        for (i = 0; i < prims.polylines.length; i++) {
            var chain = prims.polylines[i];
            if (isNull(chain) || chain.points.length < 2) {
                continue;
            }
            // Each bulged segment sampled the way the drawing samples
            // one, so a scallop in the tile is the curve it will be on
            // the map rather than the chord across it.
            var walk = [];
            var lastIndex = chain.closed ? chain.points.length :
                chain.points.length - 1;
            for (j = 0; j < lastIndex; j++) {
                var a = chain.points[j];
                var b = chain.points[(j + 1) % chain.points.length];
                CsShapeLine.sampleBulgeSeg(a, b, chain.bulges[j],
                    spec.spacingFeet / 8, walk);
            }
            if (walk.length > 1) {
                clouds.push(walk);
            }
        }
        if (prims.glyphs.length > 0) {
            var symKey = spec.symbolDefault;
            var shapes = CsTileArt.blockShapes()[symKey];
            if (!isNull(shapes) && shapes.length > 0) {
                var raw = CsTileArt.cloudsOfShapes(shapes);
                for (i = 0; i < prims.glyphs.length; i++) {
                    var g = prims.glyphs[i];
                    var gs = (spec.sizeScale || 1) * g.scaleMul;
                    var cos = Math.cos(g.angle), sin = Math.sin(g.angle);
                    for (var c = 0; c < raw.length; c++) {
                        var cloud = [];
                        for (var p = 0; p < raw[c].length; p++) {
                            var px = raw[c][p].x * gs, py = raw[c][p].y * gs;
                            cloud.push({
                                x: g.x + px * cos - py * sin,
                                y: g.y + px * sin + py * cos
                            });
                        }
                        clouds.push(cloud);
                    }
                }
            }
        }
        return wide === true ?
            CsTileArt.iconOfClouds(clouds, FeatureTrace.LIST_ICON_W,
                CsTileArt.penForLayer(spec.decorLayer), FeatureTrace.LIST_ICON_H) :
            CsTileArt.iconOfClouds(clouds, FeatureTrace.ICON,
                CsTileArt.penForLayer(spec.decorLayer));
    } catch (e) {
        return null;
    }
};

/**
 * The shaped-line group: one tile per NSS line symbol, each showing its
 * own ornament.
 */
FeatureTrace.buildShapedGroup = function(w, parent, collapsed) {
    var section = CsPanel.section(parent, FeatureTrace.SEC_SHAPED,
        FeatureTrace.COLLAPSED_SETTING, collapsed);
    var box = section.box;
    var inner = new QGridLayout();
    var cell = 0;
    for (var i = 0; i < FeatureTrace.SHAPED_ROWS.length; i++) {
        var row = FeatureTrace.SHAPED_ROWS[i];
        try {
            var button = FeatureTrace.tileFor(row, true);
            FeatureTrace.connectTileMenu(button, row);
            inner.addWidget(button,
                Math.floor(cell / FeatureTrace.GRID_COLUMNS),
                cell % FeatureTrace.GRID_COLUMNS);
            cell++;
            w.shapedButtons.push({ button: button, row: row });
        } catch (e) {
            w.problems.push(row.style + " (" + e + ")");
        }
    }
    try {
        inner.setColumnStretch(0, 1);
    } catch (eStretch) {
    }
    section.host.setLayout(inner);
    section.grid = inner;
    section.firstRow = 0;
    return section;
};

/**
 * THE PANEL'S BODY, separated from its dock.
 *
 * Drawing a cave is ONE job -- walls, ledges, symbols, all of it put on
 * the map with the same hand -- and it lived in two docks. The Draw
 * panel puts both bodies in one, as foldable sections, so this has to
 * be buildable into somebody else's widget (Nathan, 2026-09-11).
 *
 * Sections and not tabs, because both panels already fold, remember
 * what a caver left shut, and reorder from their own right-click menus
 * -- and because tracing a passage means reaching for a wall and then a
 * symbol, which tabs would make two clicks and a decision.
 */
FeatureTrace.buildBody = function(parent) {
    var w = { problems: [], buttons: [], shapedButtons: [], sections: [] };
    var body = new QWidget(parent);
    var layout = new QVBoxLayout();
    var collapsed = CsPanel.loadCollapsed(FeatureTrace.COLLAPSED_SETTING);
    // The sections can be reordered from their own right-click menus;
    // baseIndex 2 keeps the cursor readout and the search box pinned
    // above them.
    var stack = CsPanel.stack(layout, FeatureTrace.COLLAPSED_SETTING, 2,
        function() {
            EAction.handleUserMessage(qsTr("Section order reset -- reopen " +
                "the panel to see it."));
        });
    w.stack = stack;

    // -- cursor frame readout ----------------------------------------
    try {
        w.frameLabel = new QLabel(qsTr("Cursor:  --"));
        layout.addWidget(w.frameLabel, 0, 0);
    } catch (eFrame) {
        w.problems.push("cursor frame readout (" + eFrame + ")");
    }

    // -- search --------------------------------------------------------
    //
    // The Symbol Palette has had one since it shipped, and a caver who
    // has learnt to type into one panel should not find the other one
    // has nowhere to type. Thirteen tiles is few enough to scan, so
    // this earns its place on the names rather than the count: "gour"
    // finds the rimstone dam, "shaft" finds the pit.
    try {
        w.searchEdit = new QLineEdit("");
        w.searchEdit.toolTip = qsTr("Filter the tiles by name. Common " +
            "cave words are searched too -- \"gour\" finds the rimstone " +
            "dam, \"shaft\" finds the pit.");
        try {
            w.searchEdit.placeholderText = qsTr("Search features");
        } catch (ePlace) {
        }
        w.searchEdit.textChanged.connect(function(text) {
            try {
                FeatureTrace.applyFilter();
            } catch (eFilter) {
                // never throw out of a signal handler
            }
        });
        // ENTER ARMS what the search narrowed to. This is the panel's
        // keyboard route: type three letters of the feature and press
        // Return, without the hand leaving the keyboard for the mouse
        // -- and without a key map to memorise, because the words are
        // the ones already in the box's own tooltip.
        //
        // Only when ONE tile is left. Arming the first of four matches
        // would be a coin flip dressed as a shortcut, and the caver
        // cannot see which one it picked until they have drawn with it.
        try {
            w.searchEdit.returnPressed.connect(function() {
                try {
                    FeatureTrace.armFiltered();
                } catch (eArm) {
                }
            });
        } catch (eReturn) {
            w.problems.push("search box Return (" + eReturn + ")");
        }
        layout.addWidget(w.searchEdit, 0, 0);
    } catch (eSearchBox) {
        w.problems.push("search box (" + eSearchBox + ")");
    }

    // -- what you have been using ------------------------------------
    //
    // ABOVE the sections and outside the foldable stack: a shortcut you
    // have to unfold first is not a shortcut.
    try {
        w.recentLabel = new QLabel(qsTr("Recent"));
        w.recentLabel.visible = false;
        layout.addWidget(w.recentLabel, 0, 0);
        // A column, not a row: Recent is a list of full-width strips.
        w.recentRow = new QVBoxLayout();
        try {
            w.recentRow.setContentsMargins(4, 0, 4, 2);
            w.recentRow.setSpacing(2);
        } catch (eMargins) {
        }
        layout.addLayout(w.recentRow, 0);
    } catch (eRecent) {
        w.problems.push("recent row (" + eRecent + ")");
    }

    // -- the features ------------------------------------------------
    //
    // ONE group. There were three -- Plan, Profile, Cross Section --
    // and picking the right one was the caver restating which view they
    // were already looking at. The view is read from the stroke now, so
    // the groups had nothing left to divide.
    // -- what to draw, which is why the panel is open ----------------
    try {
        var featureSection = FeatureTrace.buildGroup(w, body,
            FeatureTrace.SEC_FEATURES, null, collapsed);
        w.featureGroup = featureSection.box;
        layout.addWidget(featureSection.box, 0, 0);
        CsPanel.stackAdd(stack, featureSection, FeatureTrace.SEC_FEATURES);
        w.sections.push({ section: featureSection,
            title: FeatureTrace.SEC_FEATURES, buttons: w.buttons,
            grid: featureSection.grid, firstRow: featureSection.firstRow });
    } catch (eFeatures) {
        w.problems.push("feature group (" + eFeatures + ")");
    }

    // -- the shaped lines --------------------------------------------
    //
    // A second group rather than more tiles in the first: they are the
    // same gesture but not the same thing -- these bring ornament, and
    // they ask one more question (which side) after the drag.
    try {
        var shapedSection = FeatureTrace.buildShapedGroup(w, body, collapsed);
        w.shapedGroup = shapedSection.box;
        layout.addWidget(shapedSection.box, 0, 0);
        CsPanel.stackAdd(stack, shapedSection, FeatureTrace.SEC_SHAPED);
        w.sections.push({ section: shapedSection,
            title: FeatureTrace.SEC_SHAPED, buttons: w.shapedButtons,
            grid: shapedSection.grid, firstRow: shapedSection.firstRow });
    } catch (eShaped) {
        w.problems.push("shaped lines group (" + eShaped + ")");
    }

    // -- which elevation band a stroke belongs to --------------------
    try {
        CsPanel.applyOrder(stack);
    } catch (eOrder) {
        w.problems.push("section order (" + eOrder + ")");
    }

    // -- what the last trace cost ------------------------------------
    try {
        w.lastLabel = new QLabel(qsTr("Last: --"));
        layout.addWidget(w.lastLabel, 0, 0);
    } catch (eLast) {
        w.problems.push("last-trace readout (" + eLast + ")");
    }

    layout.addStretch(1);
    body.setLayout(layout);

    try {
        FeatureTrace.widgets = w;   // rebuildRecent reads it
        FeatureTrace.rebuildRecent();
        FeatureTrace.refreshCounts();
    } catch (eRecentFill) {
        w.problems.push("recent row fill (" + eRecentFill + ")");
    }

    if (w.problems.length > 0) {
        warning("Feature Trace: this CaveCAD build refused: " +
            w.problems.join("; ") +
            " -- those controls are inert; the rest of the panel works.");
    }

    FeatureTrace.widgets = w;
    return body;
};

// NO DOCK OF ITS OWN. The body goes into the Draw panel's "Trace"
// section and nowhere else: `widgets` below is module-level, so a
// second copy of this body would leave one of the two wired to
// nothing -- a panel that looks right and does nothing when clicked.

/** The profile region, cached.
 *
 *  Cached because the cursor readout asks per mouse move and
 *  CsTrace.profileRegion walks every entity: a per-move scan would make
 *  the whole application crawl on a real cave. Refreshed on any
 *  transaction, which is when the region can actually change. */
FeatureTrace.regionBox = null;

/** The open section bays' rectangles, cached for the same reason and on
 *  the same refresh. The readout has to know them or it reports PLAN
 *  for a cursor sitting inside a bay -- the frame whose tiles the caver
 *  is about to arm. Opening and capturing a bay are both transactions,
 *  so flush() sees every change to this list. */
FeatureTrace.bayRects = [];

/** Debounce for the panel's own rescans. See markDirty. */
FeatureTrace.dirtyTimer = null;

/** How long after the last change the panel repaints itself, in ms.
 *  Long enough to swallow a whole redraw's worth of operations, short
 *  enough that a caver never notices the delay. */
FeatureTrace.DIRTY_MS = 150;

/**
 * Note that the drawing changed, and repaint ONCE after it settles.
 *
 * The listeners used to do the work inline, and that made the panel
 * quadratic in a redraw. Measured on a 278-entity drawing:
 * CsTrace.profileRegion 5.4 ms, CsProfileDraw.runsIn 6.7 ms -- about
 * 17 ms of full-document scanning per notification. Our own redraw
 * applies DOZENS of operations (every CsLayers.withLayerOn toggle is
 * one, and the profile owns 40-odd layers once runs are segregated), and
 * each fired the listener again. Changing one shot's inclination took a
 * very long time, and on a real cave it would be unusable.
 *
 * Restarting the timer on each change is what makes it a debounce rather
 * than a throttle: a burst of eighty operations schedules one repaint,
 * 150 ms after the last of them.
 */
FeatureTrace.markDirty = function() {
    try {
        if (FeatureTrace.dirtyTimer === null) {
            var t = new QTimer();
            try {
                t.setSingleShot(true);
            } catch (eSingle) {
                // property form, or a bridge without it: the flush is
                // idempotent either way
            }
            t.timeout.connect(function() {
                try {
                    FeatureTrace.flush();
                } catch (eFlush) {
                    // a repaint must never throw into the application
                }
            });
            FeatureTrace.dirtyTimer = t;
        }
        FeatureTrace.dirtyTimer.start(FeatureTrace.DIRTY_MS);
    } catch (e) {
        // No timer in this bridge: fall back to repainting inline. Slow,
        // but a stale panel is worse than a slow one.
        FeatureTrace.flush();
    }
};

/** One repaint: the region box, the run list and the row states, each
 *  computed once. */
FeatureTrace.flush = function() {
    var doc = null;
    try {
        doc = EAction.getDocument();
    } catch (eDoc) {
        doc = null;
    }
    try {
        FeatureTrace.regionBox = isNull(doc) ? null :
            CsTrace.profileRegion(doc);
    } catch (eBox) {
        FeatureTrace.regionBox = null;
    }
    try {
        FeatureTrace.bayRects = isNull(doc) ? [] :
            CsTrace.sectionBays(doc);
    } catch (eBays) {
        FeatureTrace.bayRects = [];
    }
    FeatureTrace.refresh(doc, FeatureTrace.regionBox);
    try {
        FeatureTrace.refreshCounts();
    } catch (eCounts) {
        // a repaint must never throw into the application
    }
};

/**
 * Repaints what the panel knows about the drawing.
 *
 * Both of these are otherwise SILENT failures: an off layer refuses adds
 * with no error, so an hour of tracing lands nowhere and nothing says
 * so; and a drawing with no elevation refuses every profile row for a
 * reason no click can explain.
 */
FeatureTrace.refresh = function(docIn, regionIn) {
    var w = FeatureTrace.widgets;
    if (isNull(w)) {
        return;
    }
    // Guarded: EAction.getDocument does not exist in every engine this
    // code is loaded into (the headless test harness among them), and a
    // panel repaint must never be the thing that throws.
    var doc = docIn;
    if (isNull(doc)) {
        try {
            doc = EAction.getDocument();
        } catch (eDoc) {
            doc = null;
        }
    }

    if (!isNull(w.buttons)) {
        for (var i = 0; i < w.buttons.length; i++) {
            var entry = w.buttons[i];
            try {
                // A feature now has THREE possible destinations and the
                // stroke chooses between them, so "is the layer hidden"
                // has three answers. The tile reports the worst case:
                // hidden in ANY view is worth saying, because the view
                // it is hidden in is exactly the one the caver may be
                // about to draw in, and the point of the marker is that
                // an off layer swallows a trace in silence.
                var dests = FeatureTrace.destinationsOf(entry.row.layer);
                var hidden = [];
                for (var d = 0; d < dests.length; d++) {
                    if (!isNull(doc) && doc.hasLayer(dests[d])) {
                        // frozen counts as hidden: the trace lands and
                        // is just as invisible either way.
                        if (CsLayers.refusesEdits(
                                doc.queryLayer(dests[d]))) {
                            hidden.push(dests[d]);
                        }
                    }
                }
                var off = hidden.length > 0;
                // Re-wrapped, not re-set: a tile's label is broken over
                // lines by FeatureTrace.wrapLabel, and writing the flat
                // label back here would undo that on the first refresh.
                // "(hidden)" gets a line of its own rather than a budget
                // it would not fit in.
                entry.button.text = FeatureTrace.wrapLabel(
                    entry.row.label, FeatureTrace.CELL_CHARS) +
                    (off ? "\n(hidden)" : "");
                // REBUILT, not overwritten. This used to assign the
                // destination list straight to toolTip, which quietly
                // threw away the plain-words help CsPanel.tipHtml had
                // put there when the tile was made -- the shaped rows
                // (not in this loop) kept theirs and the plain features
                // lost theirs on the first refresh, which is a
                // difference nobody would ever spot in the source.
                var detail = off ?
                    [hidden.join(", ") + qsTr(" switched OFF -- a trace " +
                        "into that view will land but you will not see " +
                        "it")] :
                    dests;
                entry.button.toolTip = CsPanel.tipHtml(entry.row.label,
                    CsHelp.forFeature(entry.row), detail);
            } catch (e) {
                // an unreadable button is still armable; only its label
                // goes stale, and that must never stop a trace
            }
        }
    }

    try {
        if (!isNull(w.featureGroup)) {
            // THE GROUP IS NEVER DISABLED. It used to be: the Profile
            // box greyed out until the drawing had an elevation AND the
            // caver had named a run, because a profile line with no run
            // is one CsProfileBind cannot move with its band. Those same
            // tiles now draw the plan and the sections too, so locking
            // them would lock tracing itself out of a drawing that has
            // no elevation -- and the run question is answered by the
            // stroke's location, then said out loud by
            // FeatureTraceRun.warnUnclaimedProfile when location cannot
            // answer it. Information after the fact beats a locked door
            // in front of work that was never wrong.
            //
            // The region is PASSED IN, computed once per repaint by
            // flush(). Recomputing it here would double the cost of
            // every repaint, and CsTrace.profileRegion walks every
            // entity in the drawing.
            var region = (regionIn === undefined) ?
                FeatureTrace.regionBox : regionIn;
            w.featureGroup.toolTip = isNull(region) ?
                qsTr("This drawing has no elevation yet, so every trace " +
                    "lands in the plan. Generate Profile builds one.") :
                qsTr("The view you drag in decides the layer: the plan, " +
                    "a profile band's box, or an open section bay.");
        }
    } catch (e2) {
        // a stale tooltip is cosmetic; the routing does not read it
    }
};

/**
 * Keeps the run list following the DRAWING rather than the panel's own
 * toggle. Idempotent -- installed once.
 *
 * Without this the list was only rebuilt when the dock was toggled or a
 * feature armed, so a panel that was already open (restored visible by
 * the saved window state at startup) never learned the runs of a drawing
 * opened afterwards. Opening a file, redrawing the notebook and deleting
 * geometry all run transactions, so this catches every path that can
 * change which runs exist.
 *
 * Guarded on dock VISIBILITY, because CsProfileDraw.runsIn walks every
 * entity: a hidden panel must not make every transaction in the
 * application pay for a scan it will not display.
 */
FeatureTrace.installListener = function(appWin) {
    if (FeatureTrace.listener !== undefined) {
        return;
    }
    try {
        var adapter = new RTransactionListenerAdapter();
        appWin.addTransactionListener(adapter);
        adapter.transactionUpdated.connect(function(document, transaction) {
            try {
                if (!FeatureTrace.showing()) {
                    return;
                }
                FeatureTrace.markDirty();
            } catch (eInner) {
                // a listener must never throw into the application
            }
        });
        FeatureTrace.listener = adapter;

        // The cursor readout. A COORDINATE listener, not the trace
        // action's own mouse handler: that only fires while a trace is
        // already running, so the readout sat at "--" exactly when a
        // caver was deciding which row to arm.
        var coord = new RCoordinateListenerAdapter();
        appWin.addCoordinateListener(coord);
        coord.coordinateUpdated.connect(function(docIface) {
            try {
                if (!FeatureTrace.showing() || isNull(docIface)) {
                    return;
                }
                var pos = docIface.getLastPosition();
                if (isNull(pos)) {
                    return;
                }
                var over = CsTrace.frameIn(FeatureTrace.regionBox,
                    { x: pos.x, y: pos.y }, FeatureTrace.bayRects);
                // The destination LAYER as well, resolved from the view
                // under the cursor -- the readout's whole job now that
                // no button states which view a trace is bound for.
                // Cheap: no points are passed, so nothing walks the
                // drawing (CsLayers.twinFor is a string operation).
                var doc = null;
                try {
                    doc = docIface.getDocument();
                } catch (eDocOf) {
                    doc = null;
                }
                FeatureTrace.showCursorFrame(over,
                    FeatureTraceRun.targetLayer(doc, over));
            } catch (eCoord) {
                // a listener must never throw into the application
            }
        });
        FeatureTrace.coordListener = coord;

        // Layer visibility is what the "(hidden)" markers report, and it
        // does not always change through a transaction.
        var layerAdapter = new RLayerListenerAdapter();
        appWin.addLayerListener(layerAdapter);
        layerAdapter.layersUpdated.connect(function(docIface, ids) {
            try {
                if (!FeatureTrace.showing()) {
                    return;
                }
                FeatureTrace.markDirty();
            } catch (eLay) {
                // as above
            }
        });
        FeatureTrace.layerListener = layerAdapter;
    } catch (e) {
        FeatureTrace.listener = null;
        warning("Feature Trace: could not watch the drawing for survey " +
            "runs (" + e + "); the run list refreshes when the panel is " +
            "reopened or a feature is armed.");
    }
};


/** Hands control to the drag action.
 *
 *  Looks the action up by script file and passes it in, rather than
 *  constructing with null: stock Print.js does exactly this, and
 *  EAction's null-guiAction paths are not exercised anywhere. */
FeatureTrace.startRun = function() {
    var di = EAction.getDocumentInterface();
    if (isNull(di)) {
        return;
    }

    // If a trace is ALREADY the current action, just leave it running:
    // armLayer has already changed the target, and the next stroke picks
    // it up. Calling setCurrentAction again would make QCAD tear down
    // the action that is running this very click --
    // deleteTerminatedActions() frees it and the return lands in freed
    // memory. That is a hard SIGSEGV, and it is what a snap-action
    // trigger from inside the action lifecycle already cost us once.
    try {
        var current = di.getCurrentAction();
        if (!isNull(current) && current instanceof FeatureTraceRun) {
            return;
        }
    } catch (e) {
        // cannot read the current action; fall through and start one
    }

    var runAction = RGuiAction.getByScriptFile(
        FeatureTrace.basePath + "/FeatureTraceRun.js");
    di.setCurrentAction(new FeatureTraceRun(runAction));
};

FeatureTrace.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    // A SHEET IS NOT A DRAWING TO WORK IN. It is rebuilt from the
    // cave's record every time Build Sheet is pressed, so anything
    // drawn here goes with it -- silently, weeks later. See
    // Core/CsModelSpace.js.
    if (CsModelSpace.blocks(EAction.getDocument(), "Feature Trace")) {
        this.terminate();
        return;
    }

    // Opens the Draw panel with the Trace section unfolded. NOT a
    // toggle: somebody who typed "featuretrace" wants to trace, and
    // shutting the panel in their face when it was already open is
    // the one answer that cannot be what they meant.
    try {
        DrawPanel.reveal(DrawPanel.SEC_TRACE);
        try {
            FeatureTrace.flush();
        } catch (eShow) {
            // a stale panel must never stop the tool opening
        }
    } catch (e) {
        CsTell.warn("Feature Trace: this CaveCAD build refused the Draw " +
            "panel (" + e + ") -- please report this.");
    }

    this.terminate();
};

FeatureTrace.init = function(basePath) {
    FeatureTrace.basePath = basePath;

    var action = new RGuiAction(qsTr("Feature Trace"),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    // THE APPLICATION'S SCRIPT ENGINE, NOT THE TAB'S. Without this QCAD
    // runs beginEvent in the active document's OWN engine, where the dock
    // globals start empty: opening the panel from a second tab built a
    // second panel, and closing that tab left one wired to a dead engine
    // -- buttons that do nothing, and Sheet Setup's preview crashing
    // CaveCAD on hover (Nathan, 2026-09-27). Stock Print Preview uses the
    // same flag. tests/test_addon.py enforces it for every panel opener.
    action.setForceGlobal(true);
    action.setScriptFile(basePath + "/FeatureTrace.js");
    action.setIcon(basePath + "/FeatureTrace.svg");
    action.setStatusTip(qsTr("Trace cave walls and other features freehand: " +
        "drag along the sketch and a smooth line follows"));
    // "ft" belongs to the Draw panel now -- one door to the drawing
    // tools -- and the long name still reaches this one for anybody
    // who wants the tracing half on its own.
    action.setDefaultCommands(["featuretrace"]);
    action.setGroupSortOrder(452);
    action.setSortOrder(12);
    // NOT ON THE MENU. Draw is the door to the drawing tools now, and
    // two entries opening two halves of one panel is the choice this
    // consolidation exists to remove. The action stays registered --
    // its own run actions hang off it, and `featuretrace` still types.
    action.setWidgetNames([]);

    FeatureTraceRun.init(basePath);

    // The DOCK is Draw's to build (and Draw.init does it during add-on
    // init, so restoreState() can place it). This one only needs its
    // listeners, which watch for the panel becoming visible.
    try {
        FeatureTrace.installListener(RMainWindowQt.getMainWindow());
    } catch (eInit) {
        warning("Feature Trace: could not watch the drawing at startup (" +
            eInit + "); the run list refreshes when a feature is armed.");
    }
};
