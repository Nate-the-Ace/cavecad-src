// Logic.gs -- the receiver's decisions, free of Google services so node
// can test them (tools/feedback-receiver/test). Apps Script loads every .gs
// file into one global scope; node loads this one through module.exports.

var FeedbackLogic = {
  MAX_BODY: 40 * 1024 * 1024,
  MAX_PER_HOUR: 30,
  CLOSED_GRACE_DAYS: 30,
  MAX_AGE_DAYS: 365,
  CLOSED_STATES: ["Fixed", "Won't fix"],
  COLUMNS: ["Received", "ID", "Type", "Summary", "Email", "CaveCAD version", "OS",
            "Attachments", "Size", "Folder link", "Folder ID", "Status", "Closed", "Notes"],

  /** null when accepted, else "key" | "too-big" | "busy". */
  check: function (p) {
    if (!p.expected || p.key !== p.expected) return "key";
    if (p.bodyLength > FeedbackLogic.MAX_BODY) return "too-big";
    if (p.countThisHour >= FeedbackLogic.MAX_PER_HOUR) return "busy";
    return null;
  },

  hourKey: function (date) { return "n-" + date.toISOString().slice(0, 13); },

  TYPES: ["bug", "idea", "question"],

  typeLabel: function (t) {
    t = String(t || "bug").toLowerCase();
    if (FeedbackLogic.TYPES.indexOf(t) === -1) t = "bug";
    return t.charAt(0).toUpperCase() + t.slice(1);
  },

  /** Prefix values Sheets would treat as a formula (=+-@ and tab/CR) with a quote, so a
   * reporter-controlled string (summary, email, ...) can never inject a formula. */
  escapeFormula: function (s) {
    if (typeof s !== "string") return s;
    return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  },

  folderName: function (report, date) {
    var s = String(report.summary || "").replace(/[\/\\]/g, "-").replace(/\s+/g, " ").trim().slice(0, 60);
    return date.toISOString().slice(0, 10) + " " + FeedbackLogic.typeLabel(report.type) + " — " + s + " (" + report.id + ")";
  },

  row: function (report, received, folderUrl, folderId, bytes) {
    // Reporter-controlled fields must be coerced to plain strings before escaping --
    // e.g. an array like ["=HYPERLINK(...)"] stringifies harmlessly via String(),
    // but would otherwise slip past a typeof-string check untouched.
    var v = {
      "Received": received, "ID": String(report.id || ""), "Type": FeedbackLogic.typeLabel(report.type),
      "Summary": String(report.summary || ""), "Email": String(report.email || ""),
      "CaveCAD version": String((report.cavecad && report.cavecad.version) || ""),
      "OS": String(report.os || ""),
      "Attachments": (report.attachments || []).length, "Size": bytes, "Folder link": folderUrl,
      "Folder ID": folderId, "Status": "New", "Closed": "", "Notes": ""
    };
    return FeedbackLogic.COLUMNS.map(function (c) { return FeedbackLogic.escapeFormula(v[c]); });
  },

  /** rows: [{received, status, closed}] -> indexes due for purging. */
  purgeDue: function (rows, now) {
    var day = 86400000, out = [];
    rows.forEach(function (r, i) {
      if (r.status === "Purged") return;
      var old = r.received instanceof Date && now - r.received >= FeedbackLogic.MAX_AGE_DAYS * day;
      var closed = FeedbackLogic.CLOSED_STATES.indexOf(r.status) >= 0 && r.closed instanceof Date
        && now - r.closed >= FeedbackLogic.CLOSED_GRACE_DAYS * day;
      if (old || closed) out.push(i);
    });
    return out;
  },

  stripPath: function (name) { return String(name).replace(/^(\.\/)+/, ""); },

  /** false for a zip directory entry (tar/ditto write "logs/", "./logs/", "./") or an
   * empty name; true for an actual file entry. */
  isFileEntry: function (name) {
    var s = FeedbackLogic.stripPath(name);
    return s.length > 0 && s.charAt(s.length - 1) !== "/";
  },

  subject: function (report) {
    return "[CaveCAD Feedback] " + FeedbackLogic.typeLabel(report.type) + ": " + report.summary;
  }
};

if (typeof module !== "undefined") { module.exports = FeedbackLogic; }
