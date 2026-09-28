#include "RSessionLog.h"

#include "RSettings.h"

#include <QCoreApplication>
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QLocale>
#include <QMutexLocker>
#include <QSysInfo>
#include <QTime>

QMutex RSessionLog::mutex;
QFile* RSessionLog::file = NULL;
bool RSessionLog::failed = false;
thread_local bool RSessionLog::busy = false;
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

void RSessionLog::rotate(const QString& dir, int keep, const QString& keepName) {
    QDir d(dir);
    QStringList names = d.entryList(QStringList() << "session-*.log", QDir::Files, QDir::Name);
    int extra = names.size() - keep;
    for (int i = 0; i < names.size() && extra > 0; i++) {
        if (!keepName.isEmpty() && names.at(i) == keepName) {
            continue;
        }
        d.remove(names.at(i));
        extra--;
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
    // zero-padded suffix so a name sort (used by rotate()) matches creation
    // order even within the same second
    for (int n = 2; QFile::exists(path); n++) {
        path = dir + "/session-" + stamp + "-" + QString("%1").arg(n, 2, 10, QChar('0')) + ".log";
    }
    file = new QFile(path);
    if (!file->open(QIODevice::WriteOnly | QIODevice::Append)) {
        delete file;
        file = NULL;
        failed = true;
        return false;
    }
    rotate(dir, KEEP, QFileInfo(path).fileName());
    QByteArray h = header();
    headerBytes = h.size();
    file->write(h);
    file->flush();
    return true;
}

void RSessionLog::write(QtMsgType type, const QString& message) {
    if (type == QtDebugMsg && !message.startsWith(QLatin1String("[crumb]"))) {
        return;
    }
    // thread_local, checked before the (non-recursive) mutex: guards against
    // a message logged while opening or writing the log on this same thread
    // (e.g. RSettings::getDataLocation()), which would otherwise deadlock on
    // the mutex instead of just harmlessly re-entering write().
    if (busy) {
        return;
    }
    busy = true;
    QMutexLocker lock(&mutex);
    if (open()) {
        file->write(format(type, message, QTime::currentTime().toString("HH:mm:ss.zzz")));
        file->flush();
        if (file->size() > cap) {
            QString path = file->fileName();
            file->close();
            QFile in(path);
            if (in.open(QIODevice::ReadOnly)) {
                QByteArray all = in.readAll();
                in.close();
                if (file->open(QIODevice::WriteOnly | QIODevice::Truncate)) {
                    file->write(trimmed(all, headerBytes));
                    file->flush();
                    file->close();
                }
            }
            // if the file couldn't be read back, leave it as-is (already
            // flushed) rather than risk truncating it to nothing
            if (!file->open(QIODevice::WriteOnly | QIODevice::Append)) {
                delete file;
                file = NULL;
                failed = true;
            }
        }
    }
    busy = false;
}
