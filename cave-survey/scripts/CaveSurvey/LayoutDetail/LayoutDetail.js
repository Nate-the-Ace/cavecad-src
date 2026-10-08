// LayoutDetail.js
//
// QCAD add-on tool: add a detail view to a layout: a magnified circle of the map, marked on the map with a lettered circle and a leader.
//
// Layout menu / Cave Survey menu. Works on a layout only. See addDetail in Core/CsLayoutFurniture.js, which does the work.
//
// USAGE:
//   Layout > Add Detail   (or type "detail")
// Click the centre of the area on a map viewport, then a point on its edge, then where the detail goes.

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function LayoutDetail(guiAction) {
    EAction.call(this, guiAction);
    this.step = 0;
}

LayoutDetail.prototype = new EAction();

LayoutDetail.MAGNIFICATIONS = [2, 3, 4, 5, 8];

LayoutDetail.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    this.step = 0;
    var labels = LayoutDetail.MAGNIFICATIONS.map(function(m) { return m + "x"; });
    var pick = QInputDialog.getItem(RMainWindowQt.getMainWindow(), qsTr("Add Detail"), qsTr("Magnify the detail:"), labels, 1, false);
    if (isNull(pick) || pick === "") {
        this.terminate();
        return;
    }
    this.mag = parseFloat(String(pick));
    CsLayoutFurniture.beginPlacing(this, qsTr("Add Detail"), qsTr("Click the centre of the area to magnify"));
};

LayoutDetail.prototype.coordinateEvent = function(event) {
    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    var info = CsLayoutFurniture.layoutOrWarn(doc, qsTr("Add Detail"));
    if (isNull(info)) {
        this.terminate();
        return;
    }
    var p = event.getModelPosition();
    if (this.step === 0) {
        var parent = CsLayoutFurniture.viewportAtPoint(doc, info, p.x, p.y);
        if (isNull(parent)) {
            CsTell.warn(qsTr("Add Detail: click on a map viewport."));
            return;
        }
        this.parent = parent.getId();
        this.from = { x: p.x, y: p.y };
        this.step = 1;
        this.setCommandPrompt(qsTr("Click a point on the edge of the area"));
        this.setLeftMouseTip(qsTr("Click a point on the edge of the area"));
    }
    else if (this.step === 1) {
        this.radius = Math.sqrt((p.x - this.from.x) * (p.x - this.from.x) + (p.y - this.from.y) * (p.y - this.from.y));
        if (!(this.radius > 0)) {
            return;
        }
        this.step = 2;
        this.setCommandPrompt(qsTr("Click where the centre of the detail goes"));
        this.setLeftMouseTip(qsTr("Click where the centre of the detail goes"));
    }
    else {
        var vp = doc.queryEntity(this.parent);
        if (!isNull(vp)) {
            CsLayoutFurniture.addDetail(doc, di, info, vp, this.from, this.radius, { x: p.x, y: p.y }, this.mag);
        }
        this.terminate();
    }
};

LayoutDetail.init = function(basePath) {
    var action = new RGuiAction(qsTr("Add Detail"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/LayoutDetail.js");
    action.setIcon(basePath + "/LayoutDetail.svg");
    action.setStatusTip(qsTr("Add a magnified circular detail of the map, marked on the map with a lettered circle and a leader"));
    action.setDefaultCommands(["detail", "dtl"]);
    action.setGroupSortOrder(454);
    action.setSortOrder(71);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar", "LayoutMenu"]);
};
