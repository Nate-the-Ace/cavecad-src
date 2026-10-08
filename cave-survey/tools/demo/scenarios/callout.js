// callout.js -- Callout: place the note, then an arrow to each thing it is
// about; the text and its leaders appear together, linked.
//
// canvas: true
//
// The tool asks for the note's words in a dialog first; that step is not
// filmed. The clicks are cursor animation over a real CalloutWrite.create,
// which is what the tool calls once the last arrow is placed.
CsDemoScenario = {
    canvas: true,
    gif: "callout-demo.gif",
    fps: 12,
    width: 760,
    hide: ["CTRL-AERIAL", "CTRL-CONTOUR", "CTRL-SCAN", "CTRL-PROFILE-SCAN"],
    box: [-170, 55, 30, 196],
    steps: function() {
        var doc = EAction.getDocument();
        var di = EAction.getDocumentInterface();
        var note = [-95, 172];
        var tipB = [-56, 131];
        var tipC = [12, 123];
        function click(pt, hold, run) {
            return { click: { world: pt }, ms: 900, hold: hold || 900,
                run: run || null };
        }
        return [
            { wait: 1400 },
            click(note, 1100),
            click(tipB, 1000),
            click(tipC, 400, function() {
                CalloutWrite.create(doc, di, {
                    text: "LOW CRAWL, DRAFT FROM THE RIGHT",
                    position: { x: note[0], y: note[1] },
                    tips: [{ x: tipB[0], y: tipB[1] },
                        { x: tipC[0], y: tipC[1] }],
                    height: CalloutWrite.textHeight(doc)
                });
            }),
            { wait: 3000 }
        ];
    }
};
