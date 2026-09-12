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
#include <QMatrix4x4>
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

    void setTriangles(const QVector<float>& positions,
                      const QVector<float>& normals,
                      const QVector<float>& colors);
    void setLines(const QVector<float>& positions,
                  const QVector<float>& colors);
    void setBounds(const QVector3D& min, const QVector3D& max);
    void clearGeometry();

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

    QVector3D boundsMin;
    QVector3D boundsMax;

    // Spherical camera about a target point.
    float yaw;
    float pitch;
    float distance;
    QVector3D target;

    bool showSurface;
    bool showLines;

    QPoint lastMousePos;
};

#endif
