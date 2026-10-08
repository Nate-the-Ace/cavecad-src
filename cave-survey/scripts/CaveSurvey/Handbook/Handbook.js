// Handbook.js
//
// QCAD add-on tool: the documentation, inside the application.
//
//   Cave Survey > Handbook   (or type "hb")
//
// WHO THIS IS FOR. A student in a classroom with no second screen, no
// network, and no idea what "LRUD" means. Every page ships with the
// add-on; nothing is fetched, so the handbook works in a cave hut with
// no signal exactly as it works on a desk.
//
// ONE PANE AT A TIME, and that is the layout decision. A dock column is
// narrow. A contents tree pinned above the page would take a third of
// the height a screenshot needs, so the contents is a PLACE you go --
// the Contents button at the foot -- and the back arrow brings the page
// you were reading back. Everything else is reading room.
//
// LINKS ARE OURS, NOT QTextBrowser's. openLinks is false and every
// anchor comes back through anchorClicked, so a page link, a contents
// row and the ? button on another panel all arrive at one navigate()
// and one history stack. The alternative -- letting the widget follow
// setSource() and keeping its history too -- gives two histories that
// disagree the first time a ? button jumps in from outside.
//
// See docs/superpowers/specs/2026-09-13-handbook-design.md.

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

var csHandbookDock;

function Handbook(guiAction) {
    EAction.call(this, guiAction);
}

Handbook.prototype = new EAction();

/** The page a cold open lands on. */
Handbook.HOME = "start-here";

Handbook.buildDock = function(appWin) {
    var dock = new QDockWidget(qsTr("Handbook"), appWin);
    // Without an objectName restoreState() cannot identify the dock and
    // silently forgets where it was.
    dock.objectName = "CaveSurveyHandbookDock";

    // `history` is the ids visited, `at` the position in it. Back walks
    // `at` down rather than popping, so a page reached by going back is
    // still on the stack.
    var w = { history: [], at: -1, contents: false };
    var body = new QWidget(dock);
    var layout = new QVBoxLayout();
    layout.setContentsMargins(4, 4, 4, 4);
    layout.setSpacing(4);

    var top = new QHBoxLayout();
    w.backButton = new QPushButton(qsTr("<"));
    w.backButton.toolTip = qsTr("Back to the page you were reading.");
    w.backButton.enabled = false;
    try {
        w.backButton.setMaximumWidth(28);
    } catch (eBackWidth) {
    }
    top.addWidget(w.backButton, 0, 0);
    w.crumb = new QLabel("");
    w.crumb.wordWrap = false;
    top.addWidget(w.crumb, 1, 0);
    layout.addLayout(top, 0);

    w.view = new QTextBrowser();
    w.view.readOnly = true;
    try {
        // A first run has no saved dock size, so the panel claims
        // whatever its contents ask for -- and a QTextBrowser asks for
        // very little. Measured live at 231 px tall, which is three
        // lines of a page: enough to look broken.
        w.view.setMinimumHeight(320);
        w.view.setMinimumWidth(260);
    } catch (eSize) {
    }
    try {
        w.view.openLinks = false;
        w.view.openExternalLinks = false;
    } catch (eLinks) {
        // a bridge that refuses the properties follows links itself;
        // navigate() still runs for everything that arrives by button
    }
    layout.addWidget(w.view, 1, 0);

    var foot = new QHBoxLayout();
    w.contentsButton = new QPushButton(qsTr("Contents"));
    w.contentsButton.toolTip = qsTr("Every page, grouped the way the " +
        "Cave Survey menu is.");
    foot.addWidget(w.contentsButton, 0, 0);
    w.search = new QLineEdit();
    try {
        w.search.placeholderText = qsTr("Search");
    } catch (ePlace) {
    }
    w.search.toolTip = qsTr("Type a word and press Return. Pages whose " +
        "TITLE matches come first.");
    foot.addWidget(w.search, 1, 0);
    layout.addLayout(foot, 0);

    body.setLayout(layout);
    dock.setWidget(body);
    // No ? on the Handbook -- it IS the help -- so it asks for the
    // scroll area itself rather than getting it through attachHelp.
    CsPanel.makeScrollable(dock);
    Handbook.widgets = w;

    w.backButton.clicked.connect(function() {
        Handbook.back();
    });
    w.contentsButton.clicked.connect(function() {
        Handbook.showContents();
    });
    w.search.returnPressed.connect(function() {
        Handbook.runSearch();
    });
    w.view.anchorClicked.connect(function(url) {
        Handbook.followLink(url);
    });

    // A dock shown by restoreState() or the window menu's panel toggle
    // never passes through open(), so it came up blank. The first time it
    // is seen with nothing read yet, it lands on the home page.
    dock.visibilityChanged.connect(function(shown) {
        // a hidden panel has no business redrawing frames
        try {
            var t = Handbook.widgets.clipTimer;
            if (!isNull(t) && Handbook.widgets.clips.length > 0) {
                if (shown) {
                    t.start();
                } else {
                    t.stop();
                }
            }
        } catch (eClipVis) {
        }
        if (shown && Handbook.widgets.history.length === 0) {
            Handbook.open(Handbook.HOME);
        }
    });

    appWin.addDockWidget(Qt.RightDockWidgetArea, dock);
    return dock;
};

Handbook.ensureDock = function() {
    if (isNull(csHandbookDock)) {
        csHandbookDock = Handbook.buildDock(RMainWindowQt.getMainWindow());
    }
    return csHandbookDock;
};

/**
 * Open the handbook at a page, building the dock if this is the first
 * time. The one entry point every caller uses -- the menu action, the
 * ? buttons on the other panels, and the tests.
 */
Handbook.open = function(pageId) {
    var dock = Handbook.ensureDock();
    dock.visible = true;
    try {
        dock.raise();
    } catch (eRaise) {
    }
    var id = isNull(pageId) ? Handbook.HOME : String(pageId);
    if (CsHandbook.page(id) === null) {
        id = Handbook.HOME;
    }
    if (CsHandbook.page(id) === null) {
        Handbook.showMissing();
        return;
    }
    Handbook.navigate(id);
};

/** Show a page and push it onto the history. */
Handbook.navigate = function(pageId) {
    var w = Handbook.widgets;
    if (isNull(w)) {
        return;
    }
    var page = CsHandbook.page(pageId);
    if (page === null) {
        return;
    }
    w.history = w.history.slice(0, w.at + 1);
    w.history.push(page.id);
    w.at = w.history.length - 1;
    Handbook.render(page);
};

/** Step back one place in the history. */
Handbook.back = function() {
    var w = Handbook.widgets;
    if (isNull(w) || w.at <= 0) {
        return;
    }
    w.at -= 1;
    var page = CsHandbook.page(w.history[w.at]);
    if (page !== null) {
        Handbook.render(page);
    }
};

/**
 * Put a page in the view.
 *
 * searchPaths is what makes <img src="x.png"> resolve: QTextBrowser
 * looks a relative resource up against each of them in turn, so pages
 * name their images by filename alone and never carry a path that
 * would break when the handbook is installed somewhere else.
 */
Handbook.render = function(page) {
    var w = Handbook.widgets;
    var root = CsHandbook.index() === null ? null : CsHandbook.index().root;
    if (root === null) {
        Handbook.showMissing();
        return;
    }
    var html = CsHandbook.readText(root + "/pages/" + page.file);
    if (html === null) {
        w.view.plainText = qsTr("This page is missing from the " +
            "handbook: ") + page.file;
        return;
    }
    try {
        w.view.searchPaths = [root + "/images", root + "/pages"];
    } catch (ePaths) {
    }
    Handbook.setHtml(html + Handbook.nextLink(page.id));
    Handbook.startClips(html, root);
    w.contents = false;
    w.crumb.text = Handbook.crumbFor(page);
    w.backButton.enabled = w.at > 0;
};

/**
 * ANIMATED IMAGES. QTextBrowser draws a GIF's first frame and stops, and
 * this engine has neither QMovie nor a usable addResource (its QVariant
 * argument never converts), so a clip is played by hand:
 *
 *   1. QImageReader decodes every frame and its delay.
 *   2. The frames are written once to a cache folder as PNGs, because a
 *      document can only be handed an image by a name it can resolve.
 *   3. A QTimer rewrites the image's NAME in place -- the character
 *      format at the image's position -- so the page never reloads and
 *      the scroll position never moves.
 *
 * Every step is allowed to fail. A page whose clip cannot be played
 * simply keeps the first frame, which is what it showed before.
 */
Handbook.CLIP_MAX_FRAMES = 240;
Handbook.CLIP_TICK_MS = 20;
// QTextFormat::ImageName; the enum is not exposed to script.
Handbook.IMAGE_NAME = 0x5000;

Handbook.stopClips = function() {
    var w = Handbook.widgets;
    if (isNull(w) || isNull(w.clipTimer)) {
        return;
    }
    try {
        w.clipTimer.stop();
    } catch (eStop) {
    }
    w.clips = [];
};

/** Frames for one gif, as { names: [...], delays: [ms...] }, or null. */
Handbook.decodeClip = function(gifPath) {
    var info = new QFileInfo(gifPath);
    if (!info.exists()) {
        return null;
    }
    var key = String(info.fileName()).replace(/\.gif$/i, "") + "_" +
        info.size();
    var dir = QDir.tempPath() + "/cavecad-handbook-clips";
    QDir.root().mkpath(dir);
    var reader = new QImageReader(gifPath);
    var names = [];
    var delays = [];
    while (names.length < Handbook.CLIP_MAX_FRAMES) {
        var delay = reader.nextImageDelay();
        var frame = reader.read();
        if (frame.isNull()) {
            break;
        }
        var name = key + "_f" + (names.length < 10 ? "00" :
            names.length < 100 ? "0" : "") + names.length + ".png";
        if (!new QFileInfo(dir + "/" + name).exists()) {
            frame.save(dir + "/" + name, "PNG");
        }
        names.push(name);
        delays.push(delay > 0 ? delay : 100);
    }
    if (names.length < 2) {
        return null;
    }
    return { names: names, delays: delays, dir: dir };
};

/** Character position of the image named `name` in the view, or -1. */
Handbook.findImage = function(doc, name) {
    var cursor = new QTextCursor(doc);
    var n = doc.characterCount();
    for (var p = 0; p < n; p++) {
        cursor.setPosition(p);
        cursor.setPosition(p + 1, QTextCursor.KeepAnchor);
        var f = cursor.charFormat();
        if (f.isImageFormat() &&
            String(f.property(Handbook.IMAGE_NAME)) === name) {
            return p;
        }
    }
    return -1;
};

Handbook.startClips = function(html, root) {
    var w = Handbook.widgets;
    w.clips = [];
    var names = CsHandbook.clipNames(html);
    if (names.length === 0) {
        return;
    }
    try {
        var doc = w.view.document;
        var dirs = [];
        for (var i = 0; i < names.length; i++) {
            var clip = Handbook.decodeClip(root + "/images/" + names[i]);
            if (clip === null) {
                continue;
            }
            var at = Handbook.findImage(doc, names[i]);
            if (at < 0) {
                continue;
            }
            clip.src = names[i];
            clip.at = at;
            clip.frame = 0;
            clip.due = 0;
            w.clips.push(clip);
            dirs.push(clip.dir);
        }
        if (w.clips.length === 0) {
            return;
        }
        w.view.searchPaths = [root + "/images", root + "/pages", dirs[0]];
        if (isNull(w.clipTimer)) {
            w.clipTimer = new QTimer(w.view);
            w.clipTimer.interval = Handbook.CLIP_TICK_MS;
            w.clipTimer.timeout.connect(function() {
                Handbook.tickClips();
            });
        }
        w.clipTimer.start();
    } catch (eClips) {
        w.clips = [];
    }
};

Handbook.tickClips = function() {
    var w = Handbook.widgets;
    var now = new Date().getTime();
    try {
        var doc = w.view.document;
        for (var i = 0; i < w.clips.length; i++) {
            var c = w.clips[i];
            if (now < c.due) {
                continue;
            }
            var cursor = new QTextCursor(doc);
            cursor.setPosition(c.at);
            cursor.setPosition(c.at + 1, QTextCursor.KeepAnchor);
            var fmt = cursor.charFormat();
            fmt.setProperty(Handbook.IMAGE_NAME, c.names[c.frame]);
            cursor.setCharFormat(fmt);
            c.due = now + c.delays[c.frame];
            c.frame = (c.frame + 1) % c.names.length;
        }
    } catch (eTick) {
        // a frame that will not draw ends the playback, not the panel
        Handbook.stopClips();
    }
};

/** The "Next:" line every page ends on, or "" at the end. */
Handbook.nextLink = function(pageId) {
    var next = CsHandbook.next(pageId);
    if (next === null) {
        return "";
    }
    var page = CsHandbook.page(next);
    return "<p style=\"margin-top:14px\">" + qsTr("Next:") + " <a href=\"" +
        next + ".html\">" + CsPanel.escapeHtml(page.title) + "</a></p>";
};

/** The breadcrumb above a page: its class or stage, then its title. */
Handbook.crumbFor = function(page) {
    var where = "";
    // The welcome page is not a lesson and does not want a crumb
    // saying so: it is where the handbook starts.
    if (page.id === Handbook.HOME) {
        return page.title;
    }
    if (page["class"] === "tool" && !isNull(CsHandbook.STAGES[page.stage])) {
        where = CsHandbook.STAGES[page.stage];
    } else if (page["class"] === "task") {
        where = qsTr("How do I...");
    } else if (page["class"] === "concept") {
        where = qsTr("What the words mean");
    } else if (page["class"] === "process") {
        where = qsTr("Lessons");
    }
    if (where === "") {
        return page.title;
    }
    return where + "  >  " + page.title;
};

/** The contents: every page, grouped, as one generated page. */
Handbook.showContents = function() {
    var w = Handbook.widgets;
    if (CsHandbook.index() === null) {
        Handbook.showMissing();
        return;
    }
    var out = ["<h2>" + qsTr("Contents") + "</h2>"];
    var stages = CsHandbook.stages();
    for (var s = 0; s < stages.length; s++) {
        out.push("<h3>" + CsPanel.escapeHtml(stages[s].title) + "</h3><ul>");
        out.push(Handbook.listOf(stages[s].pages));
        out.push("</ul>");
    }
    var groups = [
        { cls: "task", title: qsTr("How do I...") },
        { cls: "concept", title: qsTr("What the words mean") },
        { cls: "process", title: qsTr("Lessons") }
    ];
    for (var g = 0; g < groups.length; g++) {
        var pages = CsHandbook.ofClass(groups[g].cls);
        if (pages.length === 0) {
            continue;
        }
        out.push("<h3>" + CsPanel.escapeHtml(groups[g].title) + "</h3><ul>");
        out.push(Handbook.listOf(pages));
        out.push("</ul>");
    }
    Handbook.setHtml(out.join(""));
    w.contents = true;
    w.crumb.text = qsTr("Contents");
    w.backButton.enabled = w.at >= 0;
};

/** <li> rows for a list of page records. */
Handbook.listOf = function(pages) {
    var rows = [];
    for (var i = 0; i < pages.length; i++) {
        rows.push("<li><a href=\"" + pages[i].id + ".html\">" +
            CsPanel.escapeHtml(pages[i].title) + "</a></li>");
    }
    return rows.join("");
};

/** Run the search box and show what it found. */
Handbook.runSearch = function() {
    var w = Handbook.widgets;
    var text = String(w.search.text).trim();
    if (text === "") {
        return;
    }
    var hits = CsHandbook.search(text);
    if (hits.length === 1) {
        Handbook.navigate(hits[0]);
        return;
    }
    var out = ["<h2>" + CsPanel.escapeHtml(text) + "</h2>"];
    if (hits.length === 0) {
        out.push("<p>" + qsTr("No page mentions that. Try a word that " +
            "would be on the page rather than one from the cave.") +
            "</p>");
    } else {
        out.push("<ul>");
        for (var i = 0; i < hits.length; i++) {
            out.push("<li><a href=\"" + hits[i] + ".html\">" +
                CsPanel.escapeHtml(CsHandbook.page(hits[i]).title) +
                "</a></li>");
        }
        out.push("</ul>");
    }
    Handbook.setHtml(out.join(""));
    w.contents = true;
    w.crumb.text = qsTr("Search");
    w.backButton.enabled = w.at >= 0;
};

/**
 * An anchor the reader pressed.
 *
 * Every internal link is "<page id>.html", so the id is the basename
 * with the suffix off -- the same spelling a page's file has, which
 * means a page authored by hand links the way an HTML author expects
 * and a test can check every href against the index.
 */
Handbook.followLink = function(url) {
    var href = "";
    try {
        href = String(url.toString());
    } catch (eUrl) {
        href = String(url);
    }
    if (href.indexOf("http:") === 0 || href.indexOf("https:") === 0) {
        try {
            QDesktopServices.openUrl(new QUrl(href));
        } catch (eOpen) {
        }
        return;
    }
    var name = href;
    var slash = name.lastIndexOf("/");
    if (slash >= 0) {
        name = name.substring(slash + 1);
    }
    var hash = name.indexOf("#");
    if (hash >= 0) {
        name = name.substring(0, hash);
    }
    if (name.length > 5 && name.substring(name.length - 5) === ".html") {
        name = name.substring(0, name.length - 5);
    }
    if (CsHandbook.page(name) !== null) {
        Handbook.navigate(name);
    }
};

/** What the panel says when the handbook is not installed. */
Handbook.showMissing = function() {
    var w = Handbook.widgets;
    if (isNull(w)) {
        return;
    }
    var looked = CsHandbook.searchedPaths();
    var out = ["<h2>" + qsTr("The handbook is not installed") + "</h2>",
        "<p>" + qsTr("Its pages ship beside the add-on. This build has " +
        "none, which usually means a half-copied install.") + "</p>",
        "<p>" + qsTr("Looked in:") + "</p><ul>"];
    for (var i = 0; i < looked.length; i++) {
        out.push("<li>" + CsPanel.escapeHtml(looked[i]) + "</li>");
    }
    out.push("</ul>");
    Handbook.setHtml(out.join(""));
    w.crumb.text = qsTr("Handbook");
};

/**
 * Put HTML in the view.
 *
 * Property first, setter second: this bridge exposes some QWidget
 * members only one way and which way is not predictable from Qt's own
 * documentation, so every write that matters tries both.
 */
Handbook.setHtml = function(html) {
    var w = Handbook.widgets;
    // Every clip holds a character position in the OLD document.
    Handbook.stopClips();
    try {
        w.view.html = html;
    } catch (eProp) {
        try {
            w.view.setHtml(html);
        } catch (eCall) {
            w.view.plainText = CsHandbook.plainText(html);
        }
    }
};

Handbook.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    try {
        Handbook.open(Handbook.HOME);
    } catch (e) {
        csHandbookDock = undefined;
        CsTell.warn("Handbook: this CaveCAD build refused the docked panel (" +
            e + ") -- please report this.");
    }

    this.terminate();
};

Handbook.init = function(basePath) {
    Handbook.basePath = basePath;

    var action = new RGuiAction(qsTr("Handbook"),
        RMainWindowQt.getMainWindow());
    // NOT setRequiresDocument: a student who has just installed CaveCAD
    // has no drawing open, and that is exactly when they need reading.
    action.setRequiresDocument(false);
    action.setScriptFile(basePath + "/Handbook.js");
    action.setIcon(basePath + "/Handbook.svg");
    action.setStatusTip(qsTr("Every tool and every procedure explained, " +
        "with worked examples on a real cave"));
    action.setDefaultCommands(["handbook", "hb"]);
    // FIRST in stage 1, before the launcher: the first entry in the
    // menu is the one that explains the rest of the menu.
    action.setGroupSortOrder(450);
    action.setSortOrder(10);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);

    // Built during init like the other docks: the main window's
    // restoreState() runs after this and can only place a dock that
    // already exists. Hidden until something asks for it.
    try {
        var dock = Handbook.ensureDock();
        dock.visible = false;
    } catch (eInit) {
        csHandbookDock = undefined;
        warning("Handbook: could not build the panel at startup (" +
            eInit + "); the menu entry will try again.");
    }
};
