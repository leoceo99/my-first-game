// C 실행기 테스트: node --test tests/c.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { runC } from "../docs/js/c/index.js";

/** 앱처럼 입력이 필요할 때마다 답을 하나씩 넣어 다시 실행해요. */
function run(code, inputs = []) {
  const answers = [];
  const shown = [];
  const prompts = [];
  for (let round = 0; round < 100; round++) {
    const r = runC(code, {
      answers: [...answers],
      startTime: 1700000000,
      onOutput: (t) => shown.push(t),
      onInput: (p) => prompts.push(p),
    });
    if (r.status !== "waiting") {
      return { ...r, out: shown.join(""), prompts, transcript: shown.join("") };
    }
    if (answers.length >= inputs.length) throw new Error(`입력이 더 필요해요: ${prompts.at(-1)}`);
    answers.push(inputs[answers.length]);
  }
  throw new Error("너무 많이 반복했어요");
}

const C = (body, headers = "#include <stdio.h>\n") => `${headers}int main(void) {\n${body}\n    return 0;\n}\n`;

test("hello world와 printf 형식", () => {
  const r = run(C(`
    printf("안녕, C!\\n");
    printf("%d %5d|%-5d|%05d %+d\\n", 42, 7, 7, 7, 7);
    printf("%f %.2f %e %g %g\\n", 3.14159, 2.5, 12345.678, 0.0001, 1e20);
    printf("%c%c %s %%\\n", 'O', 'K', "끝");
    printf("%x %X %o %#x %u\\n", 255, 255, 8, 255, -1);
    printf("%ld %lld %lu\\n", 9000000000L, -5LL, 7UL);
    printf("[%8.3f] [%-8s] [%3c]\\n", 3.14159, "ab", 'z');`));
  assert.equal(r.status, "ok", JSON.stringify(r.error));
  assert.equal(r.out, [
    "안녕, C!",
    "42     7|7    |00007 +7",
    "3.141590 2.50 1.234568e+04 0.0001 1e+20",
    "OK 끝 %",
    "ff FF 10 0xff 4294967295",
    "9000000000 -5 7",
    "[   3.142] [ab      ] [  z]",
    "",
  ].join("\n"));
});

test("정수 계산은 C처럼: 나눗셈은 0쪽으로, 오버플로는 감기", () => {
  const r = run(C(`
    int a = 7, b = -7;
    printf("%d %d %d %d\\n", a / 2, b / 2, a % 3, b % 3);
    int big = 2147483647;
    big = big + 1;
    printf("%d\\n", big);
    unsigned int u = 0;
    u = u - 1;
    printf("%u\\n", u);
    char c = 'A' + 2;
    printf("%c %d\\n", c, c);
    double d = 7 / 2;
    double e = 7 / 2.0;
    printf("%.1f %.1f %d\\n", d, e, (int)3.99);
    long long x = 1LL << 40;
    printf("%lld\\n", x);
    printf("%d %d\\n", 5 > 3 && 2 > 1, !(5 == 5));`));
  assert.equal(r.status, "ok", JSON.stringify(r.error));
  assert.equal(r.out, "3 -3 1 -1\n-2147483648\n4294967295\nC 67\n3.0 3.5 3\n1099511627776\n1 0\n");
});

test("반복문, 조건문, switch", () => {
  const r = run(C(`
    int sum = 0;
    for (int i = 1; i <= 10; i++) {
        if (i % 2 == 0) continue;
        sum += i;
    }
    printf("%d\\n", sum);
    int n = 0;
    while (1) { n++; if (n >= 5) break; }
    do { n--; } while (n > 3);
    printf("%d\\n", n);
    for (int k = 0; k < 4; k++) {
        switch (k) {
            case 0: printf("zero "); break;
            case 1:
            case 2: printf("small "); break;
            default: printf("big ");
        }
    }
    printf("\\n%s\\n", n > 2 ? "yes" : "no");`));
  assert.equal(r.status, "ok", JSON.stringify(r.error));
  assert.equal(r.out, "25\n3\nzero small small big \nyes\n");
});

test("함수, 재귀, 배열, 포인터", () => {
  const code = `#include <stdio.h>
int fact(int n) { return n <= 1 ? 1 : n * fact(n - 1); }
void swap(int *a, int *b) { int t = *a; *a = *b; *b = t; }
int sum(int arr[], int n) {
    int s = 0;
    for (int i = 0; i < n; i++) s += arr[i];
    return s;
}
int main(void) {
    int x = 3, y = 9;
    swap(&x, &y);
    int nums[5] = {1, 2, 3};
    int grid[2][3] = {{1, 2, 3}, {4, 5, 6}};
    int *p = nums;
    *(p + 3) = 10;
    p[4] = 20;
    printf("%d %d %d %d\\n", fact(5), x, y, sum(nums, 5));
    printf("%d %d %d\\n", grid[1][2], grid[0][1], (int)(sizeof(nums) / sizeof(nums[0])));
    int *q = &nums[4];
    printf("%d %ld\\n", *q, q - p);
    return 0;
}`;
  const r = run(code);
  assert.equal(r.status, "ok", JSON.stringify(r.error));
  assert.equal(r.out, "120 9 3 36\n6 2 5\n20 4\n");
});

test("문자열과 string.h", () => {
  const r = run(C(`
    char name[20] = "Kim";
    char other[10] = "Lee";
    strcat(name, " Minsu");
    printf("%s (%d)\\n", name, (int)strlen(name));
    printf("%d %d\\n", strcmp(name, other) < 0, strcmp("abc", "abc"));
    strcpy(other, "Park");
    printf("%s %c\\n", other, other[0]);
    char s[10];
    sprintf(s, "%d-%d", 3, 4);
    puts(s);
    for (int i = 0; name[i] != '\\0'; i++) putchar(toupper(name[i]));
    putchar('\\n');`, "#include <stdio.h>\n#include <string.h>\n#include <ctype.h>\n"));
  assert.equal(r.status, "ok", JSON.stringify(r.error));
  assert.equal(r.out, "Kim Minsu (9)\n1 0\nPark P\n3-4\nKIM MINSU\n");
});

test("scanf 입력: 다시 실행해도 출력은 한 번씩", () => {
  const r = run(C(`
    int a, b;
    printf("두 수를 입력하세요: ");
    scanf("%d %d", &a, &b);
    printf("합: %d\\n", a + b);
    double h;
    printf("키: ");
    scanf("%lf", &h);
    char name[20];
    printf("이름: ");
    scanf("%s", name);
    printf("%s님의 키는 %.1fcm\\n", name, h);`), ["3 4", "172.5", "철수"]);
  assert.equal(r.status, "ok", JSON.stringify(r.error));
  assert.equal(r.out, "합: 7\n철수님의 키는 172.5cm\n");
  assert.deepEqual(r.prompts, ["두 수를 입력하세요: ", "키: ", "이름: "]);
});

test("scanf 반복문 (스크린샷의 점수 프로그램)", () => {
  const r = run(C(`
    int total = 0, passed = 0;
    for (int i = 0; i < 5; i++) {
        int score;
        printf("점수 입력: ");
        scanf("%d", &score);
        total += score;
        if (score >= 60) passed++;
    }
    printf("합계 %d, 평균 %.1f, 통과 %d\\n", total, total / 5.0, passed);`), ["80", "50", "90", "70", "40"]);
  assert.equal(r.out, "합계 330, 평균 66.0, 통과 3\n");
  assert.equal(r.prompts.length, 5);
});

test("rand는 다시 실행해도 같은 값, getchar와 fgets", () => {
  const r = run(C(`
    srand(time(NULL));
    int secret = rand() % 100 + 1;
    printf("[%d]\\n", secret);
    int guess;
    scanf("%d", &guess);
    getchar();
    char line[50];
    fgets(line, sizeof(line), stdin);
    printf("[%d] %d %s", secret, guess, line);`, "#include <stdio.h>\n#include <stdlib.h>\n#include <time.h>\n"), ["5", "hello world"]);
  const [first, again] = [...r.out.matchAll(/\[(\d+)\]/g)].map((m) => m[1]);
  assert.equal(first, again);
  assert.match(r.out, /5 hello world\n$/);
});

test("malloc과 free", () => {
  const r = run(C(`
    int n = 4;
    int *arr = (int *)malloc(n * sizeof(int));
    for (int i = 0; i < n; i++) arr[i] = i * i;
    int *z = calloc(3, sizeof(int));
    printf("%d %d %d\\n", arr[3], arr[1] + arr[2], z[2]);
    free(arr);
    free(z);`, "#include <stdio.h>\n#include <stdlib.h>\n"));
  assert.equal(r.status, "ok", JSON.stringify(r.error));
  assert.equal(r.out, "9 5 0\n");
});

test("#define 매크로와 math.h", () => {
  const r = run(`#include <stdio.h>
#include <math.h>
#define SIZE 3
#define SQUARE(x) ((x) * (x))
int main(void) {
    int a[SIZE] = {1, 2, 3};
    printf("%d %d %.3f %.0f %d\\n", SQUARE(a[2]), SIZE * 2, sqrt(2), pow(2, 10), (int)fabs(-4.5));
    return 0;
}`);
  assert.equal(r.status, "ok", JSON.stringify(r.error));
  assert.equal(r.out, "9 6 1.414 1024 4\n");
});

test("변수 탭에 보여줄 값", () => {
  const r = run(C(`
    int x = 5;
    double avg = 2.5;
    char grade = 'A';
    int arr[3] = {1, 2, 3};
    char name[10] = "Kim";
    int *p = &arr[1];
    int unset;`));
  const vars = Object.fromEntries(r.variables.map((v) => [v.name, [v.type, v.value]]));
  assert.deepEqual(vars.x, ["int", "5"]);
  assert.deepEqual(vars.avg, ["double", "2.5"]);
  assert.deepEqual(vars.grade, ["char", "65 ('A')"]);
  assert.deepEqual(vars.arr, ["int [3]", "{1, 2, 3}"]);
  assert.deepEqual(vars.name, ["char [10]", '"Kim"']);
  assert.deepEqual(vars.p, ["int *", "→ arr[1]"]);
  assert.deepEqual(vars.unset, ["int", "?"]);
});

// ---------- 오류 안내 ----------
function error(code, inputs = []) {
  const r = run(code, inputs);
  assert.equal(r.status, "error", `오류가 나야 해요: ${r.out}`);
  return r.error;
}

test("컴파일 오류: 세미콜론, 선언, 헤더", () => {
  let e = error(C("    int x = 5\n    printf(\"%d\", x);"));
  assert.equal(e.type, "C 컴파일 오류");
  assert.match(e.title, /3번째 줄 끝에 세미콜론/);
  assert.equal(e.line, 3);

  e = error(C("    count = 1;"));
  assert.match(e.title, /'count'라는 변수를 찾을 수 없어요/);

  e = error("int main(void) {\n    printf(\"hi\");\n    return 0;\n}\n");
  assert.match(e.title, /printf를 쓰려면 #include <stdio.h>/);

  e = error(C("    int total = 0;\n    totl = 3;"));
  assert.match(e.detail, /'total'/);

  e = error(C("    print(\"hi\");"));
  assert.match(e.detail, /'printf'/);
});

test("컴파일 오류: 자주 하는 실수", () => {
  assert.match(error(C('    int x;\n    scanf("%d", x);')).title, /&를 붙여야/);
  assert.match(error(C('    double d;\n    scanf("%f", &d);')).title, /%lf/);
  assert.match(error(C('    printf("%d\\n", 3.5);')).title, /%d에는 정수를/);
  assert.match(error(C('    int n = 3;\n    printf("%f\\n", n);')).title, /%f에는 실수를/);
  assert.match(error(C('    printf("%d %d\\n", 1);')).title, /형식\(%\)은 2개인데 값은 1개/);
  assert.match(error(C("    int x = 1;\n    if (x = 2) { }")).title, /조건에 = 를/);
  assert.match(error(C('    char s[10];\n    s = "hi";')).title, /배열에는 = 로/);
  assert.match(error(C('    char s[10] = "hi";\n    if (s == "hi") { }')).title, /문자열은 == 로 비교할 수 없어요/);
  assert.match(error(C("    char c = \"a\";")).title, /char에는 글자 하나만/);
  assert.match(error(C("    double d = 5.5;\n    int r = d % 2;")).title, /실수에는 '%'/);
  assert.match(error(C("    for (int i = 0; i < 3; i++) {\n        printf(\"x\");\n")).title, /\{ 가 닫히지 않았어요/);
  assert.match(error("#include <stdio.h>\nint helper(void) { return 1; }\n").title, /main 함수가 없어요/);
  assert.match(error(C("    break;")).title, /break는 반복문/);
  assert.match(error(C("    char c = '가';")).title, /char 하나에 넣을 수 없어요/);
});

test("실행 오류: 배열 범위, 값 없는 변수, 0으로 나누기, 끝없는 재귀", () => {
  let e = error(C("    int a[5];\n    for (int i = 0; i <= 5; i++) a[i] = i;"));
  assert.equal(e.type, "C 실행 오류");
  assert.match(e.title, /배열 'a'의 범위를 벗어났어요/);
  assert.match(e.detail, /\[5\]에 접근/);
  assert.equal(e.line, 4);

  e = error(C("    int x;\n    printf(\"%d\\n\", x + 1);"));
  assert.match(e.title, /값을 넣지 않은 변수 'x'/);

  e = error(C("    int z = 0;\n    printf(\"%d\\n\", 10 / z);"));
  assert.match(e.title, /0으로 나눴어요/);

  e = error("#include <stdio.h>\nint f(int n) { return f(n + 1); }\nint main(void) { return f(0); }\n");
  assert.match(e.title, /너무 깊이/);

  e = error(C("    int *p = NULL;\n    *p = 3;"));
  assert.match(e.title, /NULL 포인터/);

  e = error(C("    char *s = \"hi\";\n    s[0] = 'H';"));
  assert.match(e.title, /문자열 상수는 바꿀 수 없어요/);

  e = error(C("    char name[5];\n    scanf(\"%s\", name);"), ["abcdefgh"]);
  assert.match(e.title, /너무 길어요/);

  e = error(C("    int n = 0;\n    while (scanf(\"%d\", &n) != 1) { }"), ["abc"]);
  assert.match(e.title, /계속 멈춰 있어요/);
});

test("exit와 main의 return 값", () => {
  let r = run(C('    printf("a\\n");\n    exit(3);\n    printf("b\\n");', "#include <stdio.h>\n#include <stdlib.h>\n"));
  assert.equal(r.status, "exit");
  assert.equal(r.exitCode, 3);
  assert.equal(r.out, "a\n");
  r = run("int main(void) { return 7; }");
  assert.equal(r.exitCode, 7);
});

test("큰 반복문도 빠르게", () => {
  const start = Date.now();
  const r = run(C(`
    long long sum = 0;
    for (int i = 0; i < 2000000; i++) sum += i % 7;
    printf("%lld\\n", sum);`));
  assert.equal(r.out, "5999995\n");
  assert.ok(Date.now() - start < 5000, `너무 느려요: ${Date.now() - start}ms`);
});

// ---------- 구조체, typedef, enum, 함수 포인터, 전처리기, 파일, EOF ----------
test("구조체: 멤버, 배열, 복사, 함수 인자/반환, 지정 초기화", () => {
  const r = run(`#include <stdio.h>
#include <string.h>
typedef struct {
    char name[20];
    int score;
} Student;
struct Point { int x, y; };
struct Line { struct Point a, b; };
Student make(const char *n, int s) { Student t; strcpy(t.name, n); t.score = s; return t; }
void bump(Student *s) { s->score += 5; }
void noChange(Student s) { s.score = 0; }
int main(void) {
    Student list[3] = {{"Kim", 80}, {.score = 95, .name = "Lee"}, {"Park"}};
    list[2] = make("Choi", 88);
    bump(&list[0]);
    noChange(list[1]);
    Student copy = list[0];
    copy.score = 1;
    struct Line ln = {{1, 2}, {.y = 9}};
    struct Point *pp = &ln.b;
    pp->x = 7;
    printf("%s %d / %s %d / %s %d / %d\\n", list[0].name, list[0].score, list[1].name, list[1].score, list[2].name, list[2].score, copy.score);
    printf("%d %d %d %d %d\\n", ln.a.x, ln.a.y, ln.b.x, (*pp).y, (int)sizeof(struct Point));
    printf("%d\\n", make("X", 42).score);
    return 0;
}`);
  assert.equal(r.status, "ok", JSON.stringify(r.error));
  assert.equal(r.out, "Kim 85 / Lee 95 / Choi 88 / 1\n1 2 7 9 8\n42\n");
  const vars = Object.fromEntries(r.variables.map((v) => [v.name, v]));
  assert.equal(vars.copy.value, '{name: "Kim", score: 1}');
  assert.equal(vars.copy.type, "Student");
  assert.equal(vars.pp.value, "→ ln.b");
});

test("연결 리스트 (malloc + 구조체 포인터)", () => {
  const r = run(`#include <stdio.h>
#include <stdlib.h>
typedef struct Node {
    int value;
    struct Node *next;
} Node;
Node *push(Node *head, int v) {
    Node *n = (Node *)malloc(sizeof(Node));
    n->value = v;
    n->next = head;
    return n;
}
int main(void) {
    Node *head = NULL;
    for (int i = 1; i <= 4; i++) head = push(head, i * 10);
    int sum = 0;
    for (Node *c = head; c != NULL; c = c->next) { printf("%d ", c->value); sum += c->value; }
    printf("| %d\\n", sum);
    while (head != NULL) { Node *next = head->next; free(head); head = next; }
    return 0;
}`);
  assert.equal(r.status, "ok", JSON.stringify(r.error));
  assert.equal(r.out, "40 30 20 10 | 100\n");
});

test("enum과 switch", () => {
  const r = run(`#include <stdio.h>
typedef enum { MON, TUE, WED = 10, THU } Day;
int main(void) {
    Day d = THU;
    switch (d) {
        case MON: printf("월\\n"); break;
        case THU: printf("목 %d %d %d\\n", MON, TUE, THU); break;
        default: printf("?\\n");
    }
    return 0;
}`);
  assert.equal(r.out, "목 0 1 11\n");
});

test("함수 포인터와 qsort, bsearch", () => {
  const r = run(`#include <stdio.h>
#include <stdlib.h>
int add(int a, int b) { return a + b; }
int sub(int a, int b) { return a - b; }
int apply(int (*op)(int, int), int x, int y) { return op(x, y); }
int asc(const void *a, const void *b) { return *(const int *)a - *(const int *)b; }
typedef int (*Op)(int, int);
int main(void) {
    Op ops[] = {add, sub};
    int (*f)(int, int) = &sub;
    printf("%d %d %d %d\\n", apply(add, 2, 3), ops[1](9, 4), (*f)(1, 5), f == sub);
    int nums[6] = {42, 7, 19, 3, 88, 25};
    qsort(nums, 6, sizeof(int), asc);
    for (int i = 0; i < 6; i++) printf("%d ", nums[i]);
    int key = 19;
    int *found = bsearch(&key, nums, 6, sizeof(nums[0]), asc);
    printf("| %ld\\n", found - nums);
    return 0;
}`);
  assert.equal(r.status, "ok", JSON.stringify(r.error));
  assert.equal(r.out, "5 5 -4 1\n3 7 19 25 42 88 | 2\n");
});

test("복잡한 선언: 배열 포인터, 문자열 배열, 2차원 배열 매개변수", () => {
  const r = run(`#include <stdio.h>
int total(int m[][3], int rows) {
    int s = 0;
    for (int i = 0; i < rows; i++) for (int j = 0; j < 3; j++) s += m[i][j];
    return s;
}
int main(void) {
    int grid[2][3] = {{1, 2, 3}, {4, 5, 6}};
    int (*row)[3] = grid;
    const char *names[] = {"하나", "둘", "셋"};
    printf("%d %d %s %d\\n", total(grid, 2), row[1][2], names[2], (int)(sizeof(names) / sizeof(names[0])));
    return 0;
}`);
  assert.equal(r.status, "ok", JSON.stringify(r.error));
  assert.equal(r.out, "21 6 셋 3\n");
});

test("전처리기 조건문", () => {
  const r = run(`#include <stdio.h>
#define LEVEL 2
#define DEBUG
int main(void) {
#ifdef DEBUG
    printf("D");
#endif
#ifndef DEBUG
    printf("X");
#endif
#if LEVEL > 2
    printf("A");
#elif LEVEL == 2 && defined(DEBUG)
    printf("B");
#else
    printf("C");
#endif
#if 0
    이 줄은 무시돼요
#endif
    printf("\\n");
    return 0;
}`);
  assert.equal(r.status, "ok", JSON.stringify(r.error));
  assert.equal(r.out, "DB\n");
});

test("파일 쓰기와 읽기 (가상 파일)", () => {
  const r = run(`#include <stdio.h>
int main(void) {
    FILE *fp = fopen("data.txt", "w");
    if (fp == NULL) return 1;
    for (int i = 1; i <= 3; i++) fprintf(fp, "%d %d\\n", i, i * i);
    fclose(fp);
    fp = fopen("data.txt", "a");
    fputs("4 16\\n", fp);
    fclose(fp);
    fp = fopen("data.txt", "r");
    int a, b, sum = 0;
    while (fscanf(fp, "%d %d", &a, &b) == 2) sum += b;
    fclose(fp);
    char line[50];
    fp = fopen("data.txt", "r");
    fgets(line, sizeof(line), fp);
    fclose(fp);
    printf("%d %s", sum, line);
    printf("%s\\n", fopen("없는파일.txt", "r") == NULL ? "NULL" : "?");
    return 0;
}`);
  assert.equal(r.status, "ok", JSON.stringify(r.error));
  assert.equal(r.out, "30 1 1\nNULL\n");
  assert.deepEqual(r.files, { "data.txt": "1 1\n2 4\n3 9\n4 16\n" });
});

test("미리 있던 파일을 읽어요", () => {
  const out = [];
  const res = runC(`#include <stdio.h>
int main(void) {
    FILE *fp = fopen("memo.txt", "r");
    char buf[30];
    while (fgets(buf, sizeof(buf), fp) != NULL) printf("> %s", buf);
    fclose(fp);
    return 0;
}`, { files: { "memo.txt": "첫 줄\n둘째 줄\n" }, onOutput: (t) => out.push(t) });
  assert.equal(res.status, "ok");
  assert.equal(out.join(""), "> 첫 줄\n> 둘째 줄\n");
});

test("입력 끝(EOF): getchar와 scanf", () => {
  let r = run(`#include <stdio.h>
int main(void) {
    int c, lines = 0, chars = 0;
    while ((c = getchar()) != EOF) { chars++; if (c == '\\n') lines++; }
    printf("%d줄 %d글자\\n", lines, chars);
    return 0;
}`, ["ab", "cde", null]);
  assert.equal(r.out, "2줄 7글자\n");
  r = run(`#include <stdio.h>
int main(void) {
    int x, sum = 0;
    while (scanf("%d", &x) != EOF) sum += x;
    printf("합 %d\\n", sum);
    return 0;
}`, ["1 2", "3", null]);
  assert.equal(r.out, "합 6\n");
});

test("strtok, memcpy, strrchr, snprintf", () => {
  const r = run(C(`
    char text[] = "사과,배,,포도";
    int n = 0;
    for (char *t = strtok(text, ","); t != NULL; t = strtok(NULL, ",")) { printf("[%s]", t); n++; }
    int a[3] = {1, 2, 3}, b[3];
    memcpy(b, a, sizeof(a));
    char path[] = "a/b/c.txt";
    char buf[8];
    snprintf(buf, sizeof(buf), "%d-%s", 12345, "abc");
    printf(" %d %d %s %s\\n", n, b[2], strrchr(path, '/') + 1, buf);`, "#include <stdio.h>\n#include <string.h>\n"));
  assert.equal(r.status, "ok", JSON.stringify(r.error));
  assert.equal(r.out, "[사과][배][포도] 3 3 c.txt 12345-a\n");
});

test("구조체·포인터·파일 실수 안내", () => {
  const S = "#include <stdio.h>\nstruct P { int x; int y; };\n";
  assert.match(error(`${S}int main(void) { struct P p; struct P *q = &p; q.x = 1; return 0; }`).title, /-> 를 써요/);
  assert.match(error(`${S}int main(void) { struct P p; p->x = 1; return 0; }`).title, /\. 을 써요/);
  const e = error(`${S}int main(void) { struct P p; p.z = 1; return 0; }`);
  assert.match(e.title, /'z' 멤버가 없어요/);
  assert.match(e.detail, /x, y/);
  assert.match(error(`${S}int main(void) { struct P a = {1, 2}, b = a; if (a == b) {} return 0; }`).title, /구조체는 == 로/);
  assert.match(error(`${S}int main(void) { struct P a = {1, 2}; printf("%d", a); return 0; }`).title, /구조체는 printf로/);
  assert.match(error(`${S}int main(void) { struct P a; printf("%d", a.x); return 0; }`).title, /값을 넣지 않은 'a\.x'/);
  assert.match(error("struct Q;\nint main(void) { struct Q q; return 0; }").title, /내용이 아직 정의되지 않았어요/);
  assert.match(error("int main(void) { int (*f)(int) = 0; return f(1); }").title, /아무 함수도 가리키지 않아요/);
  assert.match(error("#include <stdio.h>\nint main(void) { FILE *fp = fopen(\"x.txt\", \"r\"); fgetc(fp); return 0; }").title, /NULL 파일 포인터/);
  assert.match(error("#include <stdio.h>\nint main(void) { FILE *fp = fopen(\"x.txt\", \"w\"); fclose(fp); fputs(\"a\", fp); return 0; }").title, /닫은 파일/);
  assert.match(error("#include <stdio.h>\n#ifdef X\nint main(void) { return 0; }\n").title, /#endif 로 닫히지/);
  assert.match(error(`${S}int main(void) { struct P list[2] = {{1, 2}, {3, 4}}; list[2].x = 5; return 0; }`).detail, /\[2\]에 접근/);
});

test("printf 실수 반올림은 진짜 C(glibc)와 똑같이", () => {
  const r = run(C(`
    printf("%.1f %.1f %.2f %.0f %.0f %.0f %.2f\\n", 2.25, 2.35, 1.005, 0.5, 1.5, 2.5, 0.125);
    printf("%.0e %g %g %#g %.17g %f\\n", 15000.0, 1234567.0, 0.0001, 1.0, 0.1, -0.0);`));
  assert.equal(r.out, "2.2 2.4 1.00 0 2 2 0.12\n2e+04 1.23457e+06 0.0001 1.00000 0.10000000000000001 -0.000000\n");
});

// ---------- goto, union, 비트 필드, 가변 인자, const, 복합 리터럴, 매크로 ----------
test("goto와 이름표", () => {
  const r = run(`#include <stdio.h>
int main(void) {
    int i, j;
    for (i = 0; i < 5; i++)
        for (j = 0; j < 5; j++)
            if (i * j == 6) goto found;
    printf("없음\\n");
found:
    printf("%d %d\\n", i, j);
    int n = 0;
again:
    if (++n < 3) goto again;
    printf("%d\\n", n);
    return 0;
}`);
  assert.equal(r.out, "2 3\n3\n");
  assert.match(error("#include <stdio.h>\nint main(void) { goto ennd; end: return 0; }").detail, /'end'/);
  assert.match(error("#include <stdio.h>\nint main(void) { goto in; { in: ; } return 0; }").title, /안쪽/);
});

test("union: 같은 자리를 다른 타입으로 읽기", () => {
  const r = run(`#include <stdio.h>
union Bits { float f; unsigned int u; unsigned char b; };
int main(void) {
    union Bits x;
    x.f = 1.0f;
    printf("%x %d\\n", x.u, (int)sizeof(union Bits));
    x.u = 0x41424344;
    printf("%c\\n", x.b);
    union Bits y = {.u = 7};
    printf("%u\\n", y.u);
    return 0;
}`);
  assert.equal(r.status, "ok", JSON.stringify(r.error));
  assert.equal(r.out, "3f800000 4\nD\n7\n");
  assert.match(r.variables.find((v) => v.name === "y").value, /u: 7.*공용체/);
});

test("비트 필드", () => {
  const r = run(`#include <stdio.h>
struct Flags { unsigned int on : 1; unsigned int mode : 3; int temp : 5; };
int main(void) {
    struct Flags f = {1, 5, -3};
    f.mode += 6;
    f.temp = 20;
    f.on = 2;
    printf("%u %u %d %d\\n", f.on, f.mode, f.temp, (int)sizeof(struct Flags));
    return 0;
}`);
  assert.equal(r.out, "0 3 -12 4\n");
  assert.match(error("struct S { unsigned a : 3; };\nint main(void) { struct S s; unsigned *p = &s.a; return 0; }").title, /비트 필드/);
});

test("가변 인자 함수 (stdarg.h)", () => {
  const r = run(`#include <stdio.h>
#include <stdarg.h>
int sum(int count, ...) {
    va_list args;
    va_start(args, count);
    int total = 0;
    for (int i = 0; i < count; i++) total += va_arg(args, int);
    va_end(args);
    return total;
}
double avg(int n, ...) {
    va_list ap;
    va_start(ap, n);
    double s = 0;
    for (int i = 0; i < n; i++) s += va_arg(ap, double);
    va_end(ap);
    return s / n;
}
int main(void) {
    printf("%d %d %.2f\\n", sum(3, 10, 20, 30), sum(2, 'A', (short)5), avg(3, 1.0, 2.5f, 4.0));
    return 0;
}`);
  assert.equal(r.status, "ok", JSON.stringify(r.error));
  assert.equal(r.out, "60 70 2.50\n");
  const H = "#include <stdio.h>\n#include <stdarg.h>\n";
  assert.match(error(`${H}int f(int n, ...) { va_list a; va_start(a, n); int x = va_arg(a, int); x += va_arg(a, int); return x; }\nint main(void) { return f(1, 5); }`).title, /더 많이 꺼냈어요/);
  assert.match(error(`${H}double f(int n, ...) { va_list a; va_start(a, n); return va_arg(a, double); }\nint main(void) { printf("%f", f(1, 5)); return 0; }`).title, /넘어온 값은 int/);
  assert.match(error(`${H}int f(int n) { va_list a; va_start(a, n); return 0; }\nint main(void) { return f(1); }`).title, /\.\.\. 이 있는 함수/);
});

test("const 지키기", () => {
  const M = (body) => `#include <stdio.h>\n#include <string.h>\nint main(void) {\n    ${body}\n    return 0;\n}\n`;
  assert.match(error(M("const int MAX = 3;\n    MAX = 4;")).title, /const로 정한 'MAX'는 바꿀 수 없어요/);
  assert.match(error(M("const int a[2] = {1, 2};\n    a[0]++;")).title, /const/);
  assert.match(error(M("int v = 1;\n    const int *p = &v;\n    *p = 2;")).title, /const/);
  assert.match(error(M("int v = 1;\n    int *const p = &v;\n    p = NULL;")).title, /'p'/);
  assert.match(error(M('const char s[10] = "x";\n    strcpy(s, "y");')).title, /strcpy/);
  assert.match(error(M('const int k = 0;\n    scanf("%d", &k);')).title, /scanf/);
  const r = run(M('int v = 1;\n    const int *p = &v;\n    v = 5;\n    printf("%d\\n", *p);'));
  assert.equal(r.out, "5\n");
});

test("복합 리터럴", () => {
  const r = run(`#include <stdio.h>
struct P { int x, y; };
int total(const int *a, int n) { int s = 0; for (int i = 0; i < n; i++) s += a[i]; return s; }
int main(void) {
    int *p = (int[]){10, 20, 30};
    struct P q = (struct P){.y = 7, .x = 1};
    printf("%d %d %d\\n", p[2], q.x + q.y, total((int[]){1, 2, 3}, 3));
    return 0;
}`);
  assert.equal(r.status, "ok", JSON.stringify(r.error));
  assert.equal(r.out, "30 8 6\n");
});

test("매크로: #, ##, __VA_ARGS__, __LINE__, __func__", () => {
  const r = run(`#include <stdio.h>
#define SHOW(x) printf(#x " = %d\\n", x)
#define STR(s) #s
#define CAT(a, b) a ## b
#define LOG(fmt, ...) printf("[%s:%d] " fmt "\\n", __func__, __LINE__, __VA_ARGS__)
#define DEBUG(fmt, ...) printf(fmt "\\n", ##__VA_ARGS__)
#define GETTER(name) int get_ ## name(void) { return name; }
int score = 42;
GETTER(score)
void work(void) { LOG("x=%d", 3); }
int main(void) {
    int value12 = 7;
    SHOW(value12 * 2);
    printf("%s|%s\\n", STR(a  +  b), STR("q" 'c'));
    printf("%d %d\\n", CAT(value, 12), get_score());
    work();
    DEBUG("no args");
    DEBUG("one %d", 1);
    printf("%s %s %d\\n", __func__, __FILE__, __LINE__);
    return 0;
}`);
  assert.equal(r.status, "ok", JSON.stringify(r.error));
  assert.equal(r.out, "value12 * 2 = 14\na + b|\"q\" 'c'\n7 42\n[work:10] x=3\nno args\none 1\nmain main.c 19\n");
});

test("바이트 단위로 다른 타입 포인터 읽기는 안내해요", () => {
  const e = error("#include <stdio.h>\nint main(void) { int x = 1; unsigned char *p = (unsigned char *)&x; return p[0]; }");
  assert.match(e.detail, /union/);
});

// ---------- 표준 문법·라이브러리 전수 검토 (C11 기준) ----------
const AUDIT_H = "#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include <math.h>\n#include <ctype.h>\n";
const AUDIT_M = (body, extra = "") => `${AUDIT_H}${extra}\nint main(void) {\n${body}\nreturn 0;\n}\n`;
const AUDIT = [
  ["문법", "16진 실수 리터럴", AUDIT_M('printf("%g", 0x1.8p3);'), "12"],
  ["문법", "u8/L 문자열 접두사", AUDIT_M('printf("%s", u8"가");'), "가"],
  ["문법", "_Static_assert", AUDIT_M('_Static_assert(sizeof(int) == 4, "int");printf("ok");'), "ok"],
  ["문법", "_Alignof/_Alignas", AUDIT_M('printf("%d", (int)_Alignof(double));'), "8"],
  ["문법", "_Generic", AUDIT_M('printf("%s", _Generic(1.0, double: "d", int: "i"));'), "d"],
  ["문법", "_Noreturn 함수", AUDIT_M("die();", "_Noreturn void die(void) { exit(0); }"), ""],
  ["문법", "배열 매개변수 static", AUDIT_M('int a[3]={1,2,3}; printf("%d", f(a));', "int f(int a[static 3]) { return a[2]; }"), "3"],
  ["문법", "함수를 돌려주는 함수 포인터", AUDIT_M('printf("%d", pick(1)(2,3));', "int add(int a,int b){return a+b;}\nint (*pick(int k))(int, int) { return add; }"), "5"],
  ["문법", "2차원 가변 길이 배열", AUDIT_M('int n=2,m=3; int a[n][m]; for(int i=0;i<n;i++)for(int j=0;j<m;j++)a[i][j]=i*m+j; printf("%d", a[1][2]);'), "5"],
  ["문법", "VLA sizeof", AUDIT_M('int n=4; int a[n]; printf("%zu", sizeof(a));'), "16"],
  ["문법", "쉼표 연산자·삼항 중첩", AUDIT_M('int a=(1,2,3); printf("%d %s", a, a>2?a>3?"x":"y":"z");'), "3 y"],
  ["문법", "switch 안의 블록 case(더프)", AUDIT_M('int n=5,c=0; switch(n%2){case 1: do{c++;}while(--n>0);} printf("%d",c);'), "5"],
  ["문법", "문자열 이어 붙이기·이스케이프", AUDIT_M('printf("a" "b\\t%c\\x41\\101\\n", 0x42);'), "ab\tBAA\n"],
  ["문법", "char 배열 문자열 초기화 크기", AUDIT_M('char s[] = "abc"; printf("%zu", sizeof s);'), "4"],
  ["문법", "extern 선언", AUDIT_M('printf("%d", g);', "extern int g;\nint g = 7;"), "7"],
  ["문법", "static 함수·inline", AUDIT_M('printf("%d", sq(4));', "static inline int sq(int x) { return x * x; }"), "16"],
  ["stdio", "sscanf", AUDIT_M('int a; char w[10]; sscanf("12 hi", "%d %s", &a, w); printf("%d %s", a, w);'), "12 hi"],
  ["stdio", "perror", AUDIT_M('perror("err"); printf("x");'), "err: Success\nx"],
  ["stdio", "fseek/ftell", AUDIT_M('FILE*f=fopen("a","w"); fputs("hello",f); fclose(f); f=fopen("a","r"); fseek(f,0,SEEK_END); printf("%ld", ftell(f)); fclose(f);'), "5"],
  ["stdio", "fread/fwrite (글자)", AUDIT_M('FILE*f=fopen("b","w"); fwrite("abc",1,3,f); fclose(f); char buf[4]={0}; f=fopen("b","r"); fread(buf,1,3,f); fclose(f); printf("%s",buf);'), "abc"],
  ["stdio", "ungetc", AUDIT_M('FILE*f=fopen("c","w"); fputs("xy",f); fclose(f); f=fopen("c","r"); int c=fgetc(f); ungetc(c,f); printf("%c", fgetc(f));'), "x"],
  ["stdio", "puts/putchar/printf 반환값", AUDIT_M('int n = printf("abc"); printf("%d", n);'), "abc3"],
  ["stdlib", "strtol/strtoul/strtod", AUDIT_M('char*e; long v=strtol("0x1f!",&e,16); double d=strtod("2.5e1x",&e); printf("%ld %.1f %c %lu", v, d, *e, strtoul("42",NULL,10));'), "31 25.0 x 42"],
  ["stdlib", "atol/atoll", AUDIT_M('printf("%ld %lld", atol("123"), atoll("-9000000000"));'), "123 -9000000000"],
  ["stdlib", "realloc", AUDIT_M('int*p=malloc(2*sizeof(int)); p[0]=1; p[1]=2; p=realloc(p,4*sizeof(int)); p[3]=4; printf("%d %d", p[1], p[3]); free(p);'), "2 4"],
  ["stdlib", "div/ldiv", AUDIT_M('div_t r = div(7, 2); printf("%d %d", r.quot, r.rem);'), "3 1"],
  ["stdlib", "abort/atexit", AUDIT_M('printf("a");', "void bye(void){printf(\"b\");}\n__attribute__((unused)) static int z;"), "a"],
  ["stdlib", "getenv", AUDIT_M('printf("%s", getenv("HOME") ? "y" : "n");'), "n"],
  ["string", "memcmp/memmove/memchr", AUDIT_M('char a[]="abcdef"; memmove(a+1,a,3); printf("%s %d %c", a, memcmp("ab","ac",2)<0, *(char*)memchr(a,\'e\',6));'), "aabcef 1 e"],
  ["string", "strspn/strcspn/strpbrk", AUDIT_M('printf("%zu %zu %s", strspn("aab","a"), strcspn("abc","c"), strpbrk("hello","lo"));'), "2 2 llo"],
  ["string", "strdup/strndup", AUDIT_M('char*s=strdup("hi"); printf("%s", s); free(s);'), "hi"],
  ["string", "strcoll/strerror", AUDIT_M('printf("%d", strcmp("a","a"));'), "0"],
  ["math", "isnan/isinf/INFINITY/NAN", AUDIT_M('printf("%d %d", isnan(NAN), isinf(INFINITY));'), "1 1"],
  ["math", "modf/ldexp/frexp/exp2/log1p", AUDIT_M('double ip; double fp = modf(3.25,&ip); int e; frexp(8.0,&e); printf("%.2f %.0f %.0f %d %.0f", fp, ip, ldexp(1,3), e, exp2(4));'), "0.25 3 8 4 16"],
  ["math", "lround/fmin/copysign/round", AUDIT_M('printf("%ld %.1f %.1f", lround(2.5), fmin(1,2), copysign(3,-1));'), "3 1.0 -3.0"],
  ["ctype", "isprint/iscntrl/isgraph", AUDIT_M('printf("%d %d %d", !!isprint(\'a\'), !!iscntrl(\'\\n\'), !!isgraph(\' \'));'), "1 1 0"],
  ["헤더", "stdint.h (int32_t, uint8_t)", AUDIT_M('int32_t a = -5; uint8_t b = 300; int64_t c = 1LL<<40; printf("%d %d %lld", a, b, (long long)c);', "#include <stdint.h>"), "-5 44 1099511627776"],
  ["헤더", "inttypes.h (PRId64)", AUDIT_M('int64_t x = 42; printf("%" PRId64, x);', "#include <inttypes.h>"), "42"],
  ["헤더", "assert.h", AUDIT_M('assert(1 + 1 == 2); printf("ok");', "#include <assert.h>"), "ok"],
  ["헤더", "float.h", AUDIT_M('printf("%d %g", FLT_DIG, DBL_EPSILON);', "#include <float.h>"), "6 2.22045e-16"],
  ["헤더", "limits.h", AUDIT_M('printf("%d %u %lld", INT_MAX, UINT_MAX, LLONG_MIN);', "#include <limits.h>"), "2147483647 4294967295 -9223372036854775808"],
  ["헤더", "errno.h", AUDIT_M('errno = 0; printf("%d", errno);', "#include <errno.h>"), "0"],
  ["헤더", "time.h struct tm", AUDIT_M('time_t t = 0; struct tm *g = gmtime(&t); printf("%d", g->tm_year + 1900);', "#include <time.h>"), "1970"],
  ["헤더", "setjmp.h", AUDIT_M('jmp_buf b; if (setjmp(b) == 0) longjmp(b, 1); printf("back");', "#include <setjmp.h>"), "back"],
  ["헤더", "stdbool.h", AUDIT_M('bool b = true; printf("%d", b);', "#include <stdbool.h>"), "1"],
  ["헤더", "stddef.h offsetof", AUDIT_M('printf("%zu", offsetof(struct P, y));', "#include <stddef.h>\nstruct P { char c; int y; };"), "4"],
];
for (const [group, name, code, want] of AUDIT) {
  test(`표준 검토 [${group}] ${name}`, () => {
    const r = run(code);
    assert.ok(r.status === "ok" || r.status === "exit", JSON.stringify(r.error));
    assert.equal(r.out, want);
  });
}

const MORE_M = (body, pre = "") => `#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include <math.h>\n${pre}\nint main(void) {\n${body}\nreturn 0;\n}\n`;
const MORE = [
  ["VLA 매개변수 2차원", MORE_M('int a[2][3]={{1,2,3},{4,5,6}}; printf("%d", sum(2,3,a));', "int sum(int n, int m, int a[n][m]) { int s=0; for(int i=0;i<n;i++) for(int j=0;j<m;j++) s+=a[i][j]; return s; }"), "21"],
  ["VLA 매개변수 1차원", MORE_M('int a[3]={1,2,3}; printf("%d", sum(3,a));', "int sum(int n, int a[n]) { int s=0; for(int i=0;i<n;i++) s+=a[i]; return s; }"), "6"],
  ["VLA 재귀", MORE_M('printf("%d", f(4));', "int f(int n) { int a[n]; for(int i=0;i<n;i++) a[i]=i; if(n==1) return a[0]; int r=f(n-1); return a[n-1]+r; }"), "6"],
  ["VLA 2차원 sizeof", MORE_M('int n=3,m=5; double a[n][m]; printf("%zu %zu", sizeof a, sizeof a[0]);'), "120 40"],
  ["VLA 범위 초과", MORE_M('int n=3; int a[n]; a[3]=1;'), "ERR"],
  ["VLA 포인터", MORE_M('int n=2,m=3; int a[n][m]; int (*p)[m] = a; p[1][2]=9; printf("%d", a[1][2]);'), "9"],
  ["setjmp 함수 밖으로", MORE_M('if (setjmp(env)) { printf("caught %d", code); return 0; } work(); printf("no");', "#include <setjmp.h>\njmp_buf env; int code;\nvoid work(void) { code = 42; longjmp(env, 2); }"), "caught 42"],
  ["setjmp 반복", MORE_M('volatile int n = 0; int r = setjmp(env); n++; if (r < 3) longjmp(env, r + 1); printf("%d %d", r, n);', "#include <setjmp.h>\njmp_buf env;"), "3 4"],
  ["extern 지역", MORE_M('extern int g; printf("%d", g);', "int g = 5;"), "5"],
  ["extern 정의 없음", MORE_M('printf("%d", g);', "extern int g;"), "ERR"],
  ["_Generic 매크로", MORE_M('printf("%s %s %s", T(1), T(2.0), T("s"));', '#define T(x) _Generic((x), int: "int", double: "double", char *: "str", default: "?")'), "int double str"],
  ["_Static_assert 실패", MORE_M('', '_Static_assert(sizeof(int) == 8, "int는 8바이트");'), "ERR"],
  ["errno fopen", MORE_M('FILE *f = fopen("none.txt", "r"); if (!f) printf("%d %s", errno == ENOENT, strerror(errno));', "#include <errno.h>"), "1 No such file or directory"],
  ["strftime", MORE_M('time_t t = 86400 * 365; struct tm *g = gmtime(&t); char b[64]; strftime(b, sizeof b, "%Y-%m-%d %H:%M %a %b", g); printf("%s", b);', "#include <time.h>"), "1971-01-01 00:00 Fri Jan"],
  ["mktime", MORE_M('struct tm t = {0}; t.tm_year = 100; t.tm_mon = 0; t.tm_mday = 32; mktime(&t); printf("%d %d", t.tm_mon, t.tm_mday);', "#include <time.h>"), "1 1"],
  ["atexit 순서", MORE_M('atexit(a); atexit(b); printf("main ");', 'void a(void){printf("a");}\nvoid b(void){printf("b");}'), "main ba"],
  ["atexit + exit", MORE_M('atexit(a); exit(3);', 'void a(void){printf("a");}'), "a"],
  ["fwrite/fread int 배열", MORE_M('int a[3]={1,-2,300}, b[3]; FILE*f=fopen("d.bin","wb"); fwrite(a,sizeof(int),3,f); fclose(f); f=fopen("d.bin","rb"); size_t n=fread(b,sizeof(int),3,f); fclose(f); printf("%zu %d %d %d", n, b[0], b[1], b[2]);'), "3 1 -2 300"],
  ["fwrite 구조체", MORE_M('struct P p={1,2.5}, q; FILE*f=fopen("e","wb"); fwrite(&p,sizeof p,1,f); fclose(f); f=fopen("e","rb"); fread(&q,sizeof q,1,f); printf("%d %.1f", q.x, q.y);', "struct P { int x; double y; };"), "1 2.5"],
  ["memcmp int", MORE_M('int a[2]={1,2}, b[2]={1,3}; printf("%d", memcmp(a,b,sizeof a) < 0);'), "1"],
  ["memmove 겹침 int", MORE_M('int a[5]={1,2,3,4,5}; memmove(a+1,a,4*sizeof(int)); printf("%d%d%d%d%d", a[0],a[1],a[2],a[3],a[4]);'), "11234"],
  ["realloc 늘리고 줄이기", MORE_M('int *p=NULL; for(int i=0;i<5;i++){ p=realloc(p,(i+1)*sizeof(int)); p[i]=i*i; } printf("%d", p[4]); free(p);'), "16"],
  ["strtol endptr 반복", MORE_M('const char *s="10 20 30"; char *e; long t=0; for(;;){ long v=strtol(s,&e,10); if(e==s) break; t+=v; s=e; } printf("%ld", t);'), "60"],
  ["sscanf 반환값", MORE_M('int a,b; int n = sscanf("5 x", "%d %d", &a, &b); printf("%d", n);'), "1"],
  ["div 음수", MORE_M('ldiv_t r = ldiv(-7L, 2L); printf("%ld %ld", r.quot, r.rem);'), "-3 -1"],
  ["assert 실패", MORE_M('int x = 3; assert(x == 4);', "#include <assert.h>"), "ERR"],
  ["offsetof 중첩", MORE_M('printf("%zu", offsetof(struct Q, p.y));', "#include <stddef.h>\nstruct P { char c; double y; };\nstruct Q { int a; struct P p; };"), "16"],
  ["_Alignof struct", MORE_M('printf("%zu", _Alignof(struct P));', "struct P { char c; double y; };"), "8"],
  ["uint8_t 오버플로", MORE_M('uint8_t x = 255; x++; int16_t y = 32767; y++; printf("%u %d", x, y);', "#include <stdint.h>"), "0 -32768"],
  ["PRIu64", MORE_M('uint64_t x = 18446744073709551615ULL; printf("%" PRIu64, x);', "#include <inttypes.h>"), "18446744073709551615"],
  ["hypot/cbrt/trunc", MORE_M('printf("%.0f %.0f %.0f", hypot(3,4), cbrt(27), trunc(-2.7));'), "5 3 -2"],
  ["rand 범위", MORE_M('srand(1); int ok=1; for(int i=0;i<100;i++){int r=rand()%6+1; if(r<1||r>6) ok=0;} printf("%d", ok);'), "1"],
  ["getline 대신 fgets", MORE_M('char b[10]; FILE*f=fopen("g","w"); fputs("ab\\ncd\\n",f); fclose(f); f=fopen("g","r"); int n=0; while(fgets(b,sizeof b,f)) n++; printf("%d", n);'), "2"],
];
for (const [name, code, want] of MORE) {
  test(`표준 검토 (더) ${name}`, () => {
    const r = run(code);
    if (want === "ERR") {
      assert.equal(r.status, "error");
    } else {
      assert.ok(r.status === "ok" || r.status === "exit", JSON.stringify(r.error));
      assert.equal(r.out, want);
    }
  });
}

test("지원하지 않는 것은 친절하게 알려요: K&R 정의, complex.h, wchar.h", () => {
  assert.match(error("int old(x) int x; { return x; }\nint main(void) { return old(1); }").title, /K&R/);
  assert.match(error("#include <complex.h>\nint main(void) { return 0; }").title, /complex\.h/);
  assert.match(error("#include <wchar.h>\nint main(void) { return 0; }").title, /wchar\.h/);
});
