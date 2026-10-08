// LayoutZoomViewport.js
//
// QCAD add-on tool: re-frame the selected viewport on its whole subject (the cave, the elevation or the legend) at a standard scale that fits.
//
// Layout menu / Cave Survey menu. Works on a layout only. See Core/CsLayoutFurniture.js.
//
// USAGE:
//   Layout > Zoom Viewport To Cave   (or type "zoomviewport")

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function LayoutZoomViewport(guiAction) {
    EAction.call(this, guiAction);
}

LayoutZoomViewport.prototype = new EAction();

LayoutZoomViewport.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    var doc = this.getDocument();
    var info = CsLayoutFurniture.layoutOrWarn(doc, qsTr("Zoom Viewport To Cave"));
    if (!isNull(info)) {
        var vp = CsLayoutFurniture.selectedViewport(doc, info);
        if (isNull(vp)) {
            CsTell.warn(qsTr("Zoom Viewport To Cave: select one viewport first (click its edge)."));
        }
        else {
            CsLayoutFurniture.zoomViewport(doc, this.getDocumentInterface(), vp);
        }
    }
    this.terminate();
};

LayoutZoomViewport.init = function(basePath) {
    var action = new RGuiAction(qsTr("Zoom Viewport To Cave"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/LayoutZoomViewport.js");
    action.setIcon(basePath + "/LayoutZoomViewport.svg");
    action.setStatusTip(qsTr("Re-frame the selected viewport on its whole subject (the cave, the elevation or the legend) at a standard scale that fits"));
    action.setDefaultCommands(["zoomviewport", "zvp"]);
    action.setGroupSortOrder(454);
    action.setSortOrder(68);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar", "LayoutMenu"]);
};
