// CheckForUpdates.js -- CaveCAD's updater UI (replaces QCAD's, which read
// a news page from qcad.org over plain HTTP). The logic lives in
// UpdateCore / UpdateDownload / UpdateApply; this file is the flow, with
// its decisions (local, loadedToolsVersion, action) kept free of UI so
// tests/updater/ui_test.js can exercise them.
//
// Engine facts this relies on (probed 2026-09-26, cavecadjsapi):
// - A QMessageBox button returned by addButton() is a fresh wrapper each
//   time it is seen: clickedButton() === button is FALSE even for the same
//   button. Buttons are told apart by objectName.
// - A QMessageBox shown with show() (not exec()) is non-modal; its finished
//   signal fires after a click, with clickedButton() set (null on Escape).
// - QProgressDialog: setCancelButton(null), labelText and windowTitle
//   properties all work. QWidget.close() returns a boolean.
// - QCoreApplication has no aboutToQuit here, so nothing can run "at quit"
//   inside CaveCAD: an update installed at quit is a detached helper that
//   waits for this process to end.

include("scripts/Help/Help.js");
include("scripts/AddOn.js");
include("CcUpdateCore.js");
include("CcUpdateCommands.js");
include("CcUpdateRun.js");
include("CcUpdateDownload.js");
include("CcUpdateApply.js");

function CheckForUpdates(guiAction) { Help.call(this, guiAction); }
CheckForUpdates.prototype = new Help();
CheckForUpdates.RELEASE_PAGE = "https://github.com/Nate-the-Ace/cavecad-src/releases/tag/latest-build";
CheckForUpdates.STARTUP_TIMEOUT_S = 5;       // spec: the startup fetch gives up after 5 s
CheckForUpdates.INTERACTIVE_TIMEOUT_S = 30;
CheckForUpdates.SETTING_FAILED = "CheckForUpdates/FailedKey";   // startup stays silent about an offer whose install failed
CheckForUpdates.busy = false;                // a check or a download is running
CheckForUpdates.promptBox = null;            // the open prompt, kept alive while shown
CheckForUpdates.pendingKey = "";             // an app update downloaded this session, installing at quit

/**
 * Preferences > General > Updates: PreferencesPage.ui's AutoCheck box is
 * saved by WidgetFactory as <page objectName>/<box objectName> =
 * CheckForUpdates/AutoCheck, the same setting the prompt's checkbox and
 * the startup check use (UpdateCore.SETTING_AUTO).
 */
CheckForUpdates.getPreferencesCategory = function() {
    return [qsTr("General"), qsTr("Updates")];
};

CheckForUpdates.prototype.beginEvent = function() {
    Help.prototype.beginEvent.call(this);
    CheckForUpdates.run(true);
    this.terminate();
};

/**
 * The CaveSurvey version the app actually loads, by the same rule as
 * AddOn.precedenceIgnores: only when BOTH copies carry a VERSION do they
 * compete, and the per-user copy wins ties. Otherwise both load, and the
 * versioned one is the one that says what is installed.
 */
CheckForUpdates.loadedToolsVersion = function(appDir, userDir) {
    var a = new QFileInfo(appDir + "/VERSION").exists(), u = new QFileInfo(userDir + "/VERSION").exists();
    var av = AddOn.readVersion(appDir), uv = AddOn.readVersion(userDir);
    if (a && u) { return AddOn.compareVersions(av, uv) > 0 ? av : uv; }
    if (a) { return av; }
    if (u) { return uv; }
    return "0";
};

/**
 * {platform, appCommit, toolsVersion}; platform null for a development
 * build (no cavecad-build.json, unreadable, or app_commit "dev"). The
 * paths default to the running app's; tests pass their own.
 */
CheckForUpdates.local = function(appPath, dataLocation) {
    appPath = appPath || RSettings.getApplicationPath();
    dataLocation = dataLocation || RSettings.getDataLocation();
    var info = { platform: null, appCommit: null, toolsVersion: "0" };
    var f = new QFile(appPath + "/cavecad-build.json");
    if (f.open(QIODevice.ReadOnly | QIODevice.Text)) {
        try {
            var j = JSON.parse(String(new QTextStream(f).readAll()));
            if (j && typeof j.platform === "string" && j.platform !== "" &&
                typeof j.app_commit === "string" && j.app_commit !== "" && j.app_commit !== "dev") {
                info.platform = j.platform;
                info.appCommit = j.app_commit;
            }
        } catch (e) {}
        f.close();
    }
    info.toolsVersion = CheckForUpdates.loadedToolsVersion(appPath + "/scripts/CaveSurvey",
                                                           dataLocation + "/scripts/CaveSurvey");
    return info;
};

/**
 * What a finished check does with decide()'s answer:
 * "prompt" (offer it), "pending" (menu only: it is already downloaded and
 * installs at quit), "upToDate" / "dev" (menu only: say so), or "silent".
 * suppressed: keys (a string or an array) the STARTUP check stays silent
 * about -- a skipped offer, or one whose last install failed; the menu
 * still offers them.
 */
CheckForUpdates.action = function(decision, interactive, suppressed, pendingKey) {
    var kind = decision ? decision.kind : "none";
    if (kind === "full" || kind === "tools") {
        var key = UpdateCore.key(decision);
        if (pendingKey && pendingKey === key) { return interactive ? "pending" : "silent"; }
        var keys = [].concat(suppressed === undefined || suppressed === null ? [] : suppressed);
        if (!interactive && keys.indexOf(key) >= 0) { return "silent"; }
        return "prompt";
    }
    if (!interactive) { return "silent"; }
    return kind === "dev" ? "dev" : "upToDate";
};

/** The helper's status file as an object, or null (absent or unreadable). */
CheckForUpdates.readStatus = function(path) {
    var f = new QFile(path);
    if (!f.open(QIODevice.ReadOnly | QIODevice.Text)) { return null; }
    var t = String(new QTextStream(f).readAll());
    f.close();
    try {
        var j = JSON.parse(t);
        return j && typeof j === "object" ? j : null;
    } catch (e) { return { result: "failed", error: "the update status file is unreadable", key: "" }; }
};

/**
 * What the next start does with the helper's status: {message, suppressKey,
 * log}. A failure is shown (non-modal) and its offer is kept out of the
 * startup check, so a helper that fails every time cannot re-offer itself
 * forever; the menu still offers it.
 */
CheckForUpdates.statusAction = function(st) {
    var none = { message: null, suppressKey: null, log: null };
    if (!st) { return none; }
    if (st.result === "ok") {
        return { message: null, suppressKey: null, log: st.error ? "CaveCAD update: " + st.error : null };
    }
    var why = String(st.error || "unknown reason");
    return { message: qsTr("The last CaveCAD update could not be installed: %1.\n\n" +
                           "Your previous CaveCAD was kept. Help > Check for Updates offers it again, " +
                           "or download it from %2").arg(why).arg(CheckForUpdates.RELEASE_PAGE),
             suppressKey: st.key ? String(st.key) : null, log: "CaveCAD update failed: " + why };
};

/** At startup: reports (once) what the last full-update helper did. */
CheckForUpdates.reportStatus = function(path) {
    path = path || UpdateApply.statusPath();
    var st = CheckForUpdates.readStatus(path);
    if (st === null) { return; }
    QFile.remove(path);
    var a = CheckForUpdates.statusAction(st);
    if (a.log) { qWarning(a.log); }
    if (a.suppressKey) { RSettings.setValue(CheckForUpdates.SETTING_FAILED, a.suppressKey); }
    if (a.message) {
        var box = new QMessageBox(RMainWindowQt.getMainWindow());
        box.setWindowTitle(qsTr("CaveCAD Update"));
        box.setIcon(QMessageBox.Warning);
        box.textFormat = Qt.PlainText;
        box.text = a.message;
        box.addButton(QMessageBox.Ok);
        box.finished.connect(function() { box.deleteLater(); });
        box.show();
    }
};

CheckForUpdates.say = function(text) {
    QMessageBox.information(RMainWindowQt.getMainWindow(), qsTr("CaveCAD Updates"), text);
};

CheckForUpdates.devText = function() {
    return qsTr("This is a development build; updates come from publish.sh.");
};

/** interactive: from the menu (always answers). false: startup (silent). */
CheckForUpdates.run = function(interactive) {
    if (CheckForUpdates.promptBox !== null) {
        if (interactive) { CheckForUpdates.promptBox.raise(); CheckForUpdates.promptBox.activateWindow(); }
        return;
    }
    if (CheckForUpdates.busy) {
        if (interactive) { CheckForUpdates.say(qsTr("An update check or download is already running.")); }
        return;
    }
    var local = CheckForUpdates.local();
    if (local.platform === null) {
        if (interactive) { CheckForUpdates.say(CheckForUpdates.devText()); }
        return;
    }
    CheckForUpdates.busy = true;
    UpdateDownload.manifest(function(r) {
        CheckForUpdates.busy = false;
        if (!r.ok) {
            if (interactive) { CheckForUpdates.say(qsTr("Could not check for updates: %1").arg(String(r.error).trim())); }
            else { qDebug("CaveCAD update check failed: " + r.error); }
            return;
        }
        var d = UpdateCore.decide(r.manifest, local);
        var what = CheckForUpdates.action(d, interactive,
            [RSettings.getStringValue(UpdateCore.SETTING_SKIP, ""), RSettings.getStringValue(CheckForUpdates.SETTING_FAILED, "")],
            CheckForUpdates.pendingKey);
        if (what === "dev") { CheckForUpdates.say(CheckForUpdates.devText()); return; }
        if (what === "pending") {
            CheckForUpdates.say(qsTr("The update is downloaded and installs when you quit CaveCAD."));
            return;
        }
        if (what === "upToDate") {
            CheckForUpdates.say(qsTr("You're up to date (app %1, tools %2).")
                .arg(String(local.appCommit).substring(0, 8)).arg(local.toolsVersion));
            return;
        }
        if (what === "prompt") { CheckForUpdates.prompt(d); }
    }, interactive ? CheckForUpdates.INTERACTIVE_TIMEOUT_S : CheckForUpdates.STARTUP_TIMEOUT_S);
};

CheckForUpdates.mb = function(bytes) { return (bytes / 1048576).toFixed(1); };

/** Non-modal: work carries on while it is open (spec, Startup check). */
CheckForUpdates.prompt = function(d) {
    var box = new QMessageBox(RMainWindowQt.getMainWindow());
    box.setWindowTitle(qsTr("CaveCAD Update"));
    box.setIcon(QMessageBox.Information);
    box.textFormat = Qt.PlainText;
    box.text = d.kind === "tools"
        ? qsTr("Cave Survey tools %1 → %2 is available.").arg(d.fromVersion).arg(d.toolsVersion)
        : qsTr("A CaveCAD app update is available (%1 MB, includes Cave Survey tools %2).")
            .arg(Math.round((d.size || 0) / 1048576)).arg(d.toolsVersion);
    var now = box.addButton(qsTr("Update now"), QMessageBox.AcceptRole);
    now.objectName = "UpdateNow";
    var later = box.addButton(qsTr("Later"), QMessageBox.RejectRole);
    later.objectName = "Later";
    var skip = box.addButton(qsTr("Skip this version"), QMessageBox.DestructiveRole);
    skip.objectName = "Skip";
    box.setDefaultButton(now);
    box.setEscapeButton(later);
    var auto = new QCheckBox(qsTr("Check for updates at startup"));
    auto.checked = RSettings.getBoolValue(UpdateCore.SETTING_AUTO, true);
    box.setCheckBox(auto);
    box.finished.connect(function() {
        RSettings.setValue(UpdateCore.SETTING_AUTO, auto.checked);
        var c = box.clickedButton();
        var which = isNull(c) ? "Later" : String(c.objectName);
        CheckForUpdates.promptBox = null;
        box.deleteLater();
        if (which === "Skip") { RSettings.setValue(UpdateCore.SETTING_SKIP, UpdateCore.key(d)); return; }
        if (which === "UpdateNow") { CheckForUpdates.applyUpdate(d); }
    });
    CheckForUpdates.promptBox = box;
    box.show();
};

CheckForUpdates.env = function() {
    return { APPIMAGE: String(QProcessEnvironment.systemEnvironment().value("APPIMAGE", "")) };
};

/** What a relaunch starts: the .app on macOS, the exe or AppImage elsewhere. */
CheckForUpdates.relaunchPath = function(sys, target) {
    if (sys === "win") { return target + "/" + new QFileInfo(QCoreApplication.applicationFilePath()).fileName(); }
    return target;
};

CheckForUpdates.applyUpdate = function(d) {
    var sys = RS.getSystemId();
    var target = null;
    if (d.kind === "full") {
        target = UpdateApply.installTarget(sys, QCoreApplication.applicationFilePath(), CheckForUpdates.env());
        var why = UpdateApply.fullUpdateBlocker(sys, target);
        if (why !== null) {
            CheckForUpdates.say(qsTr("CaveCAD can't replace itself where it is installed (%1). " +
                "The release page will open so you can download it.").arg(why));
            QDesktopServices.openUrl(new QUrl(CheckForUpdates.RELEASE_PAGE));
            return;
        }
    }
    var base = UpdateApply.tmpBase();
    UpdateApply.prune(base);
    var dir = UpdateApply.freshDir(base, "dl");
    if (dir === null) {
        CheckForUpdates.say(qsTr("The update could not be downloaded: cannot create a folder in %1").arg(base));
        return;
    }
    CheckForUpdates.busy = true;
    var progress = new QProgressDialog(qsTr("Downloading..."), "", 0, 0, RMainWindowQt.getMainWindow());
    progress.setCancelButton(null);
    progress.windowTitle = qsTr("CaveCAD Update");
    progress.minimumDuration = 0;
    progress.show();
    var total = d.size ? " / " + CheckForUpdates.mb(d.size) : "";
    var end = function() { progress.close(); progress.deleteLater(); CheckForUpdates.busy = false; };
    var discard = function() { (new QDir(dir)).removeRecursively(); };
    UpdateDownload.verified(d.asset, d.sha256, dir, function(bytes) {
        progress.labelText = qsTr("Downloading... %1%2 MB").arg(CheckForUpdates.mb(bytes)).arg(total);
    }, function(r) {
        if (!r.ok) {
            end(); discard();
            CheckForUpdates.say(qsTr("The download didn't verify; nothing was changed.\n%1\n\n%2")
                .arg(r.error).arg(CheckForUpdates.RELEASE_PAGE));
            return;
        }
        if (d.kind === "tools") {
            progress.labelText = qsTr("Installing...");
            UpdateApply.installTools(r.path, d.toolsVersion, RSettings.getDataLocation() + "/scripts", function(ir) {
                end(); discard();
                if (!ir.ok) { CheckForUpdates.say(qsTr("The update could not be installed: %1").arg(ir.error)); return; }
                CheckForUpdates.restart(null, null);
            });
            return;
        }
        end();
        CheckForUpdates.restart({ pid: QCoreApplication.applicationPid(), download: r.path, sha256: d.sha256,
            target: target, relaunch: CheckForUpdates.relaunchPath(sys, target), work: dir,
            key: UpdateCore.key(d), status: UpdateApply.statusPath() }, discard);
    });
};

/** win.close() with its answer: false when a save prompt was cancelled. */
CheckForUpdates.closeMain = function() {
    var win = RMainWindowQt.getMainWindow();
    var closed = win.close();
    return !(closed === false || (closed !== true && win.isVisible()));
};

/**
 * helper null: the tools are already installed; a restart only relaunches.
 * Otherwise a full update, verified and waiting in helper.work:
 *   Yes -- the helper is WRITTEN first (if that fails CaveCAD is still
 *          running and says so), then the main window closes (unsaved
 *          drawings can cancel that), and only then is the helper started:
 *          it waits for this process, installs and relaunches. If a save
 *          prompt is cancelled, it falls back to "No".
 *   No  -- the helper starts now in "atQuit" mode: it waits for this
 *          process with no time limit and installs when the user quits,
 *          without relaunching. The verified download is kept for it.
 */
CheckForUpdates.restart = function(helper, discard) {
    var win = RMainWindowQt.getMainWindow();
    var sys = RS.getSystemId();
    var question = helper === null
        ? qsTr("Update installed. Restart now?")
        : qsTr("Update downloaded and verified. Restart now to install it?\n\n" +
               "If you choose No, it is installed when you quit CaveCAD.");
    var yes = QMessageBox.question(win, qsTr("CaveCAD Update"), question,
        QMessageBox.Yes | QMessageBox.No) === QMessageBox.Yes;
    var o = helper;
    if (o === null) {
        if (!yes) { return; }
        var work = UpdateApply.freshDir(UpdateApply.tmpBase(), "relaunch");
        // installTarget is the FOLDER on Windows: relaunchPath turns it into the exe
        var self = QCoreApplication.applicationFilePath();
        var t = UpdateApply.installTarget(sys, self, CheckForUpdates.env());
        o = { mode: "relaunchOnly", pid: QCoreApplication.applicationPid(), work: work,
              relaunch: t === null ? self : CheckForUpdates.relaunchPath(sys, t) };
        discard = function() { if (work !== null) { (new QDir(work)).removeRecursively(); } };
        if (work === null) {
            CheckForUpdates.say(qsTr("CaveCAD could not restart itself; the update loads the next time you start it."));
            return;
        }
    } else {
        o.mode = yes ? "restart" : "atQuit";
    }
    var path = UpdateApply.writeHelper(sys, o);
    if (path === null) {
        discard();
        CheckForUpdates.say(helper === null
            ? qsTr("CaveCAD could not restart itself; the update loads the next time you start it.")
            : qsTr("The update could not be prepared; nothing was changed."));
        return;
    }
    var atQuit = function(p) {
        var r = UpdateApply.startHelper(sys, p);
        if (!r.ok) {
            discard();
            CheckForUpdates.say(qsTr("The update could not be prepared (%1); nothing was changed.").arg(r.error));
            return;
        }
        CheckForUpdates.pendingKey = o.key;
        UpdateApply.keep.push(o.work);   // prune() must leave the waiting helper's download alone
        CheckForUpdates.say(qsTr("The update will be installed when you quit CaveCAD."));
    };
    if (!yes) { atQuit(path); return; }
    if (!CheckForUpdates.closeMain()) {
        if (helper === null) { discard(); return; }
        // a save prompt was cancelled: keep the verified download and
        // install at the user's own quit instead
        QFile.remove(path);
        o.mode = "atQuit";
        var later = UpdateApply.writeHelper(sys, o);
        if (later === null) {
            discard();
            CheckForUpdates.say(qsTr("CaveCAD did not quit, so the update was not installed. " +
                "It is offered again the next time CaveCAD checks."));
            return;
        }
        atQuit(later);
        return;
    }
    var started = UpdateApply.startHelper(sys, path);
    if (!started.ok) { qWarning("CaveCAD update helper: " + started.error); }
};
