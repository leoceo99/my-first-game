// C++ 모드 테스트: node --test tests/cpp.test.mjs
// 지금 되는 것(0단계)은 보통 테스트, 앞으로 만들 단계의 목표 프로그램은 todo 테스트예요 (design/cpp-plan.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { runC } from "../docs/js/c/index.js";

/** 앱처럼 입력이 필요할 때마다 답을 하나씩 넣어 다시 실행해요 (이미 본 출력은 다시 나오지 않아요). */
function run(code, inputs = []) {
  const answers = [];
  let out = "";
  const prompts = [];
  for (let round = 0; round < 50; round++) {
    const r = runC(code, {
      dialect: "cpp", answers: [...answers], startTime: 1700000000, onOutput: (t) => (out += t), onInput: (p) => prompts.push(p),
    });
    if (r.status !== "waiting") return { ...r, out, prompts };
    if (answers.length >= inputs.length) throw new Error("입력이 더 필요해요");
    answers.push(inputs[answers.length]);
  }
  throw new Error("너무 많이 반복했어요");
}

const ok = (code, want, inputs) => {
  const r = run(code, inputs);
  assert.ok(r.status === "ok" || r.status === "exit", JSON.stringify(r.error));
  assert.equal(r.out, want);
};

// ---------- 0단계: 지금 되는 것 ----------
test("C++ 모드: C 방식 코드와 <cstdio> 같은 헤더", () => {
  ok(`#include <cstdio>
#include <cstring>
#include <cmath>
int main() {
    char s[10];
    strcpy(s, "hi");
    printf("%s %.0f\\n", s, sqrt(16.0));
}`, "hi 4\n");
});

test("C++ 모드: bool, nullptr, __cplusplus는 헤더 없이", () => {
  ok(`#include <cstdio>
int main() {
    bool done = false;
    int *p = nullptr;
#ifdef __cplusplus
    printf("%d %d\\n", done, p == nullptr);
#endif
    return 0;
}`, "0 1\n");
});

test("C++ 모드: 구조체와 enum 이름을 바로 타입으로", () => {
  ok(`#include <cstdio>
struct Node { int value; Node *next; };
enum Color { RED, GREEN };
int main() {
    Node b = {2, nullptr};
    Node a = {1, &b};
    Color c = GREEN;
    printf("%d %d\\n", a.next->value, c);
}`, "2 1\n");
});

test("C++ 모드: void*를 그냥 넣으면 C++ 규칙대로 알려요", () => {
  const r = run("#include <cstdlib>\nint main() { int *p = malloc(sizeof(int)); return 0; }");
  assert.equal(r.status, "error");
  assert.equal(r.error.type, "C++ 컴파일 오류");
  assert.match(r.error.title, /void\*/);
  ok("#include <cstdlib>\n#include <cstdio>\nint main() { int *p = (int *)malloc(sizeof(int)); *p = 3; printf(\"%d\", *p); free(p); }", "3");
});

test("C++ 모드: 아직 없는 기능은 단계와 함께 안내해요", () => {
  const cases = [
    ["#include <sstream>\nint main() {}", /<sstream>.*다음 단계/],
    ["struct A { virtual void f() {} };\nint main() {}", /'virtual'.*6단계/],
    ["#include <iostream>\nint main() { std::tuple<int, int> t; }", /std::tuple/],
    ["int main() { try { } catch (int e) { } }", /'try'.*6단계/],
  ];
  for (const [code, pattern] of cases) {
    const r = run(code);
    assert.equal(r.status, "error", code);
    assert.match(r.error.title, pattern);
  }
});

test("C++ 낱말도 C 모드에서는 보통 이름이에요", () => {
  let out = "";
  const r = runC("#include <stdio.h>\nint main(void) { int new = 1, class = 2; printf(\"%d\", new + class); return 0; }", { onOutput: (t) => (out += t) });
  assert.equal(r.status, "ok", JSON.stringify(r.error));
  assert.equal(out, "3");
});


// ---------- 1단계: <iostream>, <iomanip> ----------
test("C++ 1단계: cin으로 읽고 cout으로 출력, 질문은 말풍선으로", () => {
  const r = run(`#include <iostream>
using namespace std;
int main() {
    int a, b;
    cout << "첫 번째 수? ";
    cin >> a;
    cout << "두 번째 수? ";
    cin >> b;
    cout << "합: " << a + b << endl;
}`, ["3", "4"]);
  assert.equal(r.status, "ok", JSON.stringify(r.error));
  assert.deepEqual(r.prompts, ["첫 번째 수? ", "두 번째 수? "]);
  assert.equal(r.out, "합: 7\n");
});

const H1 = "#include <iostream>\n#include <iomanip>\nusing namespace std;\n";
const STAGE1 = [
  ["한 줄에 두 값", H1 + 'int main() { int a, b; cin >> a >> b; cout << "합: " << a + b << endl; }', "합: 7\n", ["3 4"]],
  ["std:: 붙여 쓰기", '#include <iostream>\nint main() { std::cout << "x=" << 5 << std::endl; return 0; }', "x=5\n"],
  ["using std::cout", "#include <iostream>\nusing std::cout; using std::endl;\nint main() { cout << 1 << endl; }", "1\n"],
  ["char, bool, double 출력 규칙", H1 + "int main() { char c = 'A'; bool b = true; cout << c << ' ' << b << ' ' << 3.14159265 << ' ' << 2.5 << ' ' << 1e20 << ' ' << 100.0 << endl; }", "A 1 3.14159 2.5 1e+20 100\n"],
  ["boolalpha와 비교 결과(bool)", H1 + "int main() { cout << boolalpha << (3 > 2) << ' ' << (1 == 2) << ' ' << !true << endl; }", "true false false\n"],
  ["fixed와 setprecision", H1 + "int main() { cout << fixed << setprecision(2) << 2.0 / 3 << ' ' << 10.0 << endl; }", "0.67 10.00\n"],
  ["setprecision만 쓰면 유효숫자", H1 + "int main() { cout << setprecision(3) << 3.14159 << ' ' << 1234.5 << endl; }", "3.14 1.23e+03\n"],
  ["setw, setfill, left", H1 + "int main() { cout << setw(5) << 42 << '|' << setfill('0') << setw(4) << 7 << '|' << left << setfill(' ') << setw(4) << \"ab\" << '|' << endl; }", "   42|0007|ab  |\n"],
  ["hex, dec, showpoint, showpos", H1 + "int main() { cout << hex << 255 << ' ' << -1 << dec << ' ' << 10 << ' ' << showpoint << 2.0 << ' ' << noshowpoint << showpos << 3 << endl; }", "ff ffffffff 10 2.00000 +3\n"],
  ["while (cin >> x)는 입력 끝(EOF)까지", H1 + "int main() { int x, s = 0; while (cin >> x) s += x; cout << s << endl; }", "6\n", ["1 2", "3", null]],
  ["숫자 자리에 글자: 실패하고 0, clear와 ignore", H1 + "int main() { int x = 5; cin >> x; if (cin.fail()) cout << \"fail \" << x << endl; cin.clear(); cin.ignore(100, '\\n'); cin >> x; cout << x << endl; }", "fail 0\n9\n", ["abc", "9"]],
  ["char 배열과 char 읽기", H1 + "int main() { char name[20]; char a, b; cin >> name >> a >> b; cout << name << b << a << endl; }", "민지yx\n", ["민지 x y"]],
  ["double과 float 읽기", H1 + "int main() { double d; float f; cin >> d >> f; cout << d * 2 << ' ' << f << endl; }", "5 0.1\n", ["2.5 0.1"]],
  ["cin.get은 공백도 읽어요", H1 + "int main() { char c = cin.get(); cout << (int)c << endl; }", "32\n", [" a"]],
  ["printf와 섞어 써도 순서대로", "#include <iostream>\n#include <cstdio>\nusing namespace std;\nint main() { cout << \"a\"; printf(\"b\"); cout << \"c\" << endl; printf(\"%d\\n\", 1 < 2); }", "abc\n1\n"],
  ["std::min, std::max", H1 + "int main() { cout << max(3, 7) << min(2.5, 1.5) << std::max('a', 'b') << endl; }", "71.5b\n"],
  ["cerr도 화면에", H1 + "int main() { cerr << \"err\" << endl; }", "err\n"],
  ["char *는 문자열로", H1 + "int main() { const char *s = \"hi\"; cout << s << ' ' << (s == nullptr) << endl; }", "hi 0\n"],
  ["<bits/stdc++.h>", "#include <bits/stdc++.h>\nusing namespace std;\nint main() { cout << sqrt(16.0) << ' ' << strlen(\"abc\") << endl; }", "4 3\n"],
  ["long long, unsigned", H1 + "int main() { long long a = 1LL << 40; unsigned u = 4000000000u; cout << a << ' ' << u << ' ' << -5 << endl; }", "1099511627776 4000000000 -5\n"],
  ["setw로 표 만들기", H1 + "int main() { for (int i = 1; i <= 3; i++) cout << setw(2) << i << \" x 3 = \" << setw(2) << i * 3 << \"\\n\"; }", " 1 x 3 =  3\n 2 x 3 =  6\n 3 x 3 =  9\n"],
  ["sizeof('a')는 C++에서 1", H1 + "int main() { cout << sizeof('a') << endl; }", "1\n"],
];
for (const [name, code, want, inputs] of STAGE1) {
  test(`C++ 1단계: ${name}`, () => ok(code, want, inputs));
}

test("C++ 1단계: 실수는 친절하게 알려요", () => {
  const cases = [
    ["#include <iostream>\nint main() { cout << 1; }", /'cout'는 std::cout/],
    ["using namespace std;\nint main() { cout << 1; }", /#include <iostream>/],
    [H1 + "int main() { int x; cout >> x; }", /cout에는 <</],
    [H1 + "int main() { int x; cin << x; }", /cin에는 >>/],
    [H1 + "int main() { cin >> 5; }", /변수가 와야/],
    [H1 + "int main() { int a[3]; cin >> a; }", /배열 전체/],
    [H1 + "struct P { int x; };\nint main() { P p; cout << p; }", /구조체/],
    [H1 + "int main() { cout << max(3, 7.5); }", /타입이 같아야/],
    ["#include <iostream>\nusing namespace std;\nint main() { cout << setw(3) << 1; }", /<iomanip>/],
    [H1 + "int main() { cin.getline(); }", /cin\.getline\(\)는 아직/],
    ["#include <iostream>\nint main() { printf(\"x\"); }", /<cstdio>/],
  ];
  for (const [code, pattern] of cases) {
    const r = run(code);
    assert.equal(r.status, "error", code);
    assert.match(r.error.title, pattern, code);
  }
});


// ---------- 2단계 (앞부분): 참조, 기본 인자, 오버로딩, new/delete, auto, constexpr, 캐스트, 범위 for, 이름공간 ----------
const H2 = "#include <iostream>\nusing namespace std;\n";
const STAGE2A = [
  ["참조 변수", H2 + "int main() { int a = 1; int &r = a; r = 5; r++; cout << a << endl; }", "6\n"],
  ["참조 매개변수 swap", H2 + "void sw(int &x, int &y) { int t = x; x = y; y = t; }\nint main() { int a = 1, b = 2; sw(a, b); cout << a << b << endl; }", "21\n"],
  ["const 참조에 값", H2 + "int twice(const int &x) { return x * 2; }\nint main() { cout << twice(21) << endl; }", "42\n"],
  ["비const 참조에 값은 오류", H2 + "void f(int &x) {}\nint main() { f(3); }", "ERR"],
  ["참조 반환", H2 + "int arr[3];\nint &at(int i) { return arr[i]; }\nint main() { at(1) = 7; at(1) += 1; cout << arr[1] << endl; }", "8\n"],
  ["구조체 참조", H2 + "struct P { int x; };\nvoid inc(P &p) { p.x++; }\nint main() { P p = {1}; inc(p); P &q = p; q.x *= 10; cout << p.x << endl; }", "20\n"],
  ["참조 초기화 없음", H2 + "int main() { int &r; }", "ERR"],
  ["기본 인자", H2 + "int area(int w, int h = 2) { return w * h; }\nint main() { cout << area(3) << ' ' << area(3, 4) << endl; }", "6 12\n"],
  ["기본 인자 선언에만", H2 + "int f(int a, int b = 10);\nint main() { cout << f(1) << endl; }\nint f(int a, int b) { return a + b; }", "11\n"],
  ["오버로딩", H2 + "int sq(int x) { return x * x; }\ndouble sq(double x) { return x * x + 0.5; }\nint main() { cout << sq(3) << ' ' << sq(1.5) << endl; }", "9 2.75\n"],
  ["오버로딩 개수", H2 + "int add(int a, int b) { return a + b; }\nint add(int a, int b, int c) { return a + b + c; }\nint main() { cout << add(1, 2) << add(1, 2, 3) << endl; }", "36\n"],
  ["오버로딩 char*", H2 + "void show(int x) { cout << \"int\"; }\nvoid show(const char *s) { cout << \"str\"; }\nint main() { show(1); show(\"a\"); cout << endl; }", "intstr\n"],
  ["오버로딩 모호", H2 + "void f(int x) {}\nvoid f(double x) {}\nint main() { f(1L); }", "ERR"],
  ["new/delete", H2 + "int main() { int *p = new int(7); int *q = new int; *q = 3; cout << *p + *q << endl; delete p; delete q; }", "10\n"],
  ["new 배열", H2 + "int main() { int n = 4; int *a = new int[n]; for (int i = 0; i < n; i++) a[i] = i * i; cout << a[3] << endl; delete[] a; }", "9\n"],
  ["new 배열 0초기화", H2 + "int main() { int *a = new int[3](); cout << a[0] + a[2] << endl; delete[] a; }", "0\n"],
  ["new 구조체", H2 + "struct P { int x, y; };\nint main() { P *p = new P{3, 4}; cout << p->x * p->y << endl; delete p; }", "12\n"],
  ["delete 짝 틀림", H2 + "int main() { int *a = new int[3]; delete a; }", "ERR"],
  ["두 번 delete", H2 + "int main() { int *a = new int; delete a; delete a; }", "ERR"],
  ["delete nullptr", H2 + "int main() { int *p = nullptr; delete p; cout << \"ok\" << endl; }", "ok\n"],
  ["auto", H2 + "int main() { auto a = 3; auto b = 2.5; auto c = 'x'; auto d = a * b; cout << a << b << c << d << sizeof(a) << endl; }", "32.5x7.54\n"],
  ["auto 참조", H2 + "int main() { int x = 1; auto &r = x; r = 9; cout << x << endl; }", "9\n"],
  ["auto 처음 값 없음", H2 + "int main() { auto x; }", "ERR"],
  ["constexpr, const 배열 크기", H2 + "const int N = 3;\nconstexpr int M = N * 2;\nint main() { int a[N] = {1, 2, 3}; int b[M]; cout << sizeof(a) / sizeof(a[0]) << ' ' << sizeof(b) << endl; switch (2) { case N - 1: cout << \"case\" << endl; } }", "3 24\ncase\n"],
  ["static_cast", H2 + "int main() { int a = 7, b = 2; cout << static_cast<double>(a) / b << ' ' << static_cast<int>(3.9) << endl; }", "3.5 3\n"],
  ["범위 for", H2 + "int main() { int a[] = {1, 2, 3}; int s = 0; for (int x : a) s += x; for (auto &x : a) x *= 2; for (const auto &x : a) cout << x << ' '; cout << s << endl; }", "2 4 6 6\n"],
  ["범위 for break/continue", H2 + "int main() { int a[] = {1, 2, 3, 4, 5}; for (int x : a) { if (x == 2) continue; if (x == 4) break; cout << x; } cout << endl; }", "13\n"],
  ["범위 for 구조체", H2 + "struct P { int x; };\nint main() { P ps[2] = {{1}, {2}}; for (auto &p : ps) p.x += 10; for (P p : ps) cout << p.x << ' '; cout << endl; }", "11 12 \n"],
  ["범위 for 2차원", H2 + "int main() { int m[2][2] = {{1, 2}, {3, 4}}; for (auto &row : m) for (int v : row) cout << v; cout << endl; }", "1234\n"],
  ["범위 for 문자열 배열", H2 + "int main() { char s[] = \"hi\"; for (char c : s) if (c) cout << c << '.'; cout << endl; }", "h.i.\n"],
  ["이름공간", H2 + "namespace geo {\n  const double PI = 3.0;\n  double area(double r) { return PI * r * r; }\n  namespace inner { int f() { return 1; } }\n}\nint main() { cout << geo::area(2) << geo::inner::f() << endl; }", "121\n"],
  ["이름공간 안에서 짧은 이름", H2 + "namespace m { int twice(int x) { return x * 2; } int four(int x) { return twice(twice(x)); } }\nint main() { cout << m::four(1) << endl; }", "4\n"],
  ["using namespace 내 이름공간", H2 + "namespace m { int one() { return 1; } }\nusing namespace m;\nint main() { cout << one() << endl; }", "1\n"],
  ["이름공간 구조체", H2 + "namespace shp { struct Pt { int x; }; }\nint main() { shp::Pt p = {5}; cout << p.x << endl; }", "5\n"],
  ["swap", H2 + "int main() { int a = 1, b = 2; swap(a, b); double x = 1.5, y = 2.5; std::swap(x, y); cout << a << b << x << y << endl; }", "212.51.5\n"],
  ["f() 는 f(void)", H2 + "int f() { return 3; }\nint main() { cout << f() << endl; }", "3\n"],
  ["참조 cin", H2 + "void read(int &x) { cin >> x; }\nint main() { int a; read(a); cout << a * 2 << endl; }", "10\n", ["5"]],
  ["재귀 + 참조 누적", H2 + "void sum(int n, int &acc) { if (n == 0) return; acc += n; sum(n - 1, acc); }\nint main() { int t = 0; sum(4, t); cout << t << endl; }", "10\n"],
];
for (const [name, code, want, inputs] of STAGE2A) {
  test(`C++ 2단계: ${name}`, () => {
    const r = run(code, inputs);
    if (want === "ERR") assert.equal(r.status, "error", r.out);
    else ok(code, want, inputs);
  });
}


// ---------- 2단계 (뒷부분): std::string, std::vector ----------
const H2B = "#include <iostream>\n#include <string>\n#include <vector>\nusing namespace std;\n";
const STAGE2B = [
  ["string 기본", H2B + 'int main() { string s = "안녕"; string t("하세요"); string u = s + t + "!"; cout << u << " " << u.size() << endl; }', "안녕하세요! 16\n"],
  ["string 비교", H2B + 'int main() { string a = "apple", b = "banana"; cout << (a < b) << (a == "apple") << ("apple" != a) << (b >= a) << endl; }', "1101\n"],
  ["string 인덱스와 바꾸기", H2B + 'int main() { string s = "cat"; s[0] = \'b\'; s += \'s\'; s += "!"; s.push_back(\'?\'); cout << s << s.length() << s[1] << endl; }', "bats!?6a\n"],
  ["string 복사는 따로", H2B + 'int main() { string a = "x"; string b = a; b += "y"; cout << a << b << endl; }', "xxy\n"],
  ["string 함수", H2B + 'int main() { string s = "hello world"; cout << s.substr(6) << "|" << s.substr(0, 5) << "|" << s.find("o") << "|" << s.rfind("o") << "|" << (s.find("z") == string::npos) << endl; s.erase(5, 6); s.insert(0, ">> "); s.replace(3, 1, "H"); cout << s << endl; }', "world|hello|4|7|1\n>> Hello\n"],
  ["cin >> string, getline", H2B + 'int main() { string name, line; cin >> name; getline(cin, line); getline(cin, line); cout << name << "/" << line << endl; }', "민지/좋은 하루\n", ["민지", "좋은 하루"]],
  ["while getline", H2B + 'int main() { string line; int n = 0; while (getline(cin, line)) n += line.size(); cout << n << endl; }', "5\n", ["ab", "cde", null]],
  ["to_string, stoi, stod", H2B + 'int main() { string s = to_string(42) + "+" + to_string(1.5); int x = stoi("12") + 1; double d = stod("2.5"); cout << s << " " << x << " " << d * 2 << endl; }', "42+1.500000 13 5\n"],
  ["c_str과 printf", "#include <iostream>\n#include <cstdio>\n#include <cstring>\nusing namespace std;\nint main() { string s = \"abc\"; printf(\"%s %zu\\n\", s.c_str(), strlen(s.c_str())); }", "abc 3\n"],
  ["string 범위 for", H2B + 'int main() { string s = "abc"; for (char c : s) cout << c << \'-\'; for (char &c : s) c = c - 32; cout << s << endl; }', "a-b-c-ABC\n"],
  ["string 함수 인자, 참조", H2B + 'string shout(string s) { s += "!"; return s; }\nvoid add(string &s) { s += "?"; }\nint count(const string &s) { return s.size(); }\nint main() { string a = "hi"; string b = shout(a); add(a); cout << a << b << count("xyz") << endl; }', "hi?hi!3\n"],
  ["string 범위 밖", H2B + 'int main() { string s = "ab"; cout << s[5]; }', "ERR"],
  ["string + 숫자 오류", H2B + 'int main() { string s = "a"; s = s + 1; }', "ERR"],
  ["vector 기본", H2B + 'int main() { vector<int> v; v.push_back(3); v.push_back(1); v.push_back(2); cout << v.size() << v[0] << v.back() << v.front() << endl; }', "3323\n"],
  ["vector 초기화들", H2B + 'int main() { vector<int> a = {1, 2, 3}; vector<int> b(3); vector<int> c(2, 7); vector<int> d{4, 5}; cout << a[2] << b[1] << c[1] << d.size() << endl; }', "3072\n"],
  ["vector 반복", H2B + 'int main() { vector<int> v = {1, 2, 3}; int s = 0; for (int i = 0; i < v.size(); i++) s += v[i]; for (int &x : v) x *= 10; for (auto x : v) cout << x << " "; cout << s << endl; }', "10 20 30 6\n"],
  ["vector 복사는 따로", H2B + 'int main() { vector<int> a = {1}; vector<int> b = a; b.push_back(2); b[0] = 9; cout << a.size() << a[0] << b.size() << b[0] << endl; }', "1129\n"],
  ["vector 함수 인자", H2B + 'int sum(const vector<int> &v) { int s = 0; for (int x : v) s += x; return s; }\nvoid fill(vector<int> &v, int n) { for (int i = 0; i < n; i++) v.push_back(i); }\nvector<int> twice(vector<int> v) { for (int &x : v) x *= 2; return v; }\nint main() { vector<int> v; fill(v, 4); vector<int> w = twice(v); cout << sum(v) << " " << sum(w) << endl; }', "6 12\n"],
  ["vector 2차원", H2B + 'int main() { int n = 2, m = 3; vector<vector<int>> g(n, vector<int>(m, 0)); g[1][2] = 5; g[0].push_back(1); cout << g.size() << g[0].size() << g[1][2] << endl; }', "245\n"],
  ["vector<string>", H2B + 'int main() { vector<string> names = {"민지", "철수"}; names.push_back("영희"); for (const auto &n : names) cout << n << " "; cout << names[1].size() << endl; }', "민지 철수 영희 6\n"],
  ["vector 구조체", H2B + 'struct P { int x, y; };\nint main() { vector<P> ps; ps.push_back({1, 2}); ps.push_back(P{3, 4}); ps[1].x += 10; for (auto &p : ps) cout << p.x << "," << p.y << " "; cout << endl; }', "1,2 13,4 \n"],
  ["구조체 안 string", H2B + 'struct Student { string name; int score; };\nint main() { Student a = {"민지", 90}; Student b = a; b.name += "!"; vector<Student> all = {a, b}; for (auto &s : all) cout << s.name << s.score << " "; cout << endl; }', "민지90 민지!90 \n"],
  ["vector pop/insert/erase/clear", H2B + 'int main() { vector<int> v = {1, 2, 3, 4}; v.pop_back(); v.insert(v.begin() + 1, 9); v.erase(v.begin()); for (int x : v) cout << x; v.clear(); cout << " " << v.empty() << endl; }', "923 1\n"],
  ["vector resize, at", H2B + 'int main() { vector<int> v(2, 1); v.resize(4); v.resize(5, 7); cout << v.size() << v[1] << v[2] << v.at(4) << endl; }', "5107\n"],
  ["vector 범위 밖", H2B + 'int main() { vector<int> v(3); v[3] = 1; }', "ERR"],
  ["빈 vector back", H2B + 'int main() { vector<int> v; cout << v.back(); }', "ERR"],
  ["vector 반복자", H2B + 'int main() { vector<int> v = {5, 6, 7}; for (auto it = v.begin(); it != v.end(); ++it) cout << *it; cout << " " << v.end() - v.begin() << endl; }', "567 3\n"],
  ["vector cin 읽기", H2B + 'int main() { int n; cin >> n; vector<int> v(n); for (int i = 0; i < n; i++) cin >> v[i]; int best = v[0]; for (int x : v) best = max(best, x); cout << best << endl; }', "9\n", ["3", "4 9 2"]],
  ["vector 같음 비교", H2B + 'int main() { vector<int> a = {1, 2}, b = {1, 2}; cout << (a == b); b.push_back(3); cout << (a != b) << endl; }', "11\n"],
  ["vector 헤더 없음", "#include <iostream>\nusing namespace std;\nint main() { vector<int> v; }", "ERR"],
  ["cout << vector 오류", H2B + "int main() { vector<int> v; cout << v; }", "ERR"],
  ["auto와 string", H2B + 'int main() { auto s = string("ab") + "c"; auto n = s.size(); cout << s << n << endl; }', "abc3\n"],
  ["std:: 붙인 string/vector", '#include <iostream>\n#include <string>\n#include <vector>\nint main() { std::vector<std::string> v = {"a"}; std::string s = v[0] + "b"; std::cout << s << std::endl; }', "ab\n"],
  ["string 배열", H2B + 'int main() { string names[3] = {"a", "b"}; names[2] = "c"; for (string &n : names) cout << n; cout << names[1].size() << endl; }', "abc1\n"],
  ["new/delete와 string, vector 목표", H2B + 'int main() {\n    int *p = new int(7);\n    std::vector<std::string> names = {"민지", "철수"};\n    names.push_back("영희");\n    for (const auto &n : names) std::cout << n << " ";\n    std::cout << *p << "\\n";\n    delete p;\n}', "민지 철수 영희 7\n"],
];
for (const [name, code, want, inputs] of STAGE2B) {
  test(`C++ 2단계: ${name}`, () => {
    const r = run(code, inputs);
    if (want === "ERR") assert.equal(r.status, "error", r.out);
    else ok(code, want, inputs);
  });
}


// ---------- 3단계: 클래스 ----------
const H3 = "#include <iostream>\n#include <string>\n#include <vector>\nusing namespace std;\n";
const STAGE3 = [
  ["멤버 함수와 생성자", H3 + "class Counter {\n  int count;\npublic:\n  Counter() : count(0) {}\n  void add() { count++; }\n  int get() const { return count; }\n};\nint main() { Counter c; c.add(); c.add(); cout << c.get() << endl; }", "2\n"],
  ["소멸자 순서", H3 + 'class T {\n  string name;\npublic:\n  T(string n) : name(n) { cout << "만듦 " << name << endl; }\n  ~T() { cout << "없앰 " << name << endl; }\n};\nint main() { T a("a"); { T b("b"); } T c("c"); cout << "끝" << endl; }', "만듦 a\n만듦 b\n없앰 b\n만듦 c\n끝\n없앰 c\n없앰 a\n"],
  ["생성자 오버로딩, 기본 인자", H3 + "class P {\npublic:\n  int x, y;\n  P() : x(0), y(0) {}\n  P(int a, int b = 5) : x(a), y(b) {}\n};\nint main() { P a; P b(1); P c(2, 3); P d{4, 6}; P e = P(7, 8); cout << a.x << a.y << b.x << b.y << c.x << c.y << d.x << d.y << e.x << e.y << endl; }", "0015234678\n"],
  ["this와 멤버 이름 가리기", H3 + "class P {\n  int x;\npublic:\n  P(int x) { this->x = x; }\n  int getX() { return x; }\n  P *self() { return this; }\n};\nint main() { P p(9); cout << p.getX() << p.self()->getX() << endl; }", "99\n"],
  ["private 접근 오류", H3 + "class A { int secret = 1; };\nint main() { A a; cout << a.secret; }", "ERR"],
  ["private 함수 오류", H3 + "class A { void hide() {} public: void show() { hide(); } };\nint main() { A a; a.show(); a.hide(); }", "ERR"],
  ["struct는 기본 public", H3 + "struct S { int v = 3; int twice() { return v * 2; } };\nint main() { S s; cout << s.v << s.twice() << endl; }", "36\n"],
  ["기본 멤버 값", H3 + "class Box {\npublic:\n  int w = 2, h = 3;\n  string name = \"상자\";\n  int area() const { return w * h; }\n};\nint main() { Box b; b.w = 5; cout << b.name << b.area() << endl; }", "상자15\n"],
  ["클래스 밖 정의", H3 + "class Acc {\n  int bal;\npublic:\n  Acc(int b);\n  void dep(int m);\n  int get() const;\n  ~Acc();\n};\nAcc::Acc(int b) : bal(b) {}\nvoid Acc::dep(int m) { bal += m; }\nint Acc::get() const { return bal; }\nAcc::~Acc() { cout << \"bye\" << endl; }\nint main() { Acc a(10); a.dep(5); cout << a.get() << endl; }", "15\nbye\n"],
  ["const 객체에 const 아닌 함수", H3 + "class A { public: int v = 1; void inc() { v++; } int get() const { return v; } };\nint main() { const A a; cout << a.get(); a.inc(); }", "ERR"],
  ["const 함수에서 멤버 바꾸기", H3 + "class A { int v = 1; public: void bad() const { v = 2; } };\nint main() { A a; a.bad(); }", "ERR"],
  ["static 멤버", H3 + "class Dog {\npublic:\n  static int count;\n  string name;\n  Dog(string n) : name(n) { count++; }\n  static int total() { return count; }\n};\nint Dog::count = 0;\nint main() { Dog a(\"a\"), b(\"b\"); cout << Dog::count << Dog::total() << a.total() << endl; }", "222\n"],
  ["static 멤버 정의 빠짐", H3 + "class A { public: static int n; };\nint main() { cout << A::n; }", "ERR"],
  ["객체 배열", H3 + "class C { public: int v; C() : v(7) {} };\nint main() { C arr[3]; arr[1].v = 1; cout << arr[0].v << arr[1].v << arr[2].v << endl; }", "717\n"],
  ["vector<클래스>", H3 + "class P { public: int x; P(int a) : x(a) {} int dbl() const { return x * 2; } };\nint main() { vector<P> ps; ps.push_back(P(1)); ps.push_back(P(2)); int s = 0; for (const auto &p : ps) s += p.dbl(); cout << s << ps[1].x << endl; }", "62\n"],
  ["new/delete와 소멸자", H3 + 'class R { public: int id; R(int i) : id(i) { cout << "R" << id; } ~R() { cout << "~R" << id; } };\nint main() { R *p = new R(1); R *q = new R(2); delete q; delete p; cout << endl; }', "R1R2~R2~R1\n"],
  ["포인터로 멤버 함수", H3 + "class A { public: int v = 4; int get() { return v; } };\nint main() { A a; A *p = &a; p->v = 5; cout << p->get() << (*p).get() << endl; }", "55\n"],
  ["멤버 함수에서 다른 멤버 함수", H3 + "class Calc { int acc = 0; public: Calc &add(int x) { acc += x; return *this; } int twice() { return get() * 2; } int get() { return acc; } };\nint main() { Calc c; c.add(1).add(2); cout << c.twice() << endl; }", "6\n"],
  ["객체를 함수에 값/참조로", H3 + "class A { public: int v; A(int x) : v(x) {} };\nvoid byVal(A a) { a.v = 100; }\nvoid byRef(A &a) { a.v = 200; }\nint main() { A a(1); byVal(a); cout << a.v; byRef(a); cout << a.v << endl; }", "1200\n"],
  ["멤버로 다른 클래스", H3 + "class Engine { public: int hp; Engine() : hp(100) {} };\nclass Car { public: Engine e; string name; Car(string n) : name(n) {} };\nint main() { Car c(\"차\"); cout << c.name << c.e.hp << endl; }", "차100\n"],
  ["기본 생성자 없음", H3 + "class A { public: A(int x) {} };\nint main() { A a; }", "ERR"],
  ["생성자 값 개수 틀림", H3 + "class A { public: A(int x) {} };\nint main() { A a(1, 2); }", "ERR"],
  ["{ }로 private 멤버", H3 + "class A { int x; public: int get() { return x; } };\nint main() { A a{1}; }", "ERR"],
  ["전역 객체 생성/소멸", H3 + 'class G { public: G() { cout << "G" << endl; } ~G() { cout << "~G" << endl; } };\nG g;\nint main() { cout << "main" << endl; }', "G\nmain\n~G\n"],
  ["return 지역 객체 (복사 생략)", H3 + 'class T { public: int v; T(int x) : v(x) {} ~T() { cout << "~" << v; } };\nT make() { T t(3); return t; }\nint main() { T a = make(); cout << a.v; }', "3~3"],
  ["반복문 안 객체", H3 + 'class T { public: int v; T(int x) : v(x) {} ~T() { cout << "~" << v; } };\nint main() { for (int i = 0; i < 3; i++) { T t(i); } cout << endl; }', "~0~1~2\n"],
  ["this 바깥", H3 + "int main() { cout << this; }", "ERR"],
  ["클래스 이름공간", H3 + "namespace shop { class Item { public: int price; Item(int p) : price(p) {} int sale() const; }; int Item::sale() const { return price / 2; } }\nint main() { shop::Item it(100); cout << it.sale() << endl; }", "50\n"],
  ["값 대입은 멤버 복사", H3 + "class A { public: string s; vector<int> v; };\nint main() { A a; a.s = \"x\"; a.v.push_back(1); A b = a; b.s += \"y\"; b.v.push_back(2); cout << a.s << a.v.size() << b.s << b.v.size() << endl; }", "x1xy2\n"],
  ["클래스 cin", H3 + "class S { public: string name; int score; void read() { cin >> name >> score; } void print() const { cout << name << \":\" << score << endl; } };\nint main() { S s; s.read(); s.print(); }", "민지:90\n", ["민지 90"]],
  ["Counter 목표", "#include <iostream>\nclass Counter {\n    int count;\npublic:\n    Counter() : count(0) {}\n    ~Counter() { std::cout << \"끝 \" << count << \"\\n\"; }\n    void add() { count++; }\n};\nint main() { Counter c; c.add(); c.add(); }", "끝 2\n"],
];
for (const [name, code, want, inputs] of STAGE3) {
  test(`C++ 3단계: ${name}`, () => {
    const r = run(code, inputs);
    if (want === "ERR") assert.equal(r.status, "error", r.out);
    else ok(code, want, inputs);
  });
}


// ---------- 4단계: 연산자 오버로딩 ----------
const H4 = "#include <iostream>\n#include <string>\n#include <vector>\nusing namespace std;\n";
const V4 = "struct V {\n  int x, y;\n  V operator+(const V &o) const { return {x + o.x, y + o.y}; }\n  V operator-() const { return {-x, -y}; }\n  bool operator==(const V &o) const { return x == o.x && y == o.y; }\n  bool operator!=(const V &o) const { return !(*this == o); }\n  V &operator+=(const V &o) { x += o.x; y += o.y; return *this; }\n};\nostream &operator<<(ostream &os, const V &v) { return os << \"(\" << v.x << \",\" << v.y << \")\"; }\n";
const STAGE4 = [
  ["괄호 안의 Type(값)은 형 변환이 아니라 객체", H4 + "struct F { int n; F(int a) : n(a) {} bool operator==(const F &o) const { return n == o.n; } };\nint main() { cout << (F(2) == F(2) ? \"같음\" : \"다름\") << (F{3}.n) << endl; }", "같음3\n"],
  ["멤버 +, 일반 <<", H4 + V4 + "int main() { V a{1, 2}, b{3, 4}; cout << a + b << endl; }", "(4,6)\n"],
  ["단항 -, ==, !=", H4 + V4 + "int main() { V a{1, 2}; V b = -a; cout << b << (a == a) << (a != b) << endl; }", "(-1,-2)11\n"],
  ["+= 이어 쓰기", H4 + V4 + "int main() { V a{1, 1}; (a += V{1, 0}) += V{0, 5}; cout << a << endl; }", "(2,6)\n"],
  ["cout 이어 쓰기", H4 + V4 + "int main() { V a{1, 2}; cout << \"a=\" << a << \", -a=\" << -a << \"!\" << endl; }", "a=(1,2), -a=(-1,-2)!\n"],
  ["일반 함수 연산자", H4 + "struct M { int v; };\nM operator*(const M &a, int k) { return {a.v * k}; }\nM operator*(int k, const M &a) { return {a.v * k * 10}; }\nint main() { M m{2}; cout << (m * 3).v << (3 * m).v << endl; }", "660\n"],
  ["friend와 private", H4 + "class Money {\n  int won;\npublic:\n  Money(int w) : won(w) {}\n  Money operator+(const Money &o) const { return Money(won + o.won); }\n  friend ostream &operator<<(ostream &os, const Money &m);\n};\nostream &operator<<(ostream &os, const Money &m) { os << m.won << \"원\"; return os; }\nint main() { Money a(1000), b(500); cout << a + b << endl; }", "1500원\n"],
  ["friend 몸통 안", H4 + "class P {\n  int x;\npublic:\n  P(int v) : x(v) {}\n  friend ostream &operator<<(ostream &os, const P &p) { return os << \"P\" << p.x; }\n};\nint main() { cout << P(7) << endl; }", "P7\n"],
  ["operator>>", H4 + "struct Pt { int x, y; };\nistream &operator>>(istream &is, Pt &p) { return is >> p.x >> p.y; }\nostream &operator<<(ostream &os, const Pt &p) { return os << p.x + p.y; }\nint main() { Pt p; cin >> p; cout << p << endl; }", "7\n", ["3 4"]],
  ["operator[]", H4 + "class Arr {\n  int d[3] = {10, 20, 30};\npublic:\n  int &operator[](int i) { return d[i]; }\n};\nint main() { Arr a; a[1] = 5; a[2] += 1; cout << a[0] << a[1] << a[2] << endl; }", "10531\n"],
  ["operator()", H4 + "struct Add { int base; int operator()(int x) const { return base + x; } };\nint main() { Add add5{5}; cout << add5(3) << endl; }", "8\n"],
  ["++ 앞/뒤", H4 + "class C {\n  int n = 0;\npublic:\n  C &operator++() { n++; return *this; }\n  C operator++(int) { C old = *this; n++; return old; }\n  int get() const { return n; }\n};\nint main() { C c; ++c; C old = c++; cout << old.get() << c.get() << endl; }", "12\n"],
  ["< 비교", H4 + "struct S { int score; bool operator<(const S &o) const { return score < o.score; } };\nint main() { S a{3}, b{5}; cout << (a < b) << (b < a) << endl; }", "10\n"],
  ["operator= 와 복사 생성자", H4 + "class T {\npublic:\n  int v;\n  T(int x) : v(x) {}\n  T(const T &o) : v(o.v) { cout << \"copy \"; }\n  T &operator=(const T &o) { v = o.v * 10; cout << \"assign \"; return *this; }\n};\nvoid take(T t) { cout << t.v << \" \"; }\nint main() { T a(1); T b = a; T c(a); take(a); c = b; cout << c.v << endl; }", "copy copy copy 1 assign 10\n"],
  ["연산자 없음 안내", H4 + "struct P { int x; };\nint main() { P a{1}, b{2}; P c = a + b; }", "ERR"],
  ["cout 구조체 안내", H4 + "struct P { int x; };\nint main() { P a{1}; cout << a; }", "ERR"],
  ["== 없음 안내", H4 + "struct P { int x; };\nint main() { P a{1}; cout << (a == a); }", "ERR"],
  ["vector 안의 객체 출력", H4 + V4 + "int main() { vector<V> vs = {{1, 2}, {3, 4}}; V sum{0, 0}; for (const V &v : vs) sum += v; cout << sum << endl; }", "(4,6)\n"],
  ["클래스 밖 연산자 정의", H4 + "class F {\n  int n, d;\npublic:\n  F(int a, int b) : n(a), d(b) {}\n  F operator*(const F &o) const;\n  void print() const { cout << n << \"/\" << d << endl; }\n};\nF F::operator*(const F &o) const { return F(n * o.n, d * o.d); }\nint main() { F a(1, 2), b(3, 4); (a * b).print(); }", "3/8\n"],
  ["string 멤버와 연산자", H4 + "struct Name { string s; Name operator+(const Name &o) const { return {s + \" \" + o.s}; } };\nint main() { Name a{\"홍\"}, b{\"길동\"}; cout << (a + b).s << endl; }", "홍 길동\n"],
  ["return {} 로 string, vector", H4 + "vector<int> two() { return {1, 2}; }\nstring hi() { return {\"hi\"}; }\nint main() { cout << two().size() << hi() << endl; }", "2hi\n"],
  ["V 목표", "#include <iostream>\nstruct V { int x, y; V operator+(const V &o) const { return {x + o.x, y + o.y}; } };\nstd::ostream &operator<<(std::ostream &os, const V &v) { return os << \"(\" << v.x << \",\" << v.y << \")\"; }\nint main() { std::cout << V{1, 2} + V{3, 4} << \"\\n\"; }", "(4,6)\n"],
];
for (const [name, code, want, inputs] of STAGE4) {
  test(`C++ 4단계: ${name}`, () => {
    const r = run(code, inputs);
    if (want === "ERR") assert.equal(r.status, "error", r.out);
    else ok(code, want, inputs);
  });
}


// ---------- 5단계 (앞부분): 템플릿, 람다, pair, 알고리즘 ----------
const H5 = "#include <iostream>\n#include <string>\n#include <vector>\n#include <algorithm>\n#include <numeric>\nusing namespace std;\n";
const STAGE5A = [
  ["함수 템플릿", H5 + "template <typename T> T biggest(T a, T b) { return a > b ? a : b; }\nint main() { cout << biggest(3, 7) << \" \" << biggest(2.5, 1.5) << \" \" << biggest('a', 'z') << \" \" << biggest(string(\"ab\"), string(\"b\")) << endl; }", "7 2.5 z b\n"],
  ["템플릿 타입 직접", H5 + "template <typename T> T half(T x) { return x / 2; }\nint main() { cout << half(7) << \" \" << half<double>(7) << endl; }", "3 3.5\n"],
  ["템플릿 T 충돌", H5 + "template <typename T> T biggest(T a, T b) { return a > b ? a : b; }\nint main() { cout << biggest(1, 2.5); }", "ERR"],
  ["vector<T> 템플릿", H5 + "template <typename T> T sumAll(const vector<T> &v) { T s = 0; for (const T &x : v) s += x; return s; }\nint main() { vector<int> a = {1, 2, 3}; vector<double> b = {0.5, 0.25}; cout << sumAll(a) << \" \" << sumAll(b) << endl; }", "6 0.75\n"],
  ["템플릿 두 타입", H5 + "template <typename A, typename B> void show(A a, B b) { cout << a << \"/\" << b << endl; }\nint main() { show(1, \"x\"); show(2.5, 'c'); }", "1/x\n2.5/c\n"],
  ["클래스 템플릿", H5 + "template <typename T>\nclass Box {\n  T value;\npublic:\n  Box(T v) : value(v) {}\n  T get() const { return value; }\n  void set(T v) { value = v; }\n};\nint main() { Box<int> a(3); Box<string> b(\"hi\"); a.set(a.get() * 2); cout << a.get() << b.get() << endl; }", "6hi\n"],
  ["클래스 템플릿 자기 이름", H5 + "template <typename T>\nstruct Pair2 {\n  T a, b;\n  Pair2 swapped() const { return Pair2{b, a}; }\n};\nint main() { Pair2<int> p{1, 2}; Pair2<int> q = p.swapped(); cout << q.a << q.b << endl; }", "21\n"],
  ["템플릿 스택", H5 + "template <typename T>\nclass Stack {\n  vector<T> data;\npublic:\n  void push(const T &x) { data.push_back(x); }\n  T pop() { T x = data.back(); data.pop_back(); return x; }\n  bool empty() const { return data.empty(); }\n};\nint main() { Stack<string> s; s.push(\"a\"); s.push(\"b\"); while (!s.empty()) cout << s.pop(); cout << endl; }", "ba\n"],
  ["sort 기본", H5 + "int main() { vector<int> v = {5, 2, 8, 1}; sort(v.begin(), v.end()); for (int x : v) cout << x; cout << endl; }", "1258\n"],
  ["sort 배열, greater", H5 + "int main() { int a[] = {3, 1, 2}; sort(a, a + 3, greater<int>()); for (int x : a) cout << x; cout << endl; }", "321\n"],
  ["sort 람다", H5 + "int main() { vector<string> w = {\"ccc\", \"a\", \"bb\"}; sort(w.begin(), w.end(), [](const string &x, const string &y) { return x.size() < y.size(); }); for (auto &s : w) cout << s << \" \"; cout << endl; }", "a bb ccc \n"],
  ["sort 함수 이름", H5 + "bool desc(int a, int b) { return a > b; }\nint main() { vector<int> v = {1, 3, 2}; sort(v.begin(), v.end(), desc); cout << v[0] << v[1] << v[2] << endl; }", "321\n"],
  ["sort 구조체 operator<", H5 + "struct S { string name; int score; bool operator<(const S &o) const { return score > o.score; } };\nint main() { vector<S> v = {{\"a\", 1}, {\"b\", 3}, {\"c\", 2}}; sort(v.begin(), v.end()); for (auto &s : v) cout << s.name; cout << endl; }", "bca\n"],
  ["sort 구조체 < 없음", H5 + "struct S { int x; };\nint main() { vector<S> v = {{1}}; sort(v.begin(), v.end()); }", "ERR"],
  ["sort string", H5 + "int main() { vector<string> v = {\"banana\", \"apple\", \"cherry\"}; sort(v.begin(), v.end()); cout << v[0] << v[2] << endl; }", "applecherry\n"],
  ["reverse, find, count", H5 + "int main() { vector<int> v = {1, 2, 3, 2}; reverse(v.begin(), v.end()); cout << v[0]; auto it = find(v.begin(), v.end(), 3); cout << (it - v.begin()) << count(v.begin(), v.end(), 2) << (find(v.begin(), v.end(), 9) == v.end()) << endl; }", "2121\n"],
  ["max_element, min_element", H5 + "int main() { vector<int> v = {4, 9, 1}; cout << *max_element(v.begin(), v.end()) << *min_element(v.begin(), v.end()) << (max_element(v.begin(), v.end()) - v.begin()) << endl; }", "911\n"],
  ["accumulate", H5 + "int main() { vector<int> v = {1, 2, 3}; vector<string> w = {\"a\", \"b\"}; cout << accumulate(v.begin(), v.end(), 0) << accumulate(w.begin(), w.end(), string(\"\")) << accumulate(v.begin(), v.end(), 0.5) << endl; }", "6ab6.5\n"],
  ["count_if, find_if 람다", H5 + "int main() { vector<int> v = {1, 4, 6, 7}; int limit = 5; cout << count_if(v.begin(), v.end(), [&](int x) { return x > limit; }); cout << *find_if(v.begin(), v.end(), [](int x) { return x % 2 == 0; }) << endl; }", "24\n"],
  ["fill", H5 + "int main() { vector<int> v(3); fill(v.begin(), v.end(), 7); cout << v[0] + v[2] << endl; }", "14\n"],
  ["람다 변수와 캡처", H5 + "int main() { int total = 0; auto add = [&](int x) { total += x; }; add(3); add(4); auto sq = [](int x) { return x * x; }; cout << total << sq(5) << endl; }", "725\n"],
  ["람다 -> 타입", H5 + "int main() { auto f = [](int a, int b) -> double { return a / 2.0 + b; }; cout << f(3, 1) << endl; }", "2.5\n"],
  ["pair 기본", H5 + "int main() { pair<string, int> p = {\"민지\", 90}; pair<int, int> q(1, 2); auto r = make_pair(3, 'x'); cout << p.first << p.second << q.second << r.first << r.second << endl; }", "민지90 23x\n".replace(" ", "")],
  ["pair 정렬", H5 + "int main() { vector<pair<int, string>> v = {{2, \"b\"}, {1, \"z\"}, {2, \"a\"}}; sort(v.begin(), v.end()); for (auto &p : v) cout << p.first << p.second << \" \"; cout << (v[0] < v[1]) << endl; }", "1z 2a 2b 1\n"],
  ["템플릿 + 람다 인자", H5 + "template <typename F> int applyTwice(F f, int x) { return f(f(x)); }\nint main() { cout << applyTwice([](int v) { return v * 3; }, 2) << endl; }", "18\n"],
  ["알고리즘 헤더 없음", "#include <iostream>\n#include <vector>\nusing namespace std;\nint main() { vector<int> v; sort(v.begin(), v.end()); }", "ERR"],
  ["템플릿 목표", "#include <iostream>\n#include <vector>\n#include <algorithm>\ntemplate <typename T> T biggest(T a, T b) { return a > b ? a : b; }\nint main() {\n    std::vector<int> v = {3, 1, 2};\n    std::sort(v.begin(), v.end());\n    std::cout << v[0] << v[1] << v[2] << \" \" << biggest(2.5, 1.5) << \"\\n\";\n}", "123 2.5\n"],
];
for (const [name, code, want, inputs] of STAGE5A) {
  test(`C++ 5단계: ${name}`, () => {
    const r = run(code, inputs);
    if (want === "ERR") assert.equal(r.status, "error", r.out);
    else ok(code, want, inputs);
  });
}


// ---------- 5단계 (뒷부분): map, set, stack, queue, priority_queue, deque ----------
const H5B = "#include <iostream>\n#include <string>\n#include <vector>\n#include <map>\n#include <set>\n#include <stack>\n#include <queue>\n#include <unordered_map>\n#include <algorithm>\nusing namespace std;\n";
const STAGE5B = [
  ["map 기본", H5B + "int main() { map<string, int> age; age[\"민지\"] = 15; age[\"철수\"] = 17; age[\"민지\"] += 1; cout << age[\"민지\"] << age.size() << age.count(\"영희\") << age.size() << endl; }", "1620 2\n".replace(" ", "")],
  ["map 순서대로 돌기", H5B + "int main() { map<string, int> m = {{\"b\", 2}, {\"a\", 1}, {\"c\", 3}}; for (auto &p : m) cout << p.first << p.second << \" \"; cout << endl; }", "a1 b2 c3 \n"],
  ["map 구조화 바인딩", H5B + "int main() { map<int, string> m; m[3] = \"셋\"; m[1] = \"하나\"; for (auto &[k, v] : m) cout << k << v << \" \"; for (auto &[k, v] : m) v += \"!\"; cout << m[1] << endl; }", "1하나 3셋 하나!\n"],
  ["map 단어 세기", H5B + "int main() { map<string, int> cnt; string w; while (cin >> w) cnt[w]++; for (const auto &p : cnt) cout << p.first << \":\" << p.second << \" \"; cout << endl; }", "a:2 b:1 \n", ["a b a", null]],
  ["map find, erase, at", H5B + "int main() { map<string, int> m = {{\"x\", 1}, {\"y\", 2}}; auto it = m.find(\"y\"); if (it != m.end()) cout << it->first << it->second; cout << (m.find(\"z\") == m.end()); m.erase(\"x\"); cout << m.size() << m.at(\"y\") << m.contains(\"y\") << endl; }", "y21121\n"],
  ["map at 없는 키", H5B + "int main() { map<string, int> m; cout << m.at(\"없음\"); }", "ERR"],
  ["map insert, emplace", H5B + "int main() { map<int, int> m; m.insert({1, 10}); m.insert(make_pair(2, 20)); m.emplace(3, 30); m.insert({1, 99}); cout << m[1] << m.size() << endl; }", "103\n"],
  ["unordered_map", H5B + "int main() { unordered_map<string, int> m; m[\"k\"] = 5; cout << m[\"k\"] << m.count(\"k\") << endl; }", "51\n"],
  ["map<string, vector<int>>", H5B + "int main() { map<string, vector<int>> g; g[\"a\"].push_back(1); g[\"a\"].push_back(2); g[\"b\"]; cout << g[\"a\"].size() << g[\"b\"].size() << g.size() << endl; }", "202\n"],
  ["set", H5B + "int main() { set<int> s = {3, 1, 3, 2}; s.insert(5); s.insert(1); cout << s.size(); for (int x : s) cout << x; cout << s.count(2) << s.count(9); s.erase(3); cout << s.size() << endl; }", "41235103\n"],
  ["set<string> 중복 제거", H5B + "int main() { vector<string> w = {\"b\", \"a\", \"b\"}; set<string> s(w.begin(), w.end()); for (auto &x : s) cout << x; cout << endl; }", "ab\n"],
  ["stack", H5B + "int main() { stack<int> s; s.push(1); s.push(2); s.push(3); cout << s.top() << s.size(); s.pop(); cout << s.top(); while (!s.empty()) s.pop(); cout << s.empty() << endl; }", "3321\n"],
  ["queue", H5B + "int main() { queue<string> q; q.push(\"a\"); q.push(\"b\"); cout << q.front() << q.back(); q.pop(); cout << q.front() << q.size() << endl; }", "abb1\n"],
  ["priority_queue", H5B + "int main() { priority_queue<int> pq; for (int x : {3, 9, 1, 5}) pq.push(x); while (!pq.empty()) { cout << pq.top(); pq.pop(); } cout << endl; }", "9531\n"],
  ["priority_queue greater", H5B + "int main() { priority_queue<int, vector<int>, greater<int>> pq; pq.push(4); pq.push(1); pq.push(7); cout << pq.top(); pq.pop(); cout << pq.top() << endl; }", "14\n"],
  ["priority_queue pair (다익스트라 모양)", H5B + "int main() { priority_queue<pair<int, int>, vector<pair<int, int>>, greater<pair<int, int>>> pq; pq.push({5, 1}); pq.push({2, 9}); pq.push({2, 3}); auto [d, v] = pq.top(); cout << d << v << endl; }", "23\n"],
  ["빈 stack top", H5B + "int main() { stack<int> s; cout << s.top(); }", "ERR"],
  ["deque", H5B + "#include <deque>\nint main() { deque<int> d; d.push_back(2); d.push_front(1); d.push_back(3); d.pop_front(); cout << d[0] << d.back() << d.size() << endl; }", "232\n"],
  ["auto [a, b] = pair", H5B + "int main() { pair<string, int> p = {\"점수\", 90}; auto [name, score] = p; score += 1; cout << name << score << p.second << endl; }", "점수9190\n"],
  ["stack 함수로 넘기기", H5B + "int sum(stack<int> s) { int t = 0; while (!s.empty()) { t += s.top(); s.pop(); } return t; }\nint main() { stack<int> s; s.push(1); s.push(2); cout << sum(s) << s.size() << endl; }", "32\n"],
  ["BFS 모양", H5B + "int main() { vector<vector<int>> g = {{1, 2}, {3}, {3}, {}}; vector<int> dist(4, -1); queue<int> q; q.push(0); dist[0] = 0; while (!q.empty()) { int u = q.front(); q.pop(); for (int v : g[u]) if (dist[v] < 0) { dist[v] = dist[u] + 1; q.push(v); } } for (int d : dist) cout << d; cout << endl; }", "0112\n"],
  ["map 헤더 없음", "#include <iostream>\nusing namespace std;\nint main() { map<int, int> m; }", "ERR"],
  ["for로 stack 돌기 안내", H5B + "int main() { stack<int> s; for (int x : s) {} }", "ERR"],
  ["vector 범위로 만들기, { } 돌기", H5B + "int main() { int a[] = {3, 1, 2}; vector<int> v(a, a + 3); vector<double> w(v.begin(), v.end()); int s = 0; for (int x : {1, 2, 3}) s += x; cout << v.size() << w[0] / 2 << s << endl; }", "31.56\n"],
];
for (const [name, code, want, inputs] of STAGE5B) {
  test(`C++ 5단계: ${name}`, () => {
    const r = run(code, inputs);
    if (want === "ERR") assert.equal(r.status, "error", r.out);
    else ok(code, want, inputs);
  });
}

// ---------- 앞으로의 단계: 목표 프로그램 ----------
const TODO = [
  [6, "상속, 가상 함수, 예외", `#include <iostream>
#include <stdexcept>
struct Shape { virtual double area() const = 0; virtual ~Shape() {} };
struct Sq : Shape { double s; Sq(double s) : s(s) {} double area() const override { return s * s; } };
int main() {
    Shape *p = new Sq(3);
    std::cout << p->area() << "\\n";
    delete p;
    try { throw std::runtime_error("앗"); } catch (const std::exception &e) { std::cout << e.what() << "\\n"; }
}`, "9\n앗\n"],
];

for (const [stage, name, code, want, inputs] of TODO) {
  test(`C++ ${stage}단계 목표: ${name}`, { todo: `C++ ${stage}단계에서 만들 예정` }, () => ok(code, want, inputs));
}
