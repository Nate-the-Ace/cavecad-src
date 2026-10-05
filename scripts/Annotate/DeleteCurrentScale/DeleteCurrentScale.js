/**
 * DeleteCurrentScale -- remove the current annotation scale from the selected annotative text (it keeps at least one).
 * One-shot tool of the Annotate menu; the work is in Annotative.js.
 */
include("scripts/EAction.js");
include("scripts/Annotate/Annotative.js");

function DeleteCurrentScale(guiAction) {
    EAction.call(this, guiAction);
}

DeleteCurrentScale.prototype = new EAction();

DeleteCurrentScale.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    var doc = this.getDocument();
    var ids = Annotative.textsOf(doc, doc.querySelectedEntities());
    var cur = Annotative.currentScale(doc);
    if (ids.length === 0) {
        EAction.handleUserWarning(qsTr("Delete Current Scale: select some annotative text first."));
    }
    else {
        EAction.handleUserMessage(qsTr("%1 removed from %2 text(s).").arg(Annotative.label(cur)).arg(Annotative.removeScale(this.getDocumentInterface(), ids, cur)));
    }
    this.terminate();
};
