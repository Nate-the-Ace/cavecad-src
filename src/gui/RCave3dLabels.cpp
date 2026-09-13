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
#include "RCave3dLabels.h"

#include <QFont>
#include <QFontMetrics>
#include <QPainter>
#include <QPainterPath>
#include <QVector4D>

namespace {

/** How near two labels may sit before the farther one is dropped.
 *  Screen pixels, and generous: a cave's stations are a few feet apart
 *  and seen down the passage they project almost on top of each other,
 *  so a thicket of overlapping names is the normal case rather than
 *  the exception. */
const int MIN_GAP_PX = 26;

/** Labels drawn at most, however many stations there are. A cave of
 *  two thousand stations seen from outside would otherwise spend the
 *  whole frame laying out text nobody can read. The nearest are kept,
 *  which are the ones a caver is looking at. */
const int MAX_LABELS = 220;

/** How far off the edge a label may sit before it is not worth
 *  drawing. */
const int MARGIN_PX = 48;

struct Placed {
    QPointF at;
    QString text;
    float depth;
};

} // namespace

RCave3dLabels::RCave3dLabels(QWidget* parent)
    : QWidget(parent), show(false) {
    // TRANSPARENT AND DEAF. It sits over the GL view, so it must paint
    // nothing where it has nothing to say and must never take a click
    // meant for the camera.
    setAttribute(Qt::WA_TransparentForMouseEvents, true);
    setAttribute(Qt::WA_NoSystemBackground, true);
    setAttribute(Qt::WA_TranslucentBackground, true);
    setFocusPolicy(Qt::NoFocus);
}

void RCave3dLabels::setStations(const QVector<QVector3D>& p,
                                const QStringList& n) {
    positions = p;
    names = n;
    update();
}

void RCave3dLabels::setCamera(const QMatrix4x4& m) {
    mvp = m;
    if (show) {
        update();
    }
}

void RCave3dLabels::setAvoid(const QRect& box) {
    if (avoid == box) {
        return;
    }
    avoid = box;
    if (show) {
        update();
    }
}

void RCave3dLabels::setShow(bool on) {
    show = on;
    setVisible(on);
    update();
}

void RCave3dLabels::paintEvent(QPaintEvent* event) {
    Q_UNUSED(event)
    if (!show || positions.isEmpty()) {
        return;
    }

    QPainter painter(this);
    painter.setRenderHint(QPainter::Antialiasing, true);
    painter.setRenderHint(QPainter::TextAntialiasing, true);

    QFont f = font();
    f.setPointSizeF(f.pointSizeF() > 0 ? f.pointSizeF() : 11.0);
    f.setBold(true);
    painter.setFont(f);
    QFontMetrics fm(f);

    const int w = width();
    const int h = height();

    // Project every station, dropping what cannot be seen.
    QVector<Placed> wanted;
    wanted.reserve(positions.size());
    for (int i = 0; i < positions.size() && i < names.size(); i++) {
        QVector4D clip = mvp * QVector4D(positions.at(i), 1.0f);
        if (clip.w() <= 0.0f) {
            continue;               // behind the eye
        }
        float ndcX = clip.x() / clip.w();
        float ndcY = clip.y() / clip.w();
        float sx = (ndcX * 0.5f + 0.5f) * float(w);
        float sy = (1.0f - (ndcY * 0.5f + 0.5f)) * float(h);
        if (sx < -MARGIN_PX || sx > w + MARGIN_PX ||
                sy < -MARGIN_PX || sy > h + MARGIN_PX) {
            continue;               // off screen
        }
        Placed p;
        p.at = QPointF(sx, sy);
        p.text = names.at(i);
        p.depth = clip.w();
        wanted.append(p);
    }

    // NEAREST FIRST, so that when names collide the one kept is the one
    // in the passage the caver is looking down rather than whichever
    // happened to be surveyed first.
    std::sort(wanted.begin(), wanted.end(),
              [](const Placed& a, const Placed& b) {
                  return a.depth < b.depth;
              });

    QVector<QPointF> taken;
    taken.reserve(MAX_LABELS);

    const QColor ink(255, 255, 255);
    const QColor halo(0, 0, 0, 200);
    const QColor dot(255, 190, 60);

    for (int i = 0; i < wanted.size(); i++) {
        if (taken.size() >= MAX_LABELS) {
            break;
        }
        const QPointF& at = wanted.at(i).at;
        bool clash = false;
        for (int t = 0; t < taken.size(); t++) {
            if (qAbs(taken.at(t).x() - at.x()) < MIN_GAP_PX &&
                    qAbs(taken.at(t).y() - at.y()) < MIN_GAP_PX) {
                clash = true;
                break;
            }
        }
        if (clash) {
            continue;
        }

        // OUT OF THE LEGEND'S WAY. The legend is drawn over this, so a
        // name underneath it comes out sliced in half by its edge --
        // which reads as a rendering fault rather than as a label that
        // happens to be behind something.
        if (!avoid.isNull()) {
            QRect box = fm.boundingRect(wanted.at(i).text);
            box.moveTo(int(at.x() + 6.0), int(at.y() - 5.0) - box.height());
            box.adjust(-3, -3, 3, 3);
            if (avoid.intersects(box)) {
                continue;
            }
        }

        taken.append(at);

        // A mark on the station itself, then the name beside it: the
        // name alone leaves a caver guessing which of two nearby bends
        // it belongs to.
        painter.setPen(Qt::NoPen);
        painter.setBrush(dot);
        painter.drawEllipse(at, 2.6, 2.6);

        const QString& text = wanted.at(i).text;
        QPointF textAt(at.x() + 6.0, at.y() - 5.0);

        // OUTLINED, not boxed. A survey sketch drawn underneath is
        // mostly pale paper and the passage behind is mostly dark, so
        // neither a light nor a dark label reads on its own -- and a
        // filled box behind every name would hide the cave it is
        // labelling.
        QPainterPath path;
        path.addText(textAt, f, text);
        painter.setBrush(Qt::NoBrush);
        QPen halopen(halo);
        halopen.setWidthF(3.0);
        halopen.setJoinStyle(Qt::RoundJoin);
        painter.setPen(halopen);
        painter.drawPath(path);
        painter.setPen(Qt::NoPen);
        painter.setBrush(ink);
        painter.drawPath(path);
    }
}
