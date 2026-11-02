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
  assert.match(error("union U { int a; };\nint main(void) { return 0; }").title, /union/);
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
