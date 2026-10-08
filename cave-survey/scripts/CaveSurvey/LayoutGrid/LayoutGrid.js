// LayoutGrid.js
//
// QCAD add-on tool: put tick marks and distance labels round the selected rectangular viewport.
//
// Layout menu / Cave Survey menu. Works on a layout only. See Core/CsLayoutFurniture.js.
//
// USAGE:
//   Layout > Add Grid   (or type "addgrid")

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function LayoutGrid(guiAction) {
    EAction.call(this, guiAction);
}

LayoutGrid.prototype = new EAction();

LayoutGrid.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    var info = CsLayoutFurniture.layoutOrWarn(doc, qsTr("Add Grid"));
    if (!isNull(info)) {
        var vp = CsLayoutFurniture.selectedViewport(doc, info);
        if (isNull(vp)) {
            CsTell.warn(qsTr("Add Grid: select one rectangular viewport first (click its edge)."));
        }
        else {
            var appWin = RMainWindowQt.getMainWindow();
            var safe = qsTr("Distance from the cave's south-west corner (recommended)");
            var real = qsTr("True map coordinates");
            var pick = QInputDialog.getItem(appWin, qsTr("Add Grid"), qsTr("Label the grid with:"), [safe, real], 0, false);
            if (!isNull(pick) && pick !== "") {
                var absolute = (pick === real);
                if (absolute) {
                    var sure = QMessageBox.question(appWin, qsTr("Add Grid"),
                        qsTr("True coordinates on a map show exactly where the cave is. Anyone who gets the plot gets the location. Print them anyway?"),
                        QMessageBox.Yes | QMessageBox.No);
                    if (sure !== QMessageBox.Yes) {
                        absolute = undefined;
                    }
                }
                if (absolute !== undefined) {
                    CsLayoutFurniture.addGrid(doc, di, info, vp, { absolute: absolute });
                }
            }
        }
    }
    this.terminate();
};

LayoutGrid.init = function(basePath) {
    var action = new RGuiAction(qsTr("Add Grid"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/LayoutGrid.js");
    action.setIcon(basePath + "/LayoutGrid.svg");
    action.setStatusTip(qsTr("Put tick marks and distance labels round the selected rectangular viewport"));
    action.setDefaultCommands(["addgrid", "grid"]);
    action.setGroupSortOrder(454);
    action.setSortOrder(73);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar", "LayoutMenu"]);
};
