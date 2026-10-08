// package-cave-project.js -- Package Cave Project: Sanitized by default,
// Full archive on request, and the contents ticked item by item.
//
// The dialog is filmed and then rejected: Package would write a zip into
// the user's Cave folder. It is opened straight from PackageCave.ask over
// the throw-away drawing, so what it lists is the demo cave and nothing of
// the user's.
CsDemoScenario = {
    modal: true,
    gif: "package-cave-project-demo.gif",
    size: [760, 700],
    width: 600,
    fps: 12,
    launch: function() {
        var path = String(EAction.getDocument().getFileName());
        var folder = path.replace(/\/[^\/]*$/, "");
        PackageCave.ask(RMainWindowQt.getMainWindow(),
            { name: "Demo Cave", drawing: path, folder: folder });
    },
    steps: function(root) {
        var full = CsDemo.find(root, "Full archive", true);
        var clean = CsDemo.find(root, "Sanitized", true);
        var data = CsDemo.find(root, "data/", true);
        var cancel = CsDemo.find(root, "Cancel", true);
        function press(w, hold) {
            return { click: { widget: w, at: [0.06, 0.5] }, ms: 800,
                run: function() { w.click(); }, hold: hold || 1800 };
        }
        return [
            { wait: 1400 },
            press(full, 2200),
            press(clean, 1800),
            press(data, 1800),
            press(data, 1500),
            { click: { widget: cancel }, ms: 900, hold: 200 }
        ];
    }
};
