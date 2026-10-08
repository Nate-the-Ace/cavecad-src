// SurveyStats.js
//
// QCAD add-on tool: the numbers the title block wants, and the honest
// survey grade -- computed from the drawing's tagged survey data, not
// asserted.
//
// Reports: surveyed length (tape) and plan length, vertical extent,
// station/shot/loop counts, worst loop closure, and the defensible
// BCRA/UIS grade with its reasoning. The data can prove a grade DOWN
// (bad closure) but only support one UP, and the report says which.
//
// Offers to write length, depth and grade into the title block's
// length / depth / survey code lines, one undo step. Those lines are
// ordinary text you can edit or delete; a deleted one is simply not
// written (see Core/CsSheet.js).
//
// USAGE:
//   Cave Survey > Survey Stats   (or type "sst")

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

function surveyStatsRun() {
    var doc = getDocument();
    if (doc === undefined || doc === null) {
        CsTell.warn("Survey Stats: no active drawing document.");
        return;
    }

    // CsRevise.resolveAsDrawn: the exact reconstruction, resolved in
    // the drawing's own frame under its recorded adjustment -- the one
    // read path every reporting tool shares. The chain-guess reader
    // this used to run fabricated a leg across every branch boundary
    // (inflating the length) and could never produce a closure, so a
    // real loop (Truitt's F survey, 2026-08-27) counted as zero.
    var asDrawn = CsRevise.resolveAsDrawn(doc);
    if (asDrawn === null) {
        CsTell.warn("Survey Stats: no tagged survey stations found.\n" +
            "Run Azimuth Traverse, Import Cave Survey or the Survey " +
            "Notebook first.");
        return;
    }
    var survey = asDrawn.survey;
    survey.distanceUnit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);

    // Resolve-and-adjust, like every other tool -- and under THIS
    // DRAWING's recorded options, not today's global setting. Depth is
    // measured over the resolved station elevations, so a drawing
    // adjusted yesterday and read with the switch off today would
    // stamp a depth into the title block that disagrees with the map
    // printed beside it. This tool reports on existing geometry, so it
    // follows the drawing's record; the tools that CREATE geometry take
    // the current settings and CsDraw.survey records what they used.
    //
    // Loop closures -- and the BCRA grade CsGrade derives from them --
    // stay AS-SURVEYED either way: CsAdjust copies them through
    // untouched, which is its honesty rule and the reason this line is
    // safe to change at all.
    var resolved = asDrawn.resolved;
    var stats = CsStats.compute(survey, resolved, CsTraverse.SLOPE);
    var grade = CsGrade.compute(survey, resolved, stats);

    var summary = CsReport.statsSummary(survey, stats, grade);

    // ---- offer to stamp the title block ----------------------------
    // Any of the three lines present -- as tagged title block text, or
    // as a TB_* block in a drawing from the older template.
    var canStamp = false;
    var stampable = ["length", "depth", "surveyCode"];
    for (var s = 0; s < stampable.length; s++) {
        if (CsSheet.fieldEntities(doc, CsSheet.fieldById(stampable[s])).length > 0) {
            canStamp = true;
            break;
        }
    }

    if (!canStamp) {
        QMessageBox.information(getMainWindow(), "Survey Stats", summary);
        return;
    }

    var answer = QMessageBox.question(getMainWindow(), "Survey Stats",
        summary + "\n\nWrite length, depth and grade into the title block?",
        QMessageBox.Yes | QMessageBox.No);
    if (answer !== QMessageBox.Yes) {
        return;
    }

    var op = new RModifyObjectsOperation();
    op.setText("Survey stats into title block");
    var wrote = [];
    var tryWrite = function(fieldId, value) {
        var field = CsSheet.fieldById(fieldId);
        if (CsSheet.writeField(doc, op, field, value)) {
            wrote.push(field.label);
        }
    };
    tryWrite("length", CsReport.length(stats.surveyedLength, survey.distanceUnit));
    tryWrite("depth", CsReport.length(stats.depth, survey.distanceUnit));
    tryWrite("surveyCode", grade.uis);
    getDocumentInterface().applyOperation(op);

    EAction.handleUserMessage("Survey Stats: updated " + wrote.join(", ") +
        " in the title block (one undo step).");
}

// ============================================================
// Add-on wiring -- the standard pattern; see docs.
// ============================================================

function SurveyStats(guiAction) {
    EAction.call(this, guiAction);
}

SurveyStats.prototype = new EAction();

SurveyStats.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    surveyStatsRun();
    this.terminate();
};

SurveyStats.init = function(basePath) {
    var action = new RGuiAction(qsTr("Survey Stats"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/SurveyStats.js");
    action.setIcon(basePath + "/SurveyStats.svg");
    action.setStatusTip(qsTr("Length, depth, loop closures and the honest survey grade, computed from the drawing"));
    action.setDefaultCommands(["surveystats", "sst"]);
    action.setGroupSortOrder(454);
    action.setSortOrder(10);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
