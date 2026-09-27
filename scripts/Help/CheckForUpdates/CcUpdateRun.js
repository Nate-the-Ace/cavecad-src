// CcUpdateRun.js -- runs {program, args[, env][, workingDirectory]} WITHOUT
// blocking: the answer arrives through QProcess.finished. The engine has no
// async networking, so this is how downloads and hashing stay off the UI's
// back.
//
// Measured 2026-09-26 against CaveCAD's cavecadjsapi bindings: QProcess has
// errorOccurred, setProcessEnvironment, setWorkingDirectory,
// closeWriteChannel, deleteLater and an INSTANCE startDetached() (the static
// one is undefined) that honours setProgram/setArguments/
// setProcessEnvironment/setWorkingDirectory and outlives CaveCAD; finished
// passes (code, status); kill() is asynchronous (the process is still
// Running right after it; finished follows); a QProcess created inside a
// function and referenced only by its own signal connections survives to
// fire finished even under an explicit gc(), so no keep-alive array is
// needed.
//
// QByteArray has no usable toString()/String() coercion in this engine --
// String(readAllStandardOutput()) yields the literal text "QByteArray [JS]".
// Only per-byte access (.size()/.at(i)) is reliable, so output is decoded
// that way.

var UpdateRun = {};

// After a timeout's kill(), how long to wait for finished before settling anyway.
UpdateRun.KILL_GRACE_MS = 5000;

/** QByteArray -> JS string; String(qba)/qba.toString() do not decode bytes here. */
UpdateRun.decode = function(qba) {
    var n = qba.size();
    var s = "";
    for (var i = 0; i < n; i++) { s += String.fromCharCode(qba.at(i) & 0xff); }
    return s;
};

/**
 * Inside an AppImage, AppRun points LD_LIBRARY_PATH (and QT_PLUGIN_PATH)
 * into the mounted image, and every child would inherit that: curl,
 * python3 or tar loading CaveCAD's bundled libraries, and a helper that
 * outlives the mount pointing at a vanished folder. vars: {APPIMAGE,
 * APPDIR, LD_LIBRARY_PATH, QT_PLUGIN_PATH}. Returns {set: {name: value},
 * remove: [names]}, or null when nothing needs changing.
 */
UpdateRun.cleanEnv = function(vars) {
    var appimage = String(vars.APPIMAGE || ""), appdir = String(vars.APPDIR || "").replace(/\/+$/, "");
    if (appimage === "") { return null; }
    var out = { set: {}, remove: ["QT_PLUGIN_PATH"] };
    var ld = String(vars.LD_LIBRARY_PATH || "");
    if (ld !== "") {
        var kept = ld.split(":").filter(function(e) {
            return e !== "" && !(appdir !== "" && (e === appdir || e.indexOf(appdir + "/") === 0));
        });
        if (kept.length === 0) { out.remove.push("LD_LIBRARY_PATH"); }
        else { out.set.LD_LIBRARY_PATH = kept.join(":"); }
    }
    return out;
};

UpdateRun.configure = function(p, command) {
    if (command.workingDirectory) {
        p.setWorkingDirectory(command.workingDirectory);
    }
    var env = QProcessEnvironment.systemEnvironment();
    var names = ["APPIMAGE", "APPDIR", "LD_LIBRARY_PATH", "QT_PLUGIN_PATH"], vars = {};
    for (var i = 0; i < names.length; i++) { vars[names[i]] = String(env.value(names[i], "")); }
    var clean = UpdateRun.cleanEnv(vars);
    if (!command.env && clean === null) { return; }
    if (clean !== null) {
        for (var s in clean.set) { if (clean.set.hasOwnProperty(s)) { env.insert(s, clean.set[s]); } }
        for (var r = 0; r < clean.remove.length; r++) { env.remove(clean.remove[r]); }
    }
    if (command.env) {
        for (var k in command.env) { if (command.env.hasOwnProperty(k)) { env.insert(k, command.env[k]); } }
    }
    p.setProcessEnvironment(env);
};

/**
 * done({ok, code, stdout, error}) is called exactly once. On a timeout the
 * child is killed and done waits for it to be gone (finished), so a caller
 * never deletes or retries a file the child still holds; if finished never
 * comes, done fires KILL_GRACE_MS later regardless.
 */
UpdateRun.run = function(command, timeoutS, done) {
    var p = new QProcess();
    var settled = false, timedOut = false;
    var timer = new QTimer();
    timer.singleShot = true;
    var finish = function(result) {
        if (settled) { return; }
        settled = true;
        timer.stop();
        // ALWAYS asynchronous. On Windows a program that cannot start fails
        // INSIDE p.start() (errorOccurred fires synchronously), before the
        // caller has entered its event loop; a synchronous done() there
        // quits a loop that is not running yet and the caller waits forever
        // (found on a Windows ARM64 VM, 2026-09-26; macOS reports the same
        // failure a tick later, which hid it).
        var later = new QTimer();
        later.singleShot = true;
        later.timeout.connect(function() { later.deleteLater(); done(result); });
        later.start(0);
        // p is deleted only once it is no longer running (a live QProcess's
        // destructor would block the UI waiting for it)
        if (p.state() === QProcess.NotRunning) { p.deleteLater(); }
        timer.deleteLater();
    };
    UpdateRun.configure(p, command);
    p.finished.connect(function(code, status) {
        var out = UpdateRun.decode(p.readAllStandardOutput());
        var err = UpdateRun.decode(p.readAllStandardError());
        var error = "";
        if (timedOut) {
            error = command.program + " timed out";
        } else if (status !== QProcess.NormalExit) {
            error = command.program + " crashed (exit " + code + "): " + err;
        } else if (code !== 0) {
            error = command.program + " exited " + code + ": " + err;
        }
        if (settled) { p.deleteLater(); return; }   // after a fallback settle
        finish({ ok: error === "", code: timedOut ? -1 : code, stdout: out, error: error });
    });
    if (typeof p.errorOccurred !== "undefined") {
        p.errorOccurred.connect(function(e) {
            if (e === QProcess.FailedToStart) {
                finish({ ok: false, code: -1, stdout: "", error: command.program + " would not start" });
            }
        });
    }
    timer.timeout.connect(function() {
        if (settled) { return; }
        if (!timedOut) {
            timedOut = true;
            p.kill();
            timer.start(UpdateRun.KILL_GRACE_MS);   // fallback if finished never comes
            return;
        }
        finish({ ok: false, code: -1, stdout: "", error: command.program + " timed out (and would not die)" });
    });
    timer.start((timeoutS || 60) * 1000);
    p.start(command.program, command.args);
    // no child waits on input; an open stdin pipe can hang powershell.exe
    p.closeWriteChannel();
};

/** Starts command detached (it outlives CaveCAD). Returns {ok, error}. */
UpdateRun.detach = function(command) {
    var p = new QProcess();
    p.setProgram(command.program);
    p.setArguments(command.args);
    UpdateRun.configure(p, command);
    p.setStandardInputFile(QProcess.nullDevice());
    var started = false;
    try { started = !!p.startDetached(); } catch (e) { started = false; }
    p.deleteLater();
    return started ? { ok: true, error: "" } : { ok: false, error: command.program + " would not start" };
};
