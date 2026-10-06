function init(basePath) {
    include("scripts/Annotate/Annotative.js");
    Annotative.install();
    var action = new RGuiAction(qsTranslate("MakeAnnotative", "Make Annotative"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/MakeAnnotative.js");
    action.setStatusTip(qsTranslate("MakeAnnotative", "Make the selected text annotative: it keeps a paper height and a list of scales, and shows at the right size in every viewport that supports one of them"));
    action.setDefaultCommands(["annotative", "anno"]);
    action.setGroupSortOrder(70000);
    action.setSortOrder(10);
    // no menu: the controls live in the Property Editor (Annotation section); these are commands only
}
