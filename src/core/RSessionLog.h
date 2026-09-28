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
