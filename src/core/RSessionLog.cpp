#include "RSessionLog.h"

#include "RSettings.h"

#include <QCoreApplication>
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QLocale>
#include <QMutexLocker>
#include <QSysInfo>
#include <QTime>

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
    // The script engine's qWarning/qCritical bindings stream a single
    // QString through QDebug (qWarning() << str), which QDebug wraps in a
    // matching pair of double quotes -- a display convention, not content.
    // Unwrap it so "[crumb] ..." lines (and any other bare-string message)
    // land in the log the way they were written, not re-quoted.
    QString m = message;
    if (m.length() >= 2 && m.startsWith(QLatin1Char('"')) && m.endsWith(QLatin1Char('"'))) {
        QString inner = m.mid(1, m.length() - 2);
        if (!inner.contains(QLatin1Char('"'))) {
            m = inner;
        }
    }
    QMutexLocker lock(&mutex);
    // anything logged while opening (RSettings, QDir) must not recurse
    if (busy) {
        return;
    }
    busy = true;
    if (open()) {
        file->write(format(type, m, QTime::currentTime().toString("HH:mm:ss.zzz")));
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
