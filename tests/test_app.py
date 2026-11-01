"""화면(GUI) 테스트. 화면이 없는 환경에서는 건너뜁니다 (리눅스에서는 xvfb-run으로 실행 가능)."""

import os
import tempfile
import time
import unittest

try:
    import tkinter as tk
    from pyrun.app import PyRunApp, find_error_line
except ImportError:  # tkinter가 없는 파이썬
    tk = None


def make_root():
    if tk is None:
        raise unittest.SkipTest("tkinter가 없어요")
    try:
        root = tk.Tk()
    except tk.TclError:
        raise unittest.SkipTest("화면(display)이 없어요")
    root.withdraw()
    return root


class AppTest(unittest.TestCase):
    def setUp(self):
        self.root = make_root()
        self.app = PyRunApp(self.root)
        self.app._confirm_discard = lambda: True

    def tearDown(self):
        self.app.runner.stop()
        self.root.destroy()

    def pump_until(self, condition, timeout=10):
        deadline = time.time() + timeout
        while time.time() < deadline:
            self.root.update()
            if condition():
                return
            time.sleep(0.02)
        self.fail("시간 안에 조건을 만족하지 못했어요")

    def console_text(self):
        return self.app.console.text.get("1.0", "end-1c")

    def run_code(self, code):
        self.app.editor.set(code)
        self.app.run()
        self.pump_until(lambda: not self.app.runner.active and "■" in self.console_text())

    def test_run_shows_output_and_variables(self):
        self.run_code('x = 5\nprint("결과:", x * 2)\n')
        self.assertIn("결과: 10", self.console_text())
        self.assertIn("종료 코드 0", self.console_text())
        rows = [self.app.variables.item(i) for i in self.app.variables.get_children()]
        self.assertEqual([(r["text"], r["values"][0]) for r in rows], [("x", "int")])

    def test_typing_input_in_console(self):
        self.app.editor.set('n = input("숫자? ")\nprint(int(n) * 3)\n')
        self.app.run()
        self.pump_until(lambda: "숫자? " in self.console_text())
        console = self.app.console.text
        console.insert("end-1c", "7")
        self.app.console._submit()
        self.pump_until(lambda: not self.app.runner.active and "■" in self.console_text())
        self.assertIn("숫자? 7\n21\n", self.console_text())

    def test_error_line_is_highlighted(self):
        self.run_code("a = 1\nb = [1, 2]\nprint(b[5])\n")
        self.assertIn("IndexError", self.console_text())
        self.assertEqual(self.app.editor.text.tag_ranges("error_line")[0].string, "3.0")

    def test_highlighting_is_applied(self):
        self.app.editor.set('for i in range(3):\n    print("hi")  # 주석\n')
        text = self.app.editor.text
        self.assertEqual(text.get(*text.tag_ranges("keyword")[:2]), "for")
        self.assertEqual(text.get(*text.tag_ranges("comment")), "# 주석")

    def test_auto_indent_after_colon(self):
        text = self.app.editor.text
        self.app.editor.set("if True:")
        text.mark_set("insert", "end-1c")
        self.app.editor._on_return(None)
        self.assertEqual(self.app.editor.get(), "if True:\n    ")

    def test_toggle_comment(self):
        self.app.editor.set("a = 1\nb = 2")
        text = self.app.editor.text
        text.tag_add("sel", "1.0", "2.end")
        self.app.editor.toggle_comment()
        self.assertEqual(self.app.editor.get(), "# a = 1\n# b = 2")
        self.app.editor.toggle_comment()
        self.assertEqual(self.app.editor.get(), "a = 1\nb = 2")

    def test_save_and_open(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "hello.py")
            self.app.editor.set("print('저장 테스트')\n")
            self.app.path = path
            self.assertTrue(self.app.save_file())
            self.assertFalse(self.app.modified)
            self.app.new_file()
            self.app.open_file(path)
            self.assertEqual(self.app.editor.get(), "print('저장 테스트')\n")
            self.assertIn("hello.py", self.root.title())

    def test_modified_flag_tracks_every_edit(self):
        self.app._set_modified(False)
        self.app.editor.text.insert("end", "x")
        self.root.update()
        self.assertTrue(self.app.modified)
        self.app._set_modified(False)
        self.app.editor.text.insert("end", "y")
        self.root.update()
        self.assertTrue(self.app.modified)


class FindErrorLineTest(unittest.TestCase):
    def test_picks_last_frame_in_user_file(self):
        if tk is None:
            self.skipTest("tkinter가 없어요")
        err = ('Traceback (most recent call last):\n'
               '  File "/tmp/main.py", line 7, in <module>\n'
               '  File "/tmp/main.py", line 3, in f\n'
               '  File "/usr/lib/python3/json/__init__.py", line 99, in loads\n')
        self.assertEqual(find_error_line(err, "/tmp/main.py"), 3)
        self.assertIsNone(find_error_line(err, "/tmp/other.py"))


if __name__ == "__main__":
    unittest.main()
