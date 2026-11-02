// 파이썬 오류를 처음 배우는 사람도 이해할 수 있는 한국어 설명으로 바꿔요.

const HANGUL = /[ㄱ-힝]/;

function quoted(message) {
  const m = message.match(/'([^']*)'/);
  return m ? m[1] : null;
}

const INPUT_HINT = "input()으로 받은 값은 항상 글자(str)예요. 숫자로 계산하려면 int(input(...))처럼 바꿔 주세요.";

function syntaxDetail(msg) {
  if (/expected ':'/.test(msg)) return "if, for, while, def 같은 줄은 끝에 콜론(:)을 붙여야 해요.";
  if (/was never closed/.test(msg)) return "열린 괄호를 닫지 않았어요. ( [ { 의 짝이 맞는지 확인해 보세요.";
  if (/unterminated (triple-quoted )?string/.test(msg)) return "따옴표로 시작한 글자가 끝나지 않았어요. 닫는 따옴표를 붙여 주세요.";
  if (/unmatched/.test(msg) || /does not match opening parenthesis/.test(msg)) return "닫는 괄호가 여는 괄호와 짝이 맞지 않아요.";
  if (/forgot a comma/.test(msg)) return "값들 사이에 쉼표(,)가 빠진 것 같아요.";
  if (/'==' or ':=' instead of '='/.test(msg) || /cannot assign to/.test(msg) && /comparison|literal/.test(msg))
    return "같은지 비교할 때는 = 가 아니라 == 를 써요.";
  if (/invalid character/.test(msg)) return "파이썬이 모르는 글자가 들어 있어요. 따옴표는 \" 나 ' 만 쓸 수 있어요.";
  if (/invalid decimal literal/.test(msg)) return "숫자 바로 뒤에 글자가 붙어 있어요. 변수 이름은 숫자로 시작할 수 없어요.";
  if (/Missing parentheses in call to 'print'/.test(msg)) return "print 뒤에는 괄호가 필요해요. 예: print(\"안녕\")";
  if (/'return' outside function/.test(msg)) return "return은 def로 만든 함수 안에서만 쓸 수 있어요.";
  if (/'break' outside loop/.test(msg) || /'continue' not properly in loop/.test(msg))
    return "break와 continue는 for나 while 반복문 안에서만 쓸 수 있어요.";
  if (/expected 'except' or 'finally' block/.test(msg)) return "try 다음에는 except나 finally가 와야 해요.";
  return "파이썬이 이해할 수 없는 문장이 있어요. 표시된 줄과 바로 윗줄을 함께 살펴보세요.";
}

function typeErrorDetail(msg) {
  if (/can only concatenate str \(not "(int|float)"\) to str/.test(msg))
    return "글자(str)와 숫자는 + 로 바로 붙일 수 없어요. str(숫자)로 바꾸거나 f\"{변수}\"를 써 보세요.";
  if (/unsupported operand type\(s\)/.test(msg) || /not supported between instances of/.test(msg)) {
    const mixesText = /'str'/.test(msg) && /'(int|float)'/.test(msg);
    return mixesText ? INPUT_HINT : "이 두 값은 종류(타입)가 달라서 함께 계산할 수 없어요.";
  }
  if (/missing \d+ required positional argument/.test(msg)) return "함수에 필요한 값을 덜 넣었어요. 괄호 안의 값 개수를 확인해 보세요.";
  if (/takes \d+ positional arguments? but \d+ (were|was) given/.test(msg)) return "함수에 값을 너무 많이 넣었어요.";
  if (/object is not callable/.test(msg)) return "함수가 아닌 값 뒤에 ( ) 를 붙였어요. 같은 이름의 변수가 함수를 덮어쓰지 않았는지 확인해 보세요.";
  if (/object is not subscriptable/.test(msg)) return "[ ] 로 안의 값을 꺼낼 수 없는 종류예요.";
  if (/object is not iterable/.test(msg)) return "for 문으로 하나씩 꺼낼 수 없는 값이에요. 숫자만큼 반복하려면 range()를 써 보세요.";
  if (/indices must be integers/.test(msg)) return "[ ] 안의 번호는 정수여야 해요. input()으로 받았다면 int()로 바꿔 주세요.";
  return "값의 종류(타입)가 이 동작과 맞지 않아요.";
}

/**
 * 오류 정보({type, message, suggestion})를 받아 {title, detail}을 돌려줘요.
 */
export function explainError(error) {
  const { type, message = "", suggestion } = error;
  let title = type;
  let detail = message;

  switch (type) {
    case "SyntaxError":
      title = "문법이 맞지 않아요";
      detail = syntaxDetail(message);
      break;
    case "IndentationError":
      title = "들여쓰기가 맞지 않아요";
      if (/expected an indented block/.test(message)) detail = "콜론(:)으로 끝나는 줄 다음 줄은 스페이스 4칸 안으로 들여 써야 해요.";
      else if (/unexpected indent/.test(message)) detail = "필요 없는 곳에 들여쓰기가 있어요. 줄 앞의 공백을 지워 보세요.";
      else detail = "들여쓰기 칸 수가 위아래 줄과 맞지 않아요. 같은 묶음은 같은 칸만큼 들여 써요.";
      break;
    case "TabError":
      title = "들여쓰기가 섞여 있어요";
      detail = "탭과 스페이스를 섞어서 들여 썼어요. 스페이스 4칸으로 통일해 주세요.";
      break;
    case "NameError": {
      const name = quoted(message);
      title = name ? `'${name}'(이)라는 이름을 찾을 수 없어요` : "모르는 이름이 있어요";
      detail = name && HANGUL.test(name)
        ? `글자를 그대로 쓰려면 따옴표로 감싸야 해요. 예: "${name}"`
        : "변수를 만들기 전에 썼거나, 이름에 오타가 있을 수 있어요.";
      break;
    }
    case "UnboundLocalError":
      title = "값을 정하기 전에 썼어요";
      detail = "함수 안에서 이 변수에 값을 넣기 전에 사용했어요. 함수 밖의 변수를 바꾸려면 global을 써야 해요.";
      break;
    case "TypeError":
      title = "값의 종류가 맞지 않아요";
      detail = typeErrorDetail(message);
      break;
    case "ValueError":
      if (/invalid literal for int\(\)/.test(message)) {
        const raw = quoted(message);
        title = "정수로 바꿀 수 없어요";
        detail = raw !== null ? `'${raw}'는 정수가 아니에요. 숫자만 입력했는지 확인해 보세요.` : "숫자만 입력했는지 확인해 보세요.";
      } else if (/could not convert string to float/.test(message)) {
        title = "소수로 바꿀 수 없어요";
        detail = "숫자만 입력했는지 확인해 보세요.";
      } else {
        title = "값이 올바르지 않아요";
      }
      break;
    case "ZeroDivisionError":
      title = "0으로 나눌 수 없어요";
      detail = "나누는 수가 0이 되었어요. 나누기 전에 0인지 확인해 보세요.";
      break;
    case "IndexError":
      title = "없는 번호를 꺼내려고 했어요";
      detail = "번호는 0부터 시작해서 (길이 - 1)까지만 있어요. len()으로 길이를 확인해 보세요.";
      break;
    case "KeyError":
      title = `딕셔너리에 ${message} 키가 없어요`;
      detail = "키 이름이 정확한지 확인해 보세요. .get(키)를 쓰면 키가 없을 때 None을 돌려받아요.";
      break;
    case "AttributeError": {
      const m = message.match(/'(\w+)' object has no attribute '(\w+)'/);
      title = m ? `${m[1]}에는 '${m[2]}' 기능이 없어요` : "없는 기능을 사용했어요";
      detail = "점(.) 뒤의 이름에 오타가 있는지, 값의 종류가 맞는지 확인해 보세요.";
      break;
    }
    case "ModuleNotFoundError":
    case "ImportError":
      title = "모듈을 불러올 수 없어요";
      detail = "이름에 오타가 있는지 확인해 보세요. 이 앱에서는 파이썬 기본 모듈(random, math 등)을 쓸 수 있어요.";
      break;
    case "RecursionError":
      title = "함수가 끝없이 자기 자신을 불러요";
      detail = "재귀 함수에 멈추는 조건(if ...: return)이 있는지 확인해 보세요.";
      break;
    case "FileNotFoundError":
      title = "파일을 찾을 수 없어요";
      break;
    case "AssertionError":
      title = "assert 조건이 맞지 않아요";
      break;
    case "OverflowError":
      title = "숫자가 너무 커요";
      break;
    case "EOFError":
      title = "입력이 끝났어요 (EOF)";
      detail = "입력 끝(EOF)을 보낸 뒤에 input()이 또 답을 기다렸어요. 입력을 끝까지 읽었는지 확인해 보세요.";
      break;
    default:
      break;
  }

  if (suggestion) detail += ` 혹시 '${suggestion}'를 쓰려던 건가요?`;
  return { title, detail };
}
