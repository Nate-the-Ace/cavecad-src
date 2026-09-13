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
#include "RCave3dTexture.h"

#include <QDebug>
#include <QLinearGradient>
#include <QPainter>
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
      boundsMin(-1.0f, -1.0f, -1.0f),
      boundsMax(1.0f, 1.0f, 1.0f),
      yaw(0.0f),
      pitch(20.0f),
      distance(10.0f),
      target(0.0f, 0.0f, 0.0f),
      showSurface(true),
      showLines(true),
      showGhost(false),
      showLeads(false),
      showSections(false),
      showScans(false),
      scanInk(RCave3dView::DEFAULT_SCAN_INK),
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
    forgetScanTextures();
    scansNeedUpload = !scanPaths.isEmpty();

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

    uploadScanTextures();
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
                             const QVector<int>& breaks) {
    flyPoints = points;
    flyBreaks = breaks;
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

/** Where on the flight path progress `t` sits, and which way it faces. */
static void flySample(const QVector<float>& pts, double t,
                      QVector3D& eye, QVector3D& ahead) {
    int count = pts.size() / 3;
    if (count < 2) {
        eye = QVector3D(0, 0, 0);
        ahead = QVector3D(0, 1, 0);
        return;
    }
    double at = t * double(count - 1);
    int i = int(at);
    if (i > count - 2) { i = count - 2; }
    double f = at - double(i);
    QVector3D a(pts.at(i * 3), pts.at(i * 3 + 1), pts.at(i * 3 + 2));
    QVector3D b(pts.at(i * 3 + 3), pts.at(i * 3 + 4), pts.at(i * 3 + 5));
    eye = a + (b - a) * float(f);
    QVector3D dir = b - a;
    if (dir.lengthSquared() < 1e-12f) {
        dir = QVector3D(0, 1, 0);
    }
    ahead = dir.normalized();
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
    projection.perspective(FOV_DEGREES, aspect, near, far);

    float useYaw = yaw;
    if (cameraMode == CameraSpin) {
        // A SLOW TURN ROUND THE CAVE, which is what a cave is usually
        // shown doing: one whole revolution over the length of the
        // animation, so an exported loop joins up with itself.
        useYaw = spinFromYaw + float(cameraProgress) * 360.0f;
    }

    if (cameraMode == CameraFly && hasFlyPath()) {
        // DOWN THE PASSAGE, from inside it. The eye rides the
        // centreline and looks along it, with whatever the caver has
        // dragged added on top so they can look about without stopping.
        QVector3D eyeAt, ahead;
        flySample(flyPoints, cameraProgress, eyeAt, ahead);
        QMatrix4x4 turn;
        turn.rotate(flyYaw, QVector3D(0.0f, 0.0f, 1.0f));
        QVector3D look = turn.map(ahead);
        QVector3D side = QVector3D::crossProduct(look,
            QVector3D(0.0f, 0.0f, 1.0f));
        if (side.lengthSquared() < 1e-12f) {
            side = QVector3D(1.0f, 0.0f, 0.0f);
        }
        QMatrix4x4 tilt;
        tilt.rotate(flyPitch, side.normalized());
        look = tilt.map(look).normalized();
        QMatrix4x4 flyView;
        flyView.lookAt(eyeAt, eyeAt + look, QVector3D(0.0f, 0.0f, 1.0f));
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
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

    QMatrix4x4 mvp = cameraMatrix();

    // The one place that knows the camera has moved. The labels are a
    // child widget and repaint themselves; this only tells them where
    // the cave is now.
    if (labels != NULL) {
        labels->setCamera(mvp);
    }

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
    dropScanTextures();
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
void RCave3dView::setStations(const QVector<QVector3D>& positions,
                              const QStringList& names) {
    if (labels != NULL) {
        labels->setStations(positions, names);
    }
    update();
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
    if (w < 16 || h < 16) {
        return QImage();
    }
    // THE FRAME AS THE SCREEN SHOWS IT, overlays and all. The GL
    // framebuffer carries the cave; the station names and the legend
    // are child widgets and are not in it, and a flight with no station
    // names on it is the one thing this animation is for.
    //
    // Rendered at the widget's own size rather than a chosen one: an
    // offscreen surface at another size would need its own context, and
    // the overlays lay themselves out for THIS geometry.
    Q_UNUSED(w)
    Q_UNUSED(h)
    makeCurrent();
    QImage shot = grabFramebuffer();
    doneCurrent();
    if (shot.isNull()) {
        return shot;
    }
    QPainter painter(&shot);
    // The widgets paint at device pixels; the grab is at device pixels
    // too, so the overlay is scaled to match rather than assumed equal.
    qreal sx = qreal(shot.width()) / qreal(qMax(1, width()));
    qreal sy = qreal(shot.height()) / qreal(qMax(1, height()));
    painter.scale(sx, sy);
    if (labels != NULL && labels->isShowing()) {
        labels->render(&painter, QPoint(0, 0), QRegion(),
                       QWidget::DrawChildren);
    }
    if (legend != NULL && legend->isVisible()) {
        legend->render(&painter, legend->pos(), QRegion(),
                       QWidget::DrawChildren);
    }
    painter.end();
    return shot;
}

void RCave3dView::layOutLegend() {
    // The labels cover the whole view: they place themselves by where
    // the stations land, not by a corner.
    if (labels != NULL) {
        labels->setGeometry(0, 0, width(), height());
        labels->raise();
    }
    if (legend == NULL) {
        return;
    }
    QSize want = legend->sizeHint();
    legend->setGeometry(8, height() - want.height() - 8,
                        want.width(), want.height());
    legend->setVisible(want.height() > 0);
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
}

void RCave3dView::mouseMoveEvent(QMouseEvent* e) {
    QPoint delta = e->pos() - lastMousePos;
    lastMousePos = e->pos();

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

void RCave3dView::keyPressEvent(QKeyEvent* e) {
    switch (e->key()) {
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
