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


if __name__ == "__main__":
    unittest.main()
