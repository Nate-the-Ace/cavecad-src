include(RSettings.getOriginalArguments()[RSettings.getOriginalArguments().indexOf("-autostart") + 2] + "/tests/updater/harness.js");
load("scripts/Help/CheckForUpdates/CcUpdateCommands.js");
load("scripts/Help/CheckForUpdates/CcUpdateRun.js");
load("scripts/Help/SendFeedback/FeedbackCore.js");
load("scripts/Help/SendFeedback/FeedbackCommands.js");
load("scripts/Help/SendFeedback/FeedbackSend.js");

var root = QDir.tempPath() + "/cc-fbsend";
(new QDir(root)).removeRecursively();
(new QDir()).mkpath(root);
FeedbackSend.outboxDir = function() { return root + "/outbox"; };
var CFG = { ENDPOINT: "https://script.google.com/macros/s/X/exec", KEY: "k" };
var reply = "";        // string, or function(id) -> string
var netFail = false;   // POST step reports a network failure
var holdPost = null;   // when set (via holdNext), the POST callback waits here instead of firing
var holdNext = false;

// stub: base64 runs for real; the POST writes `reply` (or reply(id)) into
// its -o file, or fails, or is held for the caller to release explicitly.
var realRun = FeedbackSend.runner;
FeedbackSend.runner = function(cmd, t, done) {
    var o = cmd.args.indexOf("-o");
    if (cmd.args.indexOf("--data-binary") >= 0) {
        var url = cmd.args[cmd.args.length - 1];
        var m = /[?&]id=([0-9a-f]{6})/.exec(url);
        var id = m ? m[1] : "";
        var fire = function() {
            if (netFail) { done({ ok: false, code: 1, stdout: "", error: "boom" }); return; }
            var body = typeof reply === "function" ? reply(id) : reply;
            writeFile(cmd.args[o + 1], body);
            done({ ok: true, code: 0, stdout: "", error: "" });
        };
        if (holdNext) { holdNext = false; holdPost = fire; return; }
        fire();
        return;
    }
    realRun(cmd, t, done);
};
var loop = new QEventLoop(), r = null;
function send(p, cfg) { r = null; FeedbackSend.send(p, cfg, function(x) { r = x; loop.quit(); }); if (r === null) { loop.exec(); } return r; }

writeFile(root + "/feedback-2026-09-27-a7f3c2.zip", "zipbytes");
var q = FeedbackSend.queue(root + "/feedback-2026-09-27-a7f3c2.zip");
eqs(q, root + "/outbox/feedback-2026-09-27-a7f3c2.zip", "queued into the outbox");
ok(!new QFileInfo(root + "/feedback-2026-09-27-a7f3c2.zip").exists(), "moved, not copied");

eqs(send(q, { ENDPOINT: "@@FEEDBACK_ENDPOINT@@", KEY: "@@FEEDBACK_KEY@@" }).error, "not-configured", "placeholders do not send");
ok(new QFileInfo(q).exists(), "still queued");

reply = "<html>oops</html>";
ok(!send(q, CFG).ok, "garbage reply is a failure");
ok(new QFileInfo(q).exists(), "kept after failure");
ok(!new QFileInfo(q + ".reply").exists(), ".reply cleaned up after a garbage reply");
eqs(FeedbackSend.readState()["feedback-2026-09-27-a7f3c2.zip"].failures, 1, "failure counted");

// network failure: POST itself fails (no reply body at all)
netFail = true;
var rNet = send(q, CFG);
netFail = false;
ok(!rNet.ok && rNet.error.indexOf("network:") === 0, "network failure surfaces as network:...");
ok(new QFileInfo(q).exists(), "kept after network failure");
eqs(FeedbackSend.readState()["feedback-2026-09-27-a7f3c2.zip"].failures, 2, "second failure counted");

// id mismatch: a well-formed reply for the wrong report is still a failure
reply = '{"ok":true,"id":"000000"}';
var rMismatch = send(q, CFG);
ok(!rMismatch.ok && rMismatch.error === "id-mismatch", "reply for a different id is rejected");
ok(new QFileInfo(q).exists(), "kept after id mismatch");

reply = '{"ok":true,"id":"a7f3c2"}';
var s = send(q, CFG);
ok(s.ok && s.id === "a7f3c2", "sent");
ok(!new QFileInfo(q).exists() && !new QFileInfo(q + ".b64").exists() && !new QFileInfo(q + ".reply").exists(),
   "zip, b64 and reply removed");
ok(!FeedbackSend.readState().hasOwnProperty("feedback-2026-09-27-a7f3c2.zip"), "state forgotten");

// missing file: nothing to send, and nothing recorded as a failure
var missing = root + "/outbox/feedback-2026-09-27-000009.zip";
var rMissing = send(missing, CFG);
eqs(rMissing.error, "missing", "missing zip reported, not treated as a network/parse failure");
ok(!FeedbackSend.readState().hasOwnProperty("feedback-2026-09-27-000009.zip"), "no failure recorded for a missing file");

// in-flight guard: a second send() on the same file while the first is
// still waiting on its POST is refused immediately, without a second POST.
writeFile(root + "/outbox/feedback-2026-09-27-000004.zip", "z4");
var busyPath = root + "/outbox/feedback-2026-09-27-000004.zip";
var postCalls = 0;
var realStub = FeedbackSend.runner;
FeedbackSend.runner = function(cmd, t, done) {
    if (cmd.args.indexOf("--data-binary") >= 0) { postCalls++; }
    realStub(cmd, t, done);
};
holdNext = true;
var doneA = null;
FeedbackSend.send(busyPath, CFG, function(x) { doneA = x; });
ok(spin(2000, function() { return holdPost !== null; }), "base64 finished and POST is held");
var doneB = null;
FeedbackSend.send(busyPath, CFG, function(x) { doneB = x; });
eqs(doneB && doneB.error, "busy", "second concurrent send refused as busy");
ok(doneA === null, "first send still pending while the second was refused");
ok(!FeedbackSend.readState().hasOwnProperty("feedback-2026-09-27-000004.zip"), "busy refusal records no failure");
reply = '{"ok":true,"id":"000004"}';
var releasePost = holdPost; holdPost = null;
releasePost();
ok(spin(2000, function() { return doneA !== null; }), "first send eventually completes");
ok(doneA.ok && doneA.id === "000004", "first send succeeded");
eqs(postCalls, 1, "exactly one POST for the whole exchange");
FeedbackSend.runner = realStub;

// malformed outbox.json is treated as empty, and non-object entries are dropped
(function() {
    (new QDir()).mkpath(root + "/outbox");
    writeFile(root + "/outbox/outbox.json", "not json");
    eqs(Object.keys(FeedbackSend.readState()).length, 0, "unparsable outbox.json reads as empty");
    writeFile(root + "/outbox/outbox.json", '{"a.zip":{"failures":2},"b.zip":"oops","c.zip":{"failures":"x"},"d.zip":null}');
    var st = FeedbackSend.readState();
    eqs(Object.keys(st).length, 1, "only well-formed entries survive");
    ok(st.hasOwnProperty("a.zip") && st["a.zip"].failures === 2, "well-formed entry kept");
    QFile.remove(root + "/outbox/outbox.json");
})();

// queue() never loses the report: if the outbox cannot even be created,
// the caller keeps the original path (and file).
(function() {
    var blocked = root + "/blocked";
    writeFile(blocked, "this is a file, not a directory");
    var savedOutboxDir = FeedbackSend.outboxDir;
    FeedbackSend.outboxDir = function() { return blocked + "/outbox"; };
    var src = root + "/feedback-2026-09-27-000005.zip";
    writeFile(src, "z5");
    var got = FeedbackSend.queue(src);
    eqs(got, src, "queue() returns the original path when the outbox can't be created");
    ok(new QFileInfo(src).exists(), "original file left in place");
    FeedbackSend.outboxDir = savedOutboxDir;
    QFile.remove(blocked);
})();

// retryAll: sends every queued zip once, in name order, each getting its
// own id back from the (stubbed) receiver.
writeFile(root + "/outbox/feedback-2026-09-27-000001.zip", "a");
writeFile(root + "/outbox/feedback-2026-09-27-000002.zip", "b");
var order = [];
reply = function(id) { order.push(id); return JSON.stringify({ ok: true, id: id }); };
var rr = null;
FeedbackSend.retryAll(CFG, function(x) { rr = x; loop.quit(); }); if (rr === null) { loop.exec(); }
eqs(rr.sent, 2, "retry sent both");
eqs(rr.failed, 0, "retry had no failures");
eqs(order.join(","), "000001,000002", "retry visits queued zips in name order");
ok(!new QFileInfo(root + "/outbox/feedback-2026-09-27-000001.zip").exists()
   && !new QFileInfo(root + "/outbox/feedback-2026-09-27-000002.zip").exists(), "both zips gone after retry");

(new QDir(root)).removeRecursively();
finish("send");
