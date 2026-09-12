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
#include "RCave3dLegend.h"

#include <QFontMetrics>
#include <QLinearGradient>
#include <QPaintEvent>
#include <QPainter>

namespace {
const int PAD = 8;
const int SWATCH = 12;
const int LINE_H = 16;
const int GAP = 6;
}

RCave3dLegend::RCave3dLegend(QWidget* parent) : QWidget(parent) {
    // Mouse events belong to the view behind it: this is a label, not a
    // control, and swallowing a drag that started on it would make the
    // camera stick for no reason the caver can see.
    setAttribute(Qt::WA_TransparentForMouseEvents, true);
    setAttribute(Qt::WA_NoSystemBackground, true);
}

RCave3dLegend::~RCave3dLegend() {
}

void RCave3dLegend::setLegend(const QString& t, const QString& n,
                              const QString& k,
                              const QVector<RCave3dView::LegendStop>& s) {
    title = t;
    note = n;
    kind = k;
    stops = s;
    updateGeometry();
    update();
}

QSize RCave3dLegend::sizeHint() const {
    if (stops.isEmpty()) {
        return QSize(0, 0);
    }
    QFontMetrics fm(font());
    int widest = fm.horizontalAdvance(title);
    for (int i = 0; i < stops.size(); i++) {
        widest = qMax(widest, fm.horizontalAdvance(stops.at(i).label));
    }
    if (!note.isEmpty()) {
        widest = qMax(widest, fm.horizontalAdvance(note));
    }

    // One row for the title, one per stop, one for the note when there
    // is one, plus a little air at the bottom for the last baseline.
    int rows = stops.size() + 1;
    if (!note.isEmpty()) {
        rows += 1;
    }
    return QSize(PAD * 2 + SWATCH + GAP + widest,
                 PAD * 2 + rows * LINE_H + 4);
}

void RCave3dLegend::paintEvent(QPaintEvent*) {
    if (stops.isEmpty()) {
        return;
    }

    QPainter painter(this);
    painter.setRenderHint(QPainter::Antialiasing, true);

    // A panel behind the text, because the cave passes under the legend
    // and pale passage against pale text is unreadable exactly when the
    // legend is most wanted.
    painter.fillRect(rect(), QColor(18, 18, 22, 200));

    // Light on a fixed dark ground, so no light/dark theme handling.
    const QColor ink(232, 232, 232);
    const QColor edge(90, 90, 90);
    const QColor quiet(176, 176, 176);

    QFontMetrics fm(painter.font());

    QFont bold = painter.font();
    bold.setBold(true);
    painter.setFont(bold);
    painter.setPen(ink);
    painter.drawText(PAD, PAD + fm.ascent(), title);
    painter.setFont(font());

    // The title owns its own row. The bar starts BELOW it, rather than
    // at the row's baseline, or the topmost label rides up into the
    // title and the two overlap.
    int top = PAD + LINE_H;
    int y = top;

    if (kind == QString("ramp") && stops.size() >= 2) {
        // The stops arrive low to high, so the bar is drawn with the
        // LAST one at the top: a scale with its largest number at the
        // bottom reads backwards.
        int barH = LINE_H * stops.size();
        QRect bar(PAD, top, SWATCH, barH);

        QLinearGradient g(bar.topLeft(), bar.bottomLeft());
        for (int i = 0; i < stops.size(); i++) {
            qreal at = 1.0 - qreal(i) / qreal(stops.size() - 1);
            g.setColorAt(at, stops.at(i).color);
        }
        painter.fillRect(bar, QBrush(g));
        painter.setPen(edge);
        painter.drawRect(bar);

        painter.setPen(ink);
        for (int i = 0; i < stops.size(); i++) {
            int ly = bar.bottom() - (barH * i) / (stops.size() - 1);
            // Clamped inside the widget so the end labels are not
            // clipped by half a line at the top and bottom.
            int baseline = qBound(top + fm.ascent(),
                                  ly + fm.ascent() / 2,
                                  top + barH);
            painter.drawText(PAD + SWATCH + GAP, baseline,
                             stops.at(i).label);
        }
        y = top + barH + fm.ascent();
    } else {
        for (int i = 0; i < stops.size(); i++) {
            QRect box(PAD, y, SWATCH, SWATCH);
            painter.fillRect(box, stops.at(i).color);
            painter.setPen(edge);
            painter.drawRect(box);
            painter.setPen(ink);
            painter.drawText(PAD + SWATCH + GAP, y + fm.ascent() - 2,
                             stops.at(i).label);
            y += LINE_H;
        }
        y += fm.ascent() - LINE_H;
    }

    if (!note.isEmpty()) {
        painter.setPen(quiet);
        painter.drawText(PAD, y, note);
    }
}
