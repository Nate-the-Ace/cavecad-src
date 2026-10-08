// Geomag.js -- magnetic declination from latitude, longitude and date,
// using the IGRF (International Geomagnetic Reference Field) model.
//
// Part of the Cave Survey Core library: pure math, no GUI, no network.
//
// WHY THIS EXISTS: old survey notes rarely record the declination in
// force on the day, and NOAA's online calculator only goes back so
// far. IGRF covers 1900 to the present from published, public-domain
// spherical-harmonic coefficients (see IgrfCoeffs.js), and its error
// -- a fraction of a degree over most of the century -- is noise next
// to the +/-2.5 degree compass of a BCRA Grade 3 survey.
//
// The estimate is exactly that, an estimate: every place it is offered
// in the suite it is labelled as one and stays editable.
//
// Implementation follows the standard IGRF synthesis: geodetic to
// geocentric conversion on the WGS84 ellipsoid, Schmidt
// semi-normalized associated Legendre functions by recurrence, linear
// interpolation of coefficients between 5-year epochs (secular
// variation extrapolation after the last epoch), and rotation of the
// field vector back to geodetic north/east/down. Validated against
// ppigrf (the published Python implementation of the same model) in
// tests/js_unit.js.

include(includeBasePath + "/CsIgrfCoeffs.js");

var CsGeomag = {};

CsGeomag.EARTH_REFERENCE_RADIUS_KM = 6371.2; // IGRF's own reference sphere
CsGeomag.WGS84_A_KM = 6378.137;              // ellipsoid semi-major axis
CsGeomag.WGS84_B_KM = 6356.7523142;          // ellipsoid semi-minor axis

CsGeomag.MIN_YEAR = 1900.0;

/**
 * Converts a date to a decimal year. Accepts {year, month, day}
 * (month 1-12) or a plain number that is already a decimal year.
 */
CsGeomag.decimalYear = function(date) {
    if (typeof date === "number") {
        return date;
    }
    var days = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    var y = date.year;
    var leap = (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
    var doy = days[date.month - 1] + date.day + ((leap && date.month > 2) ? 1 : 0);
    return y + (doy - 1) / (leap ? 366.0 : 365.0);
};

/**
 * The Gauss coefficients g/h at a decimal year, linearly interpolated
 * between epochs, or extrapolated by the published secular variation
 * after the last epoch. Returns null before 1900 -- outside the model.
 */
CsGeomag.coefficientsAt = function(year) {
    if (year < CsGeomag.MIN_YEAR) {
        return null;
    }
    var epochs = IGRF_EPOCHS;
    var last = epochs.length - 1;
    var i, frac;
    if (year >= epochs[last]) {
        i = last;
        frac = year - epochs[last]; // years past the last epoch, for SV
    } else {
        i = Math.floor((year - epochs[0]) / 5.0);
        frac = (year - epochs[i]) / (epochs[i + 1] - epochs[i]);
    }

    var out = [];
    for (var k = 0; k < IGRF_GH.length; k++) {
        var row = IGRF_GH[k];
        // row = [isH, n, m, v1900 .. vLast, svPerYear]
        var base = row[3 + i];
        var value;
        if (i === last) {
            value = base + row[row.length - 1] * frac;
        } else {
            value = base + (row[3 + i + 1] - base) * frac;
        }
        out.push({ isH: row[0] === 1, n: row[1], m: row[2], v: value });
    }
    return out;
};

/**
 * Declination at a point and date.
 *
 * \param latDeg geodetic latitude, degrees, north positive
 * \param lonDeg longitude, degrees, east positive
 * \param date {year, month, day} or decimal year
 * \param altKm altitude above the ellipsoid in km (optional; caves
 *              are near enough to 0 that omitting it is fine)
 *
 * \return {declination, inclinationMag, horizontalNt, totalNt, year}
 *         with declination in degrees, east positive -- exactly the
 *         sign convention CsAngles.applyDeclination expects -- or
 *         null for dates before 1900.
 */
CsGeomag.declination = function(latDeg, lonDeg, date, altKm) {
    var year = CsGeomag.decimalYear(date);
    var gh = CsGeomag.coefficientsAt(year);
    if (gh === null) {
        return null;
    }
    if (altKm === undefined) {
        altKm = 0.0;
    }

    var deg2rad = Math.PI / 180.0;

    // ---- geodetic -> geocentric ----------------------------------
    // Standard conversion from the reference IGRF code: from geodetic
    // colatitude on the WGS84 ellipsoid to geocentric radius and
    // colatitude, keeping the rotation (cd, sd) to bring the field
    // vector back afterwards.
    var colat = (90.0 - latDeg) * deg2rad;
    var ct = Math.cos(colat);
    var st = Math.sin(colat);
    var a2 = CsGeomag.WGS84_A_KM * CsGeomag.WGS84_A_KM;
    var b2 = CsGeomag.WGS84_B_KM * CsGeomag.WGS84_B_KM;
    var one = a2 * st * st;
    var two = b2 * ct * ct;
    var three = one + two;
    var rho = Math.sqrt(three);
    var r = Math.sqrt(altKm * (altKm + 2.0 * rho) + (a2 * one + b2 * two) / three);
    var cd = (altKm + rho) / r;
    var sd = (a2 - b2) / rho * ct * st / r;
    var ctOld = ct;
    ct = ct * cd - st * sd;   // geocentric cos(colatitude)
    st = st * cd + ctOld * sd;

    var phi = lonDeg * deg2rad;

    // ---- Schmidt semi-normalized Legendre functions --------------
    // P[n][m] and dP[n][m] (derivative in colatitude) by the standard
    // recurrences.
    var NMAX = 13;
    var cosTheta = ct;
    var sinTheta = st;
    var P = [], dP = [];
    var n, m;
    for (n = 0; n <= NMAX; n++) {
        P.push([]);
        dP.push([]);
        for (m = 0; m <= n; m++) {
            P[n].push(0.0);
            dP[n].push(0.0);
        }
    }
    P[0][0] = 1.0;
    dP[0][0] = 0.0;
    for (n = 1; n <= NMAX; n++) {
        for (m = 0; m <= n; m++) {
            if (n === m) {
                var k = (n === 1) ? 1.0 : Math.sqrt(1.0 - 1.0 / (2.0 * n));
                P[n][n] = k * sinTheta * P[n - 1][n - 1];
                dP[n][n] = k * (sinTheta * dP[n - 1][n - 1] + cosTheta * P[n - 1][n - 1]);
            } else {
                var f1 = (2.0 * n - 1.0) / Math.sqrt(n * n - m * m);
                var f2 = (n - 1 - m < 0 || n - 1 + m < 1) ? 0.0 :
                    Math.sqrt(((n - 1.0) * (n - 1.0) - m * m) / (n * n - m * m));
                var pPrev2 = (n >= 2 && m <= n - 2) ? P[n - 2][m] : 0.0;
                var dpPrev2 = (n >= 2 && m <= n - 2) ? dP[n - 2][m] : 0.0;
                P[n][m] = f1 * cosTheta * P[n - 1][m] - f2 * pPrev2;
                dP[n][m] = f1 * (cosTheta * dP[n - 1][m] - sinTheta * P[n - 1][m]) - f2 * dpPrev2;
            }
        }
    }

    // ---- gather coefficients into g[n][m], h[n][m] ----------------
    var g = [], h = [];
    for (n = 0; n <= NMAX; n++) {
        g.push([]);
        h.push([]);
        for (m = 0; m <= n; m++) {
            g[n].push(0.0);
            h[n].push(0.0);
        }
    }
    for (var idx = 0; idx < gh.length; idx++) {
        var c = gh[idx];
        if (c.isH) {
            h[c.n][c.m] = c.v;
        } else {
            g[c.n][c.m] = c.v;
        }
    }

    // ---- field synthesis ------------------------------------------
    // B_r      =  sum (n+1) (a/r)^(n+2) (g cos m phi + h sin m phi) P
    // B_theta  = -sum       (a/r)^(n+2) (g cos m phi + h sin m phi) dP
    // B_phi    = -sum       (a/r)^(n+2) m (-g sin m phi + h cos m phi) P / sin(theta)
    var aOverR = CsGeomag.EARTH_REFERENCE_RADIUS_KM / r;
    var Br = 0.0, Bt = 0.0, Bp = 0.0;
    var ratio = aOverR * aOverR; // (a/r)^2, becomes ^(n+2) in the loop
    for (n = 1; n <= NMAX; n++) {
        ratio *= aOverR;
        for (m = 0; m <= n; m++) {
            var cosm = Math.cos(m * phi);
            var sinm = Math.sin(m * phi);
            var gc = g[n][m] * cosm + h[n][m] * sinm;
            Br += (n + 1) * ratio * gc * P[n][m];
            Bt -= ratio * gc * dP[n][m];
            if (m > 0) {
                var gs = -g[n][m] * sinm + h[n][m] * cosm;
                Bp -= ratio * m * gs * P[n][m] / sinTheta;
            }
        }
    }

    // geocentric north/east/down:
    var x = -Bt;  // north
    var y = Bp;   // east
    var z = -Br;  // down

    // rotate back to geodetic:
    var xGeo = x * cd + z * sd;
    var zGeo = z * cd - x * sd;

    var decl = Math.atan2(y, xGeo) / deg2rad;
    var horiz = Math.sqrt(xGeo * xGeo + y * y);
    return {
        declination: decl,
        inclinationMag: Math.atan2(zGeo, horiz) / deg2rad,
        horizontalNt: horiz,
        totalNt: Math.sqrt(horiz * horiz + zGeo * zGeo),
        year: year
    };
};
