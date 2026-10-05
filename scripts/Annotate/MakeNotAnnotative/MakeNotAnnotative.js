/**
 * MakeNotAnnotative -- make the selected annotative text ordinary again, as it looks at the current scale.
 * One-shot tool of the Annotate menu; the work is in Annotative.js.
 */
include("scripts/EAction.js");
include("scripts/Annotate/Annotative.js");

function MakeNotAnnotative(guiAction) {
    EAction.call(this, guiAction);
}

MakeNotAnnotative.prototype = new EAction();

MakeNotAnnotative.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    var doc = this.getDocument();
    var ids = Annotative.textsOf(doc, doc.querySelectedEntities());
    if (ids.length === 0) {
        EAction.handleUserWarning(qsTr("Make Not Annotative: select some annotative text first."));
    }
    else {
        EAction.handleUserMessage(qsTr("%1 text(s) made ordinary.").arg(Annotative.unmake(this.getDocumentInterface(), ids)));
    }
    this.terminate();
};
