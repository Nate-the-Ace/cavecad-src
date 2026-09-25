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
#ifndef RCAVE3DVIEWCUBE_H
#define RCAVE3DVIEWCUBE_H

#include "gui_global.h"

#include <QRect>
#include <QString>
#include <QTransform>
#include <QVector3D>
#include <QWidget>

class RCave3dView;
class QAction;
class QMenu;
class QToolButton;

/**
 * \brief A ViewCube in the corner of the 3D view, in the style of Fusion.
 *
 * A labelled cube that turns with the camera. Click a face, edge or
 * corner to look from that side; drag it to orbit; the house opens a
 * menu (Go Home, Orthographic / Perspective, Set current view as Home,
 * Reset Home). Looking straight at a face, arrows turn 90 degrees to
 * the neighbouring face or roll the view. Faces are named by compass
 * direction, since a cave has no front.
 *
 * A port of cavway-assistant-web's src/viewcube.js, drawn with
 * QPainter: the cube is projected orthographically through the view's
 * own camera basis, each face an affine transform of a flat square.
 *
 * A CHILD WIDGET, like the legend and the card: painting inside
 * paintGL draws nothing on this build.
 *
 * \ingroup gui
 */
class QCADGUI_EXPORT RCave3dViewCube : public QWidget {
    Q_OBJECT

public:
    RCave3dViewCube(RCave3dView* view);
    virtual ~RCave3dViewCube();

    virtual QSize sizeHint() const;

protected:
    virtual void paintEvent(QPaintEvent* event);
    virtual void mousePressEvent(QMouseEvent* e);
    virtual void mouseMoveEvent(QMouseEvent* e);
    virtual void mouseReleaseEvent(QMouseEvent* e);
    virtual void leaveEvent(QEvent* e);

private slots:
    void onMenuAboutToShow();

private:
    struct Face {
        QString name;
        QVector3D n;   // outward normal
        QVector3D u;   // label's right, seen from outside
        QVector3D v;   // label's down, seen from outside
    };

    /** Face-local pixels (origin at the face centre, x along u, y
     *  along v) to widget pixels. */
    QTransform faceTransform(const Face& f, const QVector3D& right,
                             const QVector3D& up) const;

    /** The face cell under a point: which face, and the 3x3 cell --
     *  centre is the face, sides are edges, corners are corners. */
    bool cellAt(const QPoint& p, int& face, int& row, int& col) const;

    /** "up", "down", "left", "right", "cw", "ccw", or empty. Only
     *  while the view is face-aligned, which is when they show. */
    QString arrowAt(const QPoint& p) const;
    QRect arrowRect(const QString& kind) const;

    RCave3dView* view;
    QList<Face> faces;
    QToolButton* homeButton;
    QMenu* menu;
    QAction* orthographicAction;
    QAction* perspectiveAction;

    QPoint lastPos;
    QPoint pressPos;
    bool pressOnCube;
    bool dragging;
    QString pressArrow;

    int hoverFace;
    int hoverRow;
    int hoverCol;
    QString hoverArrow;
};

#endif
