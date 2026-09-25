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
#include "RCave3dViewCube.h"
#include "RCave3dView.h"

#include <QAction>
#include <QActionGroup>
#include <QMenu>
#include <QMouseEvent>
#include <QPainter>
#include <QPainterPath>
#include <QPixmap>
#include <QToolButton>
#include <QtMath>

namespace {

/** Cube edge, px. */
const float S = 64.0f;
/** The widget, px. The cube's corners reach S*sqrt(3)/2 = 55 from the
 *  centre, so 120 holds it at any angle. */
const int SIZE = 120;
/** Where a face's 3x3 grid divides: 20% / 60% / 20% of the edge. */
const float CELL = S * 0.5f - S * 0.2f;
/** How far the mouse may travel and still be a click on the cube. */
const int DRAG_SLOP_PX = 3;

/** The house, for the Home button, in the button's own text colour. */
QIcon houseIcon(const QColor& ink, qreal dpr) {
    QPixmap pm(QSize(16, 16) * dpr);
    pm.setDevicePixelRatio(dpr);
    pm.fill(Qt::transparent);
    QPainter p(&pm);
    p.setRenderHint(QPainter::Antialiasing);
    QPen pen(ink, 1.4);
    pen.setJoinStyle(Qt::RoundJoin);
    p.setPen(pen);
    QPainterPath path;
    path.moveTo(2, 8);
    path.lineTo(8, 2.5);
    path.lineTo(14, 8);
    path.moveTo(4, 7);
    path.lineTo(4, 13.5);
    path.lineTo(7, 13.5);
    path.lineTo(7, 9.5);
    path.lineTo(9, 9.5);
    path.lineTo(9, 13.5);
    path.lineTo(12, 13.5);
    path.lineTo(12, 7);
    p.drawPath(path);
    return QIcon(pm);
}

} // namespace

RCave3dViewCube::RCave3dViewCube(RCave3dView* view)
    : QWidget(view),
      view(view),
      pressOnCube(false),
      dragging(false),
      hoverFace(-1),
      hoverRow(0),
      hoverCol(0) {

    // Face: outward normal n, and the world directions of the label's
    // right (u) and down (v) as seen from outside. Survey frame: x east,
    // y north, z up.
    Face top = { "TOP", QVector3D(0, 0, 1), QVector3D(1, 0, 0), QVector3D(0, -1, 0) };
    Face bottom = { "BOTTOM", QVector3D(0, 0, -1), QVector3D(-1, 0, 0), QVector3D(0, -1, 0) };
    Face north = { "N", QVector3D(0, 1, 0), QVector3D(-1, 0, 0), QVector3D(0, 0, -1) };
    Face south = { "S", QVector3D(0, -1, 0), QVector3D(1, 0, 0), QVector3D(0, 0, -1) };
    Face east = { "E", QVector3D(1, 0, 0), QVector3D(0, 1, 0), QVector3D(0, 0, -1) };
    Face west = { "W", QVector3D(-1, 0, 0), QVector3D(0, -1, 0), QVector3D(0, 0, -1) };
    faces << top << bottom << north << south << east << west;

    setMouseTracking(true);
    setAttribute(Qt::WA_TranslucentBackground);
    resize(sizeHint());

    menu = new QMenu(this);
    QAction* home = menu->addAction(tr("Go Home"));
    connect(home, &QAction::triggered, [this]() { this->view->viewHome(); });
    menu->addSeparator();
    QActionGroup* projection = new QActionGroup(this);
    projection->setExclusive(true);
    orthographicAction = menu->addAction(tr("Orthographic"));
    orthographicAction->setCheckable(true);
    projection->addAction(orthographicAction);
    connect(orthographicAction, &QAction::triggered,
            [this]() { this->view->setOrthographic(true); });
    perspectiveAction = menu->addAction(tr("Perspective"));
    perspectiveAction->setCheckable(true);
    projection->addAction(perspectiveAction);
    connect(perspectiveAction, &QAction::triggered,
            [this]() { this->view->setOrthographic(false); });
    menu->addSeparator();
    QAction* setHome = menu->addAction(tr("Set current view as Home"));
    connect(setHome, &QAction::triggered,
            [this]() { this->view->setHomeView(false); });
    QAction* resetHome = menu->addAction(tr("Reset Home"));
    connect(resetHome, &QAction::triggered, [this]() {
        this->view->setHomeView(true);
        this->view->viewHome();
    });
    connect(menu, SIGNAL(aboutToShow()), this, SLOT(onMenuAboutToShow()));

    homeButton = new QToolButton(this);
    homeButton->setObjectName("Cave3dViewCubeHome");
    homeButton->setToolTip(tr("View options"));
    homeButton->setAutoRaise(true);
    homeButton->setIcon(houseIcon(palette().color(QPalette::WindowText),
                                  devicePixelRatioF()));
    homeButton->setIconSize(QSize(14, 14));
    // InstantPopup: the button IS the menu (see the panel's View button).
    homeButton->setPopupMode(QToolButton::InstantPopup);
    homeButton->setMenu(menu);
    homeButton->move(0, 0);
    homeButton->resize(homeButton->sizeHint());
}

RCave3dViewCube::~RCave3dViewCube() {
}

QSize RCave3dViewCube::sizeHint() const {
    return QSize(SIZE, SIZE);
}

void RCave3dViewCube::onMenuAboutToShow() {
    orthographicAction->setChecked(view->isOrthographic());
    perspectiveAction->setChecked(!view->isOrthographic());
}

QTransform RCave3dViewCube::faceTransform(const Face& f,
                                          const QVector3D& right,
                                          const QVector3D& up) const {
    // World to widget: x = right.w, y (down) = -up.w -- orthographic,
    // so each face is an affine image of a flat square.
    QVector3D centre = f.n * (S * 0.5f);
    float cx = width() * 0.5f + QVector3D::dotProduct(centre, right);
    float cy = height() * 0.5f - QVector3D::dotProduct(centre, up);
    return QTransform(QVector3D::dotProduct(f.u, right),
                      -QVector3D::dotProduct(f.u, up),
                      QVector3D::dotProduct(f.v, right),
                      -QVector3D::dotProduct(f.v, up),
                      cx, cy);
}

bool RCave3dViewCube::cellAt(const QPoint& p, int& face, int& row,
                             int& col) const {
    QVector3D forward, right, up;
    view->cameraBasis(forward, right, up);
    for (int i = 0; i < faces.size(); i++) {
        const Face& f = faces.at(i);
        if (QVector3D::dotProduct(f.n, forward) > -0.02f) {
            continue;                        // facing away, or edge on
        }
        bool ok = false;
        QTransform inv = faceTransform(f, right, up).inverted(&ok);
        if (!ok) {
            continue;
        }
        QPointF local = inv.map(QPointF(p));
        float h = S * 0.5f;
        if (qAbs(local.x()) > h || qAbs(local.y()) > h) {
            continue;
        }
        face = i;
        col = (local.x() < -CELL) ? -1 : (local.x() > CELL ? 1 : 0);
        row = (local.y() < -CELL) ? -1 : (local.y() > CELL ? 1 : 0);
        return true;
    }
    return false;
}

QRect RCave3dViewCube::arrowRect(const QString& kind) const {
    // Placed as in the web app's CSS, around a 120 px square.
    if (kind == "up") { return QRect(55, 8, 10, 10); }
    if (kind == "down") { return QRect(55, SIZE - 18, 10, 10); }
    if (kind == "left") { return QRect(8, 55, 10, 10); }
    if (kind == "right") { return QRect(SIZE - 18, 55, 10, 10); }
    if (kind == "ccw") { return QRect(SIZE - 44, 14, 14, 14); }
    if (kind == "cw") { return QRect(SIZE - 26, 14, 14, 14); }
    return QRect();
}

QString RCave3dViewCube::arrowAt(const QPoint& p) const {
    if (!view->isFaceAligned()) {
        return QString();
    }
    static const char* kinds[] = { "up", "down", "left", "right", "ccw", "cw" };
    for (int i = 0; i < 6; i++) {
        // A few pixels of slack: the targets are small.
        if (arrowRect(kinds[i]).adjusted(-3, -3, 3, 3).contains(p)) {
            return kinds[i];
        }
    }
    return QString();
}

void RCave3dViewCube::paintEvent(QPaintEvent* event) {
    Q_UNUSED(event)
    QPainter p(this);
    p.setRenderHint(QPainter::Antialiasing);

    QColor panel = palette().color(QPalette::Window);
    panel.setAlphaF(0.88);
    QColor ink = palette().color(QPalette::WindowText);
    QColor edge = palette().color(QPalette::PlaceholderText);
    QColor accent = palette().color(QPalette::Highlight);
    QColor lit = accent;
    lit.setAlphaF(0.45);

    QVector3D forward, right, up;
    view->cameraBasis(forward, right, up);

    QFont font = p.font();
    font.setPixelSize(11);
    font.setWeight(QFont::DemiBold);
    font.setLetterSpacing(QFont::PercentageSpacing, 104);

    float h = S * 0.5f;
    for (int i = 0; i < faces.size(); i++) {
        const Face& f = faces.at(i);
        // BACK FACES CULLED: the cube is convex, so the faces left never
        // overlap and need no depth sort.
        if (QVector3D::dotProduct(f.n, forward) > -0.02f) {
            continue;
        }
        p.setTransform(faceTransform(f, right, up));
        QRectF square(-h, -h, S, S);
        p.setPen(Qt::NoPen);
        p.setBrush(panel);
        p.drawRect(square);

        if (i == hoverFace) {
            float x0 = (hoverCol < 0) ? -h : (hoverCol == 0 ? -CELL : CELL);
            float x1 = (hoverCol < 0) ? -CELL : (hoverCol == 0 ? CELL : h);
            float y0 = (hoverRow < 0) ? -h : (hoverRow == 0 ? -CELL : CELL);
            float y1 = (hoverRow < 0) ? -CELL : (hoverRow == 0 ? CELL : h);
            p.setBrush(lit);
            p.drawRect(QRectF(QPointF(x0, y0), QPointF(x1, y1)));
        }

        QPen pen(edge, 1.0);
        pen.setCosmetic(true);
        p.setPen(pen);
        p.setBrush(Qt::NoBrush);
        p.drawRect(square);

        p.setFont(font);
        p.setPen(ink);
        p.drawText(square, Qt::AlignCenter, f.name);
    }
    p.resetTransform();

    if (!view->isFaceAligned()) {
        return;
    }

    // THE ARROWS, only while looking straight at a face: that is when
    // "the face above" and "roll 90 degrees" have a meaning.
    static const char* tris[] = { "up", "down", "left", "right" };
    static const float turns[] = { 0.0f, 180.0f, -90.0f, 90.0f };
    for (int i = 0; i < 4; i++) {
        QRect r = arrowRect(tris[i]);
        p.save();
        p.translate(r.center() + QPointF(0.5, 0.5));
        p.rotate(turns[i]);
        QPainterPath tri;
        tri.moveTo(0, -3);
        tri.lineTo(4, 3);
        tri.lineTo(-4, 3);
        tri.closeSubpath();
        p.fillPath(tri, hoverArrow == tris[i] ? accent : edge);
        p.restore();
    }
    static const char* rolls[] = { "ccw", "cw" };
    for (int i = 0; i < 2; i++) {
        QRect r = arrowRect(rolls[i]);
        QColor c = (hoverArrow == rolls[i]) ? accent : edge;
        p.save();
        p.translate(r.center() + QPointF(0.5, 0.5));
        if (i == 1) {
            p.scale(-1.0, 1.0);              // cw is ccw mirrored
        }
        // Three quarters of a turn, anticlockwise, ending upper left
        // with its arrowhead.
        QRectF circle(-5, -5, 10, 10);
        const float START = 200.0f;
        const float SWEEP = 270.0f;
        QPainterPath arc;
        arc.arcMoveTo(circle, START);
        arc.arcTo(circle, START, SWEEP);
        QPen pen(c, 1.5);
        pen.setCapStyle(Qt::RoundCap);
        p.setPen(pen);
        p.setBrush(Qt::NoBrush);
        p.drawPath(arc);
        float end = qDegreesToRadians(START + SWEEP);
        QPointF tip(5.0 * std::cos(end), -5.0 * std::sin(end));
        // Anticlockwise tangent, in widget coordinates (y down).
        QPointF dir(-std::sin(end), -std::cos(end));
        QPointF side(-dir.y(), dir.x());
        QPainterPath head;
        head.moveTo(tip + dir * 3.0);
        head.lineTo(tip - dir * 1.0 + side * 2.6);
        head.lineTo(tip - dir * 1.0 - side * 2.6);
        head.closeSubpath();
        p.fillPath(head, c);
        p.restore();
    }
}

void RCave3dViewCube::mousePressEvent(QMouseEvent* e) {
    pressPos = e->pos();
    lastPos = e->pos();
    dragging = false;
    pressOnCube = false;
    pressArrow = QString();
    if (e->button() != Qt::LeftButton) {
        e->ignore();
        return;
    }
    pressArrow = arrowAt(e->pos());
    if (!pressArrow.isEmpty()) {
        return;
    }
    int face, row, col;
    if (cellAt(e->pos(), face, row, col)) {
        pressOnCube = true;
        return;
    }
    // THE EMPTY CORNERS OF THE SQUARE ARE STILL THE VIEW: hand the
    // press on, so a drag starting beside the cube orbits as usual.
    e->ignore();
}

void RCave3dViewCube::mouseMoveEvent(QMouseEvent* e) {
    if (e->buttons() & Qt::LeftButton) {
        if (!pressOnCube) {
            return;
        }
        QPoint moved = e->pos() - pressPos;
        if (!dragging && qAbs(moved.x()) < DRAG_SLOP_PX &&
                qAbs(moved.y()) < DRAG_SLOP_PX) {
            return;
        }
        // DRAGGING THE CUBE ORBITS, exactly like dragging the cave.
        dragging = true;
        QPoint delta = e->pos() - lastPos;
        lastPos = e->pos();
        hoverFace = -1;
        view->orbit(delta.x(), delta.y());
        return;
    }

    int face = -1, row = 0, col = 0;
    QString arrow = arrowAt(e->pos());
    if (arrow.isEmpty() && !cellAt(e->pos(), face, row, col)) {
        face = -1;
    }
    if (face != hoverFace || row != hoverRow || col != hoverCol ||
            arrow != hoverArrow) {
        hoverFace = face;
        hoverRow = row;
        hoverCol = col;
        hoverArrow = arrow;
        setCursor((face >= 0 || !arrow.isEmpty())
                  ? Qt::PointingHandCursor : Qt::ArrowCursor);
        update();
    }
}

void RCave3dViewCube::mouseReleaseEvent(QMouseEvent* e) {
    if (e->button() != Qt::LeftButton) {
        return;
    }
    if (!pressArrow.isEmpty()) {
        if (arrowAt(e->pos()) == pressArrow) {
            view->stepView(pressArrow);
        }
    } else if (pressOnCube && !dragging) {
        // A CLICK LOOKS FROM THERE: the face, edge or corner's own
        // direction is the sum of the face normal and the cell's steps
        // along the face.
        int face, row, col;
        if (cellAt(pressPos, face, row, col)) {
            const Face& f = faces.at(face);
            view->lookFrom(f.n + f.u * float(col) + f.v * float(row));
        }
    }
    pressOnCube = false;
    dragging = false;
    pressArrow = QString();
}

void RCave3dViewCube::leaveEvent(QEvent* e) {
    if (hoverFace >= 0 || !hoverArrow.isEmpty()) {
        hoverFace = -1;
        hoverArrow = QString();
        update();
    }
    QWidget::leaveEvent(e);
}
