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
#include "RCave3dBridge.h"
#include "RCave3dView.h"
#include "RCave3dPanel.h"
#include "RDockWidget.h"
#include "RMainWindowQt.h"

#include <QVariantList>
#include <QVector3D>

namespace {

/**
 * A script array of numbers as a float vector.
 *
 * QVariantList is what a JS array arrives as, and each element costs a
 * QVariant. That is the transfer cost the plan set out to MEASURE, and
 * it is all in this one function: if a large cave proves too slow, this
 * is what a binary blob would replace.
 */
QVector<float> toFloats(const QVariant& value) {
    QVector<float> out;
    if (!value.isValid()) {
        return out;
    }
    QVariantList list = value.toList();
    out.reserve(list.size());
    for (int i = 0; i < list.size(); i++) {
        out.append(float(list.at(i).toDouble()));
    }
    return out;
}

QVector3D toVector(const QVariant& value, const QVector3D& fallback) {
    if (!value.isValid()) {
        return fallback;
    }
    QVariantMap map = value.toMap();
    if (map.isEmpty()) {
        return fallback;
    }
    return QVector3D(float(map.value("x").toDouble()),
                     float(map.value("y").toDouble()),
                     float(map.value("z").toDouble()));
}

} // namespace

RCave3dBridge::RCave3dBridge(QObject* parent)
    : QObject(parent), dock(NULL), panel(NULL), handle(0) {
}

RCave3dBridge::~RCave3dBridge() {
    // The dock is parented to the main window, which deletes it. Taking
    // it down from here would be a double delete on shutdown.
    dock = NULL;
    panel = NULL;
}

RCave3dPanel* RCave3dBridge::panelFor(int h) const {
    if (h == 0 || h != handle) {
        return NULL;
    }
    return panel;
}

int RCave3dBridge::open(const QString& caveName) {
    RMainWindowQt* appWin = RMainWindowQt::getMainWindow();
    if (appWin == NULL) {
        return 0;   // headless: nothing to dock into
    }

    QString title = caveName.isEmpty()
        ? tr("3D View")
        : tr("3D View -- %1").arg(caveName);

    if (dock == NULL) {
        panel = new RCave3dPanel();
        connect(panel, SIGNAL(refreshRequested()),
                this, SLOT(onWindowRefresh()));

        dock = new RDockWidget(title, appWin);
        // The object name is what Qt saves and restores window state
        // by. Without it the panel forgets where the caver put it every
        // time the application restarts, and Qt says so on stderr.
        dock->setObjectName("Cave3dDock");
        dock->setWidget(panel);
        dock->setAllowedAreas(Qt::AllDockWidgetAreas);
        appWin->addDockWidget(Qt::RightDockWidgetArea, dock);
        handle = 1;
    } else {
        dock->setWindowTitle(title);
    }

    dock->show();
    dock->raise();
    return handle;
}

void RCave3dBridge::close(int h) {
    RCave3dPanel* p = panelFor(h);
    if (p == NULL || dock == NULL) {
        return;
    }
    // HIDDEN, NOT DELETED. A dock the caver has arranged is worth
    // keeping: closing and reopening should put the panel back where it
    // was, and deleting it would also tear down the GL context for the
    // sake of a button press.
    dock->hide();
}

bool RCave3dBridge::isOpen(int h) {
    RCave3dPanel* p = panelFor(h);
    if (p == NULL || dock == NULL) {
        return false;
    }
    return dock->isVisible();
}

void RCave3dBridge::raiseWindow(int h) {
    RCave3dPanel* p = panelFor(h);
    if (p == NULL || dock == NULL) {
        return;
    }
    dock->show();
    dock->raise();
    if (dock->isFloating()) {
        dock->activateWindow();
    }
}

void RCave3dBridge::setMesh(int handle, const QVariantMap& mesh) {
    RCave3dPanel* p = panelFor(handle);
    if (p == NULL) {
        return;
    }
    RCave3dView* view = p->getView();
    if (view == NULL) {
        return;
    }

    QVariantMap triangles = mesh.value("triangles").toMap();
    view->setTriangles(toFloats(triangles.value("positions")),
                       toFloats(triangles.value("normals")),
                       toFloats(triangles.value("colors")));

    QVariantMap lines = mesh.value("lines").toMap();
    view->setLines(toFloats(lines.value("positions")),
                   toFloats(lines.value("colors")));

    QVariantMap bounds = mesh.value("bounds").toMap();
    view->setBounds(toVector(bounds.value("min"), QVector3D(-1, -1, -1)),
                    toVector(bounds.value("max"), QVector3D(1, 1, 1)));
    view->viewAll();
}

void RCave3dBridge::clear(int handle) {
    RCave3dPanel* p = panelFor(handle);
    if (p == NULL || p->getView() == NULL) {
        return;
    }
    p->getView()->clearGeometry();
}

void RCave3dBridge::setStatus(int handle, const QString& text) {
    RCave3dPanel* p = panelFor(handle);
    if (p == NULL) {
        return;
    }
    p->setStatus(text);
}

void RCave3dBridge::viewAll(int handle) {
    RCave3dPanel* p = panelFor(handle);
    if (p != NULL && p->getView() != NULL) {
        p->getView()->viewAll();
    }
}

void RCave3dBridge::viewPlan(int handle) {
    RCave3dPanel* p = panelFor(handle);
    if (p != NULL && p->getView() != NULL) {
        p->getView()->viewPlan();
    }
}

void RCave3dBridge::viewProfile(int handle) {
    RCave3dPanel* p = panelFor(handle);
    if (p != NULL && p->getView() != NULL) {
        p->getView()->viewProfile();
    }
}

void RCave3dBridge::setShowSurface(int handle, bool on) {
    RCave3dPanel* p = panelFor(handle);
    if (p != NULL && p->getView() != NULL) {
        p->getView()->setShowSurface(on);
    }
}

void RCave3dBridge::setShowLines(int handle, bool on) {
    RCave3dPanel* p = panelFor(handle);
    if (p != NULL && p->getView() != NULL) {
        p->getView()->setShowLines(on);
    }
}

void RCave3dBridge::onWindowRefresh() {
    if (handle != 0) {
        emit refreshRequested(handle);
    }
}
