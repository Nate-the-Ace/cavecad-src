// LayoutPlot.js
//
// QCAD add-on tool: plot this layout, or all of them, to a PDF -- checking first that no image would print.
//
// Layout menu / Cave Survey menu. Works on a layout only. See Core/CsLayoutFurniture.js
// and Core/CsLayoutPlot.js.
//
// USAGE:
//   Layout > Plot Layout   (or type "plotlayout")

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function LayoutPlot(guiAction) {
    EAction.call(this, guiAction);
}

LayoutPlot.prototype = new EAction();

LayoutPlot.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    var di = this.getDocumentInterface();
    var pick = QInputDialog.getItem(RMainWindowQt.getMainWindow(), qsTr("Plot Layout"), qsTr("Plot:"),
        [qsTr("This layout"), qsTr("All layouts, one PDF")], 0, false);
    if (!isNull(pick) && pick !== "") {
        CsLayoutPlot.run(di, pick === qsTr("This layout") ? "this" : "all");
    }
    this.terminate();
};

LayoutPlot.init = function(basePath) {
    var action = new RGuiAction(qsTr("Plot Layout"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/LayoutPlot.js");
    action.setIcon(basePath + "/LayoutPlot.svg");
    action.setStatusTip(qsTr("Plot this layout, or all of them, to a PDF -- checking first that no image would print"));
    action.setDefaultCommands(["plotlayout", "plot"]);
    action.setGroupSortOrder(454);
    action.setSortOrder(67);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar", "LayoutMenu"]);
};
