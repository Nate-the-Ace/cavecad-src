function init(basePath) {
    include("scripts/Annotate/Annotative.js");
    Annotative.install();
    var action = new RGuiAction(qsTranslate("AnnotationVisibility", "Show All Scales"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/AnnotationVisibility.js");
    action.setStatusTip(qsTranslate("AnnotationVisibility", "Show every scale of annotative text, the current one normal and the others shaded back (or only the current)"));
    action.setDefaultCommands(["annovisibility", "anv"]);
    action.setGroupSortOrder(70000);
    action.setSortOrder(60);
    // no menu: the controls live in the Property Editor (Annotation section); these are commands only
}
