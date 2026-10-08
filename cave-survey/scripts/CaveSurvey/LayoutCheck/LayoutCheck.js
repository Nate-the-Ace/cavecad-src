// LayoutCheck.js
//
// QCAD add-on tool: check the layout you are looking at before it goes out: images that would print, viewports that show nothing, a missing north arrow, scale bar or title block, a legend sitting in the map, text too small to read.
//
// Layout menu / Cave Survey menu. Reads only. See Core/CsLayoutCheck.js.
//
// USAGE:
//   Layout > Check Sheet   (or type "checksheet")

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function LayoutCheck(guiAction) {
    EAction.call(this, guiAction);
}

LayoutCheck.prototype = new EAction();

LayoutCheck.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    var doc = this.getDocument();
    var info = CsLayoutFurniture.layoutOrWarn(doc, qsTr("Check Sheet"));
    if (!isNull(info)) {
        QMessageBox.information(RMainWindowQt.getMainWindow(), qsTr("Check Sheet"),
            CsLayoutCheck.report(info.name, CsLayoutCheck.findings(doc, info)));
    }
    this.terminate();
};

LayoutCheck.init = function(basePath) {
    var action = new RGuiAction(qsTr("Check Sheet"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/LayoutCheck.js");
    action.setIcon(basePath + "/LayoutCheck.svg");
    action.setStatusTip(qsTr("Check this layout before it goes out: images that would print, empty viewports, a missing north arrow, scale bar or title block"));
    action.setDefaultCommands(["checksheet", "chs"]);
    action.setGroupSortOrder(454);
    action.setSortOrder(70);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar", "LayoutMenu"]);
};
