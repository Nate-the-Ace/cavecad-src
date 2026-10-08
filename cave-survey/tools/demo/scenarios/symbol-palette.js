// symbol-palette.js -- Symbol Palette: search the tiles, then clear it.
//
// The palette is a section of the Draw dock. Clicking a tile would ARM the
// placement tool, which waits for a click in the drawing, so the clip
// stays with the search.
CsDemoScenario = {
    gif: "symbol-palette-demo.gif",
    size: [760, 900],
    width: 640,
    fps: 12,
    was: {},
    repo: "/Users/nathanschonegg/Documents/github/cavecad-tools",
    dock: function() {
        return DrawPanel.ensureDock();
    },
    setup: function() {
        // record against the repo's tile ink (follows the theme); the
        // installed palette draws near-black icons that vanish on dark
        CsDemo.hotLoad(CsDemoScenario.repo + "/scripts/CaveSurvey/" +
            "SymbolPalette/SymbolPalette.js",
            ["SymbolPalette.tilePen", "SymbolPalette.tileFor"]);
        SymbolPalette.rebuildTiles();
        SymbolPalette.rebuildRecent();
        // the palette gets the dock to itself: Trace and Areas are folded
        // for the take, and every fold goes back as it was found
        CsDemoScenario.was = {};
        var want = { "Symbols": true, "Trace": false, "Areas": false,
            "Custom Linetypes": false };
        for (var k in want) {
            var s = DrawPanel.sections[k];
            CsDemoScenario.was[k] = s.open;
            if (s.open !== want[k]) {
                s.header.click();
            }
        }
        SymbolPalette.widgets.searchEdit.setText("");
    },
    teardown: function() {
        SymbolPalette.widgets.searchEdit.setText("");
        for (var k in CsDemoScenario.was) {
            var s = DrawPanel.sections[k];
            if (s.open !== CsDemoScenario.was[k]) {
                s.header.click();
            }
        }
    },
    steps: function() {
        var w = SymbolPalette.widgets;
        var box = w.searchEdit;
        function typeIn(text, hold) {
            return [
                { type: text, per: 170, hold: hold || 2200,
                  set: function(t) { box.setText(t); } }
            ];
        }
        var steps = [
            { wait: 1000 },
            { click: { widget: box }, ms: 800,
              run: function() { box.setFocus(); }, hold: 200 },
            { style: "ibeam" }
        ];
        steps = steps.concat(typeIn("pit", 2400));
        steps.push({ run: function() { box.setText(""); } });
        steps.push({ wait: 1400 });
        steps = steps.concat(typeIn("bat", 2400));
        steps.push({ run: function() { box.setText(""); } });
        steps.push({ style: "arrow" });
        steps.push({ wait: 1600 });
        return steps;
    }
};
