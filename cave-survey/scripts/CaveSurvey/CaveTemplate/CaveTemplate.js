// CaveTemplate.js
//
// QCAD add-on tool: makes the NSS plan template the DEFAULT for new
// drawings, and adds a "New Cave Map" menu entry.
//
// Registration side: init() hooks QCAD's post-new mechanism
// (NewFile.addPostNewAction), so EVERY new document -- File > New,
// Cmd+N, anything -- gets the NSS template poured in: all layers
// (the empty CTRL- ones included), the SYM_* symbol blocks, the
// title block text, border and bar scales. The fill happens in
// CaveTemplateApply.js and is ON BY DEFAULT -- this is a cave
// mapping build; only setting CaveSurvey/TemplateOnNew to false
// explicitly gets a plain new document back.
//
// The template ships INSIDE the add-on (Templates/ beside this
// folder, placed there by the package build), so there is no path
// to configure and nothing else to install.

include("scripts/EAction.js");
include("scripts/simple.js");
include("scripts/File/NewFile/NewFile.js");

function CaveTemplate(guiAction) {
    EAction.call(this, guiAction);
}

CaveTemplate.prototype = new EAction();

// Triggers the stock File > New; the post-new hook does the rest.
CaveTemplate.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    // Make sure the fill is on for this explicit request even on a
    // machine that switched TemplateOnNew off -- the user asked for
    // a cave map by name.
    RSettings.setValue("CaveSurvey/TemplateOnNewOnce", true);

    var candidates = [
        ":scripts/File/NewFile/NewFile.js",
        ":/scripts/File/NewFile/NewFile.js",
        "scripts/File/NewFile/NewFile.js"
    ];
    var triggered = false;
    for (var i = 0; i < candidates.length && !triggered; i++) {
        var action = RGuiAction.getByScriptFile(candidates[i]);
        if (action !== null && action !== undefined) {
            action.slotTrigger();
            triggered = true;
        }
    }
    if (!triggered) {
        EAction.handleUserMessage("New Cave Map: couldn't reach the " +
            "stock New action -- use File > New; the template fills " +
            "in there too.");
    }

    this.terminate();
};

CaveTemplate.init = function(basePath) {
    var action = new RGuiAction(qsTr("New Cave Map"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(false);
    action.setScriptFile(basePath + "/CaveTemplate.js");
    action.setIcon(basePath + "/CaveTemplate.svg");
    action.setStatusTip(qsTr("Start a new map from the NSS template: layers, symbols, title block, border"));
    action.setDefaultCommands(["newcavemap", "ncm"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(30); // first thing in the Cave Survey menu
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);

    // every new document runs the apply script (it gates itself):
    NewFile.addPostNewAction(basePath + "/CaveTemplateApply.js");
};
