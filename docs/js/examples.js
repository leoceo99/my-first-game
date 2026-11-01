// 처음 시작할 때와 '예제' 목록에 나오는 코드들.

export const EXAMPLES = [
  {
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
    name: "구구단",
    about: "for 문과 range()",
    code: `dan = int(input("몇 단을 볼까요? (2~9) "))

for i in range(1, 10):
    print(f"{dan} x {i} = {dan * i}")
`,
  },
  {
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
    name: "일부러 틀린 코드",
    about: "오류가 나면 어떤 설명이 나오는지 보기",
    code: `# 이 코드에는 실수가 하나 있어요.
# 실행해서 어떤 설명이 나오는지 보고, 직접 고쳐 보세요!

age = input("나이를 입력하세요: ")
next_year = age + 1
print(f"내년에는 {next_year}살이에요.")
`,
  },
];
