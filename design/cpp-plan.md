# C++ 도입 계획

목표: 아이패드에서 C++을 실행하고, 나중에는 **파이썬 ↔ C ↔ C++ 변환**까지 하는 것.
방법: 이미 만든 C 실행기(`docs/js/c/`) 위에 C++ 기능을 한 단계씩 쌓아요.
C++ 코드의 대부분은 C 문법이라서, 단단한 C 실행기가 가장 좋은 출발점이에요.

## 지금까지 준비한 것 (0단계: 뼈대)

| 무엇 | 어디 |
|---|---|
| 언어 모드: `runC(code, { dialect: "cpp" })` | `js/c/index.js` → lexer, parser, compile 모두 `dialect`를 받아요 |
| C 헤더의 C++ 이름: `<cstdio>` `<cstring>` `<cmath>` `<cstdlib>` 등 | `js/c/lexer.js` `CPP_C_HEADERS` |
| `bool` `true` `false`(헤더 없이), `nullptr`, `__cplusplus` | lexer, compile |
| `struct Node { … }; Node n;` 처럼 구조체·enum 이름을 바로 타입으로 | `js/c/parser.js` `cppTagName` |
| C++ 규칙: `void*`를 다른 포인터에 그냥 넣으면 오류 | `js/c/compile.js` `conv` |
| 아직 없는 기능은 "몇 단계에서 지원" 안내 (`class`, `new`, `string`, `<vector>` …) | lexer `CPP_PENDING`, `CPP_LIBRARY_HEADERS` |
| 앱: `cpp` 언어, C++ 색칠, C 엔진 워커 공유 | `js/app.js`, `js/engine.js`, `c-worker.js`, `js/highlight.js` |
| 단계별 목표 프로그램 테스트 (아직 안 되는 것은 `todo`) | `tests/cpp.test.mjs` |

## 단계

각 단계는 `tests/cpp.test.mjs`의 `todo` 테스트를 통과시키면 끝나요.

1. ✅ **입출력 `iostream`** (끝남): `cout << a << endl;`, `cin >> a >> b;`, `while (cin >> x)`,
   `using namespace std;` / `using std::cout;` / `std::cout`, `cerr`,
   조작자 `endl` `fixed` `scientific` `boolalpha` `showpoint` `showpos` `hex` `dec` `left` `right`,
   `<iomanip>`의 `setprecision` `setw` `setfill`, `cin.get` `peek` `ignore` `fail` `eof` `good` `clear`,
   `cout.put` `precision` `width`, `std::min` `std::max`, `<bits/stdc++.h>`.
   C++답게 비교 결과는 `bool`, `'a'`는 `char`예요. 출력 규칙(실수 6자리, char는 글자)은 진짜 C++과 같아요.
   실행: `js/c/runtime.js`의 `streamPut`/`streamGet`, 컴파일: `js/c/compile.js`의 `streamOp`.
2. ✅ **C++다운 기본기** (끝남): 참조(변수, 매개변수, 돌려주는 값, `const T&`에 임시 값),
   기본 인자(선언에만 적어도 돼요), 오버로딩(C++처럼 가장 잘 맞는 함수를 고르고, 애매하면 알려 줘요),
   `new`/`new[]`/`delete`/`delete[]`(짝이 틀리거나 두 번 지우면 알려 줘요), `auto`, `auto&`, `constexpr`,
   `const int N = 10; int a[N];`, `static_cast`, 범위 기반 `for`, 이름공간(`namespace`, `geo::f`, `using namespace geo`),
   `std::swap`/`min`/`max`, `int x(5)`, `int x{5}`, `Point{1, 2}`.
   **`std::string`**: `+` `+=` 비교, `[]`, `size` `substr` `find` `rfind` `insert` `erase` `replace` `c_str` `push_back` …,
   `cin >>`, `getline`, `to_string`, `stoi`/`stod`. **`std::vector`**: `{1, 2, 3}`, `(n)`, `(n, 값)`, `push_back`
   `pop_back` `size` `back` `front` `at` `resize` `insert` `erase` `clear` `begin`/`end`(반복자), `vector<vector<int>>`,
   `vector<string>`, 구조체 원소. 값으로 넘기면 복사되고, 범위를 벗어나면 친절하게 알려 줘요.
   만든 곳: string/vector 값은 `js/c/runtime.js`의 `newString`/`newVector`(값 하나 = Store 하나, 읽을 때 복사),
   컴파일은 `js/c/compile.js`의 `objectValue`/`objMethod`/`objIndex`/`objBinary`.
3. ✅ **클래스** (끝남): `class`/`struct`의 멤버 함수, `this`, 생성자(초기화 목록, 오버로딩, 기본 인자, `explicit`,
   `= default`), 기본 멤버 값(`int count = 0;`), 소멸자(블록이 끝날 때, `delete`, 프로그램이 끝날 때 거꾸로 불러요.
   `return 지역객체;`는 진짜 C++처럼 복사를 생략해요), `public`/`private`/`protected` 검사, `const` 멤버 함수와 const 객체 검사,
   `static` 멤버 변수(클래스 밖 정의를 빠뜨리면 알려 줘요)와 함수, 클래스 밖 정의(`int A::get() const { … }`, `A::A(…) : … { }`,
   `A::~A()`), 객체 배열, `vector<클래스>`, 멤버 객체, 이름공간 안의 클래스, `Counter(5)` 같은 이름 없는 객체.
   아직 아닌 것: 사용자 복사 생성자·복사 대입(지금은 멤버를 그대로 복사해요), 이름 없는 임시 객체의 소멸자, `friend`(4단계).
   만든 곳: `js/c/parser.js`의 `classBody`, `js/c/compile.js`의 `registerClasses`/`classInit`/`methodCall`/`ctorPrologue`/`destroyFn`.
4. **연산자 오버로딩**: `operator+`, `operator==`, `operator<<`(cout으로 출력)
5. **템플릿**: 함수 템플릿과 클래스 템플릿을 쓰는 타입마다 다시 컴파일(인스턴스화)해요.
   `std::vector<T>`, `std::pair`, `std::map`, `std::sort` 같은 STL을 이 위에 만들어요.
6. **상속과 가상 함수, 예외**: `virtual`(객체마다 함수 표), `try`/`catch`/`throw`(JS 예외로 전달)

## 변환으로 가는 길

C, C++ 모두 같은 구문 트리(AST)를 쓰고, 파이썬은 Pyodide의 `ast` 모듈로 구문 트리를 얻을 수 있어요.
그래서 변환은 "구문 트리 → 다른 언어 코드"로 만들어요. 쉬운 것(변수, 조건, 반복, 함수, 배열/리스트)부터 시작해서,
타입은 실행 기록(변수 탭의 타입 정보)을 이용해 정해요.
