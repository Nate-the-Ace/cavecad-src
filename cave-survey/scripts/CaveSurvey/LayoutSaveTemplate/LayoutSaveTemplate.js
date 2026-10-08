// LayoutSaveTemplate.js
//
// QCAD add-on tool: save the layout you are looking at as a template, for this cave or for yourself.
//
// Layout menu / Cave Survey menu. The templates themselves are Core/CsLayoutTemplate.js.
//
// USAGE:
//   Layout > Save Layout As Template   (or type "savelayout")

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function LayoutSaveTemplate(guiAction) {
    EAction.call(this, guiAction);
}

LayoutSaveTemplate.prototype = new EAction();

LayoutSaveTemplate.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    CsLayoutTemplate.saveDialog(this.getDocumentInterface());
    this.terminate();
};

LayoutSaveTemplate.init = function(basePath) {
    var action = new RGuiAction(qsTr("Save Layout As Template"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/LayoutSaveTemplate.js");
    action.setIcon(basePath + "/LayoutSaveTemplate.svg");
    action.setStatusTip(qsTr("Save the layout you are looking at as a template, for this cave or for yourself"));
    action.setDefaultCommands(["savelayout", "slay"]);
    action.setGroupSortOrder(454);
    action.setSortOrder(64);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar", "LayoutMenu"]);
};
