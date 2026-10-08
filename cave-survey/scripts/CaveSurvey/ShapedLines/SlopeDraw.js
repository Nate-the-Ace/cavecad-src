// SlopeDraw.js -- the Slope button: drag along the slope BREAK (the
// top edge); splayed fans of short lines hang downhill from it (NSS
// 1976: slope, "lines splay down"). Flip Shaped Side if downhill is
// the other way. The spine is scaffolding like flowstone's -- it lives
// on CTRL-SHAPE-SPINE (off by default); switch that layer on to
// reshape the break. Behavior lives in ShapedLinesRun.

include("scripts/EAction.js");
include(includeBasePath + "/ShapedLinesRun.js");

function SlopeDraw(guiAction) {
    ShapedLinesRun.call(this, guiAction);
}

SlopeDraw.prototype = new ShapedLinesRun();
SlopeDraw.prototype.styleKey = "slope";

SlopeDraw.init = function(basePath) {
    var drawAction = new RGuiAction(qsTr("Slope"),
        RMainWindowQt.getMainWindow());
    drawAction.setRequiresDocument(true);
    drawAction.setScriptFile(basePath + "/SlopeDraw.js");
    drawAction.setIcon(basePath + "/SlopeDraw.svg");
    drawAction.setStatusTip(qsTr("Drag along the top of a slope; " +
        "splayed lines fan out on the downhill side"));
    drawAction.setDefaultCommands(["slopeline", "slp"]);
    drawAction.setGroupSortOrder(450);
    drawAction.setSortOrder(36);
    // NO WIDGET NAMES: the Cave Lines toolbar is gone (2026-09-07) and
    // this action is reached from Feature Trace's panel, which carries
    // a tile per style. The command below still works and is the whole
    // reason the action is still registered.
};
