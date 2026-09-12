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
#ifndef RCAVE3DWINDOW_H
#define RCAVE3DWINDOW_H

#include "gui_global.h"

#include <QMainWindow>

class RCave3dView;
class QLabel;

/**
 * \brief The window the 3D passage view lives in: a toolbar, a status
 * line, and one RCave3dView.
 *
 * It owns no cave knowledge either. Refresh is a SIGNAL, not an action
 * it carries out -- the script side is the only thing that knows how to
 * read a drawing, so the window asks and the script answers.
 *
 * \ingroup gui
 * \scriptable
 */
class QCADGUI_EXPORT RCave3dWindow : public QMainWindow {
    Q_OBJECT

public:
    RCave3dWindow(const QString& caveName, QWidget* parent = NULL);
    virtual ~RCave3dWindow();

    RCave3dView* getView() { return view; }

    /** One line under the view: triangle counts, warnings, what failed. */
    void setStatus(const QString& text);

signals:
    /** The user asked for the mesh to be rebuilt from the drawing. */
    void refreshRequested();

private slots:
    void onRefresh();

private:
    RCave3dView* view;
    QLabel* status;
};

#endif
