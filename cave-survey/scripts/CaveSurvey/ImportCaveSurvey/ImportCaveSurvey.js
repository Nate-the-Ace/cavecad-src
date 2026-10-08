// ImportCaveSurvey.js
//
// QCAD add-on tool: import a cave survey file -- Compass (.dat),
// Walls (.srv), Survex (.svx), Therion (.th) or CSV -- and draw the
// centerline, stations and LRUD ticks. A Therion file is also how
// TopoDroid and PocketTopo hand their data over.
//
// You pick a FILE, not a format: the format is detected from the
// extension and the content, and only asked about when genuinely
// ambiguous. Everything is drawn in ONE undo step, onto the same
// CTRL- layers the NSS templates carry and Azimuth Traverse draws to,
// with every station tagged so the other tools (LRUD Walls, Survey
// Stats, the Notebook) can read the survey back out of the drawing.
//
// USAGE:
//   OPTIONAL: select a single station point (or line/arc endpoint)
//   first -- the file's first station is anchored there, which is how
//   an imported survey ties into one already in the drawing.
//   Otherwise a #Fix / *fix in the file anchors it, or (0,0).
//
//   Cave Survey > Import Cave Survey   (or type "ics")
//
// UNITS: distances are converted from the file's unit to the
// DRAWING's unit (Edit > Drawing Preferences > Units), not to a
// constant in this file. Compass is always feet; Walls and Survex
// declare theirs.
//
// The tape is treated as SLOPE distance (what all three formats
// mean): plan = d*cos(inc), rise = d*sin(inc).
//
// Scope limits per format are documented in Core/Format/*.js -- the
// short version: the everyday core of each format, not the full
// specification, and a wrong detail draws a plausible but WRONG map,
// so check a first import against a known plot.

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

function importCaveSurvey() {
    var doc = getDocument();
    // A SHEET IS NOT A DRAWING TO WORK IN. It is rebuilt from the
    // cave's record every time Build Sheet is pressed, so anything
    // drawn here goes with it -- silently, weeks later. See
    // Core/CsModelSpace.js.
    if (CsModelSpace.blocksWhole(doc, "Import Cave Survey")) {
        return;
    }
    var di = getDocumentInterface();
    if (doc === undefined || doc === null) {
        CsTell.warn("Import Cave Survey: no active drawing document.");
        return;
    }

    // -- pick the file ------------------------------------------------
    var fileName = CsFiles.openFile(getMainWindow(),
        "Select a cave survey file", "",
        CsFormatRegistry.combinedFileFilter());
    // isNull + String: a bridge that hands back a wrapped empty QString
    // is truthy, and `!fileName` would sail past the cancel
    if (isNull(fileName) || String(fileName) === "") {
        return;
    }

    var file = new QFile(fileName);
    if (!file.open(QIODevice.ReadOnly | QIODevice.Text)) {
        CsTell.warn("Import Cave Survey: could not open\n" + fileName);
        return;
    }
    var content = new QTextStream(file).readAll();
    file.close();

    // -- detect the format ---------------------------------------------
    var format = CsFormatRegistry.detect(fileName, content);
    if (format === null) {
        var labels = [];
        for (var i = 0; i < CsFormatRegistry.FORMATS.length; i++) {
            labels.push(CsFormatRegistry.FORMATS[i].label);
        }
        var choice = getItem("Import Cave Survey",
            "The format couldn't be detected -- which is it?",
            labels.join("|"), 0, "|");
        if (choice === undefined) {
            return;
        }
        for (i = 0; i < CsFormatRegistry.FORMATS.length; i++) {
            if (CsFormatRegistry.FORMATS[i].label === choice) {
                format = CsFormatRegistry.FORMATS[i];
            }
        }
    }

    // -- parse ----------------------------------------------------------
    var survey = format.parse(content, CsFormatRegistry.optionsFor(fileName));
    if (survey.shots.length === 0) {
        CsTell.warn("Import Cave Survey: no shots were parsed from this file.\n" +
            "Format tried: " + format.label);
        return;
    }

    // -- convert to the drawing's unit -----------------------------------
    var drawingUnit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);
    if (survey.distanceUnit !== drawingUnit) {
        var factor = CsUnits.convert(1.0, survey.distanceUnit, drawingUnit);
        for (i = 0; i < survey.shots.length; i++) {
            var s = survey.shots[i];
            s.distance *= factor;
            if (s.left !== null) { s.left *= factor; }
            if (s.right !== null) { s.right *= factor; }
            if (s.up !== null) { s.up *= factor; }
            if (s.down !== null) { s.down *= factor; }
        }
        for (var fname in survey.fixed) {
            if (survey.fixed.hasOwnProperty(fname)) {
                survey.fixed[fname].x *= factor;
                survey.fixed[fname].y *= factor;
                survey.fixed[fname].z *= factor;
            }
        }
        survey.distanceUnit = drawingUnit;
    }

    // -- anchor on the selection, if there is one -------------------------
    var anchor;
    var sel = CsPick.startPointFromSelection(doc, "Import Cave Survey");
    if (sel !== undefined) {
        // find the first positionable station name
        var firstName = "";
        for (i = 0; i < survey.shots.length; i++) {
            if (!survey.shots[i].excludeFromAll && !survey.shots[i].splay &&
                survey.shots[i].from !== "") {
                firstName = survey.shots[i].from;
                break;
            }
        }
        if (firstName !== "") {
            // z comes from the PICKED POINT's own Elevation tag, and
            // stays NULL when it has none (see CsPick). A hardcoded 0
            // here used to be an explicit "put this cave on the
            // drawing's origin", which beats a #Fix / *fix -- so
            // importing a file whose entrance is fixed at 1250 ft, or
            // tying an import into a station already at that height,
            // silently rebased the whole cave to sea level. Null lets
            // CsNetwork.resolve fall back to the anchored station's own
            // control elevation instead.
            anchor = { name: firstName, x: sel.pos.x, y: sel.pos.y,
                z: sel.elevation };
        }
    }

    // -- resolve, adjust and draw, one undo step -------------------------
    // A fresh import creates geometry, so it takes the CURRENT
    // settings; CsDraw.survey records what they were on the trip-0
    // anchor, and every later redraw of this drawing follows that
    // record rather than re-solving under whatever the setting is then.
    var resolved = CsAdjust.resolveAndAdjust(survey, { anchor: anchor });
    var findings = CsValidate.check(survey, resolved);

    var drawn = CsDraw.survey(survey, resolved, undefined, undefined,
        CsTags.collectStations(doc).length, { doc: doc, di: di });

    if (drawn.stationsDrawn > 0) {
        CsDraw.zoomToSurvey(survey, resolved);
    }
    // An import is the other way trips come into being, and every one
    // it brought gets its group.
    if (typeof CsLayerGroups !== "undefined") {
        CsLayerGroups.fileTripsQuietly(doc);
    }

    // -- the drawing half, if the file brought one ---------------------
    // A Therion project is numbers AND a sketch: the .th beside one or
    // more .th2 pages. Importing only the numbers left a caver who had
    // sketched the whole cave on a phone re-tracing, by hand, a
    // photograph of a drawing they already had in vector. This is the
    // same gesture, one door.
    var sketchSummary = importSiblingSketches(doc, di, fileName, drawn);

    // -- report in plain language ------------------------------------------
    var summary = "Format: " + format.label + "\n" +
        "Drawing units: " + survey.distanceUnit + "\n" +
        CsReport.drawSummary(survey, resolved, drawn, findings) +
        sketchSummary;
    if (resolved.unresolved.length > 0 ||
        CsValidate.checkHasErrors(findings)) {
        QMessageBox.warning(getMainWindow(), "Import Cave Survey", summary);
    } else {
        QMessageBox.information(getMainWindow(), "Import Cave Survey", summary);
    }
}


/**
 * Offers the .th2 sketches sitting beside the file just imported.
 *
 * ASKED, NOT ASSUMED. Importing a sketch draws real map ink on the
 * feature layers, which is a bigger thing than importing a centreline
 * and not what every caver wants on every import -- some have already
 * traced this cave by hand and want the numbers refreshed, nothing
 * more.
 *
 * Nothing is offered when the survey itself drew no stations: a scrap
 * is placed on its station markers, and with no stations in the
 * drawing every scrap would be refused one at a time.
 *
 * \return a block of text to append to the import report, or "".
 */
function importSiblingSketches(doc, di, surveyPath, drawn) {
    if (drawn === null || drawn === undefined || drawn.stationsDrawn <= 0) {
        return "";
    }
    var sketches = CsSketchStore.siblings(surveyPath);
    if (sketches.length === 0) {
        return "";
    }

    var names = [];
    for (var i = 0; i < sketches.length; i++) {
        names.push(CsSketchStore.nameOf(sketches[i]));
    }
    var asked = QMessageBox.question(getMainWindow(), "Import Cave Survey",
        (sketches.length === 1 ?
            "A Therion sketch sits beside this survey:\n\n" :
            "Therion sketches sit beside this survey:\n\n") +
        "    " + names.join("\n    ") + "\n\n" +
        "Import the drawing too? Walls, symbols and areas from the " +
        "sketch become real linework on the map's own layers, fitted " +
        "to the stations you have just drawn.",
        QMessageBox.Yes | QMessageBox.No, QMessageBox.Yes);
    if (asked !== QMessageBox.Yes) {
        return "";
    }

    // A BACKUP FIRST. Drawing a sketch in is one of this suite's
    // destructive operations the moment a scrap already present is
    // replaced -- see Core/CsBackup.js on why this is the moment.
    try {
        CsBackup.beforeWrite(doc.getFileName());
    } catch (eBackup) {
        // An unsaved drawing has no file to keep a copy of, which is
        // not a reason to refuse the import.
    }

    var totals = CsSketchDraw.newReport();
    var lines = [];
    var cancelled = false;
    for (i = 0; i < sketches.length && !cancelled; i++) {
        var result = CsSketchDraw.fromFile(doc, di, sketches[i],
            { decide: sketchDecision });
        cancelled = result.cancelled;
        lines.push(CsSketchReport.forFile(names[i], result));
        CsSketchDraw.addTo(totals, result.totals);
    }

    return "\n\n" + CsSketchReport.summary(totals, lines);
}

/**
 * Asked once per scrap this drawing already holds.
 *
 * REFUSE AND ASK, per scrap, because by the time a sketch comes round
 * again a caver has very likely worked on the ink it put here --
 * trimmed a wall, moved a symbol, traced over a gap. Overwriting that
 * silently is somebody's evening gone; importing beside it leaves two
 * of everything.
 */
function sketchDecision(scrapName, alreadyHere) {
    var answer = QMessageBox.question(getMainWindow(),
        "Import Cave Survey",
        "The sketch \"" + scrapName + "\" is already in this drawing (" +
        alreadyHere + " pieces of linework).\n\n" +
        "Replace it with the version in the file? Anything you have " +
        "changed here since importing it will go.",
        QMessageBox.Yes | QMessageBox.No | QMessageBox.Cancel,
        QMessageBox.No);
    if (answer === QMessageBox.Cancel) {
        return "cancel";
    }
    return (answer === QMessageBox.Yes) ? "replace" : "skip";
}

// ============================================================
// Add-on wiring -- the standard pattern; see docs.
// ============================================================

function ImportCaveSurvey(guiAction) {
    EAction.call(this, guiAction);
}

ImportCaveSurvey.prototype = new EAction();

ImportCaveSurvey.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    importCaveSurvey();
    this.terminate();
};

ImportCaveSurvey.init = function(basePath) {
    var action = new RGuiAction(qsTr("Import Cave Survey"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/ImportCaveSurvey.js");
    action.setIcon(basePath + "/ImportCaveSurvey.svg");
    action.setStatusTip(qsTr("Import a Compass, Walls, Survex, Therion or CSV survey file -- the format is detected for you"));
    action.setDefaultCommands(["importcavesurvey", "ics"]);
    action.setGroupSortOrder(451);
    action.setSortOrder(20);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
