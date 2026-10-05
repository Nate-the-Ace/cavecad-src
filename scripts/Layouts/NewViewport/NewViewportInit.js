function init(basePath) {
    var menu = EAction.getMenu(qsTr("&Layout"), "LayoutMenu");
    var action = new RGuiAction(qsTranslate("NewViewport", "&New Viewport"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/NewViewport.js");
    action.setStatusTip(qsTranslate("NewViewport", "Draw a viewport on the layout: click two corners"));
    action.setDefaultShortcut(new QKeySequence("v,p"));
    action.setDefaultCommands(["viewport", "mview"]);
    action.setGroupSortOrder(65000);
    action.setSortOrder(100);
    action.setWidgetNames(["LayoutMenu"]);
}
