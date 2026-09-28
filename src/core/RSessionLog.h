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

    /** Opens the log file now (data location or CAVECAD_LOG_DIR), if not
     * already open. Called once eagerly right after the message handler is
     * installed, so the log exists even if the first message never comes;
     * write() still opens it lazily as a fallback. Safe to call more than
     * once; a no-op once the file is open or opening has already failed. */
    static bool open();

    /** "HH:mm:ss.zzz T message\n", T one of I W C F. */
    static QByteArray format(QtMsgType type, const QString& message, const QString& time);
    /** Deletes all but the newest `keep` session-*.log files in dir. Never
     * removes `keepName` (the current log), even if its name would sort
     * outside the newest `keep`. */
    static void rotate(const QString& dir, int keep, const QString& keepName = QString());
    /** content with its body (after headerBytes) cut to the newest half, starting on a line. */
    static QByteArray trimmed(const QByteArray& content, int headerBytes);

    static const int KEEP = 5;
    static const qint64 CAP = 2 * 1024 * 1024;

private:
    static QByteArray header();

    static QMutex mutex;
    static QFile* file;
    static bool failed;
    static int headerBytes;
    static qint64 cap;
};

#endif
