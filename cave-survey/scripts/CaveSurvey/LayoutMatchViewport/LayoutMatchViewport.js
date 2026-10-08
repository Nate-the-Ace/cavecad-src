// LayoutMatchViewport.js
//
// QCAD add-on tool: copy one viewport's scale and rotation to others: click the one to copy, then each to change.
//
// Layout menu / Cave Survey menu. Works on a layout only. See Core/CsLayoutFurniture.js.
//
// USAGE:
//   Layout > Match Viewport   (or type "matchviewport")

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function LayoutMatchViewport(guiAction) {
    EAction.call(this, guiAction);
}

LayoutMatchViewport.prototype = new EAction();

LayoutMatchViewport.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    this.source = undefined;
    if (!CsLayoutFurniture.beginPlacing(this, qsTr("Match Viewport"), qsTr("Click the viewport to copy from"))) {
        return;
    }
};

LayoutMatchViewport.prototype.coordinateEvent = function(event) {
    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    var info = CsLayoutFurniture.layoutOrWarn(doc, qsTr("Match Viewport"));
    if (isNull(info)) {
        this.terminate();
        return;
    }
    var p = event.getModelPosition();
    var vp = CsLayoutFurniture.viewportAtPoint(doc, info, p.x, p.y);
    if (isNull(vp)) {
        CsTell.warn(qsTr("Match Viewport: no viewport there."));
        return;
    }
    if (isNull(this.source)) {
        this.source = vp.getId();
        var prompt = qsTr("Click each viewport to change (Esc when done)");
        this.setCommandPrompt(prompt);
        this.setLeftMouseTip(prompt);
        return;
    }
    var src = doc.queryEntity(this.source);
    if (!isNull(src)) {
        CsLayoutFurniture.matchViewport(doc, di, src, vp);
    }
};

LayoutMatchViewport.init = function(basePath) {
    var action = new RGuiAction(qsTr("Match Viewport"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/LayoutMatchViewport.js");
    action.setIcon(basePath + "/LayoutMatchViewport.svg");
    action.setStatusTip(qsTr("Copy one viewport's scale and rotation to others: click the one to copy, then each to change"));
    action.setDefaultCommands(["matchviewport", "mvp"]);
    action.setGroupSortOrder(454);
    action.setSortOrder(69);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar", "LayoutMenu"]);
};
