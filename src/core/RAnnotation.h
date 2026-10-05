/**
 * CaveCAD: annotative objects (AutoCAD-style annotation scales).
 *
 * An annotative text carries custom properties (group "CaveCAD"):
 *   Anno        "1"
 *   AnnoH       paper height in inches (shared by every scale)
 *   AnnoScales  "fpi:x,y,angle;fpi:x,y,angle;..."  (fpi = feet per inch of paper)
 *
 * Drawing code (RExporter, visual exporters only) replaces such a text by its
 * REPRESENTATION at the scale being drawn: the viewport's scale inside a
 * viewport, else the document's current annotation scale
 * (document variable "CaveCAD/AnnoScale"). Position, angle and height come
 * from the properties alone. No representation at a scale: not drawn there.
 *
 * Plain static helpers, no state, nothing scriptable: the JavaScript side
 * (scripts/Annotative) edits the properties and calls nothing here.
 */
#ifndef RANNOTATION_H
#define RANNOTATION_H

#include "core_global.h"

#include <QList>
#include <QSharedPointer>

#include "RVector.h"

class RDocument;
class REntity;

class QCADCORE_EXPORT RAnnotation {
public:
    struct Rep {
        double fpi;
        RVector position;
        double angle;
    };

    static bool isAnnotative(const REntity& entity);
    static double paperHeight(const REntity& entity);
    static QList<Rep> representations(const REntity& entity);

    /** The document's current annotation scale, feet per inch (default 1: 1" = 1'). */
    static double currentScale(const RDocument* document);
    /** True when the other scales of an annotative object are shown shaded back. */
    static bool ghostsVisible(const RDocument* document);
    /** Drawing units per foot of ground. */
    static double unitsPerFoot(const RDocument* document);
    /** Drawing units per inch of paper. */
    static double unitsPerPaperInch(const RDocument* document);

    /** Feet per inch of a viewport whose scale factor is `viewportScale` (paper units per model unit). */
    static double scaleOfViewport(const RDocument* document, double viewportScale);

    /**
     * The entity as it is drawn at `fpi`: a copy moved, turned and sized for that
     * scale. \a found is false when the object has no representation at `fpi`.
     * \a ghost: shaded back (grey, translucent) for the other-scales display.
     */
    static QSharedPointer<REntity> representation(QSharedPointer<REntity> entity, const Rep& rep,
        const RDocument* document, bool ghost = false);

    static bool findRep(const REntity& entity, double fpi, Rep& out);
    static bool sameScale(double a, double b);
};

#endif
