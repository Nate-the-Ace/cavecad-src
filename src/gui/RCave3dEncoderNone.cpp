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
#include "RCave3dEncoder.h"

#include <QCoreApplication>

/**
 * The stand-in for a platform whose own encoder is not wired up yet.
 *
 * Windows has one -- Media Foundation writes H.264 and is present on
 * every installation -- and it belongs here when someone comes to
 * write it. Until then an export on Windows falls back to frames on
 * disk, which is a worse answer than a film and a better one than an
 * error.
 */
RCave3dEncoder* RCave3dEncoder::create(const QString& path, const QSize& size,
                                       int fps, QString& error) {
    Q_UNUSED(path)
    Q_UNUSED(size)
    Q_UNUSED(fps)
    error = QCoreApplication::translate("RCave3dEncoder",
        "this build has no encoder of its own");
    return NULL;
}

QString RCave3dEncoder::formatName() {
    return QString();
}

bool RCave3dEncoder::available() {
    return false;
}
