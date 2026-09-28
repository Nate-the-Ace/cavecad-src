// SendFeedback.js -- Help > Send Feedback. Replaces QCAD's Report Bug
// (which opened qcad.org). The screenshot is grabbed before the dialog
// opens so the dialog is never in it. Every report is queued in the outbox
// before sending, so "a copy is saved" is always true.
//
// The drawing's folder may be large (it can be ~/Documents), so the survey
// file list, the used-scan list and all their sizes are computed ONCE when
// the dialog opens; checkbox/combo changes only re-add cached numbers, and
// a Description keystroke only re-evaluates the scan hint.
//
// Message boxes are parented to the main window, never to the modal dialog
// (see the updater's engine notes); QMessageBox buttons are told apart by
// objectName because addButton() hands back a fresh wrapper each time.

include("scripts/Help/Help.js");
include("scripts/AddOn.js");
include("scripts/Help/CheckForUpdates/CcUpdateCommands.js");
include("scripts/Help/CheckForUpdates/CcUpdateRun.js");
include("scripts/Help/CheckForUpdates/CheckForUpdates.js");
include("FeedbackConfig.js");
include("FeedbackCore.js");
include("FeedbackCommands.js");
include("FeedbackPackage.js");
include("FeedbackSend.js");

function SendFeedback(guiAction) { Help.call(this, guiAction); }
SendFeedback.prototype = new Help();
SendFeedback.includeBasePath = includeBasePath;
SendFeedback.TYPES = ["bug", "idea", "question"];
SendFeedback.SCAN_MODES = ["none", "used", "chosen"];

SendFeedback.prototype.beginEvent = function() {
    Help.prototype.beginEvent.call(this);
    SendFeedback.open();
    this.terminate();
};

SendFeedback.date = function() { return String(new Date().toISOString()).substring(0, 10); };

/** The main window, or null (headless it comes back NULL-WRAPPED, not null). */
SendFeedback.mainWindow = function() {
    var w = RMainWindowQt.getMainWindow();
    try { return (!isNull(w) && typeof w.isVisible() === "boolean") ? w : null; } catch (e) { return null; }
};

/** Versions, OS, tool and documents for report.json. */
SendFeedback.meta = function(di) {
    var local = {};
    try { local = CheckForUpdates.local(); } catch (e0) { local = {}; }
    var tool = "";
    try {
        var a = isNull(di) ? null : di.getCurrentAction();
        var g = isNull(a) ? null : a.getGuiAction();
        var tx = isNull(g) ? "" : g.text;
        if (typeof tx === "function") { tx = g.text(); }
        tool = String(tx || "").replace(/&/g, "");
    } catch (e1) { tool = ""; }
    var docs = [];
    try {
        var mdi = RMainWindowQt.getMainWindow().getMdiArea();
        var subs = isNull(mdi) ? [] : mdi.subWindowList();
        for (var i = 0; i < subs.length; i++) {
            try { docs.push(String(subs[i].getDocument().getFileName()).replace(/^.*[\/\\]/, "")); } catch (e2) { /* a window without a document */ }
        }
    } catch (e3) { docs = []; }
    var os = String(RS.getSystemId());
    try { os += " " + String(RSettings.getOSVersion()); } catch (e4) { /* system id alone */ }
    try { os += " " + String(RS.getBuildCpuArchitecture()); } catch (e5) { /* no architecture */ }
    return {
        version: String(RSettings.getVersionString()),
        commit: String(local.appCommit || "dev"),
        caveSurvey: String(local.toolsVersion || ""),
        os: os,
        activeTool: tool, documents: docs,
        created: new Date().toISOString()
    };
};

SendFeedback.sizeOf = function(paths) {
    var n = 0;
    for (var i = 0; i < paths.length; i++) { n += new QFileInfo(paths[i]).size(); }
    return n;
};

SendFeedback.open = function() {
    var appWin = RMainWindowQt.getMainWindow();
    var di = EAction.getDocumentInterface();
    var doc = null;
    try { doc = isNull(di) ? null : di.getDocument(); } catch (e0) { doc = null; }
    if (isNull(doc)) { doc = null; di = null; }
    var hasDoc = doc !== null;
    var docPath = hasDoc ? String(doc.getFileName()) : "";
    var caveDir = docPath === "" ? "" : String(new QFileInfo(docPath).absolutePath());
    var hasDir = caveDir !== "";
    var id = FeedbackCore.newId();
    var base = FeedbackPackage.stagingBase();
    (new QDir()).mkpath(base);
    var shot = base + "/" + id + "-screenshot.png";
    var shotOk = false;
    try { shotOk = appWin.grab().save(shot, "PNG") === true; } catch (e1) { shotOk = false; }

    // ---- computed once (see header) ----
    var cache = { survey: [], surveyBytes: 0, truncated: false, used: [], usedBytes: 0,
                  logs: [], logBytes: 0, shotBytes: shotOk ? new QFileInfo(shot).size() : 0 };
    cache.logs = FeedbackPackage.latestLogs(FeedbackPackage.logDir());
    cache.logBytes = SendFeedback.sizeOf(cache.logs);
    if (hasDir) {
        cache.survey = FeedbackCore.surveyFiles(FeedbackPackage.listFiles(caveDir));
        cache.truncated = FeedbackPackage.lastListTruncated === true;
        cache.surveyBytes = SendFeedback.sizeOf(cache.survey.map(function(r) { return caveDir + "/" + r; }));
    }
    if (hasDoc) {
        try { cache.used = FeedbackPackage.usedScans(doc, caveDir); } catch (e2) { cache.used = []; }
        cache.usedBytes = SendFeedback.sizeOf(cache.used);
    }
    var chosen = [], chosenBytes = 0, lastScanIndex = 0;

    var dialog = WidgetFactory.createDialog(SendFeedback.includeBasePath, "SendFeedbackDialog.ui", appWin);
    var w = function(n) { return dialog.findChild(n); };
    // closed: exec() has returned; busy: a zip/send is still running
    var state = { closed: false, busy: false };

    ["Drawing", "Scans", "ScansLabel", "AttachUsedScans", "ChooseScan"].forEach(function(n) { w(n).enabled = hasDoc; });
    w("SurveyFiles").enabled = hasDir;
    w("Screenshot").enabled = shotOk;
    w("Screenshot").checked = shotOk;
    try { w("Buttons").button(QDialogButtonBox.Ok).setText(qsTr("Send")); } catch (e3) { /* keep OK */ }

    function scanIndex() { return hasDoc ? w("Scans").currentIndex : 0; }
    function scans() {
        var i = scanIndex();
        if (i === 1) { return cache.used; }
        if (i === 2) { return chosen; }
        return [];
    }
    function updateHint() {
        w("ScanHint").visible = hasDoc && scanIndex() === 0 && FeedbackCore.mentionsScan(w("Description").plainText);
    }
    function updateSize() {
        var i = scanIndex();
        w("ScansChosen").text = i === 2 ? qsTr("%1 chosen").arg(chosen.length) : "";
        var survey = w("SurveyFiles").checked && hasDir;
        var other = (w("Logs").checked ? cache.logBytes : 0)
            + (w("Screenshot").checked ? cache.shotBytes : 0)
            + (survey ? cache.surveyBytes : 0);
        var scanBytes = i === 1 ? cache.usedBytes : (i === 2 ? chosenBytes : 0);
        var total = other + scanBytes;
        var mb = function(b) { return (b / FeedbackCore.MB).toFixed(1); };
        var t = qsTr("About %1 MB (scans %2 MB)").arg(mb(total)).arg(mb(scanBytes));
        if (survey && cache.truncated) { t += " " + qsTr("(first %1 files only)").arg(FeedbackPackage.LIST_MAX); }
        if (FeedbackCore.sizeVerdict(total) !== "ok") { t = "<b>" + t + " — " + qsTr("large; consider fewer scans") + "</b>"; }
        w("Size").text = t;
    }
    function refresh() { updateHint(); updateSize(); }
    function choose() {
        var fd = new QFileDialog(appWin, qsTr("Choose scans"), hasDir ? caveDir : QDir.homePath());
        fd.setOption(QFileDialog.DontUseNativeDialog, true);
        fd.fileMode = QFileDialog.ExistingFiles;
        if (fd.exec() === 1) {
            chosen = fd.selectedFiles().map(function(s) { return String(s); });
            chosenBytes = SendFeedback.sizeOf(chosen);
        }
        destrDialog(fd);   // destroy() is "indestructible" under Qt 6
        // cancelled with nothing chosen: back to what it was
        w("Scans").currentIndex = chosen.length > 0 ? 2 : (lastScanIndex === 2 ? 0 : lastScanIndex);
        lastScanIndex = w("Scans").currentIndex;
        refresh();
    }
    w("Description").textChanged.connect(updateHint);
    ["Logs", "Screenshot", "Drawing", "SurveyFiles"].forEach(function(n) { w(n).toggled.connect(updateSize); });
    w("Scans")["activated(int)"].connect(function(i) {
        if (i === 2) { choose(); return; }
        lastScanIndex = i;
        refresh();
    });
    w("AttachUsedScans").clicked.connect(function() { w("Scans").currentIndex = 1; lastScanIndex = 1; refresh(); });
    w("ChooseScan").clicked.connect(choose);

    function fields() {
        return { type: SendFeedback.TYPES[w("Type").currentIndex], summary: String(w("Summary").text),
                 description: String(w("Description").plainText), email: String(w("Email").text) };
    }
    /** Stages the report; null (after telling the user) if it could not. */
    function stage() {
        var drawingCopy = null;
        if (w("Drawing").checked && hasDoc) {
            drawingCopy = base + "/" + id + "-drawing.dxf";
            if (!FeedbackPackage.copyDrawing(di, drawingCopy)) { QFile.remove(drawingCopy); drawingCopy = null; }
        }
        var s = FeedbackPackage.stage({
            base: base, id: id, fields: fields(), meta: SendFeedback.meta(di),
            logs: w("Logs").checked ? cache.logs : [],
            screenshot: w("Screenshot").checked && shotOk ? shot : null,
            drawing: drawingCopy, caveDir: caveDir,
            surveyFiles: w("SurveyFiles").checked && hasDir ? cache.survey : [],
            scans: scans(), scanMode: SendFeedback.SCAN_MODES[scanIndex()]
        });
        if (drawingCopy !== null) { QFile.remove(drawingCopy); }
        if (s === null) {
            QMessageBox.warning(appWin, qsTr("Send Feedback"),
                qsTr("Could not prepare the report in %1.").arg(base));
        }
        return s;
    }
    function setBusy(b) {
        state.busy = b;
        if (state.closed) { return; }
        ["Buttons", "Review", "Attach", "Type", "Summary", "Email", "Description", "ScanHint"].forEach(function(n) { w(n).enabled = !b; });
    }
    function cleanup() {
        QFile.remove(shot);
        (new QDir(base + "/" + id)).removeRecursively();
    }
    function finish() {
        // after exec() returned while a send was running: the dialog is ours to free
        setBusy(false);
        if (state.closed) { cleanup(); destrDialog(dialog); }
    }

    w("Review").clicked.connect(function() {
        var s = stage();
        if (s !== null) { QDesktopServices.openUrl(QUrl.fromLocalFile(s.dir)); }
    });
    w("Buttons").accepted.connect(function() {
        if (state.busy) { return; }
        var f = fields();
        var missing = FeedbackCore.validate(f);
        if (missing.length > 0) {
            QMessageBox.warning(appWin, qsTr("Send Feedback"),
                missing.indexOf("summary") >= 0 ? qsTr("Please give your feedback a one-line summary.") : qsTr("Please say what happened for a bug report."));
            return;
        }
        var s = stage();
        if (s === null) { return; }
        var zip = base + "/" + FeedbackCore.zipName(SendFeedback.date(), id);
        setBusy(true);
        if (!state.closed) { w("Size").text = qsTr("Packing..."); }
        FeedbackPackage.zip(s.dir, zip, function(zr) {
            (new QDir(s.dir)).removeRecursively();
            if (!zr.ok) {
                QFile.remove(zip);
                QMessageBox.warning(appWin, qsTr("Send Feedback"), qsTr("Could not pack the report: %1").arg(zr.error));
                if (!state.closed) { updateSize(); }
                finish();
                return;
            }
            var bytes = new QFileInfo(zip).size();
            if (FeedbackCore.sizeVerdict(bytes) === "block") {
                QFile.remove(zip);
                QMessageBox.warning(appWin, qsTr("Send Feedback"),
                    qsTr("The report is %1 MB; the limit is 30 MB. Attach fewer scans.").arg((bytes / FeedbackCore.MB).toFixed(1)));
                if (!state.closed) { updateSize(); }
                finish();
                return;
            }
            var queued = FeedbackSend.queue(zip);   // the original path if it could not be moved
            if (!state.closed) { w("Size").text = qsTr("Sending..."); }
            FeedbackSend.send(queued, FeedbackConfig, function(r) {
                if (!state.closed) { dialog.accept(); }
                finish();
                if (r.ok) {
                    QMessageBox.information(appWin, qsTr("Send Feedback"), qsTr("Sent. Thank you. Reference %1.").arg(r.id));
                } else {
                    qDebug("Send Feedback: not sent: " + r.error);
                    SendFeedback.failed(queued, id, f.summary, bytes, r.error === "not-configured");
                }
            });
        });
    });

    w("ScanHint").visible = false;
    refresh();
    dialog.exec();
    state.closed = true;
    if (!state.busy) {
        cleanup();
        destrDialog(dialog);
    }
};

/** The failure dialog: a copy is saved; email it if you'd rather. */
SendFeedback.failed = function(path, id, summary, bytes, notConfigured) {
    var appWin = RMainWindowQt.getMainWindow();
    var text = "<b>" + (notConfigured ? qsTr("Sending is not configured in this build.") : qsTr("Couldn't send your feedback.")) + "</b>"
        + "<br/>" + qsTr("A copy is saved and CaveCAD will try again next time it starts.")
        + "<br/>" + qsTr("If you'd rather send it yourself, email the saved file to <b>%1</b>.").arg(FeedbackConfig.EMAIL);
    if (FeedbackCore.tooBigToEmail(bytes)) {
        text += "<br/>" + qsTr("This file is too large to email. Share it from Google Drive or Dropbox instead.");
    }
    var box = new QMessageBox(QMessageBox.Warning, qsTr("Send Feedback"), text, QMessageBox.NoButton, appWin);
    try { box.setTextFormat(Qt.RichText); } catch (e) { /* auto-detected anyway */ }
    var show = box.addButton(qsTr("Show file"), QMessageBox.ActionRole); show.objectName = "Show";
    var mail = box.addButton(qsTr("Write email"), QMessageBox.ActionRole); mail.objectName = "Mail";
    box.addButton(QMessageBox.Ok);
    // ActionRole buttons close the box too; reopen until OK
    for (;;) {
        box.exec();
        var c = box.clickedButton();
        var n = isNull(c) ? "" : String(c.objectName);
        if (n === "Show") {
            // explorer.exe exits 1 even on success: the result is ignored
            UpdateRun.run(FeedbackCommands.reveal(RS.getSystemId(), path), 10, function() {});
            continue;
        }
        if (n === "Mail") { QDesktopServices.openUrl(new QUrl(FeedbackCore.mailto(FeedbackConfig.EMAIL, id, summary))); continue; }
        break;
    }
    destrDialog(box);
};

/** After 3 failed attempts on any report: a status-bar button that reveals the outbox. */
SendFeedback.notice = function() {
    if (!FeedbackCore.needsNotice(FeedbackSend.readState())) { return; }
    var pending = FeedbackSend.pending();
    var n = pending.length;
    if (n === 0) { return; }
    var win = SendFeedback.mainWindow();
    if (win === null) { return; }
    var bar = win.statusBar();
    var text = n === 1
        ? qsTr("1 feedback report waiting to send — Show…")
        : qsTr("%1 feedback reports waiting to send — Show…").arg(n);
    var b = new QPushButton(text, bar);
    b.flat = true;
    b.clicked.connect(function() {
        var left = FeedbackSend.pending();
        if (left.length > 0) {
            // explorer.exe exits 1 even on success: the result is ignored
            UpdateRun.run(FeedbackCommands.reveal(RS.getSystemId(), left[0]), 10, function() {});
        }
        try { bar.removeWidget(b); } catch (e1) { /* hide is enough */ }
        b.visible = false;
        try { b.deleteLater(); } catch (e2) { /* parented to the bar */ }
    });
    bar.addPermanentWidget(b);
};
