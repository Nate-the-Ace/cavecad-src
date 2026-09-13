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

#include <QFile>

#import <AVFoundation/AVFoundation.h>
#import <CoreVideo/CoreVideo.h>

namespace {

/**
 * AVAssetWriter, which is the H.264 encoder every Mac already has.
 *
 * Frames arrive as QImage and go out as CVPixelBuffers. The writer
 * wants them in order and wants to be told when it is finished, and it
 * finishes ASYNCHRONOUSLY -- so finish() waits, or the file is still
 * being written when the caver is told it is done.
 */
class RCave3dEncoderMac : public RCave3dEncoder {
public:
    RCave3dEncoderMac(const QString& path, const QSize& size, int fps)
        : writer(nil), input(nil), adaptor(nil), frameSize(size),
          rate(fps), at(0), ok(false) {
        @autoreleasepool {
            // AVAssetWriter refuses to write over a file that is there.
            if (QFile::exists(path)) {
                QFile::remove(path);
            }
            NSString* ns = [NSString stringWithUTF8String:
                path.toUtf8().constData()];
            NSURL* url = [NSURL fileURLWithPath:ns];
            NSError* err = nil;
            writer = [[AVAssetWriter alloc] initWithURL:url
                                               fileType:AVFileTypeMPEG4
                                                  error:&err];
            if (writer == nil || err != nil) {
                fail(err, "the film could not be started");
                return;
            }

            NSDictionary* settings = @{
                AVVideoCodecKey: AVVideoCodecTypeH264,
                AVVideoWidthKey: @(size.width()),
                AVVideoHeightKey: @(size.height())
            };
            input = [[AVAssetWriterInput alloc]
                initWithMediaType:AVMediaTypeVideo
                   outputSettings:settings];
            input.expectsMediaDataInRealTime = NO;

            NSDictionary* attrs = @{
                (NSString*)kCVPixelBufferPixelFormatTypeKey:
                    @(kCVPixelFormatType_32BGRA),
                (NSString*)kCVPixelBufferWidthKey: @(size.width()),
                (NSString*)kCVPixelBufferHeightKey: @(size.height())
            };
            adaptor = [[AVAssetWriterInputPixelBufferAdaptor alloc]
                initWithAssetWriterInput:input
                sourcePixelBufferAttributes:attrs];

            if (![writer canAddInput:input]) {
                fail(nil, "the film would not take a picture track");
                return;
            }
            [writer addInput:input];
            if (![writer startWriting]) {
                fail(writer.error, "the film could not be started");
                return;
            }
            [writer startSessionAtSourceTime:kCMTimeZero];
            ok = true;
        }
    }

    virtual ~RCave3dEncoderMac() {
        [adaptor release];
        [input release];
        [writer release];
    }

    virtual bool addFrame(const QImage& frame) {
        if (!ok) {
            return false;
        }
        @autoreleasepool {
            QImage src = frame;
            if (src.size() != frameSize) {
                src = src.scaled(frameSize, Qt::IgnoreAspectRatio,
                                 Qt::SmoothTransformation);
            }
            // BGRA to match the buffer the adaptor was asked for; any
            // other order comes out with the reds and blues swapped,
            // which on a cave coloured by depth looks like a bug in the
            // colour ramp rather than in the encoder.
            src = src.convertToFormat(QImage::Format_ARGB32);

            CVPixelBufferRef buffer = NULL;
            CVReturn made = CVPixelBufferPoolCreatePixelBuffer(NULL,
                adaptor.pixelBufferPool, &buffer);
            if (made != kCVReturnSuccess || buffer == NULL) {
                why = "the film ran out of room for another frame";
                return false;
            }
            CVPixelBufferLockBaseAddress(buffer, 0);
            uchar* dst = (uchar*)CVPixelBufferGetBaseAddress(buffer);
            size_t stride = CVPixelBufferGetBytesPerRow(buffer);
            for (int y = 0; y < frameSize.height(); y++) {
                memcpy(dst + y * stride, src.constScanLine(y),
                       qMin((size_t)src.bytesPerLine(), stride));
            }
            CVPixelBufferUnlockBaseAddress(buffer, 0);

            // WAIT RATHER THAN DROP. The writer is not always ready and
            // a frame pushed at a busy one is simply lost, which comes
            // out as a film that jumps.
            int spins = 0;
            while (!input.readyForMoreMediaData && spins++ < 10000) {
                usleep(200);
            }
            CMTime when = CMTimeMake(at, rate);
            BOOL took = [adaptor appendPixelBuffer:buffer
                                 withPresentationTime:when];
            CVPixelBufferRelease(buffer);
            if (!took) {
                fail(writer.error, "a frame was refused");
                return false;
            }
            at++;
            return true;
        }
    }

    virtual bool finish() {
        if (!ok) {
            return false;
        }
        @autoreleasepool {
            [input markAsFinished];
            __block bool done = false;
            [writer finishWritingWithCompletionHandler:^{ done = true; }];
            // FINISHING IS ASYNCHRONOUS. Telling the caver the film is
            // written while it is still being written is how a film
            // comes out truncated.
            int spins = 0;
            while (!done && spins++ < 300000) {
                usleep(200);
            }
            if (writer.status != AVAssetWriterStatusCompleted) {
                fail(writer.error, "the film was not finished");
                return false;
            }
            return true;
        }
    }

    virtual QString error() const { return why; }

private:
    void fail(NSError* err, const char* fallback) {
        ok = false;
        if (err != nil) {
            why = QString::fromUtf8([[err localizedDescription] UTF8String]);
        }
        if (why.isEmpty()) {
            why = QString::fromUtf8(fallback);
        }
    }

    AVAssetWriter* writer;
    AVAssetWriterInput* input;
    AVAssetWriterInputPixelBufferAdaptor* adaptor;
    QSize frameSize;
    int rate;
    long at;
    bool ok;
    QString why;
};

} // namespace

RCave3dEncoder* RCave3dEncoder::create(const QString& path, const QSize& size,
                                       int fps, QString& error) {
    // EVEN DIMENSIONS. H.264 works in pairs of pixels, and an odd width
    // -- which is what a panel dragged to an odd size gives -- is
    // refused with a message about pixel formats that says nothing
    // about the real cause.
    QSize even((size.width() / 2) * 2, (size.height() / 2) * 2);
    if (even.width() < 16 || even.height() < 16) {
        error = QObject::tr("the panel is too small to film");
        return NULL;
    }
    RCave3dEncoderMac* made = new RCave3dEncoderMac(path, even,
                                                    qBound(1, fps, 120));
    if (!made->error().isEmpty()) {
        error = made->error();
        delete made;
        return NULL;
    }
    return made;
}

QString RCave3dEncoder::formatName() {
    return QString("MP4");
}

bool RCave3dEncoder::available() {
    return true;
}
