// LayoutScaleBar.js
//
// QCAD add-on tool: put a scale bar on this layout; it measures the viewport under it and follows its scale.
//
// Layout menu / Cave Survey menu. Draws through the same helpers Sheet Setup
// uses (Core/CsLayoutFurniture.js), so a piece placed here looks like the one
// Sheet Setup would have drawn. Works on a layout only; in the cave itself it
// says where to go instead.
//
// USAGE:
//   Layout > Add Scale Bar   (or type "scalebar")

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function LayoutScaleBar(guiAction) {
    EAction.call(this, guiAction);
}

LayoutScaleBar.prototype = new EAction();

LayoutScaleBar.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    CsLayoutFurniture.beginPlacing(this, qsTr("Add Scale Bar"), qsTr("Click where the scale bar starts (it follows the viewport's scale)"));
};

LayoutScaleBar.prototype.coordinateEvent = function(event) {
    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    var info = CsLayoutFurniture.layoutOrWarn(doc, qsTr("Add Scale Bar"));
    if (!isNull(info)) {
        var p = event.getModelPosition();
        CsLayoutFurniture.addScaleBar(doc, di, info, p.x, p.y);
    }
    this.terminate();
};

LayoutScaleBar.init = function(basePath) {
    var action = new RGuiAction(qsTr("Add Scale Bar"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/LayoutScaleBar.js");
    action.setIcon(basePath + "/LayoutScaleBar.svg");
    action.setStatusTip(qsTr("Put a scale bar on this layout; it measures the viewport under it and follows its scale"));
    action.setDefaultCommands(["scalebar", "sbar"]);
    action.setGroupSortOrder(454);
    action.setSortOrder(61);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar", "LayoutMenu"]);
};
