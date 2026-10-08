// teaching-cave.js -- Teaching Cave: Reset the student's copy, or Set up
// the master from a real cave.
//
// The dialog is filmed and cancelled. OK would reset (or rebuild) the real
// teaching copy under ~/Documents/Cave/teaching, which is somebody's work.
CsDemoScenario = {
    modal: true,
    gif: "teaching-cave-demo.gif",
    size: [620, 300],
    width: 560,
    fps: 12,
    launch: function() {
        teachingCaveRun();
    },
    steps: function(root) {
        var reset = CsDemo.find(root, "Reset the teaching copy", true);
        var setup = CsDemo.find(root, "Set up", true);
        var cancel = CsDemo.find(root, "Cancel", true);
        function press(w, hold) {
            return { click: { widget: w, at: [0.05, 0.5] }, ms: 800,
                run: function() { w.click(); }, hold: hold || 1900 };
        }
        return [
            { wait: 1400 },
            press(setup, 2200),
            press(reset, 2200),
            { click: { widget: cancel }, ms: 900, hold: 200 }
        ];
    }
};
