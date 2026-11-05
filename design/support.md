# 파이브릿지 지원 현황 (전수 검토 결과)

검토한 날: 2026-11-04. 기준: 파이썬 3.14(Pyodide 314.0.7), C11 표준 문법과 표준 라이브러리.

- ✅ 됨 (자동 테스트로 확인)
- 🟡 됨, 하지만 다른 점이 있음
- ❌ 안 됨. 쓰면 한국어로 이유를 알려 줌

## 파이썬

파이썬은 진짜 파이썬(CPython)을 웹어셈블리로 옮긴 Pyodide가 아이패드 안에서 직접 돌려요.
그래서 **문법은 모두** 진짜 파이썬과 똑같아요. 실제 브라우저(Chromium)에서 37가지를 실행해 확인했어요.

| 분류 | 내용 | 상태 |
|---|---|---|
| 기본 문법 | 변수, 연산(`//` `%` `**`), 형 변환, f-string(`{x=}` 포함), 슬라이싱, 언패킹(`a, *b = …`) | ✅ |
| 자료형 | 리스트, 튜플, 딕셔너리(`\|=`), 집합, 컴프리헨션, 제너레이터 식 | ✅ |
| 흐름 | `if` `for`/`while`…`else` `break` `continue`, `match`(구조적 패턴 매칭), `:=` | ✅ |
| 함수 | 기본값, `*args` `**kwargs`, 키워드 전용, 람다, 클로저, `nonlocal` `global`, 데코레이터, 재귀 | ✅ |
| 클래스 | 상속, `super()`, `@property`, 특수 메서드, `@classmethod` `@staticmethod`, `__slots__`, `abc` | ✅ |
| 더 나아간 기능 | 제너레이터(`yield from`, `send`), 이터레이터, `with`/`contextlib`, 타입 힌트, 3.12 제네릭 문법 | ✅ |
| 예외 | `try/except/else/finally`, `raise … from`, `except*`(예외 그룹) | ✅ |
| 비동기 | `async`/`await`, `asyncio.run`, `gather`, `create_task` | ✅ (이 앱이 직접 만든 이벤트 루프) |
| 입력 | `input()`, `sys.stdin.readline()` / `read()` / `for line in sys.stdin`, 입력 끝(EOF) 버튼 | ✅ |
| 파일 | `open`, `os`, `pathlib`. 만든 파일은 **C와 함께 써요** | ✅ |
| 표준 모듈 | `math` `random` `statistics` `collections` `itertools` `functools` `re` `json` `datetime` `time` `fractions` `decimal` `heapq` `bisect` `copy` `dataclasses` `enum` `sqlite3` 등 | ✅ |
| 외부 패키지 | `numpy`, `pandas` 같은 패키지는 `import`하면 처음 한 번 인터넷으로 받아 와요 | 🟡 처음 한 번 인터넷 필요 |
| 스레드 | `threading` | ❌ 브라우저 속 파이썬은 스레드를 만들 수 없어요 (asyncio를 쓰라고 안내) |
| 그림·창 | `turtle`, `tkinter` | ❌ 아직 없음 (안내 메시지) |

## C

C는 이 저장소에서 직접 만든 C 실행기(`docs/js/c/`)가 돌려요. 진짜 C와 같은 결과를 내면서,
배우는 사람이 자주 하는 실수(초기화 안 한 변수, 배열 범위, NULL, `free` 뒤 사용 등)를 실행 중에 잡아 줘요.
`tests/c.test.mjs`의 116개 테스트 가운데 79개가 이번 전수 검토 항목이에요.

### 문법

| 분류 | 내용 | 상태 |
|---|---|---|
| 타입 | `char` `short` `int` `long` `long long`(unsigned 포함), `float` `double`, `_Bool`/`bool` | ✅ |
| 선언 | 배열(다차원), 포인터, 이중 포인터, `int (*p)[3]`, 함수 포인터, 함수를 돌려주는 함수 포인터 | ✅ |
| 가변 길이 배열(VLA) | `int a[n][m]`, `sizeof a`, `int (*p)[m]`, 매개변수 `int a[n][m]`, 재귀 안의 VLA | ✅ |
| 구조체 등 | `struct`, `union`, 비트 필드, `typedef`, `enum`, 지정 초기화, 복합 리터럴 | ✅ |
| 저장 방식 | `static`(지역·전역·함수), `extern`, `const`(바꾸면 안내), `inline`, `volatile`, `register` | ✅ |
| 문장 | `if` `for` `while` `do` `switch`(더프의 장치 포함) `goto` `break` `continue` `return` | ✅ |
| C11 | `_Static_assert`, `_Alignof`/`_Alignas`, `_Generic`, `_Noreturn`, `[static 3]` 매개변수 | ✅ |
| 식 | 쉼표 연산자, 삼항 연산자, 16진 실수(`0x1.8p3`), 문자열 이어 붙이기, `u8"…"` | ✅ |
| 가변 인자 | `...`, `va_list` `va_start` `va_arg` `va_end` `va_copy` | ✅ |
| 전처리기 | `#include` `#define`(함수 매크로, `#`, `##`, `__VA_ARGS__`) `#if` `#ifdef` `#elif` `#error`, `__LINE__` `__FILE__` `__func__` | ✅ |
| K&R 옛날 함수 정의 | `int f(x) int x; { … }` | ❌ 요즘 방식으로 쓰라고 안내 |
| 바이트 단위로 다른 타입 읽기 | `(unsigned char *)&x` 로 `int` 한 바이트씩 읽기 | ❌ `union`을 쓰라고 안내 |

### 표준 라이브러리

| 헤더 | 되는 것 | 상태 |
|---|---|---|
| `stdio.h` | `printf`(실수 반올림까지 glibc와 같음) `scanf` `sscanf` `sprintf` `snprintf` `getchar` `putchar` `puts` `fgets` `perror`, 파일: `fopen` `fclose` `fprintf` `fscanf` `fputs` `fputc` `fgetc` `ungetc` `fread` `fwrite` `fseek` `ftell` `rewind` `feof` `remove` | ✅ |
| `stdlib.h` | `malloc` `calloc` `realloc` `free`, `atoi` `atol` `atoll` `atof` `strtol` `strtoul` `strtoll` `strtoull` `strtod` `strtof`, `abs` `div` `ldiv` `lldiv`, `rand` `srand`, `qsort` `bsearch`, `exit` `abort` `atexit` `getenv` | ✅ |
| `string.h` | `strlen` `strcpy` `strncpy` `strcat` `strncat` `strcmp` `strncmp` `strchr` `strrchr` `strstr` `strtok` `strspn` `strcspn` `strpbrk` `strdup` `strndup` `strerror`, `memset` `memcpy` `memmove` `memcmp` `memchr` | ✅ |
| `math.h` | 삼각·지수·로그·쌍곡선 함수, `pow` `sqrt` `cbrt` `hypot`, `floor` `ceil` `round` `trunc` `lround` `rint`, `fmod` `modf` `frexp` `ldexp`, `fmin` `fmax` `copysign` `fma`, `isnan` `isinf` `INFINITY` `NAN`, `float` 버전(`sqrtf` 등) | ✅ |
| `ctype.h` | `isdigit` `isalpha` `isalnum` `isspace` `isupper` `islower` `isxdigit` `isprint` `iscntrl` `isgraph` `isblank` `ispunct` `toupper` `tolower` | ✅ |
| `time.h` | `time` `clock` `difftime`, `struct tm`, `gmtime` `localtime` `mktime` `strftime` `asctime` `ctime` | ✅ |
| 그 밖의 헤더 | `stdbool.h` `stdint.h` `inttypes.h`(`PRId64` 등) `limits.h` `float.h` `stddef.h`(`offsetof`) `stdarg.h` `assert.h` `errno.h` `setjmp.h` `iso646.h` | ✅ |
| `system()` | 다른 프로그램 실행 | ❌ 아이패드 브라우저에서는 불가능 (안내) |
| `complex.h`, `wchar.h` | 복소수, 넓은 글자 | ❌ 아직 없음 (안내) |

## C++ (단계별로 만드는 중)

C++은 C 실행기 위에 쌓아요. 순서는 [`cpp-plan.md`](cpp-plan.md)에 있어요.

| 단계 | 내용 | 상태 |
|---|---|---|
| 0 | C 방식 코드, `<cstdio>` 같은 헤더, `bool` `nullptr`, 구조체 이름을 바로 타입으로, `void*` 규칙 | ✅ |
| 1 | `cout` `cin` `cerr`, `endl`, `using namespace std`, `<iomanip>`(`setw` `setprecision` `setfill` `fixed`), `while (cin >> x)`, `cin.get`/`ignore`/`fail`/`clear`, `std::min`/`max` | ✅ |
| 2 | 참조, 오버로딩, 기본 인자, `new`/`delete`, `auto`, `constexpr`, 캐스트, 범위 기반 `for`, 이름공간, `std::string`, `std::vector`, `getline`, `to_string`/`stoi` | ✅ |
| 3–6 | 클래스, 연산자 오버로딩, 템플릿과 STL, 상속·가상 함수·예외 | ❌ 준비 중 (단계 안내) |

### 진짜 C와 다른 점

- 메모리를 바이트가 아니라 "값 칸"으로 관리해요. 그래서 범위 밖 접근, 해제 후 사용 같은 실수를 정확히 잡지만,
  같은 메모리를 다른 타입 포인터로 바이트 단위로 읽는 코드는 지원하지 않아요(`union`, `memcpy`, `fwrite`는 돼요).
- `setjmp`는 문장 맨 바깥(`if (setjmp(b))`, `int r = setjmp(b);` 등)에서 써야 해요.
- 파일은 앱 안의 가상 파일이에요. 파이썬에서 만든 파일을 C에서 읽을 수 있고, 반대도 돼요.

## 다시 확인하는 방법

```bash
python3 -m unittest discover -s tests       # 파이썬 실행기
node --test tests/c.test.mjs                # C 실행기 (전수 검토 항목 포함)
node --test --test-concurrency=1 tests/e2e.test.mjs   # 실제 브라우저
```
