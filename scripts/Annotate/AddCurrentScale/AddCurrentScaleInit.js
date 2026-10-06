function init(basePath) {
    include("scripts/Annotate/Annotative.js");
    Annotative.install();
    var action = new RGuiAction(qsTranslate("AddCurrentScale", "Add Current Scale"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/AddCurrentScale.js");
    action.setStatusTip(qsTranslate("AddCurrentScale", "Add the current annotation scale to the selected annotative text; it starts where its nearest scale has it, and you move it there"));
    action.setDefaultCommands(["addscale", "asc"]);
    action.setGroupSortOrder(70000);
    action.setSortOrder(30);
    // no menu: the controls live in the Property Editor (Annotation section); these are commands only
}
