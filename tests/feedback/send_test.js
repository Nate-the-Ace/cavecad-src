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
var reply = "";
// stub: base64 runs for real; the POST writes `reply` into its -o file
var realRun = FeedbackSend.runner;
FeedbackSend.runner = function(cmd, t, done) {
    var o = cmd.args.indexOf("-o");
    if (cmd.args.indexOf("--data-binary") >= 0) { writeFile(cmd.args[o + 1], reply); done({ ok: true, code: 0, stdout: "", error: "" }); return; }
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
eqs(FeedbackSend.readState()["feedback-2026-09-27-a7f3c2.zip"].failures, 1, "failure counted");

reply = '{"ok":true,"id":"a7f3c2"}';
var s = send(q, CFG);
ok(s.ok && s.id === "a7f3c2", "sent");
ok(!new QFileInfo(q).exists() && !new QFileInfo(q + ".b64").exists(), "zip and b64 removed");
ok(!FeedbackSend.readState().hasOwnProperty("feedback-2026-09-27-a7f3c2.zip"), "state forgotten");

writeFile(root + "/outbox/feedback-2026-09-27-000001.zip", "a");
writeFile(root + "/outbox/feedback-2026-09-27-000002.zip", "b");
reply = '{"ok":true,"id":"000001"}';
var rr = null;
FeedbackSend.retryAll(CFG, function(x) { rr = x; loop.quit(); }); if (rr === null) { loop.exec(); }
eqs(rr.sent + rr.failed, 2, "retry visits both");
(new QDir(root)).removeRecursively();
finish("send");
