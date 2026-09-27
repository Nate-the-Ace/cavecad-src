// CcUpdateCommands.js -- {program, args[, env]} for each platform program the
// updater needs. The script engine has no SHA-256, no redirect-following
// download and no zip library (measured 2026-09-26), so these do the work.
// Paths are always their own arguments (or, on Windows, an environment
// variable), never spliced into command text.
//
// On Windows every program is an ABSOLUTE path under %SystemRoot%: resolved
// through PATH, "tar" can be MSYS/Git's GNU tar (which reads "C:" as a
// remote host and cannot unpack zips), and "curl"/"powershell" can be
// whatever a user or an installer put first. On macOS likewise /usr/bin:
// a Homebrew GNU tar first on PATH cannot read zips.

var UpdateCommands = {};

UpdateCommands.isWin = function(s) { return String(s) === "win"; };

/** %SystemRoot%, without a trailing separator. Tests replace this function. */
UpdateCommands.winRoot = function() {
    var r = "";
    try { r = String(QProcessEnvironment.systemEnvironment().value("SystemRoot", "C:\\Windows")); } catch (e) { r = ""; }
    r = r.replace(/[\\\/]+$/, "");
    return r === "" ? "C:\\Windows" : r;
};

UpdateCommands.winProgram = function(rel) { return UpdateCommands.winRoot() + "\\System32\\" + rel; };
UpdateCommands.powershell = function() { return UpdateCommands.winProgram("WindowsPowerShell\\v1.0\\powershell.exe"); };

UpdateCommands.hash = function(system, path) {
    if (UpdateCommands.isWin(system)) {
        return { program: UpdateCommands.powershell(), env: { CAVECAD_HASH_PATH: path },
            args: ["-NoProfile", "-NonInteractive", "-Command",
                "(Get-FileHash -Algorithm SHA256 -LiteralPath $env:CAVECAD_HASH_PATH).Hash"] };
    }
    if (String(system) === "osx") { return { program: "/usr/bin/shasum", args: ["-a", "256", "--", path] }; }
    return { program: "sha256sum", args: ["--", path] };
};

UpdateCommands.parseHash = function(stdout) {
    var m = /([0-9a-fA-F]{64})/.exec(String(stdout === undefined || stdout === null ? "" : stdout));
    return m ? m[1].toLowerCase() : null;
};

/**
 * https only, redirects included. opts.allowFile (tests only) also lets the
 * first URL be file://; redirects stay https-only either way. No wall-clock
 * limit of its own: curl gives up when the transfer stalls (under 1 KB/s
 * for STALL_S seconds), so a slow but moving download of a big app is not
 * cut off; the caller's timeout is only a generous overall cap.
 */
UpdateCommands.STALL_S = 60;
UpdateCommands.fetch = function(system, url, out, opts) {
    var allowFile = !!(opts && opts.allowFile);
    var program = UpdateCommands.isWin(system) ? UpdateCommands.winProgram("curl.exe")
        : (String(system) === "osx" ? "/usr/bin/curl" : "curl");
    return { program: program,
             args: ["-fsSL", "--proto", allowFile ? "=https,file" : "=https", "--proto-redir", "=https",
                    "--retry", "2", "--connect-timeout", "30",
                    "--speed-limit", "1024", "--speed-time", String(UpdateCommands.STALL_S),
                    "-o", out, url] };
};

/**
 * Linux without curl: Python's urllib follows redirects too. Same scheme
 * rule. The socket timeout is its stall detection: any single read that
 * waits longer than STALL_S fails the fetch.
 */
UpdateCommands.fetchFallback = function(system, url, out, opts) {
    var allowFile = !!(opts && opts.allowFile);
    return { program: "python3", args: ["-c",
        "import socket, sys, urllib.request\n" +
        "socket.setdefaulttimeout(float(sys.argv[4]))\n" +
        "u = sys.argv[1]\n" +
        "if not (u.startswith('https://') or (sys.argv[3] == '1' and u.startswith('file://'))):\n" +
        "    sys.exit('refusing a non-https URL')\n" +
        "urllib.request.urlretrieve(u, sys.argv[2])",
        url, out, allowFile ? "1" : "0", String(UpdateCommands.STALL_S)] };
};

/**
 * No "--" for tar: -C and -f each take the next argument verbatim, so a
 * path beginning with "-" is still read as a path (and "-xf -- zip" would
 * make "--" the archive name).
 */
UpdateCommands.unzip = function(system, zip, dest) {
    if (String(system) === "linux") {
        return { program: "python3", args: ["-c",
            "import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])", zip, dest] };
    }
    return { program: UpdateCommands.isWin(system) ? UpdateCommands.winProgram("tar.exe") : "/usr/bin/tar",
             args: ["-C", dest, "-xf", zip] };
};

/**
 * A helper that outlives CaveCAD. Start it with UpdateRun.detach
 * (QProcess::startDetached), never UpdateRun.run: a QProcess child dies with
 * CaveCAD.
 *
 * Windows: no cmd.exe (Qt escapes `start "" ...`'s empty title into `\"\"`,
 * which start then runs as the program; and cmd would parse metacharacters
 * in the path). PowerShell reads the helper's text from the file named in
 * the environment and runs it as a script block, so the path is in no
 * command text and needs no quoting. The file is UTF-8 (what QFile.write of
 * a JS string produces, measured), read as UTF-8 so a non-ASCII user folder
 * inside the script survives.
 */
UpdateCommands.detach = function(system, script) {
    if (UpdateCommands.isWin(system)) {
        return { program: UpdateCommands.powershell(), env: { CAVECAD_HELPER: script },
            args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Minimized",
                   "-Command",
                   "& ([scriptblock]::Create([IO.File]::ReadAllText($env:CAVECAD_HELPER, [Text.Encoding]::UTF8)))"] };
    }
    return { program: "/bin/sh", args: [script] };
};
