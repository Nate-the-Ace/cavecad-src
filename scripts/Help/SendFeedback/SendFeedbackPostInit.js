// Startup: one session crumb for the log, then (after 10 s, off the
// window's back) a retry of the outbox. Nothing here may throw into startup.
// Crumbs go through qDebug: qWarning quotes and escapes its text.
function postInit() {
    try {
        if (RSettings.hasQuitFlag()) { return; }
        include("scripts/Help/SendFeedback/SendFeedback.js");
        var local = {};
        try { local = CheckForUpdates.local(); } catch (e0) { local = {}; }
        var screen = "?";
        try {
            var scr = QGuiApplication.primaryScreen();
            if (!isNull(scr)) {
                var dpr = typeof scr.devicePixelRatio === "function" ? scr.devicePixelRatio() : scr.devicePixelRatio;
                screen = scr.size().width() + "x" + scr.size().height() + "@" + dpr;
            }
        } catch (e1) { screen = "?"; }
        qDebug("[crumb] session: Cave Survey " + (local.toolsVersion || "?") + ", build " + (local.appCommit || "dev")
            + ", screen " + screen);

        var win = SendFeedback.mainWindow();
        if (win === null) { return; }   // headless: no status bar, nothing to retry into
        if (FeedbackSend.pending().length === 0) { return; }
        var t = new QTimer(win);
        t.singleShot = true;
        t.timeout.connect(function() {
            t.deleteLater();
            try {
                FeedbackSend.retryAll(FeedbackConfig, function() {
                    try { SendFeedback.notice(); } catch (e3) { qWarning("Send Feedback notice: " + e3); }
                });
            } catch (e2) { qWarning("Send Feedback retry: " + e2); }
        });
        t.start(10000);
    } catch (e) {
        qWarning("Send Feedback (startup): " + e);
    }
}

