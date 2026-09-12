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
      showLines(true) {

    setFocusPolicy(Qt::StrongFocus);
    setMinimumSize(320, 240);
}

RCave3dView::~RCave3dView() {
    makeCurrent();
    delete surfaceProgram;
    delete lineProgram;
    doneCurrent();
}

void RCave3dView::initializeGL() {
    initializeOpenGLFunctions();

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
    float radius = (boundsMax - boundsMin).length() * 0.5f;
    if (radius < 1e-6f) {
        radius = 1.0f;
    }
    distance = radius * 2.5f;
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
        // Pan in the camera's own plane, scaled by how far away we are,
        // so a drag moves the same amount of screen whatever the zoom.
        float yawRad = qDegreesToRadians(yaw);
        QVector3D right(std::cos(yawRad), std::sin(yawRad), 0.0f);
        QVector3D up = QVector3D::crossProduct(
            right, QVector3D(std::sin(yawRad), -std::cos(yawRad), 0.0f));
        float scale = distance * 0.002f;
        target -= right * (delta.x() * scale);
        target += up * (delta.y() * scale);
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
