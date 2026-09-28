// Code.gs -- CaveCAD's feedback receiver. Deployed as a web app under
// cavecad.app@gmail.com ("Execute as: Me", "Who has access: Anyone").
// Script properties: KEY, FOLDER_ID, SHEET_ID. See README.md.

function doPost(e) {
  var props = PropertiesService.getScriptProperties();
  var cache = CacheService.getScriptCache();
  var hk = FeedbackLogic.hourKey(new Date());
  var n = Number(cache.get(hk) || 0);
  var err = FeedbackLogic.check({
    key: e.parameter.k, expected: props.getProperty("KEY"),
    bodyLength: e.postData ? e.postData.length : 0, countThisHour: n
  });
  if (err) return reply({ ok: false, error: err });
  if (!e.postData || !e.postData.contents) return reply({ ok: false, error: "no-report" });
  cache.put(hk, String(n + 1), 3600);

  var bytes, zip, files, report = null;
  try {
    bytes = Utilities.base64Decode(e.postData.contents);
    zip = Utilities.newBlob(bytes, "application/zip", "report.zip");
    files = Utilities.unzip(zip);
    files.forEach(function (f) {
      if (FeedbackLogic.stripPath(f.getName()) === "report.json") report = JSON.parse(f.getDataAsString());
    });
  } catch (parseErr) {
    return reply({ ok: false, error: "bad-zip" });
  }
  if (!report || !/^[0-9a-f]{6}$/.test(String(report.id))) return reply({ ok: false, error: "no-report" });

  // From here a Drive folder may already exist for this report: any later failure must
  // still reply ok so the client does not resend and create duplicate folders/rows/mail.
  var now = new Date();
  var root = DriveApp.getFolderById(props.getProperty("FOLDER_ID"));
  var folder = root.createFolder(FeedbackLogic.folderName(report, now));
  folder.createFile(zip.setName("feedback-" + report.id + ".zip"));
  files.forEach(function (f) {
    var parts = FeedbackLogic.stripPath(f.getName()).split("/")
      .filter(function (p) { return p && p !== "." && p !== ".."; });
    var leaf = parts.pop();
    if (!leaf) return;
    var dir = folder;
    parts.forEach(function (p) {
      var it = dir.getFoldersByName(p);
      dir = it.hasNext() ? it.next() : dir.createFolder(p);
    });
    dir.createFile(f.setName(leaf));
  });

  try {
    var sheet = SpreadsheetApp.openById(props.getProperty("SHEET_ID")).getSheets()[0];
    if (sheet.getLastRow() === 0) sheet.appendRow(FeedbackLogic.COLUMNS);
    sheet.appendRow(FeedbackLogic.row(report, now, folder.getUrl(), folder.getId(), bytes.length));
  } catch (sheetErr) {
    console.error("feedback " + report.id + ": sheet append failed: " + sheetErr);
  }

  try {
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), FeedbackLogic.subject(report),
      report.summary + "\n\n" + (report.cavecad ? report.cavecad.version : "") + " | " + (report.os || "")
      + "\n\n" + folder.getUrl());
  } catch (mailErr) {
    console.error("feedback " + report.id + ": mail send failed: " + mailErr);
  }

  return reply({ ok: true, id: report.id });
}

function reply(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/** Installable on-edit trigger: Status -> Fixed/Won't fix stamps Closed; anything else clears it.
 * Handles a paste/fill spanning multiple rows and/or columns, not just a single-cell edit. */
function onStatusEdit(e) {
  var sheet = e.range.getSheet();
  var statusCol = FeedbackLogic.COLUMNS.indexOf("Status") + 1;
  var closedCol = FeedbackLogic.COLUMNS.indexOf("Closed") + 1;
  var firstCol = e.range.getColumn(), lastCol = firstCol + e.range.getNumColumns() - 1;
  if (statusCol < firstCol || statusCol > lastCol) return;

  var firstRow = e.range.getRow(), numRows = e.range.getNumRows();
  var singleCell = numRows === 1 && e.range.getNumColumns() === 1;
  for (var i = 0; i < numRows; i++) {
    var row = firstRow + i;
    if (row === 1) continue; // header
    var status = singleCell ? String(e.value) : String(sheet.getRange(row, statusCol).getValue());
    sheet.getRange(row, closedCol).setValue(FeedbackLogic.CLOSED_STATES.indexOf(status) >= 0 ? new Date() : "");
  }
}

/** Daily time-driven trigger: trash due report folders, mark rows Purged. */
function purgeOld() {
  var props = PropertiesService.getScriptProperties();
  var sheet = SpreadsheetApp.openById(props.getProperty("SHEET_ID")).getSheets()[0];
  if (sheet.getLastRow() < 2) return;
  var C = FeedbackLogic.COLUMNS;
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, C.length).getValues();
  var rows = values.map(function (v) {
    return { received: v[C.indexOf("Received")], status: String(v[C.indexOf("Status")]), closed: v[C.indexOf("Closed")] };
  });
  FeedbackLogic.purgeDue(rows, new Date()).forEach(function (i) {
    try { DriveApp.getFolderById(values[i][C.indexOf("Folder ID")]).setTrashed(true); } catch (err) { /* already gone */ }
    sheet.getRange(i + 2, C.indexOf("Status") + 1).setValue("Purged");
  });
}
