include(RSettings.getOriginalArguments()[RSettings.getOriginalArguments().indexOf("-autostart") + 2] + "/tests/updater/harness.js");
ok(typeof QProcess === "function", "QProcess exists");
eqs(["win", "osx", "linux"].indexOf(RS.getSystemId()) >= 0, true, "known system id");
finish("smoke_test.js");
