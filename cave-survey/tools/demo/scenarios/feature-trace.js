// feature-trace.js -- Feature Trace: the search box finds a feature by any
// of its names ("gour" finds the rimstone dam, "shaft" finds the pit).
//
// The Trace tiles arm a drag tool that waits for a stroke in the drawing,
// so the clip stays with the search. The other Draw sections are folded
// for the take and every fold is put back as it was found.
CsDemoScenario = {
    gif: "feature-trace-demo.gif",
    size: [760, 900],
    width: 640,
    fps: 12,
    was: {},
    dock: function() {
        return DrawPanel.ensureDock();
    },
    setup: function() {
        CsDemoScenario.was = {};
        var want = { "Trace": true, "Symbols": false, "Areas": false,
            "Custom Linetypes": false };
        for (var k in want) {
            var s = DrawPanel.sections[k];
            CsDemoScenario.was[k] = s.open;
            if (s.open !== want[k]) {
                s.header.click();
            }
        }
        FeatureTrace.widgets.searchEdit.setText("");
    },
    teardown: function() {
        FeatureTrace.widgets.searchEdit.setText("");
        for (var k in CsDemoScenario.was) {
            var s = DrawPanel.sections[k];
            if (s.open !== CsDemoScenario.was[k]) {
                s.header.click();
            }
        }
    },
    steps: function() {
        var box = FeatureTrace.widgets.searchEdit;
        function typeIn(text, hold) {
            return { type: text, per: 170, hold: hold || 2400,
                set: function(t) { box.setText(t); } };
        }
        return [
            { wait: 1000 },
            { click: { widget: box }, ms: 800,
              run: function() { box.setFocus(); }, hold: 200 },
            { style: "ibeam" },
            typeIn("gour", 2600),
            { run: function() { box.setText(""); } },
            { wait: 1300 },
            typeIn("shaft", 2600),
            { run: function() { box.setText(""); } },
            { style: "arrow" },
            { wait: 1600 }
        ];
    }
};
