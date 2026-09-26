// UpdateApply.js -- putting a VERIFIED download in place.

var UpdateApply = {};

UpdateApply.stamp = function() { return String((new Date()).getTime()); };

/** Tools-only: unpack beside the per-user CaveSurvey and swap by rename. */
UpdateApply.installTools = function(zipPath, expectedVersion, userScripts, done) {
    var staging = userScripts + "/.update-" + UpdateApply.stamp();
    var fail = function(err) { (new QDir(staging)).removeRecursively(); done({ ok: false, error: err }); };
    if (!(new QDir()).mkpath(staging)) { done({ ok: false, error: "cannot create " + staging }); return; }
    UpdateRun.run(UpdateCommands.unzip(RS.getSystemId(), zipPath, staging), 300, function(r) {
        if (!r.ok) { fail(r.error); return; }
        var fresh = staging + "/CaveSurvey";
        if (AddOn.readVersion(fresh) !== String(expectedVersion)) {
            fail("the download holds tools " + AddOn.readVersion(fresh) + ", expected " + expectedVersion);
            return;
        }
        var dest = userScripts + "/CaveSurvey", old = userScripts + "/CaveSurvey.old-" + UpdateApply.stamp();
        var hadOld = new QFileInfo(dest).exists();
        if (hadOld && !(new QDir()).rename(dest, old)) { fail("cannot move the old tools aside"); return; }
        if (!(new QDir()).rename(fresh, dest)) {
            if (hadOld) { (new QDir()).rename(old, dest); }
            fail("cannot move the new tools into place");
            return;
        }
        if (hadOld) { (new QDir(old)).removeRecursively(); }
        (new QDir(staging)).removeRecursively();
        done({ ok: true, error: "" });
    });
};

/** What a full update replaces, or null if this is not a packaged app. */
UpdateApply.installTarget = function(system, appFilePath, env) {
    var p = String(appFilePath).replace(/\\/g, "/");
    if (system === "osx") {
        var i = p.indexOf(".app/Contents/MacOS/");
        return i < 0 ? null : p.substring(0, i + 4);
    }
    if (system === "win") { return p.substring(0, p.lastIndexOf("/")); }
    var ai = env && env.APPIMAGE ? String(env.APPIMAGE) : "";
    return ai === "" ? null : ai;
};

UpdateApply.writable = function(target) {
    var parent = new QFileInfo(target).absolutePath();
    var probe = parent + "/.cavecad-write-probe-" + UpdateApply.stamp();
    var f = new QFile(probe);
    if (!f.open(QIODevice.WriteOnly)) { return false; }
    f.close();
    return QFile.remove(probe);
};

UpdateApply.q = function(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; };      // sh
UpdateApply.pq = function(s) { return "'" + String(s).replace(/'/g, "''") + "'"; };        // PowerShell

/**
 * The helper that runs after CaveCAD quits. o: {pid, download, target,
 * relaunch, relaunchOnly}. The old build is renamed aside only once the new
 * one is complete, and is put back (and relaunched) if anything fails.
 *
 * relaunchOnly (a tools-only update needs no full-app install step): just
 * wait for the pid to exit, then relaunch.
 */
UpdateApply.helperScript = function(system, o) {
    var q = UpdateApply.q;
    if (o.relaunchOnly) {
        if (system === "win") {
            return "try { Wait-Process -Id " + o.pid + " -Timeout 60 } catch {}\r\nStart-Process " + UpdateApply.pq(o.relaunch);
        }
        return "#!/bin/sh\ni=0; while kill -0 " + o.pid + " 2>/dev/null && [ $i -lt 60 ]; do sleep 1; i=$((i+1)); done\n" +
            (system === "osx" ? "open " : "nohup ") + q(o.relaunch) + (system === "osx" ? "\n" : " >/dev/null 2>&1 &\n");
    }
    if (system === "win") {
        var pq = UpdateApply.pq;
        return [
            "$ErrorActionPreference = 'Stop'",
            // started from CaveCAD's folder: stand elsewhere, or Windows
            // refuses to rename a folder that is some process's location
            "Set-Location $env:TEMP",
            "try { Wait-Process -Id " + o.pid + " -Timeout 60 } catch {}",
            "$target = " + pq(o.target) + "; $new = $target + '.new'; $old = $target + '.old'",
            "try {",
            "  if (Test-Path $new) { Remove-Item -Recurse -Force $new }",
            "  $unz = $new + '.unz'; if (Test-Path $unz) { Remove-Item -Recurse -Force $unz }",
            "  Expand-Archive -LiteralPath " + pq(o.download) + " -DestinationPath $unz",
            "  Move-Item (Join-Path $unz 'CaveCAD') $new; Remove-Item -Recurse -Force $unz",
            "  if (Test-Path $old) { Remove-Item -Recurse -Force $old }",
            "  Rename-Item $target (Split-Path $old -Leaf)",
            "  Rename-Item $new (Split-Path $target -Leaf)",
            "  Remove-Item -Recurse -Force $old",
            "} catch {",
            "  if (-not (Test-Path $target) -and (Test-Path $old)) { Rename-Item $old (Split-Path $target -Leaf) }",
            "}",
            "Start-Process " + pq(o.relaunch)
        ].join("\r\n");
    }
    var install = system === "osx" ? [
        "mnt=$(mktemp -d) || exit 1",
        "hdiutil attach -quiet -nobrowse -readonly -mountpoint \"$mnt\" " + q(o.download) + " || exit 1",
        "ditto \"$mnt/CaveCAD.app\" \"$new\"; rc=$?",
        "hdiutil detach -quiet \"$mnt\"",
        "[ $rc -eq 0 ] || exit 1"
    ] : [
        "cp " + q(o.download) + " \"$new\" && chmod +x \"$new\" || exit 1"
    ];
    return [
        "#!/bin/sh",
        "i=0; while kill -0 " + o.pid + " 2>/dev/null && [ $i -lt 60 ]; do sleep 1; i=$((i+1)); done",
        "target=" + q(o.target) + "; new=\"$target.new\"; old=\"$target.old\"",
        "rm -rf \"$new\" \"$old\"",
        "( " + install.join("; ") + " ) && mv \"$target\" \"$old\" && mv \"$new\" \"$target\" && rm -rf \"$old\"",
        "[ -e \"$target\" ] || mv \"$old\" \"$target\"",
        system === "osx" ? "open " + q(o.relaunch) : "nohup " + q(o.relaunch) + " >/dev/null 2>&1 &"
    ].join("\n") + "\n";
};

/**
 * Writes the helper script to a temp file and returns its path. Split out
 * from launchHelper so it can be tested without starting anything: the
 * plan's original launchHelper wrote the file via new QByteArray(text),
 * which is EMPTY in this engine (measured) -- plain-string f.write() is
 * required.
 */
UpdateApply.writeHelper = function(system, o) {
    var path = QDir.tempPath() + "/cavecad-update-" + UpdateApply.stamp() + (system === "win" ? ".ps1" : ".sh");
    var f = new QFile(path);
    if (!f.open(QIODevice.WriteOnly | QIODevice.Text)) { return null; }
    f.write(UpdateApply.helperScript(system, o));
    f.close();
    return path;
};

/** Writes the helper to a temp file and starts it detached. */
UpdateApply.launchHelper = function(system, o, done) {
    var path = UpdateApply.writeHelper(system, o);
    if (path === null) { done({ ok: false, error: "cannot write update helper" }); return; }
    var cmd = UpdateCommands.detach(system, path);
    // never inside the install folder the helper is about to replace
    cmd.workingDirectory = QDir.tempPath();
    UpdateRun.run(cmd, 30, done);
};
