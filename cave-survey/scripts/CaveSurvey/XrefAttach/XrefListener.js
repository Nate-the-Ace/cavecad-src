// XrefListener.js -- offers to update an external reference when its file has changed.
//
// Not a menu tool; installed once from CaveSurvey.js. Every few seconds it looks at the drawing in front: for each
// external reference (CsXref) whose file is newer than what was read, it asks once per change -- Update now, Later,
// or Always update this one (remembered on the reference). A reference set to always update is updated without asking.
//
// Cheap on purpose: a drawing with no external references costs one scan of its block list per tick, and nothing
// happens while a dialog of its own is up. A file that is missing is never an error here (the Manager shows it);
// the picture is kept.

function XrefListener() {}

XrefListener.installed = false;
XrefListener.busy = false;
XrefListener.INTERVAL_MS = 10000;
XrefListener.asked = {};       // "<drawing>|<block>|<file stamp>" -> true: asked once per change

XrefListener.install = function() {
    if (XrefListener.installed) {
        return false;
    }
    var win = RMainWindowQt.getMainWindow();
    if (isNull(win)) {
        return false;     // headless: nobody to ask
    }
    try {
        var timer = new QTimer(win);
        timer.interval = XrefListener.INTERVAL_MS;
        timer.timeout.connect(XrefListener.check);
        timer.start();
        XrefListener.timer = timer;
    }
    catch (e) {
        return false;     // without it, External References still updates by hand
    }
    XrefListener.installed = true;
    return true;
};

/** The three answers: "update", "later", "always". */
XrefListener.ask = function(item) {
    var win = RMainWindowQt.getMainWindow();
    var msg = new QMessageBox(win);
    msg.windowTitle = qsTr("External reference changed");
    msg.text = qsTr("%1 has changed on disk. Update this drawing's copy?").arg(CsXref.stem(item.stored));
    msg.informativeText = item.full;
    var bUpdate = msg.addButton(qsTr("Update now"), QMessageBox.AcceptRole);
    var bLater = msg.addButton(qsTr("Later"), QMessageBox.RejectRole);
    var bAlways = msg.addButton(qsTr("Always update this one"), QMessageBox.ActionRole);
    msg.exec();
    var clicked = msg.clickedButton();
    var answer = "later";
    if (clicked === bUpdate) { answer = "update"; }
    else if (clicked === bAlways) { answer = "always"; }
    try {
        msg.close();
        msg.deleteLater();
    } catch (eClose) {
    }
    return answer;
};

XrefListener.check = function() {
    if (XrefListener.busy) {
        return;
    }
    XrefListener.busy = true;
    try {
        var win = RMainWindowQt.getMainWindow();
        var di = isNull(win) ? null : win.getDocumentInterface();
        var doc = isNull(di) ? null : di.getDocument();
        if (isNull(doc)) {
            return;
        }
        var drawing = "";
        try { drawing = String(doc.getFileName()); } catch (eName) { drawing = ""; }
        var items = CsXref.listIn(doc);
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            if (it.status !== "changed") {
                continue;
            }
            var key = drawing + "|" + it.name + "|" + it.now;
            if (XrefListener.asked.hasOwnProperty(key) && !it.auto) {
                continue;
            }
            XrefListener.asked[key] = true;
            var answer = it.auto ? "update" : XrefListener.ask(it);
            if (answer === "always") {
                CsXref.setAuto(doc, di, it.blockId, true);
                answer = "update";
            }
            if (answer === "update") {
                var res = CsXref.reload(doc, di, it.blockId, {});
                if (!res.ok) {
                    CsTell.warn(qsTr("External References: ") + res.why);
                }
                else {
                    EAction.handleUserMessage(qsTr("Updated %1.").arg(CsXref.stem(it.stored)));
                }
            }
        }
    }
    catch (e) {
        // a check that fails is a check that did not happen; never a dialog
    }
    finally {
        XrefListener.busy = false;
    }
};
