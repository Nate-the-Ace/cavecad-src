// tests/updater/harness.js -- shared by every updater engine test.
// REPO is the repository root, passed as the first script argument.
var REPO = (function() {
    var args = RSettings.getOriginalArguments();
    for (var i = 0; i < args.length; i++) {
        if (String(args[i]) === "-autostart" && i + 2 < args.length) {
            return String(args[i + 2]);
        }
    }
    return QDir.currentPath();
})();
var passed = 0, failures = [];
function ok(cond, what) { if (cond) { passed++; } else { failures.push(what); } }
function eqs(a, b, what) { ok(a === b, what + " (expected " + JSON.stringify(b) + ", got " + JSON.stringify(a) + ")"); }
function finish(name) {
    if (failures.length === 0) { print("### UPDATER OK " + passed + " (" + name + ")"); }
    else { print("### UPDATER FAIL " + failures.length + " (" + name + ")\n  " + failures.join("\n  ")); }
}
function load(rel) { include(REPO + "/" + rel); }
