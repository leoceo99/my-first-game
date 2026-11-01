// 처음 시작할 때와 '예제' 목록에 나오는 코드들. lang: "python" 또는 "c"

export const EXAMPLES = [
  {
    lang: "python",
    name: "첫 만남",
    about: "input()으로 이름과 나이를 묻고 답하기",
    code: `# 파이브릿지에 온 걸 환영해요!
# 오른쪽 위 [실행]을 누르면 이 코드가 실행돼요.

name = input("이름이 뭐예요? ")
age = int(input("몇 살이에요? "))

print(f"반가워요, {name}님!")
print(f"10년 뒤에는 {age + 10}살이 되겠네요.")
`,
  },
  {
    lang: "python",
    name: "숫자 맞히기 게임",
    about: "random과 while 반복문",
    code: `import random

answer = random.randint(1, 50)
tries = 0
print("1부터 50 사이의 숫자를 하나 골랐어요!")

while True:
    guess = int(input("숫자를 맞혀 보세요: "))
    tries += 1
    if guess < answer:
        print("더 큰 숫자예요 ↑")
    elif guess > answer:
        print("더 작은 숫자예요 ↓")
    else:
        print(f"정답! {tries}번 만에 맞혔어요.")
        break
`,
  },
  {
    lang: "python",
    name: "구구단",
    about: "for 문과 range()",
    code: `dan = int(input("몇 단을 볼까요? (2~9) "))

for i in range(1, 10):
    print(f"{dan} x {i} = {dan * i}")
`,
  },
  {
    lang: "python",
    name: "별 피라미드",
    about: "문자열 곱하기로 모양 만들기",
    code: `height = 6

for row in range(1, height + 1):
    spaces = " " * (height - row)
    stars = "*" * (2 * row - 1)
    print(spaces + stars)
`,
  },
  {
    lang: "python",
    name: "성적표",
    about: "딕셔너리와 함수 (변수 탭도 확인해 보세요)",
    code: `scores = {"국어": 92, "수학": 78, "영어": 85, "과학": 96}

def grade(score):
    if score >= 90:
        return "A"
    elif score >= 80:
        return "B"
    return "C"

for subject, score in scores.items():
    bar = "■" * (score // 10)
    print(f"{subject} {score:3}점 {grade(score)} {bar}")

average = sum(scores.values()) / len(scores)
best = max(scores, key=scores.get)
print(f"평균 {average:.1f}점, 가장 잘한 과목은 {best}")
`,
  },
  {
    lang: "python",
    name: "일부러 틀린 코드",
    about: "오류가 나면 어떤 설명이 나오는지 보기",
    code: `# 이 코드에는 실수가 하나 있어요.
# 실행해서 어떤 설명이 나오는지 보고, 직접 고쳐 보세요!

age = input("나이를 입력하세요: ")
next_year = age + 1
print(f"내년에는 {next_year}살이에요.")
`,
  },
  {
    lang: "c",
    name: "C 첫 만남",
    about: "printf로 출력하고 scanf로 입력받기",
    code: `#include <stdio.h>

int main(void) {
    char name[20];
    int age;

    printf("이름이 뭐예요? ");
    scanf("%s", name);
    printf("몇 살이에요? ");
    scanf("%d", &age);

    printf("반가워요, %s님!\\n", name);
    printf("10년 뒤에는 %d살이 되겠네요.\\n", age + 10);
    return 0;
}
`,
  },
  {
    lang: "c",
    name: "C 숫자 맞히기 게임",
    about: "rand()와 while 반복문",
    code: `#include <stdio.h>
#include <stdlib.h>
#include <time.h>

int main(void) {
    srand(time(NULL));
    int answer = rand() % 50 + 1;
    int guess = 0;
    int tries = 0;

    printf("1부터 50 사이의 숫자를 하나 골랐어요!\\n");
    while (guess != answer) {
        printf("숫자를 맞혀 보세요: ");
        scanf("%d", &guess);
        tries++;
        if (guess < answer) {
            printf("더 큰 숫자예요 ↑\\n");
        } else if (guess > answer) {
            printf("더 작은 숫자예요 ↓\\n");
        }
    }
    printf("정답! %d번 만에 맞혔어요.\\n", tries);
    return 0;
}
`,
  },
  {
    lang: "c",
    name: "C 구구단",
    about: "이중 for 문",
    code: `#include <stdio.h>

int main(void) {
    for (int dan = 2; dan <= 9; dan++) {
        printf("[%d단] ", dan);
        for (int i = 1; i <= 9; i++) {
            printf("%2d ", dan * i);
        }
        printf("\\n");
    }
    return 0;
}
`,
  },
  {
    lang: "c",
    name: "C 배열과 함수",
    about: "배열을 함수에 넘겨 평균과 최고점 구하기",
    code: `#include <stdio.h>

double average(int scores[], int n) {
    int sum = 0;
    for (int i = 0; i < n; i++) {
        sum += scores[i];
    }
    return (double)sum / n;
}

int best(int scores[], int n) {
    int max = scores[0];
    for (int i = 1; i < n; i++) {
        if (scores[i] > max) max = scores[i];
    }
    return max;
}

int main(void) {
    int scores[5] = {92, 78, 85, 96, 64};
    printf("평균: %.1f점\\n", average(scores, 5));
    printf("최고점: %d점\\n", best(scores, 5));
    return 0;
}
`,
  },
  {
    lang: "c",
    name: "C 포인터 맛보기",
    about: "주소와 포인터로 두 값 바꾸기 (변수 탭도 보세요)",
    code: `#include <stdio.h>

void swap(int *a, int *b) {
    int temp = *a;
    *a = *b;
    *b = temp;
}

int main(void) {
    int x = 10;
    int y = 20;
    int *p = &x;

    printf("바꾸기 전: x = %d, y = %d\\n", x, y);
    swap(&x, &y);
    printf("바꾼 뒤:   x = %d, y = %d\\n", x, y);
    printf("p가 가리키는 값: %d\\n", *p);
    return 0;
}
`,
  },
  {
    lang: "c",
    name: "C 일부러 틀린 코드",
    about: "C에서 자주 하는 실수 두 가지를 찾아보기",
    code: `#include <stdio.h>

// 이 코드에는 실수가 두 개 있어요.
// 실행해서 안내를 보고 하나씩 고쳐 보세요!

int main(void) {
    int scores[3] = {90, 85, 77};
    int sum;

    for (int i = 0; i <= 3; i++) {
        sum = sum + scores[i];
    }
    printf("합계: %d\\n", sum);
    return 0;
}
`,
  },
];
