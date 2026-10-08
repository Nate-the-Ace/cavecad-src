// ScanTurn.js -- turning a one-station scan, with its scale locked.
//
// The second half of the ONE-STATION placement. A scan pinned through a
// single station has a scale it borrowed from its neighbours and a turn
// nobody measured, so it lands north-up: the page's own up is the
// drawing's up. This is where the caver says which way it really faces,
// by moving the mouse in the drawing and clicking once.
//
// WHAT IT WILL NOT DO IS RESIZE. The scale is the one number in a
// one-station placement that came from a measurement (the median of the
// scans already placed), and the turn is the one nobody has stated yet.
// Letting a mouse drag change both would quietly throw away the good
// number to set the missing one -- and there is nothing on screen to
// judge the scale against at that moment, which is exactly how a scan
// ends up eyeballed. So the drag carries ANGLE ONLY, about the anchor.
//
// The anchor station does not move, which is what makes this safe to
// leave running: whatever angle is chosen, the one point the placement
// actually knows stays exactly where it was put.
//
// NOT an add-on QCAD can find. AddOn.getAddOns only builds an add-on
// from <dir>/<dir>.js, so this file's init() is never called by QCAD --
// SketchScans.init() calls it, the same arrangement FeatureTraceRun.js
// documents.

include("scripts/EAction.js");
include("scripts/Modify/Transform.js");
include(includeBasePath + "/../Core/CsAll.js");

function ScanTurn(guiAction) {
    Transform.call(this, guiAction);

    this.center = null;         // the anchor station, in drawing units
    this.station = "";          // its name, for the prompt
    this.angle = 0;             // radians, QCAD's sense (anticlockwise)
}

ScanTurn.prototype = new Transform();

ScanTurn.State = {
    SettingAngle: 0
};

/**
 * The turn that points the scan's UP at the cursor.
 *
 * A rotation needs a reference direction, and the honest one here is
 * the state the scan is already in: it was placed with its own up
 * pointing up the drawing, so "up" is the handle the caver is dragging.
 * Cursor due north of the anchor is therefore no turn at all, and the
 * scan follows the mouse round like a compass needle -- which is what
 * makes the direction of the drag readable without a legend.
 *
 * Pure, and the whole geometry of this tool.
 *
 * \return radians anticlockwise, or 0 when the cursor is ON the anchor
 *         (no direction to read).
 */
ScanTurn.angleFor = function(center, pos) {
    if (center === null || center === undefined ||
            pos === null || pos === undefined) {
        return 0;
    }
    var dx = pos.x - center.x, dy = pos.y - center.y;
    if (Math.abs(dx) < 1.0e-9 && Math.abs(dy) < 1.0e-9) {
        return 0;
    }
    return Math.atan2(dy, dx) - Math.PI / 2;
};

/** The same angle as a compass bearing, for the readout: 0 is up the
 *  drawing, and it grows CLOCKWISE the way a caver reads a bearing. */
ScanTurn.bearingOf = function(angle) {
    var deg = -angle * 180 / Math.PI;
    deg = deg % 360;
    if (deg < 0) { deg += 360; }
    return deg;
};

ScanTurn.prototype.beginEvent = function() {
    Transform.prototype.beginEvent.call(this);

    var di = this.getDocumentInterface();
    if (isNull(di)) {
        this.terminate();
        return;
    }
    // The panel selects the scan before handing control over. Without a
    // selection there is nothing to turn, and picking one here would
    // offer to turn any old entity -- which is not what this tool is.
    if (!di.hasSelection() || this.center === null) {
        EAction.handleUserWarning(qsTr("Nothing to turn."));
        this.terminate();
        return;
    }
    this.setState(ScanTurn.State.SettingAngle);
};

ScanTurn.prototype.initState = function() {
    var di = this.getDocumentInterface();
    if (isNull(di)) {
        return;
    }
    this.setCrosshairCursor();
    di.setClickMode(RAction.PickCoordinate);
    // FREE SNAP, deliberately. Snapping the cursor to the nearest
    // station would quantise the angle to wherever the survey happens
    // to have points, and the whole question here is which way a sketch
    // faces -- an answer that is between stations more often than not.
    this.setFreeSnap();
    var where = this.station === "" ? qsTr("its station") : this.station;
    this.setCommandPrompt(qsTr("Turn the scan about %1: move the mouse " +
        "and click to set which way its UP points (Escape leaves it " +
        "north-up)").arg(where));
    this.setLeftMouseTip(qsTr("Set the turn"));
    this.setRightMouseTip(EAction.trCancel);
};

ScanTurn.prototype.setFreeSnap = function() {
    var di = this.getDocumentInterface();
    if (isNull(di) || di.isSnapLocked()) {
        return;                 // the caver locked a snap: leave it alone
    }
    try {
        var guiAction = RGuiAction.getByScriptFile(
            "scripts/Snap/SnapFree/SnapFree.js");
        if (!isNull(guiAction)) {
            guiAction.slotTrigger();
        }
        di.setSnap(new RSnapFree());
    } catch (e) {
        // no free snap here: the turn still works, it just snaps
    }
};

ScanTurn.prototype.pickCoordinate = function(event, preview) {
    var di = this.getDocumentInterface();
    if (isNull(di)) {
        return;
    }
    this.angle = ScanTurn.angleFor(this.center, event.getModelPosition());
    if (preview) {
        this.updatePreview();
        return;
    }
    var op = this.getOperation(false, true);
    if (isNull(op)) {
        this.terminate();
        return;
    }
    di.applyOperation(op);
    EAction.handleUserMessage(qsTr("Scan turned to ") +
        Math.round(ScanTurn.bearingOf(this.angle)) +
        qsTr("° (its scale is unchanged)."));
    this.terminate();
};

/** One entity, one rotation, about the anchor. `k` is stock Transform's
 *  copy index and is ignored: this tool never copies. */
ScanTurn.prototype.transform = function(entity, k, op, preview, flags) {
    if (this.center === null) {
        return;
    }
    entity.rotate(this.angle, new RVector(this.center.x, this.center.y));
    op.addObject(entity, flags);
};

ScanTurn.prototype.getOperation = function(preview, selectResult) {
    var di = this.getDocumentInterface();
    if (isNull(di) || !di.hasSelection() || this.center === null) {
        return undefined;
    }
    return Transform.prototype.getOperation.call(this, preview, selectResult);
};

/** Never a copy: this turns the scan that is already placed. */
ScanTurn.prototype.getCopies = function() {
    return 0;
};

ScanTurn.init = function(basePath) {
    // No widget names, no icon, no sort order: this action is reached
    // from the Sketch Scans panel and never from a menu. The variable is
    // deliberately not called "action" -- the structural test that reads
    // sort orders out of the folder-named file must not find a second
    // one here.
    var turnAction = new RGuiAction(qsTr("Turn Scan"),
        RMainWindowQt.getMainWindow());
    turnAction.setRequiresDocument(true);
    turnAction.setScriptFile(basePath + "/ScanTurn.js");
};
