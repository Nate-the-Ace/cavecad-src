// CsTell.js -- saying something the caver will actually see.
//
// Part of the Cave Survey Core library.
//
// WHY NOT warning(). The global warning() in CaveCAD's script engine is
// native qWarning: it writes to the process's stderr, and a caver never
// sees stderr. Every refusal that went through it made its button look
// dead -- Sheet Setup's "save this drawing first" did exactly that
// (0.9.181.3). So a message meant for the caver goes through here:
//
//   CsTell.warn(text)  a box on the main window, and the same text in
//                      red on the command line. For a refusal or a
//                      failure the caver has to act on.
//
// Headless (tests, -no-gui) there is no main window, so both fall back
// to warning() -- which is what the engine suites already spy on.
//
// warning() itself stays for developer diagnostics the caver cannot act
// on: a panel partly refused while the add-on starts up, a listener
// that would not attach.

var CsTell = {};

/** The main window, or null headless. */
CsTell.mainWindow = function() {
    try {
        if (typeof RMainWindowQt === "undefined") {
            return null;
        }
        var win = RMainWindowQt.getMainWindow();
        return isNull(win) ? null : win;
    } catch (e) {
        return null;
    }
};

/**
 * A warning in a box on the main window, echoed red on the command
 * line. The box's title is the tool's name when the text opens with
 * one ("Survey Stats: ..."), so the box says who is talking.
 */
CsTell.warn = function(text) {
    text = String(text);
    var win = CsTell.mainWindow();
    if (win === null) {
        warning(text);
        return;
    }
    try {
        EAction.handleUserWarning(text);
    } catch (eLine) {
    }
    try {
        // Parented to the main window, never to a dialog that may be
        // closing -- see SurveyStats.js.
        QMessageBox.warning(win, CsTell.titleOf(text), text);
    } catch (eBox) {
        warning(text);
    }
};

/** "Survey Stats: no stations" -> "Survey Stats"; else "Cave Survey". */
CsTell.titleOf = function(text) {
    var m = /^([A-Z][A-Za-z0-9 ]{0,30}):\s/.exec(String(text));
    return m === null ? "Cave Survey" : m[1];
};
