// area-fill.js -- Area Fill: search the patterns, then set Scale and Density.
//
// Clicking a tile arms a drag tool that waits for a boundary in the
// drawing, so the clip does not click one. Scale and Density are put back
// to the values found, and the other Draw sections' folds likewise.
CsDemoScenario = {
    gif: "area-fill-demo.gif",
    size: [760, 900],
    width: 640,
    fps: 12,
    was: {},
    scaleWas: 1,
    densityWas: 1,
    dock: function() {
        return DrawPanel.ensureDock();
    },
    setup: function() {
        CsDemoScenario.was = {};
        var want = { "Areas": true, "Trace": false, "Symbols": false,
            "Custom Linetypes": false };
        for (var k in want) {
            var s = DrawPanel.sections[k];
            CsDemoScenario.was[k] = s.open;
            if (s.open !== want[k]) {
                s.header.click();
            }
        }
        var w = AreaFill.widgets;
        CsDemoScenario.scaleWas = w.scaleBox.value;
        CsDemoScenario.densityWas = w.densityBox.value;
        w.scaleBox.setValue(1.0);
        w.densityBox.setValue(1.0);
        w.searchEdit.setText("");
    },
    teardown: function() {
        var w = AreaFill.widgets;
        w.searchEdit.setText("");
        w.scaleBox.setValue(CsDemoScenario.scaleWas);
        w.densityBox.setValue(CsDemoScenario.densityWas);
        for (var k in CsDemoScenario.was) {
            var s = DrawPanel.sections[k];
            if (s.open !== CsDemoScenario.was[k]) {
                s.header.click();
            }
        }
    },
    steps: function() {
        var w = AreaFill.widgets;
        var box = w.searchEdit;
        return [
            { wait: 1000 },
            { click: { widget: box }, ms: 800,
              run: function() { box.setFocus(); }, hold: 200 },
            { style: "ibeam" },
            { type: "sand", per: 170, hold: 2200,
              set: function(t) { box.setText(t); } },
            { run: function() { box.setText(""); } },
            { style: "arrow" },
            { wait: 1000 },
            { click: { widget: w.scaleBox, at: [0.5, 0.5] }, ms: 800,
              run: function() { w.scaleBox.setValue(2.0); }, hold: 1800 },
            { click: { widget: w.densityBox, at: [0.5, 0.5] }, ms: 700,
              run: function() { w.densityBox.setValue(0.5); }, hold: 1800 },
            { wait: 600 }
        ];
    }
};
