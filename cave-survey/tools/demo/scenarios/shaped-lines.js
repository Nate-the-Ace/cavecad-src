// shaped-lines.js -- Shaped Lines: drag along an edge, and the ornament
// grows out of it (hachures for a floor ledge, a rimstone dam's scallops).
//
// canvas: true
//
// The strokes are drawn by the take and dressed with the same
// CsShapeLine.dress the "Decorate Selection" command uses; the cursor is
// drawn dragging along each path and the line appears at the release, as
// the real drag tool's does. The map is Truitt's survey with the aerial
// photograph, contours and scan images switched off in a throw-away copy.
CsDemoScenario = {
    canvas: true,
    gif: "shaped-lines-demo.gif",
    fps: 12,
    width: 760,
    hide: ["CTRL-AERIAL", "CTRL-CONTOUR", "CTRL-SCAN", "CTRL-PROFILE-SCAN"],
    box: [-170, 55, 30, 196],
    steps: function() {
        var doc = EAction.getDocument();
        var di = EAction.getDocumentInterface();
        function along(a, b, offset, from, to, n) {
            // n points between `from` and `to` feet along a->b, pushed
            // `offset` feet to one side
            var dx = b[0] - a[0], dy = b[1] - a[1];
            var len = Math.sqrt(dx * dx + dy * dy);
            var ux = dx / len, uy = dy / len;
            var pts = [];
            for (var i = 0; i < n; i++) {
                var s = from + (to - from) * i / (n - 1);
                pts.push([a[0] + ux * s + uy * offset,
                    a[1] + uy * s - ux * offset]);
            }
            return pts;
        }
        var A = [-149, 109], B = [-54, 133], C = [15, 121];
        var ledge = along(A, B, -5.5, 8, 88, 7);
        var dam = along(B, C, -4.5, 6, 64, 6);
        function dressAs(pts, style, side) {
            return function() {
                var entity = CsDemo.addPolyline(pts);
                var opts = { styleKey: style, side: side, scale: 1,
                    symbol: "" };
                try {
                    opts.region = CsTrace.profileRegion(doc);
                } catch (e1) {
                    opts.region = null;
                }
                try {
                    opts.bays = CsTrace.sectionBays(doc);
                } catch (e2) {
                    opts.bays = [];
                }
                CsShapeLine.dress(doc, di, entity, opts,
                    doc.getTransactionGroup() + 1);
            };
        }
        return [
            { wait: 1400 },
            { drag: ledge, ms: 2200, run: dressAs(ledge, "floorledge", 1),
              hold: 2400 },
            { drag: dam, ms: 1800, run: dressAs(dam, "rimstone", 1),
              hold: 2800 }
        ];
    }
};
