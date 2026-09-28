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
  cache.put(hk, String(n + 1), 3600);

  var bytes = Utilities.base64Decode(e.postData.contents);
  var zip = Utilities.newBlob(bytes, "application/zip", "report.zip");
  var files = Utilities.unzip(zip);
  var report = null;
  files.forEach(function (f) {
    if (FeedbackLogic.stripPath(f.getName()) === "report.json") report = JSON.parse(f.getDataAsString());
  });
  if (!report || !/^[0-9a-f]{6}$/.test(String(report.id))) return reply({ ok: false, error: "no-report" });

  var now = new Date();
  var root = DriveApp.getFolderById(props.getProperty("FOLDER_ID"));
  var folder = root.createFolder(FeedbackLogic.folderName(report, now));
  folder.createFile(zip.setName("feedback-" + report.id + ".zip"));
  files.forEach(function (f) {
    var parts = FeedbackLogic.stripPath(f.getName()).split("/");
    var leaf = parts.pop();
    if (!leaf) return;
    var dir = folder;
    parts.forEach(function (p) {
      var it = dir.getFoldersByName(p);
      dir = it.hasNext() ? it.next() : dir.createFolder(p);
    });
    dir.createFile(f.setName(leaf));
  });

  var sheet = SpreadsheetApp.openById(props.getProperty("SHEET_ID")).getSheets()[0];
  if (sheet.getLastRow() === 0) sheet.appendRow(FeedbackLogic.COLUMNS);
  sheet.appendRow(FeedbackLogic.row(report, now, folder.getUrl(), folder.getId(), bytes.length));

  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), FeedbackLogic.subject(report),
    report.summary + "\n\n" + (report.cavecad ? report.cavecad.version : "") + " | " + (report.os || "")
    + "\n\n" + folder.getUrl());
  return reply({ ok: true, id: report.id });
}

function reply(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/** Installable on-edit trigger: Status -> Fixed/Won't fix stamps Closed; anything else clears it. */
function onStatusEdit(e) {
  var sheet = e.range.getSheet();
  var statusCol = FeedbackLogic.COLUMNS.indexOf("Status") + 1;
  if (e.range.getColumn() !== statusCol || e.range.getRow() === 1) return;
  var closed = sheet.getRange(e.range.getRow(), FeedbackLogic.COLUMNS.indexOf("Closed") + 1);
  if (FeedbackLogic.CLOSED_STATES.indexOf(String(e.value)) >= 0) closed.setValue(new Date());
  else closed.setValue("");
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
