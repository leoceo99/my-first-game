// node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize, highlight } from "../docs/js/highlight.js";
import { explainError } from "../docs/js/errors.js";

const tagged = (src) => tokenize(src).map((t) => [t.type, src.slice(t.start, t.end)]);

test("기본 토큰", () => {
  const src = 'def add(a, b):\n    return a + 10  # 더하기\nprint("if")\n';
  assert.deepEqual(tagged(src), [
    ["keyword", "def"], ["definition", "add"],
    ["keyword", "return"], ["number", "10"], ["comment", "# 더하기"],
    ["builtin", "print"], ["string", '"if"'],
  ]);
});

test("문자열과 주석 안의 키워드는 무시", () => {
  assert.deepEqual(tagged("x = 'for while'  # if else"), [
    ["string", "'for while'"], ["comment", "# if else"],
  ]);
});

test("접두사와 삼중 따옴표 문자열", () => {
  const src = 'a = f"{x}"\nb = """여러\n줄"""\nc = rb\'\\d\'';
  assert.deepEqual(tagged(src), [
    ["string", 'f"{x}"'], ["string", '"""여러\n줄"""'], ["string", "rb'\\d'"],
  ]);
});

test("닫히지 않은 문자열은 줄 끝에서 멈춤", () => {
  assert.deepEqual(tagged('s = "열린\nprint(s)'), [["string", '"열린'], ["builtin", "print"]]);
  assert.deepEqual(tagged('s = """abc\nfor x'), [["string", '"""abc\nfor x']]);
});

test("숫자", () => {
  const result = tagged("0x1F 3.14 1e-3 2j 1_000 .5");
  assert.deepEqual(result.map(([, t]) => t), ["0x1F", "3.14", "1e-3", "2j", "1_000", ".5"]);
  assert.ok(result.every(([type]) => type === "number"));
});

test("식별자 안의 단어나 속성은 색칠하지 않음", () => {
  assert.deepEqual(tagged("var1 = format_x + is_ok + obj.print + f + rb"), []);
});

test("한글 이름, 클래스, 데코레이터", () => {
  const src = "@dataclass\nclass 사람:\n    @staticmethod\n    def 인사(): pass";
  assert.deepEqual(tagged(src), [
    ["decorator", "@dataclass"], ["keyword", "class"], ["definition", "사람"],
    ["decorator", "@staticmethod"], ["keyword", "def"], ["definition", "인사"],
    ["keyword", "pass"],
  ]);
});

test("HTML 특수문자 이스케이프", () => {
  assert.equal(highlight("a<b & c>d"), "a&lt;b &amp; c&gt;d");
  assert.equal(highlight("'<'"), '<span class="tok-string">\'&lt;\'</span>');
});

test("친절한 오류 설명", () => {
  assert.equal(explainError({ type: "ZeroDivisionError", message: "division by zero" }).title, "0으로 나눌 수 없어요");
  const concat = explainError({ type: "TypeError", message: 'can only concatenate str (not "int") to str' });
  assert.match(concat.detail, /\+ 로 바로 붙일 수 없어요/);
  const mixed = explainError({ type: "TypeError", message: "unsupported operand type(s) for +: 'int' and 'str'" });
  assert.match(mixed.detail, /int\(input/);
  const hangul = explainError({ type: "NameError", message: "name '안녕' is not defined" });
  assert.match(hangul.detail, /따옴표/);
  const typo = explainError({ type: "NameError", message: "name 'cout' is not defined", suggestion: "count" });
  assert.match(typo.detail, /'count'/);
  assert.equal(explainError({ type: "SyntaxError", message: "expected ':'" }).title, "문법이 맞지 않아요");
  assert.match(explainError({ type: "ValueError", message: "invalid literal for int() with base 10: 'abc'" }).detail, /'abc'/);
  assert.equal(explainError({ type: "WeirdError", message: "뭔가" }).detail, "뭔가");
});
