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
#include <QMatrix4x4>
#include <QString>
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
    void setBounds(const QVector3D& min, const QVector3D& max);
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

    void setShowSurface(bool on);
    void setShowLines(bool on);
    bool getShowSurface() const { return showSurface; }
    bool getShowLines() const { return showLines; }

    void viewAll();
    void viewPlan();
    void viewProfile();

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
    void paintLegend();

    /** The camera's own axes at the current yaw and pitch. One source
     *  for framing and for panning: they were derived separately once,
     *  and the pan copy used world Z as its up, which is only right
     *  while the camera is level. */
    void cameraBasis(QVector3D& forward, QVector3D& right,
                     QVector3D& up) const;

    QOpenGLShaderProgram* surfaceProgram;
    QOpenGLShaderProgram* lineProgram;

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

    int progressTriangles;
    int progressLines;

    QString legendTitle;
    QString legendNote;
    QString legendKind;
    QVector<LegendStop> legendStops;

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
