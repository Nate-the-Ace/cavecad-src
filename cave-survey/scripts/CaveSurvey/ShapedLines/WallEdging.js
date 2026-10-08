// WallEdging.js -- Wall Edging: stone glyphs outside every surveyed
// wall, on a switch.
//
// "Can the stone glyphs just automatically appear near but outside the
// cave walls automatically? Running the tool could turn them on or off."
// (Nathan, 2026-09-12)
//
// NOT A SECOND ENGINE. The glyphs, their spacing, their seeded jitter,
// their regeneration when a wall moves and the flip that moves them to
// the other side are all the "glyphs" shaped-line style, shipped in
// 0.9.119.0. This file decides only WHICH walls are dressed and hands
// CsShapeLine the per-station side test; everything else is machinery
// that already existed.
//
// WHICH SIDE IS OUTSIDE is answered from the survey: the direction from
// a point on a wall to the nearest station is the direction of the
// cave, so outside is the other way. See CsShapeLine.autoSides for the
// three cases, including the one worth knowing about -- a wall with
// passage on BOTH faces (a fin, a pillar) has no outside and is left
// bare rather than having stone drawn into the passage next door.
//
// PLAN AND ELEVATION WALLS. It was plan only, on the grounds that
// "CsDraw and CsRebuild are the only writers of the Station tag and
// both draw the plan, so a profile band holds no station geometry to
// reason against". That stopped being true when the elevation became a
// region of the plan drawing: CsProfileDraw tags every station it
// draws with ProfileStation, so the same evidence has been sitting
// there unused. It matters most in exactly the cave this was worst
// for -- on a pit map the elevation is the PRIMARY view, so plan-only
// meant the main drawing of a vertical cave had no rock outside its
// walls at all.
//
// SECTION BAYS STAY HAND-DRESSED, and that one IS a fact about the
// drawing: a bay is one station's worth of cave seen end-on, so there
// is no station cloud to reason against and no outside that geometry
// can find. Decorate Selection knows the side there because a caver
// said so.

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

function WallEdging(guiAction) {
    EAction.call(this, guiAction);
}

WallEdging.prototype = new EAction();

/** The style every auto-edged wall is dressed in. */
WallEdging.STYLE = "glyphs";

/** The tag on the marker entity that says the switch is on. */
WallEdging.FLAG = "ShapeWallEdge";

/**
 * The drawing's own switch.
 *
 * ONE HIDDEN MARKER POINT on CTRL-SHAPE-SPINE, not a setting. Wall
 * edging is a decision about THIS MAP -- two caves in one session may
 * differ, and a caver who sends a drawing to a co-surveyor should send
 * its edging with it. A marker rides the file; RSettings does not.
 * It persists as XDATA like every other CsTags write, so save and
 * reopen need no new plumbing.
 */
WallEdging.markerOf = function(doc) {
    var ids;
    try {
        ids = doc.queryAllEntities(false, true);
    } catch (eAll) {
        return null;
    }
    for (var i = 0; i < ids.length; i++) {
        // PER ENTITY, not per scan: this walks everything in the
        // drawing, and one entity whose tags this build refuses to read
        // must not cost the answer for all the others. (A block
        // reference added moments earlier by the switch itself was
        // exactly that entity, 2026-09-12.)
        try {
            var e = doc.queryEntity(ids[i]);
            if (isNull(e)) {
                continue;
            }
            if (CsTags.get(e, WallEdging.FLAG) !== "") {
                return e;
            }
        } catch (eOne) {
        }
    }
    return null;
};

/** Is wall edging on for this drawing? */
WallEdging.isOn = function(doc) {
    var m = WallEdging.markerOf(doc);
    return !isNull(m) && CsTags.get(m, WallEdging.FLAG) === "1";
};

/** Writes the switch, creating the marker the first time. */
WallEdging.setFlag = function(doc, di, on, group) {
    var grouped = function(op) {
        if (group !== null && group !== undefined && group >= 0) {
            op.setTransactionGroup(group);
        }
        di.applyOperation(op);
    };
    var marker = WallEdging.markerOf(doc);
    if (isNull(marker)) {
        CsLayers.ensure(doc, di, CsLayers.CTRL_SHAPE_SPINE);
        // THROUGH withLayerOn, or the marker never lands: this build
        // refuses an add to a layer that is off or frozen and says
        // nothing about it, and CTRL-SHAPE-SPINE is scaffolding that
        // ships hidden. The switch would then read "off" straight after
        // being turned on, with no error anywhere (2026-09-12).
        var made = false;
        CsLayers.withLayerOn(doc, di, CsLayers.CTRL_SHAPE_SPINE,
            function() {
                var pt = new RPointEntity(doc,
                    new RPointData(new RVector(0, 0)));
                pt.setLayerId(doc.getLayerId(CsLayers.CTRL_SHAPE_SPINE));
                CsTags.set(pt, WallEdging.FLAG, on ? "1" : "0");
                var add = new RAddObjectsOperation();
                add.addObject(pt, false);
                grouped(add);
                made = true;
            });
        return made;
    }
    var fresh = doc.queryEntity(marker.getId());
    if (isNull(fresh)) {
        return false;
    }
    // and the same for CHANGING it: a modify on a hidden layer is
    // refused as silently as an add, which reads as a switch that will
    // not turn off.
    var wrote = false;
    CsLayers.withLayerOn(doc, di, CsLayers.CTRL_SHAPE_SPINE, function() {
        var again = doc.queryEntity(marker.getId());
        if (isNull(again)) {
            return;
        }
        CsTags.set(again, WallEdging.FLAG, on ? "1" : "0");
        var mod = new RModifyObjectsOperation();
        mod.addObject(again, false);
        grouped(mod);
        wrote = true;
    });
    return wrote;
};

/** Every plan wall the switch is allowed to dress. WALLS-INFERRED is
 *  deliberately not among them: those are the dashed, unmeasured
 *  stretches, and edging them would claim more about the rock than the
 *  survey earned. */
/** The layer an entity sits on, by name; "" when it cannot be read. */
WallEdging.layerNameOf = function(doc, entity) {
    try {
        var layer = doc.queryLayer(entity.getLayerId());
        if (isNull(layer)) {
            return "";
        }
        return String(layer.getName());
    } catch (e) {
        return "";
    }
};

WallEdging.WALL_LAYERS = function() {
    // The elevation's own surveyed-wall layer alongside the plan's.
    // Not the CTRL- wall runs of either frame: those are the
    // generator's scaffolding, they are redrawn from the survey on
    // every draw, and dressing them would mean the stone vanished
    // every time the cave was redrawn.
    return [CsLayers.WALLS_SURVEYED, CsLayers.PROFILE_WALLS_SURVEYED];
};

WallEdging.eligibleWalls = function(doc) {
    var out = [];
    var layers = WallEdging.WALL_LAYERS();
    for (var L = 0; L < layers.length; L++) {
        var layerId = doc.getLayerId(layers[L]);
        if (layerId === RObject.INVALID_ID) {
            continue;
        }
        var ids = doc.queryLayerEntities(layerId, true);
        for (var i = 0; i < ids.length; i++) {
            var e = doc.queryEntity(ids[i]);
            if (isNull(e) || !CsShapeLine.isSupported(e)) {
                continue;
            }
            out.push(e);
        }
    }
    return out;
};

/** The walls this switch dressed -- and only those. A wall a caver
 *  dressed by hand, or took over afterwards, is not in here. */
WallEdging.autoEdgedWalls = function(doc) {
    var out = [];
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (!isNull(e) && CsShapeLine.isAuto(e)) {
            out.push(e);
        }
    }
    return out;
};

/**
 * Dresses one wall as an auto-edged glyph line.
 *
 * A wall that already carries a shaped-line style is LEFT ALONE: it is
 * either already edged, or it is a caver's own ledge or flowstone line
 * and the switch has no business overwriting it.
 *
 * \return true when this call dressed it.
 */
WallEdging.dressOne = function(doc, di, wall, group, cache) {
    if (CsTags.get(wall, CsShapeLine.KEY.STYLE) !== "") {
        return false;
    }
    var fresh = doc.queryEntity(wall.getId());
    if (isNull(fresh)) {
        return false;
    }
    CsTags.set(fresh, CsShapeLine.KEY.STYLE, WallEdging.STYLE);
    CsTags.set(fresh, CsShapeLine.KEY.ID, CsUuid.v4());
    CsTags.set(fresh, CsShapeLine.KEY.AUTO, "1");
    // THE FRAME, FROM THE LAYER THE WALL IS ON.
    //
    // ShapeFrame is written when a caver DRAWS a shaped line, and a
    // traced wall is not one -- it is ordinary linework this switch is
    // taking over. Without this the tag is absent, frameOfSpine
    // defaults to "plan", and an elevation wall would be measured
    // against the PLAN's station cloud: a cloud in a different part of
    // the drawing entirely, so every glyph on it would take whichever
    // side the plan happened to be on. Silent, and wrong in a way that
    // looks like a rendering bug rather than a frame mix-up.
    CsTags.set(fresh, CsShapeLine.KEY.FRAME,
        CsLayers.frameOf(WallEdging.layerNameOf(doc, fresh)));
    var mod = new RModifyObjectsOperation();
    mod.addObject(fresh, false);
    if (group !== null && group !== undefined && group >= 0) {
        mod.setTransactionGroup(group);
    }
    di.applyOperation(mod);

    var again = doc.queryEntity(wall.getId());
    if (isNull(again)) {
        return false;
    }
    return CsShapeLine.decorate(doc, di, again, group, cache) === "decorated";
};

/**
 * Turns the switch on or off and brings the drawing into line with it.
 *
 * NOT NAMED `apply`. WallEdging is a constructor function, so
 * `WallEdging.apply` is Function.prototype.apply -- and in this engine
 * that property refuses assignment SILENTLY, so the name kept working
 * and quietly called the built-in instead: the switch did nothing and
 * returned undefined, with no error anywhere (measured 2026-09-12).
 * Every EAction tool in this suite is a constructor, so `apply`,
 * `call` and `bind` are all names to stay away from.
 *
 * \return {on, dressed, removed}
 */
WallEdging.applySwitch = function(doc, di, on, group) {
    var cache = {};
    var dressed = 0, removed = 0;
    var i;
    if (on) {
        var walls = WallEdging.eligibleWalls(doc);
        for (i = 0; i < walls.length; i++) {
            if (WallEdging.dressOne(doc, di, walls[i], group, cache)) {
                dressed++;
            }
        }
    } else {
        var edged = WallEdging.autoEdgedWalls(doc);
        for (i = 0; i < edged.length; i++) {
            if (CsShapeLine.undress(doc, di, edged[i], group)) {
                removed++;
            }
        }
    }
    WallEdging.setFlag(doc, di, on, group);
    return { on: on, dressed: dressed, removed: removed };
};

WallEdging.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    if (isNull(doc) || isNull(di)) {
        this.terminate();
        return;
    }
    if (CsModelSpace.blocks(doc, "Wall Edging")) {
        this.terminate();
        return;
    }

    var turningOn = !WallEdging.isOn(doc);
    var group = doc.getTransactionGroup() + 1;
    var result = WallEdging.applySwitch(doc, di, turningOn, group);

    if (turningOn) {
        if (result.dressed === 0) {
            EAction.handleUserWarning(qsTr("Wall Edging is on, but no " +
                "surveyed wall was dressed -- either none is drawn yet, " +
                "or they already carry a shaped line of their own."));
        } else {
            EAction.handleUserMessage(qsTr("Wall Edging ON: %1 wall(s) " +
                "edged with stone glyphs.").arg(result.dressed));
        }
    } else {
        EAction.handleUserMessage(qsTr("Wall Edging OFF: %1 wall(s) " +
            "cleared.").arg(result.removed));
    }

    this.terminate();
};

WallEdging.init = function(basePath) {
    var action = new RGuiAction(qsTr("Toggle Wall Edging"),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/WallEdging.js");
    action.setIcon(basePath + "/WallEdging.svg");
    action.setStatusTip(qsTr("Draw stone glyphs outside every surveyed " +
        "wall, or take them away again"));
    action.setDefaultCommands(["walledging", "wed"]);
    action.setGroupSortOrder(452);
    action.setSortOrder(36);
    action.setWidgetNames(["CaveSurveyMenu"]);
};
