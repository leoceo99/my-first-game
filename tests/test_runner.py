"""docs/py/runner.py 테스트 (보통 파이썬으로 실행).

    python -m unittest discover -s tests
"""

import json
import os
import sys
import textwrap
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "docs", "py"))
import runner  # noqa: E402


class FakeBridge:
    def __init__(self, answers=()):
        self.events = []
        self.answers = list(answers)

    def post_output(self, stream, text):
        if self.events and self.events[-1][0] == stream:
            self.events[-1] = (stream, self.events[-1][1] + text)
        else:
            self.events.append((stream, text))

    def post_input_request(self, prompt):
        self.events.append(("input", prompt))

    def wait_for_input(self, prompt):
        self.events.append(("input", prompt))
        return self.answers.pop(0)

    def text(self, stream="stdout"):
        return "".join(t for s, t in self.events if s == stream)


def run(code, answers=(), mode="block", bridge=None, seed=1):
    bridge = bridge or FakeBridge()
    result = json.loads(runner.run(textwrap.dedent(code), json.dumps(list(answers)), seed, mode, bridge))
    return result, bridge


class BasicTest(unittest.TestCase):
    def test_output_and_variables(self):
        result, bridge = run("""
            import math
            name = "파이썬"
            nums = [1, 2, 3]
            def add(a, b=1):
                return a + b
            class Cat: pass
            print("안녕", name, end="!\\n")
        """)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(bridge.text(), "안녕 파이썬!\n")
        variables = {v["name"]: (v["type"], v["value"]) for v in result["variables"]}
        self.assertEqual(variables, {
            "name": ("str", "'파이썬'"),
            "nums": ("list", "[1, 2, 3]"),
            "add": ("function", "def add(a, b=1)"),
            "Cat": ("class", "class Cat"),
        })

    def test_streams_restored_after_run(self):
        before = (sys.stdout, sys.stderr, input)
        run("print('x')")
        self.assertEqual((sys.stdout, sys.stderr, input), before)

    def test_stderr_is_separate(self):
        _, bridge = run("import sys\nprint('보통')\nprint('경고', file=sys.stderr)")
        self.assertEqual(bridge.text("stdout"), "보통\n")
        self.assertEqual(bridge.text("stderr"), "경고\n")

    def test_long_output_is_sent_in_chunks(self):
        _, bridge = run("for i in range(3000): print(i)")
        self.assertEqual(bridge.text(), "".join(f"{i}\n" for i in range(3000)))

    def test_sys_exit(self):
        result, _ = run("import sys\nprint('a')\nsys.exit(3)")
        self.assertEqual((result["status"], result["exitCode"]), ("exit", 3))

    def test_user_imported_modules_are_forgotten(self):
        run("import fractions")
        self.assertNotIn("fractions", sys.modules)


class ErrorTest(unittest.TestCase):
    def test_runtime_error_points_to_user_line(self):
        result, _ = run("""
            def f(x):
                return 10 / x
            f(0)
        """)
        error = result["error"]
        self.assertEqual(result["status"], "error")
        self.assertEqual(error["type"], "ZeroDivisionError")
        self.assertEqual(error["line"], 3)
        self.assertIn('File "main.py", line 4', error["traceback"])
        self.assertNotIn("runner.py", error["traceback"])

    def test_syntax_error(self):
        result, _ = run("if True\n    print(1)\n")
        error = result["error"]
        self.assertEqual(error["type"], "SyntaxError")
        self.assertEqual(error["line"], 1)
        self.assertIn("':'", error["message"])

    def test_name_error_suggestion(self):
        result, _ = run("count = 1\nprint(cout)")
        self.assertEqual(result["error"]["type"], "NameError")
        self.assertEqual(result["error"]["suggestion"], "count")

    def test_variables_kept_after_error(self):
        result, _ = run("a = 5\nb = a / 0")
        self.assertEqual([v["name"] for v in result["variables"]], ["a"])

    def test_bad_repr_does_not_break(self):
        result, _ = run("""
            class Bad:
                def __repr__(self):
                    raise RuntimeError
            b = Bad()
        """)
        self.assertIn("RuntimeError", {v["name"]: v["value"] for v in result["variables"]}["b"])


class InputTest(unittest.TestCase):
    CODE = """
        a = int(input("첫 번째? "))
        print("받음", a)
        b = int(input("두 번째? "))
        print("합", a + b)
    """

    def test_block_mode(self):
        result, bridge = run(self.CODE, mode="block", bridge=FakeBridge(["3", "4"]))
        self.assertEqual(result["status"], "ok")
        self.assertEqual(bridge.events, [
            ("input", "첫 번째? "), ("stdout", "받음 3\n"),
            ("input", "두 번째? "), ("stdout", "합 7\n"),
        ])

    def test_replay_mode_shows_each_output_once(self):
        shown = FakeBridge()
        result, _ = run(self.CODE, [], mode="replay", bridge=shown)
        self.assertEqual(result["status"], "waiting")
        self.assertEqual(result["variables"], [])
        result, _ = run(self.CODE, ["3"], mode="replay", bridge=shown)
        self.assertEqual(result["status"], "waiting")
        result, _ = run(self.CODE, ["3", "4"], mode="replay", bridge=shown)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(shown.events, [
            ("input", "첫 번째? "), ("stdout", "받음 3\n"),
            ("input", "두 번째? "), ("stdout", "합 7\n"),
        ])

    def test_replay_keeps_random_numbers_the_same(self):
        code = """
            import random
            secret = random.randint(1, 1000000)
            print("비밀", secret)
            input("?")
            print("다시", secret)
        """
        shown = FakeBridge()
        run(code, [], mode="replay", bridge=shown, seed=42)
        run(code, ["x"], mode="replay", bridge=shown, seed=42)
        first, again = shown.text().split()[1], shown.text().split()[3]
        self.assertEqual(first, again)

    def test_replay_hides_finally_output_while_waiting(self):
        shown = FakeBridge()
        run("try:\n    input('?')\nfinally:\n    print('끝')", [], mode="replay", bridge=shown)
        self.assertEqual(shown.events, [("input", "?")])

    def test_need_input_is_not_caught_by_user_except(self):
        result, _ = run("try:\n    input()\nexcept Exception:\n    print('잡힘')", [], mode="replay")
        self.assertEqual(result["status"], "waiting")


if __name__ == "__main__":
    unittest.main()
