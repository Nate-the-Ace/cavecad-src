// LayoutLegend.js
//
// QCAD add-on tool: put the map's legend on this layout, as a viewport onto the legend Build Legend drew.
//
// Layout menu / Cave Survey menu. Works on a layout only. See Core/CsLayoutFurniture.js
// and Core/CsLayoutPlot.js.
//
// USAGE:
//   Layout > Add Legend   (or type "addlegend")

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function LayoutLegend(guiAction) {
    EAction.call(this, guiAction);
}

LayoutLegend.prototype = new EAction();

LayoutLegend.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    CsLayoutFurniture.beginPlacing(this, qsTr("Add Legend"), qsTr("Click where the top left of the legend goes"));
};

LayoutLegend.prototype.coordinateEvent = function(event) {
    var doc = this.getDocument();
    var info = CsLayoutFurniture.layoutOrWarn(doc, qsTr("Add Legend"));
    if (!isNull(info)) {
        var p = event.getModelPosition();
        CsLayoutFurniture.addLegend(doc, this.getDocumentInterface(), info, p.x, p.y);
    }
    this.terminate();
};

LayoutLegend.init = function(basePath) {
    var action = new RGuiAction(qsTr("Add Legend"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/LayoutLegend.js");
    action.setIcon(basePath + "/LayoutLegend.svg");
    action.setStatusTip(qsTr("Put the map's legend on this layout, as a viewport onto the legend Build Legend drew"));
    action.setDefaultCommands(["addlegend", "alg"]);
    action.setGroupSortOrder(454);
    action.setSortOrder(66);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar", "LayoutMenu"]);
};
