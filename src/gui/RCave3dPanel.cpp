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
#include <QComboBox>
#include <QLabel>
#include <QSlider>
#include <QTimer>
#include <QToolBar>
#include <QVBoxLayout>

RCave3dPanel::RCave3dPanel(QWidget* parent)
    : QWidget(parent), view(NULL), status(NULL), modeCombo(NULL),
      fillingCombo(false), ghostAction(NULL), leadsAction(NULL), sectionsAction(NULL), scansAction(NULL), stationsAction(NULL),
      inkLabel(NULL), inkSlider(NULL), inkLabelAction(NULL),
      inkSliderAction(NULL), fillingInk(false),
      playAction(NULL), progressSlider(NULL), playTimer(NULL) {

    QVBoxLayout* layout = new QVBoxLayout(this);
    layout->setContentsMargins(0, 0, 0, 0);
    layout->setSpacing(0);

    // TWO ROWS. A mode dropdown, four toggles, a play button and a
    // slider do not fit across a docked panel, and a single toolbar
    // would push half of them into an overflow menu where they are
    // invisible.
    QToolBar* row1 = new QToolBar(this);
    row1->setObjectName("Cave3dToolBarTop");
    row1->setToolButtonStyle(Qt::ToolButtonTextOnly);
    layout->addWidget(row1);

    QToolBar* row2 = new QToolBar(this);
    row2->setObjectName("Cave3dToolBarBottom");
    row2->setToolButtonStyle(Qt::ToolButtonTextOnly);
    layout->addWidget(row2);

    view = new RCave3dView(this);
    layout->addWidget(view, 1);

    status = new QLabel(this);
    status->setContentsMargins(4, 2, 4, 2);
    // Must be allowed to be NARROWER than its text, or the whole dock
    // refuses to shrink below the longest status line.
    status->setMinimumWidth(0);
    status->setTextInteractionFlags(Qt::TextSelectableByMouse);
    layout->addWidget(status);

    // ---- row 1: rebuild, and where the camera looks from ----

    QAction* refresh = row1->addAction(tr("Refresh"));
    refresh->setStatusTip(tr("Rebuild the passage from the drawing as it "
                             "stands now"));
    connect(refresh, SIGNAL(triggered()), this, SLOT(onRefresh()));

    row1->addSeparator();

    // Plan and profile are here because they are the two views a
    // cartographer checks the map against, and reaching them by
    // hand-orbiting is imprecise in a way that matters when you are
    // comparing against a drawing.
    QAction* all = row1->addAction(tr("All"));
    all->setStatusTip(tr("Frame the whole cave"));
    connect(all, &QAction::triggered, [this]() { view->viewAll(); });

    QAction* plan = row1->addAction(tr("Plan"));
    plan->setStatusTip(tr("Look straight down, the way the map is drawn"));
    connect(plan, &QAction::triggered, [this]() { view->viewPlan(); });

    QAction* profile = row1->addAction(tr("Profile"));
    profile->setStatusTip(tr("Look north, the way the extended elevation "
                             "is drawn"));
    connect(profile, &QAction::triggered, [this]() { view->viewProfile(); });

    row1->addSeparator();

    modeCombo = new QComboBox(this);
    modeCombo->setObjectName("Cave3dModeCombo");
    modeCombo->setStatusTip(tr("What the colours mean"));
    connect(modeCombo, SIGNAL(currentIndexChanged(int)),
            this, SLOT(onModeChanged(int)));
    row1->addWidget(modeCombo);

    // ---- row 2: what is drawn, and the build animation ----

    QAction* surface = row2->addAction(tr("Passage"));
    surface->setCheckable(true);
    surface->setChecked(true);
    connect(surface, &QAction::toggled,
            [this](bool on) { view->setShowSurface(on); });

    QAction* lines = row2->addAction(tr("Centerline"));
    lines->setCheckable(true);
    lines->setChecked(true);
    connect(lines, &QAction::toggled,
            [this](bool on) { view->setShowLines(on); });

    ghostAction = row2->addAction(tr("Ghost"));
    ghostAction->setCheckable(true);
    ghostAction->setStatusTip(tr("The survey as recorded, before loop "
                                 "closure moved anything"));
    connect(ghostAction, &QAction::toggled, [this](bool on) {
        view->setShowGhost(on);
        emit overlayToggled(QString("ghost"), on);
    });

    leadsAction = row2->addAction(tr("Leads"));
    leadsAction->setCheckable(true);
    leadsAction->setStatusTip(tr("Mark every station where passage was "
                                 "left going"));
    connect(leadsAction, &QAction::toggled, [this](bool on) {
        view->setShowLeads(on);
        emit overlayToggled(QString("leads"), on);
    });

    sectionsAction = row2->addAction(tr("Sections"));
    sectionsAction->setCheckable(true);
    sectionsAction->setStatusTip(tr("Stand every captured cross section "
                                    "beside the passage it was drawn of"));
    connect(sectionsAction, &QAction::toggled, [this](bool on) {
        view->setShowSections(on);
        emit overlayToggled(QString("sections"), on);
    });

    scansAction = row2->addAction(tr("Scans"));
    scansAction->setCheckable(true);
    scansAction->setStatusTip(tr("Lay the scanned sketches onto the "
                                 "passage they were drawn of"));
    connect(scansAction, &QAction::toggled, [this](bool on) {
        view->setShowScans(on);
        syncInkVisible();
        emit overlayToggled(QString("scans"), on);
    });

    // HOW MUCH OF THE PENCIL COUNTS AS PENCIL. Scanners disagree wildly
    // about how grey a graphite line on white paper comes out, and a
    // book photographed in a cave entrance is not the same as one run
    // through a flatbed at home. One fixed threshold therefore leaves
    // some sheets with a haze of scanner grey around every stroke and
    // others with the faint lines missing altogether. This is the
    // caver's to wind until the sheet in front of them reads.
    //
    // ONLY WHILE SCANS ARE ON. It tunes nothing otherwise, and a dead
    // slider in a crowded toolbar is a question the caver has to answer
    // every time they look at it.
    inkLabel = new QLabel(tr("Ink"), this);
    inkLabel->setContentsMargins(6, 0, 2, 0);
    inkLabelAction = row2->addWidget(inkLabel);
    inkLabelAction->setVisible(false);

    inkSlider = new QSlider(Qt::Horizontal, this);
    inkSlider->setObjectName("Cave3dInkSlider");
    inkSlider->setStatusTip(tr("Drag left to keep only the darkest "
                               "pencil, right to bring faint lines back"));
    // Whole percent of luminance. Finer than the eye can judge on a
    // scanned sketch, and it keeps the slider an integer control.
    inkSlider->setRange(int(RCave3dView::MIN_SCAN_INK * 100.0),
                        int(RCave3dView::MAX_SCAN_INK * 100.0));
    inkSlider->setValue(int(RCave3dView::DEFAULT_SCAN_INK * 100.0));
    inkSlider->setMaximumWidth(110);
    connect(inkSlider, SIGNAL(valueChanged(int)),
            this, SLOT(onScanInkChanged(int)));
    inkSliderAction = row2->addWidget(inkSlider);
    inkSliderAction->setVisible(false);

    // WHERE AM I? A passage seen in three dimensions is a shape without
    // a name on it, and the question a cartographer asks of it first is
    // which bend they are looking at. The names are painted over the
    // view rather than drawn in it: see RCave3dLabels.
    stationsAction = row2->addAction(tr("Stations"));
    stationsAction->setCheckable(true);
    stationsAction->setStatusTip(tr("Write the station names over the "
                                    "passage"));
    connect(stationsAction, &QAction::toggled, [this](bool on) {
        view->setShowStations(on);
        emit overlayToggled(QString("stations"), on);
    });

    row2->addSeparator();

    playAction = row2->addAction(tr("Play"));
    playAction->setCheckable(true);
    playAction->setStatusTip(tr("Build the cave one shot at a time, in "
                                "the order it was surveyed"));
    connect(playAction, SIGNAL(toggled(bool)), this, SLOT(onPlayToggled(bool)));

    progressSlider = new QSlider(Qt::Horizontal, this);
    progressSlider->setObjectName("Cave3dProgressSlider");
    progressSlider->setStatusTip(tr("Drag to any point in the survey"));
    progressSlider->setRange(0, 0);
    connect(progressSlider, SIGNAL(valueChanged(int)),
            this, SLOT(onProgressChanged(int)));
    row2->addWidget(progressSlider);

    playTimer = new QTimer(this);
    playTimer->setInterval(40);
    connect(playTimer, SIGNAL(timeout()), this, SLOT(onPlayTick()));

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

void RCave3dPanel::setColorModes(const QStringList& keys,
                                 const QStringList& labels,
                                 const QString& current) {
    if (modeCombo == NULL) {
        return;
    }
    fillingCombo = true;
    modeCombo->clear();
    modeKeys = keys;
    for (int i = 0; i < labels.size(); i++) {
        modeCombo->addItem(labels.at(i));
    }
    int at = keys.indexOf(current);
    if (at >= 0) {
        modeCombo->setCurrentIndex(at);
    }
    fillingCombo = false;
}

void RCave3dPanel::onModeChanged(int index) {
    if (fillingCombo || index < 0 || index >= modeKeys.size()) {
        return;
    }
    emit modeChanged(modeKeys.at(index));
}

void RCave3dPanel::setSteps(const QVector<QPair<int, int> >& s) {
    steps = s;
    if (progressSlider == NULL) {
        return;
    }
    progressSlider->blockSignals(true);
    progressSlider->setRange(0, qMax(0, steps.size() - 1));
    progressSlider->setValue(qMax(0, steps.size() - 1));
    progressSlider->blockSignals(false);
    progressSlider->setEnabled(steps.size() > 1);
    playAction->setEnabled(steps.size() > 1);
    // A NEW MESH SHOWS THE WHOLE CAVE. The animation is a thing you do,
    // never a state the panel is left sitting in -- a half-built cave
    // restored on a rebuild would read as a bug.
    if (view != NULL) {
        view->setProgress(-1, -1);
    }
    playTimer->stop();
    playAction->setChecked(false);
}

void RCave3dPanel::setGhostAvailable(bool available) {
    if (ghostAction == NULL) {
        return;
    }
    ghostAction->setEnabled(available);
    if (!available && ghostAction->isChecked()) {
        ghostAction->setChecked(false);
    }
}

void RCave3dPanel::setShowGhost(bool on) {
    if (ghostAction != NULL && ghostAction->isEnabled()) {
        ghostAction->setChecked(on);
    }
}

void RCave3dPanel::setShowLeads(bool on) {
    if (leadsAction != NULL) {
        leadsAction->setChecked(on);
    }
}

void RCave3dPanel::setSectionsAvailable(bool available) {
    if (sectionsAction == NULL) {
        return;
    }
    sectionsAction->setEnabled(available);
    if (!available && sectionsAction->isChecked()) {
        sectionsAction->setChecked(false);
    }
}

void RCave3dPanel::setShowSections(bool on) {
    if (sectionsAction != NULL && sectionsAction->isEnabled()) {
        sectionsAction->setChecked(on);
    }
}

void RCave3dPanel::setScanInk(double value) {
    if (inkSlider == NULL) {
        return;
    }
    fillingInk = true;
    inkSlider->setValue(int(value * 100.0 + 0.5));
    fillingInk = false;
    // Straight to the view as well: the slider may have clamped the
    // value into its own range, and the two must not disagree.
    view->setScanInk(inkSlider->value() / 100.0);
}

void RCave3dPanel::onScanInkChanged(int value) {
    view->setScanInk(value / 100.0);
    if (fillingInk) {
        return;
    }
    emit scanInkChanged(value / 100.0);
}

void RCave3dPanel::setShowStations(bool on) {
    if (stationsAction != NULL && stationsAction->isEnabled()) {
        stationsAction->setChecked(on);
    }
}

void RCave3dPanel::setStationsAvailable(bool available) {
    if (stationsAction == NULL) {
        return;
    }
    stationsAction->setEnabled(available);
    if (!available && stationsAction->isChecked()) {
        stationsAction->setChecked(false);
    }
}

void RCave3dPanel::setScansAvailable(bool available) {
    if (scansAction == NULL) {
        return;
    }
    scansAction->setEnabled(available);
    if (!available && scansAction->isChecked()) {
        scansAction->setChecked(false);
    }
    syncInkVisible();
}

void RCave3dPanel::setShowScans(bool on) {
    if (scansAction != NULL && scansAction->isEnabled()) {
        scansAction->setChecked(on);
    }
    syncInkVisible();
}

/** The ink slider belongs to the scans, so it appears and goes with
 *  them. Called as well as the toggle's own handler because setChecked
 *  on an already-checked action emits nothing. */
void RCave3dPanel::syncInkVisible() {
    bool on = (scansAction != NULL && scansAction->isEnabled()
               && scansAction->isChecked());
    if (inkLabelAction != NULL) { inkLabelAction->setVisible(on); }
    if (inkSliderAction != NULL) { inkSliderAction->setVisible(on); }
}

void RCave3dPanel::onPlayToggled(bool on) {
    if (!on) {
        playTimer->stop();
        return;
    }
    if (steps.size() < 2) {
        playAction->setChecked(false);
        return;
    }
    // Starting from the end would show one frame and stop.
    if (progressSlider->value() >= progressSlider->maximum()) {
        progressSlider->setValue(0);
    }
    playTimer->start();
}

void RCave3dPanel::onPlayTick() {
    int next = progressSlider->value() + 1;
    if (next >= steps.size()) {
        playTimer->stop();
        playAction->setChecked(false);
        // Ending on the whole cave, never on a partial one.
        if (view != NULL) {
            view->setProgress(-1, -1);
        }
        return;
    }
    progressSlider->setValue(next);
}

void RCave3dPanel::onProgressChanged(int value) {
    if (view == NULL || steps.isEmpty()) {
        return;
    }
    if (value >= steps.size() - 1) {
        view->setProgress(-1, -1);      // the whole cave
        return;
    }
    view->setProgress(steps.at(value).first, steps.at(value).second);
}
