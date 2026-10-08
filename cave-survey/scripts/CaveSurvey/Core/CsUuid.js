/**
 * CsUuid -- opaque unique identities for anything in a drawing that has
 * to stay linked to something else in the same drawing.
 *
 * The first consumer is the callout (multileader) tools, where one id
 * binds a text entity to its own leader arrows. More dynamically linked
 * labels and objects are planned, so this lives here rather than on any
 * one tool.
 *
 * WHEN TO USE AN OPAQUE ID, AND WHEN NOT TO. The suite deliberately does
 * NOT use one for binding drawn geometry to SURVEY DATA. CsBind ties
 * linework to a trip with an integer trip id and says why
 * (CsBind.js:61): a date|team fingerprint "goes stale the moment a date
 * typo or a team spelling is corrected". That key has to MEAN something
 * outside itself -- it names a trip -- so it belongs to the survey, not
 * to a generated identity.
 *
 * A CsUuid means nothing outside itself. Reach for it when the link is
 * between two drawn things and the id needs exactly one property,
 * uniqueness: a label and its leaders, a symbol and its annotation, a
 * detail bubble and the detail it points at. Never derive such an id
 * from CONTENT the user edits -- fingerprinting a note's text would
 * break the link on the first corrected typo, which is the opposite of
 * what these links are for.
 *
 * PURE: plain strings in and out, no QCAD symbol, so tests/js_unit.js
 * exercises it under node as well as in CaveCAD's own engine.
 */
function CsUuid() {}

/** The shape v4() produces. Consumers validating an id read out of
 *  XDATA should use isValid() rather than retyping this. */
CsUuid.PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * A fresh identity, shaped like an RFC 4122 version-4 UUID.
 *
 * The shape matters only so that a human reading raw XDATA recognises
 * the value as an opaque identity and does not try to sort it, do
 * arithmetic on it, or infer creation order from it. Nothing in this
 * suite may depend on the digits.
 *
 * Math.random is seeded per process. The leading group is the low bytes
 * of the clock instead of more randomness, which guards the one case
 * plain Math.random would not: two CaveCAD instances started together
 * drawing the same pseudo-random sequence.
 *
 * NOT a replacement for a per-drawing counter in every case -- see the
 * module docblock. And note what NO id scheme can fix: copying an entity
 * WITHIN a drawing carries its XDATA, so the copy holds the same id.
 * Detecting and re-keying a duplicate is a repair job for whichever tool
 * owns the link, not something generation can prevent.
 */
CsUuid.v4 = function() {
    var hex = function(n) {
        var out = "";
        while (out.length < n) {
            var chunk = Math.floor(Math.random() * 0x10000).toString(16);
            while (chunk.length < 4) {
                chunk = "0" + chunk;
            }
            out += chunk;
        }
        return out.substring(0, n);
    };

    var stamp = (new Date()).getTime().toString(16);
    var timeTail = stamp.substring(Math.max(0, stamp.length - 8));
    while (timeTail.length < 8) {
        timeTail = "0" + timeTail;
    }

    // version 4, variant 10xx
    var variant = "89ab".charAt(Math.floor(Math.random() * 4));
    return timeTail + "-" + hex(4) + "-4" + hex(3) + "-" +
        variant + hex(3) + "-" + hex(12);
};

/** True when `value` is a string of the shape v4() produces. Anything
 *  else -- null, "", a number, a hand-edited tag -- is false rather
 *  than a throw: a drawing with one malformed id must still open. */
CsUuid.isValid = function(value) {
    if (value === null || value === undefined) {
        return false;
    }
    return CsUuid.PATTERN.test(String(value));
};
