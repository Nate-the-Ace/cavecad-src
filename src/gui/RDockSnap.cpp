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
#include <QApplication>
#include <QDockWidget>
#include <QLayout>
#include <QMainWindow>
#include <QMouseEvent>
#include <QPair>
#include <QScrollArea>
#include <QScrollBar>
#include <QStyle>
#include <QTabBar>

#include "RDockSnap.h"

namespace {

// Smallest width in [lo, hi] at which the height-for-width content of w
// fits into height, or -1 if it does not fit even at hi.
int narrowestFit(const QWidget* w, int lo, int hi, int height) {
    if (w->heightForWidth(hi) > height) {
        return -1;
    }
    while (lo < hi) {
        int mid = (lo + hi) / 2;
        if (w->heightForWidth(mid) <= height) {
            hi = mid;
        } else {
            lo = mid + 1;
        }
    }
    return hi;
}

// Space a scroll area needs along orientation for its contents to show
// without scroll bars, given its current extent in the other direction.
int scrollAreaNeed(const QScrollArea* sa, Qt::Orientation orientation) {
    const QWidget* inner = sa->widget();
    int frame = 2 * sa->frameWidth();
    bool transient = sa->style()->styleHint(QStyle::SH_ScrollBar_Transient, nullptr, sa);
    int sbV = transient ? 0 : sa->verticalScrollBar()->sizeHint().width();
    int sbH = transient ? 0 : sa->horizontalScrollBar()->sizeHint().height();

    QSize minSize = sa->widgetResizable()
        ? inner->minimumSizeHint().expandedTo(inner->minimumSize())
        : inner->size();
    bool hfw = sa->widgetResizable() && inner->hasHeightForWidth();
    int viewW = sa->viewport()->width();
    int viewH = sa->viewport()->height();

    if (orientation == Qt::Horizontal) {
        if (hfw) {
            // reflowing contents: narrowest width that still fits the height
            int w = narrowestFit(inner, minSize.width(), qMax(minSize.width(), viewW), viewH);
            if (w >= 0) {
                return w + frame;
            }
            return minSize.width() + frame + sbV;
        }
        return minSize.width() + frame + (minSize.height() > viewH ? sbV : 0);
    }

    int h = hfw ? inner->heightForWidth(qMax(viewW, minSize.width())) : minSize.height();
    return h + frame + (minSize.width() > viewW ? sbH : 0);
}

bool insideScrollArea(const QWidget* w, const QWidget* top) {
    for (const QWidget* p = w->parentWidget(); p != nullptr && p != top; p = p->parentWidget()) {
        if (qobject_cast<const QScrollArea*>(p) != nullptr) {
            return true;
        }
    }
    return false;
}

// Makes changed minimum sizes reach the main window layout now rather than
// on the next pass of the event loop.
void flushLayouts(const QList<QWidget*>& widgets, QWidget* top) {
    for (QWidget* w : widgets) {
        for (QWidget* p = w; p != nullptr && p != top; p = p->parentWidget()) {
            if (p->layout() != nullptr) {
                p->layout()->invalidate();
            }
            p->updateGeometry();
        }
    }
    for (int i = 0; i < 3; i++) {
        QCoreApplication::sendPostedEvents(nullptr, QEvent::LayoutRequest);
    }
}

}

RDockSnap::RDockSnap(QMainWindow* mainWindow) :
    QObject(mainWindow), mainWindow(mainWindow) {

    qApp->installEventFilter(this);
}

bool RDockSnap::eventFilter(QObject* watched, QEvent* event) {
    if (event->type() != QEvent::MouseButtonDblClick) {
        return false;
    }

    // separators are painted by the main window itself, or on some
    // configurations are small widgets of their own:
    QWidget* w = qobject_cast<QWidget*>(watched);
    if (w == nullptr) {
        return false;
    }
    if (w != mainWindow &&
        !(w->objectName() == "qt_qmainwindow_extended_splitter" && w->window() == mainWindow)) {
        return false;
    }

    QMouseEvent* me = static_cast<QMouseEvent*>(event);
    if (me->button() != Qt::LeftButton) {
        return false;
    }

    Qt::Orientation orientation;
    QPoint pos;
    if (w != mainWindow) {
        // separator widget: a tall thin one divides left from right
        QRect g = w->geometry();
        orientation = g.height() > g.width() ? Qt::Horizontal : Qt::Vertical;
        pos = g.center();
    } else {
        switch (w->cursor().shape()) {
        case Qt::SplitHCursor:
            orientation = Qt::Horizontal;
            break;
        case Qt::SplitVCursor:
            orientation = Qt::Vertical;
            break;
        default:
            // not over a separator:
            return false;
        }
        pos = mainWindow->mapFromGlobal(me->globalPosition().toPoint());
    }
    QDockWidget* dock = dockAtSeparator(pos, orientation);
    if (dock == nullptr) {
        return false;
    }

    snap(dock, orientation);
    return true;
}

/**
 * The docked widget whose edge borders the separator at pos. A separator
 * between two docks belongs to the one before it (left / above), so a
 * trailing edge wins over a leading one. The leading edge is what borders
 * the central widget for the right and bottom dock areas.
 */
QDockWidget* RDockSnap::dockAtSeparator(const QPoint& pos, Qt::Orientation orientation) const {
    int tolerance = mainWindow->style()->pixelMetric(QStyle::PM_DockWidgetSeparatorExtent, nullptr, mainWindow) + 4;

    // tabbed docks can put their tab bar between the separator and the dock
    // (tab position West / East / North / South):
    const QList<QTabBar*> tabBars = mainWindow->findChildren<QTabBar*>(Qt::FindDirectChildrenOnly);
    int tabBarExtent = 0;
    for (const QTabBar* tabBar : tabBars) {
        if (tabBar->isVisible()) {
            tabBarExtent = qMax(tabBarExtent,
                orientation == Qt::Horizontal ? tabBar->width() : tabBar->height());
        }
    }
    tolerance += tabBarExtent;

    QDockWidget* trailing = nullptr;
    QDockWidget* leading = nullptr;
    int trailingDist = tolerance + 1;
    int leadingDist = tolerance + 1;

    const QList<QDockWidget*> docks = mainWindow->findChildren<QDockWidget*>(Qt::FindDirectChildrenOnly);
    for (QDockWidget* dock : docks) {
        if (!dock->isVisible() || dock->isFloating() ||
            mainWindow->dockWidgetArea(dock) == Qt::NoDockWidgetArea) {
            continue;
        }

        QRect g = dock->geometry();
        int along, start, end;
        if (orientation == Qt::Horizontal) {
            if (pos.y() < g.top() || pos.y() > g.bottom()) {
                continue;
            }
            along = pos.x();
            start = g.left();
            end = g.left() + g.width();
        } else {
            if (pos.x() < g.left() || pos.x() > g.right()) {
                continue;
            }
            along = pos.y();
            start = g.top();
            end = g.top() + g.height();
        }

        int afterEnd = along - end;
        if (afterEnd >= -1 && afterEnd <= tolerance && qAbs(afterEnd) < trailingDist) {
            trailing = dock;
            trailingDist = qAbs(afterEnd);
        }
        int beforeStart = start - along;
        if (beforeStart >= -1 && beforeStart <= tolerance && qAbs(beforeStart) < leadingDist) {
            leading = dock;
            leadingDist = qAbs(beforeStart);
        }
    }

    return trailing != nullptr ? trailing : leading;
}

void RDockSnap::snap(QDockWidget* dock, Qt::Orientation orientation) {
    QWidget* content = dock->widget();
    if (content == nullptr) {
        return;
    }

    // raise minimums to what the contents need to show without scrolling:
    QList<QPair<QWidget*, QSize> > raised;
    auto raise = [&](QWidget* w, int need) {
        QSize orig = w->minimumSize();
        if (orientation == Qt::Horizontal) {
            if (need <= orig.width()) {
                return;
            }
            w->setMinimumWidth(need);
        } else {
            if (need <= orig.height()) {
                return;
            }
            w->setMinimumHeight(need);
        }
        raised.append(qMakePair(w, orig));
    };

    QList<QScrollArea*> scrollAreas = content->findChildren<QScrollArea*>();
    if (QScrollArea* sa = qobject_cast<QScrollArea*>(content)) {
        scrollAreas.prepend(sa);
    }
    for (QScrollArea* sa : scrollAreas) {
        // outermost scroll areas only: an inner one scrolls inside the outer
        if (!sa->isVisible() || sa->widget() == nullptr || insideScrollArea(sa, content)) {
            continue;
        }
        raise(sa, scrollAreaNeed(sa, orientation));
    }

    // reflowing contents outside any scroll area (e.g. a dock of tool
    // buttons in a flow layout) clip rather than scroll:
    if (qobject_cast<QScrollArea*>(content) == nullptr && content->hasHeightForWidth()) {
        QSize minSize = content->minimumSizeHint().expandedTo(content->minimumSize());
        if (orientation == Qt::Horizontal) {
            int w = narrowestFit(content, minSize.width(), qMax(minSize.width(), content->width()), content->height());
            if (w >= 0) {
                raise(content, w);
            }
        } else {
            raise(content, content->heightForWidth(content->width()));
        }
    }

    QList<QWidget*> touched;
    for (const auto& r : raised) {
        touched.append(r.first);
    }
    flushLayouts(touched, mainWindow);

    QSize target = dock->minimumSizeHint().expandedTo(dock->minimumSize());
    mainWindow->resizeDocks({dock}, {orientation == Qt::Horizontal ? target.width() : target.height()}, orientation);
    QCoreApplication::sendPostedEvents(nullptr, QEvent::LayoutRequest);

    for (const auto& r : raised) {
        r.first->setMinimumSize(r.second);
    }
    flushLayouts(touched, mainWindow);
}
