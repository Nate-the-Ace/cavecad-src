// LayoutNorthArrow.js
//
// QCAD add-on tool: put a north arrow on this layout; it points north for the viewport under it and turns when that viewport is rotated.
//
// Layout menu / Cave Survey menu. Draws through the same helpers Sheet Setup
// uses (Core/CsLayoutFurniture.js), so a piece placed here looks like the one
// Sheet Setup would have drawn. Works on a layout only; in the cave itself it
// says where to go instead.
//
// USAGE:
//   Layout > Add North Arrow   (or type "northarrow")

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function LayoutNorthArrow(guiAction) {
    EAction.call(this, guiAction);
}

LayoutNorthArrow.prototype = new EAction();

LayoutNorthArrow.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    CsLayoutFurniture.beginPlacing(this, qsTr("Add North Arrow"), qsTr("Click where the north arrow goes (it follows the viewport's angle)"));
};

LayoutNorthArrow.prototype.coordinateEvent = function(event) {
    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    var info = CsLayoutFurniture.layoutOrWarn(doc, qsTr("Add North Arrow"));
    if (!isNull(info)) {
        var p = event.getModelPosition();
        CsLayoutFurniture.addNorth(doc, di, info, p.x, p.y);
    }
    this.terminate();
};

LayoutNorthArrow.init = function(basePath) {
    var action = new RGuiAction(qsTr("Add North Arrow"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/LayoutNorthArrow.js");
    action.setIcon(basePath + "/LayoutNorthArrow.svg");
    action.setStatusTip(qsTr("Put a north arrow on this layout; it points north for the viewport under it and turns when that viewport is rotated"));
    action.setDefaultCommands(["northarrow", "nar"]);
    action.setGroupSortOrder(454);
    action.setSortOrder(60);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar", "LayoutMenu"]);
};
