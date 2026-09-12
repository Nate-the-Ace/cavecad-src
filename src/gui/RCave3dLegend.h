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
#ifndef RCAVE3DLEGEND_H
#define RCAVE3DLEGEND_H

#include "gui_global.h"
#include "RCave3dView.h"

#include <QWidget>

/**
 * \brief What the colours in the 3D view mean, floating over it.
 *
 * A CHILD WIDGET rather than a QPainter pass inside paintGL. The
 * painter route is what Qt documents for drawing over a QOpenGLWidget,
 * and here it drew nothing at all -- no warning, no error, the painter
 * reporting success -- in either order of the native-painting block. A
 * child widget is ordinary Qt painting that no GL state can defeat, and
 * to the reader it is the same thing: a legend over the cave, taking no
 * layout space from the view.
 *
 * It knows nothing about caves either. It is handed a title, a note and
 * a list of (colour, label) stops, all computed on the script side.
 *
 * \ingroup gui
 * \scriptable
 */
class QCADGUI_EXPORT RCave3dLegend : public QWidget {
    Q_OBJECT

public:
    RCave3dLegend(QWidget* parent = NULL);
    virtual ~RCave3dLegend();

    void setLegend(const QString& title, const QString& note,
                   const QString& kind,
                   const QVector<RCave3dView::LegendStop>& stops);

    virtual QSize sizeHint() const;

protected:
    virtual void paintEvent(QPaintEvent* event);

private:
    QString title;
    QString note;
    QString kind;
    QVector<RCave3dView::LegendStop> stops;
};

#endif
