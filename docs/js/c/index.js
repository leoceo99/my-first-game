// C 코드를 실행하는 입구: 토큰 → 구문 트리 → 검사·준비 → 실행.

import { tokenize } from "./lexer.js";
import { parse } from "./parser.js";
import { Compiler } from "./compile.js";
import { Runtime, NEED_INPUT, ExitSignal } from "./runtime.js";
import { CError, runtimeError, typeName, isInt, isFloat, isArr, isPtr, isCharLike } from "./types.js";

function kindOf(t) {
  if (isArr(t)) return isCharLike(t.of) ? "str" : "list";
  if (isPtr(t)) return isCharLike(t.to) ? "str" : "ptr";
  if (isFloat(t)) return "float";
  if (isInt(t)) return t.bits === 8 ? "char" : "int";
  return "other";
}

function collectVariables(rt, program) {
  const out = [];
  if (!program) return out;
  const top = rt.stack.length ? rt.stack[rt.stack.length - 1] : null;
  const fi = top ? top.fi : program.main;
  const frame = top ? top.frame : rt.mainFrame;
  const seen = new Map();
  for (const info of fi.locals) {
    const st = info.store || (frame ? frame[info.slot] : null);
    if (!st) continue;
    const type = st.type && info.vla ? st.type : info.type;
    seen.set(info.name, { name: info.name, type: typeName(type), kind: kindOf(type), value: rt.formatValue(type, st) });
  }
  out.push(...seen.values());
  for (const g of program.globals) {
    if (seen.has(g.name)) continue;
    out.push({ name: g.name, type: `${typeName(g.type)} (전역)`, kind: kindOf(g.type), value: rt.formatValue(g.type, g.store) });
  }
  return out;
}

function errorInfo(e) {
  return {
    type: e.kind === "compile" ? "C 컴파일 오류" : "C 실행 오류",
    title: e.title,
    detail: e.detail,
    message: "",
    line: e.line || null,
    traceback: null,
  };
}

/**
 * C 코드를 실행해요.
 * answers: 지금까지 받은 입력들. 입력이 더 필요하면 onInput(질문)을 부르고 status "waiting"을 돌려줘요.
 */
export function runC(source, { answers = [], startTime, onOutput = () => {}, onInput = () => {} } = {}) {
  const rt = new Runtime({ answers, startTime, onOutput });
  const started = Date.now();
  let program = null;
  try {
    const { tokens, includes } = tokenize(source);
    const ast = parse(tokens, includes);
    program = new Compiler(rt, includes).compile(ast);
  } catch (e) {
    if (e instanceof CError) return { status: "error", error: errorInfo(e), variables: [], exitCode: 1 };
    throw e;
  }

  const seconds = () => Math.round(Date.now() - started) / 1000;
  try {
    const code = program.run();
    rt.finish();
    return { status: "ok", exitCode: code, seconds: seconds(), variables: collectVariables(rt, program) };
  } catch (e) {
    if (e === NEED_INPUT) {
      onInput(rt.takePrompt());
      return { status: "waiting", variables: [] };
    }
    rt.finish();
    if (e instanceof ExitSignal) {
      return { status: "exit", exitCode: e.code, seconds: seconds(), variables: collectVariables(rt, program) };
    }
    let err = e;
    if (e instanceof RangeError && /call stack/i.test(e.message)) {
      err = runtimeError(rt.line, "함수가 자기 자신을 너무 깊이 불렀어요", "재귀 함수에 멈추는 조건이 있는지 확인해 보세요.");
    } else if (!(e instanceof CError)) {
      err = runtimeError(rt.line, "실행기 내부 오류가 났어요", `C 실행기가 아직 처리하지 못하는 코드예요. (${e && e.message})`);
    }
    return { status: "error", error: errorInfo(err), seconds: seconds(), variables: collectVariables(rt, program), exitCode: 1 };
  }
}
