// LayoutBorder.js
//
// QCAD add-on tool: put a border round this layout, inside the paper's edge.
//
// Layout menu / Cave Survey menu. Works on a layout only. See Core/CsLayoutFurniture.js
// and Core/CsLayoutPlot.js.
//
// USAGE:
//   Layout > Add Border   (or type "addborder")

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function LayoutBorder(guiAction) {
    EAction.call(this, guiAction);
}

LayoutBorder.prototype = new EAction();

LayoutBorder.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    CsLayoutFurniture.addBorderTool(this.getDocumentInterface());
    this.terminate();
};

LayoutBorder.init = function(basePath) {
    var action = new RGuiAction(qsTr("Add Border"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/LayoutBorder.js");
    action.setIcon(basePath + "/LayoutBorder.svg");
    action.setStatusTip(qsTr("Put a border round this layout, inside the paper's edge"));
    action.setDefaultCommands(["addborder", "abrd"]);
    action.setGroupSortOrder(454);
    action.setSortOrder(65);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar", "LayoutMenu"]);
};
