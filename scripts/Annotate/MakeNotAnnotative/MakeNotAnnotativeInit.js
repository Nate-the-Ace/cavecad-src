function init(basePath) {
    include("scripts/Annotate/Annotative.js");
    Annotative.install();
    var menu = EAction.getMenu(qsTr("&Annotate"), "AnnotateMenu");
    var action = new RGuiAction(qsTranslate("MakeNotAnnotative", "Make Not Annotative"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/MakeNotAnnotative.js");
    action.setStatusTip(qsTranslate("MakeNotAnnotative", "Make the selected annotative text ordinary again, as it looks at the current scale"));
    action.setDefaultCommands(["notannotative", "unanno"]);
    action.setGroupSortOrder(70000);
    action.setSortOrder(20);
    action.setWidgetNames(["AnnotateMenu"]);
}
