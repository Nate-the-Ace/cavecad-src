/**
 * EntranceLocation.js
 *
 * Where the cave is: one place to see, set, move or clear the
 * drawing's entrance coordinate.
 *
 * WHY THIS EXISTS. The suite could already ASK for a location -- the
 * map picker in Core/CsLocationPick.js has been there since the aerial
 * basemap -- but it had no door. It opened only as a side effect of
 * Survey Notebook's declination Infer, or of Surface Data finding no
 * anchor and asking before it could fetch. Nothing SHOWED the
 * coordinate a drawing already carried, and nothing could change one
 * without pretending to want something else. A cave's position is a
 * property of the cave, so it gets its own entry.
 *
 * IT ALSO STORES THE DATUM ANCHOR. Setting a coordinate looks the
 * ground elevation up from USGS 3DEP and stores it as GeoElev, so the
 * drawing can relate its survey elevations to the real world (see
 * Core/CsElevation.js) without anybody having to run a whole
 * imagery-and-contours fetch for one number. The lookup is allowed to
 * fail: a location is worth storing either way, and the report says
 * which happened.
 *
 * THE COORDINATE IS NOT WRITTEN INTO THE DRAWING'S GEOMETRY. It lives
 * as XDATA on one station point, and it is stripped by sanitizing and
 * kept out of a sanitized package, along with the ground elevation.
 * See Core/CsPackage.js's GEO_TAGS.
 *
 * USAGE:
 *   Cave Survey > Entrance Location   (or type "entrance" / "el")
 */
include("scripts/EAction.js");
// simple.js defines getDocument()/getDocumentInterface(), which this
// file calls. Without it the tool works only when some OTHER tool has
// already pulled simple.js into this script context -- so it fails
// exactly when it is the first thing run after a launch. See
// ResetDrawing.js, where that cost a menu entry that did nothing.
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

function EntranceLocation(guiAction) {
    EAction.call(this, guiAction);
}

EntranceLocation.prototype = new EAction();

EntranceLocation.State = {
    PickingEntrance: 0
};

/** How far from the click to look for a contour to snap to, as a
 *  fraction of the drawing's own extent. A radius in drawing units
 *  would be right for one cave and wrong for the next. */
EntranceLocation.SNAP_FRACTION = 0.02;

EntranceLocation.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    var outcome = entranceLocationRun();
    if (outcome !== "pick") {
        this.terminate();
        return;
    }
    // The caver asked to point at the entrance on the imagery. That is
    // a click in the drawing, so this action stays alive instead of
    // finishing with its dialog.
    this.setState(EntranceLocation.State.PickingEntrance);
};

EntranceLocation.prototype.initState = function() {
    var di = this.getDocumentInterface();
    if (isNull(di)) {
        return;
    }
    this.setCrosshairCursor();
    di.setClickMode(RAction.PickCoordinate);
    // FREE SNAP. The real entrance is a low spot on a photograph, not
    // an endpoint of anything drawn -- grid or entity snapping would
    // quantise it onto something arbitrary. The contour snap below is
    // this tool's own, and it is about elevation, not geometry.
    this.setFreeSnap();
    this.setCommandPrompt(qsTr("Click the entrance on the surface -- "
        + "the cave moves to meet it"));
    this.setLeftMouseTip(qsTr("Where the entrance really is"));
    this.setRightMouseTip(EAction.trCancel);
    EAction.showSnapTools();
};

EntranceLocation.prototype.pickCoordinate = function(event, preview) {
    if (preview) {
        // Nothing to preview: the whole drawing is about to move, and
        // previewing that is a redraw of everything on every mouse
        // move.
        return;
    }
    var di = this.getDocumentInterface();
    if (isNull(di)) {
        return;
    }
    entranceLocationMoveTo(getDocument(), di, event.getModelPosition());
    this.terminate();
};

/** The stations this drawing offers to anchor to, as [{name, entity}],
 *  in survey order. A1 first where it exists, because every cave
 *  entrance is A1 by this project's convention. */
EntranceLocation.stations = function(doc) {
    var out = [];
    var stations = CsTags.collectStations(doc);
    for (var i = 0; i < stations.length; i++) {
        if (stations[i].name === "") {
            continue;
        }
        out.push({ name: stations[i].name, entity: stations[i].entity });
    }
    out.sort(function(a, b) {
        if (a.name === "A1") { return -1; }
        if (b.name === "A1") { return 1; }
        return 0;
    });
    return out;
};

/** What the drawing knows right now, as lines for the dialog. */
EntranceLocation.summary = function(doc) {
    var rec = CsLocationPick.anchorRecord(doc);
    if (rec === null) {
        return [qsTr("This drawing has no location yet.")];
    }
    var unit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);
    var lines = [];
    lines.push(qsTr("Anchored to station %1")
        .arg(rec.station !== "" ? rec.station : qsTr("(unnamed)")));
    lines.push(qsTr("Coordinate: %1, %2")
        .arg(rec.lat.toFixed(6)).arg(rec.lon.toFixed(6)));
    if (rec.elev !== null) {
        var ground = CsUnits.convert(rec.elev, CsUnits.METERS, unit);
        lines.push(qsTr("Ground here: %1 %2 (NAVD88)")
            .arg(ground.toFixed(1)).arg(unit));
    } else {
        // SAY WHAT IS MISSING AND WHAT IT COSTS. Without this number
        // nothing can relate the survey's elevations to the world, and
        // the 3D view cannot stand the cave under its own hillside.
        lines.push(qsTr("Ground here: not known yet -- set the "
            + "location again to look it up"));
    }
    return lines;
};

function entranceLocationRun() {
    var doc = getDocument();
    if (isNull(doc)) {
        CsTell.warn(qsTr("Entrance Location: no active drawing document."));
        return "done";
    }
    // A SHEET IS NOT A DRAWING TO WORK IN: it is rebuilt from the
    // cave's record every time Build Sheet is pressed.
    if (CsModelSpace.blocksWhole(doc, "Entrance Location")) {
        return "done";
    }
    var di = getDocumentInterface();

    var stations = EntranceLocation.stations(doc);
    if (stations.length === 0) {
        QMessageBox.information(getMainWindow(),
            qsTr("Entrance Location"),
            qsTr("This drawing has no survey stations to anchor to.\n\n"
               + "Import or type a survey first -- the entrance "
               + "station, A1 by convention, is what carries the "
               + "cave's location."));
        return "done";
    }

    var rec = CsLocationPick.anchorRecord(doc);
    var choice = EntranceLocation.askDialog(doc, stations, rec);
    if (choice === null) {
        return "done";
    }

    if (choice.pick === true) {
        // Handed back to beginEvent, which keeps the action alive for
        // the click. Nothing is written here.
        return "pick";
    }

    if (choice.clear === true) {
        var cleared = CsLocationPick.clearAnchor(doc, di, null);
        QMessageBox.information(getMainWindow(),
            qsTr("Entrance Location"),
            cleared === 0
                ? qsTr("There was no location to clear.")
                : qsTr("Location cleared.\n\nThe aerial photograph and "
                     + "elevation grid beside this drawing are left "
                     + "alone -- delete those files too if the point "
                     + "was the thing you needed gone."));
        return "done";
    }

    // The coordinate itself goes through the shared picker: one
    // dialog, with the browser map behind its Map... button and DMS
    // as well as decimal accepted. Written once, used by every tool
    // that needs a coordinate.
    var preset = (rec !== null)
        ? rec.lat.toFixed(6) + ", " + rec.lon.toFixed(6) : "";
    var coord = CsLocationPick.ask(qsTr("Entrance Location"), preset);
    if (coord === null) {
        return "done";               // cancelled, or unreadable
    }

    // The ground elevation, before anything is written: a failed
    // lookup must not leave the drawing half-anchored.
    var elevM = null;
    try {
        elevM = CsSurfaceData.groundElevationAt(coord.lat, coord.lon);
    } catch (eElev) {
        elevM = null;
    }

    CsLocationPick.writeAnchor(doc, di, choice.entity, coord, elevM);

    var unit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);
    var lines = [];
    lines.push(qsTr("%1 is now at %2, %3.")
        .arg(choice.name).arg(coord.lat.toFixed(6))
        .arg(coord.lon.toFixed(6)));
    if (elevM !== null) {
        lines.push(qsTr("Ground there: %1 %2 (NAVD88, USGS 3DEP).")
            .arg(CsUnits.convert(elevM, CsUnits.METERS, unit).toFixed(1))
            .arg(unit));
        lines.push(qsTr("That is this drawing's datum anchor: it is "
            + "what lets the 3D view stand the cave under its own "
            + "hillside."));
    } else {
        // WHICH failure does not matter to the caver; what matters is
        // that the location is stored and one number is not.
        lines.push(qsTr("The ground elevation could not be looked up "
            + "-- no network, or outside 3DEP's coverage (it is the "
            + "United States). The location is stored; run this again, "
            + "or Surface Data, to fill the elevation in."));
    }
    lines.push("");
    lines.push(qsTr("Nothing was drawn. The coordinate is stored on the "
        + "station, and sanitizing strips it."));

    try {
        QMessageBox.information(getMainWindow(),
            qsTr("Entrance Location"), lines.join("\n"));
    } catch (e) {
        EAction.handleUserMessage(lines[0]);
    }
    return "done";
}

/**
 * Slides the cave so its anchor station lands where the caver clicked
 * on the surface, and re-reads the coordinate and ground elevation
 * from where it now sits.
 *
 * WHY THE CAVE MOVES AND THE SURFACE DOES NOT. The photograph and the
 * contours are fixed to the world; the drawing's own origin is
 * arbitrary. A coordinate typed off a map is good to a few tens of
 * feet, and the real entrance is usually visible on the imagery once
 * it arrives -- a sink, a swallet, the foot of a bluff. Dragging the
 * cave onto it is the correction; moving the photograph would just
 * carry the error along.
 */
function entranceLocationMoveTo(doc, di, clicked) {
    if (isNull(doc) || isNull(di) || isNull(clicked)) {
        return;
    }
    var rec = CsLocationPick.anchorRecord(doc);
    if (rec === null || rec.pos === null) {
        CsTell.warn(qsTr("Entrance Location: this drawing's location has "
            + "gone. Set one before moving the cave onto it."));
        return;
    }
    var unit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);

    // SNAP TO THE LOW GROUND. An entrance is usually at the bottom of
    // something, and on a photograph that bottom is a shape you can
    // see but not a point you can click precisely. Where contours are
    // drawn, the lowest one within a short reach of the click wins, so
    // the click only has to be close.
    var box = doc.getBoundingBox(true, true);
    var reach = EntranceLocation.SNAP_FRACTION *
        Math.max(box.getWidth(), box.getHeight());
    var target = clicked;
    var snapped = null;
    try {
        snapped = CsLocationPick.lowPointNear(doc, clicked, reach);
    } catch (eSnap) {
        snapped = null;
    }
    if (snapped !== null) {
        target = new RVector(snapped.x, snapped.y);
    }

    var offset = new RVector(target.x - rec.pos.x, target.y - rec.pos.y);
    if (offset.getMagnitude() < CsLocationPick.MOVE_EPS) {
        QMessageBox.information(getMainWindow(),
            qsTr("Entrance Location"),
            qsTr("That is where the entrance already is -- nothing "
               + "moved."));
        return;
    }

    // The coordinate of the GROUND under the new position, read
    // through the frame the old coordinate was pinned in. Computed
    // BEFORE the move, because the frame is about where things sit
    // now.
    var coord = CsLocationPick.coordAtPoint(doc, target, unit);

    var moved = CsLocationPick.moveSurvey(doc, di, offset);
    if (moved === 0) {
        CsTell.warn(qsTr("Entrance Location: nothing moved. The drawing's "
            + "layers may be locked in a way this could not open."));
        return;
    }

    var lines = [];
    lines.push(qsTr("Moved %1 entities so %2 sits on the spot you "
        + "picked.").arg(moved)
        .arg(rec.station !== "" ? rec.station : qsTr("the entrance")));
    if (snapped !== null) {
        lines.push(qsTr("Snapped to the lowest contour within reach: "
            + "%1 %2.").arg(snapped.elevation.toFixed(1)).arg(unit));
    }

    if (coord === null) {
        // A drawing georeferenced before GeoDrawX/Y existed cannot say
        // what ground a drawing point covers. The cave has still moved
        // where it was asked to; only the coordinate cannot follow.
        lines.push(qsTr("The stored coordinate could NOT be updated: "
            + "this drawing was georeferenced before it recorded where "
            + "its coordinate was pinned. Set the location again to "
            + "pin it afresh."));
    } else {
        var elevM = null;
        try {
            elevM = CsSurfaceData.groundElevationAt(coord.lat, coord.lon);
        } catch (eElev) {
            elevM = null;
        }
        // The station entity has moved, so re-read it before writing:
        // writeAnchor records its position as the new pinned frame.
        var freshRec = CsLocationPick.anchorRecord(doc);
        var entity = (freshRec !== null) ? freshRec.entity : rec.entity;
        CsLocationPick.writeAnchor(doc, di, entity, coord, elevM);
        lines.push(qsTr("The entrance coordinate is now %1, %2.")
            .arg(coord.lat.toFixed(6)).arg(coord.lon.toFixed(6)));
        if (elevM !== null) {
            lines.push(qsTr("Ground there: %1 %2 (NAVD88).")
                .arg(CsUnits.convert(elevM, CsUnits.METERS,
                    unit).toFixed(1)).arg(unit));
        }
    }
    lines.push("");
    lines.push(qsTr("The aerial photograph and contours did not move: "
        + "they are fixed to the world, and the cave is what was in "
        + "the wrong place."));

    // THE SURFACE IS NOW CUT FOR THE WRONG WINDOW. Both the photograph
    // and the elevation grid were fetched around where the cave used
    // to be, so after a nudge the cave sits nearer one edge of them --
    // and the 3D terrain reads the stored fetch window, which no
    // longer matches the survey. Re-fetching is the finish of the
    // move, not a separate chore. Asked rather than assumed: it is a
    // network fetch, and a caver working offline in a field house must
    // be able to say no and keep the imagery they have.
    if (coord !== null) {
        lines.push("");
        lines.push(qsTr("Fetch the surface again for where the cave "
            + "now sits?"));
        var answer = QMessageBox.question(getMainWindow(),
            qsTr("Entrance Location"), lines.join("\n"),
            QMessageBox.Yes | QMessageBox.No);
        if (answer === QMessageBox.Yes) {
            var report = CsSurfaceData.run(doc, di,
                { imagery: true, contours: true });
            try {
                QMessageBox.information(getMainWindow(),
                    qsTr("Entrance Location"), report.lines.join("\n"));
            } catch (eReport) {
                EAction.handleUserMessage(report.lines[0]);
            }
        }
        return;
    }

    try {
        QMessageBox.information(getMainWindow(),
            qsTr("Entrance Location"), lines.join("\n"));
    } catch (e) {
        EAction.handleUserMessage(lines[0]);
    }
}

/**
 * Shows what the drawing knows and asks which station to anchor to.
 *
 * \return {entity, name} to set that station, {clear: true} to remove
 *         the location, or null when cancelled.
 */
EntranceLocation.askDialog = function(doc, stations, rec) {
    var dlg = new QDialog(getMainWindow());
    dlg.windowTitle = qsTr("Entrance Location");
    var layout = new QVBoxLayout();

    var summary = EntranceLocation.summary(doc);
    for (var s = 0; s < summary.length; s++) {
        layout.addWidget(new QLabel(summary[s]), 0, 0);
    }

    layout.addWidget(new QLabel(qsTr("\nAnchor the location to:")), 0, 0);
    // A COMBO, NOT A ROW OF BUTTONS: a combo always HAS a value and can
    // be read off the widget after exec(), rather than being
    // accumulated from click events that may never fire.
    var combo = new QComboBox();
    var current = 0;
    for (var i = 0; i < stations.length; i++) {
        combo.addItem(stations[i].name);
        if (rec !== null && rec.station === stations[i].name) {
            current = i;
        }
    }
    combo.currentIndex = current;
    layout.addWidget(combo, 0, 0);
    layout.addWidget(new QLabel(
        qsTr("The entrance is A1 by this project's convention.")), 0, 0);

    var bar = new QHBoxLayout();
    var pickBtn = new QPushButton(qsTr("Pick on Drawing..."));
    pickBtn.toolTip = qsTr("Click the real entrance on the aerial "
        + "photograph. The cave slides so its entrance station lands "
        + "there, and the coordinate is re-read from where it ends up.");
    // ONLY WITH A PINNED FRAME. Without GeoDrawX/Y nothing can say
    // what ground a drawing point covers, so the click would have
    // nothing to convert into a coordinate.
    pickBtn.enabled = (rec !== null && rec.pinX !== null &&
                       rec.pinY !== null);
    var clearBtn = new QPushButton(qsTr("Clear Location"));
    clearBtn.toolTip = qsTr("Take the cave's position off this drawing "
        + "entirely.");
    var okBtn = new QPushButton(qsTr("Set Location..."));
    var cancelBtn = new QPushButton(qsTr("Cancel"));
    try {
        okBtn["default"] = true;
    } catch (eDef) {
    }
    bar.addWidget(clearBtn, 0, 0);
    bar.addWidget(pickBtn, 0, 0);
    bar.addStretch(1);
    bar.addWidget(okBtn, 0, 0);
    bar.addWidget(cancelBtn, 0, 0);
    layout.addLayout(bar, 0);
    dlg.setLayout(layout);

    // CLOSURES, NOT SLOT NAMES: `signal.connect(dialog, "accept")`
    // throws in this build ("target is not a function").
    var answer = { value: null };
    clearBtn.clicked.connect(function() {
        answer.value = { clear: true };
        dlg.accept();
    });
    pickBtn.clicked.connect(function() {
        answer.value = { pick: true };
        dlg.accept();
    });
    okBtn.clicked.connect(function() {
        var idx = combo.currentIndex;
        if (idx >= 0 && idx < stations.length) {
            answer.value = { entity: stations[idx].entity,
                             name: stations[idx].name };
        }
        dlg.accept();
    });
    cancelBtn.clicked.connect(function() { dlg.reject(); });

    var code = dlg.exec();
    // destroy() THROWS on every QDialog in this build, parented or
    // not; close + deleteLater, and even that is guarded, because
    // tearing a dialog down must never cost the answer just given.
    try {
        dlg.close();
        dlg.deleteLater();
    } catch (eClose) {
    }
    if (code !== QDialog.Accepted) {
        return null;
    }
    return answer.value;
};

EntranceLocation.init = function(basePath) {
    var action = new RGuiAction(qsTr("Entrance Location"),
                                RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/EntranceLocation.js");
    action.setIcon(basePath + "/EntranceLocation.svg");
    action.setStatusTip(qsTr("See, set or clear where this cave is: the "
        + "entrance coordinate and the ground elevation there"));
    action.setDefaultCommands(["entrancelocation", "el"]);
    action.setGroupSortOrder(453);
    action.setSortOrder(15);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
