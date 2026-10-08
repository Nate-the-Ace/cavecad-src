// Units.js -- distance unit registry and conversion.
//
// Part of the Cave Survey Core library: pure functions, no GUI, no
// document access. See docs/superpowers/specs/ for the design.
//
// The suite stores every survey's distances in the unit the source
// declared ("ft" or "m") and converts at the drawing boundary, driven
// by the drawing's own unit -- never by a constant edited in source.

var CsUnits = {};

CsUnits.FEET_PER_METER = 3.280839895;

// Canonical unit names used throughout the suite.
CsUnits.FEET = "ft";
CsUnits.METERS = "m";

/**
 * Normalizes the many spellings survey formats use ("feet", "Meters",
 * "M", "FT") to "ft"/"m". Returns undefined for anything else.
 */
CsUnits.normalize = function(name) {
    if (name === undefined || name === null) {
        return undefined;
    }
    var n = String(name).toLowerCase();
    if (n === "ft" || n === "feet" || n === "foot" || n === "f") {
        return CsUnits.FEET;
    }
    if (n === "m" || n === "meters" || n === "metres" || n === "meter" || n === "metre") {
        return CsUnits.METERS;
    }
    return undefined;
};

/**
 * Converts a distance between "ft" and "m". Unknown units pass the
 * value through unchanged -- a wrong number is worse than a missing
 * conversion, and the callers validate units before this point.
 */
CsUnits.convert = function(value, fromUnit, toUnit) {
    if (fromUnit === toUnit || fromUnit === undefined || toUnit === undefined) {
        return value;
    }
    if (fromUnit === CsUnits.FEET && toUnit === CsUnits.METERS) {
        return value / CsUnits.FEET_PER_METER;
    }
    if (fromUnit === CsUnits.METERS && toUnit === CsUnits.FEET) {
        return value * CsUnits.FEET_PER_METER;
    }
    return value;
};

/**
 * Maps a QCAD RS unit constant to "ft"/"m", so tools can follow the
 * drawing instead of asking. Anything metric maps to "m", anything
 * imperial to "ft"; unitless drawings default to feet, matching the
 * NSS templates. Takes the constant rather than reading the document
 * so this stays testable without one.
 */
CsUnits.fromDrawingUnit = function(rsUnit, rs) {
    // rs is the RS enum object, passed in so this file stays loadable
    // outside QCAD (tests stub it).
    if (rs === undefined || rsUnit === undefined) {
        return CsUnits.FEET;
    }
    if (rsUnit === rs.Millimeter || rsUnit === rs.Centimeter ||
        rsUnit === rs.Meter || rsUnit === rs.Kilometer) {
        return CsUnits.METERS;
    }
    if (rsUnit === rs.Inch || rsUnit === rs.Foot || rsUnit === rs.Yard ||
        rsUnit === rs.Mile) {
        return CsUnits.FEET;
    }
    return CsUnits.FEET;
};

/**
 * Rescales a whole survey into another distance unit, in place.
 *
 * Distances, LRUD and fixed-station coordinates all carry the survey's
 * unit; angles do not. Written here rather than inline at each caller
 * because a copy that forgets the fixed stations, or the LRUD, is a
 * drawing that looks right until somebody measures it.
 *
 * \return the survey.
 */
CsUnits.convertSurvey = function(survey, toUnit) {
    if (survey === undefined || survey === null) { return survey; }
    var from = CsUnits.normalize(survey.distanceUnit);
    var to = CsUnits.normalize(toUnit);
    if (from === undefined || to === undefined || from === to) {
        return survey;
    }

    var factor = CsUnits.convert(1.0, from, to);
    var scale = function(value) {
        return (typeof value === "number") ? value * factor : value;
    };

    var shots = (Object.prototype.toString.call(survey.shots) ===
        "[object Array]") ? survey.shots : [];
    for (var i = 0; i < shots.length; i++) {
        var shot = shots[i];
        shot.distance = scale(shot.distance);
        shot.left = scale(shot.left);
        shot.right = scale(shot.right);
        shot.up = scale(shot.up);
        shot.down = scale(shot.down);
    }

    if (survey.fixed !== undefined && survey.fixed !== null) {
        for (var name in survey.fixed) {
            if (!Object.prototype.hasOwnProperty.call(survey.fixed, name)) {
                continue;
            }
            var point = survey.fixed[name];
            point.x = scale(point.x);
            point.y = scale(point.y);
            point.z = scale(point.z);
        }
    }

    if (survey.startLrud !== undefined && survey.startLrud !== null) {
        survey.startLrud.left = scale(survey.startLrud.left);
        survey.startLrud.right = scale(survey.startLrud.right);
        survey.startLrud.up = scale(survey.startLrud.up);
        survey.startLrud.down = scale(survey.startLrud.down);
    }

    survey.distanceUnit = to;
    return survey;
};
