// Fixture for tests/run.sh. Each line below is counted by audit.py;
// the expected totals live in run.sh, so keep the two in step.

function probeGood() {
    return qsTr("Hello probe");                          // extracted, clean
}

function probeBad(w, n, label) {
    op.setText("Draw probe");                            // UNWRAPPED
    new QLabel("Trip");                                  // UNWRAPPED
    Probe.setText("probeButton", qsTr("Probe"));         // clean: objectName
    qsTr(label);                                         // DYNAMIC
    qsTr("Found ") + n + qsTr(" stations");              // CONCAT
    var x = parseFloat(w.lengthEdit.text);               // NUMBER
    op.setText("keep"); // i18n-ok                       // skipped
}
