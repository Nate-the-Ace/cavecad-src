# Send Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Help > Send Feedback: a per-launch session log with action breadcrumbs, a dialog that packages a report, and a curl POST to a Google Apps Script receiver that files it in cavecad.app@gmail.com's Drive, with an outbox and an email fallback; plus a privacy policy.

**Architecture:** C++ adds `RSessionLog` (fed by the existing Qt message handler) and `[crumb]` lines at action trigger, open, save, undo/redo and close. Everything else is script under `scripts/Help/SendFeedback/`, built like the updater (`scripts/Help/CheckForUpdates/`): pure logic in its own file, platform programs (`curl`, `ditto`/`tar`/`python3`, `base64`) run through `QProcess` via the updater's `UpdateRun.run`. The receiver is two Apps Script files in `tools/feedback-receiver/`, its logic tested under `node`.

**Tech Stack:** Qt 6 C++ (`src/core`, `src/gui`), CaveCAD's QJSEngine script layer, Python 3 unittest, Node `node:test`, Google Apps Script, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-27-send-feedback-design.md`

**User decisions (already made):**
- "B" — anyone who downloads CaveCAD can send; only the maintainer and people they trust read.
- Reports land in Google Drive, not GitHub.
- "C" — drawing attached by default-off checkbox; survey files and scans separately opt-in; scans are the bloat, so None is the default and a keyword hint suggests them.
- Replace Help > Report Bug ("don't send bug reports to QCAD").
- "YES, a log file will be most invaluable" — the session log records HOW the user got there.
- On send failure: tell them a copy is saved and can be emailed directly.
- Official address: cavecad.app@gmail.com; it owns the receiver, folder and Sheet.
- A privacy policy (a notice, nothing to accept); nothing additional required to use the software.

---

## Engine facts every script task relies on

Measured for the updater (see headers of `scripts/Help/CheckForUpdates/CcUpdateRun.js`, `CheckForUpdates.js`):

- No networking, hashing or zip in the script engine: platform programs via `QProcess` (`UpdateRun.run(command, timeoutS, done)`; `done({ok, code, stdout, error})`).
- `String(qbytearray)` yields `"QByteArray [JS]"`; decode with `UpdateRun.decode(qba)`. `new QByteArray("text")` is EMPTY; write files with plain strings: `f.write(s)`.
- A static named `apply`, `call`, `bind`, `name`, `length` on a `function X(){}` silently does not take. `tests/test_updater_structure.py` guards the updater directory; Task 6 extends it to SendFeedback.
- A `QMessageBox` button from `addButton()` is a fresh wrapper each time; tell buttons apart by `objectName`.
- Windows programs are absolute under `%SystemRoot%`: `UpdateCommands.winProgram("curl.exe")`.
- File pickers: Qt's own, never native (`QFileDialog.DontUseNativeDialog`).

Local build and run (macOS): `ninja` at the repo root builds `debug/CaveCAD.app`. Only `.cpp` files and a NEW header that qcadjsapi does not include are touched in C++ here, so the qcadjsapi tree needs no rebuild. After deploying to `/Applications` run `codesign --force --deep --sign - /Applications/CaveCAD.app`.

## File structure

| File | Responsibility |
|---|---|
| `src/core/RSessionLog.h/.cpp` (new) | open, write, flush, rotate, trim the session log |
| `src/core/RMainWindow.cpp` | hand every message to `RSessionLog::write` |
| `src/core/RGuiAction.cpp` | `[crumb] action:` |
| `src/core/RDocumentInterface.cpp` | `[crumb] open:`, `save:`, `export copy:`, `undo:`, `redo:` |
| `src/gui/RMdiChildQt.cpp` | `[crumb] close:` |
| `scripts/Help/SendFeedback/FeedbackConfig.js` | ENDPOINT, KEY (CI-injected), EMAIL |
| `scripts/Help/SendFeedback/FeedbackCore.js` | pure logic: ids, names, size verdict, scan hint, filters, report.json, mailto, reply parsing, outbox bookkeeping |
| `scripts/Help/SendFeedback/FeedbackCommands.js` | `{program,args}` builders: zip, base64, post, reveal |
| `scripts/Help/SendFeedback/FeedbackPackage.js` | staging: logs, screenshot, drawing copy, cave files, scans, report.json, zip |
| `scripts/Help/SendFeedback/FeedbackSend.js` | base64 + POST, outbox queue and retry |
| `scripts/Help/SendFeedback/SendFeedback.js` + `SendFeedbackDialog.ui` + `SendFeedbackInit.js` + `SendFeedbackPostInit.js` | action, dialog, failure dialog, startup retry + session crumb |
| `tools/feedback-receiver/Logic.gs`, `Code.gs`, `README.md`, `test/logic.test.js` | receiver |
| `tools/inject_feedback_config.py` | CI secret injection |
| `PRIVACY.md` | privacy policy |
| tests: `tests/test_session_log.py`, `tests/sessionlog/emit.js`, `tests/feedback/*_test.js`, `tests/feedback/run.sh`, `tests/test_feedback_config.py` | |

---

### Task 1: Session log file

**Goal:** Every Qt message except debug noise is appended, flushed, to `<data>/logs/session-<yyyyMMdd-HHmmss>.log`, with a header line; five logs kept; a log over its cap is halved keeping the header.

**Files:**
- Create: `src/core/RSessionLog.h`, `src/core/RSessionLog.cpp`
- Modify: `src/core/CMakeLists.txt` (source list, beside `RSettings.cpp RSettings.h` at line ~138)
- Modify: `src/core/RMainWindow.cpp:84` (Qt 5.5+/6 `messageHandler`)
- Create: `tests/sessionlog/emit.js`, `tests/test_session_log.py`

**Acceptance Criteria:**
- [ ] A headless launch creates exactly one new `session-*.log` whose first line starts `# CaveCAD `.
- [ ] A `qWarning("[crumb] probe")` from script appears as a line ending `[crumb] probe` and is readable from the file before the process exits (flushed).
- [ ] Six launches against an empty `CAVECAD_LOG_DIR` leave five logs, the oldest gone.
- [ ] With `CAVECAD_LOG_CAP=4096` and 500 probe lines, the file stays ≤ 4096 + one line, still starts with the header, and ends with the last probe.
- [ ] `QtDebugMsg` lines are not written.

**Known deviation from the spec:** GPU/OpenGL info is not in the header. Core has no GL context when the first message arrives; the screen size and scale go into the `[crumb] session:` line (Task 7) instead.

**Verify:** `ninja && python3 -m unittest tests.test_session_log -v` → `OK`

**Steps:**

- [ ] **Step 1: Write the headless emitter**

`tests/sessionlog/emit.js` — run with `-autostart tests/sessionlog/emit.js <repo> <count>`:

```js
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
```

- [ ] **Step 2: Write the failing test**

`tests/test_session_log.py`:

```python
"""Session log (src/core/RSessionLog): run CaveCAD headless and inspect
the files it leaves. Needs a built binary: debug/CaveCAD.app, or CAVECAD.

    python3 -m unittest tests.test_session_log -v
"""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


def binary():
    for c in (os.environ.get("CAVECAD", ""),
              str(REPO / "debug/CaveCAD.app/Contents/MacOS/CaveCAD"),
              "/Applications/CaveCAD.app/Contents/MacOS/CaveCAD"):
        if c and os.access(c, os.X_OK):
            return c
    raise unittest.SkipTest("no CaveCAD binary; set CAVECAD")


def launch(log_dir, count=1, cap=None, script="tests/sessionlog/emit.js", extra=()):
    env = dict(os.environ, CAVECAD_LOG_DIR=str(log_dir))
    if cap is not None:
        env["CAVECAD_LOG_CAP"] = str(cap)
    if sys.platform.startswith("linux"):
        env.setdefault("QT_QPA_PLATFORM", "offscreen")
    out = subprocess.run(
        [binary(), "-no-dock-icon", "-no-gui", "-allow-multiple-instances",
         "-autostart", str(REPO / script), str(REPO), str(count), *extra],
        env=env, capture_output=True, text=True, timeout=120)
    return out.stdout


def logs(d):
    return sorted(p for p in Path(d).glob("session-*.log"))


class TestSessionLog(unittest.TestCase):
    def test_header_and_flushed_crumb(self):
        with tempfile.TemporaryDirectory() as d:
            out = launch(d)
            self.assertIn("SESSIONLOG OK", out)
            files = logs(d)
            self.assertEqual(1, len(files))
            text = files[0].read_text(encoding="utf-8")
            self.assertTrue(text.startswith("# CaveCAD "), text[:80])
            self.assertRegex(text, r"\n\d\d:\d\d:\d\d\.\d{3} W \[crumb\] probe 0\n")

    def test_keeps_five(self):
        with tempfile.TemporaryDirectory() as d:
            for _ in range(6):
                launch(d)
            self.assertEqual(5, len(logs(d)))

    def test_cap_halves_and_keeps_header(self):
        with tempfile.TemporaryDirectory() as d:
            launch(d, count=500, cap=4096)
            path = logs(d)[-1]
            text = path.read_text(encoding="utf-8")
            self.assertLessEqual(path.stat().st_size, 4096 + 200)
            self.assertTrue(text.startswith("# CaveCAD "))
            self.assertTrue(text.rstrip("\n").endswith("[crumb] probe 499"))

    def test_debug_lines_not_written(self):
        with tempfile.TemporaryDirectory() as d:
            launch(d)
            self.assertNotIn("debug-probe", logs(d)[-1].read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 3: Run it to see it fail**

Run: `python3 -m unittest tests.test_session_log -v`
Expected: FAIL — no `session-*.log` created (`0 != 1`).

- [ ] **Step 4: Write `src/core/RSessionLog.h`**

```cpp
#ifndef RSESSIONLOG_H
#define RSESSIONLOG_H

#include "core_global.h"

#include <QByteArray>
#include <QMutex>
#include <QString>
#include <QtGlobal>

class QFile;

/**
 * Per-launch log for Send Feedback: every Qt message the main window's
 * handler sees, except debug noise, plus "[crumb]" breadcrumbs, one line
 * each, flushed at once so a crash still leaves the log on disk.
 *
 * <data location>/logs/session-<yyyyMMdd-HHmmss>.log; the newest KEEP
 * logs survive each launch. CAVECAD_LOG_DIR and CAVECAD_LOG_CAP (bytes)
 * override the folder and the cap -- for tests.
 */
class QCADCORE_EXPORT RSessionLog {
public:
    static void write(QtMsgType type, const QString& message);

    /** "HH:mm:ss.zzz T message\n", T one of I W C F. */
    static QByteArray format(QtMsgType type, const QString& message, const QString& time);
    /** Deletes all but the newest `keep` session-*.log files in dir. */
    static void rotate(const QString& dir, int keep);
    /** content with its body (after headerBytes) cut to the newest half, starting on a line. */
    static QByteArray trimmed(const QByteArray& content, int headerBytes);

    static const int KEEP = 5;
    static const qint64 CAP = 2 * 1024 * 1024;

private:
    static bool open();
    static QByteArray header();

    static QMutex mutex;
    static QFile* file;
    static bool failed;
    static bool busy;
    static int headerBytes;
    static qint64 cap;
};

#endif
```

- [ ] **Step 5: Write `src/core/RSessionLog.cpp`**

```cpp
#include "RSessionLog.h"

#include "RSettings.h"

#include <QCoreApplication>
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QLocale>
#include <QMutexLocker>
#include <QSysInfo>

QMutex RSessionLog::mutex;
QFile* RSessionLog::file = NULL;
bool RSessionLog::failed = false;
bool RSessionLog::busy = false;
int RSessionLog::headerBytes = 0;
qint64 RSessionLog::cap = RSessionLog::CAP;

QByteArray RSessionLog::format(QtMsgType type, const QString& message, const QString& time) {
    char t = 'I';
    switch (type) {
    case QtWarningMsg: t = 'W'; break;
    case QtCriticalMsg: t = 'C'; break;
    case QtFatalMsg: t = 'F'; break;
    default: t = 'I'; break;
    }
    QString m = message;
    m.replace('\n', QLatin1String("\n    "));
    return (time + " " + QChar(t) + " " + m + "\n").toUtf8();
}

void RSessionLog::rotate(const QString& dir, int keep) {
    QDir d(dir);
    QStringList names = d.entryList(QStringList() << "session-*.log", QDir::Files, QDir::Name);
    for (int i = 0; i < names.size() - keep; i++) {
        d.remove(names.at(i));
    }
}

QByteArray RSessionLog::trimmed(const QByteArray& content, int hb) {
    QByteArray head = content.left(hb);
    QByteArray body = content.mid(hb);
    int from = body.size() / 2;
    int nl = body.indexOf('\n', from);
    return head + (nl < 0 ? QByteArray() : body.mid(nl + 1));
}

QByteArray RSessionLog::header() {
    return QString("# CaveCAD %1 | Qt %2 | %3 | %4 | %5 | started %6\n")
        .arg(RSettings::getVersionString())
        .arg(qVersion())
        .arg(QSysInfo::prettyProductName())
        .arg(QSysInfo::currentCpuArchitecture())
        .arg(QLocale::system().name())
        .arg(QDateTime::currentDateTime().toString(Qt::ISODate))
        .toUtf8();
}

bool RSessionLog::open() {
    if (file != NULL) {
        return true;
    }
    if (failed || QCoreApplication::instance() == NULL) {
        return false;
    }
    QString dir = qEnvironmentVariable("CAVECAD_LOG_DIR");
    if (dir.isEmpty()) {
        dir = RSettings::getDataLocation() + "/logs";
    }
    bool okCap = false;
    qint64 c = qEnvironmentVariable("CAVECAD_LOG_CAP").toLongLong(&okCap);
    if (okCap && c > 0) {
        cap = c;
    }
    if (!QDir().mkpath(dir)) {
        failed = true;
        return false;
    }
    QString stamp = QDateTime::currentDateTime().toString("yyyyMMdd-HHmmss");
    QString path = dir + "/session-" + stamp + ".log";
    for (int n = 2; QFile::exists(path); n++) {
        path = dir + "/session-" + stamp + "-" + QString::number(n) + ".log";
    }
    file = new QFile(path);
    if (!file->open(QIODevice::WriteOnly | QIODevice::Append)) {
        delete file;
        file = NULL;
        failed = true;
        return false;
    }
    rotate(dir, KEEP);
    QByteArray h = header();
    headerBytes = h.size();
    file->write(h);
    file->flush();
    return true;
}

void RSessionLog::write(QtMsgType type, const QString& message) {
    if (type == QtDebugMsg) {
        return;
    }
    QMutexLocker lock(&mutex);
    // anything logged while opening (RSettings, QDir) must not recurse
    if (busy) {
        return;
    }
    busy = true;
    if (open()) {
        file->write(format(type, message, QTime::currentTime().toString("HH:mm:ss.zzz")));
        file->flush();
        if (file->size() > cap) {
            QString path = file->fileName();
            file->close();
            QFile in(path);
            QByteArray all;
            if (in.open(QIODevice::ReadOnly)) {
                all = in.readAll();
                in.close();
            }
            if (file->open(QIODevice::WriteOnly | QIODevice::Truncate)) {
                file->write(trimmed(all, headerBytes));
                file->flush();
                file->close();
            }
            if (!file->open(QIODevice::WriteOnly | QIODevice::Append)) {
                delete file;
                file = NULL;
                failed = true;
            }
        }
    }
    busy = false;
}
```

- [ ] **Step 6: Register and call it**

`src/core/CMakeLists.txt` — add beside `RSettings.cpp RSettings.h`:

```cmake
    RSessionLog.cpp RSessionLog.h
```

`src/core/RMainWindow.cpp` — add `#include "RSessionLog.h"` with the other includes, and as the first statement of `void RMainWindow::messageHandler(QtMsgType type, const QMessageLogContext& context, const QString& message)`:

```cpp
    RSessionLog::write(type, message);
```

- [ ] **Step 7: Build and pass**

Run: `ninja && python3 -m unittest tests.test_session_log -v`
Expected: 4 tests `OK`. If `test_cap_halves_and_keeps_header` fails by a few bytes, the 200-byte slack is one line; do not raise it past one line's length.

- [ ] **Step 8: Commit**

```bash
git add src/core/RSessionLog.h src/core/RSessionLog.cpp src/core/CMakeLists.txt src/core/RMainWindow.cpp tests/sessionlog/emit.js tests/test_session_log.py
git commit -m "feat(log): per-launch session log for Send Feedback"
```

---

### Task 2: Breadcrumbs

**Goal:** The log records what the user did: every action trigger, open, save, export copy, undo, redo and window close.

**Files:**
- Modify: `src/core/RGuiAction.cpp` (`bool RGuiAction::slotTrigger(const QString& command)`)
- Modify: `src/core/RDocumentInterface.cpp` (`importFile` after a successful import ~line 1347; `exportFile` inside `if (success)` ~line 1415; `undo()` ~1464; `redo()` ~1493)
- Modify: `src/gui/RMdiChildQt.cpp` (`closeEvent`, after `emit closeAccepted(this);`)
- Create: `tests/sessionlog/crumbs.js`
- Modify: `tests/test_session_log.py`

**Acceptance Criteria:**
- [ ] Triggering an `RGuiAction` titled `Crumb &Probe` logs `[crumb] action: Crumb Probe`.
- [ ] Saving logs `[crumb] save: <path>`; `exportFile(path, "", false)` logs `[crumb] export copy: <path>`; opening logs `[crumb] open: <path> (<n> entities)`.
- [ ] `undo()` logs a line starting `[crumb] undo:`; `redo()` one starting `[crumb] redo:`.
- [ ] Closing a drawing window logs `[crumb] close: <path>` (verified live in Task 12).

**Verify:** `ninja && python3 -m unittest tests.test_session_log -v` → `OK` (5 tests)

**Steps:**

- [ ] **Step 1: Write the crumb driver**

`tests/sessionlog/crumbs.js`:

```js
// Drives every headless crumb source once. The test reads the log.
var tmp = QDir.tempPath() + "/cc-crumbs";
(new QDir(tmp)).removeRecursively();
(new QDir()).mkpath(tmp);

var a = new RGuiAction("Crumb &Probe", null);
a.slotTrigger();

var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexSimple());
var di = new RDocumentInterface(doc);
di.applyOperation(new RAddObjectOperation(
    new RLineEntity(doc, new RLineData(new RVector(0, 0), new RVector(1, 1))), false));
di.exportFile(tmp + "/saved.dxf", "", true);
di.exportFile(tmp + "/copy.dxf", "", false);
di.undo();
di.redo();

var doc2 = new RDocument(new RMemoryStorage(), new RSpatialIndexSimple());
var di2 = new RDocumentInterface(doc2);
di2.importFile(tmp + "/saved.dxf");
print("CRUMBS DONE");
```

- [ ] **Step 2: Add the failing test** to `TestSessionLog` in `tests/test_session_log.py`:

```python
    def test_crumbs(self):
        with tempfile.TemporaryDirectory() as d:
            out = launch(d, script="tests/sessionlog/crumbs.js")
            self.assertIn("CRUMBS DONE", out)
            text = logs(d)[-1].read_text(encoding="utf-8")
            self.assertIn("[crumb] action: Crumb Probe", text)
            self.assertRegex(text, r"\[crumb\] save: .*/cc-crumbs/saved\.dxf\n")
            self.assertRegex(text, r"\[crumb\] export copy: .*/cc-crumbs/copy\.dxf\n")
            self.assertRegex(text, r"\[crumb\] undo:")
            self.assertRegex(text, r"\[crumb\] redo:")
            self.assertRegex(text, r"\[crumb\] open: .*/cc-crumbs/saved\.dxf \(1 entities\)\n")
```

Run: `python3 -m unittest tests.test_session_log.TestSessionLog.test_crumbs -v`
Expected: FAIL — `'[crumb] action: Crumb Probe' not found`. (If it fails with `CRUMBS DONE` missing instead, read the script's stderr: a binding such as `new RGuiAction(text, null)` is missing. Replace that source's check with the live check in Task 12 and note it in the commit message; do not delete the other assertions.)

- [ ] **Step 3: Add the crumbs**

`src/core/RGuiAction.cpp`, first lines of `slotTrigger(const QString& command)`:

```cpp
    {
        QString t = text();
        t.remove('&');
        if (t.isEmpty()) {
            t = QFileInfo(scriptFile).completeBaseName();
        }
        qInfo().noquote() << "[crumb] action:" << t;
    }
```

(add `#include <QFileInfo>` if not present.)

`src/core/RDocumentInterface.cpp`:

In `importFile`, in the success branch right after `document.setModified(false);`:

```cpp
        qInfo().noquote() << "[crumb] open:" << fileName
                          << QString("(%1 entities)").arg(document.queryAllEntities(false, true).size());
```

In `exportFile`, first line inside `if (success) {`:

```cpp
        qInfo().noquote() << (resetModified ? "[crumb] save:" : "[crumb] export copy:") << fileName;
```

In `undo()`, inside the loop's `if (i==0 && mainWindow!=NULL)` block's sibling — add before that `if`:

```cpp
        if (i == 0) {
            qInfo().noquote() << "[crumb] undo:" << t[i].getText();
        }
```

In `redo()`, before `if (i==t.length()-1 && mainWindow!=NULL)`:

```cpp
        if (i == t.length() - 1) {
            qInfo().noquote() << "[crumb] redo:" << t[i].getText();
        }
```

`src/gui/RMdiChildQt.cpp`, right after `emit closeAccepted(this);`:

```cpp
        qInfo().noquote() << "[crumb] close:" << documentInterface->getDocument().getFileName();
```

- [ ] **Step 4: Build and pass**

Run: `ninja && python3 -m unittest tests.test_session_log -v`
Expected: 5 tests `OK`.

- [ ] **Step 5: Commit**

```bash
git add src/core/RGuiAction.cpp src/core/RDocumentInterface.cpp src/gui/RMdiChildQt.cpp tests/sessionlog/crumbs.js tests/test_session_log.py
git commit -m "feat(log): breadcrumbs for actions, open, save, undo, redo, close"
```

---

### Task 3: Feedback core logic

**Goal:** All of Send Feedback's decisions as pure functions, tested headless.

**Files:**
- Create: `scripts/Help/SendFeedback/FeedbackConfig.js`, `scripts/Help/SendFeedback/FeedbackCore.js`
- Create: `tests/feedback/run.sh`, `tests/feedback/core_test.js`
- Modify: `tests/updater/run_ci.py:24` (also run `tests/feedback/*_test.js`)

**Acceptance Criteria:**
- [ ] `newId` gives 6 lowercase hex chars; `zipName("2026-09-27","a7f3c2")` = `feedback-2026-09-27-a7f3c2.zip`.
- [ ] `sizeVerdict`: 20 MB → `ok`, 20 MB + 1 → `warn`, 30 MB + 1 → `block`; `tooBigToEmail(25 MB + 1)` true.
- [ ] `mentionsScan` true for each of scan, scanned, sketch, image, picture, PDF, trim, outline; false for "the ledge tool crashed".
- [ ] `isScanFile` true for png/jpg/jpeg/tif/tiff/bmp/gif/webp/pdf (any case); `surveyFiles` drops those and dotfiles.
- [ ] `validate` rejects empty summary, and empty description only for type `bug`.
- [ ] `report()` output has every spec field; `mailto()` has subject `CaveCAD Feedback <id>: <summary>`.
- [ ] `configured()` false for the repo placeholders; `parseReply` handles good JSON, bad JSON and empty.
- [ ] Outbox: third `recordFailure` on one file makes `needsNotice` true; `recordSuccess` removes it.

**Verify:** `tests/feedback/run.sh` → `### UPDATER OK <n> (core)`

**Steps:**

- [ ] **Step 1: Test runner**

`tests/feedback/run.sh` (make executable):

```sh
#!/bin/sh
# Runs every tests/feedback/*_test.js inside CaveCAD's own engine, headless.
# Shares tests/updater/harness.js (its result marker is "### UPDATER").
cd "$(dirname "$0")/../.." || exit 1
REPO="$PWD"
for c in "${CAVECAD:-}" debug/CaveCAD.app/Contents/MacOS/CaveCAD \
         /Applications/CaveCAD.app/Contents/MacOS/CaveCAD; do
    [ -n "$c" ] && [ -x "$c" ] && APP="$c" && break
done
[ -n "${APP:-}" ] || { echo "no CaveCAD binary found; set CAVECAD"; exit 2; }
status=0
for t in tests/feedback/*_test.js; do
    out=$("$APP" -no-dock-icon -no-gui -allow-multiple-instances \
          -autostart "$REPO/$t" "$REPO" 2>/dev/null | grep -A200 '### UPDATER' | grep -E '^(### UPDATER|  )')
    echo "${out:-### UPDATER FAIL no output ($t)}"
    case "$out" in *"UPDATER OK"*) ;; *) status=1 ;; esac
done
exit $status
```

`tests/updater/run_ci.py` line 24 becomes:

```python
    tests = sorted((repo / "tests" / "updater").glob("*_test.js")) + \
        sorted((repo / "tests" / "feedback").glob("*_test.js"))
```

- [ ] **Step 2: Failing test**

`tests/feedback/core_test.js`:

```js
include(RSettings.getOriginalArguments()[RSettings.getOriginalArguments().indexOf("-autostart") + 2] + "/tests/updater/harness.js");
load("scripts/Help/SendFeedback/FeedbackConfig.js");
load("scripts/Help/SendFeedback/FeedbackCore.js");

var MB = 1024 * 1024;
var seq = [0, 0.1, 0.99, 0.5, 0.25, 0.75], k = 0;
eqs(FeedbackCore.newId(function() { return seq[k++]; }), "01f84c", "id from 6 draws");
ok(/^[0-9a-f]{6}$/.test(FeedbackCore.newId()), "random id is 6 hex");
eqs(FeedbackCore.zipName("2026-09-27", "a7f3c2"), "feedback-2026-09-27-a7f3c2.zip", "zip name");

eqs(FeedbackCore.sizeVerdict(20 * MB), "ok", "20 MB ok");
eqs(FeedbackCore.sizeVerdict(20 * MB + 1), "warn", "over 20 MB warns");
eqs(FeedbackCore.sizeVerdict(30 * MB + 1), "block", "over 30 MB blocks");
ok(FeedbackCore.tooBigToEmail(25 * MB + 1) && !FeedbackCore.tooBigToEmail(25 * MB), "email limit 25 MB");

["scan", "The scanned page", "sketch", "Image", "picture", "PDF", "trim", "outline"].forEach(function(w) {
    ok(FeedbackCore.mentionsScan("my " + w + " is wrong"), "hint on " + w);
});
ok(!FeedbackCore.mentionsScan("the ledge tool crashed"), "no hint without a scan word");

["a.PNG", "b.jpg", "c.jpeg", "d.tif", "e.tiff", "f.bmp", "g.gif", "h.webp", "i.Pdf"].forEach(function(n) {
    ok(FeedbackCore.isScanFile("dir/" + n), "scan file " + n);
});
ok(!FeedbackCore.isScanFile("cave.dxf"), "dxf is not a scan");
eqs(FeedbackCore.surveyFiles(["cave.dxf", "trip1.svx", "scans/p1.png", ".DS_Store", "notes/a.txt", "x.pdf"]).join(","),
    "cave.dxf,trip1.svx,notes/a.txt", "survey files drop scans and dotfiles");

eqs(FeedbackCore.validate({ type: "bug", summary: "", description: "x" }).join("|"), "summary", "summary required");
eqs(FeedbackCore.validate({ type: "bug", summary: "s", description: " " }).join("|"), "description", "bug needs description");
eqs(FeedbackCore.validate({ type: "idea", summary: "s", description: "" }).length, 0, "idea may skip description");

var r = FeedbackCore.report({
    id: "a7f3c2", type: "bug", summary: "s", description: "d", email: "",
    version: "3.33.0.0", commit: "abc", caveSurvey: "0.9.181.2", os: "macOS 26",
    activeTool: "FeatureTrace", documents: ["Pitfall.dxf"],
    attachments: [{ path: "logs/session-1.log", bytes: 10 }],
    consent: { drawing: true, surveyFiles: false, scans: "none" }, created: "2026-09-27T20:00:00"
});
eqs(Object.keys(r).join(","),
    "schema,id,type,summary,description,email,cavecad,caveSurvey,os,activeTool,documents,attachments,consent,created",
    "report fields");
eqs(r.cavecad.commit, "abc", "commit kept");
eqs(r.consent.scans, "none", "consent kept");

var m = FeedbackCore.mailto("cavecad.app@gmail.com", "a7f3c2", "Trace & crash");
ok(m.indexOf("mailto:cavecad.app@gmail.com?subject=") === 0, "mailto address");
ok(m.indexOf(encodeURIComponent("CaveCAD Feedback a7f3c2: Trace & crash")) > 0, "mailto subject encoded");

ok(!FeedbackCore.configured(FeedbackConfig), "repo placeholders are not configured");
ok(FeedbackCore.configured({ ENDPOINT: "https://script.google.com/macros/s/X/exec", KEY: "k" }), "real endpoint configured");
eqs(FeedbackCore.parseReply('{"ok":true,"id":"a7f3c2"}').id, "a7f3c2", "good reply");
ok(!FeedbackCore.parseReply("<html>").ok, "html reply is a failure");
ok(!FeedbackCore.parseReply("").ok, "empty reply is a failure");

var st = {};
FeedbackCore.recordFailure(st, "f.zip"); FeedbackCore.recordFailure(st, "f.zip");
ok(!FeedbackCore.needsNotice(st), "two failures: no notice");
FeedbackCore.recordFailure(st, "f.zip");
ok(FeedbackCore.needsNotice(st), "third failure: notice");
FeedbackCore.recordSuccess(st, "f.zip");
ok(!st.hasOwnProperty("f.zip"), "success forgets the file");
finish("core");
```

Run: `tests/feedback/run.sh` — Expected: `### UPDATER FAIL no output (tests/feedback/core_test.js)` (files missing).

- [ ] **Step 3: Implement**

`scripts/Help/SendFeedback/FeedbackConfig.js`:

```js
// FeedbackConfig.js -- where Send Feedback reports go. CI replaces the two
// @@ placeholders from GitHub Actions secrets before the build
// (tools/inject_feedback_config.py); a local build keeps them and cannot
// send, only save. tests/test_feedback_config.py fails if real values are
// ever committed here.
var FeedbackConfig = {
    ENDPOINT: "@@FEEDBACK_ENDPOINT@@",
    KEY: "@@FEEDBACK_KEY@@",
    EMAIL: "cavecad.app@gmail.com"
};
```

`scripts/Help/SendFeedback/FeedbackCore.js`:

```js
// FeedbackCore.js -- Send Feedback's decisions, free of UI, files and
// processes, so tests/feedback/core_test.js can check every one.

var FeedbackCore = {};

FeedbackCore.MB = 1024 * 1024;
FeedbackCore.WARN_BYTES = 20 * FeedbackCore.MB;    // base64 makes the POST a third bigger
FeedbackCore.BLOCK_BYTES = 30 * FeedbackCore.MB;   // stays under the receiver's 40 MB body cap
FeedbackCore.EMAIL_BYTES = 25 * FeedbackCore.MB;   // Gmail's attachment limit
FeedbackCore.NOTICE_AFTER = 3;                     // failed launches before the status-bar notice
FeedbackCore.TYPES = ["bug", "idea", "question"];
FeedbackCore.SCAN_EXT = ["png", "jpg", "jpeg", "tif", "tiff", "bmp", "gif", "webp", "pdf"];
FeedbackCore.SCAN_WORDS = /\b(scan|sketch|image|picture|pdf|trim|outline)\w*/i;

FeedbackCore.newId = function(rand) {
    rand = rand || Math.random;
    var s = "";
    for (var i = 0; i < 6; i++) { s += "0123456789abcdef".charAt(Math.floor(rand() * 16)); }
    return s;
};

FeedbackCore.zipName = function(date, id) { return "feedback-" + date + "-" + id + ".zip"; };

FeedbackCore.sizeVerdict = function(bytes) {
    if (bytes > FeedbackCore.BLOCK_BYTES) { return "block"; }
    return bytes > FeedbackCore.WARN_BYTES ? "warn" : "ok";
};

FeedbackCore.tooBigToEmail = function(bytes) { return bytes > FeedbackCore.EMAIL_BYTES; };

FeedbackCore.mentionsScan = function(text) { return FeedbackCore.SCAN_WORDS.test(String(text || "")); };

FeedbackCore.isScanFile = function(path) {
    var m = /\.([^.\/\\]+)$/.exec(String(path));
    return m !== null && FeedbackCore.SCAN_EXT.indexOf(m[1].toLowerCase()) >= 0;
};

/** Relative paths of a cave folder -> the ones that are survey files (no scans, no dotfiles). */
FeedbackCore.surveyFiles = function(relPaths) {
    return relPaths.filter(function(p) {
        var base = String(p).replace(/^.*[\/\\]/, "");
        return base.charAt(0) !== "." && !FeedbackCore.isScanFile(p);
    });
};

/** Names of the missing required fields: "summary", "description". */
FeedbackCore.validate = function(f) {
    var out = [];
    if (String(f.summary || "").trim() === "") { out.push("summary"); }
    if (f.type === "bug" && String(f.description || "").trim() === "") { out.push("description"); }
    return out;
};

FeedbackCore.report = function(f) {
    return {
        schema: 1,
        id: f.id,
        type: f.type,
        summary: f.summary,
        description: f.description,
        email: f.email,
        cavecad: { version: f.version, commit: f.commit },
        caveSurvey: f.caveSurvey,
        os: f.os,
        activeTool: f.activeTool,
        documents: f.documents,
        attachments: f.attachments,
        consent: f.consent,
        created: f.created
    };
};

FeedbackCore.mailto = function(email, id, summary) {
    return "mailto:" + email
        + "?subject=" + encodeURIComponent("CaveCAD Feedback " + id + ": " + summary)
        + "&body=" + encodeURIComponent("Please attach the file CaveCAD showed you (it ends in " + id
            + ".zip).\n\nReference: " + id + "\n");
};

FeedbackCore.configured = function(cfg) {
    return /^https:\/\//.test(String(cfg.ENDPOINT)) && String(cfg.KEY).indexOf("@@") < 0 && String(cfg.KEY) !== "";
};

/** Receiver stdout -> {ok, id, error}. */
FeedbackCore.parseReply = function(stdout) {
    try {
        var o = JSON.parse(String(stdout));
        if (o && o.ok === true && /^[0-9a-f]{6}$/.test(String(o.id))) { return { ok: true, id: String(o.id) }; }
        return { ok: false, error: String(o && o.error ? o.error : "refused") };
    } catch (e) {
        return { ok: false, error: "unreadable reply" };
    }
};

// ---- outbox bookkeeping: state is {zipName: {failures: n}} ----
FeedbackCore.recordFailure = function(state, name) {
    state[name] = { failures: (state[name] ? state[name].failures : 0) + 1 };
};
FeedbackCore.recordSuccess = function(state, name) { delete state[name]; };
FeedbackCore.needsNotice = function(state) {
    for (var n in state) {
        if (state.hasOwnProperty(n) && state[n].failures >= FeedbackCore.NOTICE_AFTER) { return true; }
    }
    return false;
};
```

- [ ] **Step 4: Pass** — Run: `tests/feedback/run.sh` → `### UPDATER OK 43 (core)` (count may differ; zero failures is the criterion).

- [ ] **Step 5: Commit**

```bash
git add scripts/Help/SendFeedback/FeedbackConfig.js scripts/Help/SendFeedback/FeedbackCore.js tests/feedback tests/updater/run_ci.py
git commit -m "feat(feedback): core logic and headless tests"
```

---

### Task 4: Platform command builders

**Goal:** `{program, args[, env]}` for zipping a staging folder, base64-encoding a file, POSTing it, and revealing a file, on macOS, Windows and Linux; zip and base64 proven by running them.

**Files:**
- Create: `scripts/Help/SendFeedback/FeedbackCommands.js`
- Create: `tests/feedback/commands_test.js`

**Acceptance Criteria:**
- [ ] macOS zip is `/usr/bin/ditto -c -k <dir> <out>`; Windows `…\System32\tar.exe -a -c -f <out> -C <dir> .`; Linux a `python3` walk writing paths relative to the folder.
- [ ] Post args contain `-sS -L --proto =https --proto-redir =https`, `--data-binary @<body>`, `-o <out>` and the URL last; Windows program is `…\System32\curl.exe`.
- [ ] Running zip on this machine produces an archive whose unzipped `report.json` equals the original; running base64 then decoding (`base64 -D`/python) returns the original bytes.
- [ ] Paths never spliced into command text (Windows base64 uses env vars).

**Verify:** `tests/feedback/run.sh` → `### UPDATER OK … (commands)`

**Steps:**

- [ ] **Step 1: Failing test** — `tests/feedback/commands_test.js`:

```js
include(RSettings.getOriginalArguments()[RSettings.getOriginalArguments().indexOf("-autostart") + 2] + "/tests/updater/harness.js");
load("scripts/Help/CheckForUpdates/CcUpdateCommands.js");
load("scripts/Help/CheckForUpdates/CcUpdateRun.js");
load("scripts/Help/SendFeedback/FeedbackCommands.js");

var realWinRoot = UpdateCommands.winRoot;
UpdateCommands.winRoot = function() { return "D:\\Win"; };
eqs(FeedbackCommands.zip("osx", "/s/a b", "/o/r.zip").args.join("|"), "-c|-k|/s/a b|/o/r.zip", "macOS ditto");
eqs(FeedbackCommands.zip("osx", "/s", "/o").program, "/usr/bin/ditto", "macOS ditto path");
eqs(FeedbackCommands.zip("win", "C:/s", "C:/o.zip").program, "D:\\Win\\System32\\tar.exe", "Windows tar");
eqs(FeedbackCommands.zip("win", "C:/s", "C:/o.zip").args.join("|"), "-a|-c|-f|C:/o.zip|-C|C:/s|.", "Windows tar args");
eqs(FeedbackCommands.zip("linux", "/s", "/o").program, "python3", "Linux python zip");
var p = FeedbackCommands.post("osx", "https://h/x?k=1", "/b", "/o");
eqs(p.program, "/usr/bin/curl", "macOS curl");
eqs(p.args.slice(0, 6).join("|"), "-sS|-L|--proto|=https|--proto-redir|=https", "https only, follows the 302");
ok(p.args.join("|").indexOf("--data-binary|@/b") >= 0, "body from file");
eqs(p.args[p.args.length - 1], "https://h/x?k=1", "url last");
eqs(FeedbackCommands.post("win", "https://h", "C:/b", "C:/o").program, "D:\\Win\\System32\\curl.exe", "Windows curl");
var w = FeedbackCommands.base64("win", "C:/it's.zip", "C:/o.b64");
ok(w.args.join(" ").indexOf("it's") < 0, "Windows base64 path not in command text");
eqs(w.env.CAVECAD_FB_IN, "C:/it's.zip", "Windows base64 input via env");
eqs(FeedbackCommands.reveal("osx", "/o/f.zip").args.join("|"), "-R|/o/f.zip", "macOS reveal");
eqs(FeedbackCommands.reveal("win", "C:/o/f.zip").args.join("|"), "/select,C:\\o\\f.zip", "Windows reveal");
UpdateCommands.winRoot = realWinRoot;

// ---- run them for real on this machine ----
var root = QDir.tempPath() + "/cc-fbcmd";
(new QDir(root)).removeRecursively();
(new QDir()).mkpath(root + "/stage/logs");
writeFile(root + "/stage/report.json", '{"id":"a7f3c2"}');
writeFile(root + "/stage/logs/s.log", "line\n");
var loop = new QEventLoop(), r = null;
function run(c) { r = null; UpdateRun.run(c, 60, function(x) { r = x; loop.quit(); }); loop.exec(); return r; }
ok(run(FeedbackCommands.zip(SYS, root + "/stage", root + "/r.zip")).ok, "zip ran: " + (r && r.error));
(new QDir()).mkpath(root + "/out");
ok(run(UpdateCommands.unzip(SYS, root + "/r.zip", root + "/out")).ok, "unzip ran");
var back = readFile(root + "/out/report.json") || readFile(root + "/out/./report.json");
eqs(back, '{"id":"a7f3c2"}', "report.json at the zip root");
ok(readFile(root + "/out/logs/s.log") === "line\n", "subfolders kept");
ok(run(FeedbackCommands.base64(SYS, root + "/r.zip", root + "/r.b64")).ok, "base64 ran: " + (r && r.error));
var dec = SYS === "win" ? psCmd("[IO.File]::WriteAllBytes('" + root + "/d.zip', [Convert]::FromBase64String([IO.File]::ReadAllText('" + root + "/r.b64')))")
    : { program: "python3", args: ["-c", "import base64,sys;open(sys.argv[2],'wb').write(base64.b64decode(open(sys.argv[1]).read()))", root + "/r.b64", root + "/d.zip"] };
ok(run(dec).ok, "decoded");
eqs(new QFileInfo(root + "/d.zip").size(), new QFileInfo(root + "/r.zip").size(), "base64 round trip keeps every byte");
(new QDir(root)).removeRecursively();
finish("commands");
```

Run: `tests/feedback/run.sh` → FAIL (no output for commands).

- [ ] **Step 2: Implement** — `scripts/Help/SendFeedback/FeedbackCommands.js`:

```js
// FeedbackCommands.js -- {program, args[, env]} for the platform programs
// Send Feedback needs, in the updater's style (CcUpdateCommands.js):
// absolute programs, paths always their own argument or, on Windows, an
// environment variable. Requires CcUpdateCommands.js (winProgram, powershell).

var FeedbackCommands = {};

/** Zips the CONTENTS of dir (report.json at the archive root) into out. */
FeedbackCommands.zip = function(system, dir, out) {
    if (UpdateCommands.isWin(system)) {
        return { program: UpdateCommands.winProgram("tar.exe"), args: ["-a", "-c", "-f", out, "-C", dir, "."] };
    }
    if (String(system) === "osx") { return { program: "/usr/bin/ditto", args: ["-c", "-k", dir, out] }; }
    return { program: "python3", args: ["-c",
        "import os, sys, zipfile\n" +
        "z = zipfile.ZipFile(sys.argv[2], 'w', zipfile.ZIP_DEFLATED)\n" +
        "for r, _, fs in os.walk(sys.argv[1]):\n" +
        "    for f in fs:\n" +
        "        p = os.path.join(r, f)\n" +
        "        z.write(p, os.path.relpath(p, sys.argv[1]))\n" +
        "z.close()", dir, out] };
};

/** Base64 of file `inp` written to `out`, no line breaks. */
FeedbackCommands.base64 = function(system, inp, out) {
    if (UpdateCommands.isWin(system)) {
        return { program: UpdateCommands.powershell(), env: { CAVECAD_FB_IN: inp, CAVECAD_FB_OUT: out },
            args: ["-NoProfile", "-NonInteractive", "-Command",
                "[IO.File]::WriteAllText($env:CAVECAD_FB_OUT, [Convert]::ToBase64String([IO.File]::ReadAllBytes($env:CAVECAD_FB_IN)))"] };
    }
    if (String(system) === "osx") { return { program: "/usr/bin/base64", args: ["-i", inp, "-o", out] }; }
    return { program: "python3", args: ["-c",
        "import base64, sys; open(sys.argv[2], 'wb').write(base64.b64encode(open(sys.argv[1], 'rb').read()))", inp, out] };
};

/**
 * POST the file `body` to url; the reply lands in `out`. -L follows Apps
 * Script's 302 (curl turns the POST into the GET that fetches the reply).
 * No -f: a refusal still carries a JSON reply worth reading.
 */
FeedbackCommands.post = function(system, url, body, out) {
    var program = UpdateCommands.isWin(system) ? UpdateCommands.winProgram("curl.exe")
        : (String(system) === "osx" ? "/usr/bin/curl" : "curl");
    return { program: program,
             args: ["-sS", "-L", "--proto", "=https", "--proto-redir", "=https",
                    "--connect-timeout", "30", "--max-time", "600",
                    "-H", "Content-Type: text/plain", "--data-binary", "@" + body,
                    "-o", out, url] };
};

/** Shows the file selected in Finder / Explorer; Linux opens its folder. */
FeedbackCommands.reveal = function(system, path) {
    if (UpdateCommands.isWin(system)) {
        return { program: UpdateCommands.winRoot() + "\\explorer.exe",
                 args: ["/select," + String(path).replace(/\//g, "\\")] };
    }
    if (String(system) === "osx") { return { program: "/usr/bin/open", args: ["-R", path] }; }
    return { program: "xdg-open", args: [String(path).replace(/\/[^\/]*$/, "")] };
};
```

- [ ] **Step 3: Pass** — `tests/feedback/run.sh` → `OK … (commands)`.

- [ ] **Step 4: Commit**

```bash
git add scripts/Help/SendFeedback/FeedbackCommands.js tests/feedback/commands_test.js
git commit -m "feat(feedback): zip, base64, post and reveal commands"
```

---

### Task 5: Report package

**Goal:** Build a report's staging folder (logs, screenshot, drawing copy, survey files, scans, report.json) and zip it, without touching the user's drawing.

**Files:**
- Create: `scripts/Help/SendFeedback/FeedbackPackage.js`
- Create: `tests/feedback/package_test.js`

**Acceptance Criteria:**
- [ ] `latestLogs(dir)` returns the newest two `session-*.log` paths, newest first.
- [ ] `usedScans(doc, docDir)` returns absolute, existing, de-duplicated files behind the document's image entities; relative names resolved against `docDir`.
- [ ] `listFiles(caveDir)` returns relative paths recursively, skipping dotfolders.
- [ ] `copyDrawing(di, path)` writes a DXF and leaves `doc.getFileName()` and `doc.isModified()` unchanged.
- [ ] `stage(opts)` writes `report.json` whose `attachments` lists each staged file with its size, and returns `{dir, bytes, scanBytes}`.
- [ ] `zip(dir, out, done)` produces the archive (via FeedbackCommands).

**Verify:** `tests/feedback/run.sh` → `OK … (package)`

**Steps:**

- [ ] **Step 1: Failing test** — `tests/feedback/package_test.js`:

```js
include(RSettings.getOriginalArguments()[RSettings.getOriginalArguments().indexOf("-autostart") + 2] + "/tests/updater/harness.js");
load("scripts/library.js");
load("scripts/Help/CheckForUpdates/CcUpdateCommands.js");
load("scripts/Help/CheckForUpdates/CcUpdateRun.js");
load("scripts/Help/SendFeedback/FeedbackCore.js");
load("scripts/Help/SendFeedback/FeedbackCommands.js");
load("scripts/Help/SendFeedback/FeedbackPackage.js");

var root = QDir.tempPath() + "/cc-fbpkg";
(new QDir(root)).removeRecursively();
(new QDir()).mkpath(root + "/logs");
["session-20260901-100000.log", "session-20260927-090000.log", "session-20260915-120000.log"].forEach(function(n) {
    writeFile(root + "/logs/" + n, n);
});
eqs(FeedbackPackage.latestLogs(root + "/logs").map(function(p) { return p.replace(/^.*\//, ""); }).join(","),
    "session-20260927-090000.log,session-20260915-120000.log", "two newest logs, newest first");

// a cave folder with a drawing, a survey file, two scans and a dotfolder
(new QDir()).mkpath(root + "/cave/scans");
(new QDir()).mkpath(root + "/cave/.git");
writeFile(root + "/cave/trip1.svx", "*begin");
writeFile(root + "/cave/scans/p1.png", "png1");
writeFile(root + "/cave/scans/p2.png", "png2");
writeFile(root + "/cave/.git/HEAD", "x");
eqs(FeedbackPackage.listFiles(root + "/cave").sort().join(","), "scans/p1.png,scans/p2.png,trip1.svx", "list skips dotfolders");

var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexSimple());
var di = new RDocumentInterface(doc);
var img = new RImageEntity(doc, new RImageData("scans/p1.png", new RVector(0, 0), new RVector(1, 0), new RVector(0, 1), 50, 50, 0));
di.applyOperation(new RAddObjectOperation(img, false));
var img2 = new RImageEntity(doc, new RImageData(root + "/cave/scans/p1.png", new RVector(5, 0), new RVector(1, 0), new RVector(0, 1), 50, 50, 0));
di.applyOperation(new RAddObjectOperation(img2, false));
eqs(FeedbackPackage.usedScans(doc, root + "/cave").join(","), root + "/cave/scans/p1.png", "used scans resolved and de-duplicated");

doc.setFileName(root + "/cave/Pitfall.dxf");
doc.setModified(true);
ok(FeedbackPackage.copyDrawing(di, root + "/copy.dxf"), "drawing copied");
ok(new QFileInfo(root + "/copy.dxf").size() > 0, "copy written");
eqs(String(doc.getFileName()), root + "/cave/Pitfall.dxf", "file name untouched");
ok(doc.isModified(), "modified flag untouched");

var s = FeedbackPackage.stage({
    base: root + "/staging", id: "a7f3c2",
    fields: { type: "bug", summary: "s", description: "d", email: "" },
    meta: { version: "v", commit: "c", caveSurvey: "t", os: "o", activeTool: "a", documents: ["Pitfall.dxf"], created: "2026-09-27T20:00:00" },
    logs: FeedbackPackage.latestLogs(root + "/logs"),
    screenshot: null,
    drawing: root + "/copy.dxf",
    caveDir: root + "/cave", surveyFiles: ["trip1.svx"], scans: [root + "/cave/scans/p1.png"], scanMode: "used"
});
var rep = JSON.parse(readFile(s.dir + "/report.json"));
eqs(rep.attachments.map(function(a) { return a.path; }).sort().join(","),
    "cave/scans/p1.png,cave/trip1.svx,drawing.dxf,logs/session-20260915-120000.log,logs/session-20260927-090000.log",
    "attachments listed");
eqs(rep.consent.scans, "used", "scan consent recorded");
ok(rep.consent.drawing && rep.consent.surveyFiles, "drawing and survey consent recorded");
eqs(s.scanBytes, 4, "scan bytes counted separately");
ok(s.bytes > s.scanBytes, "total bytes include everything");

var loop = new QEventLoop(), zr = null;
FeedbackPackage.zip(s.dir, root + "/r.zip", function(x) { zr = x; loop.quit(); }); loop.exec();
ok(zr.ok && new QFileInfo(root + "/r.zip").size() > 0, "zipped: " + (zr && zr.error));
(new QDir(root)).removeRecursively();
finish("package");
```

Run → FAIL.

- [ ] **Step 2: Implement** — `scripts/Help/SendFeedback/FeedbackPackage.js`:

```js
// FeedbackPackage.js -- stages one report's files and zips them. Never
// writes to the user's drawing or cave folder; copies only.
// Requires FeedbackCore.js, FeedbackCommands.js, CcUpdateCommands.js, CcUpdateRun.js.

var FeedbackPackage = {};

FeedbackPackage.dataDir = function() { return String(RSettings.getDataLocation()).replace(/[\\\/]+$/, ""); };
FeedbackPackage.logDir = function() {
    var o = String(QProcessEnvironment.systemEnvironment().value("CAVECAD_LOG_DIR", ""));
    return o !== "" ? o : FeedbackPackage.dataDir() + "/logs";
};
FeedbackPackage.stagingBase = function() { return FeedbackPackage.dataDir() + "/feedback/staging"; };

/** The two newest session logs, newest first (names sort by time). */
FeedbackPackage.latestLogs = function(dir) {
    var names = new QDir(dir).entryList(["session-*.log"], QDir.Files, QDir.Name);
    var out = [];
    for (var i = names.length - 1; i >= 0 && out.length < 2; i--) { out.push(dir + "/" + names[i]); }
    return out;
};

/** Files behind the document's image entities: absolute, existing, unique. */
FeedbackPackage.usedScans = function(doc, docDir) {
    var ids = doc.queryAllEntities(false, true), seen = {}, out = [];
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || e.getType() !== RS.EntityImage) { continue; }
        var f = String(e.getProperty(RImageEntity.PropertyFileName)[0]);
        if (f === "") { continue; }
        if (new QFileInfo(f).isRelative()) { f = docDir + "/" + f; }
        var abs = String(new QFileInfo(f).absoluteFilePath());
        if (!seen[abs] && new QFileInfo(abs).isFile()) { seen[abs] = true; out.push(abs); }
    }
    return out;
};

/** Relative paths of every file under dir, skipping dot-folders and dotfiles. */
FeedbackPackage.listFiles = function(dir) {
    var out = [];
    (function walk(rel) {
        var d = new QDir(dir + (rel === "" ? "" : "/" + rel));
        var files = d.entryList([], QDir.Files | QDir.NoDotAndDotDot, QDir.Name);
        for (var i = 0; i < files.length; i++) {
            if (String(files[i]).charAt(0) !== ".") { out.push((rel === "" ? "" : rel + "/") + files[i]); }
        }
        var dirs = d.entryList([], QDir.Dirs | QDir.NoDotAndDotDot, QDir.Name);
        for (var j = 0; j < dirs.length; j++) {
            if (String(dirs[j]).charAt(0) !== ".") { walk((rel === "" ? "" : rel + "/") + dirs[j]); }
        }
    })("");
    return out;
};

/** A DXF copy of the in-memory drawing; the document keeps its name and modified flag. */
FeedbackPackage.copyDrawing = function(di, path) {
    var doc = di.getDocument();
    var modified = doc.isModified();
    var ok = di.exportFile(path, "", false);
    doc.setModified(modified);
    return ok === true;
};

FeedbackPackage.copyInto = function(src, dest) {
    (new QDir()).mkpath(String(dest).replace(/\/[^\/]*$/, ""));
    QFile.remove(dest);
    return QFile.copy(src, dest);
};

/**
 * opts: {base, id, fields, meta, logs[], screenshot|null, drawing|null,
 * caveDir|null, surveyFiles[] (relative to caveDir), scans[] (absolute),
 * scanMode "none"|"used"|"chosen"}. Returns {dir, bytes, scanBytes}.
 */
FeedbackPackage.stage = function(o) {
    var dir = o.base + "/" + o.id;
    (new QDir(dir)).removeRecursively();
    (new QDir()).mkpath(dir);
    var att = [], bytes = 0, scanBytes = 0;
    function add(src, rel, isScan) {
        if (!FeedbackPackage.copyInto(src, dir + "/" + rel)) { return; }
        var n = new QFileInfo(dir + "/" + rel).size();
        att.push({ path: rel, bytes: n });
        bytes += n;
        if (isScan) { scanBytes += n; }
    }
    for (var i = 0; i < o.logs.length; i++) { add(o.logs[i], "logs/" + String(o.logs[i]).replace(/^.*[\/\\]/, ""), false); }
    if (o.screenshot) { add(o.screenshot, "screenshot.png", false); }
    if (o.drawing) { add(o.drawing, "drawing.dxf", false); }
    var cave = String(o.caveDir || "").replace(/[\\\/]+$/, "");
    for (var s = 0; s < o.surveyFiles.length; s++) { add(cave + "/" + o.surveyFiles[s], "cave/" + o.surveyFiles[s], false); }
    for (var k = 0; k < o.scans.length; k++) {
        var abs = String(o.scans[k]);
        var rel = cave !== "" && abs.indexOf(cave + "/") === 0 ? abs.substring(cave.length + 1) : "scans/" + abs.replace(/^.*[\/\\]/, "");
        add(abs, "cave/" + rel, true);
    }
    var m = o.meta, f = o.fields;
    var report = FeedbackCore.report({
        id: o.id, type: f.type, summary: f.summary, description: f.description, email: f.email,
        version: m.version, commit: m.commit, caveSurvey: m.caveSurvey, os: m.os,
        activeTool: m.activeTool, documents: m.documents, attachments: att,
        consent: { drawing: !!o.drawing, surveyFiles: o.surveyFiles.length > 0, scans: o.scanMode },
        created: m.created
    });
    var rf = new QFile(dir + "/report.json");
    if (rf.open(QIODevice.WriteOnly)) { rf.write(JSON.stringify(report, null, 2)); rf.close(); }
    return { dir: dir, bytes: bytes, scanBytes: scanBytes };
};

FeedbackPackage.zip = function(dir, out, done) {
    QFile.remove(out);
    UpdateRun.run(FeedbackCommands.zip(RS.getSystemId(), dir, out), 300, done);
};
```

- [ ] **Step 3: Pass** — `tests/feedback/run.sh` → `OK … (package)`. If `new RImageData(...)`'s argument list differs in this binding, read `src/entity/RImageData.h` for the constructor and fix the test's two calls only.

- [ ] **Step 4: Commit**

```bash
git add scripts/Help/SendFeedback/FeedbackPackage.js tests/feedback/package_test.js
git commit -m "feat(feedback): stage and zip a report without touching the drawing"
```

---

### Task 6: Send and outbox

**Goal:** Every packaged zip goes into the outbox first; sending base64-encodes and POSTs it, removing it on success and counting failures; a retry walks the outbox.

**Files:**
- Create: `scripts/Help/SendFeedback/FeedbackSend.js`
- Create: `tests/feedback/send_test.js`
- Modify: `tests/test_updater_structure.py` (check `scripts/Help/SendFeedback` too)

**Acceptance Criteria:**
- [ ] `queue(zip)` moves the zip into `<data>/feedback/outbox/` and returns its new path.
- [ ] `send(path, cfg, done)` with an unconfigured cfg calls `done({ok:false, error:"not-configured"})` without running anything, leaving the zip queued.
- [ ] With a runner stub replying `{"ok":true,"id":"a7f3c2"}`, the zip and its `.b64` are gone and `done({ok:true,id:"a7f3c2"})`.
- [ ] With a stub replying garbage, the zip stays and `outbox.json` shows `failures: 1`.
- [ ] `retryAll` sends each queued zip once, in name order.
- [ ] Structure test covers SendFeedback.

**Verify:** `tests/feedback/run.sh && python3 -m unittest tests.test_updater_structure -v` → all OK

**Steps:**

- [ ] **Step 1: Failing test** — `tests/feedback/send_test.js`:

```js
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
```

Run → FAIL.

- [ ] **Step 2: Implement** — `scripts/Help/SendFeedback/FeedbackSend.js`:

```js
// FeedbackSend.js -- every report waits in the outbox until the receiver
// has it. send() base64-encodes (Apps Script reads POST bodies as text) and
// POSTs with curl; success deletes the zip, failure counts it in
// outbox.json. Requires FeedbackCore, FeedbackCommands, CcUpdateCommands, CcUpdateRun.

var FeedbackSend = {};

FeedbackSend.runner = function(cmd, timeoutS, done) { UpdateRun.run(cmd, timeoutS, done); };
FeedbackSend.outboxDir = function() {
    return String(RSettings.getDataLocation()).replace(/[\\\/]+$/, "") + "/feedback/outbox";
};
FeedbackSend.statePath = function() { return FeedbackSend.outboxDir() + "/outbox.json"; };

FeedbackSend.readState = function() {
    var f = new QFile(FeedbackSend.statePath());
    if (!f.open(QIODevice.ReadOnly | QIODevice.Text)) { return {}; }
    var t = String(new QTextStream(f).readAll());
    f.close();
    try { return JSON.parse(t) || {}; } catch (e) { return {}; }
};
FeedbackSend.writeState = function(st) {
    (new QDir()).mkpath(FeedbackSend.outboxDir());
    var f = new QFile(FeedbackSend.statePath());
    if (f.open(QIODevice.WriteOnly | QIODevice.Truncate)) { f.write(JSON.stringify(st)); f.close(); }
};

FeedbackSend.pending = function() {
    var d = FeedbackSend.outboxDir();
    return new QDir(d).entryList(["feedback-*.zip"], QDir.Files, QDir.Name).map(function(n) { return d + "/" + n; });
};

/** Moves zip into the outbox; returns the new path (or the old one if it is already there). */
FeedbackSend.queue = function(zip) {
    var d = FeedbackSend.outboxDir();
    (new QDir()).mkpath(d);
    var dest = d + "/" + String(zip).replace(/^.*[\/\\]/, "");
    if (String(new QFileInfo(zip).absoluteFilePath()) === String(new QFileInfo(dest).absoluteFilePath())) { return dest; }
    QFile.remove(dest);
    if (!QFile.rename(zip, dest)) { QFile.copy(zip, dest); QFile.remove(zip); }
    return dest;
};

FeedbackSend.idOf = function(path) {
    var m = /-([0-9a-f]{6})\.zip$/.exec(String(path));
    return m ? m[1] : "";
};

/** done({ok, id, error}) exactly once. */
FeedbackSend.send = function(path, cfg, done) {
    var name = String(path).replace(/^.*[\/\\]/, "");
    function fail(err) {
        var st = FeedbackSend.readState();
        FeedbackCore.recordFailure(st, name);
        FeedbackSend.writeState(st);
        done({ ok: false, error: err });
    }
    if (!FeedbackCore.configured(cfg)) { done({ ok: false, error: "not-configured" }); return; }
    var sys = RS.getSystemId(), b64 = path + ".b64", out = path + ".reply";
    FeedbackSend.runner(FeedbackCommands.base64(sys, path, b64), 120, function(r1) {
        if (!r1.ok) { QFile.remove(b64); fail("encode: " + r1.error); return; }
        var url = cfg.ENDPOINT + "?k=" + encodeURIComponent(cfg.KEY) + "&id=" + FeedbackSend.idOf(path);
        FeedbackSend.runner(FeedbackCommands.post(sys, url, b64, out), 3700, function(r2) {
            QFile.remove(b64);
            var text = "";
            var f = new QFile(out);
            if (f.open(QIODevice.ReadOnly | QIODevice.Text)) { text = String(new QTextStream(f).readAll()); f.close(); }
            QFile.remove(out);
            if (!r2.ok) { fail("network: " + r2.error); return; }
            var rep = FeedbackCore.parseReply(text);
            if (!rep.ok) { fail(rep.error); return; }
            QFile.remove(path);
            var st = FeedbackSend.readState();
            FeedbackCore.recordSuccess(st, name);
            FeedbackSend.writeState(st);
            done({ ok: true, id: rep.id });
        });
    });
};

/** Sends every queued zip, one after another. done({sent, failed}). */
FeedbackSend.retryAll = function(cfg, done) {
    var list = FeedbackSend.pending(), i = 0, sent = 0, failed = 0;
    (function next() {
        if (i >= list.length) { done({ sent: sent, failed: failed }); return; }
        FeedbackSend.send(list[i++], cfg, function(r) { if (r.ok) { sent++; } else { failed++; } next(); });
    })();
};
```

- [ ] **Step 3: Structure test** — in `tests/test_updater_structure.py`, change the `UPDATER` constant into a list and loop over both:

```python
DIRS = [os.path.join(ROOT, "scripts", "Help", "CheckForUpdates"),
        os.path.join(ROOT, "scripts", "Help", "SendFeedback")]
```

and in `test_no_static_shadows_a_function_property` replace `for name in sorted(os.listdir(UPDATER)):` / `os.path.join(UPDATER, name)` with a loop `for d in DIRS: for name in sorted(os.listdir(d)):` / `os.path.join(d, name)`.

- [ ] **Step 4: Pass** — `tests/feedback/run.sh && python3 -m unittest tests.test_updater_structure -v` → all OK.

- [ ] **Step 5: Commit**

```bash
git add scripts/Help/SendFeedback/FeedbackSend.js tests/feedback/send_test.js tests/test_updater_structure.py
git commit -m "feat(feedback): outbox, send and retry"
```

---

### Task 7: Dialog, action and startup retry; Report Bug removed

**Goal:** Help > Send Feedback… opens the dialog from the spec; Send stages, zips, queues and sends; failure shows the saved-copy dialog; startup retries the outbox and logs a session crumb; Report Bug is gone.

**Files:**
- Create: `scripts/Help/SendFeedback/SendFeedback.js`, `SendFeedbackInit.js`, `SendFeedbackPostInit.js`, `SendFeedbackDialog.ui`
- Delete: `scripts/Help/ReportBug/` (whole folder)
- Modify: `ts/scripts.lst` (remove the ReportBug lines 513–514; add the SendFeedback `.js` and `.ui` files in the same `/Users/andrew/data/QCAD4/qcad/scripts/...` form beside CheckForUpdates)
- Modify: `src/scripts/scripts_release.qrc` (regenerated by the build — commit the result)

**Acceptance Criteria:**
- [ ] Help menu shows **Send Feedback…** and no **Report Bug**.
- [ ] Drawing, survey-file and scan controls are disabled with no drawing open.
- [ ] Typing "the scan is blurry" with Scans = None shows the hint; attaching scans hides it.
- [ ] The size label shows total and scan MB; above 30 MB of zip the Send is refused with a message.
- [ ] Send with placeholder config goes straight to the failure dialog, first line "Sending is not configured in this build.", with Show file / Write email / OK, and the zip is in the outbox.
- [ ] The log gains `[crumb] session: Cave Survey <v>, build <commit>, screen <w>x<h>@<dpr>` at startup.
- [ ] After 3 failed launches a status-bar button "1 feedback report waiting to send — Show…" appears.

**Verify:** built app, via CaveCAD MCP bridge (`cavecad_eval` / `cavecad_screenshot`): see Task 12 steps 1–3; plus `tests/feedback/run.sh` stays green.

**Steps:**

- [ ] **Step 1: Delete Report Bug**

```bash
git rm -r scripts/Help/ReportBug
```

- [ ] **Step 2: Init** — `scripts/Help/SendFeedback/SendFeedbackInit.js`:

```js
function init(basePath) {
    var action = new RGuiAction(qsTranslate("SendFeedback", "Send &Feedback..."), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(false);
    action.setScriptFile(basePath + "/SendFeedback.js");
    action.setNoState();
    action.setGroupSortOrder(110200);
    action.setSortOrder(500);
    action.setWidgetNames(["HelpMenu", "!HelpToolBar"]);
}
```

- [ ] **Step 3: Dialog UI** — `scripts/Help/SendFeedback/SendFeedbackDialog.ui` (QDialog `SendFeedbackDialog`, vertical layout). Widgets and objectNames, top to bottom:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ui version="4.0">
 <class>SendFeedbackDialog</class>
 <widget class="QDialog" name="SendFeedbackDialog">
  <property name="windowTitle"><string>Send Feedback</string></property>
  <property name="minimumSize"><size><width>520</width><height>0</height></size></property>
  <layout class="QVBoxLayout" name="Layout">
   <item><layout class="QFormLayout" name="Form">
    <item row="0" column="0"><widget class="QLabel" name="TypeLabel"><property name="text"><string>Type:</string></property></widget></item>
    <item row="0" column="1"><widget class="QComboBox" name="Type">
      <item><property name="text"><string>Bug</string></property></item>
      <item><property name="text"><string>Idea</string></property></item>
      <item><property name="text"><string>Question</string></property></item></widget></item>
    <item row="1" column="0"><widget class="QLabel" name="SummaryLabel"><property name="text"><string>Summary:</string></property></widget></item>
    <item row="1" column="1"><widget class="QLineEdit" name="Summary"><property name="maxLength"><number>120</number></property></widget></item>
    <item row="2" column="0"><widget class="QLabel" name="EmailLabel"><property name="text"><string>Email:</string></property></widget></item>
    <item row="2" column="1"><widget class="QLineEdit" name="Email"><property name="placeholderText"><string>only if you want a reply</string></property></widget></item>
   </layout></item>
   <item><widget class="QLabel" name="DescriptionLabel"><property name="text"><string>What happened, and what did you expect?</string></property></widget></item>
   <item><widget class="QPlainTextEdit" name="Description"/></item>
   <item><widget class="QFrame" name="ScanHint"><property name="frameShape"><enum>QFrame::StyledPanel</enum></property>
     <layout class="QHBoxLayout" name="ScanHintLayout">
      <item><widget class="QLabel" name="ScanHintText"><property name="wordWrap"><bool>true</bool></property>
        <property name="text"><string>Sounds like a scan problem. Attaching the scan helps us reproduce it.</string></property></widget></item>
      <item><widget class="QPushButton" name="AttachUsedScans"><property name="text"><string>Attach scans used in drawing</string></property></widget></item>
      <item><widget class="QPushButton" name="ChooseScan"><property name="text"><string>Choose scan...</string></property></widget></item>
     </layout></widget></item>
   <item><widget class="QGroupBox" name="Attach"><property name="title"><string>Attach</string></property>
     <layout class="QVBoxLayout" name="AttachLayout">
      <item><widget class="QCheckBox" name="Logs"><property name="text"><string>Session logs (this and the previous session)</string></property><property name="checked"><bool>true</bool></property></widget></item>
      <item><widget class="QCheckBox" name="Screenshot"><property name="text"><string>Screenshot of the CaveCAD window</string></property><property name="checked"><bool>true</bool></property></widget></item>
      <item><widget class="QCheckBox" name="Drawing"><property name="text"><string>My drawing</string></property></widget></item>
      <item><widget class="QCheckBox" name="SurveyFiles"><property name="text"><string>Survey files (the drawing's folder, without images and PDFs)</string></property></widget></item>
      <item><layout class="QHBoxLayout" name="ScansRow">
        <item><widget class="QLabel" name="ScansLabel"><property name="text"><string>Scans:</string></property></widget></item>
        <item><widget class="QComboBox" name="Scans">
          <item><property name="text"><string>None</string></property></item>
          <item><property name="text"><string>Only scans used in this drawing</string></property></item>
          <item><property name="text"><string>Choose scans...</string></property></item></widget></item>
        <item><widget class="QLabel" name="ScansChosen"/></item>
      </layout></item>
      <item><widget class="QLabel" name="Consent"><property name="wordWrap"><bool>true</bool></property><property name="openExternalLinks"><bool>true</bool></property>
        <property name="text"><string>Your drawing contains your cave's location. It goes only to the CaveCAD maintainer and people they trust. &lt;a href="https://github.com/Nate-the-Ace/cavecad-src/blob/cavecad/PRIVACY.md"&gt;What we collect&lt;/a&gt;</string></property></widget></item>
     </layout></widget></item>
   <item><layout class="QHBoxLayout" name="Bottom">
     <item><widget class="QLabel" name="Size"/></item>
     <item><widget class="QPushButton" name="Review"><property name="text"><string>Review...</string></property></widget></item>
     <item><widget class="QDialogButtonBox" name="Buttons"><property name="standardButtons"><set>QDialogButtonBox::Cancel|QDialogButtonBox::Ok</set></property></widget></item>
   </layout></item>
  </layout>
 </widget>
 <resources/>
 <connections>
  <connection><sender>Buttons</sender><signal>rejected()</signal><receiver>SendFeedbackDialog</receiver><slot>reject()</slot></connection>
 </connections>
</ui>
```

- [ ] **Step 4: Action** — `scripts/Help/SendFeedback/SendFeedback.js`:

```js
// SendFeedback.js -- Help > Send Feedback. Replaces QCAD's Report Bug
// (which opened qcad.org). The screenshot is grabbed before the dialog
// opens so the dialog is never in it. Every report is queued in the outbox
// before sending, so "a copy is saved" is always true.

include("scripts/Help/Help.js");
include("scripts/AddOn.js");
include("scripts/Help/CheckForUpdates/CcUpdateCommands.js");
include("scripts/Help/CheckForUpdates/CcUpdateRun.js");
include("scripts/Help/CheckForUpdates/CheckForUpdates.js");
include("FeedbackConfig.js");
include("FeedbackCore.js");
include("FeedbackCommands.js");
include("FeedbackPackage.js");
include("FeedbackSend.js");

function SendFeedback(guiAction) { Help.call(this, guiAction); }
SendFeedback.prototype = new Help();
SendFeedback.includeBasePath = includeBasePath;
SendFeedback.TYPES = ["bug", "idea", "question"];

SendFeedback.prototype.beginEvent = function() {
    Help.prototype.beginEvent.call(this);
    SendFeedback.open();
    this.terminate();
};

SendFeedback.date = function() { return String(new Date().toISOString()).substring(0, 10); };

/** Versions, OS, tool and documents for report.json. */
SendFeedback.meta = function(di) {
    var local = CheckForUpdates.local();
    var tool = "";
    try { var a = di ? di.getCurrentAction() : null; tool = isNull(a) ? "" : String(a.getGuiAction() ? a.getGuiAction().text() : "").replace(/&/g, ""); } catch (e) { tool = ""; }
    var docs = [];
    var mdi = RMainWindowQt.getMainWindow().getMdiArea();
    var subs = isNull(mdi) ? [] : mdi.subWindowList();
    for (var i = 0; i < subs.length; i++) {
        try { docs.push(String(subs[i].getDocument().getFileName()).replace(/^.*[\/\\]/, "")); } catch (e2) { /* a window without a document */ }
    }
    return {
        version: String(RSettings.getVersionString()),
        commit: String(local.commit || ""),
        caveSurvey: String(local.toolsVersion || ""),
        os: String(RS.getSystemId()) + " " + String(QSysInfo.prettyProductName()),
        activeTool: tool, documents: docs,
        created: new Date().toISOString()
    };
};

SendFeedback.open = function() {
    var appWin = RMainWindowQt.getMainWindow();
    var di = EAction.getDocumentInterface();
    var doc = isNull(di) ? null : di.getDocument();
    var docPath = isNull(doc) ? "" : String(doc.getFileName());
    var caveDir = docPath === "" ? "" : String(new QFileInfo(docPath).absolutePath());
    var id = FeedbackCore.newId();
    var base = FeedbackPackage.stagingBase();
    (new QDir()).mkpath(base);
    var shot = base + "/" + id + "-screenshot.png";
    var shotOk = false;
    try { shotOk = appWin.grab().save(shot, "PNG"); } catch (e) { shotOk = false; }

    var dialog = WidgetFactory.createDialog(SendFeedback.includeBasePath, "SendFeedbackDialog.ui", appWin);
    var w = function(n) { return dialog.findChild(n); };
    var chosen = [];

    var hasDoc = docPath !== "";
    ["Drawing", "SurveyFiles", "Scans", "ScansLabel", "AttachUsedScans", "ChooseScan"].forEach(function(n) { w(n).enabled = hasDoc; });
    w("Screenshot").enabled = shotOk;
    w("Screenshot").checked = shotOk;

    function scans() {
        var i = w("Scans").currentIndex;
        if (i === 1) { return FeedbackPackage.usedScans(doc, caveDir); }
        if (i === 2) { return chosen; }
        return [];
    }
    function sizeOf(paths) { var n = 0; paths.forEach(function(p) { n += new QFileInfo(p).size(); }); return n; }
    function surveyList() { return w("SurveyFiles").checked && hasDoc ? FeedbackCore.surveyFiles(FeedbackPackage.listFiles(caveDir)) : []; }
    function refresh() {
        var sc = scans();
        var hint = w("Scans").currentIndex === 0 && FeedbackCore.mentionsScan(w("Description").plainText);
        w("ScanHint").visible = hint && hasDoc;
        w("ScansChosen").text = w("Scans").currentIndex === 2 ? qsTr("%1 chosen").arg(chosen.length) : "";
        var logs = w("Logs").checked ? FeedbackPackage.latestLogs(FeedbackPackage.logDir()) : [];
        var other = sizeOf(logs) + (w("Screenshot").checked ? sizeOf([shot]) : 0)
            + sizeOf(surveyList().map(function(r) { return caveDir + "/" + r; }));
        var scanBytes = sizeOf(sc);
        var total = other + scanBytes;
        var mb = function(b) { return (b / FeedbackCore.MB).toFixed(1); };
        var t = qsTr("About %1 MB (scans %2 MB)").arg(mb(total)).arg(mb(scanBytes));
        if (FeedbackCore.sizeVerdict(total) !== "ok") { t = "<b>" + t + " — " + qsTr("large; consider fewer scans") + "</b>"; }
        w("Size").text = t;
    }
    function choose() {
        var fd = new QFileDialog(dialog, qsTr("Choose scans"), caveDir);
        fd.setOption(QFileDialog.DontUseNativeDialog, true);
        fd.fileMode = QFileDialog.ExistingFiles;
        if (fd.exec()) { chosen = fd.selectedFiles().map(function(s) { return String(s); }); w("Scans").currentIndex = 2; }
        fd.destroy();
        refresh();
    }
    w("Description").textChanged.connect(refresh);
    ["Logs", "Screenshot", "Drawing", "SurveyFiles"].forEach(function(n) { w(n).toggled.connect(refresh); });
    w("Scans")["activated(int)"].connect(function(i) { if (i === 2) { choose(); } else { refresh(); } });
    w("AttachUsedScans").clicked.connect(function() { w("Scans").currentIndex = 1; refresh(); });
    w("ChooseScan").clicked.connect(choose);

    function stage() {
        var drawingCopy = null;
        if (w("Drawing").checked && hasDoc) {
            drawingCopy = base + "/" + id + "-drawing.dxf";
            if (!FeedbackPackage.copyDrawing(di, drawingCopy)) { drawingCopy = null; }
        }
        var f = { type: SendFeedback.TYPES[w("Type").currentIndex], summary: String(w("Summary").text),
                  description: String(w("Description").plainText), email: String(w("Email").text) };
        return FeedbackPackage.stage({
            base: base, id: id, fields: f, meta: SendFeedback.meta(di),
            logs: w("Logs").checked ? FeedbackPackage.latestLogs(FeedbackPackage.logDir()) : [],
            screenshot: w("Screenshot").checked ? shot : null,
            drawing: drawingCopy, caveDir: caveDir, surveyFiles: surveyList(),
            scans: scans(), scanMode: ["none", "used", "chosen"][w("Scans").currentIndex]
        });
    }
    w("Review").clicked.connect(function() {
        var s = stage();
        QDesktopServices.openUrl(QUrl.fromLocalFile(s.dir));
    });
    w("Buttons").accepted.connect(function() {
        var f = { type: SendFeedback.TYPES[w("Type").currentIndex], summary: String(w("Summary").text), description: String(w("Description").plainText) };
        var missing = FeedbackCore.validate(f);
        if (missing.length > 0) {
            QMessageBox.warning(dialog, qsTr("Send Feedback"),
                missing.indexOf("summary") >= 0 ? qsTr("Please give your feedback a one-line summary.") : qsTr("Please say what happened for a bug report."));
            return;
        }
        var s = stage();
        var zip = base + "/" + FeedbackCore.zipName(SendFeedback.date(), id);
        w("Buttons").enabled = false;
        w("Size").text = qsTr("Packing...");
        FeedbackPackage.zip(s.dir, zip, function(zr) {
            (new QDir(s.dir)).removeRecursively();
            if (!zr.ok) { w("Buttons").enabled = true; w("Size").text = qsTr("Could not pack the report: %1").arg(zr.error); return; }
            var bytes = new QFileInfo(zip).size();
            if (FeedbackCore.sizeVerdict(bytes) === "block") {
                QFile.remove(zip);
                w("Buttons").enabled = true;
                QMessageBox.warning(dialog, qsTr("Send Feedback"), qsTr("The report is %1 MB; the limit is 30 MB. Attach fewer scans.").arg((bytes / FeedbackCore.MB).toFixed(1)));
                refresh();
                return;
            }
            var queued = FeedbackSend.queue(zip);
            w("Size").text = qsTr("Sending...");
            FeedbackSend.send(queued, FeedbackConfig, function(r) {
                QFile.remove(shot);
                dialog.accept();
                if (r.ok) {
                    QMessageBox.information(appWin, qsTr("Send Feedback"), qsTr("Sent. Thank you. Reference %1.").arg(r.id));
                } else {
                    SendFeedback.failed(queued, id, f.summary, bytes, r.error === "not-configured");
                }
            });
        });
    });
    w("ScanHint").visible = false;
    refresh();
    dialog.exec();
    dialog.destroy();
};

/** The failure dialog: a copy is saved; email it if you'd rather. */
SendFeedback.failed = function(path, id, summary, bytes, notConfigured) {
    var appWin = RMainWindowQt.getMainWindow();
    var text = (notConfigured ? qsTr("Sending is not configured in this build.") : qsTr("Couldn't send your feedback."))
        + "<br/>" + qsTr("A copy is saved and CaveCAD will try again next time it starts.")
        + "<br/>" + qsTr("If you'd rather send it yourself, email the saved file to <b>%1</b>.").arg(FeedbackConfig.EMAIL);
    if (FeedbackCore.tooBigToEmail(bytes)) {
        text += "<br/>" + qsTr("This file is too large to email. Share it from Google Drive or Dropbox instead.");
    }
    var box = new QMessageBox(QMessageBox.Warning, qsTr("Send Feedback"), text, QMessageBox.NoButton, appWin);
    var show = box.addButton(qsTr("Show file"), QMessageBox.ActionRole); show.objectName = "Show";
    var mail = box.addButton(qsTr("Write email"), QMessageBox.ActionRole); mail.objectName = "Mail";
    box.addButton(QMessageBox.Ok);
    // ActionRole buttons close the box too; reopen until OK
    for (;;) {
        box.exec();
        var c = box.clickedButton();
        var n = isNull(c) ? "" : String(c.objectName);
        if (n === "Show") { UpdateRun.run(FeedbackCommands.reveal(RS.getSystemId(), path), 10, function() {}); continue; }
        if (n === "Mail") { QDesktopServices.openUrl(new QUrl(FeedbackCore.mailto(FeedbackConfig.EMAIL, id, summary))); continue; }
        break;
    }
    box.destroy();
};
```

`CheckForUpdates.local()` — confirm it returns `{commit, toolsVersion, platform}`; if its field names differ, read `CheckForUpdates.local` in `scripts/Help/CheckForUpdates/CheckForUpdates.js` (~line 74) and use its names in `SendFeedback.meta` only.

- [ ] **Step 5: Startup** — `scripts/Help/SendFeedback/SendFeedbackPostInit.js`:

```js
// Startup: one session crumb for the log, then (after 10 s, off the
// window's back) a retry of the outbox. Nothing here may throw into startup.
function postInit() {
    try {
        if (RSettings.hasQuitFlag()) { return; }
        include("scripts/Help/SendFeedback/SendFeedback.js");
        var local = CheckForUpdates.local();
        var scr = QGuiApplication.primaryScreen();
        qWarning("[crumb] session: Cave Survey " + (local.toolsVersion || "?") + ", build " + (local.commit || "dev")
            + ", screen " + (isNull(scr) ? "?" : scr.size().width() + "x" + scr.size().height() + "@" + scr.devicePixelRatio));
        if (FeedbackSend.pending().length === 0) { return; }
        var t = new QTimer(RMainWindowQt.getMainWindow());
        t.singleShot = true;
        t.timeout.connect(function() {
            t.deleteLater();
            try {
                FeedbackSend.retryAll(FeedbackConfig, function() {
                    if (!FeedbackCore.needsNotice(FeedbackSend.readState())) { return; }
                    var n = FeedbackSend.pending().length;
                    if (n === 0) { return; }
                    var bar = RMainWindowQt.getMainWindow().statusBar();
                    var b = new QPushButton(qsTr("%1 feedback report(s) waiting to send — Show...").arg(n), bar);
                    b.flat = true;
                    b.clicked.connect(function() {
                        UpdateRun.run(FeedbackCommands.reveal(RS.getSystemId(), FeedbackSend.pending()[0]), 10, function() {});
                        bar.removeWidget(b);
                        b.destroy();
                    });
                    bar.addPermanentWidget(b);
                });
            } catch (e) { qWarning("Send Feedback retry: " + e); }
        });
        t.start(10000);
    } catch (e) {
        qWarning("Send Feedback (startup): " + e);
    }
}
```

- [ ] **Step 6: Build, update lists, run tests**

Edit `ts/scripts.lst` as in Files. Run: `ninja && tests/feedback/run.sh && python3 -m unittest tests.test_updater_structure tests.test_session_log -v` → all OK. `git status` shows `src/scripts/scripts_release.qrc` changed (ReportBug out, SendFeedback in).

- [ ] **Step 7: Live check** — deploy (`tools/deploy-macos.sh`, then `codesign --force --deep --sign - /Applications/CaveCAD.app`), quit and relaunch CaveCAD (confirm the old process is gone: `pgrep -x CaveCAD` shows one new PID). Via `cavecad_eval`: `RGuiAction.getByScriptFile` is not needed — open with `include("scripts/Help/SendFeedback/SendFeedback.js"); SendFeedback.open();` in a timer so eval returns; `cavecad_screenshot` shows the dialog. Check each Acceptance Criterion above and record the screenshot paths in the commit message.

- [ ] **Step 8: Commit**

```bash
git add scripts/Help/SendFeedback ts/scripts.lst src/scripts/scripts_release.qrc
git commit -m "feat(feedback): Help > Send Feedback replaces Report Bug"
```

---

### Task 8: Receiver (Apps Script)

**Goal:** `doPost` accepts a report, files it in Drive, adds a Sheet row and emails; `onStatusEdit` stamps Closed; `purgeOld` trashes due folders. Logic tested under node.

**Files:**
- Create: `tools/feedback-receiver/Logic.gs`, `tools/feedback-receiver/Code.gs`, `tools/feedback-receiver/README.md`, `tools/feedback-receiver/test/logic.test.js`

**Acceptance Criteria:**
- [ ] `check` refuses a wrong key (`"key"`), a body over 40 MB (`"too-big"`), the 31st report in an hour (`"busy"`); accepts otherwise (`null`).
- [ ] `folderName` = `2026-09-27 Bug — <summary ≤60 chars, no / \\> (a7f3c2)`.
- [ ] `row` follows `COLUMNS`; Status `New`, Closed empty.
- [ ] `purgeDue` picks Fixed/Won't fix closed ≥30 days ago and anything received ≥365 days ago, never `Purged` rows.
- [ ] `stripPath("./logs/a.log")` = `logs/a.log`.

**Verify:** `node --test 'tools/feedback-receiver/test/**/*.test.js'` → `# pass 5`, `# fail 0`

**Steps:**

- [ ] **Step 1: Failing test** — `tools/feedback-receiver/test/logic.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert");
const L = require("../Logic.gs");

const MB = 1024 * 1024;
const REPORT = { id: "a7f3c2", type: "bug", summary: "Trace / crash on a very long summary that keeps going past sixty characters", email: "",
  cavecad: { version: "3.33", commit: "abc" }, os: "osx macOS 26", attachments: [{ path: "a", bytes: 1 }, { path: "b", bytes: 2 }] };

test("check", () => {
  const ok = { key: "k", expected: "k", bodyLength: 10, countThisHour: 0 };
  assert.strictEqual(L.check(ok), null);
  assert.strictEqual(L.check({ ...ok, key: "x" }), "key");
  assert.strictEqual(L.check({ ...ok, expected: "" }), "key");
  assert.strictEqual(L.check({ ...ok, bodyLength: 40 * MB + 1 }), "too-big");
  assert.strictEqual(L.check({ ...ok, countThisHour: 30 }), "busy");
});

test("folderName", () => {
  const n = L.folderName(REPORT, new Date("2026-09-27T12:00:00Z"));
  assert.ok(n.startsWith("2026-09-27 Bug — Trace - crash"), n);
  assert.ok(n.endsWith(" (a7f3c2)"), n);
  assert.ok(n.length <= "2026-09-27 Bug — ".length + 60 + " (a7f3c2)".length);
});

test("row", () => {
  const r = L.row(REPORT, new Date("2026-09-27T12:00:00Z"), "https://f", "FID", 3);
  assert.strictEqual(r.length, L.COLUMNS.length);
  assert.strictEqual(r[L.COLUMNS.indexOf("Status")], "New");
  assert.strictEqual(r[L.COLUMNS.indexOf("Closed")], "");
  assert.strictEqual(r[L.COLUMNS.indexOf("Attachments")], 2);
});

test("purgeDue", () => {
  const now = new Date("2027-01-01T00:00:00Z");
  const day = 86400000;
  const rows = [
    { received: new Date(now - 10 * day), status: "Fixed", closed: new Date(now - 31 * day) },
    { received: new Date(now - 10 * day), status: "Fixed", closed: new Date(now - 5 * day) },
    { received: new Date(now - 366 * day), status: "New", closed: "" },
    { received: new Date(now - 400 * day), status: "Purged", closed: "" },
    { received: new Date(now - 10 * day), status: "Won't fix", closed: new Date(now - 30 * day) },
  ];
  assert.deepStrictEqual(L.purgeDue(rows, now), [0, 2, 4]);
});

test("stripPath and subject", () => {
  assert.strictEqual(L.stripPath("./logs/a.log"), "logs/a.log");
  assert.strictEqual(L.subject(REPORT).indexOf("[CaveCAD Feedback] Bug: "), 0);
});
```

Run: `node --test 'tools/feedback-receiver/test/**/*.test.js'` → FAIL (`Cannot find module '../Logic.gs'`).

- [ ] **Step 2: Logic** — `tools/feedback-receiver/Logic.gs`:

```js
// Logic.gs -- the receiver's decisions, free of Google services so node
// can test them (tools/feedback-receiver/test). Apps Script loads every .gs
// file into one global scope; node loads this one through module.exports.

var FeedbackLogic = {
  MAX_BODY: 40 * 1024 * 1024,
  MAX_PER_HOUR: 30,
  CLOSED_GRACE_DAYS: 30,
  MAX_AGE_DAYS: 365,
  CLOSED_STATES: ["Fixed", "Won't fix"],
  COLUMNS: ["Received", "ID", "Type", "Summary", "Email", "CaveCAD version", "OS",
            "Attachments", "Size", "Folder link", "Folder ID", "Status", "Closed", "Notes"],

  /** null when accepted, else "key" | "too-big" | "busy". */
  check: function (p) {
    if (!p.expected || p.key !== p.expected) return "key";
    if (p.bodyLength > FeedbackLogic.MAX_BODY) return "too-big";
    if (p.countThisHour >= FeedbackLogic.MAX_PER_HOUR) return "busy";
    return null;
  },

  hourKey: function (date) { return "n-" + date.toISOString().slice(0, 13); },

  typeLabel: function (t) { t = String(t || "bug"); return t.charAt(0).toUpperCase() + t.slice(1); },

  folderName: function (report, date) {
    var s = String(report.summary || "").replace(/[\/\\]/g, "-").replace(/\s+/g, " ").trim().slice(0, 60);
    return date.toISOString().slice(0, 10) + " " + FeedbackLogic.typeLabel(report.type) + " — " + s + " (" + report.id + ")";
  },

  row: function (report, received, folderUrl, folderId, bytes) {
    var v = {
      "Received": received, "ID": report.id, "Type": FeedbackLogic.typeLabel(report.type),
      "Summary": report.summary, "Email": report.email || "",
      "CaveCAD version": (report.cavecad && report.cavecad.version) || "", "OS": report.os || "",
      "Attachments": (report.attachments || []).length, "Size": bytes, "Folder link": folderUrl,
      "Folder ID": folderId, "Status": "New", "Closed": "", "Notes": ""
    };
    return FeedbackLogic.COLUMNS.map(function (c) { return v[c]; });
  },

  /** rows: [{received, status, closed}] -> indexes due for purging. */
  purgeDue: function (rows, now) {
    var day = 86400000, out = [];
    rows.forEach(function (r, i) {
      if (r.status === "Purged") return;
      var old = r.received instanceof Date && now - r.received >= FeedbackLogic.MAX_AGE_DAYS * day;
      var closed = FeedbackLogic.CLOSED_STATES.indexOf(r.status) >= 0 && r.closed instanceof Date
        && now - r.closed >= FeedbackLogic.CLOSED_GRACE_DAYS * day;
      if (old || closed) out.push(i);
    });
    return out;
  },

  stripPath: function (name) { return String(name).replace(/^(\.\/)+/, ""); },

  subject: function (report) {
    return "[CaveCAD Feedback] " + FeedbackLogic.typeLabel(report.type) + ": " + report.summary;
  }
};

if (typeof module !== "undefined") { module.exports = FeedbackLogic; }
```

- [ ] **Step 3: Pass** — `node --test 'tools/feedback-receiver/test/**/*.test.js'` → `# pass 5`.

- [ ] **Step 4: Services** — `tools/feedback-receiver/Code.gs`:

```js
// Code.gs -- CaveCAD's feedback receiver. Deployed as a web app under
// cavecad.app@gmail.com ("Execute as: Me", "Who has access: Anyone").
// Script properties: KEY, FOLDER_ID, SHEET_ID. See README.md.

function doPost(e) {
  var props = PropertiesService.getScriptProperties();
  var cache = CacheService.getScriptCache();
  var hk = FeedbackLogic.hourKey(new Date());
  var n = Number(cache.get(hk) || 0);
  var err = FeedbackLogic.check({
    key: e.parameter.k, expected: props.getProperty("KEY"),
    bodyLength: e.postData ? e.postData.length : 0, countThisHour: n
  });
  if (err) return reply({ ok: false, error: err });
  cache.put(hk, String(n + 1), 3600);

  var bytes = Utilities.base64Decode(e.postData.contents);
  var zip = Utilities.newBlob(bytes, "application/zip", "report.zip");
  var files = Utilities.unzip(zip);
  var report = null;
  files.forEach(function (f) {
    if (FeedbackLogic.stripPath(f.getName()) === "report.json") report = JSON.parse(f.getDataAsString());
  });
  if (!report || !/^[0-9a-f]{6}$/.test(String(report.id))) return reply({ ok: false, error: "no-report" });

  var now = new Date();
  var root = DriveApp.getFolderById(props.getProperty("FOLDER_ID"));
  var folder = root.createFolder(FeedbackLogic.folderName(report, now));
  folder.createFile(zip.setName("feedback-" + report.id + ".zip"));
  files.forEach(function (f) {
    var parts = FeedbackLogic.stripPath(f.getName()).split("/");
    var leaf = parts.pop();
    if (!leaf) return;
    var dir = folder;
    parts.forEach(function (p) {
      var it = dir.getFoldersByName(p);
      dir = it.hasNext() ? it.next() : dir.createFolder(p);
    });
    dir.createFile(f.setName(leaf));
  });

  var sheet = SpreadsheetApp.openById(props.getProperty("SHEET_ID")).getSheets()[0];
  if (sheet.getLastRow() === 0) sheet.appendRow(FeedbackLogic.COLUMNS);
  sheet.appendRow(FeedbackLogic.row(report, now, folder.getUrl(), folder.getId(), bytes.length));

  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), FeedbackLogic.subject(report),
    report.summary + "\n\n" + (report.cavecad ? report.cavecad.version : "") + " | " + (report.os || "")
    + "\n\n" + folder.getUrl());
  return reply({ ok: true, id: report.id });
}

function reply(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/** Installable on-edit trigger: Status -> Fixed/Won't fix stamps Closed; anything else clears it. */
function onStatusEdit(e) {
  var sheet = e.range.getSheet();
  var statusCol = FeedbackLogic.COLUMNS.indexOf("Status") + 1;
  if (e.range.getColumn() !== statusCol || e.range.getRow() === 1) return;
  var closed = sheet.getRange(e.range.getRow(), FeedbackLogic.COLUMNS.indexOf("Closed") + 1);
  if (FeedbackLogic.CLOSED_STATES.indexOf(String(e.value)) >= 0) closed.setValue(new Date());
  else closed.setValue("");
}

/** Daily time-driven trigger: trash due report folders, mark rows Purged. */
function purgeOld() {
  var props = PropertiesService.getScriptProperties();
  var sheet = SpreadsheetApp.openById(props.getProperty("SHEET_ID")).getSheets()[0];
  if (sheet.getLastRow() < 2) return;
  var C = FeedbackLogic.COLUMNS;
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, C.length).getValues();
  var rows = values.map(function (v) {
    return { received: v[C.indexOf("Received")], status: String(v[C.indexOf("Status")]), closed: v[C.indexOf("Closed")] };
  });
  FeedbackLogic.purgeDue(rows, new Date()).forEach(function (i) {
    try { DriveApp.getFolderById(values[i][C.indexOf("Folder ID")]).setTrashed(true); } catch (err) { /* already gone */ }
    sheet.getRange(i + 2, C.indexOf("Status") + 1).setValue("Purged");
  });
}
```

- [ ] **Step 5: Setup doc** — `tools/feedback-receiver/README.md`:

```markdown
# Feedback receiver

Google Apps Script that receives Help > Send Feedback reports. Owned by
**cavecad.app@gmail.com**. Logic is in `Logic.gs` (tested:
`node --test 'tools/feedback-receiver/test/**/*.test.js'`); `Code.gs` wires it to Drive,
Sheets and Mail.

## One-time setup (signed in as cavecad.app@gmail.com)

1. Drive: create a folder `CaveCAD Feedback`. Copy its ID from the URL.
2. Sheets: create `CaveCAD Feedback triage`. Copy its ID from the URL.
3. script.google.com > New project `CaveCAD Feedback`. Add files `Logic.gs`
   and `Code.gs` with this folder's contents.
4. Project Settings > Script properties: `KEY` (a long random string, e.g.
   `python3 -c "import secrets;print(secrets.token_urlsafe(32))"`),
   `FOLDER_ID`, `SHEET_ID`.
5. Triggers: `onStatusEdit` — From spreadsheet, On edit. `purgeOld` —
   Time-driven, Day timer.
6. Deploy > New deployment > Web app. Execute as: Me. Who has access:
   Anyone. Copy the `/exec` URL. Authorise Drive, Sheets, Mail when asked.
7. GitHub `Nate-the-Ace/cavecad-src` > Settings > Secrets > Actions:
   `FEEDBACK_ENDPOINT` = the `/exec` URL, `FEEDBACK_KEY` = the KEY.
8. Share the folder and the Sheet with your personal account and anyone
   you trust with cave locations. Anyone with access sees every report.
9. For tests, make a second deployment (Deploy > New deployment) and a
   second folder/Sheet pair; point a local build at it by editing
   `FeedbackConfig.js` locally (never commit it).

Redeploying after a code change: Deploy > Manage deployments > edit >
Version: New. The `/exec` URL stays the same.
```

- [ ] **Step 6: Commit**

```bash
git add tools/feedback-receiver
git commit -m "feat(feedback): Apps Script receiver with retention"
```

---

### Task 9: CI injection and guard

**Goal:** Release builds carry the real endpoint and key from GitHub secrets; the repo never does.

**Files:**
- Create: `tools/inject_feedback_config.py`, `tests/test_feedback_config.py`
- Modify: `.github/workflows/macos.yml`, `.github/workflows/linux.yml`, `.github/workflows/windows.yml` (a step before "Build CaveCAD")

**Acceptance Criteria:**
- [ ] With both env vars set, the script rewrites the placeholders in a given file; with either missing it prints a notice, changes nothing, exits 0.
- [ ] It refuses (exit 1) an endpoint not starting `https://script.google.com/`.
- [ ] The committed `FeedbackConfig.js` holds exactly the two placeholders (test fails otherwise).
- [ ] Each platform workflow runs the step before its build.

**Verify:** `python3 -m unittest tests.test_feedback_config -v` → OK

**Steps:**

- [ ] **Step 1: Failing test** — `tests/test_feedback_config.py`:

```python
"""Send Feedback's endpoint and key reach builds from CI secrets only.

    python3 -m unittest tests.test_feedback_config -v
"""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CONFIG = REPO / "scripts/Help/SendFeedback/FeedbackConfig.js"
TOOL = REPO / "tools/inject_feedback_config.py"


def run(env, path):
    e = {k: v for k, v in os.environ.items() if not k.startswith("FEEDBACK_")}
    e.update(env)
    return subprocess.run([sys.executable, str(TOOL), str(path)], env=e, capture_output=True, text=True)


class TestFeedbackConfig(unittest.TestCase):
    def test_repo_holds_placeholders_only(self):
        text = CONFIG.read_text(encoding="utf-8")
        self.assertIn('ENDPOINT: "@@FEEDBACK_ENDPOINT@@"', text)
        self.assertIn('KEY: "@@FEEDBACK_KEY@@"', text)
        self.assertNotIn("script.google.com", text)

    def test_injects(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "c.js"
            shutil.copy(CONFIG, p)
            r = run({"FEEDBACK_ENDPOINT": "https://script.google.com/macros/s/X/exec", "FEEDBACK_KEY": "sekret"}, p)
            self.assertEqual(0, r.returncode, r.stderr)
            text = p.read_text(encoding="utf-8")
            self.assertIn('"https://script.google.com/macros/s/X/exec"', text)
            self.assertIn('"sekret"', text)
            self.assertNotIn("sekret", r.stdout + r.stderr)

    def test_missing_secret_keeps_placeholders(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "c.js"
            shutil.copy(CONFIG, p)
            r = run({"FEEDBACK_ENDPOINT": "https://script.google.com/x"}, p)
            self.assertEqual(0, r.returncode)
            self.assertEqual(CONFIG.read_text(encoding="utf-8"), p.read_text(encoding="utf-8"))

    def test_refuses_other_hosts(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "c.js"
            shutil.copy(CONFIG, p)
            r = run({"FEEDBACK_ENDPOINT": "https://evil.example/x", "FEEDBACK_KEY": "k"}, p)
            self.assertEqual(1, r.returncode)


if __name__ == "__main__":
    unittest.main()
```

Run → FAIL (tool missing).

- [ ] **Step 2: Tool** — `tools/inject_feedback_config.py`:

```python
#!/usr/bin/env python3
"""Writes the Send Feedback endpoint and key into FeedbackConfig.js from
the FEEDBACK_ENDPOINT / FEEDBACK_KEY environment (GitHub Actions secrets),
before the build compiles scripts into the binary. Without both, the
placeholders stay and the build can only save reports, not send them.

    python3 tools/inject_feedback_config.py [path/to/FeedbackConfig.js]
"""
import os
import sys
from pathlib import Path

DEFAULT = Path(__file__).resolve().parent.parent / "scripts/Help/SendFeedback/FeedbackConfig.js"


def main():
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT
    endpoint = os.environ.get("FEEDBACK_ENDPOINT", "").strip()
    key = os.environ.get("FEEDBACK_KEY", "").strip()
    if not endpoint or not key:
        print("Send Feedback: secrets not set; placeholders kept (this build cannot send)")
        return 0
    if not endpoint.startswith("https://script.google.com/"):
        print("Send Feedback: FEEDBACK_ENDPOINT is not an Apps Script URL", file=sys.stderr)
        return 1
    if '"' in key or "\\" in key:
        print("Send Feedback: FEEDBACK_KEY must not contain quotes or backslashes", file=sys.stderr)
        return 1
    text = path.read_text(encoding="utf-8")
    if "@@FEEDBACK_ENDPOINT@@" not in text or "@@FEEDBACK_KEY@@" not in text:
        print("Send Feedback: placeholders missing from %s" % path, file=sys.stderr)
        return 1
    text = text.replace("@@FEEDBACK_ENDPOINT@@", endpoint).replace("@@FEEDBACK_KEY@@", key)
    path.write_text(text, encoding="utf-8")
    print("Send Feedback: endpoint configured")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 3: Workflows** — insert before the `- name: Build CaveCAD` step in `macos.yml` and `linux.yml`:

```yaml
      - name: Configure Send Feedback
        env:
          FEEDBACK_ENDPOINT: ${{ secrets.FEEDBACK_ENDPOINT }}
          FEEDBACK_KEY: ${{ secrets.FEEDBACK_KEY }}
        run: python3 tools/inject_feedback_config.py
```

and in `windows.yml` the same with `run: python tools/inject_feedback_config.py`. (Find each file's build step with `grep -n "name: Build" .github/workflows/<file>`; linux may have several jobs — add the step to every job that builds the app.)

- [ ] **Step 4: Pass** — `python3 -m unittest tests.test_feedback_config -v` → 4 OK.

- [ ] **Step 5: Commit**

```bash
git add tools/inject_feedback_config.py tests/test_feedback_config.py .github/workflows/macos.yml .github/workflows/linux.yml .github/workflows/windows.yml
git commit -m "ci: inject the Send Feedback endpoint from secrets"
```

---

### Task 10: Privacy policy and About

**Goal:** `PRIVACY.md` with the spec's inventory and terms; README links it; About shows contact, Privacy link and a no-warranty line.

**Files:**
- Create: `PRIVACY.md`
- Modify: `README.md` (one line near the top-level links)
- Modify: `scripts/Help/About/About.js` (after the GPL paragraph, ~line 161; add `About.privacyUrl` beside `About.sourceUrl` at line 102)

**Acceptance Criteria:**
- [ ] `PRIVACY.md` has the four-row service table (GitHub, USGS National Map, OSM/Esri/unpkg, Google), the Send Feedback terms (30 days after close, 12 months max), the local-only statement, and contact.
- [ ] About shows "Contact: cavecad.app@gmail.com" (mailto), a "Privacy" link, and "Provided without warranty; see the licence."; the "Based on QCAD Community Edition" line is still present.

**Verify:** `grep -c "cavecad.app@gmail.com" PRIVACY.md scripts/Help/About/About.js` → both ≥1; live About screenshot in Task 12.

**Steps:**

- [ ] **Step 1: `PRIVACY.md`**

```markdown
# CaveCAD privacy policy

This is a notice, not an agreement: you don't need to accept anything to
use CaveCAD. It lists every time CaveCAD talks to the internet and what
happens to anything you choose to send.

## What stays on your computer

Your drawings, survey data, scans and CaveCAD's session logs never leave
your computer unless you send them with **Help > Send Feedback**.

## When CaveCAD goes online

| Feature | Service contacted | What that service learns |
|---|---|---|
| Check for Updates | GitHub (github.com) | Your IP address, and that CaveCAD checked for an update. Nothing else is sent. |
| Surface Data / aerial basemap | USGS National Map (imagery.nationalmap.gov, elevation.nationalmap.gov) | Your IP address and **the map area requested, which is roughly where your cave is**. |
| Entrance Location picker | OpenStreetMap (tile.openstreetmap.org), Esri World Imagery (server.arcgisonline.com), the Leaflet map library (unpkg.com) | Your IP address and **the map area you view**. |
| Send Feedback | Google (Apps Script and Drive, account cavecad.app@gmail.com) | Only what you choose to send. |

The map services see which area was fetched. CaveCAD sends them no cave
names and no survey data.

## Send Feedback

- **What's sent:** a type, summary and description you write; your email
  only if you give it; CaveCAD's version and your operating system; and
  whichever attachments you tick — session logs and a screenshot (ticked
  by default, you can untick them), your drawing, survey files, scans
  (all unticked by default). The dialog's **Review** button shows exactly
  what will be sent.
- **Why:** only to fix and improve CaveCAD.
- **Who sees it:** the CaveCAD maintainer and people they trust. It is
  never published, sold or passed on.
- **Where:** Google Drive under cavecad.app@gmail.com, with Google as the
  storage provider.
- **How long:** until 30 days after your report is closed, and never more
  than 12 months.
- **Deletion:** email cavecad.app@gmail.com with your report's reference
  and it will be deleted.
- **Your drawings stay yours.** Sending one lets us use it to find and fix
  the problem, nothing else.

## Contact

cavecad.app@gmail.com

---
Any new CaveCAD feature that goes online updates the table above in the
same change.
```

- [ ] **Step 2: README** — add under the first heading block:

```markdown
**Privacy:** see [PRIVACY.md](PRIVACY.md). Contact: cavecad.app@gmail.com
```

- [ ] **Step 3: About** — after line 102:

```js
About.privacyUrl = "https://github.com/Nate-the-Ace/cavecad-src/blob/cavecad/PRIVACY.md";
About.contactEmail = "cavecad.app@gmail.com";
```

and right after the closing `}` of the `if (this.applicationName!=="QCAD" ...)` block (before the "Plugins and script add-ons" paragraph):

```js
            html += "<p>" + qsTr("Contact: %1").arg("<a href='mailto:" + About.contactEmail + "'>" + About.contactEmail + "</a>")
                 + " &middot; <a href='" + About.privacyUrl + "'>" + qsTr("Privacy") + "</a></p>"
                 + "<p>" + qsTr("Provided without warranty; see the licence.") + "</p>";
```

- [ ] **Step 4: Commit**

```bash
git add PRIVACY.md README.md scripts/Help/About/About.js
git commit -m "docs: privacy policy; About gains contact, privacy and warranty lines"
```

---

### Task 11: Handbook privacy page (cavecad-tools)

**Goal:** The Cave Survey handbook has a Privacy page with the same content, and it reaches CaveCAD.

**Files (repo `~/Documents/github/cavecad-tools`):**
- Create: `docs/handbook/pages/privacy.html`
- Modify: `docs/handbook/index.json` (append `{"id": "privacy", "title": "Privacy", "class": "process", "file": "privacy.html", "shots": []}`)
- Modify: `VERSION` (patch bump — hold at 0.9.X)

**DECIDE before starting (asked at execution time):** cavecad-tools is checked out on branch `legacy-map` (in-progress work, at 0.9.181.2), not `main`. Why still open: the brainstorm never touched cavecad-tools branches. Options: (a) commit on `legacy-map` and publish from it — ships with the legacy-map work, nothing on `main` changes; (b) a fresh branch from `main` — ships alone, `legacy-map` untouched, needs a merge later. Neither changes the cavecad-src work.

**Acceptance Criteria:**
- [ ] `privacy.html` states the table's content in handbook style (h1, short paragraphs, lists) and links to PRIVACY.md on GitHub.
- [ ] The repo's handbook tests pass (`tests/run_all.sh` or the handbook subset of `tests/test_addon.py`).
- [ ] `tools/publish.sh` ran and CaveCAD's Handbook panel lists Privacy.

**Verify:** `python3 -m pytest tests/test_addon.py -k handbook -q` → passed; then `tools/publish.sh` exit 0.

**Steps:**

- [ ] **Step 1: Page** — `docs/handbook/pages/privacy.html`:

```html
<h1>Privacy</h1>
<p>Nothing to accept. This page lists every time CaveCAD goes online and what happens to anything you send.</p>
<h2>What stays on your computer</h2>
<p>Drawings, survey data, scans and session logs never leave your computer unless you send them with <b>Help &gt; Send Feedback</b>.</p>
<h2>When CaveCAD goes online</h2>
<ul>
<li><b>Check for Updates</b> asks GitHub. GitHub sees your IP address, nothing else.</li>
<li><b>Surface Data</b> and the aerial basemap ask the USGS National Map. It sees your IP address and <b>the area fetched, which is roughly where your cave is</b>.</li>
<li><b>Entrance Location</b> shows OpenStreetMap and Esri imagery, and loads its map library from unpkg.com. They see your IP address and <b>the area you view</b>.</li>
<li><b>Send Feedback</b> sends only what you tick, to Google Drive under cavecad.app@gmail.com.</li>
</ul>
<p>The map services never receive cave names or survey data.</p>
<h2>Send Feedback</h2>
<ul>
<li>Only the CaveCAD maintainer and people they trust read reports. Never published, sold or passed on.</li>
<li>Kept until 30 days after the report is closed, and never more than 12 months.</li>
<li>To have a report deleted, email cavecad.app@gmail.com with its reference.</li>
<li>Your drawing stays yours; sending it lets us use it to fix the problem, nothing else.</li>
</ul>
<p>The full policy: <a href="https://github.com/Nate-the-Ace/cavecad-src/blob/cavecad/PRIVACY.md">PRIVACY.md</a>.</p>
```

- [ ] **Step 2: Index, version, tests** — append the index entry; bump `VERSION` patch (e.g. `0.9.181.2` → `0.9.181.3`); run the handbook tests.

- [ ] **Step 3: Commit and publish**

```bash
git add docs/handbook/pages/privacy.html docs/handbook/index.json VERSION
git commit -m "docs: handbook Privacy page"
tools/publish.sh
```

---

### Task 12: Live end-to-end verification

**Goal:** Prove the whole path on the real app and a real test deployment of the receiver.

**Files:** none (evidence only). Needs the maintainer's one-time setup (tools/feedback-receiver/README.md steps 1–9, including the test deployment) done first — ask for the test `/exec` URL and key.

**Acceptance Criteria:**
- [ ] Sending to the test deployment produces a Drive folder named `YYYY-MM-DD Bug — … (<id>)` with `report.json`, `logs/`, `screenshot.png`, the original zip; a Sheet row with Status New; an email to cavecad.app@gmail.com; and the app's "Sent … Reference <id>" matching.
- [ ] `screenshot.png` does not show the Send Feedback dialog.
- [ ] With "My drawing" ticked on a modified drawing, the drawing's file mtime and title-bar modified mark are unchanged afterwards.
- [ ] Endpoint pointed at `https://script.google.com/macros/s/INVALID/exec`: failure dialog shows the saved-copy text, Show file reveals the outbox zip, Write email opens a draft to cavecad.app@gmail.com with subject `CaveCAD Feedback <id>: …`.
- [ ] Restoring the test endpoint and relaunching empties the outbox within ~15 s and a second folder appears.
- [ ] The session log contains `[crumb] action: Send Feedback`, `[crumb] session:` and a `[crumb] close:` after closing a drawing.
- [ ] About shows contact, Privacy and no-warranty lines.
- [ ] Setting Status to Fixed stamps Closed in the Sheet.

**Verify:** screenshots via `cavecad_screenshot` and the Drive/Sheet contents, listed in the task's closing note.

**Steps:**

- [ ] **Step 1:** Locally (uncommitted) put the test endpoint and key into `scripts/Help/SendFeedback/FeedbackConfig.js`; `ninja`; deploy; `codesign --force --deep --sign - /Applications/CaveCAD.app`; quit CaveCAD fully (check `pgrep -x CaveCAD` is empty — an unsaved-changes prompt can block the quit) and relaunch.
- [ ] **Step 2:** Open the Pitfall Cave fixture (`~/Documents/github/cavecad-tools/testdata`), draw one line (modified), note the file's mtime (`stat -f %m`), then Help > Send Feedback: Bug, summary "E2E test", description "the scan is blurry" (hint must show), tick My drawing, Scans = Only scans used. Send. Check each criterion.
- [ ] **Step 3:** Invalid endpoint run (edit config, rebuild, redeploy, re-sign, relaunch) — failure path criteria. Then restore the test endpoint, relaunch, watch the outbox empty.
- [ ] **Step 4:** Read the newest `~/Library/Application Support/CaveCAD/logs/session-*.log` (or wherever `RSettings.getDataLocation()` points — print it via `cavecad_eval`) for the crumbs.
- [ ] **Step 5:** `git checkout scripts/Help/SendFeedback/FeedbackConfig.js` so the placeholders are back; `python3 -m unittest tests.test_feedback_config` passes.
- [ ] **Step 6:** Report results to the user with evidence, and the releases page link once CI publishes: https://github.com/Nate-the-Ace/cavecad-src/releases
