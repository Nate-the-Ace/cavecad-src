#include "RAnnotation.h"

#include <QStringList>

#include "RColor.h"
#include "RDocument.h"
#include "REntity.h"
#include "RTextBasedEntity.h"
#include "RUnit.h"

static const char* ANNO_GROUP = "CaveCAD";

bool RAnnotation::isAnnotative(const REntity& entity) {
    return entity.getCustomProperty(ANNO_GROUP, "Anno", QString()).toString() == "1";
}

double RAnnotation::paperHeight(const REntity& entity) {
    return entity.getCustomProperty(ANNO_GROUP, "AnnoH", 0.0).toDouble();
}

QList<RAnnotation::Rep> RAnnotation::representations(const REntity& entity) {
    QList<Rep> ret;
    QString text = entity.getCustomProperty(ANNO_GROUP, "AnnoScales", QString()).toString();
    if (text.isEmpty()) {
        return ret;
    }
    QStringList items = text.split(';', Qt::SkipEmptyParts);
    for (int i=0; i<items.length(); i++) {
        QStringList halves = items[i].split(':');
        if (halves.length() != 2) {
            continue;
        }
        QStringList nums = halves[1].split(',');
        if (nums.length() < 2) {
            continue;
        }
        Rep r;
        r.fpi = halves[0].toDouble();
        r.position = RVector(nums[0].toDouble(), nums[1].toDouble());
        r.angle = nums.length() > 2 ? nums[2].toDouble() : 0.0;
        if (r.fpi > 0.0) {
            ret.append(r);
        }
    }
    return ret;
}

double RAnnotation::currentScale(const RDocument* document) {
    if (document == NULL) {
        return 1.0;
    }
    double s = document->getVariable("CaveCAD/AnnoScale", 1.0).toDouble();
    return s > 0.0 ? s : 1.0;
}

bool RAnnotation::ghostsVisible(const RDocument* document) {
    if (document == NULL) {
        return false;
    }
    return document->getVariable("CaveCAD/AnnoVisible", 0).toInt() != 0;
}

double RAnnotation::unitsPerFoot(const RDocument* document) {
    if (document == NULL || document->getUnit() == RS::None) {
        return 1.0;
    }
    return RUnit::convert(1.0, RS::Foot, document->getUnit());
}

double RAnnotation::unitsPerPaperInch(const RDocument* document) {
    if (document == NULL || document->getUnit() == RS::None) {
        return 1.0;
    }
    return RUnit::convert(1.0, RS::Inch, document->getUnit());
}

double RAnnotation::scaleOfViewport(const RDocument* document, double viewportScale) {
    if (viewportScale <= 0.0) {
        return 1.0;
    }
    return unitsPerPaperInch(document) / (viewportScale * unitsPerFoot(document));
}

bool RAnnotation::sameScale(double a, double b) {
    return qAbs(a - b) <= 1e-6 * qMax(1.0, qMax(qAbs(a), qAbs(b)));
}

bool RAnnotation::findRep(const REntity& entity, double fpi, Rep& out) {
    QList<Rep> reps = representations(entity);
    for (int i=0; i<reps.length(); i++) {
        if (sameScale(reps[i].fpi, fpi)) {
            out = reps[i];
            return true;
        }
    }
    return false;
}

QSharedPointer<REntity> RAnnotation::representation(QSharedPointer<REntity> entity, const Rep& rep,
        const RDocument* document, bool ghost) {
    QSharedPointer<REntity> copy = entity->cloneToEntity();
    QSharedPointer<RTextBasedEntity> text = copy.dynamicCast<RTextBasedEntity>();
    if (text.isNull()) {
        return copy;
    }
    double h = paperHeight(*entity);
    if (h > 0.0) {
        text->setTextHeight(h * rep.fpi * unitsPerFoot(document));
    }
    // move the (already sized) text so its position is where this scale keeps it
    RVector offset = rep.position - text->getPosition();
    if (offset.getMagnitude() > 0.0) {
        text->move(offset);
    }
    text->setAngle(rep.angle);
    if (ghost) {
        text->setColor(RColor(128, 128, 128, 110));
        text->setSelected(false);
    }
    return copy;
}
