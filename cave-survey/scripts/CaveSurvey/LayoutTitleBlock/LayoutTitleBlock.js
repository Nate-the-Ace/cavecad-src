// LayoutTitleBlock.js
//
// QCAD add-on tool: put the cave's title block on this layout, filled in from the survey and what the drawing already says.
//
// Layout menu / Cave Survey menu. Draws through the same helpers Sheet Setup
// uses (Core/CsLayoutFurniture.js), so a piece placed here looks like the one
// Sheet Setup would have drawn. Works on a layout only; in the cave itself it
// says where to go instead.
//
// USAGE:
//   Layout > Add Title Block   (or type "titleblock")

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function LayoutTitleBlock(guiAction) {
    EAction.call(this, guiAction);
}

LayoutTitleBlock.prototype = new EAction();

LayoutTitleBlock.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    CsLayoutFurniture.beginPlacing(this, qsTr("Add Title Block"), qsTr("Click the lower left corner of the title block"));
};

LayoutTitleBlock.prototype.coordinateEvent = function(event) {
    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    var info = CsLayoutFurniture.layoutOrWarn(doc, qsTr("Add Title Block"));
    if (!isNull(info)) {
        var p = event.getModelPosition();
        CsLayoutFurniture.addTitle(doc, di, info, p.x, p.y);
    }
    this.terminate();
};

LayoutTitleBlock.init = function(basePath) {
    var action = new RGuiAction(qsTr("Add Title Block"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/LayoutTitleBlock.js");
    action.setIcon(basePath + "/LayoutTitleBlock.svg");
    action.setStatusTip(qsTr("Put the cave's title block on this layout, filled in from the survey and what the drawing already says"));
    action.setDefaultCommands(["titleblock", "tblock"]);
    action.setGroupSortOrder(454);
    action.setSortOrder(62);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar", "LayoutMenu"]);
};
