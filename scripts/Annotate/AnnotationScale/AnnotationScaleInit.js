function init(basePath) {
    include("scripts/Annotate/Annotative.js");
    Annotative.install();
    var menu = EAction.getMenu(qsTr("&Annotate"), "AnnotateMenu");
    var action = new RGuiAction(qsTranslate("AnnotationScale", "Annotation Scale"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/AnnotationScale.js");
    action.setStatusTip(qsTranslate("AnnotationScale", "Choose the current annotation scale: the scale the model view shows annotative text at"));
    action.setDefaultCommands(["annoscale", "cannoscale"]);
    action.setGroupSortOrder(70000);
    action.setSortOrder(50);
    action.setWidgetNames(["AnnotateMenu"]);
}
