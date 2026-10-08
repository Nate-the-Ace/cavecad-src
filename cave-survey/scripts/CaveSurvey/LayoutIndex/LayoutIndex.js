// LayoutIndex.js
//
// QCAD add-on tool: put a sheet index on this layout: every layout, its paper and its scale.
//
// Layout menu / Cave Survey menu. Works on a layout only. See Core/CsLayoutFurniture.js.
//
// USAGE:
//   Layout > Add Sheet Index   (or type "sheetindex")

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function LayoutIndex(guiAction) {
    EAction.call(this, guiAction);
}

LayoutIndex.prototype = new EAction();

LayoutIndex.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    CsLayoutFurniture.beginPlacing(this, qsTr("Add Sheet Index"), qsTr("Click where the top left of the index goes"));
};

LayoutIndex.prototype.coordinateEvent = function(event) {
    var doc = this.getDocument();
    var info = CsLayoutFurniture.layoutOrWarn(doc, qsTr("Add Sheet Index"));
    if (!isNull(info)) {
        var p = event.getModelPosition();
        CsLayoutFurniture.addIndex(doc, this.getDocumentInterface(), info, p.x, p.y);
    }
    this.terminate();
};

LayoutIndex.init = function(basePath) {
    var action = new RGuiAction(qsTr("Add Sheet Index"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/LayoutIndex.js");
    action.setIcon(basePath + "/LayoutIndex.svg");
    action.setStatusTip(qsTr("Put a sheet index on this layout: every layout, its paper and its scale"));
    action.setDefaultCommands(["sheetindex", "sidx"]);
    action.setGroupSortOrder(454);
    action.setSortOrder(72);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar", "LayoutMenu"]);
};
