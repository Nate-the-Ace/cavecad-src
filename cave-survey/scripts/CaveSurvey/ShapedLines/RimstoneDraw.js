// RimstoneDraw.js -- the Rimstone Dam button: drag along the dam crest;
// a tighter scallop chain bows DOWNSTREAM, matching how a real rimstone
// dam arcs. Spine goes to CTRL-SHAPE-SPINE (off by default). Behavior
// lives in ShapedLinesRun.

include("scripts/EAction.js");
include(includeBasePath + "/ShapedLinesRun.js");

function RimstoneDraw(guiAction) {
    ShapedLinesRun.call(this, guiAction);
}

RimstoneDraw.prototype = new ShapedLinesRun();
RimstoneDraw.prototype.styleKey = "rimstone";

RimstoneDraw.init = function(basePath) {
    var drawAction = new RGuiAction(qsTr("Rimstone Dam"),
        RMainWindowQt.getMainWindow());
    drawAction.setRequiresDocument(true);
    drawAction.setScriptFile(basePath + "/RimstoneDraw.js");
    drawAction.setIcon(basePath + "/RimstoneDraw.svg");
    drawAction.setStatusTip(qsTr("Drag along a rimstone dam; scallops " +
        "bow to the downstream side"));
    drawAction.setDefaultCommands(["rimstone", "rst"]);
    drawAction.setGroupSortOrder(450);
    drawAction.setSortOrder(35);
    // NO WIDGET NAMES: the Cave Lines toolbar is gone (2026-09-07) and
    // this action is reached from Feature Trace's panel, which carries
    // a tile per style. The command below still works and is the whole
    // reason the action is still registered.
};
