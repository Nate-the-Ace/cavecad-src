// LayoutGrid.js
//
// QCAD add-on tool: put tick marks and distance labels round a rectangular viewport you click.
//
// Layout menu / Cave Survey menu. Works on a layout only. See Core/CsLayoutFurniture.js.
//
// USAGE:
//   Layout > Add Grid   (or type "addgrid"), then click each viewport to put a grid on; Esc when done.

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function LayoutGrid(guiAction) {
    EAction.call(this, guiAction);
}

LayoutGrid.prototype = new EAction();

LayoutGrid.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    this.absolute = undefined;       // asked once, at the first viewport, then kept for the rest of this run
    CsLayoutFurniture.beginPlacing(this, qsTr("Add Grid"), qsTr("Click the viewport to put the grid on (Esc when done)"));
};

LayoutGrid.prototype.coordinateEvent = function(event) {
    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    var info = CsLayoutFurniture.layoutOrWarn(doc, qsTr("Add Grid"));
    if (isNull(info)) {
        this.terminate();
        return;
    }
    var p = event.getModelPosition();
    var vp = CsLayoutFurniture.viewportAtPoint(doc, info, p.x, p.y);
    if (isNull(vp)) {
        CsTell.warn(qsTr("Add Grid: there is no viewport there. Click inside the viewport you want the grid on."));
        return;
    }
    if (this.absolute === undefined) {
        this.absolute = CsLayoutFurniture.askGridLabels();
        if (this.absolute === undefined) {
            this.terminate();
            return;
        }
    }
    CsLayoutFurniture.addGrid(doc, di, info, vp, { absolute: this.absolute });
    // stays ready for another viewport; Esc ends it
};

LayoutGrid.init = function(basePath) {
    var action = new RGuiAction(qsTr("Add Grid"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/LayoutGrid.js");
    action.setIcon(basePath + "/LayoutGrid.svg");
    action.setStatusTip(qsTr("Put tick marks and distance labels round a viewport: click each viewport to grid, Esc when done"));
    action.setDefaultCommands(["addgrid", "grid"]);
    action.setGroupSortOrder(454);
    action.setSortOrder(73);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar", "LayoutMenu"]);
};
