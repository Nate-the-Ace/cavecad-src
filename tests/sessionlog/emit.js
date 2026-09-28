// Emits <count> "[crumb] probe N" lines, then checks its own log already
// holds the first one (every line is flushed). Prints SESSIONLOG OK|FAIL.
var args = RSettings.getOriginalArguments();
var i0 = args.indexOf("-autostart");
var count = Number(args[i0 + 3] || "1");
qDebug("[crumb] debug-probe");
for (var i = 0; i < count; i++) { qWarning("[crumb] probe " + i); }
var dir = String(QProcessEnvironment.systemEnvironment().value("CAVECAD_LOG_DIR", ""));
var names = new QDir(dir).entryList(["session-*.log"], QDir.Files, QDir.Name);
var text = "";
if (names.length > 0) {
    var f = new QFile(dir + "/" + names[names.length - 1]);
    if (f.open(QIODevice.ReadOnly | QIODevice.Text)) { text = String(new QTextStream(f).readAll()); f.close(); }
}
print(text.indexOf("[crumb] probe " + (count - 1)) >= 0 ? "SESSIONLOG OK" : "SESSIONLOG FAIL flushed line missing");
