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
#ifndef RCAVE3DENCODER_H
#define RCAVE3DENCODER_H

#include "gui_global.h"

#include <QImage>
#include <QSize>
#include <QString>

/**
 * \brief Frames in, a film out, using whatever the operating system
 * already has.
 *
 * WHY THE SYSTEM'S OWN. Shipping an encoder means shipping its source
 * too and fifty megabytes per platform with it; depending on one the
 * caver happens to have installed means most cavers get no film at all.
 * Every platform this runs on can already write H.264 -- macOS through
 * VideoToolbox, Windows through Media Foundation -- and asking it costs
 * nothing to distribute and nothing to license.
 *
 * A PLATFORM WITHOUT ONE ANSWERS NULL from create(), and the caller
 * falls back to frames on disk. That is the honest failure: the caver
 * still has their animation, just not as one file.
 *
 * \ingroup gui
 */
class QCADGUI_EXPORT RCave3dEncoder {
public:
    virtual ~RCave3dEncoder() {}

    /**
     * The encoder for this platform, ready to take frames, or NULL
     * when there is none.
     *
     * \param path  the film to write; overwritten if it exists
     * \param size  every frame must be this size
     * \param fps   frames a second
     * \param error filled in when NULL comes back
     */
    static RCave3dEncoder* create(const QString& path, const QSize& size,
                                  int fps, QString& error);

    /** One frame, in order. \return false and sets error() on failure. */
    virtual bool addFrame(const QImage& frame) = 0;

    /** Finishes the film. \return false when it could not be written. */
    virtual bool finish() = 0;

    /** Why the last call failed. */
    virtual QString error() const = 0;

    /** What this encoder writes, for the caver: "MP4", say. */
    static QString formatName();

    /** True when this build can encode at all. */
    static bool available();
};

#endif
