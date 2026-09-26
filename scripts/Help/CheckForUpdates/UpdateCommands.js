// UpdateCommands.js -- {program, args[, env]} for each platform program the
// updater needs. The script engine has no SHA-256, no redirect-following
// download and no zip library (measured 2026-09-26), so these do the work.
// Paths are always their own arguments (or, on Windows, an environment
// variable), never spliced into command text.

var UpdateCommands = {};

UpdateCommands.isWin = function(s) { return String(s) === "win"; };

UpdateCommands.hash = function(system, path) {
    if (UpdateCommands.isWin(system)) {
        return { program: "powershell", env: { CAVECAD_HASH_PATH: path },
            args: ["-NoProfile", "-NonInteractive", "-Command",
                "(Get-FileHash -Algorithm SHA256 -LiteralPath $env:CAVECAD_HASH_PATH).Hash"] };
    }
    if (String(system) === "osx") { return { program: "shasum", args: ["-a", "256", path] }; }
    return { program: "sha256sum", args: [path] };
};

UpdateCommands.parseHash = function(stdout) {
    var m = /([0-9a-fA-F]{64})/.exec(String(stdout === undefined || stdout === null ? "" : stdout));
    return m ? m[1].toLowerCase() : null;
};

UpdateCommands.fetch = function(system, url, out) {
    return { program: UpdateCommands.isWin(system) ? "curl.exe" : "curl",
             args: ["-fsSL", "--retry", "2", "-o", out, url] };
};

/** Linux without curl: Python's urllib follows redirects too. */
UpdateCommands.fetchFallback = function(system, url, out) {
    return { program: "python3", args: ["-c",
        "import sys, urllib.request; urllib.request.urlretrieve(sys.argv[1], sys.argv[2])", url, out] };
};

UpdateCommands.unzip = function(system, zip, dest) {
    if (String(system) === "linux") {
        return { program: "python3", args: ["-c",
            "import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])", zip, dest] };
    }
    return { program: "tar", args: ["-xf", zip, "-C", dest] };
};

/** Starts a helper that outlives CaveCAD (QProcess would kill its child). */
UpdateCommands.detach = function(system, script) {
    if (UpdateCommands.isWin(system)) {
        return { program: "cmd", args: ["/c", "start", "\"\"", "/min", "powershell",
            "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script] };
    }
    return { program: "/bin/sh", args: ["-c", "nohup /bin/sh \"$0\" >/dev/null 2>&1 &", script] };
};
