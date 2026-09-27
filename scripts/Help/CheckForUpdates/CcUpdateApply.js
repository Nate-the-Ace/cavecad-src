// CcUpdateApply.js -- putting a VERIFIED download in place.
//
// Everything the updater writes lives under the per-user data location
// (RSettings.getDataLocation()): <data>/update-tmp/<prefix>-<unique> for
// downloads, staging and helper scripts, and <data>/update-status.json for
// the full-update helper's outcome. Never the shared system temp folder:
// on a multi-user machine another account could plant or swap files there.

var UpdateApply = {};

UpdateApply.STALE_MS = 24 * 3600 * 1000;   // update-tmp leftovers older than this are removed
UpdateApply.WAIT_S = 60;                   // "Restart now": how long the helper waits for CaveCAD to quit
UpdateApply.BUSY_S = 10;                   // how long another process from the target may take to go away

UpdateApply.keep = [];                     // folders prune() never removes (a helper waiting for quit)

UpdateApply.stamp = function() { return String((new Date()).getTime()); };

/** A name no other install (in this or another CaveCAD) will pick. */
UpdateApply.unique = function() {
    return UpdateApply.stamp() + "-" + Math.floor(Math.random() * 0xffffff).toString(16);
};

UpdateApply.dataLocation = function(dataLocation) {
    return String(dataLocation || RSettings.getDataLocation()).replace(/[\\\/]+$/, "");
};

/** <data>/update-tmp. */
UpdateApply.tmpBase = function(dataLocation) { return UpdateApply.dataLocation(dataLocation) + "/update-tmp"; };

/** <data>/update-status.json: what the last full-update helper did. */
UpdateApply.statusPath = function(dataLocation) { return UpdateApply.dataLocation(dataLocation) + "/update-status.json"; };

/**
 * Where installTools stages and parks the old copy: <dataLocation>/update-tmp,
 * beside -- never inside -- the per-user scripts root. AddOn discovery
 * recurses into that root (dot folders are not hidden on Windows), so a
 * staging or renamed-aside copy there would load every tool twice after an
 * interrupted swap. Same volume as the scripts root, so renames stay renames.
 */
UpdateApply.workDir = function(userScripts) {
    var parent = new QFileInfo(String(userScripts).replace(/[\\\/]+$/, "")).absolutePath();
    return parent + "/update-tmp";
};

/**
 * Creates base/<prefix>-<unique> and returns its path; null if it cannot,
 * INCLUDING when it already exists (QDir.mkdir fails on an existing
 * folder): a folder someone else made first is never used.
 */
UpdateApply.freshDir = function(base, prefix) {
    if (!(new QDir()).mkpath(base)) { return null; }
    var name = prefix + "-" + UpdateApply.unique();
    if (!(new QDir(base)).mkdir(name)) { return null; }
    return base + "/" + name;
};

/**
 * Removes entries of base last modified more than maxAgeMs ago (default a
 * day): what interrupted installs left. Anything younger may belong to an
 * install running right now (another CaveCAD, or a helper waiting for
 * this one to quit) and is left alone, as is any path in keep.
 */
UpdateApply.prune = function(base, maxAgeMs, keep) {
    keep = (keep || []).concat(UpdateApply.keep);
    maxAgeMs = maxAgeMs === undefined ? UpdateApply.STALE_MS : maxAgeMs;
    var dir = new QDir(base);
    if (!dir.exists()) { return; }
    // lastModified() is a QDateTime wrapper, not a JS Date; its
    // toMSecsSinceEpoch/msecsTo come back truncated to 32 bits here
    // (measured), so ages are compared in whole seconds
    var now = QDateTime.currentDateTime();
    var names = dir.entryList([], QDir.AllEntries | QDir.Hidden | QDir.System | QDir.NoDotAndDotDot, 0);
    for (var i = 0; i < names.length; i++) {
        var p = base + "/" + names[i], fi = new QFileInfo(p);
        if (keep.indexOf(p) >= 0) { continue; }
        if (fi.lastModified().secsTo(now) * 1000 <= maxAgeMs) { continue; }
        if (fi.isDir() && !fi.isSymLink()) { (new QDir(p)).removeRecursively(); } else { QFile.remove(p); }
    }
};

/**
 * Tools-only: unpack into a fresh folder of its own under the work dir and
 * swap by rename with <userScripts>/CaveSurvey. work defaults to
 * workDir(userScripts). Only this install's own folder is removed
 * afterwards (a second install running at the same time has its own), plus
 * leftovers older than a day.
 */
UpdateApply.installTools = function(zipPath, expectedVersion, userScripts, done, work) {
    work = work || UpdateApply.workDir(userScripts);
    UpdateApply.prune(work);
    var mine = UpdateApply.freshDir(work, "tools");
    if (mine === null) { done({ ok: false, error: "cannot create a folder in " + work }); return; }
    var staging = mine + "/stage";
    var fail = function(err) { (new QDir(mine)).removeRecursively(); done({ ok: false, error: err }); };
    if (!(new QDir()).mkpath(staging)) { fail("cannot create " + staging); return; }
    if (!(new QDir()).mkpath(userScripts)) { fail("cannot create " + userScripts); return; }
    UpdateRun.run(UpdateCommands.unzip(RS.getSystemId(), zipPath, staging), 300, function(r) {
        if (!r.ok) { fail(r.error); return; }
        var fresh = staging + "/CaveSurvey";
        if (AddOn.readVersion(fresh) !== String(expectedVersion)) {
            fail("the download holds tools " + AddOn.readVersion(fresh) + ", expected " + expectedVersion);
            return;
        }
        var dest = userScripts + "/CaveSurvey", old = mine + "/old";
        var hadOld = new QFileInfo(dest).exists();
        if (hadOld && !(new QDir()).rename(dest, old)) { fail("cannot move the old tools aside"); return; }
        if (!(new QDir()).rename(fresh, dest)) {
            if (hadOld) { (new QDir()).rename(old, dest); }
            fail("cannot move the new tools into place");
            return;
        }
        (new QDir(mine)).removeRecursively();
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

/**
 * Why a full update cannot replace target in place, or null if it can.
 * On Windows the target is the whole folder the exe sits in, and the
 * helper renames it away: that folder must PROVE it is a CaveCAD package
 * (its cavecad-build.json), so a CaveCAD unzipped loose into D:\Tools or
 * the Desktop is never swapped. (The helper also carries over anything the
 * new package does not have, as a second line of defence.)
 */
UpdateApply.fullUpdateBlocker = function(system, target) {
    if (target === null || target === undefined || String(target) === "") {
        return "CaveCAD is not running from a packaged download";
    }
    if (system === "win") {
        if (/^[A-Za-z]:[\\\/]?$/.test(String(target)) || (new QDir(target)).isRoot()) {
            return "CaveCAD runs from the top of a drive";
        }
        if (!new QFileInfo(target + "/cavecad-build.json").exists()) {
            return "the folder CaveCAD runs from (" + target + ") is not a CaveCAD package folder";
        }
    }
    if (system === "osx" && !new QFileInfo(target + "/Contents/Resources/cavecad-build.json").exists()) {
        return target + " is not a packaged CaveCAD";
    }
    if (!UpdateApply.writable(target)) { return "CaveCAD's location (" + target + ") is not writable"; }
    return null;
};

UpdateApply.writable = function(target) {
    var parent = new QFileInfo(target).absolutePath();
    var probe = parent + "/.cavecad-write-probe-" + UpdateApply.unique();
    var f = new QFile(probe);
    if (!f.open(QIODevice.WriteOnly)) { return false; }
    f.close();
    return QFile.remove(probe);
};

UpdateApply.q = function(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; };      // sh
// PowerShell also ends a single-quoted string at the curly quotes U+2018-U+201B
UpdateApply.pq = function(s) { return "'" + String(s).replace(/['\u2018\u2019\u201A\u201B]/g, "$&$&") + "'"; };

/**
 * The helper script. o:
 *   mode      "restart"      wait up to waitS for pid to exit, install, relaunch
 *                            (the OLD build if the install fails)
 *             "atQuit"       the user said "not now": wait for pid with NO time
 *                            limit, install, never relaunch (they chose to quit)
 *             "relaunchOnly" a tools update: wait for pid, relaunch
 *   pid, target, relaunch, work (this install's own folder, removed at the end)
 *   download, sha256 (re-checked right before the swap), key, status, stamp
 *   waitS, busyS   (default WAIT_S, BUSY_S)
 *   relaunchLine   tests only: the relaunch command, verbatim script text
 *   stageApp       tests only (macOS): a prepared .app used in place of
 *                  mounting the downloaded disk image
 *
 * Rules the helper keeps: it never swaps while CaveCAD (pid) or any other
 * process running from the target is alive; it only ever creates, and so
 * only ever deletes, <target>.new-<stamp> / .old-<stamp> (never a .old or
 * .new it did not make); the old build is moved aside only once the new
 * one is complete, and put back if the swap fails; top-level entries of
 * the old folder that the new package lacks are moved into the new one
 * before the old one is deleted; and its outcome goes to o.status.
 */
UpdateApply.helperScript = function(system, o) {
    var mode = o.mode || "restart";
    var waitS = o.waitS === undefined ? UpdateApply.WAIT_S : o.waitS;
    var stamp = o.stamp || UpdateApply.unique();
    return system === "win" ? UpdateApply.psHelper(o, mode, waitS, stamp) : UpdateApply.shHelper(system, o, mode, waitS, stamp);
};

UpdateApply.shHelper = function(system, o, mode, waitS, stamp) {
    var q = UpdateApply.q, busyS = o.busyS === undefined ? UpdateApply.BUSY_S : o.busyS;
    var relaunch = o.relaunchLine !== undefined ? o.relaunchLine
        : (system === "osx" ? "/usr/bin/open " + q(o.relaunch) : "nohup " + q(o.relaunch) + " >/dev/null 2>&1 &");
    var wait = mode === "atQuit"
        ? "while kill -0 " + o.pid + " 2>/dev/null; do sleep 1; done"
        : "i=0; while kill -0 " + o.pid + " 2>/dev/null && [ $i -lt " + waitS + " ]; do sleep 1; i=$((i+1)); done";
    if (mode === "relaunchOnly") {
        return ["#!/bin/sh", wait,
            "kill -0 " + o.pid + " 2>/dev/null || { " + relaunch + "\n}",
            "rm -rf " + q(o.work), ""].join("\n");
    }
    // any other process running from the target (a second CaveCAD, or the
    // AppImage's FUSE runtime still unmounting): its command line names
    // the target's path
    var busy = "pgrep -f -- " + (system === "osx" ? "\"$esc/\"" : "\"(^|[[:space:]])$esc([[:space:]]|\\$)\"") + " >/dev/null 2>&1";
    var L = [
        "#!/bin/sh",
        "pid=" + o.pid + "; target=" + q(o.target) + "; dl=" + q(o.download) + "; sha=" + q(String(o.sha256).toLowerCase()),
        "status=" + q(o.status) + "; key=" + q(o.key || "") + "; work=" + q(o.work),
        "new=\"$target.new-" + stamp + "\"; old=\"$target.old-" + stamp + "\"",
        "j() { printf '%s' \"$1\" | tr '\\n\\r\\t' '   ' | sed 's/\\\\/\\\\\\\\/g; s/\"/\\\\\"/g'; }",
        "say() {",
        "  printf '{\"result\":\"%s\",\"error\":\"%s\",\"key\":\"%s\",\"when\":\"%s\"}\\n' \"$1\" \"$(j \"$2\")\" \"$(j \"$key\")\" \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\" > \"$status.tmp-$$\" &&",
        "  mv -f \"$status.tmp-$$\" \"$status\"",
        "}",
        "relaunch() { " + (mode === "restart" ? relaunch : ":") + "\n}",
        "fail() { say failed \"$1\"; rm -rf \"$work\"; relaunch; exit 1; }",
        wait,
        "if kill -0 \"$pid\" 2>/dev/null; then say failed 'CaveCAD did not quit'; rm -rf \"$work\"; exit 1; fi",
        "esc=$(printf '%s' \"$target\" | sed 's/[][\\\\.*^$+?(){}|]/\\\\&/g')",
        "if command -v pgrep >/dev/null 2>&1; then",
        "  n=0; while " + busy + "; do",
        "    [ $n -ge " + busyS + " ] && fail \"another program is still running from $target\"",
        "    sleep 1; n=$((n+1))",
        "  done",
        "fi",
        "[ -f \"$dl\" ] || fail 'the download is missing'",
        system === "osx"
            ? "h=$(/usr/bin/shasum -a 256 < \"$dl\" | cut -d' ' -f1)"
            : "if command -v sha256sum >/dev/null 2>&1; then h=$(sha256sum < \"$dl\" | cut -d' ' -f1); else h=$(shasum -a 256 < \"$dl\" | cut -d' ' -f1); fi",
        "[ \"$h\" = \"$sha\" ] || fail 'the download no longer matches its checksum'",
        "{ [ -e \"$new\" ] || [ -e \"$old\" ]; } && fail \"$new or $old already exists\""
    ];
    if (system === "osx") {
        if (o.stageApp !== undefined) {
            L.push("/usr/bin/ditto " + q(o.stageApp) + " \"$new\" || { rm -rf \"$new\"; fail 'could not copy the new CaveCAD'; }");
        } else {
            L.push(
                "mnt=$(mktemp -d \"$work/mnt.XXXXXX\") || fail 'could not make a mount point'",
                "/usr/bin/hdiutil attach -quiet -nobrowse -readonly -mountpoint \"$mnt\" \"$dl\" || fail 'could not open the disk image'",
                "/usr/bin/ditto \"$mnt/CaveCAD.app\" \"$new\"; rc=$?",
                "/usr/bin/hdiutil detach -quiet \"$mnt\" || /usr/bin/hdiutil detach -quiet -force \"$mnt\"",
                "[ $rc -eq 0 ] || { rm -rf \"$new\"; fail 'could not copy the new CaveCAD'; }");
        }
    } else {
        L.push("{ cp \"$dl\" \"$new\" && chmod +x \"$new\"; } || { rm -f \"$new\"; fail 'could not copy the new CaveCAD'; }");
    }
    L.push(
        "mv \"$target\" \"$old\" || { rm -rf \"$new\"; fail 'could not move the old CaveCAD aside'; }",
        "if [ -e \"$target\" ]; then rm -rf \"$new\"; fail \"$target reappeared; the previous CaveCAD is at $old\"; fi",
        "if ! mv \"$new\" \"$target\"; then mv \"$old\" \"$target\"; rm -rf \"$new\"; fail 'could not put the new CaveCAD in place'; fi",
        // user files: whatever the old folder has that the new one lacks
        "note=''",
        "if [ -d \"$old\" ]; then",
        "  for e in \"$old\"/* \"$old\"/.[!.]* \"$old\"/..?*; do",
        "    { [ -e \"$e\" ] || [ -L \"$e\" ]; } || continue",
        "    b=${e##*/}",
        "    { [ -e \"$target/$b\" ] || [ -L \"$target/$b\" ]; } || mv \"$e\" \"$target/$b\" || note=\"could not carry $b over; the previous CaveCAD is at $old\"",
        "  done",
        "fi",
        "if [ -z \"$note\" ]; then rm -rf \"$old\" || note=\"the previous CaveCAD is left at $old\"; fi",
        "say ok \"$note\"",
        "rm -rf \"$work\"",
        "relaunch",
        "exit 0",
        "");
    return L.join("\n");
};

UpdateApply.psHelper = function(o, mode, waitS, stamp) {
    var pq = UpdateApply.pq, busyS = o.busyS === undefined ? UpdateApply.BUSY_S : o.busyS;
    var relaunch = o.relaunchLine !== undefined ? o.relaunchLine : "Start-Process -FilePath " + pq(o.relaunch);
    var wait = mode === "atQuit"
        ? "$p = Get-Process -Id " + o.pid + " -ErrorAction SilentlyContinue; if ($p) { $p.WaitForExit() }"
        : "$p = Get-Process -Id " + o.pid + " -ErrorAction SilentlyContinue; if ($p) { [void]$p.WaitForExit(" + (waitS * 1000) + ") }";
    var alive = "(Get-Process -Id " + o.pid + " -ErrorAction SilentlyContinue)";
    var head = [
        "$ErrorActionPreference = 'Stop'",
        // started from CaveCAD's folder: stand elsewhere, or Windows
        // refuses to rename a folder that is some process's location
        "Set-Location -LiteralPath ([IO.Path]::GetTempPath())",
        "$work = " + pq(o.work)
    ];
    if (mode === "relaunchOnly") {
        return head.concat([
            wait,
            "if (-not " + alive + ") { " + relaunch + " }",
            "try { Remove-Item -LiteralPath $work -Recurse -Force } catch {}"
        ]).join("\r\n") + "\r\n";
    }
    return head.concat([
        "$target = [IO.Path]::GetFullPath(" + pq(o.target) + ").TrimEnd('\\')",
        "$dl = " + pq(o.download) + "; $sha = " + pq(String(o.sha256).toLowerCase()),
        "$status = " + pq(o.status) + "; $key = " + pq(o.key || ""),
        "$new = $target + '.new-" + stamp + "'; $old = $target + '.old-" + stamp + "'; $unz = $target + '.unz-" + stamp + "'",
        "function Say($result, $err) {",
        "  $j = [ordered]@{ result = $result; error = [string]$err; key = $key; when = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress",
        "  $tmp = $status + '.tmp-' + $PID",
        "  [IO.File]::WriteAllText($tmp, $j, (New-Object Text.UTF8Encoding $false))",
        "  Move-Item -LiteralPath $tmp -Destination $status -Force",
        "}",
        "function Relaunch { " + (mode === "restart" ? relaunch : "") + " }",
        "function Fail($err) {",
        "  try { Say 'failed' $err } catch {}",
        "  try { Remove-Item -LiteralPath $work -Recurse -Force } catch {}",
        "  try { Relaunch } catch {}",
        "  exit 1",
        "}",
        wait,
        "if (" + alive + ") {",
        "  try { Say 'failed' 'CaveCAD did not quit' } catch {}",
        "  try { Remove-Item -LiteralPath $work -Recurse -Force } catch {}",
        "  exit 1",
        "}",
        "try {",
        // any other process running from the target (a second CaveCAD)
        "  $prefix = $target + '\\'; $n = 0",
        "  while ($true) {",
        "    $busy = @(Get-Process | Where-Object { try { $_.Path -and $_.Path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) } catch { $false } })",
        "    if ($busy.Count -eq 0) { break }",
        "    if ($n -ge " + busyS + ") { Fail ('another program is still running from ' + $target + ' (' + $busy[0].ProcessName + ')') }",
        "    Start-Sleep -Seconds 1; $n++",
        "  }",
        "  if (-not (Test-Path -LiteralPath $dl -PathType Leaf)) { Fail 'the download is missing' }",
        "  $h = (Get-FileHash -Algorithm SHA256 -LiteralPath $dl).Hash.ToLowerInvariant()",
        "  if ($h -ne $sha) { Fail 'the download no longer matches its checksum' }",
        "  foreach ($x in @($new, $old, $unz)) { if (Test-Path -LiteralPath $x) { Fail ($x + ' already exists') } }",
        "  Expand-Archive -LiteralPath $dl -DestinationPath $unz",
        "  $src = Join-Path $unz 'CaveCAD'",
        "  if (-not (Test-Path -LiteralPath (Join-Path $src 'cavecad-build.json'))) {",
        "    Remove-Item -LiteralPath $unz -Recurse -Force; Fail 'the download is not a CaveCAD package'",
        "  }",
        "  Move-Item -LiteralPath $src -Destination $new",
        "  Remove-Item -LiteralPath $unz -Recurse -Force",
        "} catch {",
        "  $e = $_.Exception.Message",
        "  foreach ($x in @($new, $unz)) { if (Test-Path -LiteralPath $x) { try { Remove-Item -LiteralPath $x -Recurse -Force } catch {} } }",
        "  Fail ('could not unpack the new CaveCAD: ' + $e)",
        "}",
        "$moved = $false",
        "try {",
        "  Rename-Item -LiteralPath $target -NewName ([IO.Path]::GetFileName($old))",
        "  $moved = $true",
        "  if (Test-Path -LiteralPath $target) { throw ($target + ' reappeared') }",
        "  Rename-Item -LiteralPath $new -NewName ([IO.Path]::GetFileName($target))",
        "} catch {",
        "  $e = $_.Exception.Message",
        "  if ($moved -and -not (Test-Path -LiteralPath $target)) { try { Rename-Item -LiteralPath $old -NewName ([IO.Path]::GetFileName($target)) } catch {} }",
        "  if (Test-Path -LiteralPath $new) { try { Remove-Item -LiteralPath $new -Recurse -Force } catch {} }",
        "  Fail ('could not swap in the new CaveCAD: ' + $e)",
        "}",
        // user files: whatever the old folder has that the new one lacks
        "$note = ''",
        "foreach ($e in @(Get-ChildItem -LiteralPath $old -Force)) {",
        "  $n = $e.Name; $dest = Join-Path $target $n",
        "  if (-not (Test-Path -LiteralPath $dest)) {",
        "    try { Move-Item -LiteralPath $e.FullName -Destination $dest } catch { $note = 'could not carry ' + $n + ' over; the previous CaveCAD is at ' + $old }",
        "  }",
        "}",
        "if ($note -eq '') { try { Remove-Item -LiteralPath $old -Recurse -Force } catch { $note = 'the previous CaveCAD is left at ' + $old } }",
        "try { Say 'ok' $note } catch {}",
        "try { Remove-Item -LiteralPath $work -Recurse -Force } catch {}",
        "Relaunch",
        "exit 0"
    ]).join("\r\n") + "\r\n";
};

/**
 * Writes the helper into o.work (this install's own per-user folder) and
 * returns its path, or null. Plain-string f.write(): new QByteArray(text)
 * is EMPTY in this engine (measured).
 */
UpdateApply.writeHelper = function(system, o) {
    var path = o.work + "/helper-" + UpdateApply.unique() + (system === "win" ? ".ps1" : ".sh");
    var f = new QFile(path);
    // no QIODevice.Text: the PowerShell text already has its \r\n
    if (!f.open(QIODevice.WriteOnly)) { return null; }
    f.write(UpdateApply.helperScript(system, o));
    f.close();
    if (new QFileInfo(path).size() <= 0) { QFile.remove(path); return null; }
    return path;
};

/** Starts a written helper detached (it outlives CaveCAD). {ok, error}. */
UpdateApply.startHelper = function(system, path) {
    var cmd = UpdateCommands.detach(system, path);
    // never inside the install folder the helper is about to replace
    cmd.workingDirectory = new QFileInfo(path).absolutePath();
    return UpdateRun.detach(cmd);
};
