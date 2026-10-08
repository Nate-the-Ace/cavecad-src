// Angles.js -- azimuth parsing, normalization and declination.
//
// Part of the Cave Survey Core library: pure functions, no GUI, no
// document access.
//
// CONVENTIONS (these hold suite-wide):
//   Azimuth is degrees clockwise from north: 0 = N, 90 = E.
//   Declination is degrees, positive EAST: true = magnetic + declination.
//   Inclination is degrees, positive up, in [-90, +90].

var CsAngles = {};

CsAngles.DEG_PER_GRAD = 0.9; // 400 grads = 360 degrees

/** Brings an azimuth into [0, 360). */
CsAngles.normalizeAzimuth = function(deg) {
    var a = deg % 360.0;
    if (a < 0) {
        a += 360.0;
    }
    return a;
};

/**
 * The smallest absolute difference between two azimuths, in degrees
 * (0..180). Used by the blunder checks to ask "is this shot about
 * 180 degrees off its sibling?".
 */
CsAngles.azimuthDifference = function(a, b) {
    var d = Math.abs(CsAngles.normalizeAzimuth(a) - CsAngles.normalizeAzimuth(b));
    return d > 180.0 ? 360.0 - d : d;
};

/** Applies declination (positive east) to a magnetic azimuth. */
CsAngles.applyDeclination = function(magneticDeg, declinationDeg) {
    return CsAngles.normalizeAzimuth(magneticDeg + declinationDeg);
};

/** Grads to degrees (Survex's "*units compass grads"). */
CsAngles.gradsToDegrees = function(grads) {
    return grads * CsAngles.DEG_PER_GRAD;
};

/**
 * Parses a quadrant bearing ("N30E", "S12.5W") to an azimuth, or
 * returns undefined if the text isn't one. Walls allows these.
 */
CsAngles.parseQuadrant = function(text) {
    if (text === undefined || text === null) {
        return undefined;
    }
    var m = /^([NnSs])\s*([\d.]+)\s*([EeWw])$/.exec(String(text));
    if (m === null) {
        return undefined;
    }
    var deg = parseFloat(m[2]);
    if (isNaN(deg) || deg > 90) {
        return undefined;
    }
    var north = (m[1] === "N" || m[1] === "n");
    var east = (m[3] === "E" || m[3] === "e");
    var az;
    if (north) {
        az = east ? deg : 360.0 - deg;
    } else {
        az = east ? 180.0 - deg : 180.0 + deg;
    }
    return CsAngles.normalizeAzimuth(az);
};

/**
 * Parses a latitude/longitude in the common pasted forms:
 *   40 30'15.0"N 90 15'30.0"W     (Google Maps dropped pin, degree
 *                                  symbol optional or mangled)
 *   40.5042, -90.2583             (decimal degrees)
 * Returns {lat, lon} in decimal degrees, or null.
 */
CsAngles.parseLatLon = function(text) {
    if (text === undefined || text === null) {
        return null;
    }
    var s = String(text);

    var re = /(\d+)\D+(\d+)'([\d.]+)"?\s*([NSns])\D+(\d+)\D+(\d+)'([\d.]+)"?\s*([EWew])/;
    var m = re.exec(s);
    if (m !== null) {
        var toDecimal = function(deg, min, sec, hemi) {
            var dec = parseFloat(deg) + parseFloat(min) / 60.0 + parseFloat(sec) / 3600.0;
            if (hemi === "S" || hemi === "s" || hemi === "W" || hemi === "w") {
                dec = -dec;
            }
            return dec;
        };
        return {
            lat: toDecimal(m[1], m[2], m[3], m[4]),
            lon: toDecimal(m[5], m[6], m[7], m[8])
        };
    }

    var md = /^\s*(-?[\d.]+)\s*[, ]\s*(-?[\d.]+)\s*$/.exec(s);
    if (md !== null) {
        var lat = parseFloat(md[1]);
        var lon = parseFloat(md[2]);
        if (!isNaN(lat) && !isNaN(lon) &&
            Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
            return { lat: lat, lon: lon };
        }
    }

    return null;
};

/**
 * Formats a declination for people: "3.2 deg E" / "4.9 deg W" / "0.0 deg".
 * The sign convention (east positive) is easy to hold wrong in your
 * head, so user-facing text always says E or W instead.
 */
CsAngles.formatDeclination = function(deg) {
    if (deg === undefined || deg === null || isNaN(deg)) {
        return "unknown";
    }
    var abs = Math.abs(deg).toFixed(1);
    if (Math.abs(deg) < 0.05) {
        return "0.0°";
    }
    return abs + "° " + (deg > 0 ? "E" : "W");
};
