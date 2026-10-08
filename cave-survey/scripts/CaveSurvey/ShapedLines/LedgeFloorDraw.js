// LedgeFloorDraw.js -- the Floor Ledge button: drag along the edge of
// the drop; a solid spine plus NSS hachures on the low side (1976
// standard: "hachures point down"). Flip Shaped Side if the drop is on
// the other side. All behavior lives in ShapedLinesRun.

include("scripts/EAction.js");
include(includeBasePath + "/ShapedLinesRun.js");

function LedgeFloorDraw(guiAction) {
    ShapedLinesRun.call(this, guiAction);
}

LedgeFloorDraw.prototype = new ShapedLinesRun();
LedgeFloorDraw.prototype.styleKey = "floorledge";

LedgeFloorDraw.init = function(basePath) {
    var drawAction = new RGuiAction(qsTr("Floor Ledge"),
        RMainWindowQt.getMainWindow());
    drawAction.setRequiresDocument(true);
    drawAction.setScriptFile(basePath + "/LedgeFloorDraw.js");
    drawAction.setIcon(basePath + "/LedgeFloorDraw.svg");
    drawAction.setStatusTip(qsTr("Drag along a floor ledge; tick marks " +
        "land on the drop side"));
    drawAction.setDefaultCommands(["ledgefloor", "lgf"]);
    drawAction.setGroupSortOrder(450);
    drawAction.setSortOrder(31);
    // NO WIDGET NAMES: the Cave Lines toolbar is gone (2026-09-07) and
    // this action is reached from Feature Trace's panel, which carries
    // a tile per style. The command below still works and is the whole
    // reason the action is still registered.
};
