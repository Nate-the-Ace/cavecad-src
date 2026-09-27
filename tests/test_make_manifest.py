import hashlib, json, os, sys, tempfile, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import make_manifest


class TestMakeManifest(unittest.TestCase):
    def test_manifest_and_sidecars(self):
        d = tempfile.mkdtemp()
        files = {"CaveCAD-windows-x64.zip": b"win", "CaveCAD-macos-arm64.dmg": b"mac",
                 "CaveSurvey-tools.zip": b"tools"}
        for n, b in files.items():
            open(os.path.join(d, n), "wb").write(b)
        m = make_manifest.build(d, tools_version="0.9.181.0", tools_commit="e7b4095",
                                app_commits={"windows-x64": "aaa", "macos-arm64": "bbb",
                                             "linux-x86_64": "ccc"},
                                published="2026-09-26T00:00:00Z")
        self.assertEqual(m["schema"], 1)
        self.assertEqual(m["tools"]["version"], "0.9.181.0")
        self.assertEqual(m["tools"]["sha256"], hashlib.sha256(b"tools").hexdigest())
        self.assertEqual(set(m["platforms"]), {"windows-x64", "macos-arm64"},
                         "a platform with no file is left out")
        self.assertEqual(m["platforms"]["windows-x64"]["app_commit"], "aaa")
        self.assertEqual(m["platforms"]["macos-arm64"]["size"], 3)
        make_manifest.write(d, m)
        side = open(os.path.join(d, "CaveCAD-windows-x64.zip.sha256")).read()
        self.assertEqual(side, hashlib.sha256(b"win").hexdigest() + "  CaveCAD-windows-x64.zip\n")
        self.assertTrue(os.path.exists(os.path.join(d, "latest.json.sha256")))
        self.assertEqual(json.load(open(os.path.join(d, "latest.json")))["schema"], 1)

    def test_publish_copies_get_unique_names(self):
        # Each publish's update files get unique names, and latest.json
        # points at those: GitHub's download links serve stale copies for a
        # while after a file is replaced, so a stable name could pair a
        # cached manifest with new bytes (a false checksum failure).
        d = tempfile.mkdtemp()
        for n, b in {"CaveCAD-windows-x64.zip": b"win",
                     "CaveCAD-linux-aarch64.AppImage": b"lin",
                     "CaveSurvey-tools.zip": b"tools"}.items():
            open(os.path.join(d, n), "wb").write(b)
        names = make_manifest.publish_copies(d, "u42")
        self.assertEqual(sorted(names), ["CaveCAD-linux-aarch64-u42.AppImage",
                                         "CaveCAD-windows-x64-u42.zip",
                                         "CaveSurvey-tools-u42.zip"])
        m = make_manifest.build(d, "1.0", "abc", {"windows-x64": "aaa", "linux-aarch64": "bbb"},
                                suffix="u42")
        self.assertEqual(m["tools"]["asset"], "CaveSurvey-tools-u42.zip")
        self.assertEqual(m["platforms"]["windows-x64"]["asset"], "CaveCAD-windows-x64-u42.zip")
        self.assertEqual(m["platforms"]["linux-aarch64"]["asset"], "CaveCAD-linux-aarch64-u42.AppImage")
        self.assertEqual(m["platforms"]["windows-x64"]["sha256"], hashlib.sha256(b"win").hexdigest())
        make_manifest.write(d, m)
        side = open(os.path.join(d, "CaveCAD-windows-x64-u42.zip.sha256")).read()
        self.assertEqual(side, hashlib.sha256(b"win").hexdigest() + "  CaveCAD-windows-x64-u42.zip\n")
        self.assertTrue(os.path.exists(os.path.join(d, "CaveCAD-windows-x64.zip.sha256")),
                        "the plain names keep their sidecars for manual downloads")

    def test_prune_keeps_the_newest_publishes(self):
        assets = ["CaveCAD-windows-x64.zip", "latest.json",
                  "CaveCAD-windows-x64-u9.zip", "CaveCAD-windows-x64-u9.zip.sha256",
                  "CaveCAD-windows-x64-u100.zip", "CaveSurvey-tools-u100.zip",
                  "CaveCAD-windows-x64-u55.zip", "CaveCAD-windows-x64-u7.zip"]
        self.assertEqual(sorted(make_manifest.prunable(assets, keep=3)),
                         ["CaveCAD-windows-x64-u7.zip"],
                         "the 3 newest publishes (100, 55, 9) stay; plain names never go")


if __name__ == "__main__":
    unittest.main()
