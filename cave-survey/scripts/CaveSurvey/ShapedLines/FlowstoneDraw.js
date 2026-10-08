// FlowstoneDraw.js -- the Flowstone button: drag along the formation's
// edge; the visible ink is a scallop chain bowing DOWNSLOPE (NSS
// flowstone), and the spine goes to CTRL-SHAPE-SPINE (off by default)
// -- switch that layer on to grab and reshape the edge. Behavior lives
// in ShapedLinesRun.

include("scripts/EAction.js");
include(includeBasePath + "/ShapedLinesRun.js");

function FlowstoneDraw(guiAction) {
    ShapedLinesRun.call(this, guiAction);
}

FlowstoneDraw.prototype = new ShapedLinesRun();
FlowstoneDraw.prototype.styleKey = "flowstone";

FlowstoneDraw.init = function(basePath) {
    var drawAction = new RGuiAction(qsTr("Flowstone"),
        RMainWindowQt.getMainWindow());
    drawAction.setRequiresDocument(true);
    drawAction.setScriptFile(basePath + "/FlowstoneDraw.js");
    drawAction.setIcon(basePath + "/FlowstoneDraw.svg");
    drawAction.setStatusTip(qsTr("Drag along a flowstone edge; scallops " +
        "bow to the downslope side"));
    drawAction.setDefaultCommands(["flowstone", "fst"]);
    drawAction.setGroupSortOrder(450);
    drawAction.setSortOrder(34);
    // NO WIDGET NAMES: the Cave Lines toolbar is gone (2026-09-07) and
    // this action is reached from Feature Trace's panel, which carries
    // a tile per style. The command below still works and is the whole
    // reason the action is still registered.
};
