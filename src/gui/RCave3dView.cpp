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
    "void main() {\n"
    "    lowp vec4 c = texture2D(uTex, vUv);\n"
    // PAPER IS NOT INK. A scan is mostly white page, and drawn whole it
    // is a wall in front of the cave. Discarding everything lighter than
    // the threshold leaves the pencil floating over the passage, which
    // is the only way the sketch and the geometry can be read together.
    "    highp float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));\n"
    "    if (lum > uInkMax) { discard; }\n"
    "    gl_FragColor = vec4(c.rgb, 1.0);\n"
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
    // a QOpenGLWidget destroys its context and builds a new one. The
    // programs below belong to the context that has just died, so they
    // are dropped here rather than leaked once per float.
    delete surfaceProgram;
    surfaceProgram = NULL;
    delete lineProgram;
    lineProgram = NULL;
    delete scanProgram;
    scanProgram = NULL;
    // Every texture belonged to the context that has just died.
    dropScanTextures();
    scansNeedUpload = !scanPaths.isEmpty();

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

QMatrix4x4 RCave3dView::cameraMatrix() const {
    float aspect = float(width()) / float(qMax(1, height()));

    // Near and far track the model, so a cave a mile long and a chamber
    // ten feet across both get usable depth precision.
    float span = (boundsMax - boundsMin).length();
    if (span < 1e-3f) {
        span = 1.0f;
    }
    QMatrix4x4 projection;
    projection.perspective(45.0f, aspect, span * 0.001f, span * 20.0f);

    float yawRad = qDegreesToRadians(yaw);
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
    scanProgram->setUniformValue("uInkMax", GLfloat(0.62f));
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
void RCave3dView::layOutLegend() {
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
    float tanY = std::tan(qDegreesToRadians(45.0f * 0.5f));
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
        // Scaled by how far away we are, so a drag moves the same
        // amount of SCREEN whatever the zoom.
        float scale = distance * 0.002f;
        target -= right * (delta.x() * scale);
        target += up * (delta.y() * scale);
        cameraUntouched = false;
        update();
        return;
    }

    if (e->buttons() & Qt::LeftButton) {
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
