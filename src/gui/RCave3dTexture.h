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
#ifndef RCAVE3DTEXTURE_H
#define RCAVE3DTEXTURE_H

#include "gui_global.h"

#include <QString>

class QOpenGLTexture;

/**
 * \brief One scanned sketch as a GL texture.
 *
 * Owns the texture and nothing else. It does not know it is a cave
 * sketch; it is handed a path and hands back something to bind.
 *
 * DOWNSCALED ON UPLOAD. A trimmed scan is smaller than the page it came
 * from but still megapixels, and a cave with thirty of them would eat
 * VRAM for detail nobody can see at passage scale.
 *
 * A TEXTURE BELONGS TO A CONTEXT. Reparenting a QOpenGLWidget -- which
 * a dock does every time it floats -- destroys the context and every
 * texture in it, so these are rebuilt from their paths in initializeGL
 * rather than kept across one.
 *
 * \ingroup gui
 */
class QCADGUI_EXPORT RCave3dTexture {
public:
    /** Longest edge kept, in pixels. */
    static const int MAX_PX;

    RCave3dTexture(const QString& path);
    ~RCave3dTexture();

    /** Builds the GL texture. Call with a current context. */
    bool upload();

    /** Drops the GL texture, keeping the path so upload() can run again
     *  after a context is remade. */
    void release();

    bool bind();
    QString getPath() const { return path; }

private:
    QString path;
    QOpenGLTexture* texture;
};

#endif
