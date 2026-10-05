/**
 * AnnotationScale -- choose the current annotation scale: the scale the model view shows annotative text at.
 * One-shot tool of the Annotate menu; the work is in Annotative.js.
 */
include("scripts/EAction.js");
include("scripts/Annotate/Annotative.js");

function AnnotationScale(guiAction) {
    EAction.call(this, guiAction);
}

AnnotationScale.prototype = new EAction();

AnnotationScale.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    var doc = this.getDocument();
    var scales = Layouts.scales();
    var labels = scales.map(function(s) { return s.label; });
    var cur = Annotative.currentScale(doc), at = 0;
    for (var i = 0; i < scales.length; i++) {
        if (Annotative.same(scales[i].feetPerInch, cur)) { at = i; }
    }
    var pick = QInputDialog.getItem(RMainWindowQt.getMainWindow(), qsTr("Annotation Scale"), qsTr("Current annotation scale:"), labels, at, false);
    if (!isNull(pick) && pick !== "") {
        Annotative.setCurrentScale(this.getDocumentInterface(), scales[labels.indexOf(String(pick))].feetPerInch);
    }
    this.terminate();
};
