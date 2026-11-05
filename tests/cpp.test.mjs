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
    ["#include <map>\nint main() {}", /<map>.*다음 단계/],
    ["#include <iostream>\nusing namespace std;\nint main() { map<int, int> m; }", /std::map.*5단계/],
    ["int main() { class A {}; }", /'class'.*3단계/],
    ["int main() { template <typename T> int x; }", /'template'.*5단계/],
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

// ---------- 앞으로의 단계: 목표 프로그램 ----------
const TODO = [
  [3, "클래스, 생성자, 소멸자", `#include <iostream>
class Counter {
    int count;
public:
    Counter() : count(0) {}
    ~Counter() { std::cout << "끝 " << count << "\\n"; }
    void add() { count++; }
};
int main() { Counter c; c.add(); c.add(); }`, "끝 2\n"],
  [4, "연산자 오버로딩", `#include <iostream>
struct V { int x, y; V operator+(const V &o) const { return {x + o.x, y + o.y}; } };
std::ostream &operator<<(std::ostream &os, const V &v) { return os << "(" << v.x << "," << v.y << ")"; }
int main() { std::cout << V{1, 2} + V{3, 4} << "\\n"; }`, "(4,6)\n"],
  [5, "템플릿과 sort", `#include <iostream>
#include <vector>
#include <algorithm>
template <typename T> T biggest(T a, T b) { return a > b ? a : b; }
int main() {
    std::vector<int> v = {3, 1, 2};
    std::sort(v.begin(), v.end());
    std::cout << v[0] << v[1] << v[2] << " " << biggest(2.5, 1.5) << "\\n";
}`, "123 2.5\n"],
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
