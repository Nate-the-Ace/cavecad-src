/**
 * ToolBarClose -- a small x on every toolbar that has been pulled out of the
 * window, so a detached toolbar can be closed without hunting for the menu that
 * brings it back.
 *
 * A floating toolbar is a bare tool window with no title bar and so no close
 * button. While one floats, an x is its first item; docked again, the x goes away.
 */

include("scripts/EAction.js");

function ToolBarClose() {
}

ToolBarClose.STRIP = 30;   // the x is this big: wide enough to hit without aiming

ToolBarClose.init = function(basePath) {
    // toolbars made after this
    if (isNull(ToolBarClose.wrapped)) {
        ToolBarClose.wrapped = true;
        var original = EAction.getToolBar;
        EAction.getToolBar = function(title, objectName, toolBarArea, category, before) {
            var tb = original.apply(EAction, arguments);
            ToolBarClose.attach(tb);
            return tb;
        };
    }
    ToolBarClose.attachAll();
    // and every one built by the time the first drawing opens
    ViewportWidget.addMdiInitFunction(function(root, di) { ToolBarClose.attachAll(); });
};

/** Every toolbar the main window has, found by the names the app gives them. */
ToolBarClose.attachAll = function() {
    var appWin = RMainWindowQt.getMainWindow();
    if (isNull(appWin)) {
        return;
    }
    var names = ToolBarClose.names(appWin);
    for (var i = 0; i < names.length; i++) {
        var tb = appWin.findChild(names[i]);
        if (!isNull(tb)) {
            ToolBarClose.attach(tb);
        }
    }
};

/** Toolbar object names: the ones the scripts create, plus the ones the actions declare. */
ToolBarClose.names = function(appWin) {
    var found = {};
    var out = [];
    var add = function(n) {
        n = String(n);
        if (n.length > 0 && found[n] !== true) {
            found[n] = true;
            out.push(n);
        }
    };
    var base = ["Edit", "File", "Reset", "Select", "Snap", "View", "Widgets", "Options", "Pen", "Cad", "Window",
        "Line", "Arc", "Circle", "Ellipse", "Polyline", "Spline", "Point", "Hatch", "Text", "Dimension", "Block",
        "Modify", "Draw", "Layer", "Information", "Projection", "IsometricView", "Help", "DrawOrder",
        "MiscDraw", "MiscModify", "MiscSelect", "MiscBlock", "MiscInformation", "MiscIO", "MiscDevelopment",
        "MyScripts", "My", "CaveSurvey"];
    for (var i = 0; i < base.length; i++) {
        add(base[i] + "ToolBar");
    }
    try {
        var acts = RGuiAction.getActions();
        for (var a = 0; a < acts.length; a++) {
            var ids = acts[a].getToolBarNames ? acts[a].getToolBarNames() : [];
            for (var k = 0; k < ids.length; k++) {
                add(ids[k]);
            }
        }
    }
    catch (e) {
    }
    return out;
};

ToolBarClose.attach = function(tb) {
    if (isNull(tb) || tb.property("ToolBarCloseDone") === true) {
        return;
    }
    if (String(tb.objectName) === "RibbonToolBar") {
        return;   // not floatable
    }
    tb.setProperty("ToolBarCloseDone", true);
    var x = new QToolButton(tb);
    x.objectName = "ToolBarCloseX";
    x.text = "\u00d7";
    x.toolTip = qsTr("Close this toolbar");
    x.autoRaise = false;
    x.setStyleSheet("QToolButton { font-size:20px; font-weight:bold; color:#e8eef5; background:#4a5663; border:1px solid #6b7886; border-radius:4px; } " +
        "QToolButton:hover { background:#d9453a; border-color:#ff8b82; color:white; }");
    x.setFixedSize(ToolBarClose.STRIP - 4, ToolBarClose.STRIP - 4);
    x.clicked.connect(function() { tb.visible = false; });
    // the x is the toolbar's own first item while it floats, so it never covers a button.
    // (A widget in a toolbar shows and hides through the action addWidget returns.)
    var act = tb.addWidget(x);
    act.objectName = "ToolBarCloseAction";
    act.visible = false;
    var apply = function() {
        // the signal's argument does not arrive as a boolean here: ask the toolbar
        var floating = tb.isFloating();
        if (floating) {
            var all = tb.actions();
            if (all.length > 1 && String(all[0].objectName) !== "ToolBarCloseAction") {
                tb.removeAction(act);
                tb.insertAction(all[0], act);
            }
        }
        act.visible = floating;
    };
    tb.topLevelChanged.connect(apply);
    apply();
};
