function init(basePath) {
    include("scripts/Annotate/Annotative.js");
    Annotative.install();
    var action = new RGuiAction(qsTranslate("MakeNotAnnotative", "Make Not Annotative"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/MakeNotAnnotative.js");
    action.setStatusTip(qsTranslate("MakeNotAnnotative", "Make the selected annotative text ordinary again, as it looks at the current scale"));
    action.setDefaultCommands(["notannotative", "unanno"]);
    action.setGroupSortOrder(70000);
    action.setSortOrder(20);
    // no menu: the controls live in the Property Editor (Annotation section); these are commands only
}
