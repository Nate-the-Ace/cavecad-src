/**
 * Copyright (c) 2026 by Nathan Schonegg.
 *
 * This file is part of CaveCAD.
 *
 * CaveCAD is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * CaveCAD is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with CaveCAD.  If not, see <http://www.gnu.org/licenses/>.
 */
#include "RCave3dBridge.h"
#include "RCave3dView.h"
#include "RCave3dEncoder.h"
#include "RCave3dPanel.h"
#include "RCave3dView.h"
#include "RDockWidget.h"
#include "RMainWindowQt.h"

#include <QColor>
#include <QVariantList>
#include <QVector3D>
#include <QDir>
#include <QProcess>
#include <QStandardPaths>
#include <QFileInfo>
#include <QImage>

namespace {

/**
 * A script array of numbers as a float vector.
 *
 * QVariantList is what a JS array arrives as, and each element costs a
 * QVariant. That is the transfer cost the plan set out to MEASURE, and
 * it is all in this one function: if a large cave proves too slow, this
 * is what a binary blob would replace.
 */
QVector<float> toFloats(const QVariant& value) {
    QVector<float> out;
    if (!value.isValid()) {
        return out;
    }
    QVariantList list = value.toList();
    out.reserve(list.size());
    for (int i = 0; i < list.size(); i++) {
        out.append(float(list.at(i).toDouble()));
    }
    return out;
}

QVector3D toVector(const QVariant& value, const QVector3D& fallback) {
    if (!value.isValid()) {
        return fallback;
    }
    QVariantMap map = value.toMap();
    if (map.isEmpty()) {
        return fallback;
    }
    return QVector3D(float(map.value("x").toDouble()),
                     float(map.value("y").toDouble()),
                     float(map.value("z").toDouble()));
}

} // namespace

RCave3dBridge* RCave3dBridge::getInstance() {
    // Never deleted: it holds a dock owned by the main window and
    // outlives every script engine that asks for it.
    static RCave3dBridge* instance = NULL;
    if (instance == NULL) {
        instance = new RCave3dBridge();
    }
    return instance;
}

RCave3dBridge::RCave3dBridge(QObject* parent)
    : QObject(parent), askedForFirstMesh(false), signalsClaimed(false),
      docked(false),
      dock(NULL), panel(NULL), handle(0) {
}

RCave3dBridge::~RCave3dBridge() {
    // The dock is parented to the main window, which deletes it. Taking
    // it down from here would be a double delete on shutdown.
    dock = NULL;
    panel = NULL;
    docked = false;
}

bool RCave3dBridge::claimSignals() {
    if (signalsClaimed) {
        return false;
    }
    signalsClaimed = true;
    return true;
}

RCave3dPanel* RCave3dBridge::panelFor(int h) const {
    if (h == 0 || h != handle) {
        return NULL;
    }
    return panel;
}

int RCave3dBridge::prewarm() {
    if (dock != NULL) {
        return handle;
    }
    if (RMainWindowQt::getMainWindow() == NULL) {
        return 0;           // headless, or too early to have a window
    }
    build(QString());
    if (dock != NULL) {
        // TAKEN BACK OUT OF THE LAYOUT, not merely hidden. This runs
        // while the add-ons load, BEFORE the main window is shown, and
        // showing a window shows the children that are in it -- so a
        // plain hide() here is undone a moment later and the caver
        // finds an empty 3D panel already open. removeDockWidget takes
        // it out and hides it; open() puts it back.
        RMainWindowQt* appWin = RMainWindowQt::getMainWindow();
        if (appWin != NULL) {
            appWin->removeDockWidget(dock);
        }
        docked = false;
    }
    return handle;
}

void RCave3dBridge::onDockVisibilityChanged(bool visible) {
    // A PANEL RESTORED BY THE WINDOW'S SAVED LAYOUT HAS NO MESH.
    //
    // The dock carries an objectName so Qt remembers where the caver
    // put it, and Qt therefore also puts it BACK -- visible, before the
    // tool has ever run. What they get is an empty 3D view that looks
    // broken. So a panel that comes up visible with nothing in it asks
    // for a mesh, once.
    if (!visible || handle == 0 || askedForFirstMesh) {
        return;
    }
    if (panel != NULL && panel->getView() != NULL &&
            panel->getView()->hasGeometry()) {
        return;             // already showing a cave
    }
    askedForFirstMesh = true;
    emit refreshRequested(handle);
}

int RCave3dBridge::open(const QString& caveName) {
    RMainWindowQt* appWin = RMainWindowQt::getMainWindow();
    if (appWin == NULL) {
        return 0;   // headless: nothing to dock into
    }

    QString title = caveName.isEmpty()
        ? tr("3D View")
        : tr("3D View -- %1").arg(caveName);

    build(title);
    if (dock == NULL) {
        return 0;
    }
    // PUT BACK WHAT PREWARM TOOK OUT -- but only if it is really out.
    //
    // THE BUG THIS GUARD EXISTS FOR (Nathan, 2026-09-19: "in the 3D
    // View, when you refresh it resets the pallet window"). prewarm()
    // builds the dock before the main window is shown and takes it
    // straight back out of the layout, leaving `docked` false. Qt then
    // restores the saved window state, which HAS an entry for this
    // dock because it carries an objectName -- so the panel comes back
    // at the size and place the caver left it, put there by Qt and not
    // by us. `docked` is still false, and nothing ever told the bridge
    // otherwise.
    //
    // The first refresh of the session then went through open(), saw
    // that stale false, and called addDockWidget on a dock that was
    // already in the layout. Qt does not treat that as a no-op: it
    // lifts the dock out of wherever it is and appends it to the
    // bottom of the right-hand area at its size hint. A panel the
    // caver had filling the column collapsed to a couple of hundred
    // pixels at the foot of the window, once per launch, on the first
    // Refresh.
    //
    // So ask Qt where the dock actually is rather than believing a
    // flag. A dock the caver has torn off answers NoDockWidgetArea as
    // well, which is why floating is checked too -- dragging a
    // floating panel back into the dock area is the one thing this
    // must not do behind their back.
    const bool reallyDocked =
        appWin->dockWidgetArea(dock) != Qt::NoDockWidgetArea;
    if (!reallyDocked && !dock->isFloating()) {
        appWin->addDockWidget(Qt::RightDockWidgetArea, dock);
    }
    docked = true;
    dock->setWindowTitle(title);
    dock->show();
    dock->raise();
    return handle;
}

/** Makes the dock and the panel, once. */
void RCave3dBridge::build(const QString& title) {
    RMainWindowQt* appWin = RMainWindowQt::getMainWindow();
    if (appWin == NULL) {
        return;
    }
    if (dock == NULL) {
        // THE DOCK FIRST, AND DOCKED, BEFORE THE PANEL IS BUILT INSIDE
        // IT. Built the other way round, the panel -- and the
        // QOpenGLWidget in it -- exists for a moment as its own
        // top-level window and is then reparented into the main window.
        // Reparenting a GL widget rebuilds its context, and on macOS
        // that takes the whole window's view tree with it: the drawing
        // blanks and the layout re-flows in front of the caver, every
        // first open.
        dock = new RDockWidget(title.isEmpty() ? tr("3D View") : title,
                               appWin);
        // The object name is what Qt saves and restores window state
        // by. Without it the panel forgets where the caver put it every
        // time the application restarts, and Qt says so on stderr.
        dock->setObjectName("Cave3dDock");
        dock->setAllowedAreas(Qt::AllDockWidgetAreas);
        appWin->addDockWidget(Qt::RightDockWidgetArea, dock);
        docked = true;
        connect(dock, SIGNAL(visibilityChanged(bool)),
                this, SLOT(onDockVisibilityChanged(bool)));

        panel = new RCave3dPanel(dock);
        dock->setWidget(panel);
        handle = 1;

        connect(panel, SIGNAL(refreshRequested()),
                this, SLOT(onWindowRefresh()));
        connect(panel, SIGNAL(modeChanged(QString)),
                this, SLOT(onPanelModeChanged(QString)));
        connect(panel, SIGNAL(overlayToggled(QString, bool)),
                this, SLOT(onPanelOverlayToggled(QString, bool)));
        connect(panel, SIGNAL(scanInkChanged(double)),
                this, SLOT(onPanelScanInkChanged(double)));
        connect(panel, SIGNAL(terrainOpacityChanged(double)),
                this, SLOT(onPanelTerrainOpacityChanged(double)));
        connect(panel, SIGNAL(cameraModeChanged(QString)),
                this, SLOT(onPanelCameraModeChanged(QString)));
        connect(panel, SIGNAL(cameraSpeedChanged(double)),
                this, SLOT(onPanelCameraSpeedChanged(double)));
        connect(panel, SIGNAL(exportRequested()),
                this, SLOT(onPanelExportRequested()));
        if (panel->getView() != NULL) {
            connect(panel->getView(), SIGNAL(stationPicked(QString)),
                    this, SLOT(onViewStationPicked(QString)));
        }
    }
}

void RCave3dBridge::close(int h) {
    RCave3dPanel* p = panelFor(h);
    if (p == NULL || dock == NULL) {
        return;
    }
    // HIDDEN, NOT DELETED. A dock the caver has arranged is worth
    // keeping: closing and reopening should put the panel back where it
    // was, and deleting it would also tear down the GL context for the
    // sake of a button press.
    dock->hide();
}

bool RCave3dBridge::isOpen(int h) {
    RCave3dPanel* p = panelFor(h);
    if (p == NULL || dock == NULL) {
        return false;
    }
    return dock->isVisible();
}

void RCave3dBridge::raiseWindow(int h) {
    RCave3dPanel* p = panelFor(h);
    if (p == NULL || dock == NULL) {
        return;
    }
    dock->show();
    dock->raise();
    if (dock->isFloating()) {
        dock->activateWindow();
    }
}

void RCave3dBridge::setMesh(int handle, const QVariantMap& mesh) {
    RCave3dPanel* p = panelFor(handle);
    if (p == NULL) {
        return;
    }
    RCave3dView* view = p->getView();
    if (view == NULL) {
        return;
    }

    QVariantMap triangles = mesh.value("triangles").toMap();
    view->setTriangles(toFloats(triangles.value("positions")),
                       toFloats(triangles.value("normals")),
                       toFloats(triangles.value("colors")));

    QVariantMap lines = mesh.value("lines").toMap();
    view->setLines(toFloats(lines.value("positions")),
                   toFloats(lines.value("colors")));

    QVariantMap ghost = mesh.value("ghost").toMap();
    QVector<float> ghostPos = toFloats(ghost.value("positions"));
    view->setGhost(ghostPos, toFloats(ghost.value("colors")));
    p->setGhostAvailable(!ghostPos.isEmpty());

    QVariantMap leads = mesh.value("leads").toMap();
    view->setLeads(toFloats(leads.value("positions")),
                   toFloats(leads.value("colors")));

    QVariantMap sections = mesh.value("sections").toMap();
    QVector<float> sectionPos = toFloats(sections.value("positions"));
    view->setSections(sectionPos, toFloats(sections.value("colors")));
    p->setSectionsAvailable(!sectionPos.isEmpty());

    // The draped sketches. `runs` says how many indices belong to each
    // scan, so the view can bind one texture per scan without needing to
    // know what a scan is.
    QVariantMap scans = mesh.value("scans").toMap();
    QVector<float> scanPos = toFloats(scans.value("positions"));
    QStringList scanPaths;
    QVariantList pathList = scans.value("paths").toList();
    for (int i = 0; i < pathList.size(); i++) {
        scanPaths.append(pathList.at(i).toString());
    }
    QVector<int> scanIdx;
    QVariantList idxList = scans.value("indices").toList();
    scanIdx.reserve(idxList.size());
    for (int i = 0; i < idxList.size(); i++) {
        scanIdx.append(idxList.at(i).toInt());
    }
    QVector<int> scanRuns;
    QVariantList runList = scans.value("runs").toList();
    for (int i = 0; i < runList.size(); i++) {
        scanRuns.append(runList.at(i).toInt());
    }
    view->setScans(scanPos, toFloats(scans.value("uvs")), scanIdx,
                   scanPaths, scanRuns);
    p->setScansAvailable(!scanPaths.isEmpty());

    // The surface above the cave. Indexed, unlike the passage: a
    // terrain grid's vertices really are shared, so the indices are
    // carried across rather than thrown away as the triangles' are.
    QVariantMap terrain = mesh.value("terrain").toMap();
    QVector<float> terrainPos = toFloats(terrain.value("positions"));
    QVector<int> terrainIdx;
    QVariantList tIdxList = terrain.value("indices").toList();
    terrainIdx.reserve(tIdxList.size());
    for (int i = 0; i < tIdxList.size(); i++) {
        terrainIdx.append(tIdxList.at(i).toInt());
    }
    view->setTerrain(terrainPos, toFloats(terrain.value("normals")),
                     toFloats(terrain.value("uvs")), terrainIdx,
                     terrain.value("texture").toString());
    QVariantMap terrainLines = terrain.value("lines").toMap();
    view->setTerrainLines(toFloats(terrainLines.value("positions")),
                          toFloats(terrainLines.value("colors")));
    p->setTerrainAvailable(!terrainIdx.isEmpty());

    // The station names, for the labels over the passage.
    QVariantMap stations = mesh.value("stations").toMap();
    QVector<float> stationPos = toFloats(stations.value("positions"));
    QStringList stationNames;
    QVariantList nameList = stations.value("names").toList();
    for (int i = 0; i < nameList.size(); i++) {
        stationNames.append(nameList.at(i).toString());
    }
    QVector<QVector3D> stationPoints;
    for (int i = 0; i + 2 < stationPos.size(); i += 3) {
        stationPoints.append(QVector3D(stationPos.at(i), stationPos.at(i + 1),
                                       stationPos.at(i + 2)));
    }
    view->setStations(stationPoints, stationNames);
    p->setStationsAvailable(!stationPoints.isEmpty());

    // The passage's cross section at each station, for the white ring
    // the fly camera draws around itself.
    QVariantMap outlines = mesh.value("outlines").toMap();
    QVector<int> outlineCounts;
    QVariantList countList = outlines.value("counts").toList();
    for (int i = 0; i < countList.size(); i++) {
        outlineCounts.append(countList.at(i).toInt());
    }
    QVector<int> outlineLegs;
    QVariantList legList = outlines.value("legs").toList();
    for (int i = 0; i < legList.size(); i++) {
        outlineLegs.append(legList.at(i).toInt());
    }
    view->setOutlines(toFloats(outlines.value("positions")), outlineCounts,
                      toFloats(outlines.value("centres")), outlineLegs);

    QVariantMap legend = mesh.value("legend").toMap();
    QVector<RCave3dView::LegendStop> stops;
    QVariantList stopList = legend.value("stops").toList();
    for (int i = 0; i < stopList.size(); i++) {
        QVariantMap sv = stopList.at(i).toMap();
        QVariantList c = sv.value("color").toList();
        RCave3dView::LegendStop stop;
        stop.color = QColor::fromRgbF(
            c.value(0).toDouble(), c.value(1).toDouble(),
            c.value(2).toDouble());
        stop.label = sv.value("label").toString();
        stop.swatch = sv.value("swatch", false).toBool();
        stops.append(stop);
    }
    view->setLegend(legend.value("title").toString(),
                    legend.value("note").toString(),
                    legend.value("kind").toString(), stops);

    QVector<QPair<int, int> > steps;
    QVariantList stepList = mesh.value("steps").toList();
    for (int i = 0; i < stepList.size(); i++) {
        QVariantMap sv = stepList.at(i).toMap();
        steps.append(QPair<int, int>(sv.value("triangleVertices").toInt(),
                                     sv.value("lineVertices").toInt()));
    }
    p->setSteps(steps);

    // KEEPS THE CAVER'S VIEWPOINT. This used to end in an outright
    // viewAll, so every rebuild of the mesh threw away wherever they
    // had put the camera -- and since viewAll also marks the camera
    // untouched, the next resize refitted it again for good measure.
    QVariantMap bounds = mesh.value("bounds").toMap();
    view->frameToBounds(toVector(bounds.value("min"), QVector3D(-1, -1, -1)),
                        toVector(bounds.value("max"), QVector3D(1, 1, 1)));
}

void RCave3dBridge::clear(int handle) {
    RCave3dPanel* p = panelFor(handle);
    if (p == NULL || p->getView() == NULL) {
        return;
    }
    p->getView()->clearGeometry();
}

void RCave3dBridge::setStatus(int handle, const QString& text) {
    RCave3dPanel* p = panelFor(handle);
    if (p == NULL) {
        return;
    }
    p->setStatus(text);
}

void RCave3dBridge::viewAll(int handle) {
    RCave3dPanel* p = panelFor(handle);
    if (p != NULL && p->getView() != NULL) {
        p->getView()->viewAll();
    }
}

void RCave3dBridge::viewPlan(int handle) {
    RCave3dPanel* p = panelFor(handle);
    if (p != NULL && p->getView() != NULL) {
        p->getView()->viewPlan();
    }
}

void RCave3dBridge::viewProfile(int handle) {
    RCave3dPanel* p = panelFor(handle);
    if (p != NULL && p->getView() != NULL) {
        p->getView()->viewProfile();
    }
}

void RCave3dBridge::setShowSurface(int handle, bool on) {
    RCave3dPanel* p = panelFor(handle);
    if (p != NULL && p->getView() != NULL) {
        p->getView()->setShowSurface(on);
    }
}

void RCave3dBridge::setShowLines(int handle, bool on) {
    RCave3dPanel* p = panelFor(handle);
    if (p != NULL && p->getView() != NULL) {
        p->getView()->setShowLines(on);
    }
}

void RCave3dBridge::setShowGhost(int h, bool on) {
    RCave3dPanel* p = panelFor(h);
    if (p != NULL) {
        p->setShowGhost(on);
    }
}

void RCave3dBridge::setShowLeads(int h, bool on) {
    RCave3dPanel* p = panelFor(h);
    if (p != NULL) {
        p->setShowLeads(on);
    }
}

void RCave3dBridge::setShowSections(int h, bool on) {
    RCave3dPanel* p = panelFor(h);
    if (p != NULL) {
        p->setShowSections(on);
    }
}

void RCave3dBridge::setShowScans(int h, bool on) {
    RCave3dPanel* p = panelFor(h);
    if (p != NULL) {
        p->setShowScans(on);
    }
}

void RCave3dBridge::setFlyPath(int h, const QVariantList& points,
                               const QVariantList& breaks,
                               const QVariantList& turns) {
    RCave3dPanel* p = panelFor(h);
    if (p == NULL || p->getView() == NULL) {
        return;
    }
    QVector<float> pts;
    pts.reserve(points.size());
    for (int i = 0; i < points.size(); i++) {
        pts.append(float(points.at(i).toDouble()));
    }
    QVector<int> brk;
    for (int i = 0; i < breaks.size(); i++) {
        brk.append(breaks.at(i).toInt());
    }
    QVector<int> trn;
    for (int i = 0; i < turns.size(); i++) {
        trn.append(turns.at(i).toInt());
    }
    p->getView()->setFlyPath(pts, brk, trn);
    p->setFlyAvailable(pts.size() >= 6);
}

void RCave3dBridge::setCameraMode(int h, const QString& mode) {
    RCave3dPanel* p = panelFor(h);
    if (p == NULL) {
        return;
    }
    p->setCameraMode(mode);
}

QString RCave3dBridge::getCameraMode(int h) {
    RCave3dPanel* p = panelFor(h);
    if (p == NULL || p->getView() == NULL) {
        return QString("manual");
    }
    switch (p->getView()->getCameraMode()) {
    case RCave3dView::CameraFly:  return QString("fly");
    case RCave3dView::CameraSpin: return QString("spin");
    default: break;
    }
    return QString("manual");
}

void RCave3dBridge::setCameraSpeed(int h, double factor) {
    RCave3dPanel* p = panelFor(h);
    if (p != NULL) {
        p->setCameraSpeed(factor);
    }
}

double RCave3dBridge::getCameraSpeed(int h) {
    RCave3dPanel* p = panelFor(h);
    return (p == NULL) ? 1.0 : p->getCameraSpeed();
}

void RCave3dBridge::setCameraProgress(int h, double t) {
    RCave3dPanel* p = panelFor(h);
    if (p != NULL) {
        p->setCameraProgress(t);
    }
}

bool RCave3dBridge::canEncode() {
    return RCave3dEncoder::available();
}

QString RCave3dBridge::exportFilm(int h, const QString& outFile, int frames,
                                  int fps) {
    encodeError.clear();
    RCave3dPanel* p = panelFor(h);
    if (p == NULL || p->getView() == NULL) {
        encodeError = tr("there is no 3D view to film");
        return QString();
    }
    RCave3dView* v = p->getView();

    // One frame first, to learn the size every other one must match:
    // the film's dimensions are fixed when it opens.
    double was = v->getCameraProgress();
    v->setCameraProgress(0.0);
    QImage first = v->renderFrame(v->width(), v->height());
    if (first.isNull()) {
        v->setCameraProgress(was);
        encodeError = tr("the view would not give up a picture");
        return QString();
    }
    QSize size((first.width() / 2) * 2, (first.height() / 2) * 2);

    QString why;
    RCave3dEncoder* enc = RCave3dEncoder::create(outFile, size, fps, why);
    if (enc == NULL) {
        v->setCameraProgress(was);
        encodeError = why;
        return QString();
    }

    int count = qBound(2, frames, 3600);
    bool ok = true;
    for (int i = 0; i < count && ok; i++) {
        // The last frame lands ONE STEP SHORT of the start for a spin,
        // so an exported loop does not show the same frame twice where
        // it joins; a flight is not a loop and should reach the far end.
        double t = (v->getCameraMode() == RCave3dView::CameraFly)
            ? double(i) / double(count - 1)
            : double(i) / double(count);
        v->setCameraProgress(t);
        QImage frame = v->renderFrame(v->width(), v->height());
        if (frame.isNull()) {
            encodeError = tr("the view stopped giving up pictures");
            ok = false;
            break;
        }
        if (frame.size() != size) {
            frame = frame.copy(QRect(QPoint(0, 0), size));
        }
        if (!enc->addFrame(frame)) {
            encodeError = enc->error();
            ok = false;
        }
    }
    if (ok && !enc->finish()) {
        encodeError = enc->error();
        ok = false;
    }
    delete enc;
    v->setCameraProgress(was);

    if (!ok) {
        QFile::remove(outFile);     // no half a film left behind
        return QString();
    }
    QFileInfo made(outFile);
    if (!made.exists() || made.size() < 1024) {
        encodeError = tr("the encoder wrote nothing worth keeping");
        return QString();
    }
    return outFile;
}

QString RCave3dBridge::findEncoder() {
    // On the PATH first, which is where a caver who installed it will
    // have it. Then the places the usual installers put it, because a
    // GUI application launched from the Finder does not inherit the
    // shell's PATH and would otherwise not find a perfectly good
    // ffmpeg sitting in /opt/homebrew/bin.
    QString found = QStandardPaths::findExecutable("ffmpeg");
    if (!found.isEmpty()) {
        return found;
    }
    QStringList tries;
    tries << "/opt/homebrew/bin" << "/usr/local/bin" << "/usr/bin"
          << "/opt/local/bin"
          << "C:/Program Files/ffmpeg/bin"
          << "C:/ffmpeg/bin";
    found = QStandardPaths::findExecutable("ffmpeg", tries);
    return found;
}

QString RCave3dBridge::encodeFrames(const QString& framesDir,
                                    const QString& outFile, int fps) {
    encodeError.clear();
    QString ffmpeg = findEncoder();
    if (ffmpeg.isEmpty()) {
        encodeError = tr("no encoder found");
        return QString();
    }
    QDir d(framesDir);
    if (!d.exists()) {
        encodeError = tr("the frames are not there");
        return QString();
    }

    QStringList args;
    args << "-y"
         << "-framerate" << QString::number(qBound(1, fps, 120))
         << "-i" << d.filePath("frame_%05d.png")
         // EVEN DIMENSIONS OR H.264 REFUSES. The frames are the size of
         // the panel, which is whatever the caver dragged it to, and an
         // odd width fails the encode with a message about yuv420p that
         // says nothing about the real cause.
         << "-vf" << "scale=trunc(iw/2)*2:trunc(ih/2)*2"
         << "-c:v" << "libx264"
         << "-pix_fmt" << "yuv420p"
         << "-crf" << "20"
         << outFile;

    QProcess run;
    run.start(ffmpeg, args);
    if (!run.waitForStarted(10000)) {
        encodeError = tr("the encoder would not start");
        return QString();
    }
    // Long enough for a few hundred frames on a slow machine, and
    // bounded so a wedged encoder cannot hang the application.
    if (!run.waitForFinished(300000)) {
        run.kill();
        encodeError = tr("the encoder took too long and was stopped");
        return QString();
    }
    if (run.exitStatus() != QProcess::NormalExit || run.exitCode() != 0) {
        QString said = QString::fromLocal8Bit(run.readAllStandardError());
        // The last line is the one that says what went wrong; the rest
        // is ffmpeg telling us about itself.
        QStringList lines = said.split("\n", Qt::SkipEmptyParts);
        encodeError = lines.isEmpty() ? tr("the encoder failed")
                                      : lines.last().trimmed();
        return QString();
    }
    QFileInfo made(outFile);
    if (!made.exists() || made.size() < 1024) {
        encodeError = tr("the encoder wrote nothing worth keeping");
        return QString();
    }
    return outFile;
}

int RCave3dBridge::exportFrames(int h, const QString& dir, int frames) {
    RCave3dPanel* p = panelFor(h);
    if (p == NULL || p->getView() == NULL) {
        return -1;
    }
    QDir d(dir);
    if (!d.exists() && !d.mkpath(".")) {
        return -1;
    }
    RCave3dView* v = p->getView();
    int count = qBound(2, frames, 3600);
    double was = v->getCameraProgress();
    int written = 0;
    for (int i = 0; i < count; i++) {
        // The last frame lands ONE STEP SHORT of the start rather than
        // on it, so a spin exported as a loop does not show the same
        // frame twice where it joins.
        double t = double(i) / double(count);
        if (v->getCameraMode() == RCave3dView::CameraFly) {
            // A flight is not a loop: it should reach the far end.
            t = double(i) / double(count - 1);
        }
        v->setCameraProgress(t);
        QImage frame = v->renderFrame(v->width(), v->height());
        if (frame.isNull()) {
            break;
        }
        QString name = QString("frame_%1.png")
            .arg(i, 5, 10, QChar('0'));
        if (!frame.save(d.filePath(name), "PNG")) {
            break;
        }
        written++;
    }
    v->setCameraProgress(was);
    return written;
}

void RCave3dBridge::setShowStations(int h, bool on) {
    RCave3dPanel* p = panelFor(h);
    if (p != NULL) {
        p->setShowStations(on);
    }
}

void RCave3dBridge::showStationCard(int h, const QString& station,
                                    const QString& title,
                                    const QStringList& labels,
                                    const QStringList& values) {
    RCave3dPanel* p = panelFor(h);
    if (p != NULL && p->getView() != NULL) {
        p->getView()->showStationCard(station, title, labels, values);
    }
}

void RCave3dBridge::hideStationCard(int h) {
    RCave3dPanel* p = panelFor(h);
    if (p != NULL && p->getView() != NULL) {
        p->getView()->hideStationCard();
    }
}

QString RCave3dBridge::pickStation(int h, int x, int y) {
    RCave3dPanel* p = panelFor(h);
    if (p == NULL || p->getView() == NULL) {
        return QString();
    }
    QString station = p->getView()->stationAt(QPoint(x, y));
    // The same signal a click sends, miss included: a test that only
    // got the name back would not exercise the half of this that
    // builds the card.
    onViewStationPicked(station);
    return station;
}

int RCave3dBridge::hoverStation(int h, int x, int y) {
    RCave3dPanel* p = panelFor(h);
    if (p == NULL || p->getView() == NULL) {
        return -1;
    }
    return p->getView()->hoverAt(QPoint(x, y));
}

void RCave3dBridge::setScanInk(int h, double value) {
    RCave3dPanel* p = panelFor(h);
    if (p != NULL) {
        p->setScanInk(value);
    }
}

void RCave3dBridge::setShowTerrain(int h, bool on) {
    RCave3dPanel* p = panelFor(h);
    if (p != NULL) {
        p->setShowTerrain(on);
    }
}

void RCave3dBridge::setShowTerrainContours(int h, bool on) {
    RCave3dPanel* p = panelFor(h);
    if (p != NULL) {
        p->setShowTerrainContours(on);
    }
}

void RCave3dBridge::setTerrainOpacity(int h, double value) {
    RCave3dPanel* p = panelFor(h);
    if (p != NULL) {
        p->setTerrainOpacity(value);
    }
}

double RCave3dBridge::getTerrainOpacity(int h) {
    RCave3dPanel* p = panelFor(h);
    if (p == NULL || p->getView() == NULL) {
        return RCave3dView::DEFAULT_TERRAIN_OPACITY;
    }
    return p->getView()->getTerrainOpacity();
}

double RCave3dBridge::getScanInk(int h) {
    RCave3dPanel* p = panelFor(h);
    if (p == NULL || p->getView() == NULL) {
        return RCave3dView::DEFAULT_SCAN_INK;
    }
    return p->getView()->getScanInk();
}

QVariantMap RCave3dBridge::getCamera(int h) {
    QVariantMap out;
    RCave3dPanel* p = panelFor(h);
    if (p == NULL || p->getView() == NULL) {
        return out;
    }
    RCave3dView* v = p->getView();
    out["yaw"] = double(v->getYaw());
    out["pitch"] = double(v->getPitch());
    out["distance"] = double(v->getDistance());
    out["targetX"] = double(v->getTarget().x());
    out["targetY"] = double(v->getTarget().y());
    out["targetZ"] = double(v->getTarget().z());
    out["untouched"] = v->isCameraUntouched();
    // What a pan moves per pixel of mouse. Exposed so "a drag carries
    // the cave under the cursor" is something a test can state.
    out["eyeX"] = double(v->getEye().x());
    out["eyeY"] = double(v->getEye().y());
    out["eyeZ"] = double(v->getEye().z());
    out["lookX"] = double(v->getLook().x());
    out["lookY"] = double(v->getLook().y());
    out["lookZ"] = double(v->getLook().z());
    out["worldPerPixel"] = double(v->worldPerPixel());
    out["viewHeight"] = v->height();
    out["fov"] = double(RCave3dView::FOV_DEGREES);
    return out;
}

void RCave3dBridge::setColorModes(int h, const QStringList& keys,
                                  const QStringList& labels,
                                  const QString& current) {
    RCave3dPanel* p = panelFor(h);
    if (p != NULL) {
        p->setColorModes(keys, labels, current);
    }
}

void RCave3dBridge::onPanelModeChanged(const QString& mode) {
    if (handle != 0) {
        emit colorModeChanged(handle, mode);
    }
}

void RCave3dBridge::onPanelOverlayToggled(const QString& which, bool on) {
    if (handle != 0) {
        emit overlayToggled(handle, which, on);
    }
}

void RCave3dBridge::onPanelScanInkChanged(double value) {
    if (handle != 0) {
        emit scanInkChanged(handle, value);
    }
}

void RCave3dBridge::onPanelTerrainOpacityChanged(double value) {
    if (handle != 0) {
        emit terrainOpacityChanged(handle, value);
    }
}

void RCave3dBridge::onPanelCameraModeChanged(const QString& mode) {
    if (handle != 0) {
        emit cameraModeChanged(handle, mode);
    }
}

void RCave3dBridge::onPanelCameraSpeedChanged(double factor) {
    if (handle != 0) {
        emit cameraSpeedChanged(handle, factor);
    }
}

void RCave3dBridge::onViewStationPicked(const QString& station) {
    if (handle != 0) {
        emit stationPicked(handle, station);
    }
}

void RCave3dBridge::onPanelExportRequested() {
    if (handle != 0) {
        emit exportRequested(handle);
    }
}

void RCave3dBridge::onWindowRefresh() {
    if (handle != 0) {
        emit refreshRequested(handle);
    }
}
