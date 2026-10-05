function init(basePath) {
    include("scripts/Annotate/Annotative.js");
    Annotative.install();
    var menu = EAction.getMenu(qsTr("&Annotate"), "AnnotateMenu");
    var action = new RGuiAction(qsTranslate("DeleteCurrentScale", "Delete Current Scale"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/DeleteCurrentScale.js");
    action.setStatusTip(qsTranslate("DeleteCurrentScale", "Remove the current annotation scale from the selected annotative text (it keeps at least one)"));
    action.setDefaultCommands(["delscale", "dsc"]);
    action.setGroupSortOrder(70000);
    action.setSortOrder(40);
    action.setWidgetNames(["AnnotateMenu"]);
}
