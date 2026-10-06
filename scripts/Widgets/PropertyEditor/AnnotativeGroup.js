/**
 * AnnotativeGroup -- the Annotation section of the Property Editor.
 *
 *   [x] Annotative  [Scales v]        (for the selected text)
 *   Annotation scale: [1" = 1 ft v]  [All scales]
 *
 * The check box makes the selected text annotative (or ordinary again); the
 * Scales menu lists every scale -- all the imperial ones first, then the
 * metric ones -- with a tick on the ones the selected annotative text supports,
 * and picking one adds or removes it. The second row is the document's current
 * annotation scale and the switch that shows every scale of annotative text
 * with the others shaded back. See Annotate/Annotative.js for the model.
 */
include("scripts/Annotate/Annotative.js");

var AnnotativeGroup = {};

/** The selected texts: {all, annotative} entity ids. */
AnnotativeGroup.selection = function(doc) {
    var all = Annotative.textsOf(doc, doc.querySelectedEntities());
    var on = all.filter(function(id) { return Annotative.isAnnotative(doc.queryEntity(id)); });
    return { all: all, annotative: on };
};

AnnotativeGroup.build = function(editor) {
    var g = new QGroupBox(qsTr("Annotation"), editor.widget);
    g.objectName = "AnnotationGroup";
    var grid = new QGridLayout(g);
    grid.setVerticalSpacing(2);
    grid.setHorizontalSpacing(4);
    grid.setContentsMargins(6, 6, 6, 6);
    grid.setColumnStretch(0, 0);
    grid.setColumnStretch(1, 1);

    var check = new QCheckBox(qsTr("Annotative"), g);
    check.objectName = "AnnotativeCheck";
    check.toolTip = qsTr("Give the selected text a paper height and a list of scales: it then prints the same size at every viewport scale");
    var scales = new QPushButton(g);
    scales.objectName = "AnnotativeScales";
    scales.text = qsTr("Scales");
    scales.toolTip = qsTr("The scales the selected annotative text supports (a tick = supported); pick one to add or remove it");
    var menu = new QMenu(scales);
    scales.setMenu(menu);
    grid.addWidget(check, 0, 0, 1, 1);
    grid.addWidget(scales, 0, 1, 1, 1);

    var curLabel = new QLabel(qsTr("Annotation scale:"), g);
    var cur = new QComboBox(g);
    cur.objectName = "AnnotationScaleCombo";
    cur.toolTip = qsTr("The scale annotative text is shown at in the model. Inside a viewport, text follows that viewport's own scale.");
    var ghosts = new QToolButton(g);
    ghosts.objectName = "AnnotationAllScales";
    ghosts.text = qsTr("All scales");
    ghosts.checkable = true;
    ghosts.toolTip = qsTr("Show every scale of annotative text: the current one normal, the others shaded back");
    grid.addWidget(curLabel, 1, 0, 1, 1);
    var row = new QHBoxLayout();
    row.addWidget(cur, 1, 0);
    row.addWidget(ghosts, 0, 0);
    grid.addLayout(row, 1, 1, 1, 1);
    g.setLayout(grid);

    var state = { group: g, check: check, scales: scales, menu: menu, cur: cur, ghosts: ghosts, curScales: [], curOffset: 0 };
    check.clicked.connect(function() {
        var doc = EAction.getDocument(), di = EAction.getDocumentInterface();
        if (isNull(doc) || isNull(di)) { return; }
        var sel = AnnotativeGroup.selection(doc);
        // a mixed selection: the click makes them ALL annotative
        if (sel.annotative.length < sel.all.length) {
            Annotative.make(di, sel.all);
        }
        else {
            Annotative.unmake(di, sel.all);
        }
        AnnotativeGroup.refresh(editor);
    });
    cur["activated(int)"].connect(function(index) {
        var i = index - state.curOffset, di = EAction.getDocumentInterface();
        if (i >= 0 && i < state.curScales.length && !isNull(di)) {
            Annotative.setCurrentScale(di, state.curScales[i].feetPerInch);
            AnnotativeGroup.refresh(editor);
        }
    });
    ghosts.clicked.connect(function(on) {
        var di = EAction.getDocumentInterface();
        if (!isNull(di)) { Annotative.setVisible(di, on); }
    });
    return state;
};

/** Brings the section in step with the selection and the document. */
AnnotativeGroup.refresh = function(editor) {
    try {
        var doc = EAction.getDocument();
        if (isNull(doc)) {
            return;
        }
        var scroll = editor.widget.findChild("ScrollArea");
        var layout = scroll.layout();
        if (isNull(editor.annoGroup)) {
            editor.annoGroup = AnnotativeGroup.build(editor);
        }
        var st = editor.annoGroup, g = st.group;
        // after the other sections, whichever of them exist
        var anchor = !isNull(editor.customGroup) ? editor.customGroup : (!isNull(editor.childGroup) ? editor.childGroup : editor.geometryGroup);
        layout.removeWidget(g);
        layout.insertWidget(isNull(anchor) ? 2 : layout.indexOf(anchor) + 1, g);
        g.visible = true;

        var sel = AnnotativeGroup.selection(doc);
        st.check.blockSignals(true);
        st.check.enabled = sel.all.length > 0;
        st.check.setTristate(sel.annotative.length > 0 && sel.annotative.length < sel.all.length);
        st.check.setCheckState(sel.annotative.length === 0 ? Qt.Unchecked :
            (sel.annotative.length === sel.all.length ? Qt.Checked : Qt.PartiallyChecked));
        st.check.blockSignals(false);

        // the Scales menu: every scale, ticked where ALL the selected annotative texts have it
        st.scales.enabled = sel.annotative.length > 0;
        st.menu.clear();
        var all = Layouts.scales();
        var supported = sel.annotative.map(function(id) { return Annotative.scalesOf(doc.queryEntity(id)); });
        var count = 0, lastMetric = false;
        for (var i = 0; i < all.length; i++) {
            if (all[i].metric && !lastMetric) {
                st.menu.addSeparator();
            }
            lastMetric = all[i].metric === true;
            var has = supported.length > 0 && supported.every(function(list) {
                return list.some(function(f) { return Annotative.same(f, all[i].feetPerInch); });
            });
            if (has) { count++; }
            var action = st.menu.addAction(all[i].label);
            action.checkable = true;
            action.checked = has;
            action.triggered.connect((function(fpi, wasOn) {
                return function() {
                    var d = EAction.getDocument(), di = EAction.getDocumentInterface();
                    if (isNull(d) || isNull(di)) { return; }
                    var ids = AnnotativeGroup.selection(d).annotative;
                    if (wasOn) { Annotative.removeScale(di, ids, fpi); }
                    else { Annotative.addScale(di, ids, fpi); }
                    AnnotativeGroup.refresh(editor);
                };
            })(all[i].feetPerInch, has));
        }
        st.scales.text = sel.annotative.length === 0 ? qsTr("Scales") : qsTr("Scales (%1)").arg(count);

        // the document's current annotation scale and the all-scales switch
        var current = Annotative.currentScale(doc), at = -1;
        st.cur.blockSignals(true);
        st.cur.clear();
        for (var s = 0; s < all.length; s++) {
            st.cur.addItem(all[s].label);
            if (Annotative.same(all[s].feetPerInch, current)) { at = s; }
        }
        st.curScales = all;
        st.curOffset = 0;
        if (at < 0) {
            st.cur.insertItem(0, Annotative.label(current) + "  (current)");
            st.curOffset = 1;
            at = 0;
        }
        st.cur.setCurrentIndex(at);
        st.cur.blockSignals(false);
        st.ghosts.blockSignals(true);
        st.ghosts.checked = Annotative.visible(doc);
        st.ghosts.blockSignals(false);
    }
    catch (e) {
        qWarning("AnnotativeGroup.refresh: " + e);
    }
};
