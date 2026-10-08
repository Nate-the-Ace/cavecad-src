// start-here-tool.js -- Start Here: tick the steps of a lesson, move on.
//
// Progress lives in the user's settings, not in the drawing, so a take
// would overwrite the real student's ticks. setup SNAPSHOTS every
// lesson's stored string and clears them; teardown writes them back
// verbatim, so recording a clip never costs anyone their place.
CsDemoScenario = {
    gif: "start-here-demo.gif",
    size: [460, 700],
    width: 440,
    fps: 15,
    saved: null,
    dock: function() {
        return StartHere.ensureDock();
    },
    setup: function() {
        var lessons = CsGuide.lessons();
        CsDemoScenario.saved = {};
        for (var i = 0; i < lessons.length; i++) {
            CsDemoScenario.saved[lessons[i].id] = String(
                RSettings.getStringValue(CsGuide.SETTING + "/" +
                    lessons[i].id, ""));
        }
        CsGuide.forget();
        StartHere.show("lesson-1");
    },
    steps: function() {
        var w = StartHere.widgets;
        function tickRow(r) {
            return { click: { table: w.steps, row: r, at: [0.05, 0.5] },
                run: function() {
                    StartHere.itemChanged(w.steps.item(r, 1));
                }, ms: r === 0 ? 900 : 650, hold: 900 };
        }
        return [
            { wait: 1100 },
            tickRow(0),
            tickRow(1),
            tickRow(2),
            { wait: 700 },
            { click: { widget: w.nextButton },
              run: function() { w.nextButton.click(); }, ms: 800,
              hold: 1500 },
            { click: { widget: w.prevButton },
              run: function() { w.prevButton.click(); }, ms: 700,
              hold: 1500 }
        ];
    },
    teardown: function() {
        var saved = CsDemoScenario.saved;
        for (var id in saved) {
            RSettings.setValue(CsGuide.SETTING + "/" + id, saved[id]);
        }
        StartHere.show(CsGuide.resumeAt());
    }
};
