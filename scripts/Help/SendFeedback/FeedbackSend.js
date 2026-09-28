// FeedbackSend.js -- every report waits in the outbox until the receiver
// has it. send() base64-encodes (Apps Script reads POST bodies as text) and
// POSTs with curl; success deletes the zip, failure counts it in
// outbox.json. Requires FeedbackCore, FeedbackCommands, CcUpdateCommands, CcUpdateRun.

var FeedbackSend = {};

FeedbackSend.runner = function(cmd, timeoutS, done) { UpdateRun.run(cmd, timeoutS, done); };
FeedbackSend.outboxDir = function() {
    return String(RSettings.getDataLocation()).replace(/[\\\/]+$/, "") + "/feedback/outbox";
};
FeedbackSend.statePath = function() { return FeedbackSend.outboxDir() + "/outbox.json"; };

FeedbackSend.readState = function() {
    var f = new QFile(FeedbackSend.statePath());
    if (!f.open(QIODevice.ReadOnly | QIODevice.Text)) { return {}; }
    var t = String(new QTextStream(f).readAll());
    f.close();
    try { return JSON.parse(t) || {}; } catch (e) { return {}; }
};
FeedbackSend.writeState = function(st) {
    (new QDir()).mkpath(FeedbackSend.outboxDir());
    var f = new QFile(FeedbackSend.statePath());
    if (f.open(QIODevice.WriteOnly | QIODevice.Truncate)) { f.write(JSON.stringify(st)); f.close(); }
};

FeedbackSend.pending = function() {
    var d = FeedbackSend.outboxDir();
    return new QDir(d).entryList(["feedback-*.zip"], QDir.Files, QDir.Name).map(function(n) { return d + "/" + n; });
};

/** Moves zip into the outbox; returns the new path (or the old one if it is already there). */
FeedbackSend.queue = function(zip) {
    var d = FeedbackSend.outboxDir();
    (new QDir()).mkpath(d);
    var dest = d + "/" + String(zip).replace(/^.*[\/\\]/, "");
    if (String(new QFileInfo(zip).absoluteFilePath()) === String(new QFileInfo(dest).absoluteFilePath())) { return dest; }
    QFile.remove(dest);
    if (!QFile.rename(zip, dest)) { QFile.copy(zip, dest); QFile.remove(zip); }
    return dest;
};

FeedbackSend.idOf = function(path) {
    var m = /-([0-9a-f]{6})\.zip$/.exec(String(path));
    return m ? m[1] : "";
};

/** done({ok, id, error}) exactly once. */
FeedbackSend.send = function(path, cfg, done) {
    var name = String(path).replace(/^.*[\/\\]/, "");
    function fail(err) {
        var st = FeedbackSend.readState();
        FeedbackCore.recordFailure(st, name);
        FeedbackSend.writeState(st);
        done({ ok: false, error: err });
    }
    if (!FeedbackCore.configured(cfg)) { done({ ok: false, error: "not-configured" }); return; }
    var sys = RS.getSystemId(), b64 = path + ".b64", out = path + ".reply";
    FeedbackSend.runner(FeedbackCommands.base64(sys, path, b64), 120, function(r1) {
        if (!r1.ok) { QFile.remove(b64); fail("encode: " + r1.error); return; }
        var url = cfg.ENDPOINT + "?k=" + encodeURIComponent(cfg.KEY) + "&id=" + FeedbackSend.idOf(path);
        // 3700s: must exceed curl's own --max-time 3600 so curl (not this
        // timeout) is what cuts off a genuinely stuck upload.
        FeedbackSend.runner(FeedbackCommands.post(sys, url, b64, out), 3700, function(r2) {
            QFile.remove(b64);
            var text = "";
            var f = new QFile(out);
            if (f.open(QIODevice.ReadOnly | QIODevice.Text)) { text = String(new QTextStream(f).readAll()); f.close(); }
            QFile.remove(out);
            if (!r2.ok) { fail("network: " + r2.error); return; }
            var rep = FeedbackCore.parseReply(text);
            if (!rep.ok) { fail(rep.error); return; }
            QFile.remove(path);
            var st = FeedbackSend.readState();
            FeedbackCore.recordSuccess(st, name);
            FeedbackSend.writeState(st);
            done({ ok: true, id: rep.id });
        });
    });
};

/** Sends every queued zip, one after another. done({sent, failed}). */
FeedbackSend.retryAll = function(cfg, done) {
    var list = FeedbackSend.pending(), i = 0, sent = 0, failed = 0;
    (function next() {
        if (i >= list.length) { done({ sent: sent, failed: failed }); return; }
        FeedbackSend.send(list[i++], cfg, function(r) { if (r.ok) { sent++; } else { failed++; } next(); });
    })();
};
