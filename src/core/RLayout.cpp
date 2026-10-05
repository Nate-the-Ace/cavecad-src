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
#include "RLayout.h"

RPropertyTypeId RLayout::PropertyType;
RPropertyTypeId RLayout::PropertyCustom;
RPropertyTypeId RLayout::PropertyName;
RPropertyTypeId RLayout::PropertyTabOrder;

RPropertyTypeId RLayout::PropertyMinLimitsX;
RPropertyTypeId RLayout::PropertyMinLimitsY;
RPropertyTypeId RLayout::PropertyMinLimitsZ;
RPropertyTypeId RLayout::PropertyMaxLimitsX;
RPropertyTypeId RLayout::PropertyMaxLimitsY;
RPropertyTypeId RLayout::PropertyMaxLimitsZ;
RPropertyTypeId RLayout::PropertyInsertionBaseX;
RPropertyTypeId RLayout::PropertyInsertionBaseY;
RPropertyTypeId RLayout::PropertyInsertionBaseZ;
RPropertyTypeId RLayout::PropertyMinExtentsX;
RPropertyTypeId RLayout::PropertyMinExtentsY;
RPropertyTypeId RLayout::PropertyMinExtentsZ;
RPropertyTypeId RLayout::PropertyMaxExtentsX;
RPropertyTypeId RLayout::PropertyMaxExtentsY;
RPropertyTypeId RLayout::PropertyMaxExtentsZ;

RPropertyTypeId RLayout::PropertyPlotPaperMarginLeftMM;
RPropertyTypeId RLayout::PropertyPlotPaperMarginBottomMM;
RPropertyTypeId RLayout::PropertyPlotPaperMarginRightMM;
RPropertyTypeId RLayout::PropertyPlotPaperMarginTopMM;
RPropertyTypeId RLayout::PropertyPlotPaperSizeWidth;
RPropertyTypeId RLayout::PropertyPlotPaperSizeHeight;
RPropertyTypeId RLayout::PropertyPlotOriginX;
RPropertyTypeId RLayout::PropertyPlotOriginY;
RPropertyTypeId RLayout::PropertyPlotWindowAreaMinX;
RPropertyTypeId RLayout::PropertyPlotWindowAreaMinY;
RPropertyTypeId RLayout::PropertyPlotWindowAreaMaxX;
RPropertyTypeId RLayout::PropertyPlotWindowAreaMaxY;
RPropertyTypeId RLayout::PropertyNumeratorCustomScale;
RPropertyTypeId RLayout::PropertyDenominatorCustomScale;
RPropertyTypeId RLayout::PropertyPlotPaperUnits;
RPropertyTypeId RLayout::PropertyPlotRotation;
RPropertyTypeId RLayout::PropertyPlotType;
RPropertyTypeId RLayout::PropertyUseStandardScale;
RPropertyTypeId RLayout::PropertyStandardScale;
RPropertyTypeId RLayout::PropertyStandardScaleType;
RPropertyTypeId RLayout::PropertyCanonicalMediaName;

RLayout::RLayout() :
    RObject(),
    tabOrder(0),
    plotPaperMarginLeftMM(0.0),
    plotPaperMarginBottomMM(0.0),
    plotPaperMarginRightMM(0.0),
    plotPaperMarginTopMM(0.0),
    numeratorCustomScale(1.0),
    denominatorCustomScale(1.0),
    plotPaperUnits(Millimeters),
    plotRotation(Zero),
    plotType(Layout),
    useStandardScale(false),
    standardScale(1.0),
    standardScaleType(Scale_1_1) {
}

RLayout::RLayout(RDocument* document, const QString& name) :
    RObject(document),
    name(name.trimmed()),
    tabOrder(0),
    plotPaperMarginLeftMM(0.0),
    plotPaperMarginBottomMM(0.0),
    plotPaperMarginRightMM(0.0),
    plotPaperMarginTopMM(0.0),
    numeratorCustomScale(1.0),
    denominatorCustomScale(1.0),
    plotPaperUnits(Millimeters),
    plotRotation(Zero),
    plotType(Layout),
    useStandardScale(false),
    standardScale(1.0),
    standardScaleType(Scale_1_1) {
}

RLayout::~RLayout() {
}

void RLayout::init() {
    RLayout::PropertyType.generateId(RLayout::getRtti(), RObject::PropertyType);
    RLayout::PropertyCustom.generateId(RLayout::getRtti(), RObject::PropertyCustom);
    RLayout::PropertyName.generateId(RLayout::getRtti(), "", QT_TRANSLATE_NOOP("REntity", "Name"));
    RLayout::PropertyTabOrder.generateId(RLayout::getRtti(), "", QT_TRANSLATE_NOOP("REntity", "Tab Order"));
    RLayout::PropertyMinLimitsX.generateId(RLayout::getRtti(), QT_TRANSLATE_NOOP("REntity", "Min Limits"), QT_TRANSLATE_NOOP("REntity", "X"));
    RLayout::PropertyMinLimitsY.generateId(RLayout::getRtti(), QT_TRANSLATE_NOOP("REntity", "Min Limits"), QT_TRANSLATE_NOOP("REntity", "Y"));
    RLayout::PropertyMinLimitsZ.generateId(RLayout::getRtti(), QT_TRANSLATE_NOOP("REntity", "Min Limits"), QT_TRANSLATE_NOOP("REntity", "Z"));
    RLayout::PropertyMaxLimitsX.generateId(RLayout::getRtti(), QT_TRANSLATE_NOOP("REntity", "Max Limits"), QT_TRANSLATE_NOOP("REntity", "X"));
    RLayout::PropertyMaxLimitsY.generateId(RLayout::getRtti(), QT_TRANSLATE_NOOP("REntity", "Max Limits"), QT_TRANSLATE_NOOP("REntity", "Y"));
    RLayout::PropertyMaxLimitsZ.generateId(RLayout::getRtti(), QT_TRANSLATE_NOOP("REntity", "Max Limits"), QT_TRANSLATE_NOOP("REntity", "Z"));
    RLayout::PropertyInsertionBaseX.generateId(RLayout::getRtti(), QT_TRANSLATE_NOOP("REntity", "Insertion Base"), QT_TRANSLATE_NOOP("REntity", "X"));
    RLayout::PropertyInsertionBaseY.generateId(RLayout::getRtti(), QT_TRANSLATE_NOOP("REntity", "Insertion Base"), QT_TRANSLATE_NOOP("REntity", "Y"));
    RLayout::PropertyInsertionBaseZ.generateId(RLayout::getRtti(), QT_TRANSLATE_NOOP("REntity", "Insertion Base"), QT_TRANSLATE_NOOP("REntity", "Z"));
    RLayout::PropertyMinExtentsX.generateId(RLayout::getRtti(), QT_TRANSLATE_NOOP("REntity", "Min Extents"), QT_TRANSLATE_NOOP("REntity", "X"));
    RLayout::PropertyMinExtentsY.generateId(RLayout::getRtti(), QT_TRANSLATE_NOOP("REntity", "Min Extents"), QT_TRANSLATE_NOOP("REntity", "Y"));
    RLayout::PropertyMinExtentsZ.generateId(RLayout::getRtti(), QT_TRANSLATE_NOOP("REntity", "Min Extents"), QT_TRANSLATE_NOOP("REntity", "Z"));
    RLayout::PropertyMaxExtentsX.generateId(RLayout::getRtti(), QT_TRANSLATE_NOOP("REntity", "Max Extents"), QT_TRANSLATE_NOOP("REntity", "X"));
    RLayout::PropertyMaxExtentsY.generateId(RLayout::getRtti(), QT_TRANSLATE_NOOP("REntity", "Max Extents"), QT_TRANSLATE_NOOP("REntity", "Y"));
    RLayout::PropertyMaxExtentsZ.generateId(RLayout::getRtti(), QT_TRANSLATE_NOOP("REntity", "Max Extents"), QT_TRANSLATE_NOOP("REntity", "Z"));

    // TODO: make these properties translatable
    RLayout::PropertyPlotPaperMarginLeftMM.generateId(RLayout::getRtti(), "Plot Margins", QT_TRANSLATE_NOOP("REntity", "Left"));
    RLayout::PropertyPlotPaperMarginBottomMM.generateId(RLayout::getRtti(), "Plot Margins", QT_TRANSLATE_NOOP("REntity", "Bottom"));
    RLayout::PropertyPlotPaperMarginRightMM.generateId(RLayout::getRtti(), "Plot Margins", QT_TRANSLATE_NOOP("REntity", "Right"));
    RLayout::PropertyPlotPaperMarginTopMM.generateId(RLayout::getRtti(), "Plot Margins", QT_TRANSLATE_NOOP("REntity", "Top"));
    RLayout::PropertyPlotPaperSizeWidth.generateId(RLayout::getRtti(), "Plot Paper Size", QT_TRANSLATE_NOOP("REntity", "Width"));
    RLayout::PropertyPlotPaperSizeHeight.generateId(RLayout::getRtti(), "Plot Paper Size", QT_TRANSLATE_NOOP("REntity", "Height"));
    RLayout::PropertyPlotOriginX.generateId(RLayout::getRtti(), "Plot Origin", "X");
    RLayout::PropertyPlotOriginY.generateId(RLayout::getRtti(), "Plot Origin", "Y");
    RLayout::PropertyPlotWindowAreaMinX.generateId(RLayout::getRtti(), "Plot Window Area Min", "X");
    RLayout::PropertyPlotWindowAreaMinY.generateId(RLayout::getRtti(), "Plot Window Area Min", "Y");
    RLayout::PropertyPlotWindowAreaMaxX.generateId(RLayout::getRtti(), "Plot Window Area Max", "X");
    RLayout::PropertyPlotWindowAreaMaxY.generateId(RLayout::getRtti(), "Plot Window Area Max", "Y");
    RLayout::PropertyNumeratorCustomScale.generateId(RLayout::getRtti(), "Custom Scale", "Numerator");
    RLayout::PropertyDenominatorCustomScale.generateId(RLayout::getRtti(), "Custom Scale", "Denominator");
    RLayout::PropertyPlotPaperUnits.generateId(RLayout::getRtti(), "", "Plot Paper Units");
    RLayout::PropertyPlotRotation.generateId(RLayout::getRtti(), "", "Plot Rotation");
    RLayout::PropertyPlotType.generateId(RLayout::getRtti(), "", "Plot Type");
    RLayout::PropertyUseStandardScale.generateId(RLayout::getRtti(), "", "Use Standard Scale");
    RLayout::PropertyStandardScale.generateId(RLayout::getRtti(), "", "Standard Scale");
    RLayout::PropertyStandardScaleType.generateId(RLayout::getRtti(), "", "Standard Scale Type");
    RLayout::PropertyCanonicalMediaName.generateId(RLayout::getRtti(), "", "Media Name");
}

void RLayout::setName(const QString& n) {
    name = n.trimmed();
}

bool RLayout::setProperty(RPropertyTypeId propertyTypeId,
    const QVariant& value, RTransaction* transaction) {

    bool ret = RObject::setProperty(propertyTypeId, value, transaction);

    if (PropertyName == propertyTypeId) {
        // never change name of layouts starting with * (model space, paper space, ...):
        if (name.startsWith("*")) {
            return false;
        }
        // never change layout name to empty string:
        if (value.toString().isEmpty()) {
            return false;
        }
    }

    ret = ret || RObject::setMember(name, value.toString().trimmed(), PropertyName == propertyTypeId);
    ret = ret || RObject::setMember(tabOrder, value, PropertyTabOrder == propertyTypeId);

    ret = ret || RObject::setMember(minLimits.x, value, PropertyMinLimitsX == propertyTypeId);
    ret = ret || RObject::setMember(minLimits.y, value, PropertyMinLimitsY == propertyTypeId);
    ret = ret || RObject::setMember(minLimits.z, value, PropertyMinLimitsZ == propertyTypeId);
    ret = ret || RObject::setMember(maxLimits.x, value, PropertyMaxLimitsX == propertyTypeId);
    ret = ret || RObject::setMember(maxLimits.y, value, PropertyMaxLimitsY == propertyTypeId);
    ret = ret || RObject::setMember(maxLimits.z, value, PropertyMaxLimitsZ == propertyTypeId);
    ret = ret || RObject::setMember(insertionBase.x, value, PropertyInsertionBaseX == propertyTypeId);
    ret = ret || RObject::setMember(insertionBase.y, value, PropertyInsertionBaseY == propertyTypeId);
    ret = ret || RObject::setMember(insertionBase.z, value, PropertyInsertionBaseZ == propertyTypeId);
    ret = ret || RObject::setMember(minExtents.x, value, PropertyMinExtentsX == propertyTypeId);
    ret = ret || RObject::setMember(minExtents.y, value, PropertyMinExtentsY == propertyTypeId);
    ret = ret || RObject::setMember(minExtents.z, value, PropertyMinExtentsZ == propertyTypeId);
    ret = ret || RObject::setMember(maxExtents.x, value, PropertyMaxExtentsX == propertyTypeId);
    ret = ret || RObject::setMember(maxExtents.y, value, PropertyMaxExtentsY == propertyTypeId);
    ret = ret || RObject::setMember(maxExtents.z, value, PropertyMaxExtentsZ == propertyTypeId);

    ret = ret || RObject::setMember(plotPaperMarginLeftMM, value, PropertyPlotPaperMarginLeftMM == propertyTypeId);
    ret = ret || RObject::setMember(plotPaperMarginBottomMM, value, PropertyPlotPaperMarginBottomMM == propertyTypeId);
    ret = ret || RObject::setMember(plotPaperMarginRightMM, value, PropertyPlotPaperMarginRightMM == propertyTypeId);
    ret = ret || RObject::setMember(plotPaperMarginTopMM, value, PropertyPlotPaperMarginTopMM == propertyTypeId);
    ret = ret || RObject::setMember(plotPaperSize.x, value, PropertyPlotPaperSizeWidth == propertyTypeId);
    ret = ret || RObject::setMember(plotPaperSize.y, value, PropertyPlotPaperSizeHeight == propertyTypeId);
    ret = ret || RObject::setMember(plotOrigin.x, value, PropertyPlotOriginX == propertyTypeId);
    ret = ret || RObject::setMember(plotOrigin.y, value, PropertyPlotOriginY == propertyTypeId);
    ret = ret || RObject::setMember(plotWindowAreaMin.x, value, PropertyPlotWindowAreaMinX == propertyTypeId);
    ret = ret || RObject::setMember(plotWindowAreaMin.y, value, PropertyPlotWindowAreaMinY == propertyTypeId);
    ret = ret || RObject::setMember(plotWindowAreaMax.x, value, PropertyPlotWindowAreaMaxX == propertyTypeId);
    ret = ret || RObject::setMember(plotWindowAreaMax.y, value, PropertyPlotWindowAreaMaxY == propertyTypeId);
    ret = ret || RObject::setMember(numeratorCustomScale, value, PropertyNumeratorCustomScale == propertyTypeId);
    ret = ret || RObject::setMember(denominatorCustomScale, value, PropertyDenominatorCustomScale == propertyTypeId);
    ret = ret || RObject::setMember(plotPaperUnits, value, PropertyPlotPaperUnits == propertyTypeId);
    ret = ret || RObject::setMember(plotRotation, value, PropertyPlotRotation == propertyTypeId);
    ret = ret || RObject::setMember(plotType, value, PropertyPlotType == propertyTypeId);
    ret = ret || RObject::setMember(useStandardScale, value, PropertyUseStandardScale == propertyTypeId);
    ret = ret || RObject::setMember(standardScale, value, PropertyStandardScale == propertyTypeId);
    ret = ret || RObject::setMember(standardScaleType, value, PropertyStandardScaleType == propertyTypeId);
    ret = ret || RObject::setMember(canonicalMediaName, value, PropertyCanonicalMediaName == propertyTypeId);

    return ret;
}

QPair<QVariant, RPropertyAttributes> RLayout::getProperty(
        RPropertyTypeId& propertyTypeId,
        bool humanReadable, bool noAttributes, bool showOnRequest) {

    if (propertyTypeId == PropertyName) {
        return qMakePair(QVariant(name), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyTabOrder) {
        return qMakePair(QVariant(tabOrder), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyMinLimitsX) {
        return qMakePair(QVariant(minLimits.x), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyMinLimitsY) {
        return qMakePair(QVariant(minLimits.y), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyMinLimitsZ) {
        return qMakePair(QVariant(minLimits.z), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyMaxLimitsX) {
        return qMakePair(QVariant(maxLimits.x), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyMaxLimitsY) {
        return qMakePair(QVariant(maxLimits.y), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyMaxLimitsZ) {
        return qMakePair(QVariant(maxLimits.z), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyInsertionBaseX) {
        return qMakePair(QVariant(insertionBase.x), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyInsertionBaseY) {
        return qMakePair(QVariant(insertionBase.y), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyInsertionBaseZ) {
        return qMakePair(QVariant(insertionBase.z), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyMinExtentsX) {
        return qMakePair(QVariant(minExtents.x), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyMinExtentsY) {
        return qMakePair(QVariant(minExtents.y), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyMinExtentsZ) {
        return qMakePair(QVariant(minExtents.z), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyMaxExtentsX) {
        return qMakePair(QVariant(maxExtents.x), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyMaxExtentsY) {
        return qMakePair(QVariant(maxExtents.y), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyMaxExtentsZ) {
        return qMakePair(QVariant(maxExtents.z), RPropertyAttributes());
    }

    else if (propertyTypeId == PropertyPlotPaperMarginLeftMM) {
        return qMakePair(QVariant(plotPaperMarginLeftMM), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyPlotPaperMarginBottomMM) {
        return qMakePair(QVariant(plotPaperMarginBottomMM), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyPlotPaperMarginRightMM) {
        return qMakePair(QVariant(plotPaperMarginRightMM), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyPlotPaperMarginTopMM) {
        return qMakePair(QVariant(plotPaperMarginTopMM), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyPlotPaperSizeWidth) {
        return qMakePair(QVariant(plotPaperSize.x), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyPlotPaperSizeHeight) {
        return qMakePair(QVariant(plotPaperSize.y), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyPlotOriginX) {
        return qMakePair(QVariant(plotOrigin.x), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyPlotOriginY) {
        return qMakePair(QVariant(plotOrigin.y), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyPlotWindowAreaMinX) {
        return qMakePair(QVariant(plotWindowAreaMin.x), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyPlotWindowAreaMinY) {
        return qMakePair(QVariant(plotWindowAreaMin.y), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyPlotWindowAreaMaxX) {
        return qMakePair(QVariant(plotWindowAreaMax.x), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyPlotWindowAreaMaxY) {
        return qMakePair(QVariant(plotWindowAreaMax.y), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyNumeratorCustomScale) {
        return qMakePair(QVariant(numeratorCustomScale), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyDenominatorCustomScale) {
        return qMakePair(QVariant(denominatorCustomScale), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyPlotPaperUnits) {
        return qMakePair(QVariant(plotPaperUnits), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyPlotRotation) {
        return qMakePair(QVariant(plotRotation), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyPlotType) {
        return qMakePair(QVariant(plotType), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyUseStandardScale) {
        return qMakePair(QVariant(useStandardScale), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyStandardScale) {
        return qMakePair(QVariant(standardScale), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyStandardScaleType) {
        return qMakePair(QVariant(standardScaleType), RPropertyAttributes());
    }
    else if (propertyTypeId == PropertyCanonicalMediaName) {
        return qMakePair(QVariant(canonicalMediaName), RPropertyAttributes());
    }

    return RObject::getProperty(propertyTypeId, humanReadable, noAttributes, showOnRequest);
}

void RLayout::print(QDebug dbg) const {
    dbg.nospace() << "RLayout(";
    RObject::print(dbg);
    dbg.nospace() << ", name: " << getName()
            << ", insertionBase: " << getInsertionBase()
            << ")";
}


static QString layoutNum(double v) {
    return QString::number(v, 'g', 17);
}

QMap<QString, QString> RLayout::toStorageMap() const {
    QMap<QString, QString> m;
    m.insert("name", name);
    m.insert("tab", QString::number(tabOrder));
    m.insert("mL", layoutNum(plotPaperMarginLeftMM));
    m.insert("mB", layoutNum(plotPaperMarginBottomMM));
    m.insert("mR", layoutNum(plotPaperMarginRightMM));
    m.insert("mT", layoutNum(plotPaperMarginTopMM));
    m.insert("paperW", layoutNum(plotPaperSize.x));
    m.insert("paperH", layoutNum(plotPaperSize.y));
    m.insert("originX", layoutNum(plotOrigin.x));
    m.insert("originY", layoutNum(plotOrigin.y));
    m.insert("numer", layoutNum(numeratorCustomScale));
    m.insert("denom", layoutNum(denominatorCustomScale));
    m.insert("units", QString::number((int)plotPaperUnits));
    m.insert("rot", QString::number((int)plotRotation));
    m.insert("ptype", QString::number((int)plotType));
    m.insert("useStd", useStandardScale ? "1" : "0");
    m.insert("std", layoutNum(standardScale));
    m.insert("stdType", QString::number((int)standardScaleType));
    m.insert("media", canonicalMediaName);

    QStringList titles = getCustomPropertyTitles();
    for (int i=0; i<titles.length(); i++) {
        QStringList keys = getCustomPropertyKeys(titles[i]);
        for (int k=0; k<keys.length(); k++) {
            QVariant v = getCustomProperty(titles[i], keys[k]);
            // "cp" + title + US + key: unit separator cannot occur in a title or key
            m.insert("cp" + titles[i] + QChar(0x1F) + keys[k], v.toString());
        }
    }
    return m;
}

void RLayout::fromStorageMap(const QMap<QString, QString>& m) {
    if (m.contains("name")) name = m.value("name").trimmed();
    if (m.contains("tab")) tabOrder = m.value("tab").toInt();
    if (m.contains("mL")) plotPaperMarginLeftMM = m.value("mL").toDouble();
    if (m.contains("mB")) plotPaperMarginBottomMM = m.value("mB").toDouble();
    if (m.contains("mR")) plotPaperMarginRightMM = m.value("mR").toDouble();
    if (m.contains("mT")) plotPaperMarginTopMM = m.value("mT").toDouble();
    if (m.contains("paperW")) plotPaperSize.x = m.value("paperW").toDouble();
    if (m.contains("paperH")) plotPaperSize.y = m.value("paperH").toDouble();
    if (m.contains("originX")) plotOrigin.x = m.value("originX").toDouble();
    if (m.contains("originY")) plotOrigin.y = m.value("originY").toDouble();
    if (m.contains("numer")) numeratorCustomScale = m.value("numer").toDouble();
    if (m.contains("denom")) denominatorCustomScale = m.value("denom").toDouble();
    if (m.contains("units")) plotPaperUnits = (PlotPaperUnits)m.value("units").toInt();
    if (m.contains("rot")) plotRotation = (PlotRotation)m.value("rot").toInt();
    if (m.contains("ptype")) plotType = (PlotType)m.value("ptype").toInt();
    if (m.contains("useStd")) useStandardScale = m.value("useStd")=="1";
    if (m.contains("std")) standardScale = m.value("std").toDouble();
    if (m.contains("stdType")) standardScaleType = (StandardScaleType)m.value("stdType").toInt();
    if (m.contains("media")) canonicalMediaName = m.value("media");

    QMap<QString, QString>::const_iterator it;
    for (it=m.constBegin(); it!=m.constEnd(); ++it) {
        if (!it.key().startsWith("cp")) {
            continue;
        }
        QString rest = it.key().mid(2);
        int sep = rest.indexOf(QChar(0x1F));
        if (sep<0) {
            continue;
        }
        setCustomProperty(rest.left(sep), rest.mid(sep+1), it.value());
    }
}
