// ExportCaveSurvey.js
//
// QCAD add-on tool: write the drawing's survey back out as a Compass
// (.dat), Walls (.srv), Survex (.svx), Therion (.th) or CSV file.
//
// The other half of Import Cave Survey, and the missing third door on
// to writers that have existed in Core/Format since the importers did.
// The other two doors are both narrow: Package Cave Project stages all
// four formats, but only inside a whole project zip, and the Survey
// Notebook exports what is TYPED INTO THE PANEL -- its sheetSurvey is
// built from the rows, so a drawing revised since the notebook was
// last filled exports as the notebook, not as the map. Neither is
// reachable from the menu by a caver who just wants to hand one survey
// file to a colleague, or run the data through Compass's own loop
// closure.
//
// You pick a FILE NAME, not a format: the format follows the
// extension you save under, and is asked about only when the name
// carries no extension this suite knows.
//
// SOURCE: the survey in the drawing, read back out through
// CsRevise.resolveAsDrawn -- the same read path Survey Stats and the
// revision tools use. So what is exported is what the map in front of
// you actually shows, including everything typed into the Survey
// Notebook since the import. Nothing in the drawing is modified.
//
// THE ENTRANCE. survey.fixed is the #Fix / *fix control the survey was
// imported with, and on the ordinary import those coordinates ARE the
// cave's location (see CsPackage.sanitizeSurvey). Every writer except
// Compass -- Walls, Survex, Therion and CSV -- puts it back in the
// file. So a survey with control is exported
// WITHOUT it unless you say otherwise, and the report says which you
// got. A file with no fix line is still a complete survey -- the shape
// of the cave is not the secret.
//
// UNITS: written in the DRAWING's unit, and each format declares its
// own (Compass is always feet, so it is converted for you).
//
// USAGE:
//   Cave Survey > Export Cave Survey   (or type "ecs")

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

/** True when the survey carries fixed station control. */
function exportHasControl(survey) {
    if (survey === null || survey === undefined ||
            survey.fixed === null || survey.fixed === undefined) {
        return false;
    }
    for (var name in survey.fixed) {
        if (survey.fixed.hasOwnProperty(name)) {
            return true;
        }
    }
    return false;
}

/** The station names carrying control, for the report. */
function exportControlNames(survey) {
    var names = [];
    for (var name in survey.fixed) {
        if (survey.fixed.hasOwnProperty(name)) {
            names.push(name);
        }
    }
    return names;
}

function exportCaveSurvey() {
    var doc = getDocument();
    if (doc === undefined || doc === null) {
        CsTell.warn("Export Cave Survey: no active drawing document.");
        return;
    }

    // -- read the survey back out of the drawing -------------------------
    // The shared reconstruction, not a fresh chain guess: it is the one
    // reader that restores trips, splays, flags and notebook order.
    var asDrawn = CsRevise.resolveAsDrawn(doc);
    if (asDrawn === null) {
        CsTell.warn("Export Cave Survey: no tagged survey stations found.\n" +
            "Run Azimuth Traverse, Import Cave Survey or the Survey " +
            "Notebook first.");
        return;
    }
    var survey = asDrawn.survey;
    survey.distanceUnit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);

    // -- where, and therefore in what format -----------------------------
    var stem = CsPackage.safeName(survey.caveName || survey.name || "");
    if (stem === "") {
        stem = "survey";
    }
    var suggested = QDir.homePath() + "/" + stem;

    var fileName = CsFiles.saveFile(getMainWindow(),
        "Export the survey as", suggested,
        CsFormatRegistry.combinedFileFilter());
    // isNull + String: a bridge that hands back a wrapped empty QString
    // is truthy, and `!fileName` would sail past the cancel
    if (isNull(fileName) || String(fileName) === "") {
        return;
    }
    fileName = String(fileName);

    // Detection by NAME only -- there is no content yet to vote with,
    // and the extension is the caver's own statement of intent.
    var format = CsFormatRegistry.detect(fileName, "");
    if (format === null) {
        var labels = [];
        for (var i = 0; i < CsFormatRegistry.FORMATS.length; i++) {
            labels.push(CsFormatRegistry.FORMATS[i].label);
        }
        var choice = getItem("Export Cave Survey",
            "That name carries no extension I know -- which format is it?",
            labels.join("|"), 0, "|");
        if (choice === undefined) {
            return;
        }
        for (i = 0; i < CsFormatRegistry.FORMATS.length; i++) {
            if (CsFormatRegistry.FORMATS[i].label === String(choice)) {
                format = CsFormatRegistry.FORMATS[i];
            }
        }
        if (format === null || format === undefined) {
            return;
        }
        fileName += "." + format.extensions[0];
    }

    // -- the entrance question, asked only when there is one -------------
    // Compass has no fix directive at all, so its export can carry no
    // location however this is answered, and asking would be theatre.
    var control = exportHasControl(survey);
    var keepControl = false;
    if (control && format.id !== "compass") {
        var names = exportControlNames(survey);
        var answer = QMessageBox.question(getMainWindow(),
            "Export Cave Survey",
            "This survey is tied to fixed station control at " +
            names.join(", ") + ".\n\n" +
            "On an ordinary import those coordinates are the cave's " +
            "real-world position -- writing them into this file puts " +
            "the entrance location in it.\n\n" +
            "Include the fixed station coordinates?\n\n" +
            "No  = the survey without its control (safe to share)\n" +
            "Yes = the survey tied to its real-world position",
            // The four-argument form every other question in this suite
            // uses -- the five-argument one that would name a default
            // button is an overload nothing here has ever exercised, and
            // an unproven binding is not what to put between a caver and
            // their cave's location. It does not need to be proven
            // either: Qt makes No the escape button of a Yes/No box, so
            // the answer a closed or dismissed dialog gives is already
            // the safe one, which is the accident worth defending
            // against. Enter still means Yes, and that is a keystroke
            // aimed at a question this dialog states in full.
            QMessageBox.Yes | QMessageBox.No);
        keepControl = (answer === QMessageBox.Yes);
    }
    if (!keepControl) {
        survey = CsPackage.sanitizeSurvey(survey);
    }

    // -- write -----------------------------------------------------------
    var text;
    try {
        text = format.write(survey);
    } catch (e) {
        CsTell.warn("Export Cave Survey: " + format.label +
            " could not express this survey.\n" + e);
        return;
    }
    if (text === null || text === undefined || text === "") {
        CsTell.warn("Export Cave Survey: " + format.label +
            " produced nothing for this survey.");
        return;
    }
    if (writeTextFile(fileName, text) === false) {
        CsTell.warn("Export Cave Survey: could not write\n" + fileName);
        return;
    }

    // -- report in plain language ------------------------------------------
    var stations = CsModel.stationNames(survey).length;
    var legs = 0;
    var splays = 0;
    for (var s = 0; s < survey.shots.length; s++) {
        if (survey.shots[s].splay) {
            splays++;
        } else {
            legs++;
        }
    }
    CsModel.ensureTrips(survey);

    var lines = [];
    lines.push("Wrote " + CsShelf.basename(fileName));
    lines.push("");
    lines.push("Format      " + format.label);
    lines.push("Units       " + survey.distanceUnit);
    lines.push("Stations    " + stations);
    lines.push("Legs        " + legs +
        (splays > 0 ? "   (plus " + splays + " splays)" : ""));
    lines.push("Trips       " + survey.trips.length);
    if (format.id === "compass") {
        lines.push("Location    not carried -- Compass files have no fix line");
    } else if (!control) {
        lines.push("Location    none recorded in this drawing");
    } else if (keepControl) {
        lines.push("Location    INCLUDED -- this file carries the entrance");
    } else {
        lines.push("Location    left out -- no fixed station coordinates");
    }
    lines.push("");
    lines.push(fileName);

    QMessageBox.information(getMainWindow(), "Export Cave Survey",
        lines.join("\n"));
}

// ============================================================
// Add-on wiring -- the standard pattern; see docs.
// ============================================================

function ExportCaveSurvey(guiAction) {
    EAction.call(this, guiAction);
}

ExportCaveSurvey.prototype = new EAction();

ExportCaveSurvey.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    exportCaveSurvey();
    this.terminate();
};

ExportCaveSurvey.init = function(basePath) {
    var action = new RGuiAction(qsTr("Export Cave Survey"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/ExportCaveSurvey.js");
    action.setIcon(basePath + "/ExportCaveSurvey.svg");
    action.setStatusTip(qsTr("Write the drawing's survey out as a Compass, Walls, Survex, Therion or CSV file -- without the cave's location unless you ask"));
    action.setDefaultCommands(["exportcavesurvey", "ecs"]);
    action.setGroupSortOrder(451);
    action.setSortOrder(30);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
