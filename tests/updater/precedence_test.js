include(RSettings.getOriginalArguments()[RSettings.getOriginalArguments().indexOf("-autostart") + 2] + "/tests/updater/harness.js");

// AddOn is not initialized in -no-gui headless mode, so it must be loaded
// explicitly here. load() = include(REPO + "/" + rel), which pulls in the
// worktree's copy of scripts/AddOn.js (not any app-installed copy).
// AddOn.js relies on helpers (isNull, makeQDirFilters, ...) normally loaded
// during GUI startup; pull those in too.
load("scripts/library.js");
load("scripts/AddOn.js");

// Prove this exercised the worktree's code (with our new functions), not a
// stale/installed AddOn.js: the new function must exist.
ok(typeof AddOn.precedenceIgnores === "function", "worktree AddOn.js loaded (precedenceIgnores defined)");

var root = QDir.tempPath() + "/cc-prec";
(new QDir(root)).removeRecursively();
// QByteArray(jsString) does not marshal correctly through this JS bridge
// (QFile.write ends up writing zero bytes) -- QFile.write() accepts a plain
// JS string directly, so use that instead.
function mk(p, v) { (new QDir()).mkpath(p); if (v !== null) { writeFile(p + "/VERSION", v + "\n"); } }
mk(root + "/app/CaveSurvey", "0.9.180.1"); mk(root + "/user/CaveSurvey", "0.9.181.0");
mk(root + "/app/Other", null);
mk(root + "/app/Older", "2.0"); mk(root + "/user/Older", "1.0");
mk(root + "/app/Same", "1.0"); mk(root + "/user/Same", "1.0");
mk(root + "/app/Widgets", null); mk(root + "/user/Widgets/LayerManager", null);
mk(root + "/app/Half", "3.0"); mk(root + "/user/Half", null);
var ign = AddOn.precedenceIgnores(root + "/app", root + "/user");
ok(ign.indexOf(root + "/app/Widgets") < 0, "an unversioned overlay (Widgets/LayerManager) never drops the app's own folder");
ok(ign.indexOf(root + "/app/Half") < 0 && ign.indexOf(root + "/user/Half") < 0, "versioned on one side only: both load, as before");
ok(ign.indexOf(root + "/app/CaveSurvey") >= 0, "older bundled CaveSurvey skipped");
ok(ign.indexOf(root + "/user/Older") >= 0, "older per-user copy skipped");
ok(ign.indexOf(root + "/app/Same") >= 0, "a tie goes to the per-user copy");
ok(ign.indexOf(root + "/app/Other") < 0, "an add-on in one root only is untouched");
eqs(AddOn.readVersion(root + "/app/Other"), "0", "no VERSION reads as 0");
AddOn.precedence = ign;
ok(AddOn.isIgnored(root + "/app/CaveSurvey/Core/CsAll.js"), "files inside a skipped copy are ignored");
ok(!AddOn.isIgnored(root + "/user/CaveSurvey/Core/CsAll.js"), "the winning copy is not");
AddOn.precedence = null;

// Lazy initialization, the way discovery calls it: cwd-relative
// "scripts/<Name>/..." paths, with the app root found from the cwd.
var savedCwd = QDir.currentPath(), savedRoots = AddOn.precedenceRoots;
(new QDir()).mkpath(root + "/appdir");
(new QDir()).rename(root + "/app", root + "/appdir/scripts");
QDir.setCurrent(root + "/appdir");
AddOn.precedenceRoots = function() { return { app: new QFileInfo("scripts").absoluteFilePath(), user: root + "/user" }; };
AddOn.precedence = null;
ok(AddOn.isIgnored("scripts/CaveSurvey/Core/CsAll.js"), "lazy init: a relative path into the older app copy is ignored");
ok(AddOn.precedence !== null && AddOn.precedence.length > 0, "lazy init filled the precedence list");
ok(!AddOn.isIgnored("scripts/Other/Other.js"), "lazy init: an app-only add-on still loads");
ok(!AddOn.isIgnored("scripts/CaveSurveyExtra/x.js"), "a sibling whose name only starts the same is not ignored");
ok(AddOn.isIgnored(root + "/user/Older/x.js"), "lazy init: the older per-user copy is ignored");
QDir.setCurrent(savedCwd);
AddOn.precedenceRoots = savedRoots;

// and with the real roots of this run: builds without throwing
AddOn.precedence = null;
var threw = null;
try { AddOn.isIgnored("scripts/Help/CheckForUpdates/CcUpdateCore.js"); } catch (e) { threw = String(e); }
ok(threw === null && AddOn.precedence !== null, "real-root lazy init works: " + threw);
AddOn.precedence = null;
(new QDir(root)).removeRecursively();
finish("precedence_test.js");
