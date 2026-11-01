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
