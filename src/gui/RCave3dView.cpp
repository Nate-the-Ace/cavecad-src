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

#include <QDebug>
#include <QKeyEvent>
#include <QMouseEvent>
#include <QWheelEvent>
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
      boundsMin(-1.0f, -1.0f, -1.0f),
      boundsMax(1.0f, 1.0f, 1.0f),
      yaw(0.0f),
      pitch(20.0f),
      distance(10.0f),
      target(0.0f, 0.0f, 0.0f),
      showSurface(true),
      showLines(true),
      cameraUntouched(true) {

    setFocusPolicy(Qt::StrongFocus);
    // Small enough that a dock can be dragged narrow without the
    // panel fighting back.
    setMinimumSize(160, 120);
}

RCave3dView::~RCave3dView() {
    makeCurrent();
    delete surfaceProgram;
    delete lineProgram;
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
}

void RCave3dView::resizeGL(int w, int h) {
    glViewport(0, 0, w, qMax(1, h));
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
        glDrawArrays(GL_TRIANGLES, 0, trianglePositions.size() / 3);
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
        glDrawArrays(GL_LINES, 0, linePositions.size() / 3);
        lineProgram->disableAttributeArray(0);
        lineProgram->disableAttributeArray(1);
        lineProgram->release();
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
