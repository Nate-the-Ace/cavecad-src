/**
 * MakeAnnotative -- make the selected text annotative: it keeps a paper height and a list of scales, and shows at the right size in every viewport that supports one of them.
 * One-shot tool of the Annotate menu; the work is in Annotative.js.
 */
include("scripts/EAction.js");
include("scripts/Annotate/Annotative.js");

function MakeAnnotative(guiAction) {
    EAction.call(this, guiAction);
}

MakeAnnotative.prototype = new EAction();

MakeAnnotative.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    var doc = this.getDocument();
    var ids = Annotative.textsOf(doc, doc.querySelectedEntities());
    if (ids.length === 0) {
        EAction.handleUserWarning(qsTr("Make Annotative: select some text first."));
    }
    else {
        var n = Annotative.make(this.getDocumentInterface(), ids);
        EAction.handleUserMessage(qsTr("%1 text(s) made annotative at %2.").arg(n).arg(Annotative.label(Annotative.currentScale(doc))));
    }
    this.terminate();
};
