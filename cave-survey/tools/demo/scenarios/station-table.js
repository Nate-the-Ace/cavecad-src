// station-table.js -- Station Table: narrow the list by kind, search it,
// mark a station.
//
// Junction and Noted are ticked rather than Lead: the drawing this is
// recorded over has no leads, and an empty list teaches nothing.
//
// Marks are written to stations.json beside the drawing. The take runs on
// a throw-away copy in its own temp folder, so nothing real is touched.
CsDemoScenario = {
    gif: "station-table-demo.gif",
    size: [880, 700],
    width: 700,
    fps: 15,
    dock: function() {
        return StationTable.ensureDock();
    },
    setup: function() {
        StationTable.reload();
        var kinds = CsStationTable.KINDS;
        for (var i = 0; i < kinds.length; i++) {
            var box = StationTable.child("StationTableKind_" + kinds[i]);
            if (box.checked) {
                box.click();
            }
        }
        StationTable.child("StationTableSearch").setText("");
    },
    steps: function() {
        var t = StationTable.child("StationTableTable");
        var search = StationTable.child("StationTableSearch");
        var lead = StationTable.child("StationTableKind_junction");
        var open = StationTable.child("StationTableKind_noted");
        // a search term that still matches something once both kinds are
        // ticked: the start of the first such station's name
        var rows = CsStationTable.filter(StationTable.state.rows,
            { kinds: ["junction", "noted"], text: "", status: "" });
        var first = rows.length > 0 ? String(rows[0].station) : "A";
        var term = first.substring(0, 1);
        // the status dropdown is the cell widget of the first shown row;
        // fill() rebuilds them, so it is looked up at the moment of use
        function statusBox() {
            return t.cellWidget(0, StationTable.COL.STATUS);
        }
        return [
            { wait: 1000 },
            { click: { widget: lead, at: [0.15, 0.5] },
              run: function() { lead.click(); }, ms: 800, hold: 1500 },
            { click: { widget: open, at: [0.15, 0.5] },
              run: function() { open.click(); }, ms: 500, hold: 1500 },
            { click: { widget: search }, ms: 700,
              run: function() { search.setFocus(); }, hold: 200 },
            { style: "ibeam" },
            { type: term, per: 160, hold: 1400,
              set: function(text) { search.setText(text); } },
            { style: "arrow" },
            { click: { lazy: function() { return { widget: statusBox() }; } },
              run: function() {
                  var b = statusBox();
                  b.setCurrentIndex(Math.min(2, b.count - 1));
              }, ms: 900, hold: 1800 },
            { wait: 500 }
        ];
    }
};
