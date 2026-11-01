import unittest

from pyrun.highlighter import highlight_spans


def tagged(code):
    return [(tag, code[s:e]) for tag, s, e in highlight_spans(code)]


class HighlighterTest(unittest.TestCase):
    def test_basic_tokens(self):
        code = 'def add(a, b):\n    return a + 10  # 더하기\nprint("if")\n'
        self.assertEqual(tagged(code), [
            ("keyword", "def"), ("definition", "add"),
            ("keyword", "return"), ("number", "10"), ("comment", "# 더하기"),
            ("builtin", "print"), ("string", '"if"'),
        ])

    def test_keyword_inside_string_or_comment_is_not_keyword(self):
        self.assertEqual(tagged("x = 'for while'  # if else"),
                         [("string", "'for while'"), ("comment", "# if else")])

    def test_triple_quoted_and_prefixed_strings(self):
        code = 'a = f"{x}"\nb = """여러\n줄"""\nc = rb\'\\d\''
        self.assertEqual(tagged(code), [
            ("string", 'f"{x}"'), ("string", '"""여러\n줄"""'), ("string", "rb'\\d'"),
        ])

    def test_unclosed_string_stops_at_line_end(self):
        self.assertEqual(tagged('s = "열린 문자열\nprint(s)'),
                         [("string", '"열린 문자열'), ("builtin", "print")])

    def test_unclosed_triple_string_runs_to_end(self):
        self.assertEqual(tagged('s = """abc\nfor x'), [("string", '"""abc\nfor x')])

    def test_numbers(self):
        result = tagged("0x1F 3.14 1e-3 2j 1_000 .5")
        self.assertEqual({tag for tag, _ in result}, {"number"})
        self.assertEqual([text for _, text in result],
                         ["0x1F", "3.14", "1e-3", "2j", "1_000", ".5"])

    def test_identifiers_are_not_numbers_or_keywords(self):
        self.assertEqual(tagged("var1 = format_x + is_ok + obj.print"), [])

    def test_class_and_decorator(self):
        code = "@dataclass\nclass 사람:\n    @staticmethod\n    def 인사(): pass"
        self.assertEqual(tagged(code), [
            ("decorator", "@dataclass"), ("keyword", "class"), ("definition", "사람"),
            ("decorator", "@staticmethod"), ("keyword", "def"), ("definition", "인사"),
            ("keyword", "pass"),
        ])


if __name__ == "__main__":
    unittest.main()
