/**
 * AddCurrentScale -- add the current annotation scale to the selected annotative text; it starts where its nearest scale has it, and you move it there.
 * One-shot tool of the Annotate menu; the work is in Annotative.js.
 */
include("scripts/EAction.js");
include("scripts/Annotate/Annotative.js");

function AddCurrentScale(guiAction) {
    EAction.call(this, guiAction);
}

AddCurrentScale.prototype = new EAction();

AddCurrentScale.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    var doc = this.getDocument();
    var ids = Annotative.textsOf(doc, doc.querySelectedEntities());
    var cur = Annotative.currentScale(doc);
    var n = ids.length === 0 ? 0 : Annotative.addScale(this.getDocumentInterface(), ids, cur);
    if (ids.length === 0) {
        EAction.handleUserWarning(qsTr("Add Current Scale: select some annotative text first."));
    }
    else {
        EAction.handleUserMessage(qsTr("%1 added to %2 text(s).").arg(Annotative.label(cur)).arg(n));
    }
    this.terminate();
};
