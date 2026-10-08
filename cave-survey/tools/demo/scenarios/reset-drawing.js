// reset-drawing.js -- Reset Drawing's confirmation: the counted summary,
// and a Reset button that stays dead until the cave's name is typed.
//
// The dialog is built with ResetDrawing.buildConfirm over INVENTED counts
// for a made-up cave, and cancelled. Nothing is reset, and no real drawing
// is counted or touched.
CsDemoScenario = {
    modal: true,
    gif: "reset-drawing-demo.gif",
    size: [680, 460],
    width: 600,
    fps: 12,
    built: null,
    launch: function() {
        var counts = { total: 1702, survey: 560, drawn: 1010, images: 132 };
        CsDemoScenario.built = ResetDrawing.buildConfirm("Demo Cave", counts,
            "~/Documents/Cave/Demo Cave/backup/Demo Cave 2026-10-06.dxf",
            false);
        CsDemoScenario.built.dlg.exec();
    },
    steps: function(root) {
        var b = CsDemoScenario.built;
        return [
            { wait: 1800 },
            { click: { widget: b.edit }, ms: 900,
              run: function() { b.edit.setFocus(); }, hold: 200 },
            { style: "ibeam" },
            { type: "Demo Cave", per: 140, hold: 1800,
              set: function(t) { b.edit.setText(t); } },
            { style: "arrow" },
            { click: { widget: b.cancelBtn }, ms: 900, hold: 200 }
        ];
    }
};
