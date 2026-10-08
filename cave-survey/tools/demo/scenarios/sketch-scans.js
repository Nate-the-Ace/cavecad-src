// sketch-scans.js -- Sketch Scans: pick scans in the tree (the preview
// follows), then step through the Plan, Profile and Cross Section tabs.
//
// demo-scans: 2024 Scans/4-6-24 Survey Scans
//
// run.py copies that folder beside the temp drawing, so the tree has
// something to list and nothing in the real cave folder is touched.
// Align and Place are not pressed: they open the scan viewer and write
// into the drawing.
CsDemoScenario = {
    gif: "sketch-scans-demo.gif",
    size: [800, 800],
    width: 640,
    fps: 12,
    dock: function() {
        return SketchScans.ensureDock();
    },
    tabWas: 0,
    setup: function() {
        var w = SketchScans.w;
        // the panel remembers its last tab: start the tour at Plan, and
        // give the student their tab back after
        CsDemoScenario.tabWas = w.tabs.currentIndex;
        w.tabs.setCurrentIndex(0);
        SketchScans.refresh();
    },
    steps: function() {
        var w = SketchScans.w;
        var dock = SketchScans.ensureDock();
        // the first two scan rows (a "file" row, not a folder)
        var files = [];
        for (var i = 0; i < w.rows.length; i++) {
            if (w.rows[i].kind === "file") {
                files.push(i);
            }
        }
        var a = files[0];
        var b = files[Math.min(7, files.length - 1)];
        function pickRow(r) {
            return { click: { table: w.list, row: r, at: [0.4, 0.5] },
                run: function() { w.list.selectRow(r); }, ms: 800,
                hold: 1700 };
        }
        function pickTab(n) {
            return { click: { lazy: function() {
                    var bar = CsDemo.val(w.tabs, "tabBar");
                    var r = bar.tabRect(n);
                    var o = bar.mapTo(dock, new QPoint(0, 0));
                    return { x: o.x() + r.x() + r.width() / 2,
                        y: o.y() + r.y() + r.height() / 2 };
                } },
                run: function() { w.tabs.setCurrentIndex(n); }, ms: 800,
                hold: 1500 };
        }
        return [
            { wait: 1000 },
            pickRow(a),
            pickRow(b),
            pickTab(1),
            pickTab(2),
            pickTab(0),
            { wait: 600 }
        ];
    },
    teardown: function() {
        SketchScans.w.tabs.setCurrentIndex(CsDemoScenario.tabWas);
    }
};
