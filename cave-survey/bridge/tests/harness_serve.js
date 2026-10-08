// harness_serve.js -- headless serve loop for bridge protocol tests.
//
// Loads bridge/CsMcpBridge/CsMcpBridge.js in CaveCAD's real engine, starts
// the bridge against $TMPDIR/csmcp-test (ephemeral port, so a real bridge on
// 42283 is untouched), then pumps the event loop until the test client drops
// a "stop" file or 30s pass. Run from the repo root:
//
//   /Applications/CaveCAD.app/Contents/MacOS/CaveCAD \
//       -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart bridge/tests/harness_serve.js <repo-root>

function readWhole(path) {
    var f = new QFile(path);
    if (!f.open(QIODevice.ReadOnly | QIODevice.Text)) {
        return null;
    }
    var text = new QTextStream(f).readAll();
    f.close();
    return text;
}

// The app changes cwd, so the repo root arrives as the last CLI argument
// (same idiom as tests/js_syntax.js).
function findBridgeSource() {
    var args = RSettings.getOriginalArguments();
    for (var i = args.length - 1; i >= 0; i--) {
        var p = ("" + args[i]).replace(/\/+$/, "")
            + "/bridge/CsMcpBridge/CsMcpBridge.js";
        if (new QFileInfo(p).exists()) {
            return p;
        }
    }
    return null;
}

var srcPath = findBridgeSource();
var src = srcPath === null ? null : readWhole(srcPath);
if (src === null) {
    print("### HARNESS ERROR cannot read CsMcpBridge.js -- pass the repo root as the last argument");
} else {
    eval(src);
    CsMcpBridge.PORT = 0; // force ephemeral: never collide with a live bridge
    var dir = QDir.tempPath() + "/csmcp-test";
    if (!CsMcpBridge.start(dir)) {
        print("### HARNESS ERROR listen failed");
    } else {
        print("### SERVING port=" + CsMcpBridge.server.serverPort()
              + " dir=" + dir);
        var deadline = new Date().getTime() + 30000;
        while (new Date().getTime() < deadline
               && !new QFileInfo(dir + "/stop").exists()) {
            QCoreApplication.processEvents();
        }
        print("### HARNESS DONE");
    }
}
