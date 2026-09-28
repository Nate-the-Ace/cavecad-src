function init(basePath) {
    var action = new RGuiAction(qsTranslate("SendFeedback", "Send &Feedback..."), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(false);
    action.setScriptFile(basePath + "/SendFeedback.js");
    action.setNoState();
    action.setGroupSortOrder(110200);
    action.setSortOrder(500);
    action.setWidgetNames(["HelpMenu", "!HelpToolBar"]);
}
