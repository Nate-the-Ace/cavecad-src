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
#include "RCave3dWindow.h"
#include "RCave3dView.h"

#include <QAction>
#include <QLabel>
#include <QStatusBar>
#include <QToolBar>

RCave3dWindow::RCave3dWindow(const QString& caveName, QWidget* parent)
    : QMainWindow(parent), view(NULL), status(NULL) {

    setWindowTitle(caveName.isEmpty()
        ? tr("3D View")
        : tr("3D View -- %1").arg(caveName));
    setAttribute(Qt::WA_DeleteOnClose, false);
    resize(900, 650);

    view = new RCave3dView(this);
    setCentralWidget(view);

    QToolBar* bar = addToolBar(tr("3D View"));
    bar->setObjectName("Cave3dToolBar");

    QAction* refresh = bar->addAction(tr("Refresh"));
    refresh->setStatusTip(tr("Rebuild the passage from the drawing as it "
                             "stands now"));
    connect(refresh, SIGNAL(triggered()), this, SLOT(onRefresh()));

    bar->addSeparator();

    // Plan and profile are here because they are the two views a
    // cartographer checks the map against, and reaching them by
    // hand-orbiting is imprecise in a way that matters when you are
    // comparing against a drawing.
    QAction* all = bar->addAction(tr("View All"));
    all->setShortcut(QKeySequence(Qt::Key_Home));
    connect(all, &QAction::triggered, [this]() { view->viewAll(); });

    QAction* plan = bar->addAction(tr("Plan"));
    plan->setStatusTip(tr("Look straight down, the way the map is drawn"));
    connect(plan, &QAction::triggered, [this]() { view->viewPlan(); });

    QAction* profile = bar->addAction(tr("Profile"));
    profile->setStatusTip(tr("Look north, the way the extended elevation "
                             "is drawn"));
    connect(profile, &QAction::triggered, [this]() { view->viewProfile(); });

    bar->addSeparator();

    QAction* surface = bar->addAction(tr("Passage"));
    surface->setCheckable(true);
    surface->setChecked(true);
    connect(surface, &QAction::toggled,
            [this](bool on) { view->setShowSurface(on); });

    QAction* lines = bar->addAction(tr("Centerline"));
    lines->setCheckable(true);
    lines->setChecked(true);
    connect(lines, &QAction::toggled,
            [this](bool on) { view->setShowLines(on); });

    status = new QLabel(this);
    // STRETCH 1, not the default 0. A status-bar widget with no stretch
    // is given its sizeHint, and this label's first sizeHint is taken
    // while it is still empty -- so every line set afterwards is clipped
    // to a couple of characters. It read "5" where it meant "530
    // triangles, 75 centerline segments, 146.6 ft of relief".
    statusBar()->addWidget(status, 1);
}

RCave3dWindow::~RCave3dWindow() {
}

void RCave3dWindow::setStatus(const QString& text) {
    if (status != NULL) {
        status->setText(text);
    }
}

void RCave3dWindow::onRefresh() {
    emit refreshRequested();
}
