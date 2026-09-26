// UpdateRun.js -- runs {program, args[, env][, workingDirectory]} WITHOUT
// blocking: the answer arrives through QProcess.finished. The engine has no
// async networking, so this is how downloads and hashing stay off the UI's
// back.
//
// Measured 2026-09-26 against CaveCAD's cavecadjsapi bindings: QProcess has
// errorOccurred, setProcessEnvironment and setWorkingDirectory; finished
// passes (code, status); a QProcess created inside a function and referenced
// only by its own signal connections survives to fire finished even under an
// explicit gc(), so no keep-alive array is needed.
//
// QByteArray has no usable toString()/String() coercion in this engine --
// String(readAllStandardOutput()) yields the literal text "QByteArray [JS]".
// Only per-byte access (.size()/.at(i)) is reliable, so output is decoded
// that way.

var UpdateRun = {};

/** QByteArray -> JS string; String(qba)/qba.toString() do not decode bytes here. */
UpdateRun.decode = function(qba) {
    var n = qba.size();
    var s = "";
    for (var i = 0; i < n; i++) { s += String.fromCharCode(qba.at(i) & 0xff); }
    return s;
};

/** done({ok, code, stdout, error}) is called exactly once. */
UpdateRun.run = function(command, timeoutS, done) {
    var p = new QProcess();
    var settled = false;
    var timer = new QTimer();
    timer.singleShot = true;
    var finish = function(result) {
        if (settled) { return; }
        settled = true;
        timer.stop();
        done(result);
    };
    if (command.workingDirectory) {
        p.setWorkingDirectory(command.workingDirectory);
    }
    if (command.env) {
        var env = QProcessEnvironment.systemEnvironment();
        for (var k in command.env) { if (command.env.hasOwnProperty(k)) { env.insert(k, command.env[k]); } }
        p.setProcessEnvironment(env);
    }
    p.finished.connect(function(code, status) {
        var out = UpdateRun.decode(p.readAllStandardOutput());
        var err = UpdateRun.decode(p.readAllStandardError());
        finish({ ok: code === 0 && status === QProcess.NormalExit, code: code,
                 stdout: out, error: code === 0 ? "" : (command.program + " exited " + code + ": " + err) });
    });
    if (typeof p.errorOccurred !== "undefined") {
        p.errorOccurred.connect(function(e) {
            if (e === QProcess.FailedToStart) {
                finish({ ok: false, code: -1, stdout: "", error: command.program + " would not start" });
            }
        });
    }
    timer.timeout.connect(function() {
        p.kill();
        finish({ ok: false, code: -1, stdout: "", error: command.program + " timed out" });
    });
    timer.start((timeoutS || 60) * 1000);
    p.start(command.program, command.args);
    return p;
};
