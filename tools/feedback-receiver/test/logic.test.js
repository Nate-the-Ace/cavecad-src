const test = require("node:test");
const assert = require("node:assert");
const L = require("../Logic.gs");

const MB = 1024 * 1024;
const REPORT = { id: "a7f3c2", type: "bug", summary: "Trace / crash on a very long summary that keeps going past sixty characters", email: "",
  cavecad: { version: "3.33", commit: "abc" }, os: "osx macOS 26", attachments: [{ path: "a", bytes: 1 }, { path: "b", bytes: 2 }] };

test("check", () => {
  const ok = { key: "k", expected: "k", bodyLength: 10, countThisHour: 0 };
  assert.strictEqual(L.check(ok), null);
  assert.strictEqual(L.check({ ...ok, key: "x" }), "key");
  assert.strictEqual(L.check({ ...ok, expected: "" }), "key");
  assert.strictEqual(L.check({ ...ok, bodyLength: 40 * MB + 1 }), "too-big");
  assert.strictEqual(L.check({ ...ok, countThisHour: 30 }), "busy");
});

test("folderName", () => {
  const n = L.folderName(REPORT, new Date("2026-09-27T12:00:00Z"));
  assert.ok(n.startsWith("2026-09-27 Bug — Trace - crash"), n);
  assert.ok(n.endsWith(" (a7f3c2)"), n);
  assert.ok(n.length <= "2026-09-27 Bug — ".length + 60 + " (a7f3c2)".length);
});

test("row", () => {
  const r = L.row(REPORT, new Date("2026-09-27T12:00:00Z"), "https://f", "FID", 3);
  assert.strictEqual(r.length, L.COLUMNS.length);
  assert.strictEqual(r[L.COLUMNS.indexOf("Status")], "New");
  assert.strictEqual(r[L.COLUMNS.indexOf("Closed")], "");
  assert.strictEqual(r[L.COLUMNS.indexOf("Attachments")], 2);
});

test("purgeDue", () => {
  const now = new Date("2027-01-01T00:00:00Z");
  const day = 86400000;
  const rows = [
    { received: new Date(now - 10 * day), status: "Fixed", closed: new Date(now - 31 * day) },
    { received: new Date(now - 10 * day), status: "Fixed", closed: new Date(now - 5 * day) },
    { received: new Date(now - 366 * day), status: "New", closed: "" },
    { received: new Date(now - 400 * day), status: "Purged", closed: "" },
    { received: new Date(now - 10 * day), status: "Won't fix", closed: new Date(now - 30 * day) },
  ];
  assert.deepStrictEqual(L.purgeDue(rows, now), [0, 2, 4]);
});

test("stripPath and subject", () => {
  assert.strictEqual(L.stripPath("./logs/a.log"), "logs/a.log");
  assert.strictEqual(L.subject(REPORT).indexOf("[CaveCAD Feedback] Bug: "), 0);
});
