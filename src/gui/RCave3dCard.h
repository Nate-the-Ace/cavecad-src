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
#ifndef RCAVE3DCARD_H
#define RCAVE3DCARD_H

#include "gui_global.h"

#include <QStringList>
#include <QWidget>

/**
 * \brief What one station has to say, floating beside it in the 3D
 * view.
 *
 * A CHILD WIDGET for the same reason RCave3dLegend is one: a QPainter
 * pass inside paintGL draws nothing at all on this build's
 * QOpenGLWidget -- no warning, no error, the painter reporting
 * success.
 *
 * IT KNOWS NOTHING ABOUT CAVES. It is handed a title and a list of
 * label/value pairs, already in the drawing's units, with trips named
 * and dates formatted, exactly as the legend is handed its stops.
 * A renderer that formatted a foot would be a second place in this
 * program that knows what a foot is.
 *
 * PINNED TO A STATION, NOT TO A PIXEL. The view re-places it against
 * the station's projected position on every paint, so it stays beside
 * the thing it describes as the camera moves. A card left where the
 * mouse was becomes a label for empty air on the first orbit.
 *
 * \ingroup gui
 * \scriptable
 */
class QCADGUI_EXPORT RCave3dCard : public QWidget {
    Q_OBJECT

public:
    RCave3dCard(QWidget* parent = NULL);
    virtual ~RCave3dCard();

    /** The station this card is about, in the survey's own naming.
     *  The view uses it to find the point to pin the card beside. */
    QString getStation() const { return station; }

    void setContent(const QString& station, const QString& title,
                    const QStringList& labels, const QStringList& values);

    virtual QSize sizeHint() const;

signals:
    /** The caver dismissed the card by clicking it. */
    void dismissed();

protected:
    virtual void paintEvent(QPaintEvent* event);
    virtual void mousePressEvent(QMouseEvent* event);

private:
    QString station;
    QString title;
    QStringList labels;
    QStringList values;
};

#endif
