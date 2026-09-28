#!/usr/bin/env python3
"""Runs every tests/updater/*_test.js and tests/feedback/*_test.js inside a
CaveCAD binary, headless, on any platform (CI on Windows and Linux; run.sh
stays the macOS dev path).

    python3 tests/updater/run_ci.py <cavecad binary>

Each test's result line is read from the file named by CAVECAD_TEST_OUT
(harness.js writes it there): a GUI-subsystem exe's stdout may never reach
the console on Windows. Stdout is the fallback. Exits non-zero unless every
test reports "### UPDATER OK".
"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    binary = str(Path(sys.argv[1]).resolve())
    repo = Path(__file__).resolve().parent.parent.parent
    tests = sorted((repo / "tests" / "updater").glob("*_test.js")) + \
        sorted((repo / "tests" / "feedback").glob("*_test.js"))
    if not tests:
        sys.exit("no tests found")
    env = dict(os.environ)
    if sys.platform.startswith("linux"):
        env.setdefault("QT_QPA_PLATFORM", "offscreen")
    failed = 0
    for t in tests:
        fd, out_path = tempfile.mkstemp(prefix="cavecad-test-", suffix=".txt")
        os.close(fd)
        env["CAVECAD_TEST_OUT"] = out_path
        # forward slashes: the paths are used by include() inside the engine
        cmd = [binary, "-no-gui", "-allow-multiple-instances",
               "-autostart", t.as_posix(), repo.as_posix()]
        if sys.platform == "darwin":
            cmd.insert(1, "-no-dock-icon")
        try:
            proc = subprocess.run(cmd, cwd=str(repo), env=env, stdout=subprocess.PIPE,
                                  stderr=subprocess.STDOUT, timeout=600)
            output = proc.stdout.decode("utf-8", "replace")
        except subprocess.TimeoutExpired as e:
            output = (e.stdout or b"").decode("utf-8", "replace") + "\n(timed out)"
        with open(out_path, encoding="utf-8", errors="replace") as f:
            result = f.read().strip()
        os.remove(out_path)
        if not result:
            lines = output.splitlines()
            start = next((i for i, l in enumerate(lines) if "### UPDATER" in l), None)
            result = "\n".join(lines[start:]) if start is not None else ""
        if not result:
            result = "### UPDATER FAIL no output (%s)" % t.name
        print(result)
        if not result.startswith("### UPDATER OK"):
            failed += 1
            print("---- output of %s ----\n%s\n----" % (t.name, output[-4000:]))
    print("%d of %d updater/feedback test files failed" % (failed, len(tests)))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
