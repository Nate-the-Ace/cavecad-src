// UpdateDownload.js -- fetch latest.json, and download an asset that must
// match BOTH the manifest's SHA-256 and its published .sha256 sidecar.
// Silent: a mismatch deletes the file and downloads once more; only a
// second failure comes back as ok:false. Nothing unverified is kept.

var UpdateDownload = {};
UpdateDownload.base = UpdateCore.BASE;   // tests point this at file://
UpdateDownload.TIMEOUT_S = 900;

UpdateDownload.system = function() { return RS.getSystemId(); };

/** Runs fetch, falling back to Python's urllib on Linux without curl. */
UpdateDownload.fetchTo = function(url, out, done) {
    var sys = UpdateDownload.system();
    UpdateRun.run(UpdateCommands.fetch(sys, url, out), UpdateDownload.TIMEOUT_S, function(r) {
        if (r.ok || sys !== "linux" || r.code !== -1) { done(r); return; }
        UpdateRun.run(UpdateCommands.fetchFallback(sys, url, out), UpdateDownload.TIMEOUT_S, done);
    });
};

UpdateDownload.readText = function(path) {
    var f = new QFile(path);
    if (!f.open(QIODevice.ReadOnly | QIODevice.Text)) { return null; }
    var t = String(new QTextStream(f).readAll());
    f.close();
    return t;
};

UpdateDownload.manifest = function(done) {
    var out = QDir.tempPath() + "/cavecad-latest-" + (new Date()).getTime() + ".json";
    UpdateDownload.fetchTo(UpdateDownload.base + UpdateCore.MANIFEST, out, function(r) {
        var text = r.ok ? UpdateDownload.readText(out) : null;
        QFile.remove(out);
        if (text === null) { done({ ok: false, manifest: null, error: r.error || "no manifest" }); return; }
        var m;
        try { m = JSON.parse(text); } catch (e) { done({ ok: false, manifest: null, error: "manifest is not JSON" }); return; }
        var v = UpdateCore.validate(m);
        done({ ok: v.ok, manifest: v.ok ? m : null, error: v.error });
    });
};

/** onProgress(bytesSoFar) about twice a second while downloading. */
UpdateDownload.verified = function(asset, expected, dir, onProgress, done) {
    var path = dir + "/" + asset, side = path + ".sha256";
    var attempt = function(n) {
        QFile.remove(path); QFile.remove(side);
        var poll = new QTimer();
        poll.timeout.connect(function() { onProgress(new QFileInfo(path).size()); });
        poll.start(500);
        UpdateDownload.fetchTo(UpdateDownload.base + asset, path, function(r) {
            poll.stop();
            var fail = function(err) {
                QFile.remove(path); QFile.remove(side);
                if (n < 2) { attempt(n + 1); } else { done({ ok: false, path: null, error: err, attempts: n }); }
            };
            if (!r.ok) { fail(r.error); return; }
            UpdateDownload.fetchTo(UpdateDownload.base + asset + ".sha256", side, function(rs) {
                var sidecar = rs.ok ? UpdateCore.parseSidecar(UpdateDownload.readText(side)) : null;
                UpdateRun.run(UpdateCommands.hash(UpdateDownload.system(), path), 300, function(rh) {
                    var actual = rh.ok ? UpdateCommands.parseHash(rh.stdout) : null;
                    QFile.remove(side);
                    if (actual === null) { fail("could not hash the download: " + rh.error); return; }
                    if (actual !== String(expected).toLowerCase() || actual !== sidecar) {
                        fail("checksum mismatch"); return;
                    }
                    done({ ok: true, path: path, error: "", attempts: n });
                });
            });
        });
    };
    attempt(1);
};
