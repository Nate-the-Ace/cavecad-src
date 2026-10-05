/**
 * Copyright (c) 2011-2018 by Andrew Mustun. All rights reserved.
 * 
 * This file is part of the QCAD project.
 *
 * QCAD is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * QCAD is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with QCAD.
 */
#include "RAnnotation.h"
#include "RBlock.h"
#include "RBlockReferenceData.h"
#include "RDocument.h"
#include "RExporter.h"
#include "RLayer.h"
#include "RSettings.h"
#include "RStorage.h"
#include "RTransform.h"
#include "RViewportEntity.h"
#include "RUnit.h"

RPropertyTypeId RViewportEntity::PropertyCustom;
RPropertyTypeId RViewportEntity::PropertyHandle;
RPropertyTypeId RViewportEntity::PropertyType;
RPropertyTypeId RViewportEntity::PropertyBlock;
RPropertyTypeId RViewportEntity::PropertyLayer;
RPropertyTypeId RViewportEntity::PropertyLinetype;
RPropertyTypeId RViewportEntity::PropertyLinetypeScale;
RPropertyTypeId RViewportEntity::PropertyLineweight;
RPropertyTypeId RViewportEntity::PropertyColor;
RPropertyTypeId RViewportEntity::PropertyDisplayedColor;
RPropertyTypeId RViewportEntity::PropertyDrawOrder;

RPropertyTypeId RViewportEntity::PropertyCenterX;
RPropertyTypeId RViewportEntity::PropertyCenterY;
RPropertyTypeId RViewportEntity::PropertyCenterZ;
RPropertyTypeId RViewportEntity::PropertyWidth;
RPropertyTypeId RViewportEntity::PropertyHeight;
RPropertyTypeId RViewportEntity::PropertyScale;
RPropertyTypeId RViewportEntity::PropertyRotation;
RPropertyTypeId RViewportEntity::PropertyOn;
RPropertyTypeId RViewportEntity::PropertyLocked;
RPropertyTypeId RViewportEntity::PropertyViewCenterX;
RPropertyTypeId RViewportEntity::PropertyViewCenterY;
RPropertyTypeId RViewportEntity::PropertyViewTargetX;
RPropertyTypeId RViewportEntity::PropertyViewTargetY;
RPropertyTypeId RViewportEntity::PropertyViewTargetZ;

RPropertyTypeId RViewportEntity::PropertyOverall;

RPropertyTypeId RViewportEntity::PropertyFrozenLayerIds;


RViewportEntity::RViewportEntity(RDocument* document, const RViewportData& data) :
    REntity(document), data(document, data) {
}

RViewportEntity::~RViewportEntity() {
}

void RViewportEntity::init() {
    RViewportEntity::PropertyCustom.generateId(RViewportEntity::getRtti(), RObject::PropertyCustom);
    RViewportEntity::PropertyHandle.generateId(RViewportEntity::getRtti(), RObject::PropertyHandle);
    RViewportEntity::PropertyType.generateId(RViewportEntity::getRtti(), REntity::PropertyType);
    RViewportEntity::PropertyBlock.generateId(RViewportEntity::getRtti(), REntity::PropertyBlock);
    RViewportEntity::PropertyLayer.generateId(RViewportEntity::getRtti(), REntity::PropertyLayer);
    RViewportEntity::PropertyLinetype.generateId(RViewportEntity::getRtti(), REntity::PropertyLinetype);
    RViewportEntity::PropertyLinetypeScale.generateId(RViewportEntity::getRtti(), REntity::PropertyLinetypeScale);
    RViewportEntity::PropertyLineweight.generateId(RViewportEntity::getRtti(), REntity::PropertyLineweight);
    RViewportEntity::PropertyColor.generateId(RViewportEntity::getRtti(), REntity::PropertyColor);
    RViewportEntity::PropertyDisplayedColor.generateId(RViewportEntity::getRtti(), REntity::PropertyDisplayedColor);
    RViewportEntity::PropertyDrawOrder.generateId(RViewportEntity::getRtti(), REntity::PropertyDrawOrder);

    RViewportEntity::PropertyCenterX.generateId(RViewportEntity::getRtti(), QT_TRANSLATE_NOOP("REntity", "Position"), QT_TRANSLATE_NOOP("REntity", "X"), false, RPropertyAttributes::Geometry);
    RViewportEntity::PropertyCenterY.generateId(RViewportEntity::getRtti(), QT_TRANSLATE_NOOP("REntity", "Position"), QT_TRANSLATE_NOOP("REntity", "Y"), false, RPropertyAttributes::Geometry);
    RViewportEntity::PropertyCenterZ.generateId(RViewportEntity::getRtti(), QT_TRANSLATE_NOOP("REntity", "Position"), QT_TRANSLATE_NOOP("REntity", "Z"), false, RPropertyAttributes::Geometry);
    RViewportEntity::PropertyWidth.generateId(RViewportEntity::getRtti(), "", QT_TRANSLATE_NOOP("REntity", "Width"), false, RPropertyAttributes::Geometry);
    RViewportEntity::PropertyHeight.generateId(RViewportEntity::getRtti(), "", QT_TRANSLATE_NOOP("REntity", "Height"), false, RPropertyAttributes::Geometry);
    RViewportEntity::PropertyScale.generateId(RViewportEntity::getRtti(), "", QT_TRANSLATE_NOOP("REntity", "Scale"), false, RPropertyAttributes::Geometry);
    RViewportEntity::PropertyRotation.generateId(RViewportEntity::getRtti(), "", QT_TRANSLATE_NOOP("REntity", "Rotation"), false, RPropertyAttributes::Geometry);
    RViewportEntity::PropertyOn.generateId(RViewportEntity::getRtti(), "", QT_TRANSLATE_NOOP("REntity", "On"));
    RViewportEntity::PropertyLocked.generateId(RViewportEntity::getRtti(), "", QT_TRANSLATE_NOOP("REntity", "Locked"));
    RViewportEntity::PropertyViewCenterX.generateId(RViewportEntity::getRtti(), QT_TRANSLATE_NOOP("REntity", "View Center"), QT_TRANSLATE_NOOP("REntity", "X"), false, RPropertyAttributes::Geometry);
    RViewportEntity::PropertyViewCenterY.generateId(RViewportEntity::getRtti(), QT_TRANSLATE_NOOP("REntity", "View Center"), QT_TRANSLATE_NOOP("REntity", "Y"), false, RPropertyAttributes::Geometry);
    RViewportEntity::PropertyViewTargetX.generateId(RViewportEntity::getRtti(), QT_TRANSLATE_NOOP("REntity", "View Target"), QT_TRANSLATE_NOOP("REntity", "X"), false, RPropertyAttributes::Geometry);
    RViewportEntity::PropertyViewTargetY.generateId(RViewportEntity::getRtti(), QT_TRANSLATE_NOOP("REntity", "View Target"), QT_TRANSLATE_NOOP("REntity", "Y"), false, RPropertyAttributes::Geometry);
    RViewportEntity::PropertyViewTargetZ.generateId(RViewportEntity::getRtti(), QT_TRANSLATE_NOOP("REntity", "View Target"), QT_TRANSLATE_NOOP("REntity", "Z"), false, RPropertyAttributes::Geometry);

    RViewportEntity::PropertyOverall.generateId(RViewportEntity::getRtti(), "", QT_TRANSLATE_NOOP("REntity", "Overall"));

    RViewportEntity::PropertyFrozenLayerIds.generateId(RViewportEntity::getRtti(), QT_TRANSLATE_NOOP("REntity", "Frozen Layers"), QT_TRANSLATE_NOOP("REntity", "Layer ID"));
}

bool RViewportEntity::setProperty(RPropertyTypeId propertyTypeId,
        const QVariant& value, RTransaction* transaction) {

    // CaveCAD: a locked viewport keeps its scale and what it shows:
    if (data.isLocked() && (
            propertyTypeId==PropertyScale || propertyTypeId==PropertyRotation ||
            propertyTypeId==PropertyViewCenterX || propertyTypeId==PropertyViewCenterY ||
            propertyTypeId==PropertyViewTargetX || propertyTypeId==PropertyViewTargetY ||
            propertyTypeId==PropertyViewTargetZ)) {
        return false;
    }

    bool ret = REntity::setProperty(propertyTypeId, value, transaction);
    ret = ret || RObject::setMember(data.position.x, value, PropertyCenterX == propertyTypeId);
    ret = ret || RObject::setMember(data.position.y, value, PropertyCenterY == propertyTypeId);
    ret = ret || RObject::setMember(data.position.z, value, PropertyCenterZ == propertyTypeId);
    ret = ret || RObject::setMember(data.width, value, PropertyWidth == propertyTypeId);
    ret = ret || RObject::setMember(data.height, value, PropertyHeight == propertyTypeId);
    ret = ret || RObject::setMember(data.scaleFactor, value, PropertyScale == propertyTypeId);
    ret = ret || RObject::setMember(data.rotation, value, PropertyRotation == propertyTypeId);
    ret = ret || RObject::setMember(data.viewCenter.x, value, PropertyViewCenterX == propertyTypeId);
    ret = ret || RObject::setMember(data.viewCenter.y, value, PropertyViewCenterY == propertyTypeId);
    ret = ret || RObject::setMember(data.viewTarget.x, value, PropertyViewTargetX == propertyTypeId);
    ret = ret || RObject::setMember(data.viewTarget.y, value, PropertyViewTargetY == propertyTypeId);
    ret = ret || RObject::setMember(data.viewTarget.z, value, PropertyViewTargetZ == propertyTypeId);
    ret = ret || RObject::setMember(data.overall, value, PropertyOverall == propertyTypeId);
    ret = ret || RObject::setMember(data.frozenLayerIds, value, PropertyFrozenLayerIds == propertyTypeId);

    if (PropertyOn==propertyTypeId) {
        bool on = !data.isOff();
        ret = ret || RObject::setMember(on, value);
        data.setOff(!on);
    }
    if (PropertyLocked==propertyTypeId) {
        bool locked = data.isLocked();
        ret = ret || RObject::setMember(locked, value);
        data.setLocked(locked);
    }

    return ret;
}

QPair<QVariant, RPropertyAttributes> RViewportEntity::getProperty(
        RPropertyTypeId& propertyTypeId, bool humanReadable, bool noAttributes, bool showOnRequest) {

    if (propertyTypeId == PropertyCenterX) {
        return qMakePair(QVariant(data.position.x), RPropertyAttributes());
    } else if (propertyTypeId == PropertyCenterY) {
        return qMakePair(QVariant(data.position.y), RPropertyAttributes());
    } else if (propertyTypeId == PropertyCenterZ) {
        return qMakePair(QVariant(data.position.z), RPropertyAttributes());
    } else if (propertyTypeId == PropertyWidth) {
        return qMakePair(QVariant(data.width), RPropertyAttributes());
    } else if (propertyTypeId == PropertyHeight) {
        return qMakePair(QVariant(data.height), RPropertyAttributes());
    } else if (propertyTypeId == PropertyScale) {
        return qMakePair(QVariant(data.scaleFactor), RPropertyAttributes(RPropertyAttributes::Scale));
    } else if (propertyTypeId == PropertyRotation) {
        return qMakePair(QVariant(data.rotation), RPropertyAttributes(RPropertyAttributes::Angle));
    } else if (propertyTypeId == PropertyOn) {
        return qMakePair(QVariant(!data.isOff()), RPropertyAttributes());
    } else if (propertyTypeId == PropertyLocked) {
        return qMakePair(QVariant(data.isLocked()), RPropertyAttributes());
    } else if (propertyTypeId == PropertyViewCenterX) {
        return qMakePair(QVariant(data.viewCenter.x), RPropertyAttributes());
    } else if (propertyTypeId == PropertyViewCenterY) {
        return qMakePair(QVariant(data.viewCenter.y), RPropertyAttributes());
    } else if (propertyTypeId == PropertyViewTargetX) {
        return qMakePair(QVariant(data.viewTarget.x), RPropertyAttributes());
    } else if (propertyTypeId == PropertyViewTargetY) {
        return qMakePair(QVariant(data.viewTarget.y), RPropertyAttributes());
    } else if (propertyTypeId == PropertyViewTargetZ) {
        return qMakePair(QVariant(data.viewTarget.z), RPropertyAttributes());
    } else if (propertyTypeId == PropertyOverall) {
        return qMakePair(QVariant(data.overall), RPropertyAttributes(RPropertyAttributes::ReadOnly|RPropertyAttributes::Invisible));
    } else if (propertyTypeId == PropertyFrozenLayerIds) {
        QVariant v;
        v.setValue(data.frozenLayerIds);
        return qMakePair(v, RPropertyAttributes(RPropertyAttributes::List|RPropertyAttributes::ReadOnly|RPropertyAttributes::Integer|RPropertyAttributes::Invisible));
    }
    return REntity::getProperty(propertyTypeId, humanReadable, noAttributes, showOnRequest);
}

void RViewportEntity::setData(RViewportData& d) {
    data = d;
    data.setDocument(getDocument());
}

/**
 * CaveCAD: the shape of a polygonal viewport, or an empty path for the plain
 * rectangle. Stored as custom properties CaveCAD/Clip0, Clip1, ... (a file
 * keeps strings only ~1000 characters, so the text is cut in pieces):
 *
 *   loop|loop|...   loop = x,y;x,y;...   (paper units from the viewport centre)
 *
 * The first loop is the outline; each later loop is a piece CUT OUT of it.
 */
QPainterPath RViewportEntity::getClipShape() const {
    QString text;
    for (int i = 0; i < 64; i++) {
        QString piece = getCustomProperty("CaveCAD", QString("Clip%1").arg(i), QString()).toString();
        if (piece.isEmpty()) {
            break;
        }
        text += piece;
    }
    if (text.isEmpty()) {
        return QPainterPath();
    }
    QPainterPath result;
    bool first = true;
    QStringList loops = text.split('|', Qt::SkipEmptyParts);
    for (int l = 0; l < loops.length(); l++) {
        QPolygonF poly;
        QStringList pts = loops[l].split(';', Qt::SkipEmptyParts);
        for (int k = 0; k < pts.length(); k++) {
            QStringList xy = pts[k].split(',');
            if (xy.length() == 2) {
                poly << QPointF(data.position.x + xy[0].toDouble(), data.position.y + xy[1].toDouble());
            }
        }
        if (poly.length() < 3) {
            continue;
        }
        QPainterPath loop;
        loop.addPolygon(poly);
        loop.closeSubpath();
        if (first) {
            result = loop;
            first = false;
        }
        else {
            result = result.subtracted(loop);
        }
    }
    return first ? QPainterPath() : result;
}

void RViewportEntity::exportEntity(RExporter& e, bool preview, bool forceSelected) const {
    Q_UNUSED(preview)
    Q_UNUSED(forceSelected)

    RDocument* doc = (RDocument*)getDocument();
    if (doc==NULL) {
        return;
    }

    // CaveCAD: the "overall" viewport (id 1) is the paper itself, not a
    // window onto model space; it draws nothing.
    if (data.overall) {
        return;
    }

    RBox viewportBox(data.position, data.width, data.height);

    bool active = getId()==doc->getCurrentViewportId();

    // if layer is visible or active, export viewport frame
    // viewport contents is always exported (unless viewport if off):
    RLayer::Id layerId = getLayerId();
    if (!doc->isLayerOff(layerId) || active) {
        // export viewport frame to layer of viewport:
        e.setBrush(Qt::NoBrush);

        // export active viewport with fixed pixel width thick frame:
        if (active) {
            QPen pen = e.getPen();
            pen.setWidthF(4);
            QVector<qreal> pat;
            pat << 5.0 << 5.0;
            pen.setDashPattern(pat);
            e.setPen(pen);

            e.setPixelWidth(true);
        }
        QPainterPath shape = getClipShape();
        if (shape.isEmpty()) {
            QList<RLine> lines = viewportBox.getLines2d();
            for (int i=0; i<lines.length(); i++) {
                e.exportLine(lines[i]);
            }
        }
        else {
            // a polygonal / trimmed viewport draws its own outline
            QList<QPolygonF> outline = shape.toSubpathPolygons();
            for (int p=0; p<outline.length(); p++) {
                for (int k=0; k+1<outline[p].length(); k++) {
                    e.exportLine(RLine(RVector(outline[p][k].x(), outline[p][k].y()),
                                       RVector(outline[p][k+1].x(), outline[p][k+1].y())));
                }
            }
        }
        if (active) {
            e.setPixelWidth(false);
        }
    }

    // if viewport is off, we're done:
    if (isOff()) {
        return;
    }

    // clip rectangle export
    {
        QPainterPath shape = getClipShape();
        if (shape.isEmpty()) {
            e.exportClipRectangle(viewportBox);
        }
        else {
            QRectF bb = shape.boundingRect();
            e.exportClipRectangle(RBox(RVector(bb.left(), bb.top()), RVector(bb.right(), bb.bottom())));
            e.exportClipPath(shape);
        }
    }

    //RVector offset = getViewOffset();
    //RVector offset(0,0);
    //offset -= data.viewCenter * data.scale;
    //offset -= data.viewTarget * data.scale;

    QSharedPointer<RBlock> model = doc->queryBlockDirect(doc->getModelSpaceBlockId());

    model->setOrigin(data.viewCenter + data.viewTarget);

    // create temporary block reference to model space block:
    RBlockReferenceData modelSpaceData(
        doc,
        RBlockReferenceData(
            doc->getModelSpaceBlockId(),
            //data.position + offset,
            //offset,
            data.position,
            RVector(data.scaleFactor, data.scaleFactor),
            //0.0
            data.rotation
        )
    );
    //modelSpaceData.scaleVisualProperties(data.scaleFactor);
    //modelSpaceData.update();

    RTransform blockRefTransform = modelSpaceData.getTransform();
//    RTransform rot;
//    rot.rotateRadians(data.rotation);
//    rot *= blockRefTransform;
//    blockRefTransform = rot;
    //blockRefTransform.translate(offset.x, offset.y);
    e.exportTransform(blockRefTransform);

    // start clipping from here:
    e.setClipping(true);

    // freeze viewport layers:
    QList<RLayer::Id> frozenLayerIds = getFrozenLayerIds();
    QList<QSharedPointer<RLayer> > defrostLayers;
    QList<QSharedPointer<RLayer> > showLayers;
    for (int i=0; i<frozenLayerIds.length(); i++) {
        RLayer::Id frozenLayerId = frozenLayerIds[i];
        QSharedPointer<RLayer> layer = doc->queryLayerDirect(frozenLayerId);
        if (layer.isNull()) {
            continue;
        }

        // freeze layer:
        if (!layer->isFrozen()) {
            layer->setFrozen(true);
            defrostLayers.append(layer);
        }
        // show layer:
        if (!layer->isOff()) {
            layer->setOff(true);
            showLayers.append(layer);
        }
    }

    // CaveCAD: a viewport can be told not to show raster images (scanned
    // field-book pages, aerial photographs). A plotted cave map must not
    // carry imagery: an aerial is the cave's location baked into a
    // picture. Custom property ("CaveCAD", "NoRaster") = 1; no member, so
    // no header layout change.
    const bool noRaster = getCustomProperty("CaveCAD", "NoRaster", false).toBool();

    // CaveCAD: annotative text drawn inside this viewport takes the viewport's own
    // scale (feet per inch), whatever the document's current annotation scale is.
    const double annotationScaleBefore = e.getAnnotationScale();
    e.setAnnotationScale(RAnnotation::scaleOfViewport(doc, data.scaleFactor));

    // render model space block reference into viewport.
    //
    // CaveCAD: only the model entities whose box meets the part of model
    // space this viewport shows are exported. The stock code visited EVERY
    // model entity per viewport per regenerate (measured: ~0.8 s per
    // viewport at 100k entities); the spatial index answers in a fraction
    // of that. The viewport frame is mapped back into model space (twist
    // included) and grown by the widest line weight, which a bounding box
    // does not hold.
    RBox modelQuery;
    {
        QList<RVector> corners;
        corners.append(RVector(viewportBox.c1.x, viewportBox.c1.y));
        corners.append(RVector(viewportBox.c2.x, viewportBox.c1.y));
        corners.append(RVector(viewportBox.c2.x, viewportBox.c2.y));
        corners.append(RVector(viewportBox.c1.x, viewportBox.c2.y));
        QList<RVector> mapped;
        for (int c=0; c<corners.length(); c++) {
            mapped.append(modelSpaceData.mapToBlock(corners[c]));
        }
        modelQuery = RBox(RVector::getMinimum(mapped), RVector::getMaximum(mapped));
        double lineweightGrow = RUnit::convert(doc->getMaxLineweight()/100.0, RS::Millimeter, doc->getUnit());
        if (data.scaleFactor>1e-12) {
            lineweightGrow /= data.scaleFactor;
        }
        modelQuery.growXY(lineweightGrow + modelQuery.getWidth()*1e-6 + modelQuery.getHeight()*1e-6);
    }
    QSet<REntity::Id> ids = doc->queryIntersectedEntitiesXY(modelQuery, true, true, doc->getModelSpaceBlockId());
    QList<REntity::Id> list = doc->getStorage().orderBackToFront(ids);
    int i;
    QList<REntity::Id>::iterator it;
    for (it = list.begin(), i = 0; it != list.end(); it++) {
        if (preview && i>RSettings::getPreviewEntities()) {
            break;
        }

        //QSharedPointer<REntity> entity = modelSpaceData.queryEntity(*it, true);
        QSharedPointer<REntity> entity = modelSpaceData.queryEntity(*it);
        if (entity.isNull()) {
            continue;
        }

        // prevent recursions:
        if (entity->isOfType(RS::EntityViewport)) {
            continue;
        }

        if (noRaster && entity->isOfType(RS::EntityImage)) {
            continue;
        }

//        if (entity->isOfType(RS::EntityBlockRef)) {
//            QSharedPointer<RBlockReferenceEntity> blockRef = entity.dynamicCast<RBlockReferenceEntity>();
//            blockRef->scaleVisualProperties(blockRef->getScaleFactors().x);
//        }

        // transform according to viewport settings:
        //entity->rotate(data.rotation, data.position);

        RBox bb = entity->getBoundingBox();
        bb.c1.z = 0;
        bb.c2.z = 0;
        bb.transform(blockRefTransform);
        if (!viewportBox.intersects(bb)) {
            continue;
        }

        if (doc->getKnownVariable(RS::PSLTSCALE, true).toBool()==false) {
            // scale line type pattern to match viewport scale:
            entity->setLinetypeScale(entity->getLinetypeScale() * data.scaleFactor);
        }

        if (entity->getType()==RS::EntityHatch) {
            entity->setViewportContext(data);
        }

        //RDebug::startTimer(7);
        e.exportEntity(entity, preview, true);
        //RDebug::stopTimer(7, "export entity as part of viewport");

        i++;
    }

    // defrost viewport layers that were frozen above:
    {
        QList<QSharedPointer<RLayer> >::iterator it;
        for (it=defrostLayers.begin(); it!=defrostLayers.end(); it++) {
            QSharedPointer<RLayer> defrostLayer = (*it);
            defrostLayer->setFrozen(false);
        }
    }
    // show viewport layers that were hidden above:
    {
        QList<QSharedPointer<RLayer> >::iterator it;
        for (it=showLayers.begin(); it!=showLayers.end(); it++) {
            QSharedPointer<RLayer> showLayer = (*it);
            showLayer->setOff(false);
        }
    }

    e.setClipping(false);
    e.setAnnotationScale(annotationScaleBefore);

    model->setOrigin(RVector(0,0));

    e.exportEndTransform();
}

void RViewportEntity::print(QDebug dbg) const {
    dbg.nospace() << "RViewportEntity(";
    REntity::print(dbg);
    dbg.nospace() << ", center: " << data.getCenter()
                  << ", width: " << data.getWidth()
                  << ", height: " << data.getHeight()
    << ")";
}
