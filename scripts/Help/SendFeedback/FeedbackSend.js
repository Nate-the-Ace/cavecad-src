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

// Names (zip basename) of sends currently in flight, so a second call on the
// same file is refused instead of racing a duplicate POST.
FeedbackSend.busy = {};

FeedbackSend.readState = function() {
    var f = new QFile(FeedbackSend.statePath());
    if (!f.open(QIODevice.ReadOnly | QIODevice.Text)) { return {}; }
    var t = String(new QTextStream(f).readAll());
    f.close();
    var parsed;
    try { parsed = JSON.parse(t); } catch (e) { return {}; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) { return {}; }
    var out = {};
    for (var k in parsed) {
        if (!parsed.hasOwnProperty(k)) { continue; }
        var v = parsed[k];
        if (v && typeof v === "object" && !Array.isArray(v) && typeof v.failures === "number") {
            out[k] = v;
        }
    }
    return out;
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

/**
 * Moves zip into the outbox; returns the new path (or the old one if it is
 * already there). Never loses the report: if the outbox cannot be created
 * or the file cannot be moved/copied there, the original path (still
 * holding the file) is returned instead.
 */
FeedbackSend.queue = function(zip) {
    var d = FeedbackSend.outboxDir();
    if (!(new QDir()).mkpath(d)) { return zip; }
    var dest = d + "/" + String(zip).replace(/^.*[\/\\]/, "");
    if (String(new QFileInfo(zip).absoluteFilePath()) === String(new QFileInfo(dest).absoluteFilePath())) { return dest; }
    QFile.remove(dest);
    if (!QFile.rename(zip, dest)) {
        if (!QFile.copy(zip, dest)) { return zip; }
        QFile.remove(zip);
    }
    return dest;
};

FeedbackSend.idOf = function(path) {
    var m = /-([0-9a-f]{6})\.zip$/.exec(String(path));
    return m ? m[1] : "";
};

/** done({ok, id, error}) exactly once. */
FeedbackSend.send = function(path, cfg, done) {
    var name = String(path).replace(/^.*[\/\\]/, "");

    // Guard done() so it fires exactly once no matter which path below
    // reaches it (including a thrown exception inside a runner callback),
    // and always clears the busy flag when it does.
    var called = false;
    function settle(result) {
        if (called) { return; }
        called = true;
        delete FeedbackSend.busy[name];
        done(result);
    }
    function fail(err) {
        var st = FeedbackSend.readState();
        FeedbackCore.recordFailure(st, name);
        FeedbackSend.writeState(st);
        settle({ ok: false, error: err });
    }

    if (!FeedbackCore.configured(cfg)) { done({ ok: false, error: "not-configured" }); return; }
    if (FeedbackSend.busy[name]) { done({ ok: false, error: "busy" }); return; }
    if (!(new QFileInfo(path)).exists()) { done({ ok: false, error: "missing" }); return; }
    FeedbackSend.busy[name] = true;

    var sys = RS.getSystemId(), b64 = path + ".b64", out = path + ".reply";
    FeedbackSend.runner(FeedbackCommands.base64(sys, path, b64), 120, function(r1) {
        try {
            if (!r1.ok) { QFile.remove(b64); fail("encode: " + r1.error); return; }
            var url = cfg.ENDPOINT + "?k=" + encodeURIComponent(cfg.KEY) + "&id=" + FeedbackSend.idOf(path);
            // 3700s: must exceed curl's own --max-time 3600 so curl (not this
            // timeout) is what cuts off a genuinely stuck upload.
            FeedbackSend.runner(FeedbackCommands.post(sys, url, b64, out), 3700, function(r2) {
                try {
                    QFile.remove(b64);
                    var text = "";
                    var f = new QFile(out);
                    if (f.open(QIODevice.ReadOnly | QIODevice.Text)) { text = String(new QTextStream(f).readAll()); f.close(); }
                    QFile.remove(out);
                    if (!r2.ok) { fail("network: " + r2.error); return; }
                    var rep = FeedbackCore.parseReply(text);
                    if (!rep.ok) { fail(rep.error); return; }
                    if (rep.id !== FeedbackSend.idOf(path)) { fail("id-mismatch"); return; }
                    QFile.remove(path);
                    var st = FeedbackSend.readState();
                    FeedbackCore.recordSuccess(st, name);
                    FeedbackSend.writeState(st);
                    settle({ ok: true, id: rep.id });
                } catch (e2) { fail("internal: " + e2); }
            });
        } catch (e1) { fail("internal: " + e1); }
    });
};

/**
 * Sends every queued zip once, in name order, skipping any already busy
 * (in-flight elsewhere; not counted as sent or failed). Before done, prunes
 * outbox.json of entries with no matching zip, and removes stray
 * *.b64/*.reply leftovers for zips that are not currently busy.
 * done({sent, failed}).
 */
FeedbackSend.retryAll = function(cfg, done) {
    var list = FeedbackSend.pending(), i = 0, sent = 0, failed = 0;
    function finish() {
        var d = FeedbackSend.outboxDir();
        var names = {};
        FeedbackSend.pending().forEach(function(p) { names[String(p).replace(/^.*[\/\\]/, "")] = true; });
        var st = FeedbackSend.readState(), changed = false;
        for (var k in st) {
            if (st.hasOwnProperty(k) && !names.hasOwnProperty(k)) { delete st[k]; changed = true; }
        }
        if (changed) { FeedbackSend.writeState(st); }
        var dir = new QDir(d);
        ["*.zip.b64", "*.zip.reply"].forEach(function(pat) {
            dir.entryList([pat], QDir.Files, QDir.Name).forEach(function(n) {
                var zipName = n.replace(/\.(b64|reply)$/, "");
                if (!FeedbackSend.busy[zipName]) { QFile.remove(d + "/" + n); }
            });
        });
        done({ sent: sent, failed: failed });
    }
    (function next() {
        if (i >= list.length) { finish(); return; }
        var p = list[i++];
        var name = String(p).replace(/^.*[\/\\]/, "");
        if (FeedbackSend.busy[name]) { next(); return; }
        FeedbackSend.send(p, cfg, function(r) { if (r.ok) { sent++; } else { failed++; } next(); });
    })();
};
