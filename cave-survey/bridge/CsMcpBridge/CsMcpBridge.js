// CsMcpBridge.js -- dev-only TCP bridge that lets an MCP server (and through
// it, an AI agent) evaluate ECMAScript inside the RUNNING CaveCAD GUI.
//
// SECURITY: this add-on executes arbitrary script sent over a local socket.
// It binds 127.0.0.1 only, and it refuses to start unless the flag file
// <edition dir>/CsMcpBridge.enabled exists (edition dir = the folder holding
// the per-user "scripts" folder, i.e. ~/Library/Application Support/QCAD/
// CaveCAD). It must NEVER ship in the published CaveSurvey package or any
// CaveCAD release build. See docs/superpowers/specs/2026-08-28-mcp-bridge-design.md.
//
// Protocol: one JSON object per line, both directions (UTF-8, "\n").
//   -> {"id": 1, "op": "ping"}
//   <- {"id": 1, "ok": true, "result": "{...}"}
//   -> {"id": 2, "op": "eval", "script": "1+1"}
//   <- {"id": 2, "ok": true, "result": "2"}
//   -> {"id": 3, "op": "screenshot", "path": "/tmp/x.png", "widget": ""}
//   <- {"id": 3, "ok": true, "result": "{\"path\":...,\"width\":...}"}
// "result" is always a STRING serialized bridge-side: JSON where possible,
// toString() text otherwise -- Qt wrapper objects do not survive
// JSON.stringify, so serialization happens here, defensively.
//
// Engine facts this file leans on (probed 2026-08-28 in CaveCAD 3.33.0):
//   - QTcpServer/QTcpSocket construct and their signals fire.
//   - new QByteArray("s") bridges to SIZE 0 -- raw byte IO is unusable.
//     ALL socket IO goes through QTextStream (UTF-8 round-trips cleanly).
//   - QTextStream read-ahead can starve QTcpSocket.canReadLine(), so lines
//     are framed by reading readAll() into a JS string buffer and splitting.
//   - QTimer constructs and fires (used for the serve loop in tests only).

CsMcpBridge = {};

CsMcpBridge.VERSION = "0.1.0";
CsMcpBridge.PORT = 42283;          // "CAVE" on a phone keypad, prefixed
CsMcpBridge.MAX_RESULT = 1000000;  // cap serialized results at ~1 MB

CsMcpBridge.server = null;
CsMcpBridge.clients = [];          // hard refs: engine GC must not collect live sockets
CsMcpBridge.stateDir = null;

// Called by QCAD's add-on loader at startup. basePath is this add-on's own
// folder: <edition dir>/scripts/CsMcpBridge. Never throws -- a broken bridge
// must not break app startup.
CsMcpBridge.init = function(basePath) {
    try {
        var editionDir = new QFileInfo(basePath + "/../..").absoluteFilePath();
        if (!new QFileInfo(editionDir + "/CsMcpBridge.enabled").exists()) {
            return;
        }
        CsMcpBridge.start(editionDir);
    } catch (e) {
        // swallow: startup must survive a broken bridge
    }
};

// Starts the listener and writes <stateDir>/CsMcpBridge.port so the MCP
// server never guesses the port. Separated from init so the headless test
// harness can call it against a temp dir.
CsMcpBridge.start = function(stateDir) {
    if (CsMcpBridge.server !== null) {
        return true;
    }
    CsMcpBridge.stateDir = stateDir;
    var srv = new QTcpServer();
    var addr = new QHostAddress("127.0.0.1");
    if (!srv.listen(addr, CsMcpBridge.PORT)) {
        // fixed port taken (another instance?) -- fall back to ephemeral
        if (!srv.listen(addr, 0)) {
            return false;
        }
    }
    CsMcpBridge.server = srv;
    srv.newConnection.connect(CsMcpBridge.onNewConnection);
    CsMcpBridge.writePortFile();
    return true;
};

CsMcpBridge.writePortFile = function() {
    try {
        var pid = null;
        try {
            if (typeof QCoreApplication.applicationPid === "function") {
                pid = QCoreApplication.applicationPid();
            }
        } catch (ignore) {}
        var info = {
            port: CsMcpBridge.server.serverPort(),
            pid: pid,
            bridge: CsMcpBridge.VERSION,
            started: new Date().toISOString()
        };
        var f = new QFile(CsMcpBridge.stateDir + "/CsMcpBridge.port");
        if (f.open(QIODevice.WriteOnly | QIODevice.Text)) {
            var ts = new QTextStream(f);
            ts.writeString(JSON.stringify(info) + "\n");
            f.close();
        }
    } catch (e) {
        // port file is a convenience; the fixed port still works without it
    }
};

CsMcpBridge.onNewConnection = function() {
    try {
        while (CsMcpBridge.server.hasPendingConnections()) {
            var sock = CsMcpBridge.server.nextPendingConnection();
            if (sock === null) {
                return;
            }
            CsMcpBridge.attachClient(sock);
        }
    } catch (e) {
        // never let a bad accept kill the event loop
    }
};

CsMcpBridge.attachClient = function(sock) {
    var client = {
        sock: sock,
        ts: new QTextStream(sock),
        buf: ""
    };
    CsMcpBridge.clients.push(client);
    sock.readyRead.connect(function() {
        CsMcpBridge.onData(client);
    });
    try {
        sock.disconnected.connect(function() {
            CsMcpBridge.dropClient(client);
        });
    } catch (e) {
        // if the signal isn't bridged, stale entries just linger harmlessly
    }
};

CsMcpBridge.dropClient = function(client) {
    var i = CsMcpBridge.clients.indexOf(client);
    if (i >= 0) {
        CsMcpBridge.clients.splice(i, 1);
    }
};

// Frame lines in a JS string buffer: QTextStream.readAll() is the one
// faithful read path, and splitting here sidesteps canReadLine()'s
// device-vs-stream buffering mismatch.
CsMcpBridge.onData = function(client) {
    try {
        var chunk = client.ts.readAll();
        if (chunk === null || chunk === undefined || chunk === "") {
            return;
        }
        client.buf += chunk;
        var lines = client.buf.split("\n");
        client.buf = lines.pop(); // keep the trailing partial line
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].replace(/\r$/, "");
            if (line === "") {
                continue;
            }
            CsMcpBridge.handleLine(client, line);
        }
    } catch (e) {
        CsMcpBridge.send(client, {
            id: null, ok: false,
            error: "bridge read error: " + e
        });
    }
};

CsMcpBridge.handleLine = function(client, line) {
    var req = null;
    try {
        req = JSON.parse(line);
    } catch (e) {
        CsMcpBridge.send(client, {
            id: null, ok: false,
            error: "request is not valid JSON: " + e
        });
        return;
    }
    var id = (req && typeof req.id !== "undefined") ? req.id : null;
    var resp;
    try {
        resp = CsMcpBridge.dispatch(req);
        resp.id = id;
    } catch (e) {
        resp = {
            id: id, ok: false,
            error: String(e) + (e && e.lineNumber ? " (line " + e.lineNumber + ")" : "")
        };
    }
    CsMcpBridge.send(client, resp);
};

CsMcpBridge.dispatch = function(req) {
    switch (req.op) {
    case "ping":
        return { ok: true, result: CsMcpBridge.serialize(CsMcpBridge.pingInfo()) };
    case "eval":
        if (typeof req.script !== "string") {
            return { ok: false, error: "eval needs a 'script' string" };
        }
        var value = eval(req.script);
        return { ok: true, result: CsMcpBridge.serialize(value) };
    case "screenshot":
        return CsMcpBridge.screenshot(req);
    default:
        return { ok: false, error: "unknown op: " + req.op };
    }
};

// Headless runs hand back a NULL-WRAPPED main window: truthy, prints
// "wrapped is NULL" on use, and every method returns undefined -- so a
// null check lies. Probe with a method that must return a boolean.
CsMcpBridge.mainWindow = function() {
    try {
        var w = RMainWindowQt.getMainWindow();
        if (w === null || w === undefined) {
            return null;
        }
        var vis;
        try {
            vis = (typeof w.isVisible === "function") ? w.isVisible() : w.visible;
        } catch (e) {
            return null;
        }
        if (vis !== true && vis !== false) {
            return null; // NULL wrapper: methods return undefined
        }
        return w;
    } catch (e) {
        return null;
    }
};

CsMcpBridge.pingInfo = function() {
    var info = {
        app: "CaveCAD",
        bridge: CsMcpBridge.VERSION,
        appVersion: null,
        document: null,
        modified: null,
        headless: true
    };
    try {
        if (typeof RSettings !== "undefined"
                && typeof RSettings.getVersionString === "function") {
            info.appVersion = RSettings.getVersionString();
        }
    } catch (ignore) {}
    try {
        var win = CsMcpBridge.mainWindow();
        if (win !== null) {
            info.headless = false;
            var di = win.getDocumentInterface();
            if (di !== null && di !== undefined) {
                var doc = di.getDocument();
                info.document = doc.getFileName();
                info.modified = doc.isModified();
            }
        }
    } catch (ignore) {}
    return info;
};

CsMcpBridge.screenshot = function(req) {
    var win = CsMcpBridge.mainWindow();
    if (win === null) {
        return { ok: false, error: "no main window (headless run?)" };
    }
    var target = win;
    if (req.widget === "active") {
        try {
            var active = QApplication.activeModalWidget();
            if (active === null || active === undefined) {
                active = QApplication.activeWindow();
            }
            if (active !== null && active !== undefined) {
                target = active;
            }
        } catch (ignore) {}
    } else if (typeof req.widget === "string" && req.widget !== "") {
        var child = null;
        try {
            child = win.findChild(req.widget);
        } catch (ignore) {}
        if (child === null || child === undefined) {
            return { ok: false, error: "widget not found: " + req.widget };
        }
        target = child;
    }
    if (typeof target.grab !== "function") {
        return { ok: false, error: "widget.grab() not bridged on this build" };
    }
    var path = (typeof req.path === "string" && req.path !== "")
        ? req.path
        : QDir.tempPath() + "/cavecad-shot-" + new Date().getTime() + ".png";
    var pm = target.grab();
    if (pm === null || pm === undefined || typeof pm.save !== "function") {
        return { ok: false, error: "grab() returned nothing usable" };
    }
    if (!pm.save(path, "PNG")) {
        return { ok: false, error: "could not save PNG to " + path };
    }
    return {
        ok: true,
        result: CsMcpBridge.serialize({
            path: path,
            width: pm.width(),
            height: pm.height()
        })
    };
};

// Serialize any completion value to a string. JSON where possible; Qt
// wrappers and cyclic structures degrade to toString(). Never throws.
CsMcpBridge.serialize = function(value) {
    var s;
    if (value === undefined) {
        s = "undefined";
    } else {
        try {
            s = JSON.stringify(value);
            if (s === undefined) {
                s = String(value);
            }
        } catch (e) {
            try {
                s = String(value);
            } catch (e2) {
                s = "<unserializable>";
            }
        }
    }
    if (s.length > CsMcpBridge.MAX_RESULT) {
        s = s.substring(0, CsMcpBridge.MAX_RESULT)
            + "...<truncated at " + CsMcpBridge.MAX_RESULT + " chars>";
    }
    return s;
};

CsMcpBridge.send = function(client, resp) {
    try {
        client.ts.writeString(JSON.stringify(resp) + "\n");
        client.ts.flush();
        client.sock.flush();
    } catch (e) {
        // client went away mid-write; nothing to do
    }
};

// --- eval conveniences ------------------------------------------------------
// Tiny globals for bridge eval scripts, so every one-liner doesn't have to
// re-derive the live document. Re-resolved per call: NEVER cache a document
// across calls (a freed RDocument is undetectable and touching it segfaults).

function csDi() {
    var win = CsMcpBridge.mainWindow();
    if (win === null) {
        return null;
    }
    var di = win.getDocumentInterface();
    if (di === null || di === undefined) {
        return null;
    }
    // No open document hands back a NULL-WRAPPED interface (truthy, methods
    // return undefined) -- probe before trusting it.
    var doc;
    try {
        doc = di.getDocument();
    } catch (e) {
        return null;
    }
    if (doc === null || doc === undefined) {
        return null;
    }
    return di;
}

function csDoc() {
    var di = csDi();
    return di === null ? null : di.getDocument();
}
