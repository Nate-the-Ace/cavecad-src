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
#include "RCave3dPanel.h"
#include "RCave3dView.h"

#include <QAction>
#include <QLabel>
#include <QToolBar>
#include <QVBoxLayout>

RCave3dPanel::RCave3dPanel(QWidget* parent)
    : QWidget(parent), view(NULL), status(NULL) {

    QVBoxLayout* layout = new QVBoxLayout(this);
    layout->setContentsMargins(0, 0, 0, 0);
    layout->setSpacing(0);

    QToolBar* bar = new QToolBar(this);
    bar->setObjectName("Cave3dToolBar");
    bar->setIconSize(QSize(16, 16));
    // A dock is narrow. Text-only buttons wrap into a second row and eat
    // the view; icons-or-text-beside would need an icon set this panel
    // does not have, so the buttons stay short words in a toolbar that
    // is allowed to overflow into its own extension menu.
    bar->setToolButtonStyle(Qt::ToolButtonTextOnly);
    layout->addWidget(bar);

    view = new RCave3dView(this);
    layout->addWidget(view, 1);

    status = new QLabel(this);
    status->setContentsMargins(4, 2, 4, 2);
    // The label must be allowed to be NARROWER than its text, or the
    // whole dock refuses to shrink below whatever the longest status
    // line happens to be.
    status->setMinimumWidth(0);
    status->setTextInteractionFlags(Qt::TextSelectableByMouse);
    layout->addWidget(status);

    QAction* refresh = bar->addAction(tr("Refresh"));
    refresh->setStatusTip(tr("Rebuild the passage from the drawing as it "
                             "stands now"));
    connect(refresh, SIGNAL(triggered()), this, SLOT(onRefresh()));

    bar->addSeparator();

    // Plan and profile are here because they are the two views a
    // cartographer checks the map against, and reaching them by
    // hand-orbiting is imprecise in a way that matters when you are
    // comparing against a drawing.
    QAction* all = bar->addAction(tr("All"));
    all->setStatusTip(tr("Frame the whole cave"));
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

    setLayout(layout);
}

RCave3dPanel::~RCave3dPanel() {
}

QSize RCave3dPanel::sizeHint() const {
    // Tall enough that a cave is worth looking at, not so tall that it
    // shoves every other panel out of the column. The caver drags it
    // from here and Qt remembers, because the dock has an object name.
    return QSize(420, 460);
}

void RCave3dPanel::setStatus(const QString& text) {
    if (status != NULL) {
        status->setText(text);
    }
}

void RCave3dPanel::onRefresh() {
    emit refreshRequested();
}
