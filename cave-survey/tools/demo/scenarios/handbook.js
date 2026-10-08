// handbook.js -- the Handbook: Contents, follow a link, Back, search.
//
// A link's position is read off the page itself (cursorRect on the text
// that carries it), so the cursor lands on the link wherever the layout
// puts it. The click is the page's own navigate(), as anchorClicked
// would call it.
CsDemoScenario = {
    gif: "handbook-demo.gif",
    size: [460, 700],
    width: 400,
    fps: 15,
    dock: function() {
        return Handbook.ensureDock();
    },
    setup: function() {
        var w = Handbook.widgets;
        w.history = [];
        w.at = -1;
        w.search.setText("");
        Handbook.navigate(Handbook.HOME);
    },
    teardown: function() {
        Handbook.widgets.search.setText("");
        Handbook.navigate(Handbook.HOME);
    },
    steps: function() {
        var w = Handbook.widgets;
        // where the text of a link sits, in the dock's own coordinates
        function reveal(text) {
            var cur = w.view.document.find(text);
            // collapse it: a highlighted link in the clip looks like a
            // selection the student made
            cur.clearSelection();
            w.view.setTextCursor(cur);
            w.view.ensureCursorVisible();
        }
        function linkAt(text) {
            var cur = w.view.textCursor();
            var r = w.view.cursorRect(cur);
            var o = w.view.mapTo(Handbook.ensureDock(), new QPoint(0, 0));
            return { x: o.x() + 2 + r.x() - 28, y: o.y() + 2 + r.y() + r.height() / 2 };
        }
        return [
            { wait: 1000 },
            { click: { widget: w.contentsButton },
              run: function() { Handbook.showContents(); }, ms: 800, hold: 1400 },
            // scroll the link into view while the cursor is still, then
            // let the view settle before the cursor sets off for it
            { run: function() { reveal("Check Map"); } },
            { wait: 600 },
            { click: { lazy: function() { return linkAt("Check Map"); } },
              run: function() { Handbook.navigate("check-map"); },
              ms: 1000, hold: 2200 },
            { click: { widget: w.backButton },
              run: function() { Handbook.back(); }, ms: 800, hold: 1300 },
            { click: { widget: w.search }, ms: 800,
              run: function() { w.search.setFocus(); }, hold: 200 },
            { style: "ibeam" },
            { type: "scale", per: 170, hold: 500,
              set: function(text) { w.search.setText(text); } },
            { style: "arrow" },
            { run: function() { Handbook.runSearch(); } },
            { wait: 1800 }
        ];
    }
};
