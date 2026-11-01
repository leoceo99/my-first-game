// C 코드를 토큰(낱말)으로 나눠요. #include 와 #define 도 여기서 처리해요.

import { compileError, T, utf8 } from "./types.js";

export const HEADERS = new Set([
  "stdio.h", "stdlib.h", "string.h", "math.h", "ctype.h", "stdbool.h", "time.h", "limits.h", "stddef.h",
]);

const PUNCTUATORS = [
  "...", "<<=", ">>=", "->", "++", "--", "<<", ">>", "<=", ">=", "==", "!=", "&&", "||",
  "+=", "-=", "*=", "/=", "%=", "&=", "^=", "|=", "##",
  ";", ",", "{", "}", "(", ")", "[", "]", ".", "&", "*", "+", "-", "~", "!", "/", "%",
  "<", ">", "^", "|", "?", ":", "=", "#",
];

const LIMITS = {
  INT_MAX: "2147483647", INT_MIN: "(-2147483647-1)", UINT_MAX: "4294967295u",
  LONG_MAX: "9223372036854775807L", LONG_MIN: "(-9223372036854775807L-1)",
  LLONG_MAX: "9223372036854775807LL", LLONG_MIN: "(-9223372036854775807LL-1)",
  CHAR_MAX: "127", CHAR_MIN: "(-128)", SHRT_MAX: "32767", SHRT_MIN: "(-32768)", UCHAR_MAX: "255",
};

const IDENT_START = /[\p{L}_]/u;
const IDENT_CHAR = /[\p{L}\p{N}_]/u;
const NUMBER = /^(?:0[xX][0-9a-fA-F]+|0[bB][01]+|(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?)[uUlLfF]*/;

const SIMPLE_ESCAPES = { n: 10, t: 9, r: 13, 0: 0, "\\": 92, "'": 39, '"': 34, a: 7, b: 8, f: 12, v: 11, "?": 63 };

/** 이스케이프(\n 같은 것)를 읽어서 [바이트 값, 다음 위치]를 돌려줘요. */
function readEscape(src, i, line) {
  const c = src[i];
  if (c === "x") {
    let j = i + 1;
    while (j < src.length && /[0-9a-fA-F]/.test(src[j])) j++;
    if (j === i + 1) throw compileError(line, "\\x 뒤에 16진수 숫자가 필요해요");
    return [parseInt(src.slice(i + 1, j), 16) & 255, j];
  }
  if (/[0-7]/.test(c)) {
    let j = i;
    while (j < src.length && j < i + 3 && /[0-7]/.test(src[j])) j++;
    return [parseInt(src.slice(i, j), 8) & 255, j];
  }
  if (c in SIMPLE_ESCAPES) return [SIMPLE_ESCAPES[c], i + 1];
  throw compileError(line, `'\\${c}'는 모르는 이스케이프 문자예요`, "줄바꿈은 \\n, 탭은 \\t, 역슬래시는 \\\\ 로 써요.");
}

function numberToken(text, line, col) {
  const m = text.match(/[uUlLfF]*$/);
  const suffix = m[0].toLowerCase();
  const body = text.slice(0, text.length - m[0].length);
  const isHex = /^0[xX]/.test(body);
  const isFloat = !isHex && (/[.eE]/.test(body) || suffix.includes("f"));
  if (isFloat) {
    if (/[ul]/.test(suffix.replace("l", "")) && suffix !== "l") throw compileError(line, `'${text}'는 올바른 숫자가 아니에요`);
    const type = suffix.includes("f") ? T.float : T.double;
    return { k: "num", type, value: type === T.float ? Math.fround(parseFloat(body)) : parseFloat(body), text, line, col };
  }
  if (suffix.includes("f")) throw compileError(line, `'${text}'는 올바른 숫자가 아니에요`);
  let big;
  if (isHex) big = BigInt(body);
  else if (/^0[bB]/.test(body)) big = BigInt(body);
  else if (body.length > 1 && body[0] === "0") {
    if (/[89]/.test(body)) throw compileError(line, `'${text}'는 0으로 시작해서 8진수인데 8, 9가 들어 있어요`, "숫자 앞의 0을 지워 주세요.");
    big = BigInt("0o" + body.slice(1));
  } else big = BigInt(body);
  const unsigned = suffix.includes("u");
  const longs = (suffix.match(/l/g) || []).length;
  const decimal = !isHex && !/^0[bB0-7]/.test(body) || body === "0";
  let candidates;
  if (longs === 0) candidates = unsigned ? [T.uint, T.ulong] : decimal ? [T.int, T.long] : [T.int, T.uint, T.long, T.ulong];
  else candidates = unsigned ? [T.ulong] : decimal ? [T.long] : [T.long, T.ulong];
  if (longs === 2) candidates = candidates.map((t) => (t === T.long ? T.llong : t === T.ulong ? T.ullong : t));
  const type = candidates.find((t) => (t.unsigned ? big < 2n ** BigInt(t.bits) : big < 2n ** BigInt(t.bits - 1)));
  if (!type) throw compileError(line, `숫자 ${text}가 너무 커요`, "C의 정수는 최대 9223372036854775807까지 쓸 수 있어요.");
  return { k: "num", type, value: type.bits === 64 ? big : Number(big), text, line, col };
}

/** 소스 코드를 토큰 목록으로 바꿔요 (전처리 전). */
function rawTokens(src) {
  const tokens = [];
  const directives = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  let atLineStart = true;
  const n = src.length;

  while (i < n) {
    const c = src[i];
    if (c === "\n") { line++; i++; lineStart = i; atLineStart = true; continue; }
    if (c === " " || c === "\t" || c === "\r" || c === "\f" || c === "\v") { i++; continue; }
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end < 0) throw compileError(line, "/* 로 시작한 주석이 닫히지 않았어요", "주석 끝에 */ 를 붙여 주세요.");
      for (let j = i; j < end; j++) if (src[j] === "\n") { line++; lineStart = j + 1; }
      i = end + 2;
      continue;
    }
    if (c === "#" && atLineStart) {
      let end = src.indexOf("\n", i);
      if (end < 0) end = n;
      directives.push({ text: src.slice(i + 1, end).replace(/\/\/.*$/, "").trim(), line, at: tokens.length });
      i = end;
      continue;
    }
    atLineStart = false;
    const col = i - lineStart + 1;

    if (IDENT_START.test(c)) {
      let j = i + 1;
      while (j < n && IDENT_CHAR.test(src[j])) j++;
      tokens.push({ k: "id", v: src.slice(i, j), line, col });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] || ""))) {
      const m = src.slice(i, i + 100).match(NUMBER);
      let j = i + m[0].length;
      if (j < n && IDENT_CHAR.test(src[j])) {
        while (j < n && IDENT_CHAR.test(src[j])) j++;
        throw compileError(line, `'${src.slice(i, j)}'는 올바른 숫자나 이름이 아니에요`, "변수 이름은 숫자로 시작할 수 없어요.");
      }
      tokens.push(numberToken(m[0], line, col));
      i = j;
      continue;
    }
    if (c === '"') {
      const bytes = [];
      let j = i + 1;
      for (;;) {
        if (j >= n || src[j] === "\n") throw compileError(line, "큰따옴표(\")로 시작한 문자열이 닫히지 않았어요", "문자열 끝에 \" 를 붙여 주세요.");
        const ch = src[j];
        if (ch === '"') break;
        if (ch === "\\") {
          const [b, next] = readEscape(src, j + 1, line);
          bytes.push(b);
          j = next;
        } else {
          const cp = src.codePointAt(j);
          const s = String.fromCodePoint(cp);
          bytes.push(...utf8(s));
          j += s.length;
        }
      }
      tokens.push({ k: "str", bytes, line, col });
      i = j + 1;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      let value;
      if (src[j] === "\\") {
        [value, j] = readEscape(src, j + 1, line);
      } else if (src[j] === "'" ) {
        throw compileError(line, "작은따옴표 '' 안에 글자가 없어요", "한 글자를 넣어 주세요. 예: 'a'");
      } else {
        const cp = src.codePointAt(j);
        if (cp === undefined || src[j] === "\n") throw compileError(line, "작은따옴표(')로 시작한 글자가 닫히지 않았어요");
        if (cp > 127) {
          throw compileError(line, `'${String.fromCodePoint(cp)}'는 char 하나에 넣을 수 없어요`,
            "한글 같은 글자는 여러 바이트라서 char 한 칸에 안 들어가요. 큰따옴표 문자열(\"가\")로 써 주세요.");
        }
        value = cp;
        j += 1;
      }
      if (src[j] !== "'") {
        const lineEnd = src.indexOf("\n", j) < 0 ? n : src.indexOf("\n", j);
        if (src.slice(j, lineEnd).includes("'")) {
          throw compileError(line, "작은따옴표 안에는 글자 하나만 넣을 수 있어요", "여러 글자는 큰따옴표 문자열로 써요. 예: \"hello\"");
        }
        throw compileError(line, "작은따옴표(')로 시작한 글자가 닫히지 않았어요");
      }
      tokens.push({ k: "num", type: T.int, value: value > 127 ? value - 256 : value, text: src.slice(i, j + 1), line, col, isChar: true });
      i = j + 1;
      continue;
    }
    const p = PUNCTUATORS.find((op) => src.startsWith(op, i));
    if (p) {
      tokens.push({ k: "op", v: p, line, col });
      i += p.length;
      continue;
    }
    throw compileError(line, `'${c}'는 C에서 쓸 수 없는 글자예요`, c === "“" || c === "”" ? "둥근 따옴표 대신 \" 를 써요." : "");
  }
  return { tokens, directives, lastLine: line };
}

function parseDefine(text, line) {
  const m = text.match(/^define\s+([A-Za-z_]\w*)(\(([^)]*)\))?\s*(.*)$/);
  if (!m) throw compileError(line, "#define 문장이 올바르지 않아요", "예: #define MAX 100");
  const [, name, , paramText, body] = m;
  const { tokens } = rawTokens(body);
  for (const t of tokens) t.line = line;
  if (tokens.some((t) => t.v === "#" || t.v === "##")) {
    throw compileError(line, "#define 안의 # 와 ## 는 아직 지원하지 않아요");
  }
  const params = paramText === undefined ? null : paramText.split(",").map((s) => s.trim()).filter(Boolean);
  return { name, params, body: tokens };
}

/** 소스 코드를 전처리하고 토큰 목록을 만들어요. */
export function tokenize(src) {
  const { tokens, directives, lastLine } = rawTokens(src);
  const includes = new Set();
  const macros = new Map();
  for (const [name, value] of Object.entries(LIMITS)) {
    const { tokens: body } = rawTokens(value);
    macros.set(name, { name, params: null, body, header: "limits.h" });
  }
  for (const name of ["RAND_MAX", "EXIT_SUCCESS", "EXIT_FAILURE"]) {
    const value = { RAND_MAX: "2147483647", EXIT_SUCCESS: "0", EXIT_FAILURE: "1" }[name];
    macros.set(name, { name, params: null, body: rawTokens(value).tokens, header: "stdlib.h" });
  }
  macros.set("M_PI", { name: "M_PI", params: null, body: rawTokens("3.14159265358979323846").tokens, header: "math.h" });
  macros.set("EOF", { name: "EOF", params: null, body: rawTokens("(-1)").tokens, header: "stdio.h" });

  // 지시문이 적용되는 위치(토큰 번호)에 따라 정의가 바뀌므로, 지시문과 토큰을 순서대로 처리해요.
  const out = [];
  let d = 0;
  const applyDirective = (dir) => {
    const { text, line } = dir;
    const word = text.split(/\s+/)[0];
    if (word === "include") {
      const m = text.match(/^include\s*[<"]([^>"]+)[>"]$/);
      if (!m) throw compileError(line, "#include 문장이 올바르지 않아요", "예: #include <stdio.h>");
      if (!HEADERS.has(m[1])) {
        throw compileError(line, `<${m[1]}> 헤더는 아직 지원하지 않아요`,
          `쓸 수 있는 헤더: ${[...HEADERS].map((h) => `<${h}>`).join(", ")}`);
      }
      includes.add(m[1]);
    } else if (word === "define") {
      const macro = parseDefine(text, line);
      macros.set(macro.name, macro);
    } else if (word === "undef") {
      macros.delete(text.split(/\s+/)[1]);
    } else if (word === "pragma" || word === "") {
      // 무시해요
    } else {
      throw compileError(line, `#${word}는 아직 지원하지 않아요`, "#include, #define, #undef 를 쓸 수 있어요.");
    }
  };

  const expand = (list, start, outList, hidden) => {
    let i = start;
    const tok = list[i];
    const macro = tok.k === "id" && !hidden.has(tok.v) ? macros.get(tok.v) : null;
    if (!macro) {
      outList.push(tok);
      return i + 1;
    }
    if (macro.header && !includes.has(macro.header)) {
      throw compileError(tok.line, `${tok.v}를 쓰려면 #include <${macro.header}>가 필요해요`, `맨 위에 #include <${macro.header}> 를 넣어 주세요.`);
    }
    let body = macro.body;
    if (macro.params) {
      if (!list[i + 1] || list[i + 1].v !== "(") {
        outList.push(tok);
        return i + 1;
      }
      const args = [[]];
      let depth = 0;
      let j = i + 2;
      for (; j < list.length; j++) {
        const t = list[j];
        if (t.v === "(") depth++;
        if (t.v === ")") {
          if (depth === 0) break;
          depth--;
        }
        if (t.v === "," && depth === 0) args.push([]);
        else args[args.length - 1].push(t);
      }
      if (j >= list.length) throw compileError(tok.line, `매크로 ${tok.v}의 괄호가 닫히지 않았어요`);
      const given = args.length === 1 && args[0].length === 0 ? [] : args;
      if (given.length !== macro.params.length) {
        throw compileError(tok.line, `매크로 ${tok.v}에는 값 ${macro.params.length}개가 필요한데 ${given.length}개를 넣었어요`);
      }
      body = [];
      for (const t of macro.body) {
        const p = t.k === "id" ? macro.params.indexOf(t.v) : -1;
        if (p >= 0) body.push(...given[p]);
        else body.push(t);
      }
      i = j + 1;
    } else {
      i += 1;
    }
    const inner = new Set(hidden).add(macro.name);
    const located = body.map((t) => ({ ...t, line: tok.line, col: tok.col }));
    for (let k = 0; k < located.length;) k = expand(located, k, outList, inner);
    return i;
  };

  for (let i = 0; i < tokens.length;) {
    while (d < directives.length && directives[d].at <= i) applyDirective(directives[d++]);
    i = expand(tokens, i, out, new Set());
  }
  while (d < directives.length) applyDirective(directives[d++]);
  out.push({ k: "eof", v: "<끝>", line: lastLine, col: 1 });
  return { tokens: out, includes };
}
