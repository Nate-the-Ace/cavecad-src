function init(basePath) {
    include("scripts/Annotate/Annotative.js");
    Annotative.install();
    var action = new RGuiAction(qsTranslate("DeleteCurrentScale", "Delete Current Scale"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/DeleteCurrentScale.js");
    action.setStatusTip(qsTranslate("DeleteCurrentScale", "Remove the current annotation scale from the selected annotative text (it keeps at least one)"));
    action.setDefaultCommands(["delscale", "dsc"]);
    action.setGroupSortOrder(70000);
    action.setSortOrder(40);
    // no menu: the controls live in the Property Editor (Annotation section); these are commands only
}
