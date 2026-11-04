// C++ 모드 테스트: node --test tests/cpp.test.mjs
// 지금 되는 것(0단계)은 보통 테스트, 앞으로 만들 단계의 목표 프로그램은 todo 테스트예요 (design/cpp-plan.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { runC } from "../docs/js/c/index.js";

function run(code, inputs = []) {
  const answers = [];
  let out = "";
  for (let round = 0; round < 50; round++) {
    out = "";
    const r = runC(code, { dialect: "cpp", answers: [...answers], startTime: 1700000000, onOutput: (t) => (out += t) });
    if (r.status !== "waiting") return { ...r, out };
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
    ["#include <iostream>\nint main() {}", /<iostream>.*다음 단계/],
    ["int main() { class A {}; }", /'class'.*3단계/],
    ["int main() { int *p = new int; }", /'new'.*2단계/],
    ["int main() { auto x = 1; }", /'auto'.*2단계/],
    ["int f(); int main() { return ::f(); }", /:: .*2단계/],
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

// ---------- 앞으로의 단계: 목표 프로그램 ----------
const TODO = [
  [1, "cout과 cin", `#include <iostream>
using namespace std;
int main() {
    int a, b;
    cin >> a >> b;
    cout << "합: " << a + b << endl;
}`, "합: 7\n", ["3 4"]],
  [2, "참조와 오버로딩, 기본 인자", `#include <cstdio>
void twice(int &x) { x *= 2; }
int area(int w, int h = 1) { return w * h; }
double area(double r) { return 3.0 * r * r; }
int main() { int n = 5; twice(n); printf("%d %d %.1f\\n", n, area(4), area(1.0)); }`, "10 4 3.0\n"],
  [2, "new/delete와 string, vector", `#include <iostream>
#include <string>
#include <vector>
int main() {
    int *p = new int(7);
    std::vector<std::string> names = {"민지", "철수"};
    names.push_back("영희");
    for (const auto &n : names) std::cout << n << " ";
    std::cout << *p << "\\n";
    delete p;
}`, "민지 철수 영희 7\n"],
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
