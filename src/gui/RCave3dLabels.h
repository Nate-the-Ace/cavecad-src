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
#ifndef RCAVE3DLABELS_H
#define RCAVE3DLABELS_H

#include "gui_global.h"

#include <QMatrix4x4>
#include <QRect>
#include <QString>
#include <QVector>
#include <QVector3D>
#include <QWidget>

/**
 * \brief Station names written over the passage, so a caver can tell
 * where in the cave they are looking.
 *
 * A CHILD WIDGET, for the same reason RCave3dLegend is one: a QPainter
 * pass inside paintGL draws nothing at all in this build. Here the
 * choice buys something else as well -- text drawn by QPainter is the
 * platform's own font rendering at the screen's own resolution, where
 * a glyph atlas pasted onto billboard quads in GL would be a second
 * font engine to write and would go soft at every zoom.
 *
 * It knows nothing about caves. It is handed points in world space
 * with names attached, and the camera matrix to put them on screen.
 *
 * \ingroup gui
 */
class QCADGUI_EXPORT RCave3dLabels : public QWidget {
    Q_OBJECT

public:
    RCave3dLabels(QWidget* parent = NULL);

    /** The stations to write, in world coordinates. */
    void setStations(const QVector<QVector3D>& positions,
                     const QStringList& names);

    /** The camera, so the points can be put on screen. Called from the
     *  view's paint, which is the one place that knows the camera has
     *  moved. */
    void setCamera(const QMatrix4x4& mvp);

    /** A rectangle the names must keep out of: the legend sits there,
     *  and a name half behind it is worse than no name. */
    void setAvoid(const QRect& box);

    void setShow(bool on);
    bool isShowing() const { return show; }

    /** True when there is anything to label at all, so a panel can grey
     *  its toggle rather than offering a switch that does nothing. */
    bool hasStations() const { return !positions.isEmpty(); }

    /**
     * The station whose NAME was drawn under this point, or an empty
     * string.
     *
     * A name is drawn beside its station, not on it -- six pixels
     * right and five up -- so a caver aiming at the text they can read
     * lands outside any sensible radius around the station's own dot,
     * and longer names run further still. The rectangles are recorded
     * as they are painted, which is also the only place that knows
     * which names survived culling.
     *
     * Nearest the camera first, because that is the order they were
     * painted in and it is the one a caver means when two overlap.
     */
    QString stationAtPoint(const QPoint& pos) const;

protected:
    virtual void paintEvent(QPaintEvent* event);

private:
    struct DrawnLabel {
        QRect box;
        QString name;
    };
    /** Where each name was last painted. Filled BY the paint, so it is
     *  written from a const method and therefore mutable: it is a
     *  record of what happened, not part of what the widget is. */
    mutable QVector<DrawnLabel> drawn;

    QVector<QVector3D> positions;
    QStringList names;
    QMatrix4x4 mvp;
    QRect avoid;
    bool show;
};

#endif
