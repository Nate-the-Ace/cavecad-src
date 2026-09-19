/**
 * Copyright (c) 2026 CaveCAD contributors.
 *
 * This file is part of CaveCAD, a fork of the QCAD project.
 *
 * CaveCAD is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * CaveCAD is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with CaveCAD.
 */

/**
 * \class LayerFilter
 * \brief What the Layer Manager's filter box means.
 *
 * Its own file, and not a function inside RLayerTreeQt.js, for one
 * reason: that file subclasses RTreeWidget at load time and therefore
 * cannot be loaded without Qt, so nothing in it can be unit tested.
 * This is pure string work, it is the part most likely to go quietly
 * wrong, and here it is testable.
 */
function LayerFilter() {
}

/**
 * \return A function answering "does this name match?", or undefined
 * when there is no filter at all.
 *
 * WILDCARDS WHEN YOU TYPE ONE, SUBSTRING WHEN YOU DO NOT. `*` is any
 * run of characters and `?` is exactly one, as everywhere else in CAD.
 * A pattern is ANCHORED: "CTRL-*" means names that start that way.
 * Plain text stays a substring search, because a caver typing "scan"
 * means "show me the scan layers", and an anchored "scan" would match
 * nothing at all and look broken.
 *
 * Commas separate alternatives -- "CTRL-*,PROFILE-*" shows both. A
 * cave's layers come in families and wanting two of them is ordinary.
 *
 * \param text Expected already lower cased; names are matched lower
 *        cased too, so the whole thing is case insensitive.
 */
LayerFilter.build = function(text) {
    if (isNull(text)) {
        return undefined;
    }
    text = String(text).trim();
    if (text.length === 0) {
        return undefined;
    }

    var parts = text.split(",");
    var tests = [];
    for (var i = 0; i < parts.length; i++) {
        var part = parts[i].trim();
        if (part.length === 0) {
            continue;
        }

        if (part.indexOf("*") < 0 && part.indexOf("?") < 0) {
            tests.push((function(needle) {
                return function(name) { return name.indexOf(needle) >= 0; };
            })(part));
            continue;
        }

        // Everything a regular expression reads specially is escaped
        // FIRST and the two wildcards put back after: a layer name is
        // full of hyphens, and CTRL-LRUD-WALL-LEFT would otherwise be
        // a character class away from nonsense.
        var pattern = "^" +
            part.replace(/[.+^${}()|[\]\\]/g, "\\$&")
                .replace(/\*/g, ".*")
                .replace(/\?/g, ".") +
            "$";
        try {
            tests.push((function(re) {
                return function(name) { return re.test(name); };
            })(new RegExp(pattern)));
        }
        catch (e) {
            // An unparseable pattern matches NOTHING. Matching
            // everything would look exactly like the filter being
            // ignored, and the caver would go looking for the bug in
            // their layer names.
            tests.push(function() { return false; });
        }
    }

    if (tests.length === 0) {
        return undefined;
    }
    return function(name) {
        for (var j = 0; j < tests.length; j++) {
            if (tests[j](name)) {
                return true;
            }
        }
        return false;
    };
};
