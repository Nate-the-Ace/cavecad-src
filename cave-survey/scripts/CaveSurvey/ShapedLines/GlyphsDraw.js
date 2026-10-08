// GlyphsDraw.js -- the Wall Glyphs button: drag along a wall; a catalog
// symbol (default SYM_BREAKDOWN, the UIS "Stone blocks" glyph) is
// placed every spacingFeet, offset out from the spine on the low side,
// rotated to follow the wall and seed-jittered in position, rotation
// and size. Flip Shaped Side if the glyphs land inside the passage.
// The spine is scaffolding like flowstone's -- it lives on
// CTRL-SHAPE-SPINE (off by default). Behavior lives in ShapedLinesRun;
// which symbol is placed lives on the spine's ShapeSymbol tag (Decorate
// Selection's dialog is the usual way to change it).

include("scripts/EAction.js");
include(includeBasePath + "/ShapedLinesRun.js");

function GlyphsDraw(guiAction) {
    ShapedLinesRun.call(this, guiAction);
}

GlyphsDraw.prototype = new ShapedLinesRun();
GlyphsDraw.prototype.styleKey = "glyphs";

GlyphsDraw.init = function(basePath) {
    var drawAction = new RGuiAction(qsTr("Wall Glyphs"),
        RMainWindowQt.getMainWindow());
    drawAction.setRequiresDocument(true);
    drawAction.setScriptFile(basePath + "/GlyphsDraw.js");
    drawAction.setIcon(basePath + "/GlyphsDraw.svg");
    drawAction.setStatusTip(qsTr("Drag along a wall; a catalog symbol " +
        "is placed at regular intervals on the low side"));
    drawAction.setDefaultCommands(["wallglyphs", "wgl"]);
    drawAction.setGroupSortOrder(450);
    drawAction.setSortOrder(37);
    // NO WIDGET NAMES: the Cave Lines toolbar is gone (2026-09-07) and
    // this action is reached from Feature Trace's panel, which carries
    // a tile per style. The command below still works and is the whole
    // reason the action is still registered.
};
