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
#ifndef RCAVE3DVIEW_H
#define RCAVE3DVIEW_H

#include "gui_global.h"

#include <QOpenGLWidget>
#include <QOpenGLFunctions>
#include <QOpenGLShaderProgram>
#include <QColor>

class RCave3dLegend;
class RCave3dLabels;
class RCave3dTexture;
class QOpenGLShaderProgram;
#include <QMatrix4x4>
#include <QList>
#include <QString>
#include <QStringList>
#include <QPoint>
#include <QVector3D>
#include <QVector>

/**
 * \brief A renderer that has never heard of caves.
 *
 * It draws two buffers -- a lit triangle mesh and flat coloured lines --
 * under an orbit camera, and that is the whole of it. Every cave fact
 * (stations, trips, LRUD, tags) stays in the Cave Survey script library,
 * which builds these buffers and hands them over.
 *
 * That division is deliberate. Teaching this class to read the drawing
 * would mean a second implementation of survey tag parsing, in a second
 * language, kept in step with the first by hand.
 *
 * World is Z-up, matching the survey's own frame, so no axis conversion
 * happens anywhere and none can be got wrong later when LiDAR captures
 * arrive in a Y-up format of their own.
 *
 * \ingroup gui
 * \scriptable
 */
class QCADGUI_EXPORT RCave3dView : public QOpenGLWidget,
                                   protected QOpenGLFunctions {
    Q_OBJECT

public:
    RCave3dView(QWidget* parent = NULL);
    virtual ~RCave3dView();

    /** One entry of a legend: a colour and what it means. Built on the
     *  script side, which is the only side that knows what a trip or a
     *  foot is; this class only paints it. */
    struct LegendStop {
        QColor color;
        QString label;
    };

    void setTriangles(const QVector<float>& positions,
                      const QVector<float>& normals,
                      const QVector<float>& colors);
    void setLines(const QVector<float>& positions,
                  const QVector<float>& colors);
    void setGhost(const QVector<float>& positions,
                  const QVector<float>& colors);
    void setLeads(const QVector<float>& positions,
                  const QVector<float>& colors);
    void setSections(const QVector<float>& positions,
                     const QVector<float>& colors);

    /**
     * The draped sketches. One entry of `runs` per scan, giving how many
     * INDICES belong to it, so each draws bound to its own texture.
     */
    void setScans(const QVector<float>& positions,
                  const QVector<float>& uvs,
                  const QVector<int>& indices,
                  const QStringList& paths,
                  const QVector<int>& runs);
    void setShowScans(bool on);

    /** Station names written over the passage. Positions are world
     *  coordinates; the two lists run together. */
    void setStations(const QVector<QVector3D>& positions,
                     const QStringList& names);
    void setShowStations(bool on);
    bool hasStations() const;

    /** How the camera moves on its own: not at all, down the passage,
     *  or slowly round the cave. */
    enum CameraMode { CameraManual, CameraFly, CameraSpin };

    /** The flight path, as [x,y,z,...] in world coordinates, with the
     *  indices where one surveyed run gives way to another. */
    void setFlyPath(const QVector<float>& points,
                    const QVector<int>& breaks);
    bool hasFlyPath() const { return flyPoints.size() >= 6; }

    void setCameraMode(CameraMode mode);
    CameraMode getCameraMode() const { return cameraMode; }

    /** Where along the flight, or how far round the spin: 0 to 1. */
    void setCameraProgress(double t);
    double getCameraProgress() const { return cameraProgress; }

    /** One frame of whatever the camera is doing, at a chosen size,
     *  with the labels and legend painted on as the screen shows them.
     *  \return a null image when there is nothing to render. */
    QImage renderFrame(int w, int h);

    /** Where a draped scan stops being pencil and starts being paper.
     *
     *  Luminance, 0 (black) to 1 (white): anything lighter is dropped,
     *  and the last stretch below it fades out rather than ending on a
     *  hard edge. Scanners disagree wildly about how grey a pencil line
     *  on white paper is, and there is no threshold that suits every
     *  book, so this is the caver's to set. Clamped to a range that
     *  always leaves SOMETHING on screen -- a slider that can wind the
     *  sketches away to nothing looks like a bug. */
    void setScanInk(double value);
    double getScanInk() const { return scanInk; }

    /** The threshold a panel starts at, so its slider can be built
     *  showing what the view is actually doing. */
    /** How much world one pixel covers at the distance being looked
     *  at: what a pan needs so the cave stays under the cursor. */
    float worldPerPixel() const;

    /** The vertical field of view. One number, used by the projection,
     *  by View All's framing and by the pan -- they disagree the moment
     *  there are two of them. */
    static const float FOV_DEGREES;

    static const double DEFAULT_SCAN_INK;
    static const double MIN_SCAN_INK;
    static const double MAX_SCAN_INK;

    void setBounds(const QVector3D& min, const QVector3D& max);

    /** New geometry's extent, and the camera moved to suit it ONLY if
     *  the caver has not placed it themselves.
     *
     *  A rebuild must not cost someone the viewpoint they arranged: the
     *  usual reason to press Refresh is to see a change in the place
     *  you are already looking at. A cave that is genuinely somewhere
     *  else -- a different drawing, whose new extent does not overlap
     *  the old at all -- is refitted anyway, because keeping a camera
     *  aimed at where the last cave was would show nothing but dark. */
    void frameToBounds(const QVector3D& min, const QVector3D& max);

    /** Where the camera is, and whether the caver put it there. Read
     *  only, and exposed so that "a rebuild keeps your viewpoint" is a
     *  thing a test can assert rather than a thing someone has to
     *  notice going wrong. */
    float getYaw() const { return yaw; }
    float getPitch() const { return pitch; }
    float getDistance() const { return distance; }
    QVector3D getTarget() const { return target; }
    bool isCameraUntouched() const { return cameraUntouched; }
    void clearGeometry();

    void setLegend(const QString& title, const QString& note,
                   const QString& kind, const QVector<LegendStop>& stops);

    /**
     * Draw only the first `triangleVertices` / `lineVertices` of each
     * buffer -- the build animation, which costs two integers because
     * CsMesh3d emits its geometry leg by leg.
     *
     * Negative means draw everything, which is also what a fresh mesh
     * gets: the animation is a thing you do, never a state the panel
     * sits in.
     */
    void setProgress(int triangleVertices, int lineVertices);

    void setShowGhost(bool on);
    void setShowLeads(bool on);
    void setShowSections(bool on);

    void setShowSurface(bool on);
    void setShowLines(bool on);
    bool getShowSurface() const { return showSurface; }
    bool getShowLines() const { return showLines; }

    void viewAll();
    void viewPlan();
    void viewProfile();

private slots:
    /** The context is about to die: everything GL must be destroyed
     *  HERE, while it is still alive to destroy them against. */
    void onContextAboutToBeDestroyed();

protected:
    virtual void initializeGL();
    virtual void paintGL();
    virtual void resizeGL(int w, int h);
    virtual void mousePressEvent(QMouseEvent* e);
    virtual void mouseMoveEvent(QMouseEvent* e);
    virtual void wheelEvent(QWheelEvent* e);
    virtual void keyPressEvent(QKeyEvent* e);

private:
    QMatrix4x4 cameraMatrix() const;
    void drawFlatLines(const QMatrix4x4& mvp,
                       const QVector<float>& positions,
                       const QVector<float>& colors, bool visible);
    void layOutLegend();
    void uploadScanTextures();
    void forgetScanTextures();
    void dropScanTextures();
    void drawScans(const QMatrix4x4& mvp);

    /** The camera's own axes at the current yaw and pitch. One source
     *  for framing and for panning: they were derived separately once,
     *  and the pan copy used world Z as its up, which is only right
     *  while the camera is level. */
    void cameraBasis(QVector3D& forward, QVector3D& right,
                     QVector3D& up) const;

    QOpenGLShaderProgram* surfaceProgram;
    QOpenGLShaderProgram* lineProgram;
    QOpenGLShaderProgram* scanProgram;

    // Interleaved-free, one array per attribute: this is what the
    // script side already produces, and repacking it here would cost a
    // copy of the whole cave for no gain.
    QVector<float> trianglePositions;
    QVector<float> triangleNormals;
    QVector<float> triangleColors;
    QVector<float> linePositions;
    QVector<float> lineColors;
    QVector<float> ghostPositions;
    QVector<float> ghostColors;
    QVector<float> leadPositions;
    QVector<float> leadColors;
    QVector<float> sectionPositions;
    QVector<float> sectionColors;

    QVector<float> scanPositions;
    QVector<float> scanUvs;
    QVector<int> scanIndices;
    QStringList scanPaths;
    QVector<int> scanRuns;
    QList<RCave3dTexture*> scanTextures;
    bool showScans;
    double scanInk;
    QVector<float> flyPoints;
    QVector<int> flyBreaks;
    CameraMode cameraMode;
    double cameraProgress;
    /** Where the caver has dragged the view while the camera is flying:
     *  an offset on top of the path's own direction, so they can look
     *  around without stopping. */
    float flyYaw;
    float flyPitch;
    /** The yaw the spin started from, so it turns from where the caver
     *  left the camera rather than snapping to north. */
    float spinFromYaw;
    /** Set when paths change, cleared once uploaded against a live
     *  context -- which is also how a context remade by a dock float
     *  gets its textures back. */
    bool scansNeedUpload;

    QVector3D boundsMin;
    QVector3D boundsMax;

    // Spherical camera about a target point.
    float yaw;
    float pitch;
    float distance;
    QVector3D target;

    bool showSurface;
    bool showLines;
    bool showGhost;
    bool showLeads;
    bool showSections;

    int progressTriangles;
    int progressLines;

    RCave3dLegend* legend;
    RCave3dLabels* labels;

    /** True while the camera is still where a framing command put it.
     *  A docked panel is resized constantly, and a view that fitted
     *  itself once at whatever size the dock happened to have on
     *  creation stays wrong for every size after. So while this holds,
     *  a resize re-fits; once the caver orbits or zooms it is their
     *  camera and a resize leaves it alone. */
    bool cameraUntouched;

    QPoint lastMousePos;
};

#endif
