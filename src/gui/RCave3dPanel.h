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
#ifndef RCAVE3DPANEL_H
#define RCAVE3DPANEL_H

#include "gui_global.h"

#include <QPair>
#include <QSize>
#include <QStringList>
#include <QVector>
#include <QWidget>

class RCave3dView;
class QAction;
class QComboBox;
class QLabel;
class QSlider;
class QTimer;

/**
 * \brief The 3D passage view with its toolbar and status line, as one
 * widget that can live in a dock.
 *
 * It owns no cave knowledge. Refresh is a SIGNAL, not an action it
 * carries out -- the script side is the only thing that knows how to
 * read a drawing, so the panel asks and the script answers.
 *
 * A PANEL RATHER THAN A WINDOW because the cartographer is comparing
 * this against the map, and a separate top-level window puts the two
 * on different pieces of screen furniture that have to be arranged by
 * hand and re-arranged after every app switch. Docked, the 3D view sits
 * beside the drawing in the same window as every other panel in the
 * suite, and QDockWidget still lets it be torn off and floated for
 * anyone who wants that.
 *
 * \ingroup gui
 * \scriptable
 */
class QCADGUI_EXPORT RCave3dPanel : public QWidget {
    Q_OBJECT

public:
    RCave3dPanel(QWidget* parent = NULL);
    virtual ~RCave3dPanel();

    RCave3dView* getView() { return view; }

    /** One line under the view: counts, warnings, what failed. */
    void setStatus(const QString& text);

    /** A dock is handed its share of the window from this. Without a
     *  hint of its own the panel gets the toolbar's height and the cave
     *  is fitted into a letterbox two hundred pixels tall. */
    virtual QSize sizeHint() const;

    /** Fills the colour-mode dropdown. Does NOT emit modeChanged:
     *  filling the combo is not the caver choosing something. */
    void setColorModes(const QStringList& keys, const QStringList& labels,
                       const QString& current);

    /** The animation's frames: cumulative (triangleVertices,
     *  lineVertices) per leg, straight from CsMesh3d's step table. */
    void setSteps(const QVector<QPair<int, int> >& steps);

    /** Greys the Ghost toggle when the mesh carried no ghost -- which
     *  means adjustment is off or the solve did not converge, not that
     *  something failed here. */
    void setGhostAvailable(bool available);
    void setShowGhost(bool on);
    void setShowLeads(bool on);
    void setShowSections(bool on);

    /** Greys the Sections toggle when the drawing holds none -- which
     *  is a fact about the drawing, not a failure here. */
    void setSectionsAvailable(bool available);

    void setShowScans(bool on);
    /** Greys the Scans toggle when the drawing holds none. */
    void setScansAvailable(bool available);

signals:
    /** The user asked for the mesh to be rebuilt from the drawing. */
    void refreshRequested();

    /** The caver picked a different colour mode, by its key. */
    void modeChanged(const QString& mode);

    /** An overlay was toggled: "ghost" or "leads". */
    void overlayToggled(const QString& which, bool on);

private slots:
    void onRefresh();
    void onModeChanged(int index);
    void onPlayToggled(bool on);
    void onPlayTick();
    void onProgressChanged(int value);

private:
    RCave3dView* view;
    QLabel* status;

    QComboBox* modeCombo;
    QStringList modeKeys;
    /** True while setColorModes is populating, so a programmatic fill
     *  is not mistaken for a choice and does not trigger a rebuild. */
    bool fillingCombo;

    QAction* ghostAction;
    QAction* leadsAction;
    QAction* sectionsAction;
    QAction* scansAction;
    QAction* playAction;
    QSlider* progressSlider;
    QTimer* playTimer;
    QVector<QPair<int, int> > steps;
};

#endif
