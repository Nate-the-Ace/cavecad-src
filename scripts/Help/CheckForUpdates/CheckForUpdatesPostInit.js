// Startup check: a few seconds after the window is up, never blocking it
// (the fetch runs in a child process; see CcUpdateRun). Silent unless there
// is something to offer. A development build (no cavecad-build.json)
// never checks. Nothing here may throw into startup.
function postInit() {
    try {
        if (RSettings.hasQuitFlag()) { return; }
        include("scripts/Help/CheckForUpdates/CheckForUpdates.js");
        if (!RSettings.getBoolValue(UpdateCore.SETTING_AUTO, true)) { return; }
        if (CheckForUpdates.local().platform === null) { return; }
        var t = new QTimer(RMainWindowQt.getMainWindow());
        t.singleShot = true;
        t.timeout.connect(function() {
            t.deleteLater();
            try { CheckForUpdates.run(false); } catch (e) { qDebug("CaveCAD update check: " + e); }
        });
        t.start(3000);
        CheckForUpdates.startupTimer = t;
    } catch (e) {
        qWarning("CaveCAD update check (startup): " + e);
    }
}
