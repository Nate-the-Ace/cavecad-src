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
#ifndef RDOCKSNAP_H
#define RDOCKSNAP_H

#include <QObject>
#include <QPoint>

class QDockWidget;
class QMainWindow;

/**
 * Double-clicking a dock separator snaps the dock beside it to the
 * smallest width (vertical separator) or height (horizontal separator)
 * that still shows its contents without scroll bars.
 *
 * Qt paints and drags the separators itself and ignores double-clicks on
 * them, so this watches for them as an application event filter. Qt either
 * paints the separators on the main window, where the split cursor it puts
 * up gives the orientation and tells a separator apart from any other
 * double-click, or makes each one a thin widget of its own (as on macOS),
 * whose shape gives the orientation.
 *
 * A scroll area reports a tiny minimum size hint, so its minimum is
 * temporarily raised to what its contents need for the duration of the
 * resize, then restored.
 */
class RDockSnap : public QObject {
public:
    explicit RDockSnap(QMainWindow* mainWindow);

protected:
    bool eventFilter(QObject* watched, QEvent* event) override;

private:
    QDockWidget* dockAtSeparator(const QPoint& pos, Qt::Orientation orientation) const;
    void snap(QDockWidget* dock, Qt::Orientation orientation);

    QMainWindow* mainWindow;
};

#endif
