// FeedbackCommands.js -- {program, args[, env]} for the platform programs
// Send Feedback needs, in the updater's style (CcUpdateCommands.js):
// absolute programs, paths always their own argument or, on Windows, an
// environment variable. Requires CcUpdateCommands.js (winProgram, powershell).

var FeedbackCommands = {};

/** Zips the CONTENTS of dir (report.json at the archive root) into out. */
FeedbackCommands.zip = function(system, dir, out) {
    if (UpdateCommands.isWin(system)) {
        return { program: UpdateCommands.winProgram("tar.exe"), args: ["-a", "-c", "-f", out, "-C", dir, "."] };
    }
    if (String(system) === "osx") {
        // --norsrc/--noextattr/--noqtn/--noacl: without these, ditto writes
        // AppleDouble sidecar entries (._report.json, ._logs, ...) carrying
        // com.apple.provenance and other xattrs into the archive.
        return { program: "/usr/bin/ditto",
                 args: ["-c", "-k", "--norsrc", "--noextattr", "--noqtn", "--noacl", dir, out] };
    }
    return { program: "python3", args: ["-c",
        "import os, sys, zipfile\n" +
        "z = zipfile.ZipFile(sys.argv[2], 'w', zipfile.ZIP_DEFLATED)\n" +
        "for r, _, fs in os.walk(sys.argv[1]):\n" +
        "    for f in fs:\n" +
        "        p = os.path.join(r, f)\n" +
        "        z.write(p, os.path.relpath(p, sys.argv[1]))\n" +
        "z.close()", dir, out] };
};

/**
 * Base64 of file `inp` written to `out`, no line breaks except possibly a
 * trailing newline (the receiver strips whitespace).
 */
FeedbackCommands.base64 = function(system, inp, out) {
    if (UpdateCommands.isWin(system)) {
        return { program: UpdateCommands.powershell(), env: { CAVECAD_FB_IN: inp, CAVECAD_FB_OUT: out },
            args: ["-NoProfile", "-NonInteractive", "-Command",
                "[IO.File]::WriteAllText($env:CAVECAD_FB_OUT, [Convert]::ToBase64String([IO.File]::ReadAllBytes($env:CAVECAD_FB_IN)))"] };
    }
    if (String(system) === "osx") { return { program: "/usr/bin/base64", args: ["-i", inp, "-o", out] }; }
    return { program: "python3", args: ["-c",
        "import base64, sys; open(sys.argv[2], 'wb').write(base64.b64encode(open(sys.argv[1], 'rb').read()))", inp, out] };
};

/**
 * POST the file `body` to url; the reply lands in `out`. -L follows Apps
 * Script's 302 (curl turns the POST into the GET that fetches the reply).
 * No -f: a refusal still carries a JSON reply worth reading. Stalls (not
 * overall duration) are what should cut this off: a 40 MB base64 upload
 * needs only ~67 KB/s to finish inside a fixed 600s cap, so use the
 * updater's stall detection (--speed-limit/--speed-time) instead, with
 * --max-time only as a generous overall ceiling.
 */
FeedbackCommands.post = function(system, url, body, out) {
    var program = UpdateCommands.isWin(system) ? UpdateCommands.winProgram("curl.exe")
        : (String(system) === "osx" ? "/usr/bin/curl" : "curl");
    return { program: program,
             args: ["-sS", "-L", "--proto", "=https", "--proto-redir", "=https",
                    "--connect-timeout", "30",
                    "--speed-limit", "1024", "--speed-time", String(UpdateCommands.STALL_S),
                    "--max-time", "3600",
                    "-H", "Content-Type: text/plain", "--data-binary", "@" + body,
                    "-o", out, url] };
};

/**
 * Shows the file selected in Finder / Explorer; Linux opens its folder.
 * explorer.exe exits 1 even on success, so callers must ignore the result.
 */
FeedbackCommands.reveal = function(system, path) {
    if (UpdateCommands.isWin(system)) {
        // Two args, not one string: QProcess then quotes only the path
        // (needed when it contains spaces), never the "/select," switch.
        return { program: UpdateCommands.winRoot() + "\\explorer.exe",
                 args: ["/select,", String(path).replace(/\//g, "\\")] };
    }
    if (String(system) === "osx") { return { program: "/usr/bin/open", args: ["-R", path] }; }
    return { program: "xdg-open", args: [String(path).replace(/\/[^\/]*$/, "")] };
};
