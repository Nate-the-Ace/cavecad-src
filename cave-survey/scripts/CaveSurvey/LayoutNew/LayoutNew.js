// LayoutNew.js
//
// QCAD add-on tool: make a new layout from a template: built in, this cave's own, or yours.
//
// Layout menu / Cave Survey menu. The templates themselves are Core/CsLayoutTemplate.js.
//
// USAGE:
//   Layout > New Layout From Template   (or type "newlayout")

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function LayoutNew(guiAction) {
    EAction.call(this, guiAction);
}

LayoutNew.prototype = new EAction();

LayoutNew.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    CsLayoutTemplate.newLayoutDialog(this.getDocumentInterface());
    this.terminate();
};

LayoutNew.init = function(basePath) {
    var action = new RGuiAction(qsTr("New Layout From Template"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/LayoutNew.js");
    action.setIcon(basePath + "/LayoutNew.svg");
    action.setStatusTip(qsTr("Make a new layout from a template: built in, this cave's own, or yours"));
    action.setDefaultCommands(["newlayout", "nlay"]);
    action.setGroupSortOrder(454);
    action.setSortOrder(63);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar", "LayoutMenu"]);
};
