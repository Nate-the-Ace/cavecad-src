// sheet-setup.js -- Sheet Setup: the preview redraws as the paper, the
// orientation and the furniture change.
//
// Combo choices are made with setCurrentIndex, so the clip shows the
// cursor arriving and the value changing but not the drop-down list: a
// combo's popup is its own top-level window and a dock grab never holds
// it.
CsDemoScenario = {
    gif: "sheet-setup-demo.gif",
    size: [500, 780],
    width: 480,
    fps: 15,
    dock: function() {
        return SheetSetup.ensureDock();
    },
    setup: function() {
        var w = SheetSetup.widgets;
        // a first open reads the drawing and proposes a scale
        SheetSetup.refresh();
        if (w.cbTurn.checked) {
            w.cbTurn.click();
        }
    },
    steps: function() {
        var w = SheetSetup.widgets;
        var sheetNow = w.sheetCombo.currentIndex;
        var scaleNow = w.scaleCombo.currentIndex;
        return [
            { wait: 1000 },
            { click: { widget: w.cbTurn, at: [0.12, 0.5] },
              run: function() { w.cbTurn.click(); }, ms: 800, hold: 1100 },
            { click: { widget: w.cbTurn, at: [0.12, 0.5] },
              run: function() { w.cbTurn.click(); }, ms: 300, hold: 900 },
            { click: { widget: w.cbBar, at: [0.1, 0.5] },
              run: function() { w.cbBar.click(); }, ms: 700, hold: 900 },
            { click: { widget: w.cbNorth, at: [0.1, 0.5] },
              run: function() { w.cbNorth.click(); }, ms: 500, hold: 900 },
            { click: { widget: w.cbBar, at: [0.1, 0.5] },
              run: function() { w.cbBar.click(); }, ms: 500, hold: 600 },
            { click: { widget: w.cbNorth, at: [0.1, 0.5] },
              run: function() { w.cbNorth.click(); }, ms: 400, hold: 900 },
            { click: { widget: w.scaleCombo },
              run: function() { w.scaleCombo.setCurrentIndex(scaleNow + 2); },
              ms: 700, hold: 1500 },
            { click: { widget: w.sheetCombo },
              run: function() { w.sheetCombo.setCurrentIndex(sheetNow - 2); },
              ms: 700, hold: 1500 },
            { wait: 600 }
        ];
    },
    teardown: function() {
        // leave the panel as a first open leaves it
        SheetSetup.refresh();
    }
};
