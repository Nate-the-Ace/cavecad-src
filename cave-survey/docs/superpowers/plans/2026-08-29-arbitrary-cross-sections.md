# Arbitrary Cross Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut a rough cross section anywhere along the surveyed alignment and hang it in the drawing as a leader-attached block that regenerates on every Draw.

**Architecture:** `Core/CsSectionCut.js` is pure maths — leg frame, double-reflection carry, per-station polygon from LRUD and splays in 3D, radial resample, lerp. `Core/CsSectionDraw.js` turns a cut into a BLOCK DEFINITION, one per section. The block is attached to a leader by the existing callout machinery (`KIND_SECTION`, alongside `KIND_TEXT` and `KIND_ELEV`), so reflow, undo and sync all come for free. `CalloutWrite.refreshSections` re-derives every section on Draw and redefines its block in place.

**Tech Stack:** QCAD/CaveCAD ECMAScript add-on, node for the pure Core tests, `tests/run_all.sh`.

**User decisions (already made):**
- "i want to have dynamic arbitary cross sections as a cool feature."
- "Please adopt those" — the spec's three recommendations: 32 sample angles (settable), draw the floor closed through a lone D point and let the splay layer show how thin the evidence was, and a 15° frame re-seed threshold with every re-seed reported.
- "Be sure to make each a block so that I can edit them individually and have them move as a unit rather than loose linework." — **one block DEFINITION per section**, named by its callout id. Not a shared definition: a shared one would make editing any section edit all of them.
- "we're giving up on the cross section grid ... the cross section callout is a much better solution."

**Spec:** `docs/superpowers/specs/2026-08-29-arbitrary-cross-sections-design.md`
**Prerequisite, already shipped:** the section layers and the `section` frame (0.9.21.0, commits 818617a…d38c572).

---

## The individual-edit rule, which the block requirement forces

Nathan wants to edit sections individually. The tool wants to regenerate them. Those collide, so the rule is explicit:

- **One block definition per section**, named `CS_<CalloutId>`. Editing one never touches another.
- The block **reference** — position, scale, rotation — is the caver's. Regeneration never moves it.
- The block **definition** is the tool's, redefined on every Draw.
- A caver who wants to keep hand edits to the geometry sets **Freeze** on that section (`SectionFrozen=1`, offered as a command and in the tool's own dialog). A frozen section is skipped by regeneration and counted in the report, so it is never silently stale.
- Exploding the block remains the hard exit: it drops the tags and takes the section out of regeneration entirely.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/CaveSurvey/Core/CsSectionCut.js` | **New, pure.** Frames, 3D wall points, polygon, resample, lerp, concavity. Plain `{x,y,z}`. Node-testable. |
| `scripts/CaveSurvey/Core/CsLrud.js` | One addition: a 3D sibling of `stationWallPoints` that keeps `dz`. The 2D function is untouched. |
| `scripts/CaveSurvey/Core/CsSectionDraw.js` | **New.** Cut → block definition: outline, splays, centreline mark, caption. Erase-and-redefine. |
| `scripts/CaveSurvey/Callout/CalloutWrite.js` | `KIND_SECTION`, the block content role, `refreshSections`. |
| `scripts/CaveSurvey/Core/CsCallout.js` | The new kind, role and provenance tag keys. |
| `scripts/CaveSurvey/CrossSection/CrossSection.js` | **New tool.** Two clicks: the cut point on the alignment, then where the block goes. |
| `scripts/CaveSurvey/Core/CsDraw.js` | Calls `refreshSections` beside `refreshElevationsFromDocument`. |
| `tests/js_unit.js` | The pure maths, with hand-worked numbers. |
| `tests/cross_section_run.js` | **New driver.** Cut, redraw, assert the block was redefined and the reference did not move. |

---

## Task 1: The leg frame and the double-reflection carry

**Goal:** A stable `(d, r, s)` basis for every leg, that does not spin on a pitch.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsSectionCut.js`
- Modify: `scripts/CaveSurvey/Core/CsAll.js`, `tests/js_unit.js` (`CORE_FILES` and a test block)

**Acceptance Criteria:**
- [ ] `CsSectionCut.seedFrame(d)` returns `{d, r, s}` with `r` from world up projected into the plane, orthonormal, or `null` when ill-conditioned.
- [ ] `CsSectionCut.carryFrame(prev, x0, x1, d1)` implements double reflection and returns an orthonormal frame whose `d` is `d1`.
- [ ] Two consecutive vertical legs produce frames whose `r` differs by less than 1e-9 — the anti-spin assertion.
- [ ] `CsSectionCut.frameFor` re-seeds when the carried frame has drifted more than `CsSectionCut.RESEED_DEG` (15) from the up-projected one AND the projection is well conditioned, and records the re-seed.

**Verify:** `node tests/js_unit.js` → `### UNIT OK <n> assertions`

**Steps:**

- [ ] **Step 1: Write the failing tests in `tests/js_unit.js`**

```javascript
// ---------------------------------------------------------------------
// CsSectionCut -- frames. A leg is STRAIGHT, so there is no twist
// within one; these carry theta=0 from leg to leg so sections do not
// spin where world up degenerates (a pitch).
// ---------------------------------------------------------------------

(function() {
    var east = { x: 1, y: 0, z: 0 };
    var f = CsSectionCut.seedFrame(east);
    ok(f !== null, "CsSectionCut.seedFrame: a level leg seeds");
    near(f.r.z, 1, 1e-9, "CsSectionCut.seedFrame: r is world up on a level leg");
    near(f.r.x * f.d.x + f.r.y * f.d.y + f.r.z * f.d.z, 0, 1e-9,
        "CsSectionCut.seedFrame: r is perpendicular to d");
    near(Math.sqrt(f.s.x * f.s.x + f.s.y * f.s.y + f.s.z * f.s.z), 1, 1e-9,
        "CsSectionCut.seedFrame: s is a unit vector");

    // A pitch: world up lies along the leg, so seeding must refuse.
    ok(CsSectionCut.seedFrame({ x: 0, y: 0, z: 1 }) === null,
        "CsSectionCut.seedFrame: a vertical leg cannot seed from up");

    // Two vertical legs in a row: the carry must hold r steady.
    var down1 = { x: 0, y: 0, z: -1 };
    var seeded = CsSectionCut.seedFrame({ x: 1, y: 0, z: 0 });
    var v1 = CsSectionCut.carryFrame(seeded,
        { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -10 }, down1);
    var v2 = CsSectionCut.carryFrame(v1,
        { x: 0, y: 0, z: -10 }, { x: 0, y: 0, z: -20 }, down1);
    near(v1.r.x, v2.r.x, 1e-9, "CsSectionCut.carryFrame: r.x steady down a pitch");
    near(v1.r.y, v2.r.y, 1e-9, "CsSectionCut.carryFrame: r.y steady down a pitch");
    near(v1.r.z, v2.r.z, 1e-9, "CsSectionCut.carryFrame: r.z steady down a pitch");
    near(v2.r.x * down1.x + v2.r.y * down1.y + v2.r.z * down1.z, 0, 1e-9,
        "CsSectionCut.carryFrame: r stays perpendicular to the new leg");
})();
```

- [ ] **Step 2: Run and watch it fail**

Run: `node tests/js_unit.js`
Expected: FAIL — `CsSectionCut is not defined`.

- [ ] **Step 3: Write the file**

```javascript
// CsSectionCut.js -- cutting a rough cross section anywhere along the
// surveyed alignment.
//
// Part of the Cave Survey Core library. PURE: plain {x, y, z} objects,
// no RVector, no document. Everything QCAD-shaped lives in
// CsSectionDraw.js.
//
// WHY THIS IS POSSIBLE AT ALL. CsTraverse.offset already returns
// {dx, dy, dz} -- every splay is a 3D wall hit and always was.
// CsLrud.stationWallPoints DISCARDS dz because the plan view has no use
// for it. That single discard is the only reason the suite looked like
// it had no 3D model to cut.
//
// WHAT MAKES THE MATHS SMALL. A survey leg is STRAIGHT, so the tangent
// is constant along it: one plane normal serves every cut on a leg, and
// there is no twist to integrate. Two consequences worth stating --
//   * no junction ambiguity for a cut: a leg has exactly two ends, so
//     the stations bounding the cut are simply those two;
//   * the frame problem reduces to choosing theta = 0.
//
// AND WHY THAT LAST PART IS STILL NOT TRIVIAL. theta = 0 wants to be
// world up projected into the section plane, which DEGENERATES on a
// pitch: near vertical, up lies along the leg, the projection goes to
// zero, and theta = 0 becomes noise -- sections spin from leg to leg in
// exactly the passages where a reader needs them steady. So the
// reference is carried between legs by a rotation-minimizing frame
// (double reflection, Wang et al. 2008), which is stable where a Frenet
// frame flips at an inflection.

var CsSectionCut = {};

/** Below this, a vector is zero for our purposes. */
CsSectionCut.EPS = 1e-12;
/** |up projected into the plane| below this and the seed is refused:
 *  the leg is a pitch and theta = 0 would be noise. */
CsSectionCut.SEED_MIN = 0.2;
/** Carried frames drift. Past this many degrees from the up-projected
 *  reference -- and only where that reference is well conditioned --
 *  the frame is RE-SEEDED, so a long cave does not accumulate an
 *  arbitrary roll. A re-seed is a visible discontinuity in the drawing,
 *  so callers report it rather than swallowing it. */
CsSectionCut.RESEED_DEG = 15;

CsSectionCut.dot = function(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
};

CsSectionCut.cross = function(a, b) {
    return { x: a.y * b.z - a.z * b.y,
             y: a.z * b.x - a.x * b.z,
             z: a.x * b.y - a.y * b.x };
};

CsSectionCut.sub = function(a, b) {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
};

CsSectionCut.scale = function(a, k) {
    return { x: a.x * k, y: a.y * k, z: a.z * k };
};

CsSectionCut.add = function(a, b) {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
};

CsSectionCut.length = function(a) {
    return Math.sqrt(CsSectionCut.dot(a, a));
};

/** \return the unit vector, or null when there is no direction. */
CsSectionCut.normalize = function(a) {
    var m = CsSectionCut.length(a);
    if (m < CsSectionCut.EPS) {
        return null;
    }
    return { x: a.x / m, y: a.y / m, z: a.z / m };
};

/**
 * A frame from world up alone: r = up with the along-leg part removed.
 * \return {d, r, s} orthonormal, or null when the leg is too steep for
 *         up to say anything (a pitch).
 */
CsSectionCut.seedFrame = function(d) {
    var dn = CsSectionCut.normalize(d);
    if (dn === null) {
        return null;
    }
    var up = { x: 0, y: 0, z: 1 };
    var proj = CsSectionCut.sub(up,
        CsSectionCut.scale(dn, CsSectionCut.dot(up, dn)));
    if (CsSectionCut.length(proj) < CsSectionCut.SEED_MIN) {
        return null;
    }
    var r = CsSectionCut.normalize(proj);
    return { d: dn, r: r, s: CsSectionCut.cross(dn, r) };
};

/**
 * The double-reflection step (Wang et al. 2008): carry `prev`'s
 * reference onto the next leg with the least possible rotation.
 *
 * \param prev {d, r, s} on the previous leg
 * \param x0, x1 the previous leg's start and the new leg's start
 * \param d1 the new leg's direction
 * \return {d, r, s} orthonormal on the new leg
 */
CsSectionCut.carryFrame = function(prev, x0, x1, d1) {
    var dn = CsSectionCut.normalize(d1);
    if (dn === null || prev === null) {
        return CsSectionCut.seedFrame(d1);
    }
    var v1 = CsSectionCut.sub(x1, x0);
    var c1 = CsSectionCut.dot(v1, v1);
    var rL = prev.r, dL = prev.d;
    if (c1 > CsSectionCut.EPS) {
        rL = CsSectionCut.sub(prev.r,
            CsSectionCut.scale(v1, 2 * CsSectionCut.dot(v1, prev.r) / c1));
        dL = CsSectionCut.sub(prev.d,
            CsSectionCut.scale(v1, 2 * CsSectionCut.dot(v1, prev.d) / c1));
    }
    var v2 = CsSectionCut.sub(dn, dL);
    var c2 = CsSectionCut.dot(v2, v2);
    var r1 = rL;
    if (c2 > CsSectionCut.EPS) {
        r1 = CsSectionCut.sub(rL,
            CsSectionCut.scale(v2, 2 * CsSectionCut.dot(v2, rL) / c2));
    }
    // Re-orthonormalise against the new tangent: the reflections are
    // exact in theory and drift in floating point over a long cave.
    var perp = CsSectionCut.sub(r1,
        CsSectionCut.scale(dn, CsSectionCut.dot(r1, dn)));
    var r = CsSectionCut.normalize(perp);
    if (r === null) {
        return CsSectionCut.seedFrame(d1) ||
            { d: dn, r: { x: 1, y: 0, z: 0 }, s: { x: 0, y: 1, z: 0 } };
    }
    return { d: dn, r: r, s: CsSectionCut.cross(dn, r) };
};

/**
 * The frame for a leg, given the previous one: carried, then re-seeded
 * if it has drifted and the seed is trustworthy again.
 *
 * \return {frame, reseeded} -- `reseeded` is true when theta = 0 jumped,
 *         which the caller REPORTS rather than hides.
 */
CsSectionCut.frameFor = function(prev, x0, x1, d1) {
    if (prev === null || prev === undefined) {
        var seeded = CsSectionCut.seedFrame(d1);
        if (seeded !== null) {
            return { frame: seeded, reseeded: false };
        }
        // A run that OPENS on a pitch has nothing to carry and nothing
        // to seed from. Any perpendicular is as good as any other; what
        // matters is that it is recorded as arbitrary.
        var dn = CsSectionCut.normalize(d1);
        var any = Math.abs(dn.x) < 0.9 ? { x: 1, y: 0, z: 0 } :
            { x: 0, y: 1, z: 0 };
        var perp = CsSectionCut.normalize(CsSectionCut.sub(any,
            CsSectionCut.scale(dn, CsSectionCut.dot(any, dn))));
        return { frame: { d: dn, r: perp, s: CsSectionCut.cross(dn, perp) },
                 reseeded: true };
    }
    var carried = CsSectionCut.carryFrame(prev, x0, x1, d1);
    var seed = CsSectionCut.seedFrame(d1);
    if (seed === null) {
        return { frame: carried, reseeded: false };
    }
    var cosA = Math.max(-1, Math.min(1,
        CsSectionCut.dot(carried.r, seed.r)));
    var driftDeg = Math.acos(cosA) * 180 / Math.PI;
    if (driftDeg > CsSectionCut.RESEED_DEG) {
        return { frame: seed, reseeded: true };
    }
    return { frame: carried, reseeded: false };
};
```

- [ ] **Step 4: Register the file**

Add `"scripts/CaveSurvey/Core/CsSectionCut.js"` to `CORE_FILES` in `tests/js_unit.js` — the list is hand-written and a missing file passes SILENTLY through the harness's deliberate catches. Add the matching `include(...)` to `Core/CsAll.js`.

- [ ] **Step 5: Run — it must pass**

Run: `node tests/js_unit.js` → `### UNIT OK <n> assertions`

- [ ] **Step 6: Commit**

```bash
git add scripts/CaveSurvey/Core/CsSectionCut.js scripts/CaveSurvey/Core/CsAll.js tests/js_unit.js && git commit -m "feat(CsSectionCut): stable section frames along the alignment

A leg is straight, so there is no twist within one and the frame
problem is only choosing theta = 0. World up gives it, except on a
pitch where up lies along the leg and theta = 0 becomes noise -- so the
reference is carried between legs by double reflection, and re-seeded
only when it has drifted and up is trustworthy again.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Wall points that keep their third dimension

**Goal:** The same measured wall points the plan already uses, with `dz` kept.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsLrud.js`
- Modify: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `CsLrud.stationWallPoints3D(st, passageAz, lrud, splays, side, tapeMode, stats)` returns points carrying `z`.
- [ ] LRUD contributes L and R at the station's own `z`, and U and D straight up and down from it.
- [ ] A splay contributes `station + {dx, dy, dz}` from `CsTraverse.offset`, with the side rule identical to the 2D function's.
- [ ] `CsLrud.stationWallPoints` — the 2D one — is byte-for-byte unchanged in behaviour: the plan view must not move. Assert an existing plan fixture still produces the same points.

**Verify:** `node tests/js_unit.js` → `### UNIT OK <n> assertions`, and `./tests/run_all.sh` with `### PROFILE DRAW OK` (the plan and profile drawing paths both consume the 2D function)

**Steps:**

- [ ] **Step 1: Read the 2D function whole**

Read `scripts/CaveSurvey/Core/CsLrud.js:125-255`. The side assignment, the dead-zone rule and the `stats` accounting are subtle and already correct; the 3D sibling reuses them rather than restating them. Do NOT edit the 2D function.

- [ ] **Step 2: Write the failing test**

```javascript
(function() {
    // A station at z = 100, passage running east, U = 4, D = 6.
    var st = { x: 0, y: 0, z: 100 };
    var lrud = { left: 3, right: 5, up: 4, down: 6, azimuth: 90 };
    var pts = CsLrud.stationWallPoints3D(st, 90, lrud, [], "L",
        CsTraverse.SLOPE, null);
    ok(pts.length >= 1, "stationWallPoints3D: the left wall is a point");
    near(pts[0].p.z, 100, 1e-9,
        "stationWallPoints3D: a left wall point sits at the station's z");

    var up = CsLrud.stationCeilingFloor3D(st, lrud);
    near(up.ceiling.z, 104, 1e-9, "stationCeilingFloor3D: U is z + up");
    near(up.floor.z, 94, 1e-9, "stationCeilingFloor3D: D is z - down");
})();
```

- [ ] **Step 3: Run and watch it fail**, then add the two functions to `CsLrud.js`, delegating side assignment to the existing helpers and keeping `dz`:

```javascript
/**
 * The 3D sibling of stationWallPoints: the SAME measured wall points,
 * with the elevation kept.
 *
 * The 2D function drops dz because the plan view has no use for it.
 * That is correct there and wrong here: a cross section is exactly the
 * view that needs it. Side assignment, the dead zone and the stats
 * accounting are the 2D function's, unchanged -- this differs in what
 * it keeps, not in what it decides.
 */
CsLrud.stationWallPoints3D = function(st, passageAz, lrud, splays, side,
        tapeMode, stats) {
    var entries = [];
    var z0 = (st.z === undefined || st.z === null) ? 0 : st.z;

    if (lrud !== null && lrud !== undefined) {
        var len = (side === "L") ? lrud.left : lrud.right;
        if (len !== null && len !== undefined) {
            var p = (len === 0) ? { x: st.x, y: st.y } :
                CsLrud.tickEnd(st, lrud.azimuth, side, len);
            if (p !== null) {
                // L and R are measured horizontally, so they sit at the
                // station's own elevation.
                entries.push({ p: { x: p.x, y: p.y, z: z0 },
                               t: 0.0, order: -1 });
            }
        }
    }

    if (splays !== undefined && splays !== null) {
        for (var i = 0; i < splays.length; i++) {
            var sp = splays[i];
            var rel = CsLrud.relativeBearing(passageAz,
                CsTraverse.effectiveAzimuth(sp));
            if (rel === 0.0 || rel === 180.0 || rel === -180.0) {
                continue;
            }
            var onRight = (rel > 0.0);
            if ((side === "R") !== onRight) {
                continue;
            }
            var o = CsTraverse.offset(sp, tapeMode);
            if (o === null) {
                if (stats !== null && stats !== undefined) {
                    stats.skipped = (stats.skipped || 0) + 1;
                }
                continue;
            }
            // THE WHOLE POINT: dz is kept.
            entries.push({ p: { x: st.x + o.dx, y: st.y + o.dy,
                                z: z0 + o.dz },
                           t: 0.0, order: i });
        }
    }
    return entries;
};

/** The ceiling and floor points a station's U and D give, in 3D. */
CsLrud.stationCeilingFloor3D = function(st, lrud) {
    var z0 = (st.z === undefined || st.z === null) ? 0 : st.z;
    var out = { ceiling: null, floor: null };
    if (lrud === null || lrud === undefined) {
        return out;
    }
    if (lrud.up !== null && lrud.up !== undefined) {
        out.ceiling = { x: st.x, y: st.y, z: z0 + lrud.up };
    }
    if (lrud.down !== null && lrud.down !== undefined) {
        out.floor = { x: st.x, y: st.y, z: z0 - lrud.down };
    }
    return out;
};
```

- [ ] **Step 4: Prove the 2D path did not move**

Run: `node tests/js_unit.js` → OK
Run: `./tests/run_all.sh` → `### PROFILE DRAW OK` and every other section OK. That driver is the plan-and-profile regression; if the 2D function changed, it fails here.

- [ ] **Step 5: Commit**

```bash
git add scripts/CaveSurvey/Core/CsLrud.js tests/js_unit.js && git commit -m "feat(CsLrud): a 3D sibling of stationWallPoints, keeping dz

CsTraverse.offset has always returned {dx, dy, dz}; the plan view drops
dz because it has no use for it. A cross section is exactly the view
that does. Side assignment, the dead zone and the stats accounting are
the 2D function's, unchanged -- this differs in what it keeps, not in
what it decides.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: The cut — polygon, resample, lerp, and what it refuses

**Goal:** Given a leg and a fraction, the section outline in plane coordinates, with its honesty reported alongside.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsSectionCut.js`
- Modify: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `CsSectionCut.polygonAt(survey, resolved, station, frame, opts)` returns `{points: [{theta, radius}], measured: n}` — measured wall points projected into the frame.
- [ ] `CsSectionCut.radiusAt(polygon, theta)` returns the distance to the polygon BOUNDARY along that ray, not the nearest vertex.
- [ ] `CsSectionCut.cut(survey, resolved, legKey, t, opts)` returns `{outline, reentrant, measuredA, measuredB, nearest, reseeded}` or `{refused, reason}`.
- [ ] `ANGLES` defaults to 32 and is settable.
- [ ] Both stations `L=R=U=D=10` gives radius 10 at every sampled angle, for any `t`.
- [ ] `L=10` at A, `L=20` at B gives exactly 15 leftward at `t=0.5` and 12 at `t=0.2`.
- [ ] A re-entrant polygon sets `reentrant: true` and still returns the simplified outline.
- [ ] Fewer than three wall points at either end returns `{refused, reason}` naming that station.
- [ ] A splay shot 45° forward lands at its PERPENDICULAR distance, not its slope distance.

**Verify:** `node tests/js_unit.js` → `### UNIT OK <n> assertions`

**Steps:**

- [ ] **Step 1: Write the tests first, with the numbers worked by hand**

```javascript
(function() {
    var survey = csSectionFixtureSurvey();      // helper, below
    var resolved = csSectionFixtureResolved();

    var even = CsSectionCut.cut(survey, resolved, "A1->A2", 0.5, {});
    ok(even.refused === undefined, "CsSectionCut.cut: an even leg cuts");
    for (var i = 0; i < even.outline.length; i++) {
        near(even.outline[i].radius, 10, 1e-9,
            "CsSectionCut.cut: a 10-all passage is 10 at every angle");
    }
    eqs(even.outline.length, 32,
        "CsSectionCut.cut: 32 sampled angles by default");

    var half = CsSectionCut.cut(survey, resolved, "A3->A4", 0.5, {});
    near(CsSectionCut.radiusAt(half.polygon, Math.PI), 15, 1e-9,
        "CsSectionCut.cut: L=10 and L=20 lerp to 15 at t=0.5");
    var fifth = CsSectionCut.cut(survey, resolved, "A3->A4", 0.2, {});
    near(CsSectionCut.radiusAt(fifth.polygon, Math.PI), 12, 1e-9,
        "CsSectionCut.cut: and to 12 at t=0.2");

    var thin = CsSectionCut.cut(survey, resolved, "A5->A6", 0.5, {});
    ok(thin.refused === true,
        "CsSectionCut.cut: two wall points cannot make a boundary");
    ok(String(thin.reason).indexOf("A5") >= 0,
        "CsSectionCut.cut: and the refusal names the station");
})();
```

Write `csSectionFixtureSurvey` / `csSectionFixtureResolved` as real helpers in the test file, in the shape the existing `CsProfile` fixtures use — read those first and follow them.

- [ ] **Step 2: Run and watch each assertion fail**, then implement:

```javascript
/** How many angles a section is sampled at. 32 is fine for a printed
 *  section and makes a four-point LRUD diamond a 32-vertex near-diamond
 *  -- more vertices than there is evidence for, which is why the count
 *  is settable and stated rather than hidden. */
CsSectionCut.ANGLES = 32;

/**
 * A station's measured wall points, projected into the section plane.
 *
 * Projecting ALONG the leg is what makes an obliquely shot splay
 * contribute its PERPENDICULAR distance -- what a section wants -- at
 * the cost of discarding where along the passage it was shot. That
 * trade is the section's to make, and it is stated on the drawing.
 *
 * \return {points: [{theta, radius}] sorted by theta, measured: n}
 */
CsSectionCut.polygonAt = function(survey, resolved, stationName, frame,
        opts) {
    var st = resolved.stations[stationName];
    if (st === undefined || st === null) {
        return null;
    }
    var o = opts || {};
    var lrud = CsModel.lrudForStation(survey, stationName);
    var splays = (o.splaysByStation || {})[stationName] || [];
    var passageAz = (lrud && lrud.azimuth !== undefined) ? lrud.azimuth : 0;
    var tapeMode = o.tapeMode || CsTraverse.SLOPE;

    var raw = [];
    var side, pts, i;
    for (side = 0; side < 2; side++) {
        pts = CsLrud.stationWallPoints3D(st, passageAz, lrud, splays,
            side === 0 ? "L" : "R", tapeMode, null);
        for (i = 0; i < pts.length; i++) {
            raw.push(pts[i].p);
        }
    }
    var ud = CsLrud.stationCeilingFloor3D(st, lrud);
    if (ud.ceiling !== null) { raw.push(ud.ceiling); }
    if (ud.floor !== null) { raw.push(ud.floor); }

    var points = [];
    for (i = 0; i < raw.length; i++) {
        var rel = CsSectionCut.sub(raw[i], st);
        var perp = CsSectionCut.sub(rel,
            CsSectionCut.scale(frame.d, CsSectionCut.dot(rel, frame.d)));
        var radius = CsSectionCut.length(perp);
        if (radius < CsSectionCut.EPS) {
            continue;              // the wall is at the station
        }
        points.push({
            theta: Math.atan2(CsSectionCut.dot(perp, frame.s),
                              CsSectionCut.dot(perp, frame.r)),
            radius: radius
        });
    }
    points.sort(function(a, b) {
        // CaveCAD's sort is UNSTABLE, so never return 0 for two
        // distinct entries: tie-break on radius.
        if (a.theta !== b.theta) { return a.theta - b.theta; }
        return a.radius - b.radius;
    });
    return { points: points, measured: points.length };
};

/**
 * The distance from the centre to the polygon BOUNDARY along `theta`.
 *
 * Sampling the boundary and not the vertices is load-bearing: a
 * four-point LRUD diamond sampled at its vertices reads as a
 * four-spoke star, which is not what anybody measured.
 *
 * \return the radius, or null when the ray crosses nothing.
 */
CsSectionCut.radiusAt = function(polygon, theta) {
    var hits = CsSectionCut.boundaryHits(polygon, theta);
    return hits.length === 0 ? null : hits[0];
};

/** Every crossing of the boundary along `theta`, nearest first. More
 *  than one means a re-entrant, which the caller reports. */
CsSectionCut.boundaryHits = function(polygon, theta) {
    var pts = polygon.points;
    var out = [];
    if (pts.length < 3) {
        return out;
    }
    var dx = Math.cos(theta), dy = Math.sin(theta);
    for (var i = 0; i < pts.length; i++) {
        var a = pts[i], b = pts[(i + 1) % pts.length];
        var ax = a.radius * Math.cos(a.theta), ay = a.radius * Math.sin(a.theta);
        var bx = b.radius * Math.cos(b.theta), by = b.radius * Math.sin(b.theta);
        // ray from the origin along (dx, dy) against segment a->b
        var ex = bx - ax, ey = by - ay;
        var den = dx * ey - dy * ex;
        if (Math.abs(den) < CsSectionCut.EPS) {
            continue;                     // parallel
        }
        var s = (ax * ey - ay * ex) / den;      // along the ray
        var u = (ax * dy - ay * dx) / den;      // along the segment
        if (s > 0 && u >= 0 && u <= 1) {
            out.push(s);
        }
    }
    out.sort(function(p, q) { return p - q; });
    return out;
};
```

Then `CsSectionCut.cut` composes them: resolve the leg's two stations, build the frame from the leg direction, build both polygons, refuse if either has fewer than three points (naming which), sample `ANGLES` angles, lerp the radii, set `reentrant` when any angle produced more than one boundary hit at either end, and report `nearest` as the smaller of the two distances along the leg.

- [ ] **Step 3: Run until every assertion passes**

Run: `node tests/js_unit.js` → `### UNIT OK <n> assertions`

- [ ] **Step 4: Mutation-check the two that matter**

Delete the `radiusAt` boundary walk and return the nearest vertex instead: the "10 at every angle" assertion MUST fail. Restore it. Then set `ANGLES` to 16: the "32 sampled angles" assertion MUST fail. Restore. A rising assertion count is not coverage — the standard this suite adopted mid-flight is that a named test fails when the behaviour is deleted.

- [ ] **Step 5: Commit**

```bash
git add scripts/CaveSurvey/Core/CsSectionCut.js tests/js_unit.js && git commit -m "feat(CsSectionCut): the cut itself -- polygon, resample, lerp

Radii are sampled against the polygon BOUNDARY, not its vertices: a
four-point LRUD diamond sampled at vertices reads as a four-spoke star,
which is not what anybody measured. A re-entrant is detected (a ray
crossing the boundary twice) and reported as simplified rather than
silently truncated, and an end with fewer than three wall points is
refused by name instead of drawn from two points and a hope.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: A cut becomes a block

**Goal:** One block definition per section — outline, splays, centreline mark, caption — that can be redefined in place.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsSectionDraw.js`
- Modify: `scripts/CaveSurvey/Core/CsAll.js`

**Acceptance Criteria:**
- [ ] `CsSectionDraw.blockName(calloutId)` returns `CS_<id>` — one definition per section, so editing one never touches another.
- [ ] `CsSectionDraw.define(doc, di, name, cut, opts)` creates or REDEFINES the block: clears its existing entities, then draws outline, splays, centreline mark and caption on the section layers.
- [ ] The caption states the scale, the cut point, and the distance to the nearest contributing station.
- [ ] A re-entrant cut's caption says so.
- [ ] Geometry is scaled by the section's own scale, not the drawing's.
- [ ] Redefining updates a placed reference — assert a reference's bounding box changes after a redefine that grows the outline.

**Verify:** `./tests/run_all.sh` → all sections OK (Task 8 adds the driver that proves the redefine)

**Steps:**

- [ ] **Step 1: Confirm the block mechanics before writing against them**

Already probed on 2026-08-29 and recorded in `2026-08-29-lrud-callout-research.md`: `new RBlock(doc, name, origin)` + `RAddObjectOperation` creates a definition; `entity.setBlockId(bid)` puts an entity INSIDE it; `RBlockReferenceEntity` places it; adding to the definition and calling `ref.update()` moved a placed instance's bbox from `100,100→110,100` to `100,100→110,125`; `doc.queryBlockReferences(bid)` finds instances; `setCustomProperty` works on the reference.

**The update() rule is not optional.** `CalloutWrite.boxOf`'s own docblock records that bounding boxes are CACHED and a modify does not invalidate them — that is what let "the arrows do not follow the note" survive a green test suite. Every read of a redefined block's box calls `update()` first.

- [ ] **Step 2: Write the module**

Draw into the definition on the layers shipped in 0.9.21.0: outline on `CsLayers.SECTION_OUTLINE`, splays on `CsLayers.SECTION_SPLAYS`, the centreline mark and scale ticks on `CsLayers.SECTION_STATIONS`, the caption on `CsLayers.SECTION_TEXT_LABELS`. Follow `CsProfileDraw`'s erase-and-redraw shape: key the erase on BOTH the tag namespace AND layer membership, so a caver's own promoted geometry is never eaten.

Redefining clears the definition's existing entities first — `doc.queryBlockEntities(bid)`, delete each, then draw. Use one operation so undo is one step.

- [ ] **Step 3: Syntax check and full suite**

Run: `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/js_syntax.js "$PWD"` → `### SYNTAX OK`
Run: `./tests/run_all.sh` → every section OK.

- [ ] **Step 4: Commit**

```bash
git add scripts/CaveSurvey/Core/CsSectionDraw.js scripts/CaveSurvey/Core/CsAll.js && git commit -m "feat(CsSectionDraw): a cut becomes its own block

One definition per section, named by its callout id, so a caver can
edit one without touching any other and the whole section moves as a
unit. Redefining in place is what lets a section follow the survey
without leaving where it was put.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: The callout carries it

**Goal:** A leader from the cut point to the block, using the existing callout machinery.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsCallout.js` (`KEY`, `KIND_SECTION`, `ROLE_BLOCK`)
- Modify: `scripts/CaveSurvey/Callout/CalloutWrite.js` (`members`, `boxOf`, create, `refreshSections`)
- Modify: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `CsCallout.KIND_SECTION` and `CsCallout.ROLE_BLOCK` exist; `KEY` gains `SECTION_FROM`, `SECTION_TO`, `SECTION_FRACTION`, `SECTION_SCALE`, `SECTION_ANGLES`, `SECTION_NEAREST`, `SECTION_FROZEN`.
- [ ] `CalloutWrite.members` returns a `block` member alongside `text` and `leaders`.
- [ ] The leader reflows against the BLOCK's bounding box — `CsCallout.reflow` takes a plain box, so it is unchanged.
- [ ] `CalloutWrite.refreshSections(doc, di, survey, resolved)` re-derives every section callout, redefines its block, and returns `{updated, unchanged, frozen, lost, refused}`.
- [ ] A section tagged `SectionFrozen=1` is skipped and counted as `frozen`.
- [ ] A section whose leg has vanished is counted `lost` and left alone, never deleted.
- [ ] The block REFERENCE's position, scale and rotation are never written by a refresh.

**Verify:** `./tests/run_all.sh` → `### CALLOUT-WRITE OK` and `### CALLOUT-SYNC OK` still pass, plus the new assertions

**Steps:**

- [ ] **Step 1: Read `refreshElevations` end to end** (`CalloutWrite.js:630-757`). It is the model: provenance off the tags, the "is this still ours?" guard, `lost` counted rather than deleted, `CsLayers.withLayerOn` around the write. `refreshSections` is the same shape with the guard replaced — see Step 3.

- [ ] **Step 2: Extend the tables in `CsCallout.js`**, keeping the rule its docblock states: nothing outside `CsCallout.KEY` may hard-code a tag string.

- [ ] **Step 3: The freeze guard, and why it replaces the hand-edit comparison**

An elevation callout guards itself by recomputing what its stored value WOULD have rendered as, and leaving the text alone if a human changed it. A regenerated block cannot be compared that cheaply. So the guard is explicit instead:

```javascript
// A regenerated BLOCK cannot be compared against "what it would have
// rendered" the way a text label can, so the hand-edit guard is
// explicit rather than inferred: SectionFrozen=1 means the caver owns
// this one's geometry now. Frozen sections are COUNTED, never silently
// skipped -- a stale section on a plotted map is exactly the failure
// this whole refresh exists to prevent.
if (CsTags.get(ref, CsCallout.KEY.SECTION_FROZEN) === "1") {
    out.frozen++;
    continue;
}
```

- [ ] **Step 4: Run the callout drivers**

Run: `./tests/run_all.sh` → `### CALLOUT-WRITE OK` and `### CALLOUT-SYNC OK` must both still pass. They are the regression for the existing callout kinds; a third kind must not disturb them.

- [ ] **Step 5: Commit**

```bash
git add scripts/CaveSurvey/Core/CsCallout.js scripts/CaveSurvey/Callout/CalloutWrite.js tests/js_unit.js && git commit -m "feat(Callout): a third kind, whose content is a block

KIND_SECTION rides the machinery KIND_ELEV already proved: provenance
on the entity, re-derivation on Draw, lost bases counted rather than
deleted. The hand-edit guard is explicit (SectionFrozen) because a
regenerated block cannot be compared against what it would have drawn.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: The tool — two clicks

**Goal:** Pick a point on the alignment, pick where the section goes.

**Files:**
- Create: `scripts/CaveSurvey/CrossSection/CrossSection.js`, `CrossSection.svg`, `CrossSection-inverse.svg`
- Modify: `README.md` (the tool table)

**Acceptance Criteria:**
- [ ] `Cave Survey > Cross Section`, commands `crosssection` / `cxs`, unique sort order.
- [ ] First pick snaps to the nearest LEG and reports which leg and the fraction along it.
- [ ] Second pick places the block; live preview between the two, as `CalloutElev` does.
- [ ] A pick nowhere near a leg is refused with the reason, not silently ignored.
- [ ] A refused cut (thin ends) explains itself and terminates cleanly.
- [ ] Follows the add-on wiring conventions exactly — `init(basePath)`, `setRequiresDocument`, icon, status tip, `setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"])`; a tool that misses one vanishes from the menu with no error.

**Verify:** `python3 -m unittest discover -s tests` → OK (`test_addon.py` checks wiring, unique sort order, icon and README row)

**Steps:**

- [ ] **Step 1: Copy the shape of `CalloutElev.js`** — it is the two-click, no-dialog callout tool this one is a sibling of.
- [ ] **Step 2: Nearest-leg snap.** For each leg, the perpendicular foot of the pick, clamped to `[0,1]`; the winner is the smallest distance, and a distance beyond `CsSectionCut.MAX_PICK` (default one station spacing) is a refusal.
- [ ] **Step 3: Wire it**, then run `python3 -m unittest discover -s tests -v` and fix whatever `test_addon.py` reports — it is the wiring contract.
- [ ] **Step 4: Commit.**

---

## Task 7: Draw regenerates every section

**Goal:** Sections follow the survey, and the report says what happened.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsDraw.js` (beside `refreshElevationsFromDocument`, `:1044`)
- Modify: `scripts/CaveSurvey/GenerateProfile/GenerateProfile.js` (the report)

**Acceptance Criteria:**
- [ ] `CsDraw.survey` calls `refreshSections` and carries its counts in the return value beside `elevations`.
- [ ] A reader PRINTS them: `"4 section(s) updated, 1 frozen, 1 lost (A7->A8 is gone)"`.
- [ ] The refresh runs inside the draw's own transaction, so one Ctrl+Z takes the survey and its sections back together.
- [ ] A failure inside the section pass can never take the plan draw down — wrapped whole, the way the profile pass is.

**Verify:** `./tests/run_all.sh` → all sections OK

**This task is where this suite's recurring failure mode lives:** four separate instances on record of a value computed and never surfaced. It is not done until a reader prints the counts.

---

## Task 8: Prove it, publish it

**Goal:** A driver that cuts, redraws and asserts the block followed while the reference did not move.

**Files:**
- Create: `tests/cross_section_run.js`
- Modify: `tests/run_all.sh` (a new section, renumber the headers), `tests/README.md`, `VERSION` (→ 0.9.22.0)

**Acceptance Criteria:**
- [ ] Prints `### CROSS SECTION OK` / `### CROSS SECTION FAIL`.
- [ ] Asserts: a cut on a fixture survey creates a block and a leader sharing one `CalloutId`.
- [ ] Asserts: moving a station and redrawing REDEFINES the block (its bounding box changes) and does NOT move the reference (its insertion point is identical).
- [ ] Asserts: a frozen section is not redefined, and is counted.
- [ ] Asserts: deleting the leg leaves the section alone and counts it lost.
- [ ] Every assertion is mutation-checked — delete the behaviour, confirm the NAMED assertion fails.
- [ ] `./tests/run_all.sh --publish` passes every section.

**Verify:** `./tests/run_all.sh --publish` → no `did not pass`, then publish and look at it in a restarted CaveCAD.

---

## Out of scope

- Sections of the ELEVATION frame; cuts are taken through the plan.
- Interpolating anything other than radii — no shape carried from a neighbouring passage.
- Splines. Straight segments between sampled points, like the rest of the suite.
- Binding section linework (held out deliberately in 0.9.21.0; unchanged here).
- Per-section layer variants. `CsLayerVariants` would generalise for free, and nothing needs it yet.
