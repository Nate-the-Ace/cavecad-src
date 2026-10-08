// Report.js -- plain-language summaries.
//
// Part of the Cave Survey Core library: pure string building. Every
// tool ends by saying what it did, in drawing units, in sentences a
// beginner understands -- these builders keep that voice consistent.

var CsReport = {};

/** "148.2 ft" with sensible precision. */
CsReport.length = function(value, unit) {
    var precision = value >= 100 ? 1 : 2;
    return value.toFixed(precision) + " " + unit;
};

/** Summary of an import or a notebook draw. */
CsReport.drawSummary = function(survey, resolved, drawn, findings) {
    var lines = [];
    // Prefer the drawing-level cave name over the trip name -- it's
    // the more meaningful label when both are present.
    if (survey.caveName || survey.name) {
        lines.push("Survey: " + (survey.caveName || survey.name));
    }
    lines.push("Stations plotted: " + drawn.stationsDrawn);
    // Loop closures and control ties are counted apart from ordinary
    // shots by CsDraw, so both have to be named here or the printed
    // total is smaller than the drawing. A tie is not a closure -- it
    // is the single leg joining two separately fixed components -- so
    // it gets its own words. A `drawn` object from before tiesDrawn
    // existed simply says nothing about ties.
    var extraLegs = [];
    if (drawn.closuresDrawn > 0) {
        extraLegs.push(drawn.closuresDrawn + " loop closure" +
            (drawn.closuresDrawn === 1 ? "" : "s"));
    }
    if (drawn.tiesDrawn !== undefined && drawn.tiesDrawn > 0) {
        extraLegs.push(drawn.tiesDrawn + " control tie" +
            (drawn.tiesDrawn === 1 ? "" : "s"));
    }
    lines.push("Shots drawn: " + drawn.shotsDrawn +
        (extraLegs.length > 0 ? (" (+" + extraLegs.join(", ") + ")") : ""));
    if (drawn.wallsDrawn !== undefined && drawn.wallsDrawn > 0) {
        lines.push("Wall runs drawn: " + drawn.wallsDrawn +
            " (dashed = approximate; trace real walls over them)");
    }
    if (drawn.splaysDrawn !== undefined && drawn.splaysDrawn > 0) {
        lines.push("Splays drawn: " + drawn.splaysDrawn +
            " (thin rays on CTRL-SPLAYS)");
    }
    // Named apart from the generic "Skipped" line below: that one
    // means excluded or never-connected, but an unmeasurable splay's
    // OWN station did connect -- the gap is that nobody recorded a
    // distance or a reading for the splay itself. Conflating the two
    // would tell a surveyor to go check a connection that is fine.
    if (drawn.splaysSkipped !== undefined && drawn.splaysSkipped > 0) {
        lines.push("Splays not drawn: " + drawn.splaysSkipped +
            " (no distance, or no azimuth/inclination, on record)");
    }
    if (drawn.wallPointsSkipped !== undefined && drawn.wallPointsSkipped > 0) {
        lines.push("Wall points skipped: " + drawn.wallPointsSkipped +
            " (splay had no distance, or no azimuth/inclination, on record)");
    }
    if (drawn.skipped > 0) {
        lines.push("Skipped: " + drawn.skipped +
            " (excluded shots, or shots that never connected)");
    }
    // The AUTOMATIC profile pass's own outcome, folded into the ordinary
    // draw summary every production caller already shows -- without
    // this, CsReport.profileSummary (which says the identical thing in
    // the identical words) is only ever read by the MANUAL GenerateProfile
    // tool, so a plan draw that skipped the profile for size, a
    // ProfileAuto switched off, an unsaved drawing, or a profile pass
    // that threw, never told the user anything at all: `drawn.profile`
    // was a real field on CsDraw.survey's return value that nothing
    // shipped ever read. Same wording as profileSummary's own skip line
    // so the two paths never describe the same event two different ways.
    if (drawn.profile !== undefined && drawn.profile !== null &&
            drawn.profile.skipped) {
        lines.push("Profile: not written -- " + drawn.profile.reason + ".");
    }
    // THE SAME DEFECT, TWICE MORE. `drawn.elevations` was a real field
    // on CsDraw.survey's return that nothing shipped ever read -- a
    // spot elevation whose leg had vanished was counted `lost` and the
    // count went nowhere. `drawn.sections` arrived with the cross
    // sections and would have gone the same way. Both are printed here,
    // and only when there is something to say: a draw that re-derived
    // nothing stays quiet.
    var elevLine = CsReport.refreshLine("Elevation labels",
        drawn.elevations, ["updated", "upgraded", "downgraded", "lost"]);
    if (elevLine !== null) {
        lines.push(elevLine);
    }
    var sectionLine = CsReport.refreshLine("Cross sections",
        drawn.sections, ["updated", "frozen", "lost", "refused"]);
    if (sectionLine !== null) {
        lines.push(sectionLine);
    }
    // Scans that followed the survey -- or could not. A scan left
    // behind by a correction is exactly the kind of stale thing that
    // reaches a plotted map unnoticed.
    var scanLine = CsReport.refreshLine("Aligned scans", drawn.scans,
        ["moved", "stale", "refused", "backfilled"]);
    if (scanLine !== null) {
        lines.push(scanLine);
    }

    if (survey.declination !== 0 && survey.declinationSource !== "") {
        var srcWord = { file: "from the file", user: "entered by hand",
            igrf: "IGRF estimate" }[survey.declinationSource] ||
            survey.declinationSource;
        lines.push("Declination applied: " +
            CsAngles.formatDeclination(survey.declination) +
            " (" + srcWord + ")");
    }

    for (var i = 0; i < resolved.loops.length; i++) {
        var loop = resolved.loops[i];
        lines.push("Loop " + loop.from + " to " + loop.to + ": closes " +
            loop.error.toFixed(2) + " off over " +
            loop.traverseLength.toFixed(1) + " surveyed (" +
            loop.percent.toFixed(2) + "%)" +
            (loop.percent <= 1.0 ? " -- good" : "") +
            " [horizontal " + loop.horizontal.toFixed(2) +
            ", vertical " + loop.vertical.toFixed(2) + "]");
    }

    // A control tie is not a loop: it is the single leg joining two
    // separately fixed components, with no ring to quote a percentage
    // of. CsNetwork sets `percent: null` on every tie for exactly that
    // reason, so this block must never call .toFixed() on it -- only
    // `error`, `horizontal` and `vertical`, which are always real
    // numbers here.
    var ties = resolved.ties || [];
    for (i = 0; i < ties.length; i++) {
        var tieItem = ties[i];
        lines.push("Control tie " + tieItem.from + " to " + tieItem.to +
            ": " + tieItem.error.toFixed(2) + " between fixed points " +
            "[horizontal " + tieItem.horizontal.toFixed(2) +
            ", vertical " + tieItem.vertical.toFixed(2) + "]");
    }

    // What the adjustment did -- or plainly that none was made, so a
    // reader is never left guessing which centreline they are looking
    // at. `resolved.adjusted` is `undefined` on a plain
    // CsNetwork.resolve() result (never adjusted at all) and `false`
    // on a CsAdjust.unadjusted() pass-through (switched off, or a
    // solve that didn't converge); both must fall into the same
    // "not adjusted" wording, not just the exact boolean false.
    if (resolved.adjusted === true) {
        var sum = resolved.summary;
        if (sum.movedCount > 0) {
            lines.push("Adjusted by least squares: " + sum.movedCount +
                " station" + (sum.movedCount === 1 ? "" : "s") +
                " moved, most of all " + sum.worstStation + " at " +
                CsReport.length(sum.worstShift, survey.distanceUnit) +
                " (" + sum.iterations + " iteration" +
                (sum.iterations === 1 ? "" : "s") + ").");
        } else if (sum.stationCount > 0) {
            lines.push("Adjusted by least squares: nothing moved -- " +
                "the survey already closes within tolerance.");
        }
        if (sum.stationCount > 0) {
            lines.push("The as-surveyed centreline is on layer " +
                "CTRL-RAW, switched off -- turn it on to see exactly " +
                "what moved.");
        }
        lines.push("Held fixed: " + (sum.pinned.length > 0 ?
            sum.pinned.join(", ") : "nothing"));
    } else if (resolved.summary !== undefined && resolved.summary !== null &&
            resolved.summary.warning !== undefined) {
        // A half-solved network is worse than an unsolved one, because
        // it LOOKS adjusted -- CsAdjust already refused to hand back
        // coordinates in this case, and this warning is its own words,
        // verbatim, not a paraphrase.
        lines.push("");
        lines.push("WARNING -- " + resolved.summary.warning);
    } else if (resolved.loops.length > 0 && ties.length > 0) {
        lines.push("Not adjusted: the misclosures above are still " +
            "as surveyed.");
    } else if (resolved.loops.length > 0) {
        lines.push("Not adjusted: the misclosure is still on the " +
            "closing leg, as surveyed.");
    } else if (ties.length > 0) {
        lines.push("Not adjusted: the gap against fixed control is " +
            "still as surveyed.");
    }

    // Task 1b: when an explicit anchor and *fix control shared a
    // station, resolve() may have translated OTHER fixed stations
    // into the anchor's frame (see CsNetwork.resolve's controlFrame),
    // or -- when it had nothing to translate them WITH -- left them
    // for ordinary traversal and named them instead of silently
    // dropping their control. Either way, say so once, in drawing
    // units, so a beginner reading the summary knows their fixed
    // points either moved on paper (not in the real world) or weren't
    // used at all.
    var cf = resolved.controlFrame;
    if (cf !== undefined && cf !== null) {
        var unit = survey.distanceUnit;
        if (cf.offset !== null && cf.applied.length > 0) {
            var planShift = Math.sqrt(cf.offset.dx * cf.offset.dx +
                cf.offset.dy * cf.offset.dy);
            lines.push("Fixed control " + cf.applied.join(", ") +
                " shifted " + CsReport.length(planShift, unit) +
                " in plan" +
                (cf.offset.dz !== 0 ?
                    " and " + CsReport.length(Math.abs(cf.offset.dz), unit) +
                    (cf.offset.dz > 0 ? " up" : " down") : "") +
                " to line up with the anchor -- the survey's shape " +
                "didn't change, only where it's drawn.");
        }
        if (cf.notHonored.length > 0) {
            lines.push("");
            lines.push("WARNING -- fixed control not used for " +
                cf.notHonored.join(", ") + ": " + cf.reason + ".");
        }
    }

    if (resolved.unresolved.length > 0) {
        lines.push("");
        lines.push("WARNING -- " + resolved.unresolved.length +
            " shot(s) never connected (check station names):");
        for (i = 0; i < resolved.unresolved.length; i++) {
            var u = resolved.unresolved[i];
            lines.push("  " + u.from + " -> " + u.to);
        }
    }

    if (findings !== undefined && findings !== null && findings.length > 0) {
        lines.push("");
        lines.push("Checks (advisory -- your notes are the authority):");
        for (i = 0; i < findings.length; i++) {
            lines.push("  " + findings[i].severity.toUpperCase() + ": " +
                findings[i].message);
        }
    }

    return lines.join("\n");
};

/** Summary block for Survey Stats. */
/**
 * One line for a refresh pass's counts, or null when it did nothing
 * worth saying.
 *
 * `frozen`, `lost` and `refused` are the ones that MATTER: a stale
 * section on a plotted map is the failure the whole refresh exists to
 * prevent, so a count of them is never swallowed.
 *
 * \param counts an object of name -> number, or null
 * \param keys   which counts to report, in the order to report them
 */
CsReport.refreshLine = function(label, counts, keys) {
    if (counts === undefined || counts === null) {
        return null;
    }
    var words = {
        moved: "re-fitted to the moved survey",
        matched: "already in place",
        backfilled: "given anchors for the first time",
        updated: "re-derived", upgraded: "upgraded",
        downgraded: "downgraded", unchanged: "unchanged",
        frozen: "frozen", lost: "whose basis is gone",
        refused: "no longer cuttable"
    };
    var parts = [];
    for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var n = counts[k];
        if (n === undefined || n === null || n === 0) {
            continue;
        }
        parts.push(n + " " + (words[k] || k));
    }
    if (parts.length === 0) {
        return null;
    }
    return label + ": " + parts.join(", ") + ".";
};

CsReport.statsSummary = function(survey, stats, grade) {
    var unit = survey.distanceUnit;
    var lines = [];
    lines.push("Surveyed length: " + CsReport.length(stats.surveyedLength, unit) +
        "  (plan: " + CsReport.length(stats.planLength, unit) + ")");
    lines.push("Vertical extent: " + CsReport.length(stats.depth, unit) +
        (stats.depth > 0 ? "  (" + stats.lowest + " lowest, " +
            stats.highest + " highest)" : ""));
    lines.push("Stations: " + stats.stationCount + "   Shots: " + stats.shotCount +
        "   Loops: " + stats.loopCount);
    if (stats.worstLoop !== null) {
        lines.push("Worst loop closure: " + stats.worstLoop.percent.toFixed(2) +
            "% (" + stats.worstLoop.from + " to " + stats.worstLoop.to +
            ", horizontal " + stats.worstLoop.horizontal.toFixed(2) +
            ", vertical " + stats.worstLoop.vertical.toFixed(2) + ")");
    }
    lines.push("");
    lines.push("Centreline grade: " + grade.centrelineText);
    lines.push("Detail grade: " + grade.detailText);
    lines.push("Sheet designation: " + grade.uis);
    for (var i = 0; i < grade.notes.length; i++) {
        lines.push("Note: " + grade.notes[i]);
    }
    return lines.join("\n");
};

// How many unmoved traced items a revision summary names before it
// says "and N more". Lives with the other report-shaping numbers, and
// is read by CsRevise.lineworkSummary, which does the naming.
CsReport.UNMOVED_SHOWN = 8;

/** Summary of an applied revision (CsRevise.apply's report). */
CsReport.revisionSummary = function(report) {
    var lines = [];
    if (report.rigid) {
        lines.push("Revision applied as one rigid move: the whole drawing " +
            "turned and shifted as a single body, hand-drawn linework " +
            "included.");
    } else {
        lines.push("Revision changed the survey's shape: the survey marks " +
            "were erased and redrawn from the revised data.");
    }

    // Name the station the revision held fixed -- it decides what
    // "the drawing rotated" even means geometrically -- and flag a
    // dragged anchor separately: that's a silent change nobody asked
    // for, and worth a line even though it isn't an error. Both fields
    // are absent on reports from older callers, so say nothing rather
    // than print "undefined".
    if (report.anchorUsed !== undefined && report.anchorUsed !== null) {
        var au = report.anchorUsed;
        if (au.source === "georef") {
            lines.push("Anchor station: " + au.name + " -- it held still " +
                "because it is the georeferenced station, the drawing's " +
                "one tie to real-world coordinates.");
        } else if (au.source === "stale") {
            lines.push("");
            lines.push("WARNING -- anchor station " + au.name +
                " could not be found in the drawing; its last known " +
                "position was used instead.");
        } else {
            lines.push("Anchor station: " + au.name + " (trip 0's anchor).");
        }

        if (report.anchorMoved !== undefined && report.anchorMoved !== null) {
            var dx = report.anchorMoved.dx, dy = report.anchorMoved.dy;
            var hasOffset = dx !== undefined && dx !== null &&
                dy !== undefined && dy !== null;
            var offset = hasOffset ? Math.sqrt(dx * dx + dy * dy) : null;
            lines.push("Anchor station " + au.name + " had been moved" +
                (offset !== null ? " " + offset.toFixed(2) : "") +
                " since the survey was last read from the drawing; the " +
                "revision followed its current position -- the drawing " +
                "is the truth.");
        }
    }

    lines.push("Stations moved: " + report.stationsChanged);
    var top = Math.min(5, report.moved.length);
    for (var i = 0; i < top; i++) {
        lines.push("  " + report.moved[i].name + ": " +
            report.moved[i].dist.toFixed(2));
    }

    for (i = 0; i < report.loopsAfter.length; i++) {
        var after = report.loopsAfter[i];
        var before = null;
        for (var j = 0; j < report.loopsBefore.length; j++) {
            if (report.loopsBefore[j].from === after.from &&
                    report.loopsBefore[j].to === after.to) {
                before = report.loopsBefore[j];
                break;
            }
        }
        lines.push("Loop " + after.from + " to " + after.to + ": closes " +
            (before !== null ? before.error.toFixed(2) + " -> " : "") +
            after.error.toFixed(2) + " off (" +
            after.percent.toFixed(2) + "%)" +
            (after.percent <= 1.0 ? " -- good" : ""));
    }

    if (!report.rigid) {
        // One vocabulary for the linework outcome, spoken by whoever
        // moved the linework: CsRevise. The notebook's Draw says the
        // same sentences from the same function with no report object
        // in hand, so the two revision paths cannot drift apart.
        // Missing fields are handled there -- absent reads as
        // "nothing bound" -- so hand them over as they are.
        var linework = CsRevise.lineworkSummary(report.lineworkMoved,
            report.lineworkUnmoved, report.lineworkBound, undefined,
            report.lineworkWarped, report.lineworkUntied);
        for (i = 0; i < linework.length; i++) {
            lines.push(linework[i]);
        }
    }

    // The profile pass's own outcome -- present only when CsRevise.apply
    // actually called CsDraw.survey (the non-rigid path; see that
    // function's own profileOutcome declaration). Same field, same
    // wording as CsReport.drawSummary's identical block, so a profile
    // skipped for size, for ProfileAuto being off, for an unsaved
    // drawing, or because the pass threw, reads the same words whether
    // it happened on an import, a notebook Draw, or "Revise a trip" --
    // this feature's own flagship workflow, which used to say nothing
    // about it at all (CsRevise.apply discarded CsDraw.survey's return
    // value outright). Silent on a SUCCESSFUL profile pass, matching
    // drawSummary's own convention -- the manual GenerateProfile command
    // is where the full counts/findings report lives (CsReport.
    // profileSummary); this is only the "something you expected did not
    // happen" channel.
    if (report.profile !== undefined && report.profile !== null &&
            report.profile.skipped) {
        lines.push("Profile: not written -- " + report.profile.reason + ".");
    }
    return lines.join("\n");
};

/** One line for an IGRF estimate, always labelled as one. */
CsReport.igrfLine = function(result, lat, lon, dateText) {
    return "IGRF estimate for " + dateText + " at " +
        lat.toFixed(4) + ", " + lon.toFixed(4) + ": " +
        CsAngles.formatDeclination(result.declination) +
        " (model accuracy is a fraction of a degree -- fine against any compass)";
};

/**
 * What the extended elevation drew, and what it could not show.
 *
 * The findings half is the point: a profile that quietly dropped a
 * side lead, drew a spur at the wrong junction, or skipped an
 * unmeasurable splay looks exactly like a complete one. EVERY field of
 * CsProfile.build's `findings` is named here, not just the ones an
 * acceptance checklist happened to enumerate -- an omission in this
 * function is exactly the silent-gap failure mode the whole feature
 * exists to avoid.
 *
 * orphans and strandedRoots read DIFFERENTLY on purpose: an orphan
 * means a tie shot is genuinely missing (go shoot one); a strandedRoot
 * means the data is fine and the band simply starts its own stack.
 * Wording them the same would send someone hunting for a shot that
 * already exists.
 *
 * outcome.counts.linework and .claimed are named here too, for the
 * identical reason: CsProfileDraw.render folds a caught binding/move
 * exception into exactly those two fields, and a field this function
 * never reads is a field the user never hears about no matter how
 * loudly the code underneath it screams.
 *
 * outcome.counts.stationsMoved distinguishes the two reasons
 * c.linework.moved can read 0: nothing existed to move yet (a first-
 * ever profile, or an idempotent redraw of an unchanged one -- render's
 * own positionsMoved guard runs on EVERY draw, automatic or manual,
 * unlike the plan side's revision-only callers of lineworkSummary), or
 * stations genuinely moved and bound linework failed to follow. Only
 * the second is a real warning; passing stationsMoved through to
 * CsRevise.lineworkSummary is what tells them apart instead of warning
 * "your tracing did not move with the survey" on every clean run of a
 * feature that draws on every plan draw (CRITICAL 1 in this feature's
 * review history).
 *
 * \param profile CsProfile.build() result, or null when nothing was built
 * \param outcome CsDraw.profile() result: {skipped, reason} or
 *                {counts, profile}
 */
CsReport.profileSummary = function(profile, outcome) {
    var lines = [];
    if (outcome !== undefined && outcome !== null && outcome.skipped) {
        lines.push("Profile: not written -- " + outcome.reason + ".");
        return lines.join("\n");
    }
    if (profile === null || profile === undefined) {
        return "Profile: nothing to draw.";
    }

    var c = (outcome && outcome.counts) ? outcome.counts : {};
    // "in this drawing", not a file name: the elevation is a REGION of
    // the drawing the user is looking at now, not a sibling file they
    // would have to go and open. Naming a path here again would send a
    // reader looking for a file that no longer exists.
    lines.push("Profile drawn in this drawing, below the plan");
    lines.push("  " + (c.bandsDrawn || 0) + " band(s), " +
        (c.legsDrawn || 0) + " leg(s), " + (c.stationsDrawn || 0) +
        " station(s)");
    lines.push("  " + (c.ceilingRuns || 0) + " ceiling run(s), " +
        (c.floorRuns || 0) + " floor run(s), " + (c.flatTicks || 0) +
        " level splay tick(s)");
    // level splays are counted, not hidden: a splay inside the dead
    // zone contributed nothing to either line, and a reader who cannot
    // see how many there were cannot judge whether the dead zone is
    // set sensibly for this cave

    // The linework outcome -- moved/unmoved traced sketch, and how many
    // previously untagged sketches this run bound to the survey itself
    // -- reaches the user through the exact same words CsRevise.
    // lineworkSummary already gives the PLAN side (see
    // CsReport.revisionSummary above): one vocabulary for "did my
    // tracing follow the revision", not two. CsProfileDraw.render
    // ALWAYS sets c.linework/c.claimed on a real counts object (even
    // when claim()/moveLinework threw -- see that function's own
    // \return docblock), so their absence here means this outcome was
    // never handed a counts object at all, which already returned
    // above ({skipped: ...} or profile === null) -- not a legitimate
    // "nothing to report" state reached from here.
    //
    // c.claimed.tagged IS the "bound" count lineworkSummary expects,
    // not merely A SUBSET of it the way CsRevise.apply's own
    // lineworkBound is on the plan side: every tag CsProfileBind.claim
    // writes is brand new (a profile drawing has no prior-tagged
    // linework concept the way a revised plan does), so there is no
    // larger "already bound" total to carve this one out of.
    if (c.linework !== undefined) {
        var pLines = CsRevise.lineworkSummary(c.linework.moved,
            c.linework.unmoved, c.claimed ? c.claimed.tagged : 0,
            c.stationsMoved, c.linework.warped);
        for (var pi = 0; pi < pLines.length; pi++) {
            // Not "  " + pLines[pi] unconditionally: lineworkSummary
            // inserts a deliberate BLANK line as a separator before its
            // own WARNING blocks, and prefixing that blank line here
            // turned it into a two-space trailing-whitespace line in
            // the dialog -- invisible, but not actually blank.
            lines.push(pLines[pi] === "" ? "" : "  " + pLines[pi]);
        }
    }
    // A THROWN exception is a different claim from "this sketch simply
    // has no station to follow": lineworkSummary's own WARNING above
    // already surfaces a caught "move failed:" entry (CsProfileDraw.
    // render folds it into c.linework.unmoved), but a binding failure
    // inside claim()/positions() itself has nowhere else to go --
    // c.claimed.error is set instead of c.claimed.tagged/skipped ever
    // being reached at all, and a caught exception that reaches no one
    // is worse than a crash that at least stops the show.
    if (c.claimed && c.claimed.error) {
        lines.push("  WARNING -- binding traced linework to the survey " +
            "failed, so nothing was claimed or moved for it this run: " +
            c.claimed.error);
    }

    var f = profile.findings;
    var i;
    if (f.mismatches.length > 0) {
        for (i = 0; i < f.mismatches.length; i++) {
            lines.push("  CHECK the name: run " + f.mismatches[i].run +
                " reads as a spur of " + f.mismatches[i].expected +
                " but ties in at " + f.mismatches[i].actual +
                " -- drawn at the surveyed junction");
        }
    }
    if (f.omitted.length > 0) {
        lines.push("  off the main chain, not drawn: " + f.omitted.join(", "));
    }
    if (f.secondTies.length > 0) {
        for (i = 0; i < f.secondTies.length; i++) {
            lines.push("  run " + f.secondTies[i].run +
                " also touches " + f.secondTies[i].otherStation +
                " (drawn as a tie line, not a second band)");
        }
    }
    if (f.orphans.length > 0) {
        // Disconnected means exactly that: no leg of any kind reaches
        // the rest of the cave. This one IS actionable -- a connecting
        // shot is missing.
        lines.push("  no connection to the rest of the survey, a tie " +
            "shot is missing: " + f.orphans.join(", "));
    }
    if (f.strandedRoots !== undefined && f.strandedRoots.length > 0) {
        // Connected, but not attached as anyone's child. The data is
        // fine and nothing needs surveying -- the band simply starts its
        // own stack. Saying "no connection" here would send someone
        // hunting for a shot that already exists.
        lines.push("  connected, but drawn as its own band rather than " +
            "hanging off another: " + f.strandedRoots.join(", "));
    }
    if (f.stopped.length > 0) {
        // stoppedReason distinguishes THREE causes, not two -- collapsing
        // "unmeasurable" into "no resolved elevation" would send a
        // surveyor to re-check a station's depth gauge when the actual
        // gap is a shot with no usable distance/azimuth/inclination on
        // record (CsProfile.unrollBand's own "no-z"/"no-leg"/
        // "unmeasurable" split, see its docblock).
        for (i = 0; i < f.stopped.length; i++) {
            var st = f.stopped[i];
            var why;
            if (st.reason === "no-leg") {
                why = "no leg reaches it";
            } else if (st.reason === "unmeasurable") {
                why = "the leg to it has no usable distance, azimuth " +
                    "or inclination on record";
            } else {
                // "no-z", and any future reason this function does not
                // yet know the name of -- silence here would be worse
                // than a slightly generic label
                why = "no resolved elevation";
            }
            lines.push("  band stopped at " + st.station + ": " + why);
        }
    }
    if (f.ungrouped.length > 0) {
        lines.push("  station names that could not be read as a run: " +
            f.ungrouped.join(", "));
    }
    if (f.wallPointsSkipped !== undefined && f.wallPointsSkipped > 0) {
        lines.push("  " + f.wallPointsSkipped + " splay wall point(s) " +
            "skipped (no usable distance, or no azimuth/inclination, " +
            "on record)");
    }
    if (f.undrawn !== undefined && f.undrawn.length > 0) {
        // Every leg CsNetwork.resolve() produced is either drawn in a
        // band above or named here with why -- see CsProfile.build's
        // own C2 docblock. Grouped by reason (in first-appearance
        // order, so this never depends on this engine's object-key
        // enumeration order, unlike a for-in walk would) rather than
        // naming each leg individually: a survey with many ordinary
        // loop closures would otherwise bury the findings that ARE
        // worth a look under a list of the ones that are not.
        var byReason = {}, reasonOrder = [];
        for (i = 0; i < f.undrawn.length; i++) {
            var urKey = f.undrawn[i].reason;
            if (!byReason.hasOwnProperty(urKey)) {
                byReason[urKey] = 0;
                reasonOrder.push(urKey);
            }
            byReason[urKey]++;
        }
        var undrawnParts = [];
        for (var ro = 0; ro < reasonOrder.length; ro++) {
            undrawnParts.push(byReason[reasonOrder[ro]] + " " +
                reasonOrder[ro]);
        }
        lines.push("  legs not drawn on any band (" + f.undrawn.length +
            "): " + undrawnParts.join(", "));
    }
    return lines.join("\n");
};
