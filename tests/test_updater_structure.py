"""Structural checks on the updater's scripts (scripts/Help/CheckForUpdates).

    python3 -m unittest tests.test_updater_structure
"""
import os
import re
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
UPDATER = os.path.join(ROOT, "scripts", "Help", "CheckForUpdates")


class TestNoFunctionPropertyShadowing(unittest.TestCase):
    """A static named apply, call, bind, name, ... on a class declared with
    `function X() {}` is a SILENT no-op: X is a Function and already owns
    those properties, so the assignment does not take and X.apply(d) runs
    Function.prototype.apply instead. CheckForUpdates.apply was exactly
    that: "Update now" closed the prompt and did nothing, no error, found
    on the Windows ARM64 VM, 2026-09-27. (cavecad-tools has had this test
    since the same trap cost two debugging sessions there.)"""

    RESERVED = ["apply", "call", "bind", "name", "length", "caller", "arguments"]

    def test_no_static_shadows_a_function_property(self):
        declared = re.compile(r"^function\s+([A-Za-z_$][\w$]*)\s*\(", re.M)
        assigned = re.compile(
            r"^\s*([A-Z][A-Za-z0-9_]*)\.(" + "|".join(self.RESERVED) + r")\s*=", re.M)
        offenders = []
        for name in sorted(os.listdir(UPDATER)):
            if not name.endswith(".js"):
                continue
            with open(os.path.join(UPDATER, name)) as handle:
                source = handle.read()
            functions = set(declared.findall(source))
            for match in assigned.finditer(source):
                if match.group(1) in functions:
                    offenders.append("%s: %s.%s" % (name, match.group(1), match.group(2)))
        self.assertEqual([], offenders,
                         "these assignments silently do not take: %s" % offenders)


if __name__ == "__main__":
    unittest.main()
