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
#include "RCave3dTexture.h"

#include <QImage>
#include <QOpenGLTexture>

const int RCave3dTexture::MAX_PX = 2048;

RCave3dTexture::RCave3dTexture(const QString& p) : path(p), texture(NULL) {
}

RCave3dTexture::~RCave3dTexture() {
    release();
}

bool RCave3dTexture::upload() {
    release();

    QImage img(path);
    if (img.isNull()) {
        return false;
    }
    if (img.width() > MAX_PX || img.height() > MAX_PX) {
        img = img.scaled(MAX_PX, MAX_PX, Qt::KeepAspectRatio,
                         Qt::SmoothTransformation);
    }

    texture = new QOpenGLTexture(img.mirrored());
    texture->setMinificationFilter(QOpenGLTexture::LinearMipMapLinear);
    texture->setMagnificationFilter(QOpenGLTexture::Linear);
    // CLAMPED, not repeated: a sketch tiling across the cave beyond its
    // own edges would be worse than no sketch.
    texture->setWrapMode(QOpenGLTexture::ClampToEdge);
    return texture->isCreated();
}

void RCave3dTexture::release() {
    if (texture != NULL) {
        delete texture;
        texture = NULL;
    }
}

bool RCave3dTexture::bind() {
    if (texture == NULL || !texture->isCreated()) {
        return false;
    }
    texture->bind();
    return true;
}
