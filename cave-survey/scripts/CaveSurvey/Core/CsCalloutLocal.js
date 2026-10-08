// CsCalloutLocal.js -- the callout card's topside contacts.
//
// Part of the Cave Survey Core library. Names and phone numbers are
// personal data: they live in per-user QCAD settings on this machine and
// are NEVER written to stations.json or the cave folder (Drive syncs
// that). The codec is pure; load/save touch RSettings.
//
// The roster that used to live here (settings key
// CaveSurvey/Callout/Roster) is superseded by the people directory,
// people.json (CsPeople.js). That key is no longer read or written.
//
// The 'Cs' prefix is mandatory: include() dedupes by basename.

var CsCalloutLocal = {};

CsCalloutLocal.KEY_CONTACTS = "CaveSurvey/Callout/Contacts";
CsCalloutLocal.DEFAULT_BUFFER_MIN = 120;

var csLocalStr = function(v) {
    return (v === undefined || v === null) ? "" : String(v);
};

CsCalloutLocal.serializeContacts = function(c) {
    return JSON.stringify(c);
};

/** \return {topName, topPhone, escalation, bufferMin} */
CsCalloutLocal.parseContacts = function(text) {
    var c = { topName: "", topPhone: "", escalation: "",
        bufferMin: CsCalloutLocal.DEFAULT_BUFFER_MIN };
    try {
        var data = JSON.parse(String(text));
        c.topName = csLocalStr(data.topName);
        c.topPhone = csLocalStr(data.topPhone);
        c.escalation = csLocalStr(data.escalation);
        var b = parseFloat(csLocalStr(data.bufferMin));
        if (isFinite(b) && b > 0) { c.bufferMin = b; }
    } catch (e) {
    }
    return c;
};

var csLocalRead = function(key) {
    try {
        return String(RSettings.getStringValue(key, ""));
    } catch (e) {
        return "";
    }
};

var csLocalWrite = function(key, text) {
    try {
        RSettings.setValue(key, text);
        return true;
    } catch (e) {
        return false;
    }
};

CsCalloutLocal.loadContacts = function() {
    return CsCalloutLocal.parseContacts(csLocalRead(CsCalloutLocal.KEY_CONTACTS));
};
CsCalloutLocal.saveContacts = function(c) {
    return csLocalWrite(CsCalloutLocal.KEY_CONTACTS, CsCalloutLocal.serializeContacts(c));
};
