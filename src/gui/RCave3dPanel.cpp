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

namespace {
/** Ticks the camera takes to run its animation once through. */
const int CAMERA_TICKS = 600;
}
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
      fillingCombo(false), ghostAction(NULL), leadsAction(NULL), sectionsAction(NULL), scansAction(NULL), terrainAction(NULL),
      terrainContoursAction(NULL), terrainLabel(NULL), terrainSlider(NULL),
      terrainLabelAction(NULL), terrainSliderAction(NULL),
      fillingTerrain(false), stationsAction(NULL), flyAction(NULL),
      spinAction(NULL), speedLabel(NULL), speedSlider(NULL),
      speedLabelAction(NULL), speedSliderAction(NULL), scrubbing(false),
      cameraT(0.0),
      settingCameraMode(false),
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

    // EXPORT IS A REQUEST, not something the panel carries out: where
    // the frames go is a question about the caver's cave folder, and
    // the script side is the only thing that knows about those.
    QAction* exportAction = row1->addAction(tr("Export..."));
    exportAction->setStatusTip(tr("Write the running animation out as a "
                                  "numbered image per frame"));
    connect(exportAction, SIGNAL(triggered()), this, SIGNAL(exportRequested()));

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

    // WHAT IS ABOVE THE CAVE. A passage drawn in the dark is a shape
    // with no place: whether it runs under a ridge, a road or the
    // valley floor is the first thing anyone asks of it, and the
    // survey alone cannot say. The surface answers it -- the ground
    // from 3DEP with the aerial photograph draped over it, standing
    // where the cave's own datum anchor says it stands.
    terrainAction = row2->addAction(tr("Terrain"));
    terrainAction->setCheckable(true);
    terrainAction->setStatusTip(tr("Show the ground above the cave, with "
                                   "the aerial photograph draped over it"));
    connect(terrainAction, &QAction::toggled, [this](bool on) {
        view->setShowTerrain(on);
        syncTerrainVisible();
        emit overlayToggled(QString("terrain"), on);
    });

    terrainContoursAction = row2->addAction(tr("Contours"));
    terrainContoursAction->setCheckable(true);
    terrainContoursAction->setStatusTip(tr("Draw the surface contour lines "
                                           "on the ground above the cave"));
    connect(terrainContoursAction, &QAction::toggled, [this](bool on) {
        view->setShowTerrainContours(on);
        emit overlayToggled(QString("terraincontours"), on);
    });

    // HOW SOLID THE HILL IS. The whole point of the surface is relating
    // the cave to what is over it, and an opaque hillside hides the
    // cave completely -- so this is not a decoration. How far it has to
    // come down depends on the photograph: bare rock reads through at
    // a glance, dark forest needs winding well back.
    //
    // ONLY WHILE TERRAIN IS ON, for the reason the ink slider is: a
    // dead control in a crowded toolbar is a question the caver has to
    // answer every time they look at it.
    terrainLabel = new QLabel(tr("Surface"), this);
    terrainLabel->setContentsMargins(6, 0, 2, 0);
    terrainLabelAction = row2->addWidget(terrainLabel);
    terrainLabelAction->setVisible(false);

    terrainSlider = new QSlider(Qt::Horizontal, this);
    terrainSlider->setObjectName("Cave3dTerrainSlider");
    terrainSlider->setStatusTip(tr("Drag left to see the cave through the "
                                   "hill, right to read the ground"));
    terrainSlider->setRange(0, 100);
    terrainSlider->setValue(int(RCave3dView::DEFAULT_TERRAIN_OPACITY
                                * 100.0));
    terrainSlider->setMaximumWidth(110);
    connect(terrainSlider, SIGNAL(valueChanged(int)),
            this, SLOT(onTerrainOpacityChanged(int)));
    terrainSliderAction = row2->addWidget(terrainSlider);
    terrainSliderAction->setVisible(false);

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

    // TWO WAYS THE CAMERA MOVES ON ITS OWN, and the Play button drives
    // whichever is on -- one animation control rather than three, and
    // the slider scrubs whatever Play would run.
    //
    // Fly goes down the centreline from inside the passage, which is
    // what tells a caver what the cave is LIKE. Spin turns the whole
    // cave slowly in front of them, which is what shows its shape.
    flyAction = row2->addAction(tr("Fly"));
    flyAction->setCheckable(true);
    flyAction->setStatusTip(tr("Fly down the surveyed passage, from "
                               "inside it -- drag to look around"));
    connect(flyAction, &QAction::toggled, [this](bool on) {
        if (settingCameraMode) { return; }
        setCameraMode(on ? QString("fly") : QString("manual"));
        emit cameraModeChanged(on ? QString("fly") : QString("manual"));
    });

    spinAction = row2->addAction(tr("Spin"));
    spinAction->setCheckable(true);
    spinAction->setStatusTip(tr("Turn the cave slowly in front of you"));
    connect(spinAction, &QAction::toggled, [this](bool on) {
        if (settingCameraMode) { return; }
        setCameraMode(on ? QString("spin") : QString("manual"));
        emit cameraModeChanged(on ? QString("spin") : QString("manual"));
    });

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
    // TAKING HOLD OF IT STOPS THE ANIMATION WRITING TO IT. Otherwise
    // the timer goes on setting the value under the caver's hand and
    // the slider fights them for it.
    connect(progressSlider, SIGNAL(sliderPressed()),
            this, SLOT(onScrubStarted()));
    connect(progressSlider, SIGNAL(sliderReleased()),
            this, SLOT(onScrubFinished()));
    row2->addWidget(progressSlider);

    // HOW FAST, and only while something is running. A passage worth
    // looking at closely wants half pace; a long walk between two bits
    // of interest wants three times it.
    speedLabel = new QLabel(tr("Speed"), this);
    speedLabel->setContentsMargins(6, 0, 2, 0);
    speedLabelAction = row2->addWidget(speedLabel);
    speedLabelAction->setVisible(false);

    speedSlider = new QSlider(Qt::Horizontal, this);
    speedSlider->setObjectName("Cave3dSpeedSlider");
    speedSlider->setStatusTip(tr("How fast the camera runs: left is "
                                 "slower, right is faster"));
    // Tenths of the usual pace, from a quarter speed to four times.
    speedSlider->setRange(10, 400);
    speedSlider->setValue(100);
    speedSlider->setMaximumWidth(90);
    connect(speedSlider, &QSlider::valueChanged, [this](int value) {
        emit cameraSpeedChanged(double(value) / 100.0);
    });
    speedSliderAction = row2->addWidget(speedSlider);
    speedSliderAction->setVisible(false);

    playTimer = new QTimer(this);
    playTimer->setInterval(40);
    // SLOW ENOUGH TO WATCH. At forty milliseconds a tick, this many
    // ticks carries the camera from one end to the other in about
    // twenty-four seconds -- a pace a caver can follow down a passage,
    // where the build animation's one-shot-per-tick would be a blur.
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
    // THE SLIDER IS SHARED, so a rebuild must not take it back off the
    // camera. In a camera mode it runs the flight, in one step per
    // thousand; the build animation wants one step per shot. A refresh
    // while flying was resetting it to the shots and the flight went
    // from a thousand steps to sixty.
    bool camera = (view != NULL &&
                   view->getCameraMode() != RCave3dView::CameraManual);
    if (!camera) {
        progressSlider->blockSignals(true);
        progressSlider->setRange(0, qMax(0, steps.size() - 1));
        progressSlider->setValue(qMax(0, steps.size() - 1));
        progressSlider->blockSignals(false);
        progressSlider->setEnabled(steps.size() > 1);
        playAction->setEnabled(steps.size() > 1);
    } else {
        progressSlider->setEnabled(true);
        playAction->setEnabled(true);
    }
    // A NEW MESH SHOWS THE WHOLE CAVE. The animation is a thing you do,
    // never a state the panel is left sitting in -- a half-built cave
    // restored on a rebuild would read as a bug.
    if (view != NULL) {
        view->setProgress(-1, -1);
    }
    if (!camera) {
        // A camera that was running goes on running: the mesh changed
        // under it, not the flight.
        playTimer->stop();
        playAction->setChecked(false);
    }
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

void RCave3dPanel::setCameraMode(const QString& mode) {
    if (view == NULL) {
        return;
    }
    RCave3dView::CameraMode want = RCave3dView::CameraManual;
    if (mode == "fly") { want = RCave3dView::CameraFly; }
    if (mode == "spin") { want = RCave3dView::CameraSpin; }
    view->setCameraMode(want);
    // The view may have refused Fly for want of a path, so the buttons
    // follow what it actually did rather than what was asked for.
    RCave3dView::CameraMode now = view->getCameraMode();
    settingCameraMode = true;
    if (flyAction != NULL) {
        flyAction->setChecked(now == RCave3dView::CameraFly);
    }
    if (spinAction != NULL) {
        spinAction->setChecked(now == RCave3dView::CameraSpin);
    }
    settingCameraMode = false;

    bool running = (now != RCave3dView::CameraManual);
    if (speedLabelAction != NULL) { speedLabelAction->setVisible(running); }
    if (speedSliderAction != NULL) { speedSliderAction->setVisible(running); }

    // The slider means something different in each mode, so it starts
    // again rather than carrying a position from the last one.
    if (progressSlider != NULL && now != RCave3dView::CameraManual) {
        progressSlider->setRange(0, 1000);
        progressSlider->setValue(0);
    }
    cameraT = 0.0;
    view->setCameraProgress(0.0);
}

void RCave3dPanel::setCameraProgress(double t) {
    if (view != NULL) {
        view->setCameraProgress(t);
    }
}

void RCave3dPanel::setCameraSpeed(double factor) {
    if (speedSlider == NULL) {
        return;
    }
    // A MEANINGLESS SPEED IS NOT A SLOW ONE. Clamping a zero -- which
    // is what an unset or unreadable setting hands over -- pins the
    // slider at its slowest, and the slider then saves that back as
    // the caver's preference. Nought is "no answer", so the answer is
    // the usual pace.
    if (!(factor > 0.0) || factor != factor) {
        factor = 1.0;
    }
    int want = int(factor * 100.0 + 0.5);
    speedSlider->setValue(qBound(speedSlider->minimum(), want,
                                 speedSlider->maximum()));
}

double RCave3dPanel::getCameraSpeed() const {
    if (speedSlider == NULL) {
        return 1.0;
    }
    return double(speedSlider->value()) / 100.0;
}

/**
 * The camera to where cameraT says, and the slider to match.
 *
 * The VIEW is driven by the fraction, not by the slider: a thousand
 * steps is coarse enough to show at a crawl, and the slider is only
 * there to say where in the flight this is.
 */
void RCave3dPanel::showCameraT() {
    if (view != NULL) {
        view->setCameraProgress(cameraT);
    }
    if (progressSlider == NULL) {
        return;
    }
    progressSlider->blockSignals(true);
    progressSlider->setValue(int(cameraT * double(progressSlider->maximum())
                                 + 0.5));
    progressSlider->blockSignals(false);
}

void RCave3dPanel::onScrubStarted() {
    scrubbing = true;
    // The animation keeps its button pressed, so letting go carries on
    // from wherever the caver put it.
    if (playTimer != NULL) {
        playTimer->stop();
    }
}

void RCave3dPanel::onScrubFinished() {
    scrubbing = false;
    if (playAction != NULL && playAction->isChecked() && playTimer != NULL) {
        playTimer->start();
    }
}

void RCave3dPanel::setFlyAvailable(bool available) {
    if (flyAction == NULL) {
        return;
    }
    flyAction->setEnabled(available);
    if (!available && flyAction->isChecked()) {
        flyAction->setChecked(false);
    }
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

void RCave3dPanel::setTerrainAvailable(bool available) {
    if (terrainAction == NULL) {
        return;
    }
    terrainAction->setEnabled(available);
    if (terrainContoursAction != NULL) {
        terrainContoursAction->setEnabled(available);
    }
    if (!available) {
        if (terrainAction->isChecked()) {
            terrainAction->setChecked(false);
        }
        if (terrainContoursAction != NULL &&
                terrainContoursAction->isChecked()) {
            terrainContoursAction->setChecked(false);
        }
    }
    syncTerrainVisible();
}

void RCave3dPanel::setShowTerrain(bool on) {
    if (terrainAction != NULL && terrainAction->isEnabled()) {
        terrainAction->setChecked(on);
    }
    syncTerrainVisible();
}

void RCave3dPanel::setShowTerrainContours(bool on) {
    if (terrainContoursAction != NULL &&
            terrainContoursAction->isEnabled()) {
        terrainContoursAction->setChecked(on);
    }
}

void RCave3dPanel::setTerrainOpacity(double value) {
    if (terrainSlider == NULL) {
        return;
    }
    fillingTerrain = true;
    terrainSlider->setValue(int(value * 100.0 + 0.5));
    fillingTerrain = false;
    // Straight to the view as well: the slider clamps into its own
    // range, and the two must not disagree.
    view->setTerrainOpacity(terrainSlider->value() / 100.0);
}

void RCave3dPanel::onTerrainOpacityChanged(int value) {
    view->setTerrainOpacity(value / 100.0);
    if (fillingTerrain) {
        return;
    }
    emit terrainOpacityChanged(value / 100.0);
}

/** The opacity slider belongs to the terrain, so it appears and goes
 *  with it -- and, like the ink slider, is synced as well as connected,
 *  because setChecked on an already-checked action emits nothing. */
void RCave3dPanel::syncTerrainVisible() {
    bool on = (terrainAction != NULL && terrainAction->isEnabled()
               && terrainAction->isChecked());
    if (terrainLabelAction != NULL) { terrainLabelAction->setVisible(on); }
    if (terrainSliderAction != NULL) { terrainSliderAction->setVisible(on); }
}

void RCave3dPanel::onPlayToggled(bool on) {
    if (!on) {
        playTimer->stop();
        return;
    }
    if (view != NULL && view->getCameraMode() != RCave3dView::CameraManual) {
        if (cameraT >= 1.0) {
            cameraT = 0.0;
            showCameraT();
        }
        playTimer->start();
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
    if (scrubbing) {
        return;
    }
    if (view != NULL && view->getCameraMode() != RCave3dView::CameraManual) {
        if (scrubbing) {
            return;             // the caver has hold of it
        }
        double ticks = double(CAMERA_TICKS) / qMax(0.01, getCameraSpeed());
        cameraT += 1.0 / qMax(1.0, ticks);
        if (cameraT >= 1.0) {
            if (view->getCameraMode() == RCave3dView::CameraSpin) {
                // A spin has no end: it comes round again.
                cameraT -= 1.0;
            } else {
                cameraT = 1.0;
                showCameraT();
                playTimer->stop();
                playAction->setChecked(false);
                return;
            }
        }
        showCameraT();
        return;
    }
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
    if (view == NULL) {
        return;
    }
    // IN A CAMERA MODE THE SLIDER IS THE CAMERA. One control, whose
    // meaning follows what it is set to run: where along the flight, or
    // how far round the spin.
    if (view->getCameraMode() != RCave3dView::CameraManual) {
        int span = qMax(1, progressSlider->maximum());
        cameraT = double(value) / double(span);
        view->setCameraProgress(cameraT);
        return;
    }
    if (steps.isEmpty()) {
        return;
    }
    if (value >= steps.size() - 1) {
        view->setProgress(-1, -1);      // the whole cave
        return;
    }
    view->setProgress(steps.at(value).first, steps.at(value).second);
}
