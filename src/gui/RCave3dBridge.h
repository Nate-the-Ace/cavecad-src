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
    /**
     * The one bridge, shared by every script engine.
     *
     * THERE IS ONE 3D PANEL IN ONE MAIN WINDOW, so there must be one
     * object holding it. A bridge per engine -- which is what handing
     * out `new RCave3dBridge()` produced -- gives each engine its own
     * idea of whether the panel exists: the engine that loads the
     * add-ons builds one dock, the engine that runs the menu action
     * builds a second, and the caver ends up with two 3D views, the
     * signals from each going to whichever engine happened to create
     * it.
     */
    static RCave3dBridge* getInstance();

    /**
     * Asks to be the one script engine listening to this panel.
     *
     * TRUE ONCE, FALSE EVER AFTER. There is one bridge and one panel,
     * but SEVERAL script engines -- the one that loads the add-ons and
     * one per menu action -- and each has its own copy of the add-on
     * with its own "have I connected yet" flag. Every one of them
     * connected, so a single press of Export ran the export once per
     * engine: two folder dialogs, two films.
     *
     * The flag has to live where the panel lives, which is here.
     */
    Q_INVOKABLE bool claimSignals();

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
    /**
     * Builds the panel now and leaves it hidden.
     *
     * WHY THIS EXISTS. A QOpenGLWidget appearing in a window makes Qt
     * REBUILD that window natively, and macOS then reshuffles its
     * Spaces around the new one -- measured from the log: the old
     * windows go visible->hidden, a new one hidden->visible, and
     * spacesDidChange follows. What the caver sees is the desktop
     * sliding and the display going black for about a second, in the
     * middle of their session, the first time they open the 3D view.
     *
     * The rebuild cannot be avoided, so it is paid at STARTUP instead,
     * while the window is being put together anyway and nobody is
     * working. open() then only has to show what is already there.
     */
    Q_INVOKABLE int prewarm();

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

    /** Station names written over the passage. */
    Q_INVOKABLE void setShowStations(int handle, bool on);

    /** Show the facts about one station, beside it in the view.
     *
     *  FINISHED STRINGS, not facts: labels and values run together and
     *  arrive already in the drawing's units, with trips named and
     *  dates formatted. The renderer must never be a second place that
     *  knows what a foot is. */
    Q_INVOKABLE void showStationCard(int handle, const QString& station,
                                     const QString& title,
                                     const QStringList& labels,
                                     const QStringList& values);
    Q_INVOKABLE void hideStationCard(int handle);

    /**
     * What a click at this point in the view would pick, and the same
     * signal a click would send.
     *
     * THE TEST DOOR. Synthetic mouse events cannot be posted from
     * CaveCAD's script engine -- QCoreApplication.sendEvent crashes
     * the application from there -- so without this the pick is the
     * one part of the panel no automated check can reach. A real
     * click goes through the view and never through here.
     *
     * Coordinates are the VIEW's own pixels, origin top left.
     * \return the station picked, or an empty string for a miss.
     */
    Q_INVOKABLE QString pickStation(int handle, int x, int y);

    /** What hovering at this point in the view would light up: the
     *  index of the cross section, or -1. The same test door as
     *  pickStation, for the same reason -- synthetic mouse events
     *  crash this script engine. */
    Q_INVOKABLE int hoverStation(int handle, int x, int y);

    /** The flight path down the passage, as a flat [x,y,z,...] list
     *  with the indices where one surveyed run gives way to another. */
    Q_INVOKABLE void setFlyPath(int handle, const QVariantList& points,
                                const QVariantList& breaks,
                                const QVariantList& turns);

    /** "manual", "fly" or "spin". */
    Q_INVOKABLE void setCameraMode(int handle, const QString& mode);
    Q_INVOKABLE QString getCameraMode(int handle);
    Q_INVOKABLE void setCameraProgress(int handle, double t);

    /** How fast the camera runs, as a multiple of its usual pace. */
    Q_INVOKABLE void setCameraSpeed(int handle, double factor);
    Q_INVOKABLE double getCameraSpeed(int handle);

    /**
     * Writes an animation out as a numbered PNG per frame.
     *
     * FRAMES, NOT A VIDEO FILE. Encoding one would mean either shipping
     * an encoder or depending on whatever the caver happens to have,
     * and a folder of frames is something every editor on every
     * platform will take. The caller is told the command that turns
     * them into a film.
     *
     * \return how many frames were written, or -1 when the folder could
     *         not be written to.
     */
    Q_INVOKABLE int exportFrames(int handle, const QString& dir,
                                 int frames);

    /**
     * Where an encoder is, or empty when there is none to be had.
     *
     * Looked for rather than depended on: a caver who has ffmpeg gets a
     * film, one who has not gets the frames and is told how to make one
     * from them. Requiring it would mean the 3D view could not export
     * at all on a machine that is otherwise perfectly able to fly a
     * cave.
     */
    /**
     * Films the running animation straight to one file.
     *
     * NO FRAMES ON DISK. The system's own encoder takes the pictures as
     * they are made, so six hundred PNGs are never written and never
     * have to be cleared away.
     *
     * \return the film's path, or empty with the reason in
     *         lastEncodeError() -- including on a platform whose own
     *         encoder is not wired up, where the caller should fall
     *         back to writing frames.
     */
    Q_INVOKABLE QString exportFilm(int handle, const QString& outFile,
                                   int frames, int fps);

    /** True when this build can write a film at all. */
    Q_INVOKABLE bool canEncode();

    Q_INVOKABLE QString findEncoder();

    /**
     * Turns a folder of numbered frames into a film beside it.
     *
     * \return the film's path, or an empty string with the reason in
     *         `error`.
     */
    Q_INVOKABLE QString encodeFrames(const QString& framesDir,
                                     const QString& outFile, int fps);

    /** Why the last encode failed, for the message the caver sees. */
    Q_INVOKABLE QString lastEncodeError() { return encodeError; }

    /** Where a draped scan stops being pencil and starts being paper,
     *  as a luminance 0 to 1. Clamped by the view; setting it does not
     *  come back as scanInkChanged. */
    Q_INVOKABLE void setScanInk(int handle, double value);
    Q_INVOKABLE double getScanInk(int handle);

    /** The surface above the cave, and its contour lines. */
    Q_INVOKABLE void setShowTerrain(int handle, bool on);
    Q_INVOKABLE void setShowTerrainContours(int handle, bool on);

    /** How solid the surface is, 0 to 1. Half by default: an opaque
     *  hillside hides the cave it is there to relate. */
    Q_INVOKABLE void setTerrainOpacity(int handle, double value);
    Q_INVOKABLE double getTerrainOpacity(int handle);

    /** Where the camera is: yaw, pitch, distance, target and whether
     *  the caver has moved it. Read only. */
    Q_INVOKABLE QVariantMap getCamera(int handle);

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

    /** The caver moved the surface opacity slider, 0 to 1. */
    void terrainOpacityChanged(int handle, double value);

    /** The caver chose how the camera moves: "manual", "fly" or "spin". */
    void cameraModeChanged(int handle, const QString& mode);

    /** The caver moved the speed slider. */
    void cameraSpeedChanged(int handle, double factor);

    /** The caver pressed Export. The script side chooses where. */
    void exportRequested(int handle);

    /** The caver picked a different colour mode. The script side
     *  rebuilds the mesh with it; nothing here knows what any of them
     *  mean. */
    void colorModeChanged(int handle, const QString& mode);

    /** The caver clicked a station in the view, or clicked nothing --
     *  which arrives as an empty name and means close the card. */
    void stationPicked(int handle, const QString& station);

    /** An overlay was toggled: "ghost" or "leads". Carried out so the
     *  script side can remember it between sessions. */
    void overlayToggled(int handle, const QString& which, bool on);

private:
    /** Makes the dock and the panel, once. */
    void build(const QString& title);

    /** Set once the panel has asked for a mesh because it came back
     *  visible with none -- so it asks once, not on every show. */
    bool askedForFirstMesh;
    QString encodeError;
    bool signalsClaimed;

    /** Whether the dock is currently in the main window's layout.
     *  prewarm() takes it out; open() puts it back. */
    bool docked;

private slots:
    void onWindowRefresh();
    void onPanelModeChanged(const QString& mode);
    void onPanelOverlayToggled(const QString& which, bool on);
    void onPanelScanInkChanged(double value);
    void onPanelTerrainOpacityChanged(double value);
    void onPanelCameraModeChanged(const QString& mode);
    void onPanelCameraSpeedChanged(double factor);
    void onPanelExportRequested();
    void onViewStationPicked(const QString& station);
    void onDockVisibilityChanged(bool visible);

private:
    RCave3dPanel* panelFor(int handle) const;

    RDockWidget* dock;
    RCave3dPanel* panel;
    int handle;
};

#endif
