// check-map.js -- the Check Map clip: read the map, then click findings.
//
// Show Me is left out on purpose: it is greyed for a sheet-wide finding
// (no scale bar is nowhere in particular), and a drawing with a located
// finding is needed to demo it.
CsDemoScenario = {
    gif: "check-map-demo.gif",
    size: [400, 720],
    fps: 15,
    dock: function() {
        return CheckMap.ensureDock();
    },
    setup: function() {
        var w = CheckMap.widgets;
        // the state a first-time open leaves the panel in
        w.list.setRowCount(0);
        w.findings = [];
        w.summary.text = qsTr("Press Check Again to read this map.");
        w.why.plainText = "";
        w.showButton.enabled = false;
    },
    steps: function() {
        var w = CheckMap.widgets;
        return [
            { wait: 900 },
            { click: { widget: w.againButton },
              run: function() { w.againButton.click(); }, ms: 900 },
            { wait: 1100 },
            { click: { table: w.list, row: 0 },
              run: function() { w.list.selectRow(0); }, ms: 800 },
            { wait: 1800 },
            { click: { table: w.list, row: w.findings.length - 1 },
              run: function() { w.list.selectRow(w.findings.length - 1); },
              ms: 800 },
            { wait: 2400 }
        ];
    }
};
