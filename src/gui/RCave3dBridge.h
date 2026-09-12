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
#ifndef RCAVE3DBRIDGE_H
#define RCAVE3DBRIDGE_H

#include "gui_global.h"

#include <QHash>
#include <QObject>
#include <QVariantMap>

class RCave3dWindow;

/**
 * \brief Everything the script side can say to a 3D window.
 *
 * Exposed to ECMAScript as the global `cave3d`, through
 * QJSEngine::newQObject -- so every Q_INVOKABLE below is callable from
 * a Cave Survey add-on with no generated wrapper and no regeneration of
 * the JS API. That is the whole reason this class is a plain QObject
 * with invokables rather than another R* class in the generator's XML.
 *
 * Windows are addressed by an opaque integer handle. The script side
 * holds the handle, not the window: a script that held a QObject across
 * a reload would be holding a pointer to something the application may
 * have closed underneath it.
 *
 * \ingroup gui
 * \scriptable
 */
class QCADGUI_EXPORT RCave3dBridge : public QObject {
    Q_OBJECT

public:
    RCave3dBridge(QObject* parent = NULL);
    virtual ~RCave3dBridge();

    /** Opens a window titled for `caveName`. Returns its handle. */
    Q_INVOKABLE int open(const QString& caveName);

    /** Closes and forgets a window. Unknown handles are ignored. */
    Q_INVOKABLE void close(int handle);

    /** Whether this handle still names a window that is open. */
    Q_INVOKABLE bool isOpen(int handle);

    /** Brings an already-open window to the front. */
    Q_INVOKABLE void raiseWindow(int handle);

    /**
     * Hands over exactly what CsMesh3d.build returns:
     *
     *   {triangles: {positions, normals, colors, indices},
     *    lines:     {positions, colors, indices},
     *    bounds:    {min: {x,y,z}, max: {x,y,z}}}
     *
     * `indices` is accepted and IGNORED. CsMesh3d emits unshared
     * vertices with flat normals, so its indices are always sequential
     * and the view draws with glDrawArrays; carrying them across this
     * boundary would cost a third of the transfer for nothing. The
     * field stays in the script-side shape because a future mesh that
     * does share vertices will need it.
     */
    Q_INVOKABLE void setMesh(int handle, const QVariantMap& mesh);

    /** Empties a window without closing it. */
    Q_INVOKABLE void clear(int handle);

    /** One line under the view: counts, warnings, what failed. */
    Q_INVOKABLE void setStatus(int handle, const QString& text);

signals:
    /**
     * A window's Refresh button was pressed.
     *
     * A SIGNAL rather than a callback-name string, because
     * newQObject exposes signals to script directly -- an add-on writes
     * `cave3d.refreshRequested.connect(fn)` and gets a real connection,
     * with no name to keep in step and nothing to resolve by string at
     * call time.
     */
    void refreshRequested(int handle);

private slots:
    void onWindowRefresh();

private:
    RCave3dWindow* windowFor(int handle) const;
    int handleOf(RCave3dWindow* window) const;

    QHash<int, RCave3dWindow*> windows;
    int nextHandle;
};

#endif
