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
#include "RCave3dCard.h"

#include <QFontMetrics>
#include <QMouseEvent>
#include <QPainter>
#include <QPainterPath>

namespace {
const int PAD = 10;
const int LINE_H = 17;
const int GAP = 14;          // between a label and its value
const int RADIUS = 6;
}

RCave3dCard::RCave3dCard(QWidget* parent) : QWidget(parent) {
    // UNLIKE THE LEGEND, this one takes its clicks: a click anywhere on
    // it dismisses it, which is why the corner carries a cross. It is
    // small and it is only up when the caver asked for it, so the
    // camera loses very little ground to it.
    setAttribute(Qt::WA_NoSystemBackground, true);
    setAttribute(Qt::WA_TranslucentBackground, true);
    setFocusPolicy(Qt::NoFocus);
    setVisible(false);
}

RCave3dCard::~RCave3dCard() {
}

void RCave3dCard::setContent(const QString& s, const QString& t,
                             const QStringList& l, const QStringList& v) {
    station = s;
    title = t;
    labels = l;
    values = v;
    updateGeometry();
    update();
}

QSize RCave3dCard::sizeHint() const {
    if (title.isEmpty() && labels.isEmpty()) {
        return QSize(0, 0);
    }
    QFont bold = font();
    bold.setBold(true);
    QFontMetrics fmTitle(bold);
    QFontMetrics fm(font());

    int widest = fmTitle.horizontalAdvance(title) + GAP;
    for (int i = 0; i < labels.size() && i < values.size(); i++) {
        widest = qMax(widest, fm.horizontalAdvance(labels.at(i)) + GAP +
                              fm.horizontalAdvance(values.at(i)));
    }
    int rows = labels.size() + 1;
    return QSize(PAD * 2 + widest, PAD * 2 + rows * LINE_H + 2);
}

void RCave3dCard::paintEvent(QPaintEvent*) {
    if (title.isEmpty() && labels.isEmpty()) {
        return;
    }
    QPainter painter(this);
    painter.setRenderHint(QPainter::Antialiasing, true);
    painter.setRenderHint(QPainter::TextAntialiasing, true);

    // A DARK PANEL, whatever is behind it. The cave is dark, a draped
    // sketch is pale paper and an aerial photograph is anything at
    // all, so a card that took its contrast from the scene would be
    // unreadable over one of the three.
    QPainterPath box;
    box.addRoundedRect(QRectF(0.5, 0.5, width() - 1.0, height() - 1.0),
                       RADIUS, RADIUS);
    painter.fillPath(box, QColor(18, 20, 24, 232));
    painter.setPen(QPen(QColor(150, 158, 170, 200), 1.0));
    painter.drawPath(box);

    QFont bold = font();
    bold.setBold(true);
    QFontMetrics fm(font());

    int y = PAD + LINE_H - fm.descent();
    painter.setFont(bold);
    painter.setPen(QColor(245, 246, 248));
    painter.drawText(PAD, y, title);

    // The cross that says a click closes this.
    QRectF cross(width() - PAD - 9, PAD - 1, 9, 9);
    painter.setPen(QPen(QColor(170, 176, 186), 1.4));
    painter.drawLine(cross.topLeft(), cross.bottomRight());
    painter.drawLine(cross.topRight(), cross.bottomLeft());

    painter.setFont(font());
    for (int i = 0; i < labels.size() && i < values.size(); i++) {
        y += LINE_H;
        // A ROW WITH NO LABEL IS A REMARK, not a measurement -- the
        // script sends one when a station sits above the modelled
        // ground -- so it spans the width instead of being lined up in
        // a column of values.
        if (labels.at(i).isEmpty()) {
            painter.setPen(QColor(226, 172, 120));
            painter.drawText(PAD, y, values.at(i));
            continue;
        }
        painter.setPen(QColor(158, 165, 176));
        painter.drawText(PAD, y, labels.at(i));
        painter.setPen(QColor(236, 238, 242));
        painter.drawText(width() - PAD - fm.horizontalAdvance(values.at(i)),
                         y, values.at(i));
    }
}

void RCave3dCard::mousePressEvent(QMouseEvent* e) {
    Q_UNUSED(e)
    emit dismissed();
}
