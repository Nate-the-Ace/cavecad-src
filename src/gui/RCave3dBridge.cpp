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
#include "RCave3dWindow.h"

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
    : QObject(parent), nextHandle(1) {
}

RCave3dBridge::~RCave3dBridge() {
    QHash<int, RCave3dWindow*>::iterator it;
    for (it = windows.begin(); it != windows.end(); ++it) {
        delete it.value();
    }
    windows.clear();
}

RCave3dWindow* RCave3dBridge::windowFor(int handle) const {
    return windows.value(handle, NULL);
}

int RCave3dBridge::handleOf(RCave3dWindow* window) const {
    QHash<int, RCave3dWindow*>::const_iterator it;
    for (it = windows.constBegin(); it != windows.constEnd(); ++it) {
        if (it.value() == window) {
            return it.key();
        }
    }
    return 0;
}

int RCave3dBridge::open(const QString& caveName) {
    RCave3dWindow* window = new RCave3dWindow(caveName);
    connect(window, SIGNAL(refreshRequested()), this, SLOT(onWindowRefresh()));
    int handle = nextHandle++;
    windows.insert(handle, window);
    window->show();
    return handle;
}

void RCave3dBridge::close(int handle) {
    RCave3dWindow* window = windowFor(handle);
    if (window == NULL) {
        return;
    }
    windows.remove(handle);
    window->close();
    window->deleteLater();
}

bool RCave3dBridge::isOpen(int handle) {
    RCave3dWindow* window = windowFor(handle);
    if (window == NULL) {
        return false;
    }
    // A window the user closed with its own title-bar button is still
    // in the table but is no longer a window anybody can see. Saying it
    // is open would make a script push meshes into nothing.
    return window->isVisible();
}

void RCave3dBridge::raiseWindow(int handle) {
    RCave3dWindow* window = windowFor(handle);
    if (window == NULL) {
        return;
    }
    window->show();
    window->raise();
    window->activateWindow();
}

void RCave3dBridge::setMesh(int handle, const QVariantMap& mesh) {
    RCave3dWindow* window = windowFor(handle);
    if (window == NULL) {
        return;
    }
    RCave3dView* view = window->getView();
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
    RCave3dWindow* window = windowFor(handle);
    if (window == NULL || window->getView() == NULL) {
        return;
    }
    window->getView()->clearGeometry();
}

void RCave3dBridge::setStatus(int handle, const QString& text) {
    RCave3dWindow* window = windowFor(handle);
    if (window == NULL) {
        return;
    }
    window->setStatus(text);
}

void RCave3dBridge::viewAll(int handle) {
    RCave3dWindow* window = windowFor(handle);
    if (window != NULL && window->getView() != NULL) {
        window->getView()->viewAll();
    }
}

void RCave3dBridge::viewPlan(int handle) {
    RCave3dWindow* window = windowFor(handle);
    if (window != NULL && window->getView() != NULL) {
        window->getView()->viewPlan();
    }
}

void RCave3dBridge::viewProfile(int handle) {
    RCave3dWindow* window = windowFor(handle);
    if (window != NULL && window->getView() != NULL) {
        window->getView()->viewProfile();
    }
}

void RCave3dBridge::setShowSurface(int handle, bool on) {
    RCave3dWindow* window = windowFor(handle);
    if (window != NULL && window->getView() != NULL) {
        window->getView()->setShowSurface(on);
    }
}

void RCave3dBridge::setShowLines(int handle, bool on) {
    RCave3dWindow* window = windowFor(handle);
    if (window != NULL && window->getView() != NULL) {
        window->getView()->setShowLines(on);
    }
}

void RCave3dBridge::onWindowRefresh() {
    RCave3dWindow* window = qobject_cast<RCave3dWindow*>(sender());
    if (window == NULL) {
        return;
    }
    int handle = handleOf(window);
    if (handle != 0) {
        emit refreshRequested(handle);
    }
}
