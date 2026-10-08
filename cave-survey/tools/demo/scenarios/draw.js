// draw.js -- the Draw dock: its sections fold away and open again.
//
// Which sections are folded is a remembered setting, so setup notes it and
// teardown clicks every header whose state changed back, leaving the dock
// exactly as the student had it.
CsDemoScenario = {
    gif: "draw-demo.gif",
    size: [760, 900],
    width: 640,
    fps: 12,
    was: {},
    dock: function() {
        return DrawPanel.ensureDock();
    },
    setup: function() {
        CsDemoScenario.was = {};
        for (var k in DrawPanel.sections) {
            CsDemoScenario.was[k] = DrawPanel.sections[k].open;
        }
        // the tour starts from "everything shipped open, linetypes shut"
        var start = { "Trace": true, "Symbols": true, "Areas": true,
            "Custom Linetypes": false };
        for (var t in start) {
            if (DrawPanel.sections[t].open !== start[t]) {
                DrawPanel.sections[t].header.click();
            }
        }
    },
    teardown: function() {
        for (var k in CsDemoScenario.was) {
            if (DrawPanel.sections[k].open !== CsDemoScenario.was[k]) {
                DrawPanel.sections[k].header.click();
            }
        }
    },
    steps: function() {
        function header(name) {
            return { widget: DrawPanel.sections[name].header, at: [0.15, 0.5] };
        }
        function toggle(name, hold) {
            return { click: { lazy: function() { return header(name); } },
                run: function() { DrawPanel.sections[name].header.click(); },
                ms: 800, hold: hold || 1500 };
        }
        return [
            { wait: 1000 },
            toggle("Trace"),
            toggle("Symbols"),
            toggle("Custom Linetypes", 1800),
            toggle("Trace"),
            toggle("Symbols", 1800),
            { wait: 600 }
        ];
    }
};
