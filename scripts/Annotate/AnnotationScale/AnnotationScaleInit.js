function init(basePath) {
    include("scripts/Annotate/Annotative.js");
    Annotative.install();
    var action = new RGuiAction(qsTranslate("AnnotationScale", "Annotation Scale"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/AnnotationScale.js");
    action.setStatusTip(qsTranslate("AnnotationScale", "Choose the current annotation scale: the scale the model view shows annotative text at"));
    action.setDefaultCommands(["annoscale", "cannoscale"]);
    action.setGroupSortOrder(70000);
    action.setSortOrder(50);
    // no menu: the controls live in the Property Editor (Annotation section); these are commands only
}
