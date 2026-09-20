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
#include "RCave3dView.h"
#include "RCave3dLegend.h"
#include "RCave3dLabels.h"
#include "RCave3dCard.h"
#include "RCave3dTexture.h"

#include <QDebug>
#include <QLinearGradient>
#include <QPainter>
#include <QWindow>
#include <QGuiApplication>
#include <QScreen>
#include <QOpenGLFramebufferObject>
#include <QKeyEvent>
#include <QMouseEvent>
#include <QWheelEvent>
#include <QSurfaceFormat>
#include <QtMath>

namespace {

// The surface shader. One headlight term, and ABS of the dot product
// rather than max(0, ...) on purpose: a passage is looked at from the
// inside at least as often as from the outside, and a one-sided light
// makes the inside of the tube go black just as you fly into it.
const char* SURFACE_VERTEX =
    "attribute highp vec3 aPos;\n"
    "attribute highp vec3 aNormal;\n"
    "attribute lowp vec3 aColor;\n"
    "uniform highp mat4 uMvp;\n"
    "varying highp vec3 vNormal;\n"
    "varying lowp vec3 vColor;\n"
    "void main() {\n"
    "    vNormal = aNormal;\n"
    "    vColor = aColor;\n"
    "    gl_Position = uMvp * vec4(aPos, 1.0);\n"
    "}\n";

const char* SURFACE_FRAGMENT =
    "varying highp vec3 vNormal;\n"
    "varying lowp vec3 vColor;\n"
    "uniform highp vec3 uLightDir;\n"
    "void main() {\n"
    "    highp float lambert = abs(dot(normalize(vNormal), uLightDir));\n"
    "    gl_FragColor = vec4(vColor * (0.35 + 0.65 * lambert), 1.0);\n"
    "}\n";

// The scan pass. Textured, and keyed so only what the pencil darkened
// survives.
const char* SCAN_VERTEX =
    "attribute highp vec3 aPos;\n"
    "attribute highp vec2 aUv;\n"
    "uniform highp mat4 uMvp;\n"
    "varying highp vec2 vUv;\n"
    "void main() {\n"
    "    vUv = aUv;\n"
    "    gl_Position = uMvp * vec4(aPos, 1.0);\n"
    "}\n";

const char* SCAN_FRAGMENT =
    "varying highp vec2 vUv;\n"
    "uniform sampler2D uTex;\n"
    "uniform highp float uInkMax;\n"
    "uniform highp float uInkChroma;\n"
    "uniform highp float uInkFade;\n"
    "void main() {\n"
    "    lowp vec4 c = texture2D(uTex, vUv);\n"
    // NOTHING AT ALL IS NOT INK EITHER. A scan trimmed to a traced
    // outline is a rectangle with everything outside the line made
    // transparent, and a transparent pixel carries RGB 0,0,0 -- the
    // darkest possible pencil as far as the test below is concerned.
    // Without this the masked-away corners come back as solid black
    // sheets hanging over the passage.
    "    if (c.a < 0.5) { discard; }\n"
    // PAPER IS NOT INK. A scan is mostly white page, and drawn whole it
    // is a wall in front of the cave. Discarding everything lighter than
    // the threshold leaves the pencil floating over the passage, which
    // is the only way the sketch and the geometry can be read together.
    "    highp float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));\n"
    "    if (lum > uInkMax) { discard; }\n"
    // A SOFT EDGE, NOT A CLIFF. Scanned pencil does not stop at one
    // grey: a stroke shades off into the paper, and a hard cut turns
    // that into a ragged fringe of speckle that reads as noise. Fading
    // the last stretch before the threshold lets the caver wind the
    // slider down until the grey the scanner invented goes quiet while
    // the stroke itself is still solid.
    "    highp float aInk = clamp((uInkMax - lum) / uInkFade, 0.0, 1.0);\n"
    // NOR IS THE PRINTED GRID. Survey books are printed with a grid --
    // blue on the ones this was written for -- and its lines are dark
    // enough to pass the luminance test, so the sheets came through
    // carrying a mesh of paper ruling over the passage. Pencil is
    // GREY: its red, green and blue stay close together whatever the
    // exposure. Printed ruling is not, so the distance between the
    // channels tells the two apart without caring what colour the
    // ruling is, which keeps green and orange books working too.
    "    highp float hi = max(c.r, max(c.g, c.b));\n"
    "    highp float lo = min(c.r, min(c.g, c.b));\n"
    "    if (hi - lo > uInkChroma) { discard; }\n"
    "    gl_FragColor = vec4(c.rgb, aInk);\n"
    "}\n";

// The surface above the cave: lit like the passage, textured with the
// aerial photograph where there is one, and blended so the cave reads
// through it.
const char* TERRAIN_VERTEX =
    "attribute highp vec3 aPos;\n"
    "attribute highp vec3 aNormal;\n"
    "attribute highp vec2 aUv;\n"
    "uniform highp mat4 uMvp;\n"
    "varying highp vec2 vUv;\n"
    "varying highp vec3 vNormal;\n"
    "void main() {\n"
    "    vUv = aUv;\n"
    "    vNormal = aNormal;\n"
    "    gl_Position = uMvp * vec4(aPos, 1.0);\n"
    "}\n";

const char* TERRAIN_FRAGMENT =
    "varying highp vec2 vUv;\n"
    "varying highp vec3 vNormal;\n"
    "uniform sampler2D uTex;\n"
    "uniform highp float uHasTex;\n"
    "uniform highp float uOpacity;\n"
    "uniform highp vec3 uLightDir;\n"
    "uniform highp vec3 uFlatColor;\n"
    "void main() {\n"
    "    lowp vec3 base = uFlatColor;\n"
    "    if (uHasTex > 0.5) { base = texture2D(uTex, vUv).rgb; }\n"
    // Shaded even under a photograph. An aerial is lit from wherever
    // the sun was that day, which is rarely where the relief reads --
    // a hillside flat-lit by its own texture looks like a rug. The
    // shading is kept gentle so it does not fight the photograph.
    "    highp float shade = 0.60 + 0.40 *\n"
    "        max(dot(normalize(vNormal), normalize(uLightDir)), 0.0);\n"
    "    gl_FragColor = vec4(base * shade, uOpacity);\n"
    "}\n";

const char* LINE_VERTEX =
    "attribute highp vec3 aPos;\n"
    "attribute lowp vec3 aColor;\n"
    "uniform highp mat4 uMvp;\n"
    "varying lowp vec3 vColor;\n"
    "void main() {\n"
    "    vColor = aColor;\n"
    "    gl_Position = uMvp * vec4(aPos, 1.0);\n"
    "}\n";

const char* LINE_FRAGMENT =
    "varying lowp vec3 vColor;\n"
    "void main() {\n"
    "    gl_FragColor = vec4(vColor, 1.0);\n"
    "}\n";

} // namespace

RCave3dView::RCave3dView(QWidget* parent)
    : QOpenGLWidget(parent),
      surfaceProgram(NULL),
      lineProgram(NULL),
      scanProgram(NULL),
      terrainProgram(NULL),
      boundsMin(-1.0f, -1.0f, -1.0f),
      boundsMax(1.0f, 1.0f, 1.0f),
      yaw(0.0f),
      pitch(20.0f),
      distance(10.0f),
      target(0.0f, 0.0f, 0.0f),
      showSurface(true),
      showLines(true),
      showGhost(false),
      orthographic(false),
      showLeads(false),
      showSections(false),
      showScans(false),
      scanInk(RCave3dView::DEFAULT_SCAN_INK),
      terrainTexture(NULL),
      terrainNeedsUpload(false),
      showTerrain(false),
      showTerrainContours(false),
      terrainOpacity(RCave3dView::DEFAULT_TERRAIN_OPACITY),
      cameraMode(RCave3dView::CameraManual), cameraProgress(0.0),
      flyYaw(0.0f), flyPitch(0.0f), spinFromYaw(0.0f),
      scansNeedUpload(false),
      progressTriangles(-1),
      progressLines(-1),
      cameraUntouched(true) {

    // ASK FOR THE CONTEXT EXPLICITLY, rather than taking the platform
    // default.
    //
    // The shaders below are GLSL 1.10 (attribute / varying /
    // gl_FragColor) and the geometry is passed as client-side arrays.
    // Both are legal in a COMPATIBILITY profile and illegal in a core
    // one. Every platform's default happens to be compatibility today
    // -- macOS gives 2.1 legacy unless core 3.2+ is requested, Windows
    // and Mesa give the driver's compatibility profile -- so this
    // currently works everywhere by luck rather than by intent.
    //
    // Saying so out loud means a driver or a Qt version that would
    // otherwise hand back a core context gives a clear failure at
    // creation instead of shaders that will not compile, and it means
    // the same context on Windows and Linux as the one this was
    // developed against.
    QSurfaceFormat fmt;
    fmt.setProfile(QSurfaceFormat::CompatibilityProfile);
    fmt.setVersion(2, 1);
    fmt.setDepthBufferSize(24);
    setFormat(fmt);

    setFocusPolicy(Qt::StrongFocus);
    // Small enough that a dock can be dragged narrow without the
    // panel fighting back.
    setMinimumSize(160, 120);

    // THE LEGEND IS A CHILD WIDGET OVER THE VIEW, not a QPainter pass
    // inside paintGL.
    //
    // The QPainter route is what Qt documents, and it drew NOTHING here
    // -- no warning, no error, with the painter reporting success --
    // whichever order the native-painting block was arranged in. A
    // child widget cannot be defeated by GL state, is ordinary Qt
    // painting, and to the reader is the same thing: a legend floating
    // over the cave, taking no layout space.
    legend = new RCave3dLegend(this);
    legend->show();

    // OVER THE LEGEND'S HEAD, and over the cave: the station names have
    // to be readable against whatever is behind them, which is why they
    // are painted rather than drawn in GL. Hidden until asked for.
    labels = new RCave3dLabels(this);
    card = new RCave3dCard(this);
    // WITHOUT BUTTONS HELD. Qt sends no move events to a widget that
    // has not asked for tracking, so the passage under the cursor
    // would only be found while something was being dragged -- which
    // is the one time a caver is not pointing at anything.
    setMouseTracking(true);
    hoverOutline = -1;
    hoverA = -1;
    hoverB = -1;
    hoverT = 0.0f;
    connect(card, SIGNAL(dismissed()), this, SLOT(onCardDismissed()));
    labels->setShow(false);
}

RCave3dView::~RCave3dView() {
    makeCurrent();
    delete surfaceProgram;
    delete lineProgram;
    delete scanProgram;
    dropScanTextures();
    doneCurrent();
}

void RCave3dView::initializeGL() {
    initializeOpenGLFunctions();

    // CALLED AGAIN EVERY TIME THE CONTEXT IS REMADE, which a dock does
    // whenever it is torn off to float or dropped back in: reparenting
    // a QOpenGLWidget destroys its context and builds a new one.
    //
    // WHATEVER IS STILL HELD HERE IS ALREADY DEAD, and must be FORGOTTEN
    // rather than deleted. A QOpenGLTexture's destructor calls into the
    // context that owned it; run now, against the NEW context, it
    // dereferences a freed one and takes the application down --
    // measured, EXC_BAD_ACCESS in QOpenGLTexturePrivate::destroy() on
    // the first float. The real destruction happens in
    // onContextAboutToBeDestroyed, while the owning context is still
    // alive to destroy them against.
    surfaceProgram = NULL;
    lineProgram = NULL;
    scanProgram = NULL;
    terrainProgram = NULL;
    forgetScanTextures();
    forgetTerrainTexture();
    scansNeedUpload = !scanPaths.isEmpty();
    terrainNeedsUpload = !terrainTexturePath.isEmpty();

    if (context() != NULL) {
        connect(context(), SIGNAL(aboutToBeDestroyed()),
                this, SLOT(onContextAboutToBeDestroyed()),
                Qt::DirectConnection);
    }

    glEnable(GL_DEPTH_TEST);
    // Backface culling stays OFF. A passage is a tube seen from inside
    // as often as outside, and culling would open a hole in the wall
    // every time the camera sat in the passage rather than above it.
    glDisable(GL_CULL_FACE);
    glClearColor(0.09f, 0.09f, 0.11f, 1.0f);

    surfaceProgram = new QOpenGLShaderProgram();
    surfaceProgram->addShaderFromSourceCode(QOpenGLShader::Vertex,
                                            SURFACE_VERTEX);
    surfaceProgram->addShaderFromSourceCode(QOpenGLShader::Fragment,
                                            SURFACE_FRAGMENT);
    surfaceProgram->bindAttributeLocation("aPos", 0);
    surfaceProgram->bindAttributeLocation("aNormal", 1);
    surfaceProgram->bindAttributeLocation("aColor", 2);
    if (!surfaceProgram->link()) {
        // A shader that fails to link draws NOTHING, and an empty 3D
        // window looks exactly like a cave with no survey in it. Say
        // which of the two it is.
        qWarning() << "RCave3dView: passage shader did not link:"
                   << surfaceProgram->log();
    }

    lineProgram = new QOpenGLShaderProgram();
    lineProgram->addShaderFromSourceCode(QOpenGLShader::Vertex, LINE_VERTEX);
    lineProgram->addShaderFromSourceCode(QOpenGLShader::Fragment,
                                         LINE_FRAGMENT);
    lineProgram->bindAttributeLocation("aPos", 0);
    lineProgram->bindAttributeLocation("aColor", 1);
    if (!lineProgram->link()) {
        qWarning() << "RCave3dView: centerline shader did not link:"
                   << lineProgram->log();
    }

    scanProgram = new QOpenGLShaderProgram();
    scanProgram->addShaderFromSourceCode(QOpenGLShader::Vertex, SCAN_VERTEX);
    scanProgram->addShaderFromSourceCode(QOpenGLShader::Fragment,
                                         SCAN_FRAGMENT);
    scanProgram->bindAttributeLocation("aPos", 0);
    scanProgram->bindAttributeLocation("aUv", 1);
    if (!scanProgram->link()) {
        qWarning() << "RCave3dView: scan shader did not link:"
                   << scanProgram->log();
    }

    terrainProgram = new QOpenGLShaderProgram();
    terrainProgram->addShaderFromSourceCode(QOpenGLShader::Vertex,
                                            TERRAIN_VERTEX);
    terrainProgram->addShaderFromSourceCode(QOpenGLShader::Fragment,
                                            TERRAIN_FRAGMENT);
    terrainProgram->bindAttributeLocation("aPos", 0);
    terrainProgram->bindAttributeLocation("aNormal", 1);
    terrainProgram->bindAttributeLocation("aUv", 2);
    if (!terrainProgram->link()) {
        qWarning() << "RCave3dView: terrain shader did not link:"
                   << terrainProgram->log();
    }

    uploadScanTextures();
    uploadTerrainTexture();
}

void RCave3dView::resizeGL(int w, int h) {
    glViewport(0, 0, w, qMax(1, h));
    layOutLegend();
    if (cameraUntouched) {
        // Re-fit rather than keep a distance computed for a different
        // aspect ratio. viewAll does not itself count as the caver
        // touching the camera, so this does not become self-sustaining.
        viewAll();
    }
}

void RCave3dView::cameraBasis(QVector3D& forward, QVector3D& right,
                              QVector3D& up) const {
    float yawRad = qDegreesToRadians(yaw);
    float pitchRad = qDegreesToRadians(pitch);
    // The direction the camera looks, which is the negative of the
    // offset cameraMatrix puts the eye at.
    forward = QVector3D(-std::cos(pitchRad) * std::sin(yawRad),
                        std::cos(pitchRad) * std::cos(yawRad),
                        -std::sin(pitchRad));
    right = QVector3D::crossProduct(forward, QVector3D(0.0f, 0.0f, 1.0f));
    if (right.lengthSquared() < 1e-12f) {
        // Straight up or straight down: every horizontal direction is
        // equally "right", so pick one and be consistent.
        right = QVector3D(1.0f, 0.0f, 0.0f);
    }
    right.normalize();
    up = QVector3D::crossProduct(right, forward).normalized();
}

/**
 * How much world a pixel covers at the distance being looked at.
 *
 * THE ONE NUMBER A PAN NEEDS. Dragging should carry the cave along
 * under the cursor, and that is true only when a pixel of mouse buys
 * exactly a pixel of world -- which depends on the field of view and on
 * HOW TALL THE VIEW IS, not on a constant. The constant this replaced
 * (distance * 0.002) happens to be right at a view 414 pixels tall and
 * nowhere else: in a docked panel it ran about half again too fast, and
 * in a full-screen window nearly three times, so the cave shot out from
 * under the cursor exactly when a caver had zoomed in to place it
 * carefully.
 */
float RCave3dView::worldPerPixel() const {
    float tanHalf = std::tan(qDegreesToRadians(FOV_DEGREES * 0.5f));
    return 2.0f * tanHalf * distance / float(qMax(1, height()));
}

void RCave3dView::setFlyPath(const QVector<float>& points,
                             const QVector<int>& breaks,
                             const QVector<int>& turns) {
    flyPoints = points;
    flyBreaks = breaks;
    flyTurns = turns;
    if (!hasFlyPath() && cameraMode == CameraFly) {
        setCameraMode(CameraManual);
    }
    update();
}

void RCave3dView::setCameraMode(CameraMode mode) {
    if (mode == CameraFly && !hasFlyPath()) {
        mode = CameraManual;
    }
    if (mode == cameraMode) {
        return;
    }
    if (mode == CameraFly) {
        // Start looking straight down the passage, not wherever the
        // caver happened to have the camera pointed.
        flyYaw = 0.0f;
        flyPitch = 0.0f;
    }
    if (mode == CameraSpin) {
        // Turn from where they left it: snapping to north first would
        // throw away the view they chose to spin.
        spinFromYaw = yaw;
    }
    cameraMode = mode;
    // Neither mode is the caver placing the camera, so a rebuild is
    // still free to reframe afterwards.
    update();
}

void RCave3dView::setCameraProgress(double t) {
    if (t < 0.0) { t = 0.0; }
    if (t > 1.0) { t = 1.0; }
    cameraProgress = t;
    update();
}

/** The point on the path at sample index i, clamped to the ends. */
static QVector3D flyPointAt(const QVector<float>& pts, int i) {
    int count = pts.size() / 3;
    if (count <= 0) {
        return QVector3D(0, 0, 0);
    }
    if (i < 0) { i = 0; }
    if (i > count - 1) { i = count - 1; }
    return QVector3D(pts.at(i * 3), pts.at(i * 3 + 1), pts.at(i * 3 + 2));
}

/**
 * A CATMULL-ROM point along the path, rather than a corner of it.
 *
 * The samples are evenly spaced points ON the centreline, and a camera
 * put straight onto them travels in straight lines and turns all at
 * once at each station -- which is the jerk. A spline through the same
 * points passes through every one of them and curves between, so the
 * camera leans into a bend the way a caver's head does.
 */
static QVector3D flyCurve(const QVector<float>& pts, double at) {
    int count = pts.size() / 3;
    if (count < 2) {
        return flyPointAt(pts, 0);
    }
    if (at < 0.0) { at = 0.0; }
    if (at > double(count - 1)) { at = double(count - 1); }
    int i = int(at);
    if (i > count - 2) { i = count - 2; }
    float f = float(at - double(i));
    QVector3D p0 = flyPointAt(pts, i - 1);
    QVector3D p1 = flyPointAt(pts, i);
    QVector3D p2 = flyPointAt(pts, i + 1);
    QVector3D p3 = flyPointAt(pts, i + 2);
    float f2 = f * f;
    float f3 = f2 * f;
    return 0.5f * ((2.0f * p1) +
                   (-p0 + p2) * f +
                   (2.0f * p0 - 5.0f * p1 + 4.0f * p2 - p3) * f2 +
                   (-p0 + 3.0f * p1 - 3.0f * p2 + p3) * f3);
}

/** How far ahead the camera looks, in samples. */
static const double LOOK_AHEAD = 3.0;

/** Samples' worth of time spent standing still and turning round at a
 *  dead end. At the animation's pace this is a little under a second --
 *  long enough to read as turning to look back, short enough not to
 *  feel like a stall. */
static const double TURN_PAUSE = 14.0;

/** The way the path runs at `at`, looking forward but not past `stop`. */
static QVector3D flyHeading(const QVector<float>& pts, double at,
                            double stop) {
    double to = qMin(at + LOOK_AHEAD, stop);
    QVector3D dir = flyCurve(pts, to) - flyCurve(pts, at);
    if (dir.lengthSquared() < 1e-12f) {
        dir = flyCurve(pts, at) - flyCurve(pts, qMax(0.0, at - LOOK_AHEAD));
    }
    if (dir.lengthSquared() < 1e-12f) {
        return QVector3D(0, 1, 0);
    }
    return dir.normalized();
}

/**
 * Where on the flight progress `t` sits, and which way it faces.
 *
 * IT STOPS AND TURNS ROUND AT A DEAD END. The tour walks out to the end
 * of a branch and back the way it came, so the path reverses on itself
 * there -- and a camera carried straight through reverses with it,
 * flipping a hundred and eighty degrees between one frame and the next.
 * Measured before this: eighteen degrees of turn in a typical step and
 * a hundred and eighty in the worst.
 *
 * So the flight spends TURN_PAUSE of its time standing at each of those
 * stations, swinging its view from the way it came to the way it is
 * going, which is what a caver does at the end of a lead.
 */
static void flySample(const QVector<float>& pts, const QVector<int>& turns,
                      double t, QVector3D& eye, QVector3D& ahead) {
    int count = pts.size() / 3;
    if (count < 2) {
        eye = QVector3D(0, 0, 0);
        ahead = QVector3D(0, 1, 0);
        return;
    }

    double last = double(count - 1);
    double total = last + double(turns.size()) * TURN_PAUSE;
    double left = qBound(0.0, t, 1.0) * total;

    double from = 0.0;
    for (int i = 0; i <= turns.size(); i++) {
        double next = (i < turns.size()) ? double(turns.at(i)) : last;
        double travel = next - from;
        if (left <= travel || i == turns.size()) {
            double at = qMin(from + left, last);
            eye = flyCurve(pts, at);
            ahead = flyHeading(pts, at, next);
            return;
        }
        left -= travel;
        if (left <= TURN_PAUSE) {
            // Standing at the turn, looking round.
            eye = flyCurve(pts, next);
            QVector3D came = flyHeading(pts, qMax(0.0, next - LOOK_AHEAD),
                                        next);
            QVector3D going = flyHeading(pts, next, last);
            float u = float(left / TURN_PAUSE);
            // Eased, so the head starts and finishes the turn gently
            // rather than snapping into it.
            u = u * u * (3.0f - 2.0f * u);
            QVector3D mix = came * (1.0f - u) + going * u;
            if (mix.lengthSquared() < 1e-6f) {
                // Exactly opposite: pick a way round rather than
                // dividing by nothing.
                QVector3D side = QVector3D::crossProduct(came,
                    QVector3D(0.0f, 0.0f, 1.0f));
                if (side.lengthSquared() < 1e-9f) {
                    side = QVector3D(1.0f, 0.0f, 0.0f);
                }
                mix = side;
            }
            ahead = mix.normalized();
            return;
        }
        left -= TURN_PAUSE;
        from = next;
    }
    eye = flyCurve(pts, last);
    ahead = flyHeading(pts, last, last);
}

QMatrix4x4 RCave3dView::cameraMatrix() const {
    float aspect = float(width()) / float(qMax(1, height()));

    float span = (boundsMax - boundsMin).length();
    if (span < 1e-3f) {
        span = 1.0f;
    }
    // NEAR TRACKS THE CAMERA, not the model. Tied to the model it was
    // fixed at a thousandth of the cave's own size -- on a cave 788
    // units across that is a near plane at 0.79, so zooming closer than
    // about a foot and a half of passage put the passage INSIDE it and
    // the front of what the caver was looking at simply went away.
    //
    // Far still reaches past the model, so the rest of the cave is
    // behind whatever is being examined rather than cut off. The floor
    // under near keeps the near:far ratio inside what a depth buffer
    // can hold when the camera is right up against the wall.
    float near = qMax(distance * 0.01f, span * 1e-4f);
    float far = distance + span * 3.0f;
    if (far <= near) {
        far = near * 1000.0f;
    }
    QMatrix4x4 projection;
    if (orthographic && cameraMode != CameraFly) {
        // MATCHED AT THE TARGET. Half the height the perspective
        // frustum spans where the caver is actually looking, so
        // switching projection does not change how big the cave
        // appears -- only whether the far end of it converges.
        float half = distance *
            std::tan(qDegreesToRadians(FOV_DEGREES * 0.5f));
        if (half < 1e-4f) {
            half = 1e-4f;
        }
        // The depth range has to reach BEHIND the eye as well: a
        // parallel projection has no vanishing point pulling the near
        // half of the cave in front of the camera, so geometry between
        // the eye and the target plane sits at negative depth and is
        // clipped away by a near plane at zero.
        projection.ortho(-half * aspect, half * aspect, -half, half,
                         -(distance + span * 3.0f), distance + span * 3.0f);
    } else {
        projection.perspective(FOV_DEGREES, aspect, near, far);
    }

    float useYaw = yaw;
    if (cameraMode == CameraSpin) {
        // A SLOW TURN ROUND THE CAVE, which is what a cave is usually
        // shown doing: one whole revolution over the length of the
        // animation, so an exported loop joins up with itself.
        useYaw = spinFromYaw + float(cameraProgress) * 360.0f;
    }

    QVector3D eyeNow, lookNow;
    computeCamera(eyeNow, lookNow);
    lastEye = eyeNow;
    lastLook = lookNow;

    if (cameraMode == CameraFly && hasFlyPath()) {
        // DOWN THE PASSAGE, from inside it. The eye rides the
        // centreline and looks along it, with whatever the caver has
        // dragged added on top so they can look about without stopping.
        QMatrix4x4 flyView;
        flyView.lookAt(eyeNow, eyeNow + lookNow,
                       QVector3D(0.0f, 0.0f, 1.0f));
        return projection * flyView;
    }

    float yawRad = qDegreesToRadians(useYaw);
    float pitchRad = qDegreesToRadians(pitch);
    QVector3D eye(
        target.x() + distance * std::cos(pitchRad) * std::sin(yawRad),
        target.y() - distance * std::cos(pitchRad) * std::cos(yawRad),
        target.z() + distance * std::sin(pitchRad));

    QMatrix4x4 view;
    view.lookAt(eye, target, QVector3D(0.0f, 0.0f, 1.0f));
    return projection * view;
}

void RCave3dView::paintGL() {
    QMatrix4x4 mvp = cameraMatrix();

    // The one place that knows the camera has moved. The labels are a
    // child widget and repaint themselves; this only tells them where
    // the cave is now.
    if (labels != NULL) {
        labels->setCamera(mvp);
    }
    layOutCard();
    drawScene(mvp);
}

/**
 * Everything in the cave, into whatever is currently bound.
 *
 * SEPARATE FROM paintGL so an export can draw the same scene into an
 * offscreen buffer. Reading the on-screen one back does not work: both
 * grabFramebuffer() and a widget grab came back the colour of the
 * background, the right size and nothing in them.
 */
void RCave3dView::drawScene(const QMatrix4x4& mvp) {
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

    if (showSurface && !trianglePositions.isEmpty() &&
            surfaceProgram != NULL && surfaceProgram->isLinked()) {
        surfaceProgram->bind();
        surfaceProgram->setUniformValue("uMvp", mvp);
        surfaceProgram->setUniformValue("uLightDir",
                                        QVector3D(0.3f, 0.4f, 0.87f));
        surfaceProgram->enableAttributeArray(0);
        surfaceProgram->enableAttributeArray(1);
        surfaceProgram->enableAttributeArray(2);
        surfaceProgram->setAttributeArray(0, trianglePositions.constData(), 3);
        surfaceProgram->setAttributeArray(1, triangleNormals.constData(), 3);
        surfaceProgram->setAttributeArray(2, triangleColors.constData(), 3);
        int triVerts = trianglePositions.size() / 3;
        if (progressTriangles >= 0 && progressTriangles < triVerts) {
            triVerts = progressTriangles;
        }
        // A triangle needs all three of its vertices, so a prefix that
        // ends mid-triangle draws a torn one.
        triVerts -= triVerts % 3;
        glDrawArrays(GL_TRIANGLES, 0, triVerts);
        surfaceProgram->disableAttributeArray(0);
        surfaceProgram->disableAttributeArray(1);
        surfaceProgram->disableAttributeArray(2);
        surfaceProgram->release();
    }

    if (showLines && !linePositions.isEmpty() &&
            lineProgram != NULL && lineProgram->isLinked()) {
        lineProgram->bind();
        lineProgram->setUniformValue("uMvp", mvp);
        lineProgram->enableAttributeArray(0);
        lineProgram->enableAttributeArray(1);
        lineProgram->setAttributeArray(0, linePositions.constData(), 3);
        lineProgram->setAttributeArray(1, lineColors.constData(), 3);
        int lineVerts = linePositions.size() / 3;
        if (progressLines >= 0 && progressLines < lineVerts) {
            lineVerts = progressLines;
        }
        lineVerts -= lineVerts % 2;
        glDrawArrays(GL_LINES, 0, lineVerts);
        lineProgram->disableAttributeArray(0);
        lineProgram->disableAttributeArray(1);
        lineProgram->release();
    }

    // The ghost and the lead markers share the line shader and are NOT
    // clamped by progress. The ghost is the survey as recorded, not the
    // survey being built, and clipping it would imply the raw network
    // grows too; a lead is a fact about the finished cave.
    drawFlatLines(mvp, ghostPositions, ghostColors, showGhost);
    drawFlatLines(mvp, leadPositions, leadColors, showLeads);
    drawFlatLines(mvp, sectionPositions, sectionColors, showSections);

    drawScans(mvp);

    // LAST, AND OVER EVERYTHING. The surface is transparent, so it has
    // to be blended against a scene that is already drawn -- and it is
    // the one thing here that is genuinely above the cave.
    drawTerrain(mvp);

    // WHILE FLYING ONLY. Orbiting the cave from outside, a ring round
    // one station is a hoop in mid air that says nothing.
    if (cameraMode == CameraFly) {
        QVector3D outlineEye, outlineLook;
        computeCamera(outlineEye, outlineLook);
        drawOutline(mvp, outlineEye, outlineLook);
    }

    // THE SECTION UNDER THE CURSOR, from outside. The hoop in mid air
    // that says nothing while orbiting says everything when the caver
    // put the cursor there themselves: it is the answer to "what is
    // the passage doing HERE", which is the one question the outside
    // of a tube cannot answer.
    if (hoverA >= 0 && hoverB >= 0) {
        drawTubeRing(mvp, hoverA, hoverB, hoverT, QColor(255, 190, 60),
                     2.6f);
    } else if (hoverOutline >= 0) {
        drawOutlineRing(mvp, hoverOutline, QColor(255, 190, 60), 2.6f);
    }
}

void RCave3dView::onContextAboutToBeDestroyed() {
    // Still current here, so these are safe to destroy.
    makeCurrent();
    delete surfaceProgram;
    surfaceProgram = NULL;
    delete lineProgram;
    lineProgram = NULL;
    delete scanProgram;
    scanProgram = NULL;
    delete terrainProgram;
    terrainProgram = NULL;
    dropScanTextures();
    dropTerrainTexture();
    doneCurrent();
}

/** Lets go of textures whose context has already gone, WITHOUT calling
 *  into GL. See initializeGL. */
void RCave3dView::forgetScanTextures() {
    scanTextures.clear();
}

void RCave3dView::dropScanTextures() {
    for (int i = 0; i < scanTextures.size(); i++) {
        delete scanTextures.at(i);
    }
    scanTextures.clear();
}

void RCave3dView::uploadScanTextures() {
    dropScanTextures();
    for (int i = 0; i < scanPaths.size(); i++) {
        RCave3dTexture* t = new RCave3dTexture(scanPaths.at(i));
        if (!t->upload()) {
            qWarning() << "RCave3dView: could not load scan"
                       << scanPaths.at(i);
        }
        scanTextures.append(t);
    }
    scansNeedUpload = false;
}

void RCave3dView::drawScans(const QMatrix4x4& mvp) {
    if (!showScans || scanIndices.isEmpty() || scanProgram == NULL ||
            !scanProgram->isLinked()) {
        return;
    }
    if (scansNeedUpload) {
        uploadScanTextures();
    }

    // BLENDED, AND NOT WRITING DEPTH. Two sketches overlapping the same
    // passage would otherwise z-fight into a shimmering mess, and a
    // sketch is an overlay on the cave rather than part of its solid
    // shape.
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    glDepthMask(GL_FALSE);

    scanProgram->bind();
    scanProgram->setUniformValue("uMvp", mvp);
    scanProgram->setUniformValue("uInkMax", GLfloat(scanInk));
    // How wide the fade below the threshold is. Fixed rather than a
    // second slider: one control the caver can turn until the sheet
    // looks right is worth more than two that interact.
    scanProgram->setUniformValue("uInkFade", GLfloat(0.25f));
    // How far the colour channels may drift apart before a pixel counts
    // as printed ruling rather than pencil. Loose enough to keep pencil
    // that a warm scanner has tinted, tight enough to drop the grid.
    scanProgram->setUniformValue("uInkChroma", GLfloat(0.16f));
    scanProgram->setUniformValue("uTex", 0);
    scanProgram->enableAttributeArray(0);
    scanProgram->enableAttributeArray(1);
    scanProgram->setAttributeArray(0, scanPositions.constData(), 3);
    scanProgram->setAttributeArray(1, scanUvs.constData(), 2);

    int at = 0;
    for (int i = 0; i < scanRuns.size(); i++) {
        int count = scanRuns.at(i);
        if (count <= 0 || at + count > scanIndices.size()) {
            at += count;
            continue;
        }
        if (i < scanTextures.size() && scanTextures.at(i)->bind()) {
            glDrawElements(GL_TRIANGLES, count, GL_UNSIGNED_INT,
                           scanIndices.constData() + at);
        }
        at += count;
    }

    scanProgram->disableAttributeArray(0);
    scanProgram->disableAttributeArray(1);
    scanProgram->release();

    glDepthMask(GL_TRUE);
    glDisable(GL_BLEND);
}

/** See initializeGL: a texture whose context has gone is forgotten,
 *  never deleted. */
void RCave3dView::forgetTerrainTexture() {
    terrainTexture = NULL;
}

void RCave3dView::dropTerrainTexture() {
    delete terrainTexture;
    terrainTexture = NULL;
}

void RCave3dView::uploadTerrainTexture() {
    dropTerrainTexture();
    terrainNeedsUpload = false;
    if (terrainTexturePath.isEmpty()) {
        return;
    }
    terrainTexture = new RCave3dTexture(terrainTexturePath);
    if (!terrainTexture->upload()) {
        // Not fatal: the mesh still draws, shaded, with no photograph
        // on it. Say which of the two the caver is looking at.
        qWarning() << "RCave3dView: could not load the aerial photograph"
                   << terrainTexturePath;
    }
}

void RCave3dView::drawTerrain(const QMatrix4x4& mvp) {
    if (!showTerrain || terrainIndices.isEmpty()) {
        return;
    }
    if (terrainNeedsUpload) {
        uploadTerrainTexture();
    }

    if (terrainProgram != NULL && terrainProgram->isLinked()) {
        // BLENDED, AND NOT WRITING DEPTH. Depth TESTING stays on, so
        // anything genuinely in front of the hillside still covers it --
        // but a transparent surface that wrote depth would stop the
        // cave behind it from ever being drawn, which is the whole
        // reason the surface is transparent.
        glEnable(GL_BLEND);
        glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
        glDepthMask(GL_FALSE);

        bool textured = (terrainTexture != NULL && terrainTexture->bind());
        terrainProgram->bind();
        terrainProgram->setUniformValue("uMvp", mvp);
        terrainProgram->setUniformValue("uLightDir",
                                        QVector3D(0.3f, 0.4f, 0.87f));
        terrainProgram->setUniformValue("uOpacity",
                                        GLfloat(terrainOpacity));
        terrainProgram->setUniformValue("uHasTex",
                                        GLfloat(textured ? 1.0f : 0.0f));
        // The ground with no photograph over it: a dry, pale earth that
        // reads as surface rather than as more cave.
        terrainProgram->setUniformValue("uFlatColor",
                                        QVector3D(0.55f, 0.50f, 0.42f));
        terrainProgram->setUniformValue("uTex", 0);
        terrainProgram->enableAttributeArray(0);
        terrainProgram->enableAttributeArray(1);
        terrainProgram->enableAttributeArray(2);
        terrainProgram->setAttributeArray(0, terrainPositions.constData(), 3);
        terrainProgram->setAttributeArray(1, terrainNormals.constData(), 3);
        terrainProgram->setAttributeArray(2, terrainUvs.constData(), 2);
        glDrawElements(GL_TRIANGLES, terrainIndices.size(),
                       GL_UNSIGNED_INT, terrainIndices.constData());
        terrainProgram->disableAttributeArray(0);
        terrainProgram->disableAttributeArray(1);
        terrainProgram->disableAttributeArray(2);
        terrainProgram->release();

        glDepthMask(GL_TRUE);
        glDisable(GL_BLEND);
    }

    // The contour lines go on at full strength, after the surface and
    // writing depth like any other line: they are the one part of the
    // terrain that has to stay readable at every opacity, including
    // zero, where they are all that is left of the hillside.
    drawFlatLines(mvp, terrainLinePositions, terrainLineColors,
                  showTerrainContours);
}

void RCave3dView::setTerrain(const QVector<float>& positions,
                             const QVector<float>& normals,
                             const QVector<float>& uvs,
                             const QVector<int>& indices,
                             const QString& texture) {
    terrainPositions = positions;
    terrainNormals = normals;
    terrainUvs = uvs;
    terrainIndices = indices;
    if (texture != terrainTexturePath) {
        terrainTexturePath = texture;
        terrainNeedsUpload = true;
    }
    update();
}

void RCave3dView::setTerrainLines(const QVector<float>& positions,
                                  const QVector<float>& colors) {
    terrainLinePositions = positions;
    terrainLineColors = colors;
    update();
}

void RCave3dView::setShowTerrain(bool on) {
    showTerrain = on;
    update();
}

void RCave3dView::setShowTerrainContours(bool on) {
    showTerrainContours = on;
    update();
}

void RCave3dView::setTerrainOpacity(double value) {
    if (value < 0.0) {
        value = 0.0;
    }
    if (value > 1.0) {
        value = 1.0;
    }
    terrainOpacity = value;
    update();
}

void RCave3dView::setScans(const QVector<float>& positions,
                           const QVector<float>& uvs,
                           const QVector<int>& indices,
                           const QStringList& paths,
                           const QVector<int>& runs) {
    scanPositions = positions;
    scanUvs = uvs;
    scanIndices = indices;
    scanPaths = paths;
    scanRuns = runs;
    scansNeedUpload = true;
    update();
}

void RCave3dView::setShowScans(bool on) {
    showScans = on;
    update();
}

const float RCave3dView::FOV_DEGREES = 45.0f;

const double RCave3dView::DEFAULT_SCAN_INK = 0.62;

// Half solid: enough of the photograph to recognise the ground, enough
// through it to see the cave under the hill. The caver changes it; this
// is only where the slider starts.
const double RCave3dView::DEFAULT_TERRAIN_OPACITY = 0.5;
const double RCave3dView::MIN_SCAN_INK = 0.20;
const double RCave3dView::MAX_SCAN_INK = 0.95;

void RCave3dView::setScanInk(double value) {
    double v = value;
    if (v < MIN_SCAN_INK) { v = MIN_SCAN_INK; }
    if (v > MAX_SCAN_INK) { v = MAX_SCAN_INK; }
    if (v == scanInk) {
        return;
    }
    scanInk = v;
    update();
}

void RCave3dView::drawFlatLines(const QMatrix4x4& mvp,
                                const QVector<float>& positions,
                                const QVector<float>& colors,
                                bool visible) {
    if (!visible || positions.isEmpty() || lineProgram == NULL ||
            !lineProgram->isLinked()) {
        return;
    }
    lineProgram->bind();
    lineProgram->setUniformValue("uMvp", mvp);
    lineProgram->enableAttributeArray(0);
    lineProgram->enableAttributeArray(1);
    lineProgram->setAttributeArray(0, positions.constData(), 3);
    lineProgram->setAttributeArray(1, colors.constData(), 3);
    glDrawArrays(GL_LINES, 0, positions.size() / 3);
    lineProgram->disableAttributeArray(0);
    lineProgram->disableAttributeArray(1);
    lineProgram->release();
}

/** Puts the legend in the bottom-left corner, at whatever size its
 *  contents need. */
void RCave3dView::setOutlines(const QVector<float>& positions,
                              const QVector<int>& counts,
                              const QVector<float>& centres,
                              const QVector<int>& legs) {
    outlinePositions = positions;
    outlineCounts = counts;
    outlineCentres = centres;
    outlineLegs = legs;
    hoverOutline = -1;
    hoverA = -1;
    hoverB = -1;
    update();
}

/**
 * The cross section the camera is standing in, drawn white.
 *
 * ONE RING, THE NEAREST. Drawing them all would be a tunnel of hoops
 * and would tell a caver nothing about where they are; drawing the one
 * they are inside says how wide and how high the passage is around
 * them, which is the thing a tube seen from within cannot show.
 *
 * OVER EVERYTHING, depth test off: the ring sits on the wall by
 * definition, so half of it is always inside the geometry and would
 * otherwise be eaten by it.
 */
/** How near the cursor a cross section has to be. Wider than the
 *  station pick: a caver hovering over a passage is pointing at the
 *  passage, not at a station, and the nearest section is the answer
 *  however roughly they point. */
static const int HOVER_RADIUS_PX = 45;

int RCave3dView::outlineAt(const QPoint& pos) const {
    if (outlineCounts.isEmpty() || outlineCentres.isEmpty()) {
        return -1;
    }
    QMatrix4x4 mvp = cameraMatrix();
    int best = -1;
    float bestDist = float(HOVER_RADIUS_PX * HOVER_RADIUS_PX) + 1.0f;
    float bestDepth = 0.0f;
    for (int i = 0; i < outlineCounts.size(); i++) {
        if (i * 3 + 2 >= outlineCentres.size()) {
            break;
        }
        QVector3D c(outlineCentres.at(i * 3), outlineCentres.at(i * 3 + 1),
                    outlineCentres.at(i * 3 + 2));
        QVector4D clip = mvp * QVector4D(c, 1.0f);
        if (clip.w() <= 0.0f) {
            continue;                       // behind the eye
        }
        float sx = (clip.x() / clip.w() * 0.5f + 0.5f) * width();
        float sy = (1.0f - (clip.y() / clip.w() * 0.5f + 0.5f)) * height();
        float dx = sx - pos.x();
        float dy = sy - pos.y();
        float d2 = dx * dx + dy * dy;
        if (d2 > float(HOVER_RADIUS_PX * HOVER_RADIUS_PX)) {
            continue;
        }
        float depth = clip.z() / clip.w();
        // NEAREST THE CURSOR, then nearest the eye. Two sections the
        // same distance away on screen are one passage over another,
        // and the near one is the one being looked at.
        if (best < 0 || d2 < bestDist - 1e-3f ||
                (qAbs(d2 - bestDist) <= 1e-3f && depth < bestDepth)) {
            best = i;
            bestDist = d2;
            bestDepth = depth;
        }
    }
    return best;
}

bool RCave3dView::tubeAt(const QPoint& pos, int& a, int& b,
                         float& t) const {
    a = -1;
    b = -1;
    t = 0.0f;
    if (outlineLegs.size() < 2 || outlineCentres.isEmpty()) {
        return false;
    }
    QMatrix4x4 mvp = cameraMatrix();

    // Project every section centre once: a cave's legs share their
    // ends, so projecting per leg would do the same arithmetic twice
    // for every station in the cave on every mouse move.
    int sections = outlineCentres.size() / 3;
    QVector<QPointF> screen(sections);
    QVector<float> depth(sections);
    QVector<bool> visible(sections);
    for (int i = 0; i < sections; i++) {
        QVector3D c(outlineCentres.at(i * 3), outlineCentres.at(i * 3 + 1),
                    outlineCentres.at(i * 3 + 2));
        QVector4D clip = mvp * QVector4D(c, 1.0f);
        visible[i] = (clip.w() > 0.0f);
        if (!visible.at(i)) {
            continue;
        }
        screen[i] = QPointF(
            (clip.x() / clip.w() * 0.5f + 0.5f) * width(),
            (1.0f - (clip.y() / clip.w() * 0.5f + 0.5f)) * height());
        depth[i] = clip.z() / clip.w();
    }

    float bestDist = float(HOVER_RADIUS_PX * HOVER_RADIUS_PX) + 1.0f;
    float bestDepth = 0.0f;
    for (int li = 0; li + 1 < outlineLegs.size(); li += 2) {
        int ia = outlineLegs.at(li);
        int ib = outlineLegs.at(li + 1);
        if (ia < 0 || ib < 0 || ia >= sections || ib >= sections) {
            continue;
        }
        if (!visible.at(ia) || !visible.at(ib)) {
            // A leg with one end behind the eye is one the caver is
            // standing inside. Its projection is meaningless, so it
            // does not compete.
            continue;
        }
        QPointF pa = screen.at(ia);
        QPointF pb = screen.at(ib);
        QPointF ab = pb - pa;
        float len2 = float(ab.x() * ab.x() + ab.y() * ab.y());
        float u = 0.0f;
        if (len2 > 1e-6f) {
            QPointF ap = QPointF(pos) - pa;
            u = float((ap.x() * ab.x() + ap.y() * ab.y()) / len2);
            u = qBound(0.0f, u, 1.0f);
        }
        QPointF on = pa + ab * qreal(u);
        float dx = float(on.x() - pos.x());
        float dy = float(on.y() - pos.y());
        float d2 = dx * dx + dy * dy;
        if (d2 > float(HOVER_RADIUS_PX * HOVER_RADIUS_PX)) {
            continue;
        }
        float d = depth.at(ia) + (depth.at(ib) - depth.at(ia)) * u;
        if (a < 0 || d2 < bestDist - 1e-3f ||
                (qAbs(d2 - bestDist) <= 1e-3f && d < bestDepth)) {
            a = ia;
            b = ib;
            t = u;
            bestDist = d2;
            bestDepth = d;
        }
    }
    return a >= 0;
}

namespace {

/** One ring, as offsets from its centre with the angle of each about
 *  the passage's own axis. */
struct RingSample {
    QVector<float> angle;
    QVector<QVector3D> offset;
};

/** The offset at an angle, interpolated between the two measured wall
 *  points either side of it -- which is exactly how CsMesh3d's loft
 *  matches two rings up, and for the same reason: two stations rarely
 *  have the same number of wall points, and pairing them by list order
 *  joins one station's floor to the next one's ceiling. */
QVector3D offsetAtAngle(const RingSample& ring, float want) {
    if (ring.angle.isEmpty()) {
        return QVector3D();
    }
    int n = ring.angle.size();
    int best = 0;
    float bestGap = 0.0f;
    for (int i = 0; i < n; i++) {
        float gap = qAbs(ring.angle.at(i) - want);
        if (gap > float(M_PI)) {
            gap = float(2.0 * M_PI) - gap;
        }
        if (i == 0 || gap < bestGap) {
            best = i;
            bestGap = gap;
        }
    }
    return ring.offset.at(best);
}

} // namespace

void RCave3dView::drawTubeRing(const QMatrix4x4& mvp, int a, int b,
                               float t, const QColor& color,
                               float lineWidth) {
    if (a < 0 || b < 0 || a >= outlineCounts.size() ||
            b >= outlineCounts.size() ||
            lineProgram == NULL || !lineProgram->isLinked()) {
        return;
    }

    // The passage's own axis here, and a frame square to it. Angles
    // are measured in that frame, so both rings are described the same
    // way whatever order their points were collected in.
    QVector3D ca(outlineCentres.at(a * 3), outlineCentres.at(a * 3 + 1),
                 outlineCentres.at(a * 3 + 2));
    QVector3D cb(outlineCentres.at(b * 3), outlineCentres.at(b * 3 + 1),
                 outlineCentres.at(b * 3 + 2));
    QVector3D axis = cb - ca;
    if (axis.lengthSquared() < 1e-9f) {
        drawOutlineRing(mvp, a, color, lineWidth);
        return;
    }
    axis.normalize();
    QVector3D across = QVector3D::crossProduct(axis,
                                               QVector3D(0.0f, 0.0f, 1.0f));
    if (across.lengthSquared() < 1e-9f) {
        // Straight up or straight down a shaft: every horizontal
        // direction is equally "across", so pick one.
        across = QVector3D(1.0f, 0.0f, 0.0f);
    }
    across.normalize();
    QVector3D up = QVector3D::crossProduct(across, axis).normalized();

    int offsets[2] = { 0, 0 };
    for (int i = 0; i < a; i++) { offsets[0] += outlineCounts.at(i); }
    for (int i = 0; i < b; i++) { offsets[1] += outlineCounts.at(i); }
    int idx[2] = { a, b };
    QVector3D centre[2] = { ca, cb };

    RingSample sampled[2];
    for (int r = 0; r < 2; r++) {
        int n = outlineCounts.at(idx[r]);
        if (n < 3 || (offsets[r] + n) * 3 > outlinePositions.size()) {
            return;
        }
        sampled[r].angle.reserve(n);
        sampled[r].offset.reserve(n);
        for (int k = 0; k < n; k++) {
            int at = (offsets[r] + k) * 3;
            QVector3D p(outlinePositions.at(at), outlinePositions.at(at + 1),
                        outlinePositions.at(at + 2));
            QVector3D off = p - centre[r];
            sampled[r].offset.append(off);
            sampled[r].angle.append(std::atan2(
                QVector3D::dotProduct(off, up),
                QVector3D::dotProduct(off, across)));
        }
    }

    // As many steps as the busier of the two rings, so a section
    // measured with a dozen splays keeps its shape.
    int steps = qMax(outlineCounts.at(a), outlineCounts.at(b));
    steps = qBound(8, steps, 64);
    QVector3D here = centre[0] + (centre[1] - centre[0]) * t;

    QVector<QVector3D> loop;
    loop.reserve(steps);
    for (int k = 0; k < steps; k++) {
        float ang = float(-M_PI + 2.0 * M_PI * (double(k) / double(steps)));
        QVector3D oa = offsetAtAngle(sampled[0], ang);
        QVector3D ob = offsetAtAngle(sampled[1], ang);
        loop.append(here + oa + (ob - oa) * t);
    }

    QVector<float> pos;
    QVector<float> col;
    pos.reserve(steps * 6);
    col.reserve(steps * 6);
    for (int k = 0; k < steps; k++) {
        const QVector3D& p0 = loop.at(k);
        const QVector3D& p1 = loop.at((k + 1) % steps);
        pos.append(p0.x()); pos.append(p0.y()); pos.append(p0.z());
        pos.append(p1.x()); pos.append(p1.y()); pos.append(p1.z());
        for (int c = 0; c < 2; c++) {
            col.append(float(color.redF()));
            col.append(float(color.greenF()));
            col.append(float(color.blueF()));
        }
    }

    glDisable(GL_DEPTH_TEST);
    glLineWidth(lineWidth);
    lineProgram->bind();
    lineProgram->setUniformValue("uMvp", mvp);
    lineProgram->enableAttributeArray(0);
    lineProgram->enableAttributeArray(1);
    lineProgram->setAttributeArray(0, pos.constData(), 3);
    lineProgram->setAttributeArray(1, col.constData(), 3);
    glDrawArrays(GL_LINES, 0, pos.size() / 3);
    lineProgram->disableAttributeArray(0);
    lineProgram->disableAttributeArray(1);
    lineProgram->release();
    glLineWidth(1.0f);
    glEnable(GL_DEPTH_TEST);
}

void RCave3dView::drawOutlineRing(const QMatrix4x4& mvp, int index,
                                  const QColor& color, float lineWidth) {
    if (index < 0 || index >= outlineCounts.size() ||
            lineProgram == NULL || !lineProgram->isLinked()) {
        return;
    }
    int at = 0;
    for (int i = 0; i < index; i++) {
        at += outlineCounts.at(i);
    }
    int n = outlineCounts.at(index);
    if (n < 3 || (at + n) * 3 > outlinePositions.size()) {
        return;
    }

    // A closed loop, as pairs.
    QVector<float> pos;
    QVector<float> col;
    pos.reserve(n * 6);
    col.reserve(n * 6);
    for (int k = 0; k < n; k++) {
        int a = (at + k) * 3;
        int b = (at + ((k + 1) % n)) * 3;
        pos.append(outlinePositions.at(a));
        pos.append(outlinePositions.at(a + 1));
        pos.append(outlinePositions.at(a + 2));
        pos.append(outlinePositions.at(b));
        pos.append(outlinePositions.at(b + 1));
        pos.append(outlinePositions.at(b + 2));
        for (int c = 0; c < 2; c++) {
            col.append(float(color.redF()));
            col.append(float(color.greenF()));
            col.append(float(color.blueF()));
        }
    }

    glDisable(GL_DEPTH_TEST);
    glLineWidth(lineWidth);
    lineProgram->bind();
    lineProgram->setUniformValue("uMvp", mvp);
    lineProgram->enableAttributeArray(0);
    lineProgram->enableAttributeArray(1);
    lineProgram->setAttributeArray(0, pos.constData(), 3);
    lineProgram->setAttributeArray(1, col.constData(), 3);
    glDrawArrays(GL_LINES, 0, pos.size() / 3);
    lineProgram->disableAttributeArray(0);
    lineProgram->disableAttributeArray(1);
    lineProgram->release();
    glLineWidth(1.0f);
    glEnable(GL_DEPTH_TEST);
}

void RCave3dView::drawOutline(const QMatrix4x4& mvp, const QVector3D& eye,
                              const QVector3D& look) {
    if (outlineCounts.isEmpty() || lineProgram == NULL ||
            !lineProgram->isLinked()) {
        return;
    }
    // A SHORT WAY AHEAD, not at the eye and not at the very next
    // station.
    //
    // At the eye the ring surrounds the view and is mostly off the
    // edges of it -- there is nothing to see. At the next station it is
    // often a couple of feet away and spills off the edges just the
    // same. A section some way down the passage reads as a hoop the
    // camera is about to fly through, which is what says how wide and
    // how high the passage is there.
    //
    // The distance comes from the CAVE's own size, so a big system and
    // a single chamber both put it somewhere useful.
    float span = (boundsMax - boundsMin).length();
    if (span < 1e-3f) {
        span = 1.0f;
    }
    QVector3D want = eye + look * (span * 0.03f);

    int best = -1;
    float bestDist = 0.0f;
    for (int i = 0; i < outlineCounts.size(); i++) {
        if (i * 3 + 2 >= outlineCentres.size()) { break; }
        QVector3D c(outlineCentres.at(i * 3), outlineCentres.at(i * 3 + 1),
                    outlineCentres.at(i * 3 + 2));
        if (QVector3D::dotProduct(c - eye, look) <= 0.0f) {
            continue;               // behind, or level with, the camera
        }
        float d = (c - want).lengthSquared();
        if (best < 0 || d < bestDist) {
            best = i;
            bestDist = d;
        }
    }
    if (best < 0) {
        // Nothing ahead: at the very end of a passage, show the one the
        // camera is in rather than nothing at all.
        bestDist = 0.0f;
        for (int i = 0; i < outlineCounts.size(); i++) {
            if (i * 3 + 2 >= outlineCentres.size()) { break; }
            QVector3D c(outlineCentres.at(i * 3),
                        outlineCentres.at(i * 3 + 1),
                        outlineCentres.at(i * 3 + 2));
            float d = (c - eye).lengthSquared();
            if (best < 0 || d < bestDist) {
                best = i;
                bestDist = d;
            }
        }
    }
    if (best < 0) {
        return;
    }
    // WHITE, and the hover ring is amber: two rings can be on screen
    // at once -- flying past a section the cursor is over -- and they
    // answer different questions.
    drawOutlineRing(mvp, best, QColor(255, 255, 255), 2.0f);
}

void RCave3dView::computeCamera(QVector3D& eye, QVector3D& look) const {
    if (cameraMode == CameraFly && hasFlyPath()) {
        QVector3D at, ahead;
        flySample(flyPoints, flyTurns, cameraProgress, at, ahead);
        QMatrix4x4 turn;
        turn.rotate(flyYaw, QVector3D(0.0f, 0.0f, 1.0f));
        QVector3D dir = turn.map(ahead);
        QVector3D side = QVector3D::crossProduct(dir,
            QVector3D(0.0f, 0.0f, 1.0f));
        if (side.lengthSquared() < 1e-12f) {
            side = QVector3D(1.0f, 0.0f, 0.0f);
        }
        QMatrix4x4 tilt;
        tilt.rotate(flyPitch, side.normalized());
        eye = at;
        look = tilt.map(dir).normalized();
        return;
    }
    float useYaw = yaw;
    if (cameraMode == CameraSpin) {
        useYaw = spinFromYaw + float(cameraProgress) * 360.0f;
    }
    float yawRad = qDegreesToRadians(useYaw);
    float pitchRad = qDegreesToRadians(pitch);
    eye = QVector3D(
        target.x() + distance * std::cos(pitchRad) * std::sin(yawRad),
        target.y() - distance * std::cos(pitchRad) * std::cos(yawRad),
        target.z() + distance * std::sin(pitchRad));
    QVector3D dir = target - eye;
    look = (dir.lengthSquared() < 1e-12f)
        ? QVector3D(0.0f, 1.0f, 0.0f) : dir.normalized();
}

QVector3D RCave3dView::getEye() const {
    QVector3D eye, look;
    computeCamera(eye, look);
    return eye;
}

QVector3D RCave3dView::getLook() const {
    QVector3D eye, look;
    computeCamera(eye, look);
    return look;
}

void RCave3dView::setStations(const QVector<QVector3D>& positions,
                              const QStringList& names) {
    stationPositions = positions;
    stationNames = names;
    if (labels != NULL) {
        labels->setStations(positions, names);
    }
    // A REBUILT CAVE HAS NO OPEN CARD. The station it described may
    // not be in this survey any more, and a card left standing would
    // report the last drawing's numbers over this one's passage.
    hideStationCard();
    update();
}

/** How near a click has to land, in pixels. Generous: stations down a
 *  passage project a few pixels apart and a caver is pointing at a
 *  place, not at a dot. */
static const int PICK_RADIUS_PX = 20;

QString RCave3dView::stationAt(const QPoint& pos) const {
    if (stationPositions.isEmpty()) {
        return QString();
    }
    // THE NAME THE CAVER CAN SEE ANSWERS FIRST. A label is drawn
    // beside its station and can run well past any radius round the
    // station's own dot, so clicking the text a caver is reading has
    // to find that station and not the nearer dot of some other one.
    if (labels != NULL) {
        QString named = labels->stationAtPoint(pos);
        if (!named.isEmpty()) {
            return named;
        }
    }
    QMatrix4x4 mvp = cameraMatrix();
    QString best;
    float bestDist = float(PICK_RADIUS_PX * PICK_RADIUS_PX) + 1.0f;
    float bestDepth = 0.0f;
    for (int i = 0; i < stationPositions.size() &&
                    i < stationNames.size(); i++) {
        QVector4D clip = mvp * QVector4D(stationPositions.at(i), 1.0f);
        if (clip.w() <= 0.0f) {
            continue;                       // behind the eye
        }
        float sx = (clip.x() / clip.w() * 0.5f + 0.5f) * width();
        float sy = (1.0f - (clip.y() / clip.w() * 0.5f + 0.5f)) * height();
        float dx = sx - pos.x();
        float dy = sy - pos.y();
        float d2 = dx * dx + dy * dy;
        if (d2 > float(PICK_RADIUS_PX * PICK_RADIUS_PX)) {
            continue;
        }
        float depth = clip.z() / clip.w();
        // NEAREST THE CURSOR FIRST, and only then nearest the eye. Two
        // stations the same distance from the click are one passage
        // over another, and the caver is looking at the near one.
        if (d2 < bestDist - 1e-3f ||
                (qAbs(d2 - bestDist) <= 1e-3f && depth < bestDepth)) {
            bestDist = d2;
            bestDepth = depth;
            best = stationNames.at(i);
        }
    }
    return best;
}

int RCave3dView::hoverAt(const QPoint& pos) {
    int a = -1, b = -1;
    float t = 0.0f;
    bool onTube = tubeAt(pos, a, b, t);
    // A STATION'S OWN RING IS THE FALLBACK, not the answer: a passage
    // end, a leg with one end behind the eye, or a tools package too
    // old to send the legs. Between two stations the tube wins.
    int over = onTube ? -1 : outlineAt(pos);
    if (a != hoverA || b != hoverB || over != hoverOutline ||
            qAbs(t - hoverT) > 1e-3f) {
        hoverA = a;
        hoverB = b;
        hoverT = t;
        hoverOutline = over;
        update();
    }
    return onTube ? a : over;
}

void RCave3dView::showStationCard(const QString& station,
                                  const QString& title,
                                  const QStringList& labelTexts,
                                  const QStringList& valueTexts) {
    if (card == NULL) {
        return;
    }
    card->setContent(station, title, labelTexts, valueTexts);
    card->setVisible(true);
    card->raise();
    layOutCard();
    update();
}

void RCave3dView::hideStationCard() {
    if (card != NULL && card->isVisible()) {
        card->setVisible(false);
        update();
    }
}

void RCave3dView::onCardDismissed() {
    hideStationCard();
}

/**
 * Put the card beside the station it is about.
 *
 * RUN FROM THE PAINT, because the paint is the one place that knows
 * the camera has moved -- the same reason the labels are given their
 * matrix there. A station that has gone behind the eye or off the
 * edge takes its card with it: a card pinned to nothing would sit in a
 * corner labelling whatever happened to be under it.
 */
void RCave3dView::layOutCard() {
    if (card == NULL || !card->isVisible()) {
        return;
    }
    int idx = stationNames.indexOf(card->getStation());
    if (idx < 0 || idx >= stationPositions.size()) {
        card->setVisible(false);
        return;
    }
    QMatrix4x4 mvp = cameraMatrix();
    QVector4D clip = mvp * QVector4D(stationPositions.at(idx), 1.0f);
    if (clip.w() <= 0.0f) {
        card->setVisible(false);
        return;
    }
    int sx = int((clip.x() / clip.w() * 0.5f + 0.5f) * width());
    int sy = int((1.0f - (clip.y() / clip.w() * 0.5f + 0.5f)) * height());
    if (sx < -40 || sy < -40 || sx > width() + 40 || sy > height() + 40) {
        card->setVisible(false);
        return;
    }
    QSize want = card->sizeHint();
    // Beside the station and a little above it, then pushed back
    // inside the view -- a card half off the edge is the one that had
    // something worth reading on it.
    int x = sx + 14;
    int y = sy - want.height() / 2;
    if (x + want.width() > width() - 6) {
        x = sx - 14 - want.width();
    }
    if (x < 6) { x = 6; }
    if (y < 6) { y = 6; }
    if (y + want.height() > height() - 6) {
        y = height() - 6 - want.height();
    }
    card->setGeometry(x, y, want.width(), want.height());
}

void RCave3dView::setShowStations(bool on) {
    if (labels != NULL) {
        labels->setShow(on);
    }
    update();
}

bool RCave3dView::hasStations() const {
    return labels != NULL && labels->hasStations();
}

QImage RCave3dView::renderFrame(int w, int h) {
    Q_UNUSED(w)
    Q_UNUSED(h)
    if (width() < 16 || height() < 16) {
        return QImage();
    }
    // GRAB THE PARENT AND CUT THIS VIEW OUT OF IT.
    //
    // Asking this widget for its own pixels does not work, by any of
    // the three routes tried: grabFramebuffer(), its own QWidget::grab()
    // and drawing the scene again into a framebuffer object all came
    // back the colour of the background with nothing in them. Grabbing
    // the PARENT does work -- the GL child is composited into it the
    // same way the screen gets it -- and it brings the station names
    // and the legend along, which are child widgets and are not in the
    // GL at all.
    QWidget* from = parentWidget();
    if (from == NULL) {
        from = this;
    }
    QPixmap shot = from->grab();
    if (shot.isNull()) {
        return QImage();
    }
    qreal ratio = shot.devicePixelRatio();
    if (ratio <= 0.0) {
        ratio = 1.0;
    }
    QPoint at = mapTo(from, QPoint(0, 0));
    QRect mine(int(at.x() * ratio), int(at.y() * ratio),
               int(width() * ratio), int(height() * ratio));
    mine = mine.intersected(QRect(QPoint(0, 0), shot.size()));
    if (mine.width() < 8 || mine.height() < 8) {
        return shot.toImage();
    }
    return shot.copy(mine).toImage();
}

void RCave3dView::layOutLegend() {
    // The labels cover the whole view: they place themselves by where
    // the stations land, not by a corner.
    if (labels != NULL) {
        labels->setGeometry(0, 0, width(), height());
    }
    if (legend == NULL) {
        if (labels != NULL) {
            labels->raise();
        }
        return;
    }
    QSize want = legend->sizeHint();
    QRect box(8, height() - want.height() - 8, want.width(), want.height());
    legend->setGeometry(box);
    legend->setVisible(want.height() > 0);

    // THE LEGEND WINS. It is a fixed thing in a corner that the caver
    // reads on purpose; a station name is one of dozens and there is
    // always another. So the legend goes on top, and the names keep out
    // of its rectangle rather than being sliced in half by its edge.
    if (labels != NULL) {
        labels->setAvoid(legend->isVisible() ? box : QRect());
    }
    legend->raise();
    if (card != NULL) {
        // ABOVE THE LEGEND. The legend is always there; the card is
        // there because the caver just asked for it.
        card->raise();
    }
}

void RCave3dView::setTriangles(const QVector<float>& positions,
                               const QVector<float>& normals,
                               const QVector<float>& colors) {
    trianglePositions = positions;
    triangleNormals = normals;
    triangleColors = colors;
    update();
}

void RCave3dView::setLines(const QVector<float>& positions,
                           const QVector<float>& colors) {
    linePositions = positions;
    lineColors = colors;
    update();
}

void RCave3dView::setGhost(const QVector<float>& positions,
                           const QVector<float>& colors) {
    ghostPositions = positions;
    ghostColors = colors;
    update();
}

void RCave3dView::setLeads(const QVector<float>& positions,
                           const QVector<float>& colors) {
    leadPositions = positions;
    leadColors = colors;
    update();
}

void RCave3dView::setSections(const QVector<float>& positions,
                              const QVector<float>& colors) {
    sectionPositions = positions;
    sectionColors = colors;
    update();
}

void RCave3dView::setShowSections(bool on) {
    showSections = on;
    update();
}

void RCave3dView::setLegend(const QString& title, const QString& note,
                            const QString& kind,
                            const QVector<LegendStop>& stops) {
    if (legend != NULL) {
        legend->setLegend(title, note, kind, stops);
        layOutLegend();
    }
    update();
}

void RCave3dView::setProgress(int triangleVertices, int lineVertices) {
    progressTriangles = triangleVertices;
    progressLines = lineVertices;
    update();
}

void RCave3dView::setShowGhost(bool on) {
    showGhost = on;
    update();
}

void RCave3dView::setShowLeads(bool on) {
    showLeads = on;
    update();
}

void RCave3dView::setBounds(const QVector3D& min, const QVector3D& max) {
    boundsMin = min;
    boundsMax = max;
    update();
}

void RCave3dView::frameToBounds(const QVector3D& min, const QVector3D& max) {
    QVector3D oldMin = boundsMin;
    QVector3D oldMax = boundsMax;
    bool hadBounds = (oldMax - oldMin).lengthSquared() > 1e-12f;

    setBounds(min, max);

    if (cameraUntouched || !hadBounds) {
        viewAll();
        return;
    }

    // Somewhere else entirely? Compare the two boxes: if they do not
    // overlap on any axis, this is a different cave and the old camera
    // is aimed at nothing.
    bool overlaps = (min.x() <= oldMax.x() && max.x() >= oldMin.x()) &&
                    (min.y() <= oldMax.y() && max.y() >= oldMin.y()) &&
                    (min.z() <= oldMax.z() && max.z() >= oldMin.z());
    if (!overlaps) {
        viewAll();
        return;
    }

    // The caver's own view, kept. Only the geometry under it changed.
    update();
}

void RCave3dView::clearGeometry() {
    trianglePositions.clear();
    triangleNormals.clear();
    triangleColors.clear();
    linePositions.clear();
    lineColors.clear();
    ghostPositions.clear();
    ghostColors.clear();
    leadPositions.clear();
    leadColors.clear();
    sectionPositions.clear();
    sectionColors.clear();
    scanPositions.clear();
    scanUvs.clear();
    scanIndices.clear();
    scanPaths.clear();
    scanRuns.clear();
    dropScanTextures();
    if (legend != NULL) {
        legend->setLegend(QString(), QString(), QString(),
                          QVector<LegendStop>());
    }
    progressTriangles = -1;
    progressLines = -1;
    update();
}

void RCave3dView::setShowSurface(bool on) {
    showSurface = on;
    update();
}

void RCave3dView::setShowLines(bool on) {
    showLines = on;
    update();
}

void RCave3dView::viewAll() {
    target = (boundsMin + boundsMax) * 0.5f;

    // FIT THE BOX AS IT IS SEEN, not its diagonal. A cave is long and
    // thin, so its bounding-sphere radius is set almost entirely by its
    // LENGTH -- back the camera off by that and a passage seen across
    // its short axis ends up a thread in the middle of a dark window,
    // which is exactly what "view all" is supposed not to do.
    //
    // So each of the eight corners is put into view space and asked how
    // far back the camera must be for it to fall inside the frustum.
    // The answer is the largest of those.
    QVector3D forward, right, up;
    cameraBasis(forward, right, up);

    float aspect = float(width()) / float(qMax(1, height()));
    float tanY = std::tan(qDegreesToRadians(FOV_DEGREES * 0.5f));
    float tanX = tanY * aspect;

    float needed = 0.0f;
    for (int i = 0; i < 8; i++) {
        QVector3D corner(
            (i & 1) ? boundsMax.x() : boundsMin.x(),
            (i & 2) ? boundsMax.y() : boundsMin.y(),
            (i & 4) ? boundsMax.z() : boundsMin.z());
        QVector3D v = corner - target;
        float depth = QVector3D::dotProduct(v, forward);
        float dx = std::fabs(QVector3D::dotProduct(v, right));
        float dy = std::fabs(QVector3D::dotProduct(v, up));
        // The corner sits at (distance + depth) in front of the eye, so
        // it fits when dx <= (distance + depth) * tanX.
        needed = qMax(needed, dx / tanX - depth);
        needed = qMax(needed, dy / tanY - depth);
    }

    if (!(needed > 1e-6f)) {
        // A single station, or a cave with no extent yet.
        needed = 1.0f;
    }
    distance = needed * 1.05f;   // a little air around the edges
    cameraUntouched = true;
    update();
}

void RCave3dView::setOrthographic(bool on) {
    if (orthographic == on) {
        return;
    }
    orthographic = on;
    update();
}

void RCave3dView::viewPlan() {
    yaw = 0.0f;
    // Not 90: looking straight down the pole makes the up vector
    // parallel to the view direction, lookAt degenerates, and the view
    // rolls to whatever the arithmetic happens to produce.
    pitch = 89.9f;
    viewAll();
}

void RCave3dView::viewProfile() {
    yaw = 0.0f;
    pitch = 0.0f;
    viewAll();
}

void RCave3dView::mousePressEvent(QMouseEvent* e) {
    lastMousePos = e->pos();
    pressPos = e->pos();
}

/** How far the mouse may travel and still be a click rather than a
 *  drag. A few pixels: an orbit that ends over a station must not open
 *  its card, and a hand on a trackpad never holds perfectly still. */
static const int CLICK_SLOP_PX = 4;

void RCave3dView::mouseReleaseEvent(QMouseEvent* e) {
    if (e->button() != Qt::LeftButton) {
        return;
    }
    QPoint moved = e->pos() - pressPos;
    if (qAbs(moved.x()) > CLICK_SLOP_PX || qAbs(moved.y()) > CLICK_SLOP_PX) {
        return;                              // that was a drag
    }
    // A MISS IS AN ANSWER: it arrives as an empty name and closes an
    // open card. Clicking away from a thing is how every other panel
    // in this program dismisses it.
    emit stationPicked(stationAt(e->pos()));
}

void RCave3dView::mouseMoveEvent(QMouseEvent* e) {
    QPoint delta = e->pos() - lastMousePos;
    lastMousePos = e->pos();

    if (e->buttons() == Qt::NoButton) {
        // POINTING, not dragging: light up the cross section under the
        // cursor, so a caver reading a tube from outside can see what
        // the passage is doing at the place they are looking at. A
        // tube seen from outside is all wall and says nothing about
        // its own shape.
        hoverAt(e->pos());
        return;
    }

    bool panning = (e->buttons() & Qt::MiddleButton) ||
        ((e->buttons() & Qt::LeftButton) &&
         (e->modifiers() & Qt::ShiftModifier));

    if (panning) {
        // Pan in the camera's OWN plane -- not in the world's. A pan
        // that used world Z as its up is only right while the camera is
        // level; in the plan view it would push the cave toward the
        // camera and appear to do nothing.
        QVector3D forward, right, up;
        cameraBasis(forward, right, up);
        // Exactly a pixel of world per pixel of mouse, so the cave
        // stays under the cursor at any zoom and any window size.
        float scale = worldPerPixel();
        target -= right * (delta.x() * scale);
        target += up * (delta.y() * scale);
        cameraUntouched = false;
        update();
        return;
    }

    if (e->buttons() & Qt::LeftButton) {
        if (cameraMode == CameraFly) {
            // LOOK AROUND WITHOUT STOPPING. Flying down a passage, the
            // thing a caver wants most is to turn their head at a
            // junction -- so a drag turns the view off the path's own
            // direction rather than taking the camera off the path.
            flyYaw -= delta.x() * 0.4f;
            flyPitch -= delta.y() * 0.4f;
            if (flyPitch > 85.0f) { flyPitch = 85.0f; }
            if (flyPitch < -85.0f) { flyPitch = -85.0f; }
            update();
            return;
        }
        yaw += delta.x() * 0.4f;
        pitch += delta.y() * 0.4f;
        if (pitch > 89.9f) {
            pitch = 89.9f;
        }
        if (pitch < -89.9f) {
            pitch = -89.9f;
        }
        cameraUntouched = false;
        update();
    }
}

void RCave3dView::wheelEvent(QWheelEvent* e) {
    // Multiplicative, so zooming feels the same at every scale and the
    // camera can never step through the target to the far side.
    float steps = e->angleDelta().y() / 120.0f;
    distance *= std::pow(0.85f, steps);
    if (distance < 1e-4f) {
        distance = 1e-4f;
    }
    cameraUntouched = false;
    update();
}

void RCave3dView::leaveEvent(QEvent* e) {
    // The cursor is gone, so nothing is being pointed at. A ring left
    // lit would claim the caver is still looking there.
    if (hoverOutline >= 0 || hoverA >= 0) {
        hoverOutline = -1;
        hoverA = -1;
        hoverB = -1;
        update();
    }
    QOpenGLWidget::leaveEvent(e);
}

void RCave3dView::keyPressEvent(QKeyEvent* e) {
    switch (e->key()) {
    case Qt::Key_Escape:
        hideStationCard();
        break;
    case Qt::Key_Home:
        viewAll();
        break;
    case Qt::Key_1:
        viewPlan();
        break;
    case Qt::Key_2:
        viewProfile();
        break;
    default:
        QOpenGLWidget::keyPressEvent(e);
        break;
    }
}
