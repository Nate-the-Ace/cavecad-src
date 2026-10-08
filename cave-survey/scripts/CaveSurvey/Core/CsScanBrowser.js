// CsScanBrowser.js -- the scans tree and the page beside it, as ONE
// widget both panels build.
//
// Part of the Cave Survey Core library. GUI context, like CsPanel,
// CsScanList and CsScanView.
//
// WHY IT IS HERE. Sketch Scans and the Survey Notebook each assembled
// the same pair by hand -- CsScanList's tree, CsScanView's preview, a
// Fit/-/+ row under it -- and each chose its own geometry. So moving
// the tree beside the page in one panel left the other stacked, and
// the next change to either would have done the same again (Nathan,
// 2026-09-11: "any changes to the Tree and preview panel needs to
// update wherever it is used").
//
// The list was already shared, and the viewer was already shared. What
// was NOT shared was the arrangement of the two, which is exactly the
// thing that drifted. It lives here now: one splitter, one ratio, one
// zoom row, and a settings key per caller so each panel still
// remembers its own drag.
//
// BESIDE AND NOT ABOVE. A scanned field page is taller than it is
// wide. Stacked, the page is read through a letterbox -- at a dock's
// usual width the preview got about a quarter of the height and the
// sketch was a thumbnail. Side by side the picture takes the whole
// height and the tree needs only enough width for a filename.
//
// WHAT A CALLER STILL OWNS. Anything that is not the pair: Sketch
// Scans' trim bar, its rotate button and its pixel readout, the
// Notebook's fallback wording. They are appended to `zoomRow` and
// `previewLayout`, which is why both are handed back.

var CsScanBrowser = {};

// Two parts tree to three parts page. A RATIO and not two pixel
// counts: setSizes distributes proportionally when the panel is
// smaller than the request, so pixel counts would squeeze one side to
// its floor on a narrow dock.
CsScanBrowser.TREE_PARTS = 2;
CsScanBrowser.PAGE_PARTS = 3;
CsScanBrowser.PART = 240;

// The tree never shrinks below a filename, whatever the drag says.
CsScanBrowser.TREE_MIN = 150;

/**
 * The pair, ready to drop into a panel's layout.
 *
 * opts.settingKey -- where this caller's splitter drag is remembered.
 *                    Its own key per panel: the drags are different
 *                    panels' business.
 * opts.zoom       -- a function(label, tip) building one small button,
 *                    so a panel's buttons look like its other buttons.
 *                    Defaults to a plain QPushButton.
 *
 * \return {splitter, list, previewPane, previewLayout, preview,
 *          zoomRow, fitButton, zoomInButton, zoomOutButton}
 *         `preview` is null on a bridge that cannot embed a view --
 *         the caller says so in its own words.
 */
CsScanBrowser.build = function(parent, opts) {
    var options = isNull(opts) ? {} : opts;
    var out = {
        splitter: null, list: null, previewPane: null,
        previewLayout: null, preview: null, zoomRow: null,
        fitButton: null, zoomInButton: null, zoomOutButton: null
    };

    out.list = CsScanList.build(parent);
    try {
        out.list.minimumWidth = CsScanBrowser.TREE_MIN;
    } catch (eMinW) {
    }

    out.previewPane = new QWidget(parent);
    out.previewLayout = new QVBoxLayout();
    try {
        out.previewLayout.setContentsMargins(0, 0, 0, 0);
    } catch (eMargins) {
    }

    out.preview = CsScanPreview.build(out.previewPane);
    if (out.preview !== null) {
        out.previewLayout.addWidget(out.preview.view, 1, 0);
    }

    var make = (typeof options.zoom === "function") ? options.zoom :
        function(label, tip) {
            var b = new QPushButton(label);
            try {
                b.toolTip = tip;
            } catch (eTip) {
            }
            return b;
        };
    out.zoomRow = new QHBoxLayout();
    out.fitButton = make(qsTr("Fit"), qsTr("Fit the whole page in the pane."));
    out.zoomOutButton = make("−", qsTr("Zoom out."));
    out.zoomInButton = make("+", qsTr("Zoom in."));
    try {
        out.fitButton.maximumWidth = 50;
        out.zoomInButton.maximumWidth = 34;
        out.zoomOutButton.maximumWidth = 34;
    } catch (eW) {
    }
    out.zoomRow.addWidget(out.fitButton, 0, 0);
    out.zoomRow.addWidget(out.zoomOutButton, 0, 0);
    out.zoomRow.addWidget(out.zoomInButton, 0, 0);
    out.zoomRow.addStretch(1);
    out.previewLayout.addLayout(out.zoomRow, 0);

    // WIRED HERE. Three buttons that do the same three things in both
    // panels are not three pairs of connections to keep in step.
    if (out.preview !== null) {
        var view = out.preview;
        try {
            out.fitButton.clicked.connect(function() {
                CsScanPreview.fit(view);
            });
            out.zoomInButton.clicked.connect(function() {
                CsScanPreview.zoom(view, 1.4);
            });
            out.zoomOutButton.clicked.connect(function() {
                CsScanPreview.zoom(view, 1 / 1.4);
            });
        } catch (eWire) {
            // a bridge that refuses the connections leaves three inert
            // buttons and a working browser
        }
    }

    out.previewPane.setLayout(out.previewLayout);

    out.splitter = new QSplitter(Qt.Horizontal);
    out.splitter.addWidget(out.list);
    out.splitter.addWidget(out.previewPane);
    try {
        out.splitter.setStretchFactor(0, CsScanBrowser.TREE_PARTS);
        out.splitter.setStretchFactor(1, CsScanBrowser.PAGE_PARTS);
    } catch (eSf) {
    }
    CsScanBrowser.restoreSizes(out.splitter, options.settingKey);
    return out;
};

/** The caller's remembered drag, or the default ratio. */
CsScanBrowser.restoreSizes = function(splitter, settingKey) {
    var sizes = [];
    try {
        if (!isNull(settingKey)) {
            var saved = RSettings.getStringValue(settingKey, "");
            if (saved.length > 0) {
                var parts = saved.split(",");
                for (var i = 0; i < parts.length; i++) {
                    sizes.push(parseInt(parts[i], 10));
                }
            }
        }
    } catch (eRead) {
        sizes = [];
    }
    try {
        if (sizes.length === 2 && !isNaN(sizes[0]) && !isNaN(sizes[1])) {
            splitter.setSizes(sizes);
        } else {
            splitter.setSizes([
                CsScanBrowser.TREE_PARTS * CsScanBrowser.PART,
                CsScanBrowser.PAGE_PARTS * CsScanBrowser.PART]);
        }
    } catch (eSet) {
        // bridge without sizes()/setSizes(): the stretch factors stand
    }
};

/** Remembers a drag. `onMoved` is the caller's own business after it
 *  -- a label preview that needs rescaling, say. */
CsScanBrowser.rememberSizes = function(splitter, settingKey, onMoved) {
    try {
        splitter.splitterMoved.connect(function() {
            try {
                if (!isNull(settingKey)) {
                    RSettings.setValue(settingKey, splitter.sizes().join(","));
                }
            } catch (eSave) {
            }
            if (typeof onMoved === "function") {
                try {
                    onMoved();
                } catch (eCb) {
                }
            }
        });
    } catch (eConn) {
    }
};
