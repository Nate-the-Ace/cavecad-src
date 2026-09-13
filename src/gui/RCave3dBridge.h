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
#include <QStringList>
#include <QVariantMap>

class RCave3dPanel;
class RDockWidget;

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

    /**
     * Docks a 3D view into the main window, titled for `caveName`.
     * Returns its handle.
     *
     * There is only ever ONE, because there is only ever one drawing in
     * front of the caver. Calling open again re-titles and re-shows the
     * panel that already exists rather than stacking a second.
     */
    Q_INVOKABLE int open(const QString& caveName);

    /** Hides the panel. Unknown handles are ignored. */
    Q_INVOKABLE void close(int handle);

    /** Whether this handle names a panel that is showing. */
    Q_INVOKABLE bool isOpen(int handle);

    /** Shows and raises the panel, floating or docked as it was left. */
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

    /** Frame the whole cave at the current orientation. */
    Q_INVOKABLE void viewAll(int handle);

    /** Look straight down, the way the map is drawn. */
    Q_INVOKABLE void viewPlan(int handle);

    /** Look north, the way the extended elevation is drawn. */
    Q_INVOKABLE void viewProfile(int handle);

    /** Show or hide each of the four overlays. */
    Q_INVOKABLE void setShowSurface(int handle, bool on);
    Q_INVOKABLE void setShowLines(int handle, bool on);
    Q_INVOKABLE void setShowGhost(int handle, bool on);
    Q_INVOKABLE void setShowLeads(int handle, bool on);
    Q_INVOKABLE void setShowSections(int handle, bool on);
    Q_INVOKABLE void setShowScans(int handle, bool on);

    /** Where a draped scan stops being pencil and starts being paper,
     *  as a luminance 0 to 1. Clamped by the view; setting it does not
     *  come back as scanInkChanged. */
    Q_INVOKABLE void setScanInk(int handle, double value);
    Q_INVOKABLE double getScanInk(int handle);

    /**
     * Fills the colour-mode dropdown. `keys` are CsMesh3d colorBy
     * values and `labels` what the caver reads; they are parallel.
     * Filling does not emit colorModeChanged -- populating a combo is
     * not somebody choosing something.
     */
    Q_INVOKABLE void setColorModes(int handle, const QStringList& keys,
                                   const QStringList& labels,
                                   const QString& current);

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

    /** The caver moved the ink slider. The view is already showing it;
     *  this is so the add-on can remember the setting. */
    void scanInkChanged(int handle, double value);

    /** The caver picked a different colour mode. The script side
     *  rebuilds the mesh with it; nothing here knows what any of them
     *  mean. */
    void colorModeChanged(int handle, const QString& mode);

    /** An overlay was toggled: "ghost" or "leads". Carried out so the
     *  script side can remember it between sessions. */
    void overlayToggled(int handle, const QString& which, bool on);

private slots:
    void onWindowRefresh();
    void onPanelModeChanged(const QString& mode);
    void onPanelOverlayToggled(const QString& which, bool on);
    void onPanelScanInkChanged(double value);

private:
    RCave3dPanel* panelFor(int handle) const;

    RDockWidget* dock;
    RCave3dPanel* panel;
    int handle;
};

#endif
