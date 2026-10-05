/**
 * AnnotationVisibility -- show every scale of annotative text, the current one normal and the others shaded back (or only the current).
 * One-shot tool of the Annotate menu; the work is in Annotative.js.
 */
include("scripts/EAction.js");
include("scripts/Annotate/Annotative.js");

function AnnotationVisibility(guiAction) {
    EAction.call(this, guiAction);
}

AnnotationVisibility.prototype = new EAction();

AnnotationVisibility.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    var doc = this.getDocument();
    Annotative.setVisible(this.getDocumentInterface(), !Annotative.visible(doc));
    EAction.handleUserMessage(Annotative.visible(doc) ? qsTr("Showing every scale of annotative text; the others are shaded back.") : qsTr("Showing annotative text at the current scale only."));
    this.terminate();
};
