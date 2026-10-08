// linetype-maker.js -- Linetype Maker: New, name it, add a text row, set the
// text and a dash length, and watch the preview follow.
//
// Save to Library and Apply to Drawing are not pressed: they would put a
// linetype in the student's library or the drawing. The picker is put back
// on the linetype it was showing.
CsDemoScenario = {
    gif: "linetype-maker-demo.gif",
    size: [900, 760],
    width: 700,
    fps: 12,
    pickerWas: -1,
    dock: function() {
        return LinetypeMaker.ensureDock();
    },
    setup: function() {
        LinetypeMaker.refresh();
        CsDemoScenario.pickerWas = LinetypeMaker.w.picker.currentIndex;
    },
    teardown: function() {
        var w = LinetypeMaker.w;
        if (CsDemoScenario.pickerWas >= 0) {
            w.picker.setCurrentIndex(CsDemoScenario.pickerWas);
        }
        LinetypeMaker.refresh();
    },
    steps: function() {
        var w = LinetypeMaker.w;
        var C = LinetypeMaker.COL;
        function cellStep(row, col, text, per) {
            var at = function() {
                return { table: w.table, row: row, col: col };
            };
            return [
                { click: { lazy: at }, ms: 650, hold: 150,
                  run: function() { w.table.setCurrentCell(row, col); } },
                { style: "ibeam" },
                { type: text, per: per || 150, hold: 600,
                  set: function(t) { w.table.item(row, col).setText(t); } },
                { style: "arrow" }
            ];
        }
        var steps = [
            { wait: 1000 },
            { click: { widget: w.newButton }, ms: 800,
              run: function() { w.newButton.click(); }, hold: 1200 },
            { click: { widget: w.name }, ms: 700,
              run: function() { w.name.setFocus(); }, hold: 150 },
            { style: "ibeam" },
            { type: "STREAM", per: 130, hold: 600,
              set: function(t) {
                  w.name.setText(t);
                  // what textEdited does on a real keystroke
                  LinetypeMaker.readNames();
              } },
            { style: "arrow" },
            { click: { widget: w.addText }, ms: 700,
              run: function() { w.addText.click(); }, hold: 1300 }
        ];
        steps = steps.concat(cellStep(2, C.TEXT, "W", 200));
        steps = steps.concat(cellStep(0, C.LENGTH, "1.5", 200));
        steps.push({ wait: 2200 });
        return steps;
    }
};
