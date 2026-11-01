import os
import queue
import tempfile
import textwrap
import time
import unittest

from pyrun.runner import ScriptRunner


def collect(runner, timeout=10):
    """'exit' 이벤트가 올 때까지 출력을 모읍니다."""
    out, err = [], []
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            event = runner.events.get(timeout=0.1)
        except queue.Empty:
            continue
        if event[0] == "stdout":
            out.append(event[1])
        elif event[0] == "stderr":
            err.append(event[1])
        else:
            return "".join(out), "".join(err), event[1], event[2]
    raise AssertionError("프로그램이 시간 안에 끝나지 않았어요")


def wait_for_output(runner, expected, timeout=10):
    seen = ""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            event = runner.events.get(timeout=0.1)
        except queue.Empty:
            continue
        if event[0] == "stdout":
            seen += event[1]
            if expected in seen:
                return seen
    raise AssertionError(f"{expected!r} 출력을 기다렸지만 받은 것: {seen!r}")


class RunnerTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.runner = ScriptRunner()

    def tearDown(self):
        self.runner.stop()
        self.dir.cleanup()

    def script(self, code, name="main.py"):
        path = os.path.join(self.dir.name, name)
        with open(path, "w", encoding="utf-8") as f:
            f.write(textwrap.dedent(code))
        return path

    def test_prints_output_and_variables(self):
        path = self.script("""
            import math
            name = "파이썬"
            nums = [1, 2, 3]
            def f(): pass
            print("안녕", name)
        """)
        self.runner.start(path)
        out, err, code, variables = collect(self.runner)
        self.assertEqual(out, "안녕 파이썬\n")
        self.assertEqual(err, "")
        self.assertEqual(code, 0)
        by_name = {v["name"]: v for v in variables}
        self.assertEqual(by_name["name"], {"name": "name", "type": "str", "value": "'파이썬'"})
        self.assertEqual(by_name["nums"]["value"], "[1, 2, 3]")
        self.assertEqual(by_name["f"]["type"], "function")
        self.assertNotIn("math", by_name)  # 모듈은 숨김
        self.assertFalse(self.runner.active)

    def test_input_from_user(self):
        path = self.script("""
            a = input("첫 번째: ")
            b = input("두 번째: ")
            print(int(a) + int(b))
        """)
        self.runner.start(path)
        wait_for_output(self.runner, "첫 번째: ")  # 줄바꿈 없는 안내문도 바로 보여야 함
        self.runner.send_input("3\n")
        wait_for_output(self.runner, "두 번째: ")
        self.runner.send_input("4\n")
        out, _, code, _ = collect(self.runner)
        self.assertEqual(out, "7\n")
        self.assertEqual(code, 0)

    def test_error_traceback_hides_bootstrap_and_keeps_variables(self):
        path = self.script("""
            x = 10
            y = 0
            print(x / y)
        """)
        self.runner.start(path)
        _, err, code, variables = collect(self.runner)
        self.assertEqual(code, 1)
        self.assertIn("ZeroDivisionError", err)
        self.assertIn(f'File "{path}", line 4', err)
        self.assertNotIn("_bootstrap", err)
        self.assertEqual({v["name"] for v in variables}, {"x", "y"})

    def test_syntax_error(self):
        path = self.script("print('닫히지 않음'\n")
        self.runner.start(path)
        _, err, code, _ = collect(self.runner)
        self.assertEqual(code, 1)
        self.assertIn("SyntaxError", err)
        self.assertNotIn("_bootstrap", err)

    def test_sys_exit_code(self):
        self.runner.start(self.script("import sys\nsys.exit(3)\n"))
        self.assertEqual(collect(self.runner)[2], 3)

    def test_script_can_import_neighbour_module(self):
        self.script("VALUE = 42\n", name="helper.py")
        self.runner.start(self.script("import helper\nprint(helper.VALUE)\n"))
        self.assertEqual(collect(self.runner)[0], "42\n")

    def test_stop_infinite_loop(self):
        path = self.script("""
            print("시작")
            while True:
                pass
        """)
        self.runner.start(path)
        wait_for_output(self.runner, "시작")
        self.assertTrue(self.runner.active)
        self.runner.stop()
        collect(self.runner)
        self.assertTrue(self.runner.stopped_by_user)
        self.assertFalse(self.runner.active)

    def test_cannot_start_twice(self):
        self.runner.start(self.script("input()\n"))
        with self.assertRaises(RuntimeError):
            self.runner.start(self.script("pass\n", name="other.py"))


if __name__ == "__main__":
    unittest.main()
